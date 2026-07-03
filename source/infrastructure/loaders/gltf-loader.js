import { DoubleSide, Matrix3, Vector3 } from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { createGltfAnimationSources } from '../animation/gltf-animation.js';

const DEFAULT_MODEL_NAME = 'glTF Model';

/**
 * glTF 2.0 を OpenMMD の内部モデルへ変換します。
 */
export class GLTFModelLoader {
  /**
   * @param {object|null} [options={}] - ローダー設定。
   * @param {boolean} [options.allowUnsupportedSkins=false] - スキン付きメッシュを許可するかどうか。
   */
  constructor(options = {}) {
    this.options = {
      allowUnsupportedSkins: false,
      addVrmAllParentBone: false,
      addVrmHelperBones: false,
      ...options,
    };
    this.loader = new GLTFLoader();
  }

  /**
   * glTF/glb ファイルを URL から読み込みます。
   * @param {string} url - 読み込み先。
   * @param {object|null} [fileProvider=null] - ZIP 内ファイル解決ヘルパー。
   * @returns {Promise<object>} 変換済みモデル。
   */
  async load(url, fileProvider = null) {
    const response = await fetch(encodeURI(url));
    if (!response.ok) {
      throw new Error(`Failed to load glTF: ${response.status} ${response.statusText} (${url})`);
    }

    if (isGlbUrl(url)) {
      return await this.parse(await response.arrayBuffer(), url, fileProvider);
    }

    return await this.parse(await response.text(), url, fileProvider);
  }

  /**
   * glTF/glb のバッファまたは JSON テキストを変換します。
   * @param {ArrayBuffer|string} input - 入力データ。
   * @param {string} [sourcePath=''] - 元ファイル名または URL。
   * @param {object|null} [fileProvider=null] - ZIP 内ファイル解決ヘルパー。
   * @returns {Promise<object>} 変換済みモデル。
   */
  async parse(input, sourcePath = '', fileProvider = null) {
    const normalizedInput = typeof input === 'string'
      ? await this._rewriteGltfTextIfNeeded(input, sourcePath, fileProvider)
      : await this._rewriteBinaryGltfIfNeeded(input, sourcePath, fileProvider);
    const resourcePath = getResourcePath(sourcePath);
    const gltf = await parseThreeGltf(this.loader, normalizedInput, resourcePath);
    return await this._convertSceneToModel(gltf, sourcePath);
  }

  /**
   * glTF JSON を ZIP 内参照向けに書き換えます。
   * @param {string} text - glTF JSON。
   * @param {string} sourcePath - 元ファイル名。
   * @param {object|null} fileProvider - ZIP 内ファイル解決ヘルパー。
   * @returns {Promise<string>} 書き換え済み JSON。
   */
  async _rewriteGltfTextIfNeeded(text, sourcePath, fileProvider) {
    if (!fileProvider || !isGltfUrl(sourcePath)) {
      return text;
    }

    const gltf = JSON.parse(text);
    const changed = await rewriteExternalGltfResources(gltf, fileProvider);
    return changed ? JSON.stringify(gltf) : text;
  }

  /**
   * GLB/VRM を ZIP 内参照向けに書き換えます。
   * @param {ArrayBuffer} input - GLB/VRM バイナリ。
   * @param {string} sourcePath - 元ファイル名。
   * @param {object|null} fileProvider - ZIP 内ファイル解決ヘルパー。
   * @returns {Promise<ArrayBuffer>} 書き換え済みバイナリ。
   */
  async _rewriteBinaryGltfIfNeeded(input, sourcePath, fileProvider) {
    if (!fileProvider || !isBinaryGltfUrl(sourcePath)) {
      return input;
    }

    const gltf = parseGlbJson(input);
    const changed = await rewriteExternalGltfResources(gltf, fileProvider);
    if (!changed) {
      return input;
    }

    return rebuildGlb(input, JSON.stringify(gltf));
  }

  /**
   * glTF シーンを内部モデルへ変換します。
   * @param {object} gltf - Three.js が解釈した glTF。
   * @param {string} sourcePath - 元ファイル名または URL。
   * @returns {object} OpenMMD モデル。
   */
  async _convertSceneToModel(gltf, sourcePath) {
    const scene = gltf?.scene || gltf?.scenes?.[0] || null;
    if (!scene) {
      throw new Error('glTF scene is missing.');
    }

    scene.updateMatrixWorld(true);

    const model = createEmptyModel(getModelName(gltf, sourcePath));
    const gltfJson = gltf?.parser?.json || null;
    const bones = buildBonesFromScene(scene, gltf?.parser?.associations || null);
    const normalizedBones = normalizeBonesForModel(bones, gltfJson, this.options);
    const boneIndexByObject = new Map(normalizedBones.map((bone, index) => [bone.object, index]));
    const textureDisplayPaths = [];
    const textureSourcePaths = [];
    const textureIndexBySource = new Map();
    const modelTextureIndexByGltfTextureIndex = new Map();
    const vertices = [];
    const indices = [];
    const materials = [];
    const primitivePromises = [];
    const associations = gltf?.parser?.associations || null;
    const meshPrimitiveIndexMap = new Map();

    scene.traverse((object) => {
      if (!object?.isMesh) {
        return;
      }

      const geometry = object.geometry;
      if (!geometry?.getAttribute?.('position')) {
        return;
      }

      const primitiveMaterials = Array.isArray(object.material) ? object.material : [object.material];
      const groups = Array.isArray(geometry.groups) && geometry.groups.length > 0
        ? geometry.groups
        : [{ materialIndex: 0, start: 0, count: geometry.index ? geometry.index.count : geometry.getAttribute('position').count }];
      const primitiveStartIndex = meshPrimitiveIndexMap.get(object) || 0;

      groups.forEach((group, groupIndex) => {
        const material = primitiveMaterials[group.materialIndex] || primitiveMaterials[0] || null;
        primitivePromises.push(
          this._convertPrimitive(
            object,
            geometry,
            group,
            primitiveStartIndex + groupIndex,
            material,
            textureDisplayPaths,
            textureSourcePaths,
            textureIndexBySource,
            boneIndexByObject,
            gltfJson,
            associations,
            modelTextureIndexByGltfTextureIndex,
          ),
        );
      });
      meshPrimitiveIndexMap.set(object, primitiveStartIndex + groups.length);
    });

    const primitiveGroups = (await Promise.all(primitivePromises)).filter((primitive) => primitive);
    let vertexOffset = 0;
    const morphTargetOffsets = Object.create(null);
    for (const primitive of primitiveGroups) {
      for (let i = 0; i < primitive.vertices.length; i++) {
        vertices.push(primitive.vertices[i]);
      }
      for (const index of primitive.indices) {
        indices.push(index + vertexOffset);
      }
      for (const morphTarget of primitive.morphTargets || []) {
        const keys = [
          `${morphTarget.nodeIndex}:${morphTarget.targetIndex}`,
          Number.isInteger(morphTarget.meshIndex) ? `mesh:${morphTarget.meshIndex}:${morphTarget.targetIndex}` : '',
        ].filter((key) => key);
        for (const offset of morphTarget.offsets || []) {
          for (const key of keys) {
            if (!Array.isArray(morphTargetOffsets[key])) {
              morphTargetOffsets[key] = [];
            }
            morphTargetOffsets[key].push({
              index: vertexOffset + offset.index,
              position: Array.isArray(offset.position) ? [...offset.position] : [0, 0, 0],
            });
          }
        }
      }
      vertexOffset += primitive.vertexCount;
      materials.push(primitive.material);
    }

    model.vertices = new Float32Array(vertices);
    model.indices = vertexOffset > 65535 ? new Uint32Array(indices) : new Uint16Array(indices);
    model.vertexCount = vertexOffset;
    model.materials = materials;
    model.textures = textureDisplayPaths;
    model.textureSources = textureSourcePaths;
    if (normalizedBones.length > 0) {
      model.bones = normalizedBones.map(({ object, ...bone }) => bone);
      model.hasDummyBone = false;
      model.dummyBoneIndex = -1;
    } else {
      model.bones = [createDummyBone()];
      model.hasDummyBone = true;
      model.dummyBoneIndex = 0;
    }
    model.ik = [];
    model.iks = [];
    model.morphs = [];
    model.faces = [];
    model.displayFrames = [];
    model.rigidBodies = [];
    model.joints = [];
    model.toonTextures = [];
    model.gltfAnimationSources = createGltfAnimationSources(gltf, model);
    model.gltfAssetContext = {
      scene,
      gltfJson: gltf?.parser?.json || null,
      modelTextureIndexByGltfTextureIndex: Object.fromEntries(modelTextureIndexByGltfTextureIndex),
      morphTargetOffsets,
    };

    return model;
  }

  /**
   * 単一 primitive を OpenMMD 頂点/材質へ変換します。
   * @param {object} mesh - Three.js Mesh。
   * @param {object} geometry - BufferGeometry。
   * @param {object} group - プリミティブ範囲。
   * @param {object|null} material - Three.js material。
   * @param {Array<string>} textureDisplayPaths - 表示用 texture 一覧。
   * @param {Array<string>} textureSourcePaths - 実ロード用 texture 一覧。
   * @param {Map<string, number>} textureIndexBySource - テクスチャ索引。
   * @param {Map<object, number>} boneIndexByObject - glTF Bone から内部 bone index への変換表。
   * @returns {{vertices: Array<number>, indices: Array<number>, vertexCount: number, material: object}|null} 変換結果。
   */
  async _convertPrimitive(
    mesh,
    geometry,
    group,
    primitiveIndex,
    material,
    textureDisplayPaths,
    textureSourcePaths,
    textureIndexBySource,
    boneIndexByObject,
    gltfJson = null,
    associations = null,
    modelTextureIndexByGltfTextureIndex = null,
  ) {
    if (!Number.isInteger(primitiveIndex)) {
      const legacyMaterial = primitiveIndex;
      const legacyTextureDisplayPaths = material;
      const legacyTextureSourcePaths = textureDisplayPaths;
      const legacyTextureIndexBySource = textureSourcePaths;
      const legacyBoneIndexByObject = textureIndexBySource;
      const legacyGltfJson = boneIndexByObject;
      const legacyAssociations = gltfJson;
      const legacyModelTextureIndexByGltfTextureIndex = associations;

      material = legacyMaterial;
      textureDisplayPaths = legacyTextureDisplayPaths;
      textureSourcePaths = legacyTextureSourcePaths;
      textureIndexBySource = legacyTextureIndexBySource;
      boneIndexByObject = legacyBoneIndexByObject;
      gltfJson = legacyGltfJson;
      associations = legacyAssociations;
      modelTextureIndexByGltfTextureIndex = legacyModelTextureIndexByGltfTextureIndex;
      primitiveIndex = 0;
    }

    const positionAttr = geometry.getAttribute('position');
    const normalAttr = geometry.getAttribute('normal');
    const uvAttr = geometry.getAttribute('uv');
    const skinIndexAttr = mesh.isSkinnedMesh ? geometry.getAttribute('skinIndex') : null;
    const skinWeightAttr = mesh.isSkinnedMesh ? geometry.getAttribute('skinWeight') : null;
    const indexAttr = geometry.index;
    const vertexCount = positionAttr.count;
    if (vertexCount <= 0) {
      return null;
    }

    const normalMatrix = new Matrix3().getNormalMatrix(mesh.matrixWorld);
    const morphPositionMatrix = new Matrix3().setFromMatrix4(mesh.matrixWorld);
    const vertices = [];
    const indices = [];
    const morphTargets = collectPrimitiveMorphTargets(
      geometry,
      mesh,
      morphPositionMatrix,
      gltfJson,
      associations,
      primitiveIndex,
    );
    const tempPosition = new Vector3();
    const tempNormal = new Vector3();

    for (let i = 0; i < vertexCount; i++) {
      tempPosition.set(positionAttr.getX(i), positionAttr.getY(i), positionAttr.getZ(i)).applyMatrix4(mesh.matrixWorld);
      if (normalAttr) {
        tempNormal.set(normalAttr.getX(i), normalAttr.getY(i), normalAttr.getZ(i)).applyMatrix3(normalMatrix).normalize();
      } else {
        tempNormal.set(0, 1, 0);
      }

      const u = uvAttr ? uvAttr.getX(i) : 0;
      const v = uvAttr ? uvAttr.getY(i) : 0;
      const skinningData = mesh.isSkinnedMesh
        ? getSkinningVertexData(mesh, i, skinIndexAttr, skinWeightAttr, boneIndexByObject)
        : getStaticSkinningVertexData();

      vertices.push(
        tempPosition.x, tempPosition.y, tempPosition.z,
        tempNormal.x, tempNormal.y, tempNormal.z,
        u, v,
        skinningData.boneIndices[0], skinningData.boneIndices[1], skinningData.boneIndices[2], skinningData.boneIndices[3],
        skinningData.boneWeights[0], skinningData.boneWeights[1], skinningData.boneWeights[2], skinningData.boneWeights[3],
        skinningData.weightType,
        skinningData.sdefC[0], skinningData.sdefC[1], skinningData.sdefC[2],
        skinningData.sdefR0[0], skinningData.sdefR0[1], skinningData.sdefR0[2],
        skinningData.sdefR1[0], skinningData.sdefR1[1], skinningData.sdefR1[2],
        1,
      );
    }

    const start = group.start || 0;
    const end = start + (group.count || 0);
    if (indexAttr) {
      for (let i = start; i < end; i++) {
        indices.push(indexAttr.getX(i));
      }
    } else {
      for (let i = start; i < end; i++) {
        indices.push(i);
      }
    }

    const sourceMaterial = material || {};
    const sourceMaterialAssociation = associations?.get?.(sourceMaterial) || null;
    const textureSource = getMaterialBaseColorTexture(sourceMaterial);
    const textureIndex = textureSource
      ? await registerTexture(
        textureSource,
        textureDisplayPaths,
        textureSourcePaths,
        textureIndexBySource,
        gltfJson,
        associations,
        modelTextureIndexByGltfTextureIndex,
      )
      : -1;
    const emissiveTextureSource = getMaterialEmissiveTexture(sourceMaterial);
    const emissiveTextureIndex = emissiveTextureSource
      ? await registerTexture(
        emissiveTextureSource,
        textureDisplayPaths,
        textureSourcePaths,
        textureIndexBySource,
        gltfJson,
        associations,
        modelTextureIndexByGltfTextureIndex,
      )
      : -1;

    return {
      vertices,
      indices,
      vertexCount,
      morphTargets,
      material: {
        name: sourceMaterial.name || mesh.name || `Material ${textureIndexBySource.size + 1}`,
        nameEn: '',
        shaderName: 'gltf-shader.wgsl',
        diffuse: getMaterialColor(sourceMaterial),
        ambient: [0, 0, 0],
        specular: [0, 0, 0],
        shininess: 0,
        metalic: getMaterialMetallic(sourceMaterial),
        roughness: getMaterialRoughness(sourceMaterial),
        emissive: getMaterialEmissive(sourceMaterial),
        emissiveStrength: getMaterialEmissiveStrength(sourceMaterial),
        emissiveSource: emissiveTextureIndex >= 0 ? 'texture' : 'color',
        emissiveTexture: emissiveTextureIndex >= 0
          ? {
              kind: 'path',
              path: textureDisplayPaths[emissiveTextureIndex],
              colorSpace: 'gamma-2.2',
            }
          : { kind: 'none' },
        edgeColor: [0, 0, 0, 1],
        edgeSize: 1,
        textureIndex,
        sphereIndex: -1,
        sphereMode: 0,
        toonMode: 0,
        toonIndex: -1,
        memo: '',
        indexCount: indices.length,
        hasEdge: false,
        drawShadow: true,
        noCull: sourceMaterial.side === DoubleSide,
        receiveShadow: true,
        alphaMode: getMaterialAlphaMode(sourceMaterial),
        gltfMaterialIndex: Number.isInteger(sourceMaterialAssociation?.materials)
          ? sourceMaterialAssociation.materials
          : -1,
        sortIndex: Number.isInteger(sourceMaterialAssociation?.materials)
          ? sourceMaterialAssociation.materials
          : -1,
      },
    };
  }
}

/**
 * primitive の morph target 位置差分を収集します。
 * @param {object} geometry - BufferGeometry。
 * @param {object} mesh - Three.js Mesh。
 * @param {object} morphPositionMatrix - morph 変位へ適用する行列。
 * @param {object|null} gltfJson - glTF JSON。
 * @param {object|null} associations - Three.js parser associations。
 * @param {number} primitiveIndex - glTF primitive index。
 * @returns {Array<object>} primitive morph target 一覧。
 */
function collectPrimitiveMorphTargets(geometry, mesh, morphPositionMatrix, gltfJson, associations, primitiveIndex) {
  const morphPositionAttributes = Array.isArray(geometry?.morphAttributes?.position)
    ? geometry.morphAttributes.position
    : [];
  if (morphPositionAttributes.length === 0) {
    return [];
  }

  const meshAssociation = associations?.get?.(mesh) || null;
  const nodeIndex = Number.isInteger(meshAssociation?.nodes) ? meshAssociation.nodes : -1;
  const meshIndex = Number.isInteger(meshAssociation?.meshes) ? meshAssociation.meshes : -1;
  if (nodeIndex < 0 && meshIndex < 0) {
    return [];
  }

  const meshDef = resolveGltfMeshDefinition(gltfJson, meshAssociation);
  const primitiveDef = Array.isArray(meshDef?.primitives) ? meshDef.primitives[primitiveIndex] || null : null;
  const primitiveTargets = Array.isArray(primitiveDef?.targets) ? primitiveDef.targets : [];
  const result = [];
  const tempDelta = new Vector3();

  for (let targetIndex = 0; targetIndex < morphPositionAttributes.length; targetIndex++) {
    if (!primitiveTargets[targetIndex]) {
      continue;
    }
    const attribute = morphPositionAttributes[targetIndex];
    if (!attribute || attribute.count <= 0) {
      continue;
    }

    const offsets = [];
    for (let vertexIndex = 0; vertexIndex < attribute.count; vertexIndex++) {
      tempDelta.set(attribute.getX(vertexIndex), attribute.getY(vertexIndex), attribute.getZ(vertexIndex));
      tempDelta.applyMatrix3(morphPositionMatrix);
      if (tempDelta.lengthSq() <= 1e-12) {
        continue;
      }
      offsets.push({
        index: vertexIndex,
        position: [tempDelta.x, tempDelta.y, tempDelta.z],
      });
    }

    result.push({
      nodeIndex,
      meshIndex,
      targetIndex,
      offsets,
    });
  }

  return result;
}

/**
 * Three.js association から glTF mesh 定義を解決します。
 * @param {object|null} gltfJson - glTF JSON。
 * @param {object|null} meshAssociation - Three.js association。
 * @returns {object|null} glTF mesh 定義。
 */
function resolveGltfMeshDefinition(gltfJson, meshAssociation) {
  const meshIndex = Number.isInteger(meshAssociation?.meshes) ? meshAssociation.meshes : -1;
  if (meshIndex < 0 || !Array.isArray(gltfJson?.meshes)) {
    return null;
  }
  return gltfJson.meshes[meshIndex] || null;
}

/**
 * glTF scene から bone 定義を構築します。
 * @param {object} scene - glTF scene。
 * @returns {Array<object>} bone 定義。
 */
function buildBonesFromScene(scene, associations = null) {
  const boneObjects = [];
  scene.traverse((object) => {
    if (object?.isBone) {
      boneObjects.push(object);
    }
  });

  if (boneObjects.length === 0) {
    return [];
  }

  const boneIndexByObject = new Map();
  for (let i = 0; i < boneObjects.length; i++) {
    boneIndexByObject.set(boneObjects[i], i);
  }

  const bones = [];
  const tempPosition = new Vector3();
  const tempAxisX = new Vector3();
  const tempAxisY = new Vector3();
  const tempAxisZ = new Vector3();
  const tempTail = new Vector3();

  for (let i = 0; i < boneObjects.length; i++) {
    const object = boneObjects[i];
    const parentBone = findParentBone(object.parent, boneIndexByObject);
    const parentIndex = parentBone ? boneIndexByObject.get(parentBone) ?? -1 : -1;
    const childBone = findFirstChildBone(object, boneIndexByObject);
    const association = associations?.get?.(object) || null;

    object.getWorldPosition(tempPosition);
    tempAxisX.set(1, 0, 0).applyQuaternion(object.quaternion).normalize();
    tempAxisY.set(0, 1, 0).applyQuaternion(object.quaternion).normalize();
    tempAxisZ.set(0, 0, 1).applyQuaternion(object.quaternion).normalize();

    const bone = {
      object,
      name: object.name || `Bone ${i + 1}`,
      nameEn: '',
      parentIndex,
      transformLevel: parentIndex >= 0 ? (bones[parentIndex]?.transformLevel ?? 0) + 1 : 0,
      type: 0,
      gltfNodeIndex: Number.isInteger(association?.nodes) ? association.nodes : -1,
      position: [tempPosition.x, tempPosition.y, tempPosition.z],
      localX: [tempAxisX.x, tempAxisX.y, tempAxisX.z],
      localY: [tempAxisY.x, tempAxisY.y, tempAxisY.z],
      localZ: [tempAxisZ.x, tempAxisZ.y, tempAxisZ.z],
      flags: 0x0002 | 0x0004 | 0x0008,
      inheritParentIndex: -1,
      inheritInfluence: 0,
      ikTargetIndex: -1,
    };

    if (childBone) {
      bone.tailIndex = boneIndexByObject.get(childBone) ?? -1;
      bone.flags |= 0x0001;
    } else {
      if (parentIndex >= 0) {
        tempTail.set(
          tempPosition.x - bones[parentIndex].position[0],
          tempPosition.y - bones[parentIndex].position[1],
          tempPosition.z - bones[parentIndex].position[2],
        );
      } else {
        tempTail.copy(tempAxisY);
      }

      if (tempTail.lengthSq() <= 1e-8) {
        tempTail.copy(tempAxisY);
      }
      if (tempTail.lengthSq() <= 1e-8) {
        tempTail.set(0, 1, 0);
      }

      bone.tailOffset = [tempTail.x, tempTail.y, tempTail.z];
    }

    bones.push(bone);
  }

  return bones;
}

/**
 * 読み込みオプションに応じて bone 一覧を正規化します。
 * @param {Array<object>} bones - 既存ボーン一覧。
 * @param {object|null} gltfJson - glTF JSON。
 * @param {object|null} options - ローダー設定。
 * @returns {Array<object>} 正規化後のボーン一覧。
 */
function normalizeBonesForModel(bones, gltfJson, options) {
  if (!Array.isArray(bones) || bones.length === 0) {
    return bones;
  }

  if (options?.addVrmHelperBones) {
    return insertVrmHelperBones(bones, gltfJson);
  }

  if (options?.addVrmAllParentBone) {
    return insertVrmAllParentBone(bones);
  }

  return bones;
}

/**
 * VRM 用の補助ボーンを追加します。
 * @param {Array<object>} bones - 既存ボーン一覧。
 * @param {object|null} gltfJson - glTF JSON。
 * @returns {Array<object>} 追加後のボーン一覧。
 */
function insertVrmHelperBones(bones, gltfJson) {
  const withAllParent = insertVrmAllParentBone(bones);
  return insertVrmLowerBodyBone(withAllParent, gltfJson);
}

/**
 * VRM 用に「全ての親」ボーンを先頭へ追加します。
 * @param {Array<object>} bones - 既存ボーン一覧。
 * @returns {Array<object>} 追加後のボーン一覧。
 */
function insertVrmAllParentBone(bones) {
  if (!Array.isArray(bones) || bones.length === 0) {
    return bones;
  }

  const existingAllParentIndex = bones.findIndex((bone) => String(bone?.name || '').trim() === '全ての親');
  if (existingAllParentIndex >= 0 && bones[existingAllParentIndex]?.parentIndex === -1) {
    return bones;
  }

  const allParentBone = {
    name: '全ての親',
    nameEn: '',
    parentIndex: -1,
    transformLevel: 0,
    type: 0,
    gltfNodeIndex: -1,
    position: [0, 0, 0],
    localX: [1, 0, 0],
    localY: [0, 1, 0],
    localZ: [0, 0, 1],
    flags: 0x0002 | 0x0004 | 0x0008,
    inheritParentIndex: -1,
    inheritInfluence: 0,
    ikTargetIndex: -1,
    baseRotationQuaternion: [0, 0, 0, 1],
  };

  const shiftedBones = bones.map((bone) => cloneBoneForVrmInsertion(bone));
  for (const bone of shiftedBones) {
    if (bone.parentIndex === -1) {
      bone.parentIndex = 0;
    } else if (Number.isInteger(bone.parentIndex) && bone.parentIndex >= 0) {
      bone.parentIndex += 1;
    }
    if (Number.isInteger(bone.tailIndex) && bone.tailIndex >= 0) {
      bone.tailIndex += 1;
    }
    if (Number.isInteger(bone.inheritParentIndex) && bone.inheritParentIndex >= 0) {
      bone.inheritParentIndex += 1;
    }
    if (Number.isInteger(bone.ikTargetIndex) && bone.ikTargetIndex >= 0) {
      bone.ikTargetIndex += 1;
    }
    bone.transformLevel = (Number(bone.transformLevel) || 0) + 1;
  }

  return [allParentBone, ...shiftedBones];
}

/**
 * VRM 用に「下半身」ボーンを追加します。
 * @param {Array<object>} bones - 既存ボーン一覧。
 * @param {object|null} gltfJson - glTF JSON。
 * @returns {Array<object>} 追加後のボーン一覧。
 */
function insertVrmLowerBodyBone(bones, gltfJson) {
  if (!Array.isArray(bones) || bones.length === 0) {
    return bones;
  }

  const existingLowerBodyIndex = bones.findIndex((bone) => String(bone?.name || '').trim() === '下半身');
  if (existingLowerBodyIndex >= 0) {
    return bones;
  }

  const hipsNodeIndex = findVrmHumanBoneNodeIndex(gltfJson, 'hips');
  const spineNodeIndex = findVrmHumanBoneNodeIndex(gltfJson, 'spine');
  if (hipsNodeIndex < 0 || spineNodeIndex < 0) {
    return bones;
  }

  const hipsIndex = bones.findIndex((bone) => bone?.gltfNodeIndex === hipsNodeIndex);
  const spineIndex = bones.findIndex((bone) => bone?.gltfNodeIndex === spineNodeIndex);
  if (hipsIndex < 0 || spineIndex < 0 || hipsIndex === spineIndex) {
    return bones;
  }

  const insertIndex = hipsIndex + 1;
  const shiftedBones = bones.map((bone) => shiftBoneIndicesForInsertedBone(cloneBoneForVrmInsertion(bone), insertIndex));
  const shiftedSpineIndex = shiftBoneIndexForInsertion(spineIndex, insertIndex);
  const lowerBodyIndex = insertIndex;
  const lowerBodyBone = {
    name: '下半身',
    nameEn: '',
    parentIndex: hipsIndex,
    transformLevel: 0,
    type: 0,
    gltfNodeIndex: -1,
    position: Array.isArray(shiftedBones[spineIndex]?.position) ? [...shiftedBones[spineIndex].position] : [0, 0, 0],
    localX: [1, 0, 0],
    localY: [0, 1, 0],
    localZ: [0, 0, 1],
    flags: 0x0002 | 0x0004 | 0x0008,
    inheritParentIndex: -1,
    inheritInfluence: 0,
    ikTargetIndex: -1,
  };
  const normalizedBones = [
    ...shiftedBones.slice(0, insertIndex),
    lowerBodyBone,
    ...shiftedBones.slice(insertIndex),
  ];

  for (let index = 0; index < normalizedBones.length; index++) {
    const bone = normalizedBones[index];
    if (!bone || index === lowerBodyIndex || index === shiftedSpineIndex) {
      continue;
    }
    if (bone.parentIndex === hipsIndex) {
      bone.parentIndex = lowerBodyIndex;
    }
  }

  const lowerBodyChildIndices = findDirectChildBoneIndices(normalizedBones, lowerBodyIndex);
  if (lowerBodyChildIndices.length > 0) {
    lowerBodyBone.tailIndex = lowerBodyChildIndices[0];
    lowerBodyBone.flags |= 0x0001;
  } else {
    lowerBodyBone.tailOffset = [0, 1, 0];
  }

  recomputeBoneTransformLevels(normalizedBones);
  return normalizedBones;
}

/**
 * glTF JSON から VRM humanoid bone の node index を返します。
 * @param {object|null} gltfJson - glTF JSON。
 * @param {string} boneName - VRM humanoid bone 名。
 * @returns {number} node index。見つからない場合は -1。
 */
function findVrmHumanBoneNodeIndex(gltfJson, boneName) {
  const targetName = String(boneName || '').trim();
  if (!gltfJson || !targetName) {
    return -1;
  }

  const humanoid = gltfJson?.extensions?.VRMC_vrm?.humanoid || gltfJson?.extensions?.VRM?.humanoid || null;
  const humanBones = getVrmHumanBones(humanoid);
  for (const humanBone of humanBones) {
    const humanBoneName = String(humanBone?.boneName || humanBone?.bone || '').trim();
    if (humanBoneName !== targetName) {
      continue;
    }
    return Number.isInteger(humanBone?.node) ? humanBone.node : -1;
  }

  return -1;
}

/**
 * VRM humanoid の humanBones 一覧を標準化します。
 * @param {object|Array<object>|null} humanoid - VRM humanoid 情報。
 * @returns {Array<object>} humanBones 一覧。
 */
function getVrmHumanBones(humanoid) {
  if (!humanoid || typeof humanoid !== 'object') {
    return [];
  }

  if (Array.isArray(humanoid.humanBones)) {
    return humanoid.humanBones;
  }

  if (humanoid.humanBones && typeof humanoid.humanBones === 'object') {
    return Object.entries(humanoid.humanBones).map(([boneName, value]) => ({
      boneName,
      ...value,
    }));
  }

  return [];
}

/**
 * 指定 index へ bone を挿入する際の index シフトを返します。
 * @param {number} index - 元 index。
 * @param {number} insertIndex - 挿入位置。
 * @returns {number} シフト後 index。
 */
function shiftBoneIndexForInsertion(index, insertIndex) {
  if (!Number.isInteger(index) || index < 0) {
    return index;
  }
  return index >= insertIndex ? index + 1 : index;
}

/**
 * 指定 index へ bone を挿入する際に参照 index を更新します。
 * @param {object} bone - 更新対象ボーン。
 * @param {number} insertIndex - 挿入位置。
 * @returns {object} 更新後ボーン。
 */
function shiftBoneIndicesForInsertedBone(bone, insertIndex) {
  bone.parentIndex = shiftBoneIndexForInsertion(bone.parentIndex, insertIndex);
  if (Number.isInteger(bone.tailIndex) && bone.tailIndex >= 0) {
    bone.tailIndex = shiftBoneIndexForInsertion(bone.tailIndex, insertIndex);
  }
  if (Number.isInteger(bone.inheritParentIndex) && bone.inheritParentIndex >= 0) {
    bone.inheritParentIndex = shiftBoneIndexForInsertion(bone.inheritParentIndex, insertIndex);
  }
  if (Number.isInteger(bone.ikTargetIndex) && bone.ikTargetIndex >= 0) {
    bone.ikTargetIndex = shiftBoneIndexForInsertion(bone.ikTargetIndex, insertIndex);
  }
  return bone;
}

/**
 * 指定 bone の直下の子 index 一覧を返します。
 * @param {Array<object>} bones - ボーン一覧。
 * @param {number} parentIndex - 親 index。
 * @returns {Array<number>} 直下の子 index 一覧。
 */
function findDirectChildBoneIndices(bones, parentIndex) {
  const childIndices = [];
  for (let index = 0; index < bones.length; index++) {
    if (bones[index]?.parentIndex === parentIndex) {
      childIndices.push(index);
    }
  }
  return childIndices;
}

/**
 * parentIndex に基づいて transformLevel を再計算します。
 * @param {Array<object>} bones - ボーン一覧。
 */
function recomputeBoneTransformLevels(bones) {
  const resolvedLevels = new Array(bones.length).fill(null);

  /**
   * @param {number} boneIndex - 対象 index。
   * @returns {number} transformLevel。
   */
  function resolveTransformLevel(boneIndex) {
    if (!Number.isInteger(boneIndex) || boneIndex < 0 || boneIndex >= bones.length) {
      return 0;
    }
    if (resolvedLevels[boneIndex] !== null) {
      return resolvedLevels[boneIndex];
    }

    const bone = bones[boneIndex];
    const parentIndex = Number.isInteger(bone?.parentIndex) ? bone.parentIndex : -1;
    const level = parentIndex >= 0 ? resolveTransformLevel(parentIndex) + 1 : 0;
    resolvedLevels[boneIndex] = level;
    if (bone && typeof bone === 'object') {
      bone.transformLevel = level;
    }
    return level;
  }

  for (let index = 0; index < bones.length; index++) {
    resolveTransformLevel(index);
  }
}

/**
 * VRM 用 helper bone 追加で使う bone 情報を複製します。
 * @param {object} bone - 元ボーン。
 * @returns {object} 複製後ボーン。
 */
function cloneBoneForVrmInsertion(bone) {
  return {
    ...bone,
    position: Array.isArray(bone?.position) ? [...bone.position] : [0, 0, 0],
    localX: Array.isArray(bone?.localX) ? [...bone.localX] : [1, 0, 0],
    localY: Array.isArray(bone?.localY) ? [...bone.localY] : [0, 1, 0],
    localZ: Array.isArray(bone?.localZ) ? [...bone.localZ] : [0, 0, 1],
    baseRotationQuaternion: Array.isArray(bone?.baseRotationQuaternion) ? [...bone.baseRotationQuaternion] : bone?.baseRotationQuaternion,
    tailOffset: Array.isArray(bone?.tailOffset) ? [...bone.tailOffset] : bone?.tailOffset,
  };
}

/**
 * 親 bone を探します。
 * @param {object|null} object - 親候補。
 * @param {Map<object, number>} boneIndexByObject - bone 索引。
 * @returns {object|null} 親 bone。
 */
function findParentBone(object, boneIndexByObject) {
  let current = object || null;
  while (current) {
    if (boneIndexByObject.has(current)) {
      return current;
    }
    current = current.parent || null;
  }

  return null;
}

/**
 * 直下の子 bone を探します。
 * @param {object} object - bone ノード。
 * @param {Map<object, number>} boneIndexByObject - bone 索引。
 * @returns {object|null} 子 bone。
 */
function findFirstChildBone(object, boneIndexByObject) {
  if (!object?.children) {
    return null;
  }

  for (const child of object.children) {
    if (boneIndexByObject.has(child)) {
      return child;
    }
  }

  return null;
}

/**
 * 静的メッシュ用の既定 skinning データを返します。
 * @returns {{boneIndices: number[], boneWeights: number[], weightType: number, sdefC: number[], sdefR0: number[], sdefR1: number[]}} skinning データ。
 */
function getStaticSkinningVertexData() {
  return {
    boneIndices: [0, 0, 0, 0],
    boneWeights: [1, 0, 0, 0],
    weightType: 0,
    sdefC: [0, 0, 0],
    sdefR0: [0, 0, 0],
    sdefR1: [0, 0, 0],
  };
}

/**
 * glTF の skin 属性を OpenMMD の vertex layout に変換します。
 * @param {object} mesh - SkinnedMesh。
 * @param {number} vertexIndex - 頂点 index。
 * @param {object|null} skinIndexAttr - skinIndex 属性。
 * @param {object|null} skinWeightAttr - skinWeight 属性。
 * @param {Map<object, number>} boneIndexByObject - bone 索引。
 * @returns {{boneIndices: number[], boneWeights: number[], weightType: number, sdefC: number[], sdefR0: number[], sdefR1: number[]}} 変換結果。
 */
function getSkinningVertexData(mesh, vertexIndex, skinIndexAttr, skinWeightAttr, boneIndexByObject) {
  if (!skinIndexAttr || !skinWeightAttr || !mesh?.skeleton?.bones?.length) {
    return getStaticSkinningVertexData();
  }

  const influences = [];
  for (let component = 0; component < 4; component++) {
    const weight = readSkinAttributeComponent(skinWeightAttr, vertexIndex, component);
    if (!Number.isFinite(weight) || weight <= 0) {
      continue;
    }

    const sourceIndex = readSkinAttributeComponent(skinIndexAttr, vertexIndex, component);
    const skeletonBone = mesh.skeleton.bones[sourceIndex];
    const modelBoneIndex = skeletonBone ? boneIndexByObject.get(skeletonBone) : undefined;
    if (!Number.isInteger(modelBoneIndex) || modelBoneIndex < 0) {
      continue;
    }

    influences.push({ boneIndex: modelBoneIndex, weight });
  }

  if (influences.length === 0) {
    return getStaticSkinningVertexData();
  }

  influences.sort((a, b) => b.weight - a.weight);
  const normalized = normalizeSkinningInfluences(influences);
  if (normalized.length === 0) {
    return getStaticSkinningVertexData();
  }

  const boneIndices = [0, 0, 0, 0];
  const boneWeights = [0, 0, 0, 0];
  for (let i = 0; i < normalized.length; i++) {
    boneIndices[i] = normalized[i].boneIndex;
    boneWeights[i] = normalized[i].weight;
  }

  return {
    boneIndices,
    boneWeights,
    weightType: normalized.length === 1 ? 0 : normalized.length === 2 ? 1 : 2,
    sdefC: [0, 0, 0],
    sdefR0: [0, 0, 0],
    sdefR1: [0, 0, 0],
  };
}

/**
 * skin 属性の特定要素を返します。
 * @param {object} attribute - attribute。
 * @param {number} index - 頂点 index。
 * @param {number} component - 要素番号。
 * @returns {number} 要素値。
 */
function readSkinAttributeComponent(attribute, index, component) {
  if (!attribute) {
    return 0;
  }

  if (component === 0 && typeof attribute.getX === 'function') {
    return attribute.getX(index);
  }
  if (component === 1 && typeof attribute.getY === 'function') {
    return attribute.getY(index);
  }
  if (component === 2 && typeof attribute.getZ === 'function') {
    return attribute.getZ(index);
  }
  if (component === 3 && typeof attribute.getW === 'function') {
    return attribute.getW(index);
  }

  return 0;
}

/**
 * skinning 影響を正規化します。
 * @param {Array<{boneIndex: number, weight: number}>} influences - 影響一覧。
 * @returns {Array<{boneIndex: number, weight: number}>} 正規化済み影響一覧。
 */
function normalizeSkinningInfluences(influences) {
  const result = influences.slice(0, 4);
  const totalWeight = result.reduce((sum, influence) => sum + influence.weight, 0);
  if (totalWeight <= 0) {
    return [];
  }

  for (const influence of result) {
    influence.weight /= totalWeight;
  }

  return result;
}

/**
 * glTF 用の空モデルを作成します。
 * @param {string} name - モデル名。
 * @returns {object} 空モデル。
 */
function createEmptyModel(name) {
  return {
    magic: 'Gltf',
    name,
    nameEn: '',
    comment: '',
    commentEn: '',
    vertices: new Float32Array(0),
    indices: new Uint16Array(0),
    materials: [],
    textures: [],
    textureSources: [],
    bones: [createDummyBone()],
    ik: [],
    iks: [],
    morphs: [],
    faces: [],
    displayFrames: [],
    rigidBodies: [],
    joints: [],
    toonTextures: [],
    vertexCount: 0,
    hasDummyBone: true,
    dummyBoneIndex: 0,
  };
}

/**
 * glTF マテリアルの metallic factor を取得します。
 * @param {object} material - 元のマテリアル。
 * @returns {number} metallic factor。
 */
function getMaterialMetallic(material) {
  const metalness = Number(material?.metalness);
  if (Number.isFinite(metalness)) {
    return clamp01(metalness);
  }
  return 0.0;
}

/**
 * glTF マテリアルの roughness factor を取得します。
 * @param {object} material - 元のマテリアル。
 * @returns {number} roughness factor。
 */
function getMaterialRoughness(material) {
  const roughness = Number(material?.roughness);
  if (Number.isFinite(roughness)) {
    return clamp01(roughness);
  }
  return 1.0;
}

/**
 * glTF マテリアルの emissive 色を取得します。
 * @param {object} material - 元のマテリアル。
 * @returns {number[]} emissive RGB。
 */
function getMaterialEmissive(material) {
  const emissive = material?.emissive;
  const r = getColorComponent(emissive, 'r');
  const g = getColorComponent(emissive, 'g');
  const b = getColorComponent(emissive, 'b');
  return [clamp01(r), clamp01(g), clamp01(b)];
}

/**
 * glTF マテリアルの emissive 強度を取得します。
 * @param {object} material - 元のマテリアル。
 * @returns {number} emissive strength。
 */
function getMaterialEmissiveStrength(material) {
  const intensity = Number(material?.emissiveIntensity);
  return Number.isFinite(intensity) ? Math.max(intensity, 0.0) : 0.0;
}

/**
 * 値を 0..1 に丸めます。
 * @param {number} value - 入力値。
 * @returns {number} 0..1 の値。
 */
function clamp01(value) {
  return Math.min(Math.max(Number(value) || 0, 0), 1);
}

/**
 * THREE.Color 互換の色から成分を取得します。
 * @param {object|null} color - 色オブジェクト。
 * @param {'r'|'g'|'b'} key - 成分名。
 * @returns {number} 成分値。
 */
function getColorComponent(color, key) {
  if (color && Number.isFinite(Number(color[key]))) {
    return Number(color[key]);
  }
  return 0.0;
}

/**
 * ダミー骨を作成します。
 * @returns {object} 骨データ。
 */
function createDummyBone() {
  return {
    name: 'Root',
    nameEn: '',
    parentIndex: -1,
    transformLevel: 0,
    type: 0,
    position: [0, 0, 0],
    localX: [1, 0, 0],
    localY: [0, 1, 0],
    localZ: [0, 0, 1],
    flags: 0x0002 | 0x0004 | 0x0008,
    inheritParentIndex: -1,
    inheritInfluence: 0,
    ikTargetIndex: -1,
  };
}

/**
 * Three.js 側で glTF を非同期パースします。
 * @param {GLTFLoader} loader - Three.js GLTFLoader。
 * @param {ArrayBuffer|string} input - 入力データ。
 * @param {string} resourcePath - 外部資源の基準パス。
 * @returns {Promise<object>} Three.js の glTF 解析結果。
 */
function parseThreeGltf(loader, input, resourcePath) {
  return new Promise((resolve, reject) => {
    loader.parse(input, resourcePath, resolve, reject);
  });
}

/**
 * GLB/VRM の JSON を取り出します。
 * @param {ArrayBuffer} input - GLB/VRM バイナリ。
 * @returns {object} glTF JSON。
 */
function parseGlbJson(input) {
  const jsonChunk = parseGlbChunks(input).find((chunk) => chunk.type === 'JSON');
  if (!jsonChunk) {
    throw new Error('GLB JSON chunk is missing.');
  }

  const jsonText = new TextDecoder('utf-8').decode(jsonChunk.data);
  return JSON.parse(jsonText.trimEnd());
}

/**
 * GLB/VRM のチャンク一覧を読み込みます。
 * @param {ArrayBuffer} input - GLB/VRM バイナリ。
 * @returns {Array<{type: string, data: Uint8Array}>} チャンク一覧。
 */
function parseGlbChunks(input) {
  const view = new DataView(input);
  const magic = readAscii(input, 0, 4);
  if (magic !== 'glTF') {
    throw new Error('GLB file is not a valid container.');
  }

  const version = view.getUint32(4, true);
  if (version !== 2) {
    throw new Error(`Unsupported GLB version: ${version}`);
  }

  const chunks = [];
  let offset = 12;
  while (offset + 8 <= input.byteLength) {
    const chunkLength = view.getUint32(offset, true);
    const chunkType = readAscii(input, offset + 4, 4);
    const dataStart = offset + 8;
    const dataEnd = dataStart + chunkLength;
    if (dataEnd > input.byteLength) {
      break;
    }

    chunks.push({
      type: chunkType,
      data: new Uint8Array(input.slice(dataStart, dataEnd)),
    });
    offset = dataEnd;
  }

  return chunks;
}

/**
 * GLB/VRM を再構築します。
 * @param {ArrayBuffer} input - 元バイナリ。
 * @param {string} jsonText - 新しい JSON テキスト。
 * @returns {ArrayBuffer} 再構築済みバイナリ。
 */
function rebuildGlb(input, jsonText) {
  const chunks = parseGlbChunks(input);
  const encodedChunks = chunks.map((chunk) => (
    chunk.type === 'JSON'
      ? createGlbChunk('JSON', new TextEncoder().encode(jsonText), 0x20)
      : createGlbChunk(chunk.type, chunk.data, 0x00)
  ));
  const totalLength = 12 + encodedChunks.reduce((sum, chunk) => sum + chunk.byteLength, 0);
  const output = new ArrayBuffer(totalLength);
  const view = new DataView(output);
  const bytes = new Uint8Array(output);

  writeAscii(bytes, 0, 'glTF');
  view.setUint32(4, 2, true);
  view.setUint32(8, totalLength, true);

  let offset = 12;
  for (const chunk of encodedChunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }

  return output;
}

/**
 * GLB チャンクを構築します。
 * @param {string} type - チャンク種別。
 * @param {Uint8Array} data - チャンクデータ。
 * @param {number} padByte - パディングに使うバイト値。
 * @returns {Uint8Array} エンコード済みチャンク。
 */
function createGlbChunk(type, data, padByte) {
  const padding = (4 - (data.byteLength % 4)) % 4;
  const chunkLength = data.byteLength + padding;
  const chunk = new Uint8Array(8 + chunkLength);
  const view = new DataView(chunk.buffer);
  view.setUint32(0, chunkLength, true);
  writeAscii(chunk, 4, type);
  chunk.set(data, 8);
  if (padding > 0) {
    chunk.fill(padByte, 8 + data.byteLength);
  }
  return chunk;
}

/**
 * ASCII 文字列を書き込みます。
 * @param {Uint8Array} target - 書き込み先。
 * @param {number} offset - 開始位置。
 * @param {string} value - ASCII 文字列。
 */
function writeAscii(target, offset, value) {
  for (let i = 0; i < value.length; i++) {
    target[offset + i] = value.charCodeAt(i) & 0xFF;
  }
}

/**
 * ArrayBuffer から ASCII 文字列を読み込みます。
 * @param {ArrayBuffer} input - バイナリ。
 * @param {number} offset - 開始位置。
 * @param {number} length - 長さ。
 * @returns {string} ASCII 文字列。
 */
function readAscii(input, offset, length) {
  return new TextDecoder('ascii').decode(new Uint8Array(input, offset, length));
}

/**
 * glTF JSON の外部リソース参照を data URI に置き換えます。
 * @param {object} gltf - glTF JSON。
 * @param {object} fileProvider - ZIP 内ファイル解決ヘルパー。
 * @returns {Promise<boolean>} 変更があれば true。
 */
async function rewriteExternalGltfResources(gltf, fileProvider) {
  let changed = false;
  changed = await rewriteExternalGltfResourceList(gltf?.buffers, fileProvider) || changed;
  changed = await rewriteExternalGltfResourceList(gltf?.images, fileProvider) || changed;
  return changed;
}

/**
 * 外部リソース参照を data URI に置き換えます。
 * @param {Array<object>|undefined|null} entries - glTF エントリ一覧。
 * @param {object} fileProvider - ZIP 内ファイル解決ヘルパー。
 * @returns {Promise<boolean>} 変更があれば true。
 */
async function rewriteExternalGltfResourceList(entries, fileProvider) {
  if (!Array.isArray(entries) || entries.length === 0) {
    return false;
  }

  let changed = false;
  for (const entry of entries) {
    if (!entry?.uri || isDataUri(entry.uri)) {
      continue;
    }

    const blob = await fileProvider.getFile(entry.uri);
    if (!blob) {
      continue;
    }

    entry.extras = {
      ...(entry.extras || {}),
      __openmmdOriginalUri: entry.uri,
    };
    entry.uri = await blobToDataUri(blob, guessMimeType(entry.uri, blob.type));
    changed = true;
  }

  return changed;
}

/**
 * glTF のリソース基準パスを返します。
 * @param {string} sourcePath - 元ファイル名または URL。
 * @returns {string} リソース基準パス。
 */
function getResourcePath(sourcePath) {
  const normalized = normalizePath(sourcePath);
  const lastIndex = normalized.lastIndexOf('/');
  if (lastIndex === -1) {
    return '';
  }
  return normalized.substring(0, lastIndex + 1);
}

/**
 * モデル名を決定します。
 * @param {object} gltf - Three.js の glTF 解析結果。
 * @param {string} sourcePath - 元ファイル名または URL。
 * @returns {string} モデル名。
 */
function getModelName(gltf, sourcePath) {
  const sceneName = gltf?.scene?.name || gltf?.scenes?.[0]?.name || '';
  if (sceneName) {
    return sceneName;
  }

  const modelName = stripExtension(getFileName(sourcePath));
  return modelName || DEFAULT_MODEL_NAME;
}

/**
 * glTF の baseColorTexture を返します。
 * @param {object} material - Three.js material。
 * @returns {object|null} テクスチャ。
 */
function getMaterialBaseColorTexture(material) {
  return material?.map || null;
}

/**
 * glTF の emissiveTexture を返します。
 * @param {object} material - Three.js material。
 * @returns {object|null} テクスチャ。
 */
function getMaterialEmissiveTexture(material) {
  return material?.emissiveMap || null;
}

/**
 * glTF 材質の色を返します。
 * @param {object} material - Three.js material。
 * @returns {number[]} RGBA。
 */
function getMaterialColor(material) {
  const color = material?.color;
  const opacity = Number.isFinite(material?.opacity) ? material.opacity : 1;
  if (color && typeof color.toArray === 'function') {
    return [color.r, color.g, color.b, opacity];
  }
  return [1, 1, 1, opacity];
}

/**
 * glTF 材質の alpha モードを返します。
 * @param {object} material - Three.js material。
 * @returns {'opaque'|'cutout'|'transparent'} alpha モード。
 */
function getMaterialAlphaMode(material) {
  const alphaMode = String(material?.alphaMode || '').toLowerCase();
  if (alphaMode === 'mask') {
    return 'cutout';
  }
  if (alphaMode === 'blend' || material?.transparent) {
    return 'transparent';
  }
  if (Number.isFinite(material?.opacity) && material.opacity < 1) {
    return 'transparent';
  }
  if (Number.isFinite(material?.alphaTest) && material.alphaTest > 0) {
    return 'cutout';
  }
  return 'opaque';
}

/**
 * テクスチャをモデル内参照へ登録します。
 * @param {object} texture - Three.js texture。
 * @param {Array<string>} textures - テクスチャ一覧。
 * @param {Map<string, number>} textureIndexBySource - テクスチャ索引。
 * @returns {number} テクスチャ番号。
 */
async function registerTexture(
  texture,
  textureDisplayPaths,
  textureSourcePaths,
  textureIndexBySource,
  gltfJson = null,
  associations = null,
  modelTextureIndexByGltfTextureIndex = null,
) {
  const textureSource = await textureToSourceUrl(texture);
  if (!textureSource) {
    return -1;
  }

  const sourceAssociation = associations?.get?.(texture) || null;
  const texturePaths = resolveGltfTexturePaths(gltfJson, sourceAssociation, textureSource);
  const sourcePath = texturePaths.sourcePath || textureSource;
  const displayPath = texturePaths.displayPath || sourcePath;

  if (!textureIndexBySource.has(sourcePath)) {
    textureIndexBySource.set(sourcePath, textureDisplayPaths.length);
    textureDisplayPaths.push(displayPath);
    textureSourcePaths.push(sourcePath);
  }

  const internalTextureIndex = textureIndexBySource.get(sourcePath) ?? -1;
  if (
    modelTextureIndexByGltfTextureIndex
    && Number.isInteger(sourceAssociation?.textures)
    && internalTextureIndex >= 0
  ) {
    modelTextureIndexByGltfTextureIndex.set(sourceAssociation.textures, internalTextureIndex);
  }

  return internalTextureIndex;
}

/**
 * glTF の texture/source から表示用・実ロード用パスを解決します。
 * @param {object|null} gltfJson - glTF JSON。
 * @param {object|null} textureAssociation - texture の association。
 * @param {string} fallbackPath - 代替パス。
 * @returns {{displayPath: string, sourcePath: string}} 解決結果。
 */
function resolveGltfTexturePaths(gltfJson, textureAssociation, fallbackPath) {
  const gltfTextureIndex = Number.isInteger(textureAssociation?.textures) ? textureAssociation.textures : -1;
  const textureDef = gltfTextureIndex >= 0 && Array.isArray(gltfJson?.textures)
    ? gltfJson.textures[gltfTextureIndex] || null
    : null;
  const sourceIndex = Number.isInteger(textureDef?.source) ? textureDef.source : -1;
  const imageDef = sourceIndex >= 0 && Array.isArray(gltfJson?.images)
    ? gltfJson.images[sourceIndex] || null
    : null;
  const originalUri = String(imageDef?.extras?.__openmmdOriginalUri || '').trim();
  const imageName = String(imageDef?.name || '').trim();
  const textureName = String(textureDef?.name || '').trim();
  const fallbackDisplayPath = gltfTextureIndex >= 0 ? `Texture ${gltfTextureIndex + 1}` : 'Texture';
  const displayPath = originalUri || imageName || textureName || (!isDataUri(fallbackPath) ? fallbackPath : fallbackDisplayPath);
  const sourcePath = originalUri || String(imageDef?.uri || '').trim() || fallbackPath;

  return {
    displayPath: displayPath || fallbackPath,
    sourcePath: sourcePath || fallbackPath,
  };
}

/**
 * テクスチャから参照可能な URL を作成します。
 * @param {object} texture - Three.js texture。
 * @returns {Promise<string|null>} URL。
 */
async function textureToSourceUrl(texture) {
  const source = texture?.source?.data || texture?.image || null;
  if (!source) {
    return null;
  }

  if (typeof source === 'string') {
    return source;
  }

  if (typeof source.currentSrc === 'string' && source.currentSrc) {
    return source.currentSrc;
  }

  if (typeof source.src === 'string' && source.src) {
    return source.src;
  }

  if (isCanvasSource(source) && typeof source.toDataURL === 'function') {
    return source.toDataURL('image/png');
  }

  if (typeof source.width === 'number' && typeof source.height === 'number') {
    const canvas = createImageCanvas(source.width, source.height);
    if (!canvas) {
      return null;
    }

    const context = canvas.getContext('2d');
    if (!context) {
      return null;
    }

    context.drawImage(source, 0, 0);
    if (typeof canvas.convertToBlob === 'function') {
      const blob = await canvas.convertToBlob({ type: 'image/png' });
      return await blobToDataUri(blob, 'image/png');
    }
    if (typeof canvas.toDataURL === 'function') {
      return canvas.toDataURL('image/png');
    }
  }

  return null;
}

/**
 * 画像描画用キャンバスを作成します。
 * @param {number} width - 幅。
 * @param {number} height - 高さ。
 * @returns {OffscreenCanvas|HTMLCanvasElement|null} キャンバス。
 */
function createImageCanvas(width, height) {
  if (typeof OffscreenCanvas !== 'undefined') {
    return new OffscreenCanvas(width, height);
  }
  if (typeof document !== 'undefined') {
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    return canvas;
  }
  return null;
}

/**
 * Canvas 系ソースかどうかを判定します。
 * @param {object} source - 判定対象。
 * @returns {boolean} Canvas 系なら true。
 */
function isCanvasSource(source) {
  return typeof HTMLCanvasElement !== 'undefined' && source instanceof HTMLCanvasElement
    || typeof OffscreenCanvas !== 'undefined' && source instanceof OffscreenCanvas;
}

/**
 * Blob を data URI に変換します。
 * @param {Blob} blob - 対象 Blob。
 * @param {string} fallbackMimeType - MIME タイプ。
 * @returns {Promise<string>} data URI。
 */
async function blobToDataUri(blob, fallbackMimeType) {
  const arrayBuffer = await blob.arrayBuffer();
  const base64 = typeof Buffer !== 'undefined'
    ? Buffer.from(arrayBuffer).toString('base64')
    : arrayBufferToBase64(arrayBuffer);
  return `data:${blob.type || fallbackMimeType};base64,${base64}`;
}

/**
 * ArrayBuffer を base64 化します。
 * @param {ArrayBuffer} arrayBuffer - 対象データ。
 * @returns {string} base64 文字列。
 */
function arrayBufferToBase64(arrayBuffer) {
  const bytes = new Uint8Array(arrayBuffer);
  let binary = '';
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

/**
 * MIME タイプを推定します。
 * @param {string} path - ファイルパス。
 * @param {string} fallback - 既定 MIME。
 * @returns {string} MIME タイプ。
 */
function guessMimeType(path, fallback) {
  const lower = normalizePath(path).toLowerCase();
  if (lower.endsWith('.png')) return 'image/png';
  if (lower.endsWith('.jpg') || lower.endsWith('.jpeg')) return 'image/jpeg';
  if (lower.endsWith('.webp')) return 'image/webp';
  if (lower.endsWith('.bmp')) return 'image/bmp';
  if (lower.endsWith('.gif')) return 'image/gif';
  if (lower.endsWith('.tga')) return 'image/x-tga';
  if (lower.endsWith('.ktx2')) return 'image/ktx2';
  return fallback || 'application/octet-stream';
}

/**
 * URL が data URI かどうかを判定します。
 * @param {string} url - 判定対象。
 * @returns {boolean} data URI なら true。
 */
function isDataUri(url) {
  return typeof url === 'string' && url.startsWith('data:');
}

/**
 * glTF URL かどうかを判定します。
 * @param {string} url - 判定対象。
 * @returns {boolean} glTF なら true。
 */
function isGltfUrl(url) {
  const lower = normalizePath(url).toLowerCase();
  return lower.endsWith('.gltf');
}

/**
 * GLB URL かどうかを判定します。
 * @param {string} url - 判定対象。
 * @returns {boolean} GLB なら true。
 */
function isGlbUrl(url) {
  const lower = normalizePath(url).toLowerCase();
  return lower.endsWith('.glb');
}

/**
 * バイナリ glTF URL かどうかを判定します。
 * @param {string} url - 判定対象。
 * @returns {boolean} バイナリ glTF なら true。
 */
function isBinaryGltfUrl(url) {
  const lower = normalizePath(url).toLowerCase();
  return lower.endsWith('.glb') || lower.endsWith('.vrm');
}

/**
 * パスからファイル名を取得します。
 * @param {string} path - パス。
 * @returns {string} ファイル名。
 */
function getFileName(path) {
  const normalized = normalizePath(path);
  const index = normalized.lastIndexOf('/');
  return index === -1 ? normalized : normalized.substring(index + 1);
}

/**
 * 拡張子を除去します。
 * @param {string} name - ファイル名。
 * @returns {string} 拡張子なし文字列。
 */
function stripExtension(name) {
  const index = String(name || '').lastIndexOf('.');
  return index === -1 ? String(name || '') : String(name || '').substring(0, index);
}

/**
 * パス区切りを正規化します。
 * @param {string} path - パス。
 * @returns {string} 正規化済みパス。
 */
function normalizePath(path) {
  return String(path || '').replace(/\\/g, '/');
}
