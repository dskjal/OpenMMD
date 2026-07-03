import { getBone } from '../../core/model/model-scene.js';
import { getBoneGizmoModes } from '../../core/selection/gizmo.js';
import { getSelectedBoneIndices, resolveActiveBoneContext, resolveSelectedBoneContext, resolveSelectedBoneIndex } from '../../core/selection/renderer-selection.js';
import { getBoneInfoDisplayEulerXYZ, getBoneInfoDisplayValues } from '../../shared/bones/bone-display-utils.js';
import { syncBoneInfoUiState as syncBoneInfoDisplayState } from '../../ui/panels/bone-info-ui.js';
import { syncWorldRotationDisplay } from '../../ui/panels/world-rotation-ui.js';

/**
 * Creates a bone inspector read-model service.
 * @param {object} options - Service options.
 * @returns {{getPanelState: function}} Bone inspector service.
 */
export function createBoneInspectorService(options = {}) {
  const inspectorState = options.inspectorState ?? options.selection ?? {};
  /**
   * Builds a displayable bone context from the provided active instance.
   * @param {object|null} activeInstance - Active instance.
   * @returns {object|null} Fallback display context.
   */
  function resolveDisplayBoneContextFromInstance(activeInstance) {
    const selectedBoneIndex = resolveSelectedBoneIndex(activeInstance, options.selection);
    if (!activeInstance || selectedBoneIndex < 0) {
      return null;
    }

    const local = activeInstance.scene?.boneLocalTransforms?.[selectedBoneIndex] || null;
    const bone = activeInstance.model?.bones?.[selectedBoneIndex] || null;
    const bindBone = activeInstance.model?.bindBones?.[selectedBoneIndex] || null;
    if (!local || !bone || !bindBone) {
      return null;
    }

    return {
      instance: activeInstance,
      activeBoneIndex: selectedBoneIndex,
      selectedBoneIndex,
      boneIndex: selectedBoneIndex,
      bone,
      local,
      bindBone,
    };
  }

  /**
   * Returns matching keyframes for one bone.
   * @param {object|null} animationController - Animation controller.
   * @param {string} boneName - Bone name.
   * @returns {Array<object>|null} Matching keyframes.
   */
  function getBoneKeyframesForInspector(animationController, boneName) {
    const normalizedBoneName = String(boneName || '').trim();
    if (!animationController || !normalizedBoneName) {
      return null;
    }

    const animationClip = animationController.animationClip || null;
    if (animationClip && Array.isArray(animationClip.channels)) {
      const keyframes = [];
      for (const channel of animationClip.channels) {
        const target = channel?.target || {};
        if (target.kind !== 'bone' || String(target.name || target.nodeName || '').trim() !== normalizedBoneName) {
          continue;
        }
        for (const keyframe of channel?.sampler?.keyframes || []) {
          const frameNum = Number.isFinite(keyframe?.frameNum)
            ? Math.round(keyframe.frameNum)
            : Math.round((Number(keyframe?.time) || 0) * (animationClip.timelineFps || 30));
          keyframes.push({ frameNum });
        }
      }
      if (keyframes.length > 0) {
        return keyframes;
      }
    }

    const vmd = animationController.vmd || null;
    const boneKeyframes = vmd?.boneKeyframes || vmd?.motions || [];
    const matches = [];
    for (const keyframe of boneKeyframes) {
      if (String(keyframe?.boneName || '').trim() === normalizedBoneName) {
        matches.push(keyframe);
      }
    }
    return matches.length > 0 ? matches : null;
  }

  /**
   * Returns a localized text.
   * @param {object} langData - Localization map.
   * @param {string} key - Translation key.
   * @param {string} fallback - Fallback text.
   * @returns {string} Localized text.
   */
  function t(langData, key, fallback) {
    return langData?.[key] || fallback;
  }

  /**
   * Returns child model option items.
   * @returns {Array<object>} Select option items.
   */
  function getChildModelOptions() {
    const instances = Array.isArray(options.modelManager?.instances) ? options.modelManager.instances : [];
    return instances.map((instance, index) => ({
      value: String(index),
      label: instance.model?.name || `Model ${index}`,
    }));
  }

  /**
   * Builds child panel state.
   * @param {object|null} local - Active local transform.
   * @param {object} langData - Localization map.
   * @returns {object} Child panel state.
   */
  function getChildPanelState(local, langData) {
    const modelOptions = getChildModelOptions();
    const selectedModelIndex = Number.isInteger(local?.childSourceInstanceIndex)
      && local.childSourceInstanceIndex >= 0
      && local.childSourceInstanceIndex < modelOptions.length
      ? local.childSourceInstanceIndex
      : -1;
    const selectedModelInstance = selectedModelIndex >= 0
      ? options.modelManager.instances[selectedModelIndex] || null
      : null;
    const bones = Array.isArray(selectedModelInstance?.model?.bones) ? selectedModelInstance.model.bones : [];
    const boneOptions = bones.map((bone, index) => ({
      value: String(index),
      label: bone.name || `Bone ${index}`,
    }));
    const selectedBoneIndex = Number.isInteger(local?.childSourceBoneIndex)
      && local.childSourceBoneIndex >= 0
      && local.childSourceBoneIndex < boneOptions.length
      ? local.childSourceBoneIndex
      : -1;
    const enabled = Boolean(local?.childEnabled);
    const influence = Number.isFinite(local?.childInfluence)
      ? Math.min(1, Math.max(0, local.childInfluence))
      : 1;
    const hasLocal = Boolean(local);
    const hasValidTarget = Boolean(selectedModelInstance && selectedBoneIndex >= 0);

    return {
      controlsEnabled: hasLocal,
      enabled,
      modelOptions,
      modelValue: selectedModelIndex >= 0 ? String(selectedModelIndex) : '',
      boneOptions,
      boneValue: selectedBoneIndex >= 0 ? String(selectedBoneIndex) : '',
      influence,
      setInverseDisabled: !hasValidTarget,
      clearInverseDisabled: !hasValidTarget,
      pickButtonDisabled: !hasLocal,
      pickButtonLabel: t(langData, 'Pick Child Bone', 'Pick Child Bone'),
      pickButtonPressed: Boolean(options.childBonePickState?.enabled),
    };
  }

  /**
   * Builds IK panel state.
   * @param {object|null} activeBoneContext - Active bone context.
   * @param {object|null} activeInstance - Active instance.
   * @param {object} langData - Localization map.
   * @returns {object} IK panel state.
   */
  function getIkPanelState(activeBoneContext, activeInstance, langData) {
    const selectedIkContext = options.boneService?.resolveActiveIkContext?.() ?? null;
    const ik = selectedIkContext?.ik ?? null;
    const canCreateIk = Boolean(
      activeBoneContext
      && !selectedIkContext
      && activeBoneContext.bone?.runtimeGeneratedIkBone !== true
    );
    const canDeleteIk = Boolean(
      selectedIkContext
      && selectedIkContext.bone?.runtimeGeneratedIkBone === true
      && selectedIkContext.ik?.runtimeGeneratedIk === true
    );
    const ikLocks = activeBoneContext?.bone ? options.getBoneIkRotationLocks(activeBoneContext.bone) : { x: false, y: false, z: false };
    if (!activeInstance || !selectedIkContext || !ik) {
      return {
        controlsEnabled: false,
        enabled: false,
        targetOptions: [],
        targetValue: '',
        chainCount: 1,
        iterationCount: 1,
        createDisabled: !canCreateIk,
        deleteDisabled: !canDeleteIk,
        rotationLocks: ikLocks,
        rotationLocksEnabled: Boolean(activeBoneContext?.bone),
        labels: {
          lock: t(langData, 'Lock IK Rotation', 'Lock IK rotation'),
          unlock: t(langData, 'Unlock IK Rotation', 'Unlock IK rotation'),
        },
      };
    }

    const bones = Array.isArray(selectedIkContext.instance.model?.bones) ? selectedIkContext.instance.model.bones : [];
    const hasValidTarget = Number.isInteger(ik.targetBoneIndex) && ik.targetBoneIndex >= 0 && ik.targetBoneIndex < bones.length;
    return {
      controlsEnabled: true,
      enabled: ik.enabled !== false,
      targetOptions: bones.map((bone, index) => ({
        value: String(index),
        label: bone.name || `Bone ${index}`,
      })),
      targetValue: hasValidTarget ? String(ik.targetBoneIndex) : '',
      chainCount: Math.max(1, Math.min(10, Array.isArray(ik.links) ? ik.links.length : 1)),
      iterationCount: Math.max(
        1,
        Number.isFinite(ik.loopCount)
          ? Math.round(ik.loopCount)
          : Number.isFinite(ik.iteration)
            ? Math.round(ik.iteration)
            : 1,
      ),
      createDisabled: !canCreateIk,
      deleteDisabled: !canDeleteIk,
      rotationLocks: ikLocks,
      rotationLocksEnabled: true,
      labels: {
        lock: t(langData, 'Lock IK Rotation', 'Lock IK rotation'),
        unlock: t(langData, 'Unlock IK Rotation', 'Unlock IK rotation'),
      },
    };
  }

  /**
   * Returns disabled bone panel state.
   * @param {object} langData - Localization map.
   * @returns {object} Panel state.
   */
  function getEmptyPanelState(langData) {
    return {
      headers: {
        positionKey: inspectorState.useWorldCoordinate ? 'World Position' : 'Local Position',
        positionLabel: t(langData, inspectorState.useWorldCoordinate ? 'World Position' : 'Local Position', inspectorState.useWorldCoordinate ? 'World Position' : 'Local Position'),
        rotationKey: inspectorState.useWorldCoordinate ? 'World Rotation' : 'Local Rotation',
        rotationLabel: t(langData, inspectorState.useWorldCoordinate ? 'World Rotation' : 'Local Rotation', inspectorState.useWorldCoordinate ? 'World Rotation' : 'Local Rotation'),
      },
      saveVpdDisabled: true,
      parentBoneName: t(langData, 'None', 'None'),
      positionInputs: Array.from({ length: 3 }, () => ({ value: null, disabled: true, backgroundColor: '' })),
      rotationInputs: Array.from({ length: 3 }, () => ({ value: null, disabled: true, backgroundColor: '' })),
      keyButtons: {
        positionEnabled: false,
        rotationEnabled: false,
        label: t(langData, 'Save Bone Keyframe', 'Save bone keyframe'),
      },
      rotationLocks: {
        enabled: false,
        values: { x: false, y: false, z: false },
        labels: {
          lock: t(langData, 'Lock Bone Rotation', 'Lock bone rotation'),
          unlock: t(langData, 'Unlock Bone Rotation', 'Unlock bone rotation'),
        },
      },
      child: getChildPanelState(null, langData),
      ik: getIkPanelState(null, null, langData),
    };
  }

  /**
   * Builds the bone inspector panel state.
   * @param {object|null} activeInstance - Active instance.
   * @param {object} [langData={}] - Localization map.
   * @param {object} [interactionState={}] - Focus state.
   * @returns {object} Panel state.
   */
  function getPanelState(activeInstance, langData = {}, interactionState = {}) {
    const activeBoneContext = resolveActiveBoneContext(options.modelManager, options.selection);
    const selectedBoneContext = resolveSelectedBoneContext(options.modelManager, options.selection);
    const displayBoneContext = activeBoneContext || selectedBoneContext || resolveDisplayBoneContextFromInstance(activeInstance);
    const selectedBoneIndex = Number.isInteger(displayBoneContext?.boneIndex)
      ? displayBoneContext.boneIndex
      : Number.isInteger(displayBoneContext?.selectedBoneIndex)
        ? displayBoneContext.selectedBoneIndex
        : -1;
    const resolvedInstance = displayBoneContext?.instance || activeInstance;
    const selectedBoneIndices = getSelectedBoneIndices(options.selection, resolvedInstance);
    const hasBoneSelection = selectedBoneIndices.length > 0;
    const local = displayBoneContext?.local ?? null;
    const headers = {
      positionKey: inspectorState.useWorldCoordinate ? 'World Position' : 'Local Position',
      positionLabel: t(langData, inspectorState.useWorldCoordinate ? 'World Position' : 'Local Position', inspectorState.useWorldCoordinate ? 'World Position' : 'Local Position'),
      rotationKey: inspectorState.useWorldCoordinate ? 'World Rotation' : 'Local Rotation',
      rotationLabel: t(langData, inspectorState.useWorldCoordinate ? 'World Rotation' : 'Local Rotation', inspectorState.useWorldCoordinate ? 'World Rotation' : 'Local Rotation'),
    };

    if (!resolvedInstance || !hasBoneSelection || selectedBoneIndex === -1) {
      return {
        ...getEmptyPanelState(langData),
        headers,
        child: getChildPanelState(local, langData),
        ik: getIkPanelState(displayBoneContext, resolvedInstance, langData),
      };
    }

    const bone = getBone(resolvedInstance.model, selectedBoneIndex);
    const boneEditTargets = options.getBoneEditTargets();
    const positionEnabled = hasBoneSelection && options.filterBoneEditTargetsByMode(boneEditTargets, 'translation').length > 0;
    const rotationEnabled = hasBoneSelection && options.filterBoneEditTargetsByMode(boneEditTargets, 'rotation').length > 0;
    const gizmoModes = getBoneGizmoModes(bone);
    const displayValues = getBoneInfoDisplayValues(resolvedInstance, selectedBoneIndex, inspectorState.useWorldCoordinate);
    const isBoneInfoEditing = Boolean(interactionState.isBoneInfoEditing);
    const isWorldRotationEditing = Boolean(interactionState.isWorldRotationEditing);
    const rotationLocks = options.getBoneRotationLocks(bone);
    let euler;
    if (inspectorState.useWorldCoordinate) {
      euler = syncWorldRotationDisplay(
        inspectorState.worldRotationUiState,
        selectedBoneIndex,
        displayValues.rotation,
        isWorldRotationEditing,
        inspectorState.prevEuler,
        bone?.name,
      );
    } else if (selectedBoneIndex !== inspectorState.lastSelectedBoneIndex) {
      euler = getBoneInfoDisplayEulerXYZ(resolvedInstance, selectedBoneIndex, false);
      inspectorState.lastSelectedBoneIndex = selectedBoneIndex;
    } else {
      euler = getBoneInfoDisplayEulerXYZ(resolvedInstance, selectedBoneIndex, false, inspectorState.prevEuler);
    }
    const boneInfoDisplay = syncBoneInfoDisplayState(inspectorState.boneInfoUiState, {
      boneIndex: selectedBoneIndex,
      mode: inspectorState.useWorldCoordinate ? 'world' : 'local',
      editing: isBoneInfoEditing,
      position: displayValues.position,
      rotation: [euler[0] * 180 / Math.PI, euler[1] * 180 / Math.PI, euler[2] * 180 / Math.PI],
    });
    inspectorState.prevEuler[0] = euler[0];
    inspectorState.prevEuler[1] = euler[1];
    inspectorState.prevEuler[2] = euler[2];

    const boneName = String(bone?.name || '').trim();
    const animationController = resolvedInstance.animationController;
    const currentFrame = Math.round(animationController?.currentFrame ?? 0);
    const motions = getBoneKeyframesForInspector(animationController, boneName);
    const backgroundColor = options.getKeyframeBackgroundColor(motions, currentFrame);
    const parentIndex = Number.isInteger(displayBoneContext?.bone?.parentIndex) ? displayBoneContext.bone.parentIndex : -1;
    const parentBone = parentIndex >= 0 ? getBone(displayBoneContext.instance.model, parentIndex) : null;

    return {
      headers,
      saveVpdDisabled: !hasBoneSelection,
      parentBoneName: parentBone?.name?.trim() || t(langData, 'None', 'None'),
      positionInputs: boneInfoDisplay.position.map((value) => ({
        value,
        disabled: !gizmoModes.translatable,
        backgroundColor: gizmoModes.translatable ? backgroundColor : '',
      })),
      rotationInputs: boneInfoDisplay.rotation.map((value, index) => {
        const axis = ['x', 'y', 'z'][index];
        const locked = Boolean(rotationLocks[axis]);
        return {
          value,
          disabled: !gizmoModes.rotatable || locked,
          backgroundColor: gizmoModes.rotatable ? backgroundColor : '',
        };
      }),
      keyButtons: {
        positionEnabled,
        rotationEnabled,
        label: t(langData, 'Save Bone Keyframe', 'Save bone keyframe'),
      },
      rotationLocks: {
        enabled: gizmoModes.rotatable,
        values: rotationLocks,
        labels: {
          lock: t(langData, 'Lock Bone Rotation', 'Lock bone rotation'),
          unlock: t(langData, 'Unlock Bone Rotation', 'Unlock bone rotation'),
        },
      },
      child: getChildPanelState(local, langData),
      ik: getIkPanelState(displayBoneContext, resolvedInstance, langData),
    };
  }

  return {
    getPanelState,
  };
}
