import { createCameraEye } from '../../core/scene/camera.js';

/**
 * Creates a read-model service for debug panels.
 * @param {object} options - Service options.
 * @returns {object} Debug read-model service.
 */
export function createDebugReadModelService(options = {}) {
  /**
   * Returns the active instance.
   * @returns {object|null} Active instance.
   */
  function getActiveInstance() {
    return options.getActiveInstance?.() ?? null;
  }

  /**
   * Returns the clicked mouse state.
   * @returns {object} Click state.
   */
  function getClickedMousePositionState() {
    return options.clickedMousePositionUiState ?? {};
  }

  /**
   * Returns the current camera state.
   * @returns {object|null} Camera state.
   */
  function getCameraState() {
    return options.camera ?? null;
  }

  return {
    /**
     * Returns the camera debug view-model.
     * @returns {{clickedMouseText: string, cameraText: string}} Debug text.
     */
    getCameraDebugState() {
      const clickedMouseState = getClickedMousePositionState();
      const camera = getCameraState();
      const clickedMouseText = (
        Number.isFinite(clickedMouseState.clientX)
        && Number.isFinite(clickedMouseState.clientY)
        && Number.isFinite(clickedMouseState.canvasX)
        && Number.isFinite(clickedMouseState.canvasY)
      )
        ? [
          `Client: ${clickedMouseState.clientX.toFixed(1)}, ${clickedMouseState.clientY.toFixed(1)}`,
          `Canvas: ${clickedMouseState.canvasX.toFixed(1)}, ${clickedMouseState.canvasY.toFixed(1)}`,
        ].join('\n')
        : 'No click recorded.';
      if (!camera) {
        return {
          clickedMouseText,
          cameraText: 'Camera debug data is not available.',
        };
      }

      const eye = createCameraEye(camera);
      const clipPlanes = camera.clipPlanes || { near: 0.1, far: 1000.0 };
      const toDeg = (value) => value * 180 / Math.PI;
      return {
        clickedMouseText,
        cameraText: [
          `Eye:      ${eye.map((value) => value.toFixed(3)).join(', ')}`,
          `Center:   ${camera.center.map((value) => value.toFixed(3)).join(', ')}`,
          `Distance: ${camera.distance.toFixed(3)}`,
          `Phi:      ${toDeg(camera.phi).toFixed(3)} deg`,
          `Theta:    ${toDeg(camera.theta).toFixed(3)} deg`,
          `Roll:     ${toDeg(camera.roll ?? 0).toFixed(3)} deg`,
          `FOV:      ${toDeg(camera.fovY).toFixed(3)} deg`,
          `Clip:     near ${clipPlanes.near.toFixed(3)} / far ${clipPlanes.far.toFixed(3)}`,
        ].join('\n'),
      };
    },

    /**
     * Returns the bone debug view-model.
     * @returns {{message: string|null, rows: Array<{name: string, components: string[]}>}} Debug rows.
     */
    getBoneDebugState() {
      const activeInstance = getActiveInstance();
      const bones = Array.isArray(activeInstance?.model?.bones) ? activeInstance.model.bones : [];
      if (!activeInstance || bones.length === 0) {
        return {
          message: 'Bone debug data is not available.',
          rows: [],
        };
      }

      const rows = [];
      for (let index = 0; index < bones.length; index += 1) {
        const bone = bones[index];
        if (String(bone?.name) !== '全ての親') {
          continue;
        }
        const baseRotation = Array.isArray(bone?.baseRotationQuaternion) && bone.baseRotationQuaternion.length >= 4
          ? bone.baseRotationQuaternion
          : [0, 0, 0, 1];
        rows.push({
          name: String(bone?.name || `Bone ${index}`),
          components: baseRotation.slice(0, 4).map((value) => Number(value ?? 0).toFixed(6)),
        });
      }

      if (rows.length === 0) {
        return {
          message: 'Bone debug data is not available.',
          rows: [],
        };
      }

      return {
        message: null,
        rows,
      };
    },

    /**
     * Returns the animation debug view-model.
     * @returns {{message: string|null, rows: Array<{sourceName: string, targetName: string, eulerDegrees: string[]}>}} Debug rows.
     */
    getAnimationDebugState() {
      const activeInstance = getActiveInstance();
      const animationController = activeInstance?.animationController ?? null;
      const sourceKind = String(animationController?.animationSourceKind || '').trim();
      if (!animationController || (sourceKind !== 'vmd' && sourceKind !== 'vrma')) {
        return {
          message: 'Animation debug data is not available.',
          rows: [],
        };
      }

      const entries = animationController.getAnimationDebugRotations?.() || [];
      if (entries.length === 0) {
        return {
          message: 'No VMD / VRMA bone rotation data is available at the current frame.',
          rows: [],
        };
      }

      const rows = entries.map((entry) => ({
        sourceName: String(entry?.sourceBoneName || '').trim(),
        targetName: String(entry?.displayTargetBoneName || entry?.targetBoneName || '').trim(),
        eulerDegrees: (Array.isArray(entry?.euler) ? entry.euler : [0, 0, 0]).map((value) => (Number(value) * 180 / Math.PI).toFixed(3)),
      }));
      return {
        message: null,
        rows,
      };
    },
  };
}
