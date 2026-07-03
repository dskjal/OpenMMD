import { mat4Vec4Mul, pushLineQuads } from '../shared/math/math-utils.js';
import { buildGizmoVertices, resolveGizmoPose, GIZMO_AXIS_COLORS } from '../core/selection/gizmo.js';
import { createCustomRigCircleVertices, getCustomRigCircleTargets } from '../core/model/custom-rig.js';
import { IK_TARGET_CUBE_HALF_EXTENT, getBoneDebugLists, getBoneTailPosition } from '../core/selection/bone-picking.js';
import { buildLightDirectionLineVertices, buildLightIconVertices } from '../core/scene/light-object.js';
import { createCameraEye } from '../core/scene/camera.js';
import { mat4, quat, vec3 } from '../lib/esm/index.js';
import { getSelectedBoneIndices, resolveSelectedBoneIndex } from '../core/selection/renderer-selection.js';
import { getDefaultsSnapshot } from '../infrastructure/config/defaults/defaults-manager.js';
import { AMMO_INV_LENGTH_SCALE } from '../core/physics/physics.js';

const LINEAR_COLOR_FORMAT = 'rgba16float';

const INDICATOR_BUFFER_SIZE = 2000 * 40;
const GRID_BUFFER_SIZE = 1024 * 1024;
const BONE_AXIS_LENGTH = 0.1;
const IK_TARGET_CUBE_RENDER_HALF_EXTENT = IK_TARGET_CUBE_HALF_EXTENT * 0.1;
const ACTIVE_BONE_COLOR = [1.0, 0.0, 0.0];
const MULTI_SELECTED_BONE_COLOR = [1.0, 0.4, 0.4];
export { IK_TARGET_CUBE_HALF_EXTENT, getBoneDebugLists, getBoneTailPosition } from '../core/selection/bone-picking.js';

/**
 * UI overlay 用パイプラインを作成します。
 * @param {object} manager - ModelManager インスタンス。
 * @returns {GPURenderPipeline} UI overlay パイプライン。
 */
export function createUiOverlayPipeline(manager) {
  if (typeof manager.device.createPipelineLayout !== 'function' || typeof manager.device.createRenderPipeline !== 'function') {
    return null;
  }

  return manager.device.createRenderPipeline({
    layout: manager.device.createPipelineLayout({
      bindGroupLayouts: [manager.globalResources.globalBindGroupLayout],
    }),
    vertex: {
      module: manager.shaderModule,
      entryPoint: 'vs_bone',
      buffers: [{
        arrayStride: 40,
        attributes: [
          { shaderLocation: 0, offset: 0, format: 'float32x3' },
          { shaderLocation: 1, offset: 12, format: 'float32x3' },
          { shaderLocation: 2, offset: 24, format: 'float32x3' },
          { shaderLocation: 3, offset: 36, format: 'float32' },
        ],
      }],
    },
    fragment: {
      module: manager.shaderModule,
      entryPoint: 'fs_bone',
      targets: [{ format: LINEAR_COLOR_FORMAT }],
    },
    primitive: { topology: 'triangle-list' },
    multisample: { count: manager.msaaSampleCount },
  });
}

/**
 * 床グリッド用パイプラインを作成します。
 * @param {object} manager - ModelManager インスタンス。
 * @returns {GPURenderPipeline} 床グリッドパイプライン。
 */
export function createGridOverlayPipeline(manager) {
  if (typeof manager.device.createPipelineLayout !== 'function' || typeof manager.device.createRenderPipeline !== 'function') {
    return null;
  }

  return manager.device.createRenderPipeline({
    layout: manager.device.createPipelineLayout({
      bindGroupLayouts: [manager.globalResources.globalBindGroupLayout],
    }),
    vertex: {
      module: manager.shaderModule,
      entryPoint: 'vs_grid',
      buffers: [{
        arrayStride: 40,
        attributes: [
          { shaderLocation: 0, offset: 0, format: 'float32x3' },
          { shaderLocation: 1, offset: 12, format: 'float32x3' },
          { shaderLocation: 2, offset: 24, format: 'float32x3' },
          { shaderLocation: 3, offset: 36, format: 'float32' },
        ],
      }],
    },
    fragment: {
      module: manager.shaderModule,
      entryPoint: 'fs_bone',
      targets: [{ format: LINEAR_COLOR_FORMAT }],
    },
    primitive: { topology: 'triangle-list' },
    multisample: { count: manager.msaaSampleCount },
  });
}

/**
 * ポストエフェクト後に床グリッドを描画するためのパイプラインを作成します。
 * @param {object} manager - ModelManager インスタンス。
 * @param {boolean} [multisampledDepth=true] - 深度を MSAA で参照するなら true。
 * @returns {GPURenderPipeline} 床グリッドパイプライン。
 */
export function createGridOverlayPostPipeline(manager, multisampledDepth = true) {
  if (typeof manager.device.createPipelineLayout !== 'function' || typeof manager.device.createRenderPipeline !== 'function') {
    return null;
  }

  const depthBindGroupLayout = manager.device.createBindGroupLayout({
    entries: [
      {
        binding: 0,
        visibility: GPUShaderStage.FRAGMENT,
        texture: { sampleType: 'depth', multisampled: multisampledDepth },
      },
    ],
  });
  const emptyBindGroupLayout = manager.device.createBindGroupLayout({ entries: [] });
  const fragmentEntryPoint = multisampledDepth ? 'fs_grid_post' : 'fs_grid_post_single';

  return manager.device.createRenderPipeline({
    layout: manager.device.createPipelineLayout({
      bindGroupLayouts: multisampledDepth
        ? [
          manager.globalResources.globalBindGroupLayout,
          depthBindGroupLayout,
        ]
        : [
          manager.globalResources.globalBindGroupLayout,
          emptyBindGroupLayout,
          emptyBindGroupLayout,
          depthBindGroupLayout,
        ],
    }),
    vertex: {
      module: manager.shaderModule,
      entryPoint: 'vs_grid',
      buffers: [{
        arrayStride: 40,
        attributes: [
          { shaderLocation: 0, offset: 0, format: 'float32x3' },
          { shaderLocation: 1, offset: 12, format: 'float32x3' },
          { shaderLocation: 2, offset: 24, format: 'float32x3' },
          { shaderLocation: 3, offset: 36, format: 'float32' },
        ],
      }],
    },
    fragment: {
      module: manager.shaderModule,
      entryPoint: fragmentEntryPoint,
      targets: [{ format: LINEAR_COLOR_FORMAT }],
    },
    primitive: { topology: 'triangle-list' },
    multisample: { count: manager.msaaSampleCount },
  });
}

/**
 * 床グリッド用の GPU 状態を作成します。
 * @param {GPUDevice} device - WebGPU デバイス。
 * @returns {object} 床グリッド状態。
 */
export function createGridOverlayState(device) {
  if (typeof GPUBufferUsage === 'undefined' || typeof device?.createBuffer !== 'function') {
    return {
      gridVertexBuffer: createFallbackVertexBuffer(),
      gridVertexCount: 0,
    };
  }

  return {
    gridVertexBuffer: device.createBuffer({
      size: GRID_BUFFER_SIZE,
      usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
    }),
    gridVertexCount: 0,
  };
}

/**
 * ボーン表示バッファを更新します。
 * @param {GPUDevice} device - WebGPU デバイス。
 * @param {object} model - モデルデータ。
 * @param {object} scene - シーン状態。
 * @param {object} selection - 現在の選択状態。
 * @param {boolean} isActive - アクティブモデルかどうか。
 * @param {boolen} showHiddenBones - IsVisible でないボーンを表示するかどうか。
 */
export function updateBoneLineBuffer(device, model, scene, selection, isActive, showHiddenBones=false) {
  const uiOverlay = getUiOverlayState(scene);
  const boneDebugLists = getBoneDebugLists(model, scene);
  const vertices = [];
  const selectedBoneIndex = Number.isInteger(selection?.activeBoneIndex) && selection.activeBoneIndex >= 0
    ? selection.activeBoneIndex
    : resolveSelectedBoneIndex({ scene }, selection);
  const selectedBoneIndices = new Set(getSelectedBoneIndices(selection, { scene }));
  const hideSpringBones = Boolean(selection?.hideSpringBones);
  const ikBoneIndices = new Set();
  if (model.ik) {
    for (const ik of model.ik) {
      if (!showHiddenBones && boneDebugLists.nonVisibleBoneIndexSet.has(ik.boneIndex)) {
        continue;
      }
      ikBoneIndices.add(ik.boneIndex);
      for (const link of ik.links) {
        ikBoneIndices.add(link.boneIndex);
      }
    }
  }

  const hideIk = Boolean(selection?.hideIkBones);
  for (let i = 0; i < scene.boneCount; i++) {
    if (!showHiddenBones && boneDebugLists.hiddenBoneIndexSet.has(i)) {
      continue;
    }
    if (hideSpringBones && boneDebugLists.springBoneBoneIndexSet?.has(i)) {
      continue;
    }

    if (hideIk && ikBoneIndices.has(i)) {
      continue;
    }

    const color = ikBoneIndices.has(i) ? [1.0, 0.5, 0.0] : [0.6, 0.8, 1.0];
    const startPos = scene.boneWorldPositions[i];
    const endPos = getBoneTailPosition(model, scene, i);
    if (endPos) {
      pushLineQuads(vertices, startPos, endPos, color);
    }

    if (!isActive || !selectedBoneIndices.has(i)) {
      continue;
    }

    if (endPos) {
      pushLineQuads(
        vertices,
        startPos,
        endPos,
        selectedBoneIndex === i ? ACTIVE_BONE_COLOR : MULTI_SELECTED_BONE_COLOR,
      );
    }
  }

  uiOverlay.boneLineVertexCount = vertices.length / 10;
  ensureLineBufferCapacity(device, uiOverlay, vertices.length * 4);
  if (uiOverlay.boneLineVertexCount > 0) {
    device.queue.writeBuffer(uiOverlay.boneLineVertexBuffer, 0, new Float32Array(vertices));
  }
}

/**
 * 可視ボーンの座標軸バッファを更新します。
 * @param {GPUDevice} device - WebGPU デバイス。
 * @param {object} model - モデルデータ。
 * @param {object} scene - シーン状態。
 * @param {object} selection - 現在の選択状態。
 * @param {boolean} isActive - アクティブモデルかどうか。
 * @param {boolean} [showHiddenBones=false] - IsVisible でないボーンを表示するかどうか。
 */
export function updateBoneAxisBuffer(device, model, scene, selection, isActive, showHiddenBones = false) {
  const uiOverlay = getUiOverlayState(scene);
  if (!uiOverlay?.boneAxisVertexBuffer) {
    return;
  }
  const boneDebugLists = getBoneDebugLists(model, scene);
  const vertices = [];
  const hideSpringBones = Boolean(selection?.hideSpringBones);
  const ikBoneIndices = new Set();
  if (model.ik) {
    for (const ik of model.ik) {
      if (!showHiddenBones && boneDebugLists.nonVisibleBoneIndexSet.has(ik.boneIndex)) {
        continue;
      }
      ikBoneIndices.add(ik.boneIndex);
      for (const link of ik.links) {
        ikBoneIndices.add(link.boneIndex);
      }
    }
  }

  const hideIk = Boolean(selection?.hideIkBones);
  for (let i = 0; i < scene.boneCount; i++) {
    if (!showHiddenBones && boneDebugLists.hiddenBoneIndexSet.has(i)) {
      continue;
    }
    if (hideSpringBones && boneDebugLists.springBoneBoneIndexSet?.has(i)) {
      continue;
    }

    if (hideIk && ikBoneIndices.has(i)) {
      continue;
    }

    const startPos = scene.boneWorldPositions?.[i];
    const transform = scene.boneLocalTransforms?.[i];
    if (!startPos || !transform) {
      continue;
    }

    const worldRotation = transform.worldRotation ?? [0, 0, 0, 1];
    const localX = transform.localX ?? [1, 0, 0];
    const localY = transform.localY ?? [0, 1, 0];
    const localZ = transform.localZ ?? [0, 0, 1];
    const axisX = vec3.transformQuat(vec3.create(), localX, worldRotation);
    const axisY = vec3.transformQuat(vec3.create(), localY, worldRotation);
    const axisZ = vec3.transformQuat(vec3.create(), localZ, worldRotation);

    pushLineQuads(vertices, startPos, vec3.scaleAndAdd(vec3.create(), startPos, axisX, BONE_AXIS_LENGTH), GIZMO_AXIS_COLORS.x);
    pushLineQuads(vertices, startPos, vec3.scaleAndAdd(vec3.create(), startPos, axisY, BONE_AXIS_LENGTH), GIZMO_AXIS_COLORS.y);
    pushLineQuads(vertices, startPos, vec3.scaleAndAdd(vec3.create(), startPos, axisZ, BONE_AXIS_LENGTH), GIZMO_AXIS_COLORS.z);
  }

  uiOverlay.boneAxisVertexCount = vertices.length / 10;
  ensureBoneAxisBufferCapacity(device, uiOverlay, vertices.length * 4);
  if (uiOverlay.boneAxisVertexCount > 0) {
    device.queue.writeBuffer(uiOverlay.boneAxisVertexBuffer, 0, new Float32Array(vertices));
  }
}

/**
 * インジケータバッファを更新します。
 * @param {GPUDevice} device - WebGPU デバイス。
 * @param {object} instance - モデルインスタンス。
 * @param {object} selection - 現在の選択状態。
 * @param {boolean} isActive - アクティブモデルかどうか。
 * @param {boolen} showHiddenBones - IsVisible でないボーンを表示するかどうか。
 */
export function updateIndicatorBuffer(device, instance, selection, isActive, showHiddenBones=false) {
  const { scene, model } = instance;
  const uiOverlay = getUiOverlayState(scene);
  const boneDebugLists = getBoneDebugLists(model, scene);
  const vertices = [];
  const hideIk = Boolean(selection?.hideIkBones);
  const selectedBoneIndex = Number.isInteger(selection?.activeBoneIndex) && selection.activeBoneIndex >= 0
    ? selection.activeBoneIndex
    : resolveSelectedBoneIndex(instance, selection);
  const selectedBoneIndices = new Set(getSelectedBoneIndices(selection, instance));

  if (isActive) {
    if (!hideIk) {
      for (let i = 0; i < scene.ikTargets.length; i++) {
        const target = scene.ikTargets[i];
        if (!showHiddenBones && boneDebugLists.hiddenBoneIndexSet.has(target.boneIndex)) continue;
        const isSelectedIkTarget = i === selection.selectedTargetIndex || selectedBoneIndices.has(target.boneIndex);
        const color = isSelectedIkTarget ? [1.0, 1.0, 0.0] : [1.0, 0.0, 0.0];
        const targetRotation = scene.boneLocalTransforms?.[target.boneIndex]?.worldRotation ?? null;
        vertices.push(...createCubeVertices(
          scene.boneWorldPositions[target.boneIndex],
          targetRotation,
          IK_TARGET_CUBE_RENDER_HALF_EXTENT,
          color,
        ));
      }
      if (model.ik) {
        for (const ik of model.ik) {
          if (!showHiddenBones && boneDebugLists.hiddenBoneIndexSet.has(ik.boneIndex)) {
            continue;
          }
          const targetPos = scene.boneWorldPositions[ik.targetIndex];
          const effectorPos = scene.boneWorldPositions[ik.boneIndex];
          if (targetPos && effectorPos) {
            pushLineQuads(vertices, targetPos, effectorPos, [1.0, 0.5, 0.0]);
          }
        }
      }
    }

    for (const target of getCustomRigCircleTargets(instance)) {
      const isSelectedBone = selectedBoneIndices.has(target.boneIndex);
      const color = selectedBoneIndex === target.boneIndex
        ? ACTIVE_BONE_COLOR
        : isSelectedBone
          ? MULTI_SELECTED_BONE_COLOR
          : target.color;
      vertices.push(...createCustomRigCircleVertices(target.center, [0, 0, 0], target.circleRotation ?? target.rotation, target.radius, color, 128));
    }
  }

  uiOverlay.indicatorVertexCount = vertices.length / 10;
  ensureIndicatorBufferCapacity(device, uiOverlay, vertices.length * 4);
  if (uiOverlay.indicatorVertexCount > 0) {
    device.queue.writeBuffer(uiOverlay.indicatorVertexBuffer, 0, new Float32Array(vertices));
  }
}

/**
 * 物理ワイヤーフレームバッファを更新します。
 * @param {GPUDevice} device - WebGPU デバイス。
 * @param {object} instance - モデルインスタンス。
 * @param {object} physicsEngine - 物理演算エンジン。
 * @param {object} selection - 現在の選択状態。
 */
export function updatePhysicsWireframe(device, instance, physicsEngine, selection) {
  const uiOverlay = getUiOverlayState(instance.scene);
  if (!selection.showPhysics) {
    uiOverlay.physicsWireframeVertexCount = 0;
    return;
  }

  const vertices = [];
  const rbTr = new physicsEngine.Ammo.btTransform();
  for (const entry of physicsEngine.models) {
    if (entry.model !== instance.model) {
      continue;
    }

    for (const body of entry.bodies) {
      body.ammoBody.getMotionState().getWorldTransform(rbTr);
      const origin = rbTr.getOrigin();
      const rotation = rbTr.getRotation();
      const rotationQuat = quat.fromValues(rotation.x(), rotation.y(), rotation.z(), rotation.w());
      quat.normalize(rotationQuat, rotationQuat);
      const worldMatrix = mat4.fromRotationTranslation(
        mat4.create(),
        rotationQuat,
        [
          origin.x() * AMMO_INV_LENGTH_SCALE,
          origin.y() * AMMO_INV_LENGTH_SCALE,
          origin.z() * AMMO_INV_LENGTH_SCALE,
        ],
      );
      const color = body.rbData.physicsMode === 0 ? [0.0, 1.0, 0.0] : [1.0, 0.0, 0.0];
      const shape = body.rbData.shape;
      const size = body.rbData.size;
      if (shape === 0) {
        vertices.push(...createSphereWireframe(worldMatrix, size[0], color));
      } else if (shape === 1) {
        vertices.push(...createBoxWireframe(worldMatrix, size, color));
      } else if (shape === 2) {
        vertices.push(...createCapsuleWireframe(worldMatrix, size[0], size[1], color, body.capsuleAxis || 'y'));
      }
    }
  }
  physicsEngine.Ammo.destroy(rbTr);

  appendVrmSpringBoneColliderVertices(vertices, instance);

  uiOverlay.physicsWireframeVertexCount = vertices.length / 10;
  if (uiOverlay.physicsWireframeVertexCount > 0) {
    ensurePhysicsWireframeBufferCapacity(device, uiOverlay, vertices.length * 4);
    device.queue.writeBuffer(uiOverlay.physicsWireframeVertexBuffer, 0, new Float32Array(vertices));
  }
}

/**
 * 床グリッドと XYZ 軸のバッファを更新します。
 * @param {GPUDevice} device - WebGPU デバイス。
 * @param {object} gridOverlay - 床グリッド状態。
 * @param {object} selection - 現在の選択状態。
 */
export function updateGridBuffer(device, gridOverlay, selection) {
  if (!gridOverlay) {
    return;
  }

  const defaults = getDefaultsSnapshot('gridOverlay');
  const defaultGridSize = Number.isFinite(defaults.size) ? defaults.size : 0.5;
  const defaultGridCount = Number.isFinite(defaults.count) ? defaults.count : 10;
  const showXZ = selection?.showGridXZ !== false;
  const showXY = Boolean(selection?.showGridXY);
  const showYZ = Boolean(selection?.showGridYZ);
  const size = Number.isFinite(gridOverlay?.size) ? gridOverlay.size : defaultGridSize;
  const count = Number.isFinite(gridOverlay?.count) ? Math.max(1, Math.round(gridOverlay.count)) : defaultGridCount;

  const vertices = [];
  if (showXZ) {
    appendPlaneGridVertices(vertices, 'xz', size, count);
  }
  if (showXY) {
    appendPlaneGridVertices(vertices, 'xy', size, count);
  }
  if (showYZ) {
    appendPlaneGridVertices(vertices, 'yz', size, count);
  }
  appendGridAxisVertices(vertices, {
    x: showXZ || showXY,
    y: showXY || showYZ,
    z: showXZ || showYZ,
  }, size, count);

  gridOverlay.gridVertexCount = vertices.length / 10;
  ensureGridBufferCapacity(device, gridOverlay, vertices.length * 4);
  if (gridOverlay.gridVertexCount > 0) {
    device.queue.writeBuffer(gridOverlay.gridVertexBuffer, 0, new Float32Array(vertices));
  }
}

/**
 * 床グリッドを描画します。
 * @param {GPURenderPassEncoder} pass - レンダーパス。
 * @param {object} manager - ModelManager インスタンス。
 * @param {object} gridOverlay - 床グリッド状態。
 * @param {GPUTextureView|null} [depthView=null] - 深度テクスチャビュー。
 * @param {boolean} [depthIsMultisampled=false] - 深度ビューが MSAA かどうか。
 */
export function drawGridOverlay(pass, manager, gridOverlay, depthView = null, depthIsMultisampled = false) {
  if (!gridOverlay || gridOverlay.gridVertexCount <= 0) {
    return;
  }

  const postPipeline = depthIsMultisampled
    ? manager?.gridOverlayPostPipeline
    : manager?.gridOverlayPostSinglePipeline;
  if (postPipeline && depthView && typeof manager.device.createBindGroup === 'function') {
    pass.setPipeline(postPipeline);
    pass.setBindGroup(0, manager.globalResources.globalBindGroup);
    const depthBindGroupIndex = depthIsMultisampled ? 1 : 3;
    const depthBindGroup = manager.device.createBindGroup({
      layout: postPipeline.getBindGroupLayout(depthBindGroupIndex),
      entries: [
        { binding: 0, resource: depthView },
      ],
    });
    pass.setBindGroup(depthBindGroupIndex, depthBindGroup);
  } else if (manager?.gridOverlayPipeline) {
    pass.setPipeline(manager.gridOverlayPipeline);
    pass.setBindGroup(0, manager.globalResources.globalBindGroup);
  }
  pass.setVertexBuffer(0, gridOverlay.gridVertexBuffer);
  pass.draw(gridOverlay.gridVertexCount, 1, 0, 0);
}

/**
 * ギズモバッファを更新します。
 * @param {GPUDevice} device - WebGPU デバイス。
 * @param {object} instance - モデルインスタンス。
 * @param {object} selection - 現在の選択状態。
 * @param {boolean} isActive - アクティブモデルかどうか。
 * @param {vec3} cameraEye - カメラの視点位置。
 * @param {object|null} [inspectorState=null] - ボーンインスペクター状態。
 */
export function updateGizmoBuffer(device, instance, selection, isActive, cameraEye, inspectorState = null) {
  const uiOverlay = getUiOverlayState(instance.scene);
  const pose = resolveGizmoPose(instance, selection, null, inspectorState);
  if (!isActive || !pose) {
    uiOverlay.gizmoVertexCount = 0;
    return;
  }

  const vertices = buildGizmoVertices(instance, selection, cameraEye, null, inspectorState);
  uiOverlay.gizmoVertexCount = vertices.length / 10;
  ensureGizmoBufferCapacity(device, uiOverlay, vertices.length * 4);
  if (uiOverlay.gizmoVertexCount > 0) {
    device.queue.writeBuffer(uiOverlay.gizmoVertexBuffer, 0, new Float32Array(vertices));
  }
}

/**
 * ライト overlay 用バッファを更新します。
 * @param {GPUDevice} device - WebGPU デバイス。
 * @param {object} lightObject - ライト状態。
 * @param {object} selection - 現在の選択状態。
 * @param {object} camera - カメラ状態。
 * @param {object|null} [inspectorState=null] - ボーンインスペクター状態。
 */
export function updateLightOverlayBuffer(device, lightObject, selection, camera, inspectorState = null) {
  const uiOverlay = lightObject?.uiOverlay;
  if (!uiOverlay) {
    return;
  }

  const cameraEye = camera ? createCameraEye(camera) : [0, 0, 0];
  const iconColor = selection?.selectedLight ? [1.0, 0.92, 0.35] : [0.95, 0.78, 0.22];
  const iconVertices = buildLightIconVertices(lightObject, camera, iconColor);
  uiOverlay.iconVertexCount = iconVertices.length / 10;
  ensureLightBufferCapacity(device, uiOverlay, 'iconVertexBuffer', iconVertices.length * 4);
  if (uiOverlay.iconVertexCount > 0) {
    device.queue.writeBuffer(uiOverlay.iconVertexBuffer, 0, new Float32Array(iconVertices));
  }

  const directionLineVertices = buildLightDirectionLineVertices(
    lightObject,
    camera,
    selection?.selectedLight ? [1.0, 0.86, 0.28] : [0.86, 0.66, 0.18],
  );
  uiOverlay.directionLineVertexCount = directionLineVertices.length / 10;
  ensureLightBufferCapacity(device, uiOverlay, 'directionLineVertexBuffer', directionLineVertices.length * 4);
  if (uiOverlay.directionLineVertexCount > 0) {
    device.queue.writeBuffer(uiOverlay.directionLineVertexBuffer, 0, new Float32Array(directionLineVertices));
  }

  if (selection?.selectedLight) {
    const gizmoVertices = buildGizmoVertices(null, selection, cameraEye, lightObject, inspectorState);
    uiOverlay.gizmoVertexCount = gizmoVertices.length / 10;
    ensureLightBufferCapacity(device, uiOverlay, 'gizmoVertexBuffer', gizmoVertices.length * 4);
    if (uiOverlay.gizmoVertexCount > 0) {
      device.queue.writeBuffer(uiOverlay.gizmoVertexBuffer, 0, new Float32Array(gizmoVertices));
    }
  } else {
    uiOverlay.gizmoVertexCount = 0;
  }
}

/**
 * ライト overlay を描画します。
 * @param {GPURenderPassEncoder} pass - レンダーパス。
 * @param {object} lightObject - ライト状態。
 */
export function drawLightOverlay(pass, lightObject) {
  const uiOverlay = lightObject?.uiOverlay;
  if (!uiOverlay) {
    return;
  }

  if (uiOverlay.directionLineVertexCount > 0) {
    pass.setVertexBuffer(0, uiOverlay.directionLineVertexBuffer);
    pass.draw(uiOverlay.directionLineVertexCount, 1, 0, 0);
  }

  if (uiOverlay.iconVertexCount > 0) {
    pass.setVertexBuffer(0, uiOverlay.iconVertexBuffer);
    pass.draw(uiOverlay.iconVertexCount, 1, 0, 0);
  }

  if (uiOverlay.gizmoVertexCount > 0) {
    pass.setVertexBuffer(0, uiOverlay.gizmoVertexBuffer);
    pass.draw(uiOverlay.gizmoVertexCount, 1, 0, 0);
  }
}

/**
 * UI overlay を描画します。
 * @param {GPURenderPassEncoder} pass - レンダーパス。
 * @param {object} instance - モデルインスタンス。
 * @param {object} selection - 現在の選択状態。
 */
export function drawUiOverlay(pass, instance, selection) {
  const uiOverlay = getUiOverlayState(instance.scene);
  const showBones = selection.showBones !== false;

  if (showBones) {
    if (uiOverlay.boneLineVertexCount > 0) {
      pass.setVertexBuffer(0, uiOverlay.boneLineVertexBuffer);
      pass.draw(uiOverlay.boneLineVertexCount, 1, 0, 0);
    }
  }

  if (selection.showBoneAxes && uiOverlay.boneAxisVertexBuffer && uiOverlay.boneAxisVertexCount > 0) {
    pass.setVertexBuffer(0, uiOverlay.boneAxisVertexBuffer);
    pass.draw(uiOverlay.boneAxisVertexCount, 1, 0, 0);
  }

  if (showBones) {
    if (uiOverlay.indicatorVertexCount > 0) {
      pass.setVertexBuffer(0, uiOverlay.indicatorVertexBuffer);
      pass.draw(uiOverlay.indicatorVertexCount, 1, 0, 0);
    }
    if (uiOverlay.gizmoVertexCount > 0) {
      pass.setVertexBuffer(0, uiOverlay.gizmoVertexBuffer);
      pass.draw(uiOverlay.gizmoVertexCount, 1, 0, 0);
    }
  }

  if (selection.showPhysics && uiOverlay.physicsWireframeVertexCount > 0) {
    pass.setVertexBuffer(0, uiOverlay.physicsWireframeVertexBuffer);
    pass.draw(uiOverlay.physicsWireframeVertexCount, 1, 0, 0);
  }
}

function getUiOverlayState(scene) {
  return scene?.uiOverlay ?? scene;
}

function ensureLineBufferCapacity(device, uiOverlay, requiredSize) {
  if (requiredSize <= uiOverlay.boneLineVertexBuffer.size) {
    return;
  }
  uiOverlay.boneLineVertexBuffer.destroy();
  uiOverlay.boneLineVertexBuffer = device.createBuffer({
    size: Math.max(requiredSize * 1.5, 1),
    usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
  });
}

function ensureIndicatorBufferCapacity(device, uiOverlay, requiredSize) {
  if (requiredSize <= uiOverlay.indicatorVertexBuffer.size) {
    return;
  }
  uiOverlay.indicatorVertexBuffer.destroy();
  uiOverlay.indicatorVertexBuffer = device.createBuffer({
    size: Math.max(INDICATOR_BUFFER_SIZE, requiredSize * 1.5),
    usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
  });
}

function ensurePhysicsWireframeBufferCapacity(device, uiOverlay, requiredSize) {
  if (requiredSize <= uiOverlay.physicsWireframeVertexBuffer.size) {
    return;
  }
  uiOverlay.physicsWireframeVertexBuffer.destroy();
  uiOverlay.physicsWireframeVertexBuffer = device.createBuffer({
    size: Math.max(INDICATOR_BUFFER_SIZE, requiredSize * 1.5),
    usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
  });
}

function ensureGizmoBufferCapacity(device, uiOverlay, requiredSize) {
  if (requiredSize <= uiOverlay.gizmoVertexBuffer.size) {
    return;
  }
  uiOverlay.gizmoVertexBuffer.destroy();
  uiOverlay.gizmoVertexBuffer = device.createBuffer({
    size: Math.max(INDICATOR_BUFFER_SIZE, requiredSize * 1.5),
    usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
  });
}

function ensureBoneAxisBufferCapacity(device, uiOverlay, requiredSize) {
  if (!uiOverlay?.boneAxisVertexBuffer || typeof uiOverlay.boneAxisVertexBuffer.destroy !== 'function') {
    return;
  }
  if (requiredSize <= uiOverlay.boneAxisVertexBuffer.size) {
    return;
  }
  uiOverlay.boneAxisVertexBuffer.destroy();
  uiOverlay.boneAxisVertexBuffer = device.createBuffer({
    size: Math.max(requiredSize * 1.5, 1),
    usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
  });
}

function ensureLightBufferCapacity(device, uiOverlay, bufferKey, requiredSize) {
  const buffer = uiOverlay[bufferKey];
  if (requiredSize <= buffer.size) {
    return;
  }

  buffer.destroy();
  uiOverlay[bufferKey] = device.createBuffer({
    size: Math.max(INDICATOR_BUFFER_SIZE, requiredSize * 1.5),
    usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
  });
}

/**
 * 床グリッド用バッファ容量を確保します。
 * @param {GPUDevice} device - WebGPU デバイス。
 * @param {object} gridOverlay - 床グリッド状態。
 * @param {number} requiredSize - 必要バイト数。
 */
function ensureGridBufferCapacity(device, gridOverlay, requiredSize) {
  if (typeof GPUBufferUsage === 'undefined' || typeof device?.createBuffer !== 'function') {
    return;
  }
  if (requiredSize <= gridOverlay.gridVertexBuffer.size) {
    return;
  }
  gridOverlay.gridVertexBuffer.destroy();
  gridOverlay.gridVertexBuffer = device.createBuffer({
    size: Math.max(GRID_BUFFER_SIZE, requiredSize * 1.5),
    usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
  });
}

/**
 * 床グリッドの数値入力を読み取ります。
 * @param {HTMLInputElement|null} rangeInput - range 入力。
 * @param {HTMLInputElement|null} valueInput - number 入力。
 * @param {number} fallback - フォールバック値。
 * @param {number} min - 最小値。
 * @param {boolean} [roundToInteger=false] - 整数に丸めるかどうか。
 * @returns {number} 読み取った値。
 */
export function readGridNumberValue(rangeInput, valueInput, fallback, min, roundToInteger = false) {
  const source = valueInput?.value ?? rangeInput?.value ?? '';
  const parsed = Number.parseFloat(source);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }

  const clamped = Math.max(min, parsed);
  return roundToInteger ? Math.round(clamped) : clamped;
}

/**
 * テスト環境向けのダミー頂点バッファを作成します。
 * @returns {{size: number, destroy: Function}} ダミーバッファ。
 */
function createFallbackVertexBuffer() {
  return {
    size: 0,
    destroy() {},
  };
}

/**
 * 原点軸の頂点を追加します。
 * @param {Array<number>} vertices - 頂点配列。
 * @param {{x: boolean, y: boolean, z: boolean}} axes - 表示する軸。
 * @param {number} size - グリッドサイズ。
 * @param {number} count - 片側のグリッド数。
 */
function appendGridAxisVertices(vertices, axes, size, count) {
  const extent = size * count;
  if (axes.x) {
    appendSegmentedLineVertices(vertices, [0, 0, 0], [extent, 0, 0], [1.0, 0.0, 0.0], count);
  }
  if (axes.y) {
    appendSegmentedLineVertices(vertices, [0, 0, 0], [0, extent, 0], [0.0, 1.0, 0.0], count);
  }
  if (axes.z) {
    appendSegmentedLineVertices(vertices, [0, 0, 0], [0, 0, extent], [0.0, 0.0, 1.0], count);
  }
}

/**
 * 指定平面のグリッド頂点を追加します。
 * @param {Array<number>} vertices - 頂点配列。
 * @param {'xz'|'xy'|'yz'} plane - 対象平面。
 * @param {number} size - グリッドサイズ。
 * @param {number} count - 片側のグリッド数。
 */
function appendPlaneGridVertices(vertices, plane, size, count) {
  const extent = size * count;
  const gridColor = [0.0, 0.0, 0.0];

  if (plane === 'xz') {
    for (let i = -count; i <= count; i++) {
      const offset = i * size;
      appendSegmentedLineVertices(vertices, [-extent, 0, offset], [extent, 0, offset], gridColor, count * 2);
      appendSegmentedLineVertices(vertices, [offset, 0, -extent], [offset, 0, extent], gridColor, count * 2);
    }
    return;
  }

  if (plane === 'xy') {
    for (let i = -count; i <= count; i++) {
      const offset = i * size;
      appendSegmentedLineVertices(vertices, [-extent, offset, 0], [extent, offset, 0], gridColor, count * 2);
      appendSegmentedLineVertices(vertices, [offset, -extent, 0], [offset, extent, 0], gridColor, count * 2);
    }
    return;
  }

  for (let i = -count; i <= count; i++) {
    const offset = i * size;
    appendSegmentedLineVertices(vertices, [0, -extent, offset], [0, extent, offset], gridColor, count * 2);
    appendSegmentedLineVertices(vertices, [0, offset, -extent], [0, offset, extent], gridColor, count * 2);
  }
}

/**
 * 1 本の線を複数区間に分割して頂点を追加します。
 * 長い線分をそのまま screen-space extrusion すると遠近で太さが崩れるため、
 * グリッドはセル単位に近い長さへ分割して押し出し誤差を抑えます。
 * @param {Array<number>} vertices - 頂点配列。
 * @param {Array<number>} start - 開始点 [x, y, z]。
 * @param {Array<number>} end - 終了点 [x, y, z]。
 * @param {Array<number>} color - 色 [r, g, b]。
 * @param {number} segmentCount - 分割数。
 */
function appendSegmentedLineVertices(vertices, start, end, color, segmentCount) {
  const safeSegmentCount = Math.max(1, Math.round(segmentCount));
  for (let index = 0; index < safeSegmentCount; index++) {
    const startT = index / safeSegmentCount;
    const endT = (index + 1) / safeSegmentCount;
    const segmentStart = [
      start[0] + (end[0] - start[0]) * startT,
      start[1] + (end[1] - start[1]) * startT,
      start[2] + (end[2] - start[2]) * startT,
    ];
    const segmentEnd = [
      start[0] + (end[0] - start[0]) * endT,
      start[1] + (end[1] - start[1]) * endT,
      start[2] + (end[2] - start[2]) * endT,
    ];
    pushLineQuads(vertices, segmentStart, segmentEnd, color);
  }
}

function createBoxWireframe(worldMatrix, size, color) {
  const vertices = [];
  const corners = [
    [-size[0], -size[1], -size[2]], [size[0], -size[1], -size[2]], [size[0], size[1], -size[2]], [-size[0], size[1], -size[2]],
    [-size[0], -size[1], size[2]], [size[0], -size[1], size[2]], [size[0], size[1], size[2]], [-size[0], size[1], size[2]],
  ];
  const worldCorners = corners.map((corner) => {
    const vec = mat4Vec4Mul(worldMatrix, [...corner, 1]);
    return [vec[0], vec[1], vec[2]];
  });
  const lines = [
    [0, 1], [1, 2], [2, 3], [3, 0],
    [4, 5], [5, 6], [6, 7], [7, 4],
    [0, 4], [1, 5], [2, 6], [3, 7],
  ];
  for (const [start, end] of lines) {
    pushLineQuads(vertices, worldCorners[start], worldCorners[end], color);
  }
  return vertices;
}

function createSphereWireframe(worldMatrix, radius, color) {
  const vertices = [];
  const segments = 32;
  for (let i = 0; i < segments; i++) {
    const a1 = (i / segments) * Math.PI * 2;
    const a2 = ((i + 1) / segments) * Math.PI * 2;
    const p1xy = mat4Vec4Mul(worldMatrix, [Math.cos(a1) * radius, Math.sin(a1) * radius, 0, 1]);
    const p2xy = mat4Vec4Mul(worldMatrix, [Math.cos(a2) * radius, Math.sin(a2) * radius, 0, 1]);
    pushLineQuads(vertices, [p1xy[0], p1xy[1], p1xy[2]], [p2xy[0], p2xy[1], p2xy[2]], color);
    const p1yz = mat4Vec4Mul(worldMatrix, [0, Math.cos(a1) * radius, Math.sin(a1) * radius, 1]);
    const p2yz = mat4Vec4Mul(worldMatrix, [0, Math.cos(a2) * radius, Math.sin(a2) * radius, 1]);
    pushLineQuads(vertices, [p1yz[0], p1yz[1], p1yz[2]], [p2yz[0], p2yz[1], p2yz[2]], color);
    const p1zx = mat4Vec4Mul(worldMatrix, [Math.sin(a1) * radius, 0, Math.cos(a1) * radius, 1]);
    const p2zx = mat4Vec4Mul(worldMatrix, [Math.sin(a2) * radius, 0, Math.cos(a2) * radius, 1]);
    pushLineQuads(vertices, [p1zx[0], p1zx[1], p1zx[2]], [p2zx[0], p2zx[1], p2zx[2]], color);
  }
  return vertices;
}

function createCapsuleWireframe(worldMatrix, radius, height, color, axis = 'y') {
  const vertices = [];
  const halfHeight = height / 2;
  const sideOffsets = [[radius, 0], [-radius, 0], [0, radius], [0, -radius]];
  const toPoint = (primary, radialA, radialB) => {
    if (axis === 'x') {
      return [primary, radialA, radialB, 1];
    }
    if (axis === 'z') {
      return [radialA, radialB, primary, 1];
    }
    return [radialA, primary, radialB, 1];
  };
  for (const [sx, sz] of sideOffsets) {
    const p1 = mat4Vec4Mul(worldMatrix, toPoint(-halfHeight, sx, sz));
    const p2 = mat4Vec4Mul(worldMatrix, toPoint(halfHeight, sx, sz));
    pushLineQuads(vertices, [p1[0], p1[1], p1[2]], [p2[0], p2[1], p2[2]], color);
  }
  for (let i = 0; i < 32; i++) {
    const a1 = (i / 32) * Math.PI * 2;
    const a2 = ((i + 1) / 32) * Math.PI * 2;
    const p1Top = mat4Vec4Mul(worldMatrix, toPoint(halfHeight, Math.cos(a1) * radius, Math.sin(a1) * radius));
    const p2Top = mat4Vec4Mul(worldMatrix, toPoint(halfHeight, Math.cos(a2) * radius, Math.sin(a2) * radius));
    pushLineQuads(vertices, [p1Top[0], p1Top[1], p1Top[2]], [p2Top[0], p2Top[1], p2Top[2]], color);
    const p1Bottom = mat4Vec4Mul(worldMatrix, toPoint(-halfHeight, Math.cos(a1) * radius, Math.sin(a1) * radius));
    const p2Bottom = mat4Vec4Mul(worldMatrix, toPoint(-halfHeight, Math.cos(a2) * radius, Math.sin(a2) * radius));
    pushLineQuads(vertices, [p1Bottom[0], p1Bottom[1], p1Bottom[2]], [p2Bottom[0], p2Bottom[1], p2Bottom[2]], color);
  }
  return vertices;
}

/**
 * VRM SpringBone collider の wireframe 頂点を追加します。
 * @param {Array<number>} vertices - 追加先。
 * @param {object} instance - モデルインスタンス。
 */
function appendVrmSpringBoneColliderVertices(vertices, instance) {
  const springBoneState = instance?.scene?.vrmSpringBoneState;
  const springBoneColliders = Array.isArray(springBoneState?.colliders) ? springBoneState.colliders : [];
  if (springBoneColliders.length === 0) {
    return;
  }

  const color = [0.2, 0.8, 1.0];
  const boneWorldMatrices = instance.scene.boneLocalTransforms;
  const worldMatrix = mat4.create();
  const localMatrix = mat4.create();
  const tempVecA = vec3.create();
  const tempVecB = vec3.create();
  const tempDirection = vec3.create();
  const tempRotation = quat.create();
  const yAxis = vec3.fromValues(0, 1, 0);

  for (const collider of springBoneColliders) {
    const boneWorldMatrix = boneWorldMatrices?.[collider.boneIndex]?.worldMatrix;
    if (!boneWorldMatrix) {
      continue;
    }

    if (collider.shape === 'sphere') {
      mat4.fromTranslation(localMatrix, collider.offset);
      mat4.multiply(worldMatrix, boneWorldMatrix, localMatrix);
      vertices.push(...createSphereWireframe(worldMatrix, collider.radius, color));
      continue;
    }

    if (collider.shape !== 'capsule') {
      continue;
    }

    const offsetWorld = mat4Vec4Mul(boneWorldMatrix, [collider.offset[0], collider.offset[1], collider.offset[2], 1]);
    const tailWorld = mat4Vec4Mul(boneWorldMatrix, [collider.tail[0], collider.tail[1], collider.tail[2], 1]);
    vec3.set(tempVecA, offsetWorld[0], offsetWorld[1], offsetWorld[2]);
    vec3.set(tempVecB, tailWorld[0], tailWorld[1], tailWorld[2]);
    vec3.sub(tempDirection, tempVecB, tempVecA);
    const height = vec3.length(tempDirection);
    if (height <= 1e-8) {
      continue;
    }

    vec3.scale(tempDirection, tempDirection, 1 / height);
    quat.rotationTo(tempRotation, yAxis, tempDirection);
    vec3.add(tempVecA, tempVecA, tempVecB);
    vec3.scale(tempVecA, tempVecA, 0.5);
    mat4.fromRotationTranslation(worldMatrix, tempRotation, tempVecA);
    vertices.push(...createCapsuleWireframe(worldMatrix, collider.radius, height, color, 'y'));
  }
}

/**
 * 回転を反映した立方体の線分頂点を生成します。
 * @param {ArrayLike<number>} position - 立方体中心のワールド座標。
 * @param {ArrayLike<number>|null|undefined} rotation - ワールド回転クォータニオン。
 * @param {number} halfExtent - 立方体の半径。
 * @param {Array<number>} color - 線色。
 * @returns {Array<number>} 頂点列。
 */
function createCubeVertices(position, rotation, halfExtent, color) {
  const rotationQuat = ArrayBuffer.isView(rotation) || Array.isArray(rotation)
    ? rotation
    : quat.create();
  const worldMatrix = mat4.fromRotationTranslation(mat4.create(), rotationQuat, position);
  const corners = [
    [-halfExtent, -halfExtent, -halfExtent],
    [halfExtent, -halfExtent, -halfExtent],
    [halfExtent, halfExtent, -halfExtent],
    [-halfExtent, halfExtent, -halfExtent],
    [-halfExtent, -halfExtent, halfExtent],
    [halfExtent, -halfExtent, halfExtent],
    [halfExtent, halfExtent, halfExtent],
    [-halfExtent, halfExtent, halfExtent],
  ].map((corner) => {
    const worldCorner = mat4Vec4Mul(worldMatrix, [...corner, 1]);
    return [worldCorner[0], worldCorner[1], worldCorner[2]];
  });
  const edges = [
    [0, 1], [1, 2], [2, 3], [3, 0],
    [4, 5], [5, 6], [6, 7], [7, 4],
    [0, 4], [1, 5], [2, 6], [3, 7],
  ];
  const vertices = [];
  for (const [start, end] of edges) {
    pushLineQuads(vertices, corners[start], corners[end], color);
  }
  return vertices;
}
