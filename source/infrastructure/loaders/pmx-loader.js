import { reverseTriangleWinding } from './triangle-winding.js';
import {
  convertLeftHandedEulerToRightHanded,
  convertLeftHandedQuaternionToRightHanded,
  convertLeftHandedPositionToRightHanded,
} from './handedness-utils.js';

/**
 * PMX 2.0/2.1 Binary Loader for WebGPU
 */
export class PMXLoader {
  constructor() {
    this.offset = 0;
    this.view = null;
    this.config = {};
  }

  checkBounds(size, context = "unknown") {
    if (this.offset + size > this.view.byteLength) {
      throw new Error(`Out of bounds reading ${size} bytes at offset ${this.offset} (context: ${context})`);
    }
  }

  async load(url) {
    const encodedUrl = encodeURI(url);
    const response = await fetch(encodedUrl);
    if (!response.ok) {
      throw new Error(`Failed to load PMX: ${response.status} ${response.statusText} (${url})`);
    }
    const buffer = await response.arrayBuffer();
    return this.parse(buffer);
  }

  async parse(buffer) {
    this.view = new DataView(buffer);
    this.offset = 0;

    // 1. Header
    this.checkBounds(4, "header.signature");
    const signature = this.readString(4);
    if (signature !== "PMX ") throw new Error("Invalid PMX signature");

    this.checkBounds(4, "header.version");
    const version = this.view.getFloat32(this.offset, true);
    this.offset += 4;
    // console.log(`PMX version: ${version}`);

    this.checkBounds(1, "header.configSize");
    const configSize = this.view.getUint8(this.offset++);
    if (configSize < 8) {
      throw new Error(`Invalid PMX config size: ${configSize}`);
    }

    this.checkBounds(configSize, "header.config");
    const configData = new Uint8Array(this.view.buffer, this.view.byteOffset + this.offset, configSize);
    this.config = {
      encoding: this.view.getUint8(this.offset++), // 0: UTF16LE, 1: UTF8
      extraUV: this.view.getUint8(this.offset++),
      vertexIndexSize: this.view.getUint8(this.offset++),
      textureIndexSize: this.view.getUint8(this.offset++),
      materialIndexSize: this.view.getUint8(this.offset++),
      boneIndexSize: this.view.getUint8(this.offset++),
      morphIndexSize: this.view.getUint8(this.offset++),
      rigidbodyIndexSize: this.view.getUint8(this.offset++),
    };
    this.offset += (configSize - 8);
    const modelName = this.readText("modelName");
    const modelNameEn = this.readText("modelNameEn");
    const comment = this.readText("comment");
    const commentEn = this.readText("commentEn");

    // 2. Vertices
    this.checkBounds(4, "vertexCount");
    const vertexCount = this.view.getInt32(this.offset, true);
    this.offset += 4;
    const vertices = new Float32Array(vertexCount * 27); // stride = 27 (108 bytes)
    const weightTypes = new Uint8Array(vertexCount);
    for (let i = 0; i < vertexCount; i++) {
      const vOffset = i * 27;
      this.checkBounds(12, `vertex[${i}].pos`);
      vertices[vOffset + 0] = this.view.getFloat32(this.offset, true);
      vertices[vOffset + 1] = this.view.getFloat32(this.offset + 4, true);
      vertices[vOffset + 2] = -this.view.getFloat32(this.offset + 8, true); // Z-flip
      this.offset += 12;

      this.checkBounds(12, `vertex[${i}].normal`);
      vertices[vOffset + 3] = this.view.getFloat32(this.offset, true);
      vertices[vOffset + 4] = this.view.getFloat32(this.offset + 4, true);
      vertices[vOffset + 5] = -this.view.getFloat32(this.offset + 8, true); // Z-flip
      this.offset += 12;

      this.checkBounds(8, `vertex[${i}].uv`);
      vertices[vOffset + 6] = this.view.getFloat32(this.offset, true);
      vertices[vOffset + 7] = this.view.getFloat32(this.offset + 4, true);
      this.offset += 8;

      // Skip extra UV
      this.offset += (this.config.extraUV * 16);

      this.checkBounds(1, `vertex[${i}].weightType`);
      const weightType = this.view.getUint8(this.offset++);
      weightTypes[i] = weightType;
      vertices[vOffset + 16] = weightType;
      
      const bIndices = [0, 0, 0, 0];
      const bWeights = [0, 0, 0, 0];
      const sdefData = new Float32Array(9);

      if (weightType === 0) { // BDEF1
        const b = this.readIndex(this.config.boneIndexSize);
        bIndices[0] = b === -1 ? 0 : b;
        bWeights[0] = 1.0;
      } else if (weightType === 1) { // BDEF2
        const b1 = this.readIndex(this.config.boneIndexSize);
        const b2 = this.readIndex(this.config.boneIndexSize);
        bIndices[0] = b1 === -1 ? 0 : b1;
        bIndices[1] = b2 === -1 ? 0 : b2;
        bWeights[0] = this.view.getFloat32(this.offset, true);
        bWeights[1] = 1.0 - bWeights[0];
        this.offset += 4;
      } else if (weightType === 2 || weightType === 4) { // BDEF4, QDEF
        for (let j = 0; j < 4; j++) {
          const b = this.readIndex(this.config.boneIndexSize);
          bIndices[j] = b === -1 ? 0 : b;
        }
        for (let j = 0; j < 4; j++) {
          bWeights[j] = this.view.getFloat32(this.offset + (j * 4), true);
        }
        this.offset += 16;
      } else if (weightType === 3) { // SDEF
        const b1 = this.readIndex(this.config.boneIndexSize);
        const b2 = this.readIndex(this.config.boneIndexSize);
        bIndices[0] = b1 === -1 ? 0 : b1;
        bIndices[1] = b2 === -1 ? 0 : b2;
        bWeights[0] = this.view.getFloat32(this.offset, true);
        bWeights[1] = 1.0 - bWeights[0];
        this.offset += 4; // Weight
        for (let j = 0; j < 9; j++) sdefData[j] = this.view.getFloat32(this.offset + (j * 4), true);
        // Z-flip for spatial parameters C, R0, R1
        sdefData[2] = -sdefData[2];
        sdefData[5] = -sdefData[5];
        sdefData[8] = -sdefData[8];
        this.offset += 36; // C, R0, R1 (3 * vec3)
      }

      vertices[vOffset + 8] = bIndices[0];
      vertices[vOffset + 9] = bIndices[1];
      vertices[vOffset + 10] = bIndices[2];
      vertices[vOffset + 11] = bIndices[3];
      vertices[vOffset + 12] = bWeights[0];
      vertices[vOffset + 13] = bWeights[1];
      vertices[vOffset + 14] = bWeights[2];
      vertices[vOffset + 15] = bWeights[3];
      vertices.set(sdefData, vOffset + 17);

      // Read and store edge scale
      this.checkBounds(4, `vertex[${i}].edgeScale`);
      vertices[vOffset + 26] = this.view.getFloat32(this.offset, true);
      this.offset += 4;
    }

    // 3. Surfaces (Indices)
    this.checkBounds(4, "surfaceCount");
    const surfaceCount = this.view.getInt32(this.offset, true);
    this.offset += 4;
    let indices;
    if (this.config.vertexIndexSize === 1) {
      indices = new Uint16Array(surfaceCount);
      for (let i = 0; i < surfaceCount; i++) indices[i] = this.view.getUint8(this.offset++);
    } else if (this.config.vertexIndexSize === 2) {
      indices = new Uint16Array(surfaceCount);
      for (let i = 0; i < surfaceCount; i++) {
        indices[i] = this.view.getUint16(this.offset, true);
        this.offset += 2;
      }
    } else {
      indices = new Uint32Array(surfaceCount);
      for (let i = 0; i < surfaceCount; i++) {
        indices[i] = this.view.getUint32(this.offset, true);
        this.offset += 4;
      }
    }
    reverseTriangleWinding(indices);

    // 4. Textures
    this.checkBounds(4, "textureCount");
    const textureCount = this.view.getInt32(this.offset, true);
    this.offset += 4;
    const textures = [];
    for (let i = 0; i < textureCount; i++) {
      textures.push(this.readText(`texture[${i}]`));
    }

    // 5. Materials
    this.checkBounds(4, "materialCount");
    const materialCount = this.view.getInt32(this.offset, true);
    this.offset += 4;
    const materials = [];
    for (let i = 0; i < materialCount; i++) {
      const mat = {};
      mat.name = this.readText(`material[${i}].name`);
      mat.nameEn = this.readText(`material[${i}].nameEn`);
      this.checkBounds(16 + 12 + 4 + 12 + 1 + 16 + 4, `material[${i}].data`);
      mat.diffuse = [this.view.getFloat32(this.offset, true), this.view.getFloat32(this.offset + 4, true), this.view.getFloat32(this.offset + 8, true), this.view.getFloat32(this.offset + 12, true)]; this.offset += 16;
      mat.specular = [this.view.getFloat32(this.offset, true), this.view.getFloat32(this.offset + 4, true), this.view.getFloat32(this.offset + 8, true)]; this.offset += 12;
      mat.shininess = this.view.getFloat32(this.offset, true); this.offset += 4;
      mat.ambient = [this.view.getFloat32(this.offset, true), this.view.getFloat32(this.offset + 4, true), this.view.getFloat32(this.offset + 8, true)]; this.offset += 12;
      mat.flags = this.view.getUint8(this.offset++);
      mat.hasEdge = (mat.flags & 0x10) !== 0;
      mat.noCull = (mat.flags & 0x01) !== 0;
      mat.drawShadow = (mat.flags & 0x04) !== 0;
      mat.receiveShadow = (mat.flags & 0x08) !== 0;
      mat.edgeColor = [this.view.getFloat32(this.offset, true), this.view.getFloat32(this.offset + 4, true), this.view.getFloat32(this.offset + 8, true), this.view.getFloat32(this.offset + 12, true)]; this.offset += 16;
      mat.edgeSize = this.view.getFloat32(this.offset, true); this.offset += 4;
      mat.textureIndex = this.readIndex(this.config.textureIndexSize);
      mat.sphereIndex = this.readIndex(this.config.textureIndexSize);
      mat.sphereMode = this.view.getUint8(this.offset++);
      mat.toonMode = this.view.getUint8(this.offset++);
      if (mat.toonMode === 0) {
        mat.toonIndex = this.readIndex(this.config.textureIndexSize);
      } else {
        mat.toonIndex = this.view.getUint8(this.offset++);
      }
      mat.memo = this.readText(`material[${i}].memo`);
      this.checkBounds(4, `material[${i}].indexCount`);
      mat.indexCount = this.view.getInt32(this.offset, true);
      this.offset += 4;
      materials.push(mat);
    }

    // 6. Bones
    this.checkBounds(4, "boneCount");
    const boneCount = this.view.getInt32(this.offset, true);
    this.offset += 4;
    const bones = [];
    for (let i = 0; i < boneCount; i++) {
      const bone = {};
      bone.name = this.readText(`bone[${i}].name`);
      bone.nameEn = this.readText(`bone[${i}].nameEn`);
      this.checkBounds(12, `bone[${i}].pos`);
      bone.position = convertLeftHandedPositionToRightHanded([
        this.view.getFloat32(this.offset, true),
        this.view.getFloat32(this.offset + 4, true),
        this.view.getFloat32(this.offset + 8, true),
      ]); this.offset += 12;
      bone.parentIndex = this.readIndex(this.config.boneIndexSize);
      this.checkBounds(4 + 2, `bone[${i}].flags`);
      bone.transformLevel = this.view.getInt32(this.offset, true); this.offset += 4;
      bone.flags = this.view.getUint16(this.offset, true); this.offset += 2;

      if (bone.flags & 0x0001) { // Indexed tail position
        bone.tailIndex = this.readIndex(this.config.boneIndexSize);
      } else {
        bone.tailOffset = convertLeftHandedPositionToRightHanded([
          this.view.getFloat32(this.offset, true),
          this.view.getFloat32(this.offset + 4, true),
          this.view.getFloat32(this.offset + 8, true),
        ]);
        this.offset += 12;
      }

      if (bone.flags & (0x0100 | 0x0200)) { // Inherit rotation or translation
        bone.inheritParentIndex = this.readIndex(this.config.boneIndexSize);
        bone.inheritInfluence = this.view.getFloat32(this.offset, true); this.offset += 4;
      }

      if (bone.flags & 0x0400) { // Fixed axis
        this.offset += 12; // Axis direction vec3
      }

      if (bone.flags & 0x0800) { // Local coordinate
        const localX = convertLeftHandedPositionToRightHanded([
          this.view.getFloat32(this.offset, true),
          this.view.getFloat32(this.offset + 4, true),
          this.view.getFloat32(this.offset + 8, true),
        ]); this.offset += 12;
        const localZ = convertLeftHandedPositionToRightHanded([
          this.view.getFloat32(this.offset, true),
          this.view.getFloat32(this.offset + 4, true),
          this.view.getFloat32(this.offset + 8, true),
        ]); this.offset += 12;

        // localY = localZ x localX
        bone.localX = localX;
        bone.localZ = localZ;
        bone.localY = [
            localZ[1] * localX[2] - localZ[2] * localX[1],
            localZ[2] * localX[0] - localZ[0] * localX[2],
            localZ[0] * localX[1] - localZ[1] * localX[0]
        ];
      }

      if (bone.flags & 0x2000) { // External parent deform
        this.readIndex(this.config.boneIndexSize);
      }

      if (bone.flags & 0x0020) { // IK
        const ik = {};
        ik.targetIndex = this.readIndex(this.config.boneIndexSize);
        ik.loopCount = this.view.getInt32(this.offset, true); this.offset += 4;
        ik.limitAngle = this.view.getFloat32(this.offset, true); this.offset += 4;
        const linkCount = this.view.getInt32(this.offset, true); this.offset += 4;
        ik.links = [];
        for (let j = 0; j < linkCount; j++) {
          const link = {};
          link.boneIndex = this.readIndex(this.config.boneIndexSize);
          link.hasLimit = this.view.getUint8(this.offset++);
          if (link.hasLimit === 1) {
            link.limitMin = [this.view.getFloat32(this.offset, true), this.view.getFloat32(this.offset + 4, true), this.view.getFloat32(this.offset + 8, true)]; this.offset += 12;
            link.limitMax = [this.view.getFloat32(this.offset, true), this.view.getFloat32(this.offset + 4, true), this.view.getFloat32(this.offset + 8, true)]; this.offset += 12;
          }
          ik.links.push(link);
        }
        bone.ik = ik;
      }
      bones.push(bone);
    }

    // 7. Morphs
    this.checkBounds(4, "morphCount");
    const morphCount = this.view.getInt32(this.offset, true);
    this.offset += 4;
    const morphs = [];
    for (let i = 0; i < morphCount; i++) {
      const morph = {};
      morph.name = this.readText(`morph[${i}].name`);
      morph.nameEn = this.readText(`morph[${i}].nameEn`);
      this.checkBounds(2 + 4, `morph[${i}].header`);
      morph.panelType = this.view.getUint8(this.offset++);
      morph.type = this.view.getUint8(this.offset++);
      const offsetCount = this.view.getInt32(this.offset, true); this.offset += 4;
      morph.offsets = [];
      for (let j = 0; j < offsetCount; j++) {
        if (morph.type === 0) { // Group
          morph.offsets.push({ index: this.readIndex(this.config.morphIndexSize), influence: this.view.getFloat32(this.offset, true) }); this.offset += 4;
        } else if (morph.type === 1) { // Vertex
          morph.offsets.push({
            index: this.readIndex(this.config.vertexIndexSize, true),
            position: convertLeftHandedPositionToRightHanded([
              this.view.getFloat32(this.offset, true),
              this.view.getFloat32(this.offset + 4, true),
              this.view.getFloat32(this.offset + 8, true),
            ]),
          }); this.offset += 12;
        } else if (morph.type === 2) { // Bone
          morph.offsets.push({
            index: this.readIndex(this.config.boneIndexSize),
            translation: convertLeftHandedPositionToRightHanded([
              this.view.getFloat32(this.offset, true),
              this.view.getFloat32(this.offset + 4, true),
              this.view.getFloat32(this.offset + 8, true),
            ]),
            rotation: convertLeftHandedQuaternionToRightHanded([
              this.view.getFloat32(this.offset + 12, true),
              this.view.getFloat32(this.offset + 16, true),
              this.view.getFloat32(this.offset + 20, true),
              this.view.getFloat32(this.offset + 24, true),
            ]),
          }); this.offset += 28;
        } else if (morph.type >= 3 && morph.type <= 7) { // UV
          morph.offsets.push({ index: this.readIndex(this.config.vertexIndexSize, true), floats: [this.view.getFloat32(this.offset, true), this.view.getFloat32(this.offset + 4, true), this.view.getFloat32(this.offset + 8, true), this.view.getFloat32(this.offset + 12, true)] }); this.offset += 16;
        } else if (morph.type === 8) { // Material
          const offset = {};
          offset.index = this.readIndex(this.config.materialIndexSize);
          offset.operationType = this.view.getUint8(this.offset++);
          offset.diffuse = [this.view.getFloat32(this.offset, true), this.view.getFloat32(this.offset + 4, true), this.view.getFloat32(this.offset + 8, true), this.view.getFloat32(this.offset + 12, true)]; this.offset += 16;
          offset.specular = [this.view.getFloat32(this.offset, true), this.view.getFloat32(this.offset + 4, true), this.view.getFloat32(this.offset + 8, true)]; this.offset += 12;
          offset.specularity = this.view.getFloat32(this.offset, true); this.offset += 4;
          offset.ambient = [this.view.getFloat32(this.offset, true), this.view.getFloat32(this.offset + 4, true), this.view.getFloat32(this.offset + 8, true)]; this.offset += 12;
          offset.edgeColor = [this.view.getFloat32(this.offset, true), this.view.getFloat32(this.offset + 4, true), this.view.getFloat32(this.offset + 8, true), this.view.getFloat32(this.offset + 12, true)]; this.offset += 16;
          offset.edgeSize = this.view.getFloat32(this.offset, true); this.offset += 4;
          offset.textureTint = [this.view.getFloat32(this.offset, true), this.view.getFloat32(this.offset + 4, true), this.view.getFloat32(this.offset + 8, true), this.view.getFloat32(this.offset + 12, true)]; this.offset += 16;
          offset.environmentTint = [this.view.getFloat32(this.offset, true), this.view.getFloat32(this.offset + 4, true), this.view.getFloat32(this.offset + 8, true), this.view.getFloat32(this.offset + 12, true)]; this.offset += 16;
          offset.toonTint = [this.view.getFloat32(this.offset, true), this.view.getFloat32(this.offset + 4, true), this.view.getFloat32(this.offset + 8, true), this.view.getFloat32(this.offset + 12, true)]; this.offset += 16;
          morph.offsets.push(offset);
        } else if (morph.type === 9) { // Flip
          morph.offsets.push({ index: this.readIndex(this.config.morphIndexSize), influence: this.view.getFloat32(this.offset, true) }); this.offset += 4;
        } else if (morph.type === 10) { // Impulse
          this.readIndex(this.config.rigidbodyIndexSize); this.offset += 25; // Skip impulse morph details for now
        }
      }
      morphs.push(morph);
    }

    // 8. Displayframes
    this.checkBounds(4, "displayFrameCount");
    const displayFrameCount = this.view.getInt32(this.offset, true);
    this.offset += 4;
    const displayFrames = [];
    for (let i = 0; i < displayFrameCount; i++) {
      const displayFrame = {};
      displayFrame.name = this.readText(`displayFrame[${i}].name`);
      displayFrame.nameEn = this.readText(`displayFrame[${i}].nameEn`);
      displayFrame.specialFlag = this.view.getUint8(this.offset++);
      const frameCount = this.view.getInt32(this.offset, true);
      this.offset += 4;
      displayFrame.frames = [];
      for (let j = 0; j < frameCount; j++) {
        const type = this.view.getUint8(this.offset++);
        const index = this.readIndex(type === 0 ? this.config.boneIndexSize : this.config.morphIndexSize);
        displayFrame.frames.push({ type, index });
      }
      displayFrames.push(displayFrame);
    }

    // 9. Rigid Bodies
    this.checkBounds(4, "rigidBodyCount");
    const rigidBodyCount = this.view.getInt32(this.offset, true);
    this.offset += 4;
    const rigidBodies = [];
    for (let i = 0; i < rigidBodyCount; i++) {
      const rb = {};
      rb.name = this.readText(`rigidBody[${i}].name`);
      rb.nameEn = this.readText(`rigidBody[${i}].nameEn`);
      rb.boneIndex = this.readIndex(this.config.boneIndexSize);
      this.checkBounds(1 + 2 + 1 + 12 + 12 + 12 + 4 + 4 + 4 + 4 + 4 + 1, `rigidBody[${i}].data`);
      rb.groupId = this.view.getUint8(this.offset++);
      rb.collisionMask = this.view.getUint16(this.offset, true);
      this.offset += 2;
      rb.shape = this.view.getUint8(this.offset++);
      rb.size = [this.view.getFloat32(this.offset, true), this.view.getFloat32(this.offset + 4, true), this.view.getFloat32(this.offset + 8, true)]; this.offset += 12;
      rb.position = convertLeftHandedPositionToRightHanded([
        this.view.getFloat32(this.offset, true),
        this.view.getFloat32(this.offset + 4, true),
        this.view.getFloat32(this.offset + 8, true),
      ]); this.offset += 12;
      rb.rotation = convertLeftHandedEulerToRightHanded([
        this.view.getFloat32(this.offset, true),
        this.view.getFloat32(this.offset + 4, true),
        this.view.getFloat32(this.offset + 8, true),
      ]); this.offset += 12;
      rb.mass = this.view.getFloat32(this.offset, true); this.offset += 4;
      rb.moveAttenuation = this.view.getFloat32(this.offset, true); this.offset += 4;
      rb.rotationDamping = this.view.getFloat32(this.offset, true); this.offset += 4;
      rb.repulsion = this.view.getFloat32(this.offset, true); this.offset += 4;
      rb.friction = this.view.getFloat32(this.offset, true); this.offset += 4;
      rb.physicsMode = this.view.getUint8(this.offset++);
      rigidBodies.push(rb);
    }

    // 10. Joints
    this.checkBounds(4, "jointCount");
    const jointCount = this.view.getInt32(this.offset, true);
    this.offset += 4;
    const joints = [];
    for (let i = 0; i < jointCount; i++) {
      const joint = {};
      joint.name = this.readText(`joint[${i}].name`);
      joint.nameEn = this.readText(`joint[${i}].nameEn`);
      this.checkBounds(1, `joint[${i}].type`);
      joint.type = this.view.getUint8(this.offset++);
      joint.rigidBodyIndexA = this.readIndex(this.config.rigidbodyIndexSize);
      joint.rigidBodyIndexB = this.readIndex(this.config.rigidbodyIndexSize);
      this.checkBounds(12 * 8, `joint[${i}].data`);
      joint.position = convertLeftHandedPositionToRightHanded([
        this.view.getFloat32(this.offset, true),
        this.view.getFloat32(this.offset + 4, true),
        this.view.getFloat32(this.offset + 8, true),
      ]); this.offset += 12;
      joint.rotation = convertLeftHandedEulerToRightHanded([
        this.view.getFloat32(this.offset, true),
        this.view.getFloat32(this.offset + 4, true),
        this.view.getFloat32(this.offset + 8, true),
      ]); this.offset += 12;
      
      const p1 = [this.view.getFloat32(this.offset, true), this.view.getFloat32(this.offset + 4, true), this.view.getFloat32(this.offset + 8, true)]; this.offset += 12;
      const p2 = [this.view.getFloat32(this.offset, true), this.view.getFloat32(this.offset + 4, true), this.view.getFloat32(this.offset + 8, true)]; this.offset += 12;
      const r1 = [this.view.getFloat32(this.offset, true), this.view.getFloat32(this.offset + 4, true), this.view.getFloat32(this.offset + 8, true)]; this.offset += 12;
      const r2 = [this.view.getFloat32(this.offset, true), this.view.getFloat32(this.offset + 4, true), this.view.getFloat32(this.offset + 8, true)]; this.offset += 12;

      // Swap and negate for Z-axis in translation
      joint.posMin = [p1[0], p1[1], -Math.max(p1[2], p2[2])];
      joint.posMax = [p2[0], p2[1], -Math.min(p1[2], p2[2])];
      
      // Swap and negate for X, Y axes in rotation (MMD to Bullet RH)
      joint.rotMin = [-Math.max(r1[0], r2[0]), -Math.max(r1[1], r2[1]), Math.min(r1[2], r2[2])];
      joint.rotMax = [-Math.min(r1[0], r2[0]), -Math.min(r1[1], r2[1]), Math.max(r1[2], r2[2])];

      joint.posSpring = [this.view.getFloat32(this.offset, true), this.view.getFloat32(this.offset + 4, true), this.view.getFloat32(this.offset + 8, true)]; this.offset += 12;
      joint.rotSpring = [this.view.getFloat32(this.offset, true), this.view.getFloat32(this.offset + 4, true), this.view.getFloat32(this.offset + 8, true)]; this.offset += 12;
      joints.push(joint);
    }

    // 11. Soft Bodies (PMX 2.1)
    if (version >= 2.1) {
      this.checkBounds(4, "softBodyCount");
      const softBodyCount = this.view.getInt32(this.offset, true);
      this.offset += 4;
      // Skip soft bodies for now as they are complex and not required for the current task
      console.warn("Soft bodies are present but skipped in this version of the loader.");
    }

    const ik = [];
    for (let i = 0; i < bones.length; i++) {
      if (bones[i].ik) {
        ik.push({
          boneIndex: i,
          targetBoneIndex: bones[i].ik.targetIndex,
          loopCount: bones[i].ik.loopCount,
          limitAngle: bones[i].ik.limitAngle,
          links: bones[i].ik.links
        });
      }
    }

    return { magic: 'Pmx', vertices, indices, textures, materials, bones, ik, morphs, displayFrames, rigidBodies, joints, name: modelName, nameEn: modelNameEn, comment: comment, commentEn: commentEn, weightTypes, vertexCount, version, config: this.config, configSize, configData };
  }

  readString(len) {
    const chars = new Uint8Array(this.view.buffer, this.view.byteOffset + this.offset, len);
    this.offset += len;
    return new TextDecoder().decode(chars);
  }

  readText(context = "unknown") {
    if (this.offset + 4 > this.view.byteLength) return "";
    const len = this.view.getUint32(this.offset, true);
    this.offset += 4;
    if (len === 0) return "";
    if (this.offset + len > this.view.byteLength) {
      console.error(`Invalid text length ${len} at offset ${this.offset} (context: ${context})`);
      return "";
    }
    const chars = new Uint8Array(this.view.buffer, this.view.byteOffset + this.offset, len);
    this.offset += len;
    const decoder = this.config.encoding === 0 ? new TextDecoder("utf-16le") : new TextDecoder("utf-8");
    return decoder.decode(chars);
  }

  readIndex(size, isUnsigned = false) {
    let index;
    if (size === 1) {
      this.checkBounds(1);
      index = isUnsigned ? this.view.getUint8(this.offset++) : this.view.getInt8(this.offset++);
    } else if (size === 2) {
      this.checkBounds(2);
      index = isUnsigned ? this.view.getUint16(this.offset, true) : this.view.getInt16(this.offset, true);
      this.offset += 2;
    } else if (size === 4) {
      this.checkBounds(4);
      index = this.view.getInt32(this.offset, true);
      this.offset += 4;
    }
    if (index === undefined) return -1;
    return index;
  }
}
