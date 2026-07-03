import * as EncodingModule from '../../lib/encoding.min.js';
import { reverseTriangleWinding } from './triangle-winding.js';
import {
  convertLeftHandedEulerToRightHanded,
  convertLeftHandedPositionToRightHanded,
} from './handedness-utils.js';

const Encoding = EncodingModule.default || globalThis.Encoding || EncodingModule;

/**
 * PMD (Polygon Model Data) binary loader.
 */
export class PMDLoader {
  constructor() {
    this.offset = 0;
    this.view = null;
    this._sjisDecoder = null;
  }

  /**
   * Loads a PMD file from URL.
   * @param {string} url - PMD file URL.
   * @returns {Promise<object>} Parsed model data.
   */
  async load(url) {
    const encodedUrl = encodeURI(url);
    const response = await fetch(encodedUrl);
    if (!response.ok) {
      throw new Error(`Failed to load PMD: ${response.status} ${response.statusText} (${url})`);
    }
    const buffer = await response.arrayBuffer();
    return this.parse(buffer);
  }

  /**
   * Parses a PMD ArrayBuffer.
   * @param {ArrayBuffer} buffer - PMD binary data.
   * @returns {object} Parsed model data.
   */
  parse(buffer) {
    this.view = new DataView(buffer);
    this.offset = 0;
    this._sjisDecoder = null;
    this.materialTextures = [];

    const magic = this.readAsciiString(3, 'header.magic');
    if (magic !== 'Pmd') {
      throw new Error('Invalid PMD magic');
    }

    this.checkBounds(4, 'header.version');
    const version = this.readFloat32();
    const name = this.readSjisString(20, 'header.name');
    const comment = this.readSjisString(256, 'header.comment');

    const vertices = this.readVertices();
    const indices = this.readIndices();
    reverseTriangleWinding(indices);
    const materials = this.readMaterials();
    const bones = this.readBones();
    const iks = this.readIkChains();
    const morphData = this.readMorphs();
    const displayFrameData = this.readDisplayFrames(morphData.morphIndexMap);
    const englishData = this.readOptionalEnglishHeader(bones.length, morphData.rawFaces.length, displayFrameData.boneFrameNames.length);
    const toonTextures = this.readToonTextures();
    const rigidBodies = this.readRigidBodies();
    this.normalizeRigidBodyPositions(rigidBodies, bones);
    const joints = this.readJoints();

    if (englishData) {
      this.applyEnglishNames(bones, morphData.rawFaces, displayFrameData.boneFrameNames, morphData.morphs, englishData);
    }

    this.applyMorphMetadata(morphData.morphs, displayFrameData.faceDisplayIndices);
    this.resolveMaterialTextures(materials, toonTextures);

    const displayFrames = this.buildDisplayFrames(
      morphData.morphs,
      displayFrameData.faceDisplayIndices,
      displayFrameData.boneFrameNames,
      displayFrameData.boneDisplayEntries,
    );

    return {
      magic,
      version,
      name,
      comment,
      nameEn: englishData?.modelNameEn || '',
      commentEn: englishData?.commentEn || '',
      vertices,
      indices,
      materials,
      textures: toonTextures.textures,
      bones,
      ik: iks,
      iks,
      morphs: morphData.morphs,
      faces: morphData.morphs,
      displayFrames,
      rigidBodies,
      joints,
      toonTextures: toonTextures.toonTextureNames,
    };
  }

  /**
   * Reads the vertex block.
   * @returns {Float32Array} Vertex buffer in OpenMMD layout.
   */
  readVertices() {
    this.checkBounds(4, 'vertexCount');
    const vertexCount = this.readUint32();
    const vertices = new Float32Array(vertexCount * 27);

    for (let i = 0; i < vertexCount; i++) {
      const base = i * 27;

      this.checkBounds(12, `vertex[${i}].position`);
      vertices[base + 0] = this.readFloat32();
      vertices[base + 1] = this.readFloat32();
      vertices[base + 2] = -this.readFloat32();

      this.checkBounds(12, `vertex[${i}].normal`);
      vertices[base + 3] = this.readFloat32();
      vertices[base + 4] = this.readFloat32();
      vertices[base + 5] = -this.readFloat32();

      this.checkBounds(8, `vertex[${i}].uv`);
      vertices[base + 6] = this.readFloat32();
      vertices[base + 7] = this.readFloat32();

      this.checkBounds(4, `vertex[${i}].bones`);
      const bone0 = this.readUint16();
      const bone1 = this.readUint16();
      vertices[base + 8] = bone0 === 0xFFFF ? 0 : bone0;
      vertices[base + 9] = bone1 === 0xFFFF ? 0 : bone1;
      vertices[base + 10] = 0;
      vertices[base + 11] = 0;

      this.checkBounds(1, `vertex[${i}].weight`);
      const weight = this.readUint8() / 100.0;
      vertices[base + 12] = weight;
      vertices[base + 13] = 1.0 - weight;
      vertices[base + 14] = 0;
      vertices[base + 15] = 0;
      vertices[base + 16] = 1;

      this.checkBounds(1, `vertex[${i}].edge`);
      vertices[base + 26] = this.readUint8();
    }

    return vertices;
  }

  /**
   * Reads the index buffer.
   * @returns {Uint16Array} Triangle index buffer.
   */
  readIndices() {
    this.checkBounds(4, 'indexCount');
    const indexCount = this.readUint32();
    const indices = new Uint16Array(indexCount);

    for (let i = 0; i < indexCount; i++) {
      this.checkBounds(2, `index[${i}]`);
      indices[i] = this.readUint16();
    }

    return indices;
  }

  /**
   * Reads material records and collects texture references.
   * @returns {Array<object>} Materials.
   */
  readMaterials() {
    this.checkBounds(4, 'materialCount');
    const materialCount = this.readUint32();
    const materials = [];
    const textures = [];
    const textureMap = new Map();

    const getTextureIndex = (path) => {
      if (!path) {
        return -1;
      }
      const normalized = normalizeTexturePath(path);
      if (!textureMap.has(normalized)) {
        textureMap.set(normalized, textures.length);
        textures.push(normalized);
      }
      return textureMap.get(normalized);
    };

    for (let i = 0; i < materialCount; i++) {
      const diffuse = [this.readFloat32(), this.readFloat32(), this.readFloat32(), this.readFloat32()];
      const shininess = this.readFloat32();
      const specular = [this.readFloat32(), this.readFloat32(), this.readFloat32()];
      const ambient = [this.readFloat32(), this.readFloat32(), this.readFloat32()];
      const toonIndexRaw = this.readUint8();
      const edgeFlag = this.readUint8();
      const indexCount = this.readUint32();
      const textureField = this.readSjisString(20, `material[${i}].texture`);

      const [textureNameRaw = '', sphereNameRaw = ''] = textureField.split('*');
      const textureName = textureNameRaw.trim();
      const sphereName = sphereNameRaw.trim();
      const textureIndex = getTextureIndex(textureName);
      const sphereIndex = getTextureIndex(sphereName);

      materials.push({
        diffuse,
        shininess,
        specular,
        ambient,
        toonIndex: toonIndexRaw,
        toonMode: 1,
        toonIndexRaw,
        flags: edgeFlag ? 0x10 : 0x00,
        noCull: false,
        hasEdge: edgeFlag !== 0,
        receiveShadow: true,
        edgeColor: [0, 0, 0, 1],
        edgeSize: 1,
        indexCount,
        textureIndex,
        sphereIndex,
        sphereMode: this.detectSphereMode(sphereName),
        texture: textureName,
        sphereTexture: sphereName,
        fullTextureName: textureField,
      });
    }

    this.materialTextures = textures;
    return materials;
  }

  /**
   * Reads bone records.
   * @returns {Array<object>} Bones.
   */
  readBones() {
    this.checkBounds(2, 'boneCount');
    const boneCount = this.readUint16();
    const bones = [];

    for (let i = 0; i < boneCount; i++) {
      const bone = {
        name: this.readSjisString(20, `bone[${i}].name`),
        parentIndex: this.readInt16(),
        tailIndex: this.readInt16(),
        type: this.readUint8(),
        ikIndex: this.readUint16(),
        position: this.readVector3(true),
        transformLevel: i,
        flags: 0x0008,
      };
      bones.push(bone);
    }

    return bones;
  }

  /**
   * Reads IK chains.
   * @returns {Array<object>} IK chain list.
   */
  readIkChains() {
    this.checkBounds(2, 'ikCount');
    const ikCount = this.readUint16();
    const iks = [];

    for (let i = 0; i < ikCount; i++) {
      const boneIndex = this.readUint16();
      const targetBoneIndex = this.readUint16();
      const chainLength = this.readUint8();
      const loopCount = this.readUint16();
      const limitAngle = this.readFloat32();
      const childBoneIndices = [];

      for (let j = 0; j < chainLength; j++) {
        childBoneIndices.push(this.readUint16());
      }

      iks.push({
        boneIndex,
        targetBoneIndex,
        chainLength,
        loopCount,
        limitAngle,
        iteration: loopCount,
        limitation: limitAngle,
        links: childBoneIndices.map((childBoneIndex) => ({
          boneIndex: childBoneIndex,
          hasLimit: false,
          minAngle: [-Math.PI, -Math.PI, -Math.PI],
          maxAngle: [Math.PI, Math.PI, Math.PI],
        })),
        childBoneIndices,
      });
    }

    return iks;
  }

  /**
   * Reads morph records and converts vertex morphs to OpenMMD's deltas.
   * @returns {{morphs: Array<object>, rawFaces: Array<object>, morphIndexMap: Map<number, number>}} Morph data.
   */
  readMorphs() {
    this.checkBounds(2, 'morphCount');
    const morphCount = this.readUint16();
    const rawFaces = [];

    for (let i = 0; i < morphCount; i++) {
      const name = this.readSjisString(20, `morph[${i}].name`);
      const vertexCount = this.readUint32();
      const type = this.readUint8();
      const vertices = [];

      for (let j = 0; j < vertexCount; j++) {
        const index = this.readUint32();
        const position = this.readVector3(true);
        vertices.push({ index, position });
      }

      rawFaces.push({ name, vertexCount, type, vertices });
    }

    const baseFace = rawFaces.find((face) => face.type === 0) || rawFaces[0] || null;

    const morphs = [];
    const morphIndexMap = new Map();
    for (let i = 0; i < rawFaces.length; i++) {
      const face = rawFaces[i];
      if (face.type === 0) {
        continue;
      }

      const offsets = face.vertices.map((vertex) => {
        const baseVertex = baseFace?.vertices?.[vertex.index];
        return {
          // PMD non-base morph indices point into the base morph vertex table.
          index: typeof baseVertex?.index === 'number' ? baseVertex.index : vertex.index,
          // PMD stores non-base morph positions as deltas, so preserve them as-is.
          position: [...vertex.position],
        };
      });

      const morph = {
        name: face.name,
        panelType: this.mapMorphPanelType(face.type),
        type: 1,
        offsets,
        sourceType: face.type,
      };
      morphIndexMap.set(i, morphs.length);
      morphs.push(morph);
    }

    return { morphs, rawFaces, morphIndexMap };
  }

  /**
   * Reads face display indices and bone display groups.
   * @param {Map<number, number>} morphIndexMap - Map from raw face index to morph index.
   * @returns {{faceDisplayIndices: Array<number>, boneFrameNames: Array<string>, boneDisplayEntries: Array<object>}} Display frame data.
   */
  readDisplayFrames(morphIndexMap) {
    this.checkBounds(1, 'faceDisplayCount');
    const faceDisplayCount = this.readUint8();
    const faceDisplayIndices = [];
    for (let i = 0; i < faceDisplayCount; i++) {
      const rawIndex = this.readUint16();
      if (morphIndexMap.has(rawIndex)) {
        faceDisplayIndices.push(morphIndexMap.get(rawIndex));
      }
    }

    this.checkBounds(1, 'boneFrameNameCount');
    const boneFrameNameCount = this.readUint8();
    const boneFrameNames = [];
    for (let i = 0; i < boneFrameNameCount; i++) {
      boneFrameNames.push({
        name: this.readSjisString(50, `boneFrameName[${i}]`),
        nameEn: '',
      });
    }

    this.checkBounds(4, 'boneDisplayCount');
    const boneDisplayCount = this.readUint32();
    const boneDisplayEntries = [];
    for (let i = 0; i < boneDisplayCount; i++) {
      boneDisplayEntries.push({
        boneIndex: this.readUint16(),
        frameIndex: this.readUint8(),
      });
    }

    return { faceDisplayIndices, boneFrameNames, boneDisplayEntries };
  }

  /**
   * Reads the optional English section.
   * @param {number} boneCount - Number of bones.
   * @param {number} faceCount - Number of raw faces.
   * @param {number} boneFrameNameCount - Number of bone frame names.
   * @returns {{modelNameEn: string, commentEn: string, boneNamesEn: string[], faceNamesEn: string[], boneFrameNamesEn: string[]}|null} English metadata.
   */
  readOptionalEnglishHeader(boneCount, faceCount, boneFrameNameCount) {
    if (this.offset >= this.view.byteLength) {
      return null;
    }

    const nextByte = this.peekUint8();
    if (nextByte !== 0 && nextByte !== 1) {
      return null;
    }

    const englishCompatibility = this.readUint8();
    if (englishCompatibility === 0) {
      return null;
    }

    const modelNameEn = this.readSjisString(20, 'english.modelName');
    const commentEn = this.readSjisString(256, 'english.comment');
    const boneNamesEn = [];
    for (let i = 0; i < boneCount; i++) {
      boneNamesEn.push(this.readSjisString(20, `english.boneName[${i}]`));
    }
    const faceNamesEn = [];
    // PMD English face names do not include the base face entry.
    for (let i = 0; i < Math.max(0, faceCount - 1); i++) {
      faceNamesEn.push(this.readSjisString(20, `english.faceName[${i}]`));
    }
    const boneFrameNamesEn = [];
    for (let i = 0; i < boneFrameNameCount; i++) {
      boneFrameNamesEn.push(this.readSjisString(50, `english.boneFrameName[${i}]`));
    }

    return {
      modelNameEn,
      commentEn,
      boneNamesEn,
      faceNamesEn,
      boneFrameNamesEn,
    };
  }

  /**
   * Reads the toon texture section.
   * @returns {{textures: string[], toonTextureNames: string[]}} Texture lookup tables.
   */
  readToonTextures() {
    const toonTextureNames = [];
    for (let i = 0; i < 10; i++) {
      toonTextureNames.push(this.readSjisString(100, `toonTexture[${i}]`));
    }

    const textures = Array.isArray(this.materialTextures) ? [...this.materialTextures] : [];
    const textureMap = new Map(textures.map((path, index) => [path, index]));

    for (const toonTextureName of toonTextureNames) {
      if (!toonTextureName) {
        continue;
      }
      const normalized = normalizeTexturePath(toonTextureName);
      if (!textureMap.has(normalized)) {
        textureMap.set(normalized, textures.length);
        textures.push(normalized);
      }
    }

    return { textures, toonTextureNames };
  }

  /**
   * Reads rigid body definitions.
   * @returns {Array<object>} Rigid bodies.
   */
  readRigidBodies() {
    if (this.offset + 4 > this.view.byteLength) {
      return [];
    }

    const rigidBodyCount = this.readUint32();
    const remainingBytes = this.view.byteLength - this.offset;
    const minimumRigidBodyBytes = 83;
    if (rigidBodyCount > 0 && rigidBodyCount * minimumRigidBodyBytes > remainingBytes) {
      return [];
    }
    const rigidBodies = [];

    for (let i = 0; i < rigidBodyCount; i++) {
      const name = this.readSjisString(20, `rigidBody[${i}].name`);
      const boneIndex = this.readInt16();
      const groupId = this.readUint8();
      const collisionMask = this.readUint16();
      const shape = this.readUint8();
      const size = this.readVector3(false);
      const position = this.readVector3(true);
      const rotation = this.readEuler(true);
      const mass = this.readFloat32();
      const moveAttenuation = this.readFloat32();
      const rotationDamping = this.readFloat32();
      const repulsion = this.readFloat32();
      const friction = this.readFloat32();
      const physicsMode = this.readUint8();

      rigidBodies.push({
        name,
        boneIndex,
        groupId,
        collisionMask,
        shape,
        size,
        position,
        rotation,
        mass,
        moveAttenuation,
        rotationDamping,
        repulsion,
        friction,
        physicsMode,
      });
    }

    return rigidBodies;
  }

  /**
   * PMD の剛体位置を関連ボーン位置へ正規化します。
   * PMD の剛体座標はボーン基準のオフセットとして格納されているため、
   * PMX 相当の内部表現ではボーン位置を足した絶対位置へ揃えます。
   * @param {Array<object>} rigidBodies - 剛体一覧。
   * @param {Array<object>} bones - ボーン一覧。
   */
  normalizeRigidBodyPositions(rigidBodies, bones) {
    if (!Array.isArray(rigidBodies) || !Array.isArray(bones) || bones.length === 0) {
      return;
    }

    const rootBone = bones[0];
    for (const rigidBody of rigidBodies) {
      if (!rigidBody || !Array.isArray(rigidBody.position)) {
        continue;
      }

      const bone = rigidBody.boneIndex >= 0 && rigidBody.boneIndex < bones.length ? bones[rigidBody.boneIndex] : rootBone;
      if (!bone || !Array.isArray(bone.position)) {
        continue;
      }

      rigidBody.position[0] += bone.position[0];
      rigidBody.position[1] += bone.position[1];
      rigidBody.position[2] += bone.position[2];
    }
  }

  /**
   * Reads joints.
   * @returns {Array<object>} Joints.
   */
  readJoints() {
    if (this.offset + 4 > this.view.byteLength) {
      return [];
    }

    const jointCount = this.readUint32();
    const remainingBytes = this.view.byteLength - this.offset;
    const minimumJointBytes = 104;
    if (jointCount > 0 && jointCount * minimumJointBytes > remainingBytes) {
      return [];
    }
    const joints = [];

    for (let i = 0; i < jointCount; i++) {
      const name = this.readSjisString(20, `joint[${i}].name`);
      const rigidBodyIndexA = this.readUint32();
      const rigidBodyIndexB = this.readUint32();
      const position = this.readVector3(true);
      const rotation = this.readEuler(true);
      const posMinRaw = this.readVector3(false);
      const posMaxRaw = this.readVector3(false);
      const rotMin = this.readEuler(true);
      const rotMax = this.readEuler(true);
      const posSpring = this.readVector3(false);
      const rotSpring = this.readVector3(false);
      const posMin = [
        posMinRaw[0],
        posMinRaw[1],
        -Math.max(posMinRaw[2], posMaxRaw[2]),
      ];
      const posMax = [
        posMaxRaw[0],
        posMaxRaw[1],
        -Math.min(posMinRaw[2], posMaxRaw[2]),
      ];

      joints.push({
        name,
        rigidBodyIndexA,
        rigidBodyIndexB,
        position,
        rotation,
        posMin,
        posMax,
        rotMin,
        rotMax,
        posSpring,
        rotSpring,
      });
    }

    return joints;
  }

  /**
   * Applies English names to bones and morphs when present.
   * @param {Array<object>} bones - Bone list.
   * @param {Array<object>} rawFaces - Raw face list.
   * @param {Array<string>} boneFrameNames - Bone frame names.
   * @param {Array<object>} morphs - Morph list.
   * @param {object} englishData - English metadata.
   */
  applyEnglishNames(bones, rawFaces, boneFrameNames, morphs, englishData) {
    for (let i = 0; i < bones.length && i < englishData.boneNamesEn.length; i++) {
      bones[i].nameEn = englishData.boneNamesEn[i];
    }

    // rawFaces[0] is the base face, so English face names start from rawFaces[1].
    for (let i = 1; i < rawFaces.length && (i - 1) < englishData.faceNamesEn.length; i++) {
      const morphIndex = morphs.findIndex((morph) => morph.name === rawFaces[i].name);
      if (morphIndex !== -1) {
        morphs[morphIndex].nameEn = englishData.faceNamesEn[i - 1];
      }
    }

    for (let i = 0; i < boneFrameNames.length && i < englishData.boneFrameNamesEn.length; i++) {
      boneFrameNames[i].nameEn = englishData.boneFrameNamesEn[i];
    }
  }

  /**
   * Normalizes morph metadata.
   * @param {Array<object>} morphs - Morph list.
   * @param {Array<number>} faceDisplayIndices - Face display indices.
   */
  applyMorphMetadata(morphs, faceDisplayIndices) {
    const displayedMorphIndices = new Set(faceDisplayIndices);
    for (let i = 0; i < morphs.length; i++) {
      morphs[i].hidden = false;
      morphs[i].displayIndex = i;
      morphs[i].displayed = displayedMorphIndices.has(i);
    }
  }

  /**
   * Populates material texture aliases from the parsed texture table.
   * @param {Array<object>} materials - Materials.
   * @param {{textures: string[], toonTextureNames: string[]}} textureData - Texture tables.
   */
  resolveMaterialTextures(materials, textureData) {
    const textureMap = new Map(textureData.textures.map((path, index) => [path, index]));
    const toonTextureIndexMap = new Map();
    for (const [index, toonTextureName] of textureData.toonTextureNames.entries()) {
      const normalized = normalizeTexturePath(toonTextureName);
      if (!normalized) {
        continue;
      }
      const textureIndex = textureMap.get(normalized);
      if (textureIndex !== undefined) {
        toonTextureIndexMap.set(index, textureIndex);
      }
    }

    for (const material of materials) {
      if (material.textureIndex < 0 || !textureData.textures[material.textureIndex]) {
        material.textureIndex = -1;
        material.texture = '';
      }
      if (material.sphereIndex < 0 || !textureData.textures[material.sphereIndex]) {
        material.sphereIndex = -1;
        material.sphereTexture = '';
      }
      const toonTextureIndex = toonTextureIndexMap.get(material.toonIndexRaw);
      if (toonTextureIndex !== undefined) {
        material.toonMode = 0;
        material.toonIndex = toonTextureIndex;
      } else {
        material.toonMode = 1;
        material.toonIndex = material.toonIndexRaw;
      }
    }
  }

  /**
   * Builds display frames in PMX-compatible shape.
   * @param {Array<object>} morphs - Morph list.
   * @param {Array<number>} faceDisplayIndices - Face display morph indices.
   * @param {Array<object>} boneFrameNames - Bone frame names.
   * @param {Array<object>} boneDisplayEntries - Bone display entries.
   * @returns {Array<object>} Display frames.
   */
  buildDisplayFrames(morphs, faceDisplayIndices, boneFrameNames, boneDisplayEntries) {
    const displayFrames = [];

    if (faceDisplayIndices.length > 0) {
      displayFrames.push({
        name: 'Face',
        nameEn: 'Face',
        specialFlag: 1,
        frames: faceDisplayIndices
          .filter((index) => index >= 0 && index < morphs.length)
          .map((index) => ({ type: 1, index })),
      });
    }

    for (let i = 0; i < boneFrameNames.length; i++) {
      const frameEntries = boneDisplayEntries
        .filter((entry) => entry.frameIndex === i)
        .map((entry) => ({ type: 0, index: entry.boneIndex }));
      displayFrames.push({
        name: boneFrameNames[i]?.name || `Frame ${i}`,
        nameEn: boneFrameNames[i]?.nameEn || boneFrameNames[i]?.name || `Frame ${i}`,
        specialFlag: 0,
        frames: frameEntries,
      });
    }

    return displayFrames;
  }

  /**
   * Maps PMD morph categories to UI panel types.
   * @param {number} rawType - PMD morph type.
   * @returns {number} UI panel type.
   */
  mapMorphPanelType(rawType) {
    if (rawType <= 0) {
      return 4;
    }
    if (rawType >= 4) {
      return 4;
    }
    return rawType;
  }

  /**
   * Detects PMD sphere texture mode from extension.
   * @param {string} name - Texture file name.
   * @returns {number} Sphere mode.
   */
  detectSphereMode(name) {
    const normalized = normalizeTexturePath(name).toLowerCase();
    if (!normalized) {
      return 0;
    }
    if (normalized.endsWith('.spa')) {
      return 2;
    }
    if (normalized.endsWith('.sph')) {
      return 1;
    }
    return 0;
  }

  /**
   * Reads a signed 16-bit integer.
   * @returns {number} Integer value.
   */
  readInt16() {
    this.checkBounds(2, 'int16');
    const value = this.view.getInt16(this.offset, true);
    this.offset += 2;
    return value;
  }

  /**
   * Reads an unsigned 8-bit integer.
   * @returns {number} Integer value.
   */
  readUint8() {
    this.checkBounds(1, 'uint8');
    const value = this.view.getUint8(this.offset);
    this.offset += 1;
    return value;
  }

  /**
   * Reads an unsigned 16-bit integer.
   * @returns {number} Integer value.
   */
  readUint16() {
    this.checkBounds(2, 'uint16');
    const value = this.view.getUint16(this.offset, true);
    this.offset += 2;
    return value;
  }

  /**
   * Reads an unsigned 32-bit integer.
   * @returns {number} Integer value.
   */
  readUint32() {
    this.checkBounds(4, 'uint32');
    const value = this.view.getUint32(this.offset, true);
    this.offset += 4;
    return value;
  }

  /**
   * Reads a 32-bit float.
   * @returns {number} Float value.
   */
  readFloat32() {
    this.checkBounds(4, 'float32');
    const value = this.view.getFloat32(this.offset, true);
    this.offset += 4;
    return value;
  }

  /**
   * Reads a vec3 and optionally flips the Z axis.
   * @param {boolean} flipZ - Whether to negate Z.
   * @returns {number[]} Vec3 value.
   */
  readVector3(flipZ = false) {
    const x = this.readFloat32();
    const y = this.readFloat32();
    const z = this.readFloat32();
    const position = [x, y, z];
    return flipZ ? convertLeftHandedPositionToRightHanded(position) : position;
  }

  /**
   * Reads Euler angles and optionally flips the X and Y axes.
   * @param {boolean} flipXY - Whether to negate X and Y.
   * @returns {number[]} Euler value.
   */
  readEuler(flipXY = false) {
    const x = this.readFloat32();
    const y = this.readFloat32();
    const z = this.readFloat32();
    const rotation = [x, y, z];
    return flipXY ? convertLeftHandedEulerToRightHanded(rotation) : rotation;
  }

  /**
   * Reads an ASCII fixed-length string.
   * @param {number} length - Number of bytes.
   * @param {string} context - Read context.
   * @returns {string} Decoded string.
   */
  readAsciiString(length, context = 'unknown') {
    this.checkBounds(length, context);
    const bytes = new Uint8Array(this.view.buffer, this.view.byteOffset + this.offset, length);
    this.offset += length;
    const nullIndex = bytes.indexOf(0);
    const slice = nullIndex === -1 ? bytes : bytes.subarray(0, nullIndex);
    return String.fromCharCode(...slice);
  }

  /**
   * Reads a Shift-JIS fixed-length string.
   * @param {number} length - Number of bytes.
   * @param {string} context - Read context.
   * @returns {string} Decoded string.
   */
  readSjisString(length, context = 'unknown') {
    this.checkBounds(length, context);
    const bytes = new Uint8Array(this.view.buffer, this.view.byteOffset + this.offset, length);
    this.offset += length;
    const nullIndex = bytes.indexOf(0);
    const slice = trimFixedStringBytes(nullIndex === -1 ? bytes : bytes.subarray(0, nullIndex));
    if (slice.length === 0) {
      return '';
    }
    const decoder = this.getShiftJisDecoder();
    if (decoder) {
      return decoder.decode(slice);
    }
    const codes = Encoding.convert(slice, { to: 'UNICODE', from: 'SJIS' });
    return Encoding.codeToString(codes);
  }

  /**
   * Returns a cached Shift-JIS decoder when available.
   * @returns {TextDecoder|null} Decoder.
   */
  getShiftJisDecoder() {
    if (this._sjisDecoder !== null) {
      return this._sjisDecoder;
    }
    if (typeof TextDecoder === 'undefined') {
      this._sjisDecoder = null;
      return this._sjisDecoder;
    }

    try {
      this._sjisDecoder = new TextDecoder('shift_jis');
    } catch (error) {
      try {
        this._sjisDecoder = new TextDecoder('shift-jis');
      } catch (innerError) {
        this._sjisDecoder = null;
      }
    }

    return this._sjisDecoder;
  }

  /**
   * Peeks an unsigned byte without moving the cursor.
   * @returns {number} Byte value.
   */
  peekUint8() {
    this.checkBounds(1, 'peekUint8');
    return this.view.getUint8(this.offset);
  }

  /**
   * Validates that a read does not exceed the buffer.
   * @param {number} size - Number of bytes to read.
   * @param {string} context - Read context.
   */
  checkBounds(size, context = 'unknown') {
    if (this.offset + size > this.view.byteLength) {
      throw new Error(`Out of bounds reading ${size} bytes at offset ${this.offset} (context: ${context})`);
    }
  }
}

/**
 * Normalizes a texture path for stable lookup.
 * @param {string} path - Texture path.
 * @returns {string} Normalized path.
 */
function normalizeTexturePath(path) {
  return (path || '').replace(/\\/g, '/');
}

/**
 * Trims fixed-length PMD string padding.
 * @param {Uint8Array} bytes - Raw string bytes.
 * @returns {Uint8Array} Trimmed bytes.
 */
function trimFixedStringBytes(bytes) {
  let start = 0;
  let end = bytes.length;

  while (start < end && (bytes[start] === 0x00 || bytes[start] === 0xFD)) {
    start++;
  }
  while (end > start && (bytes[end - 1] === 0x00 || bytes[end - 1] === 0xFD)) {
    end--;
  }

  return bytes.subarray(start, end);
}
