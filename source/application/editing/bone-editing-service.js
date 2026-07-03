import { vec3, quat } from '../../lib/esm/index.js';
import { getBoneInfoDisplayLocalPosition, getBoneInfoDisplayValues, getBoneInfoDisplayWorldPosition, getEffectiveLocalRotation } from '../../shared/bones/bone-display-utils.js';
import { quaternionFromEulerXYZ } from '../../shared/math/math-utils.js';
import { findBoneIndexByName, getBone } from '../../core/model/model-scene.js';

/**
 * Creates the bone editing application service.
 * @param {object} options - Service options.
 * @returns {object} Bone editing service.
 */
export function createBoneEditingService(options) {
  const inspectorState = options.inspectorState ?? options.selection ?? {};
  /**
   * Syncs the cached editing display values with current numeric inputs.
   * @param {number} boneIndex - Target bone index.
   * @param {number} posX - X position.
   * @param {number} posY - Y position.
   * @param {number} posZ - Z position.
   * @param {number} rotX - X rotation in radians.
   * @param {number} rotY - Y rotation in radians.
   * @param {number} rotZ - Z rotation in radians.
   */
  function syncBoneInputDisplayCaches(boneIndex, posX, posY, posZ, rotX, rotY, rotZ) {
    if (!Number.isInteger(boneIndex) || boneIndex < 0 || !inspectorState) {
      return;
    }

    const rotationDegrees = [
      rotX * 180 / Math.PI,
      rotY * 180 / Math.PI,
      rotZ * 180 / Math.PI,
    ];

    options.setBoneInfoUiState?.(
      inspectorState.boneInfoUiState,
      boneIndex,
      inspectorState.useWorldCoordinate ? 'world' : 'local',
      [posX, posY, posZ],
      rotationDegrees,
    );
    inspectorState.prevEuler[0] = rotX;
    inspectorState.prevEuler[1] = rotY;
    inspectorState.prevEuler[2] = rotZ;

    if (inspectorState.useWorldCoordinate) {
      options.setWorldRotationDisplay?.(inspectorState.worldRotationUiState, boneIndex, [rotX, rotY, rotZ]);
    }
  }

  /**
   * Applies the current bone info input values to selected targets.
   * @param {object} values - Input values in degrees/meters.
   * @returns {boolean} True when an edit was applied.
   */
  function applyBoneInputChange(values) {
    const {
      posX,
      posY,
      posZ,
      rotXDeg,
      rotYDeg,
      rotZDeg,
    } = values ?? {};

    if (
      !Number.isFinite(posX)
      || !Number.isFinite(posY)
      || !Number.isFinite(posZ)
      || !Number.isFinite(rotXDeg)
      || !Number.isFinite(rotYDeg)
      || !Number.isFinite(rotZDeg)
    ) {
      return false;
    }

    const rotX = rotXDeg * Math.PI / 180;
    const rotY = rotYDeg * Math.PI / 180;
    const rotZ = rotZDeg * Math.PI / 180;
    const quatRot = quaternionFromEulerXYZ([rotX, rotY, rotZ], quat.create());
    const boneEditTargets = options.getBoneEditTargets();
    const positionTargets = options.filterBoneEditTargetsByMode(boneEditTargets, 'translation');
    const rotationTargets = options.filterBoneEditTargetsByMode(boneEditTargets, 'rotation');
    if (positionTargets.length === 0 && rotationTargets.length === 0) {
      return false;
    }

    const modelManager = options.modelManager;

    for (const target of positionTargets) {
      if (inspectorState.useWorldCoordinate) {
        modelManager.setManualWorldPosition(target.instance, target.boneIndex, [posX, posY, posZ]);
      } else {
        modelManager.setManualLocalPosition(
          target.instance,
          target.boneIndex,
          options.getLocalPositionFromBoneInfoDisplayPosition(target.instance, target.boneIndex, [posX, posY, posZ]),
        );
      }
    }

    for (const target of rotationTargets) {
      const targetBone = getBone(target.instance.model, target.boneIndex);
      const currentRotation = inspectorState.useWorldCoordinate
        ? quat.clone(target.local.worldRotation)
        : getBoneInfoDisplayValues(target.instance, target.boneIndex, false).rotation;
      const constrainedRotation = options.constrainRotationToBoneLocks(targetBone, currentRotation, quatRot);
      if (inspectorState.useWorldCoordinate) {
        modelManager.setManualWorldRotationQuaternion(target.instance, target.boneIndex, constrainedRotation);
      } else {
        modelManager.setManualLocalRotationQuaternion(
          target.instance,
          target.boneIndex,
          options.getLocalRotationFromBoneInfoDisplayRotation(target.instance, target.boneIndex, constrainedRotation),
        );
      }
    }

    const selectedBoneContext = options.resolveActiveBoneContext(options.modelManager, selection);
    const selectedBoneIndex = selectedBoneContext ? selectedBoneContext.activeBoneIndex : -1;
    syncBoneInputDisplayCaches(selectedBoneIndex, posX, posY, posZ, rotX, rotY, rotZ);
    return true;
  }

  /**
   * Returns child editing targets.
   * @returns {Array<object>} Editing targets.
   */
  function getChildEditTargets() {
    const activeBoneContext = options.resolveActiveBoneContext(options.modelManager, options.selection);
    return activeBoneContext ? [activeBoneContext] : [];
  }

  /**
   * Updates child bone target selection.
   * @param {number} targetModelIndex - Target model index.
   * @param {number} targetBoneIndex - Target bone index.
   * @param {boolean} enabled - Whether child mode is enabled.
   * @param {number} influence - Influence value.
   * @returns {boolean} True when updated.
   */
  function updateChildTargets(targetModelIndex, targetBoneIndex, enabled, influence) {
    const boneEditTargets = getChildEditTargets();
    if (boneEditTargets.length === 0) {
      return false;
    }

    for (const target of boneEditTargets) {
      options.modelManager.setChildTarget(
        target.instance,
        target.boneIndex,
        Number.isInteger(targetModelIndex) ? targetModelIndex : -1,
        Number.isInteger(targetBoneIndex) ? targetBoneIndex : -1,
      );
      if (enabled) {
        options.modelManager.setChildEnabled(target.instance, target.boneIndex, true, influence);
      }
    }
    return true;
  }

  /**
   * Updates child mode enabled state.
   * @param {boolean} enabled - Enabled state.
   * @param {number} influence - Influence value.
   * @returns {boolean} True when updated.
   */
  function updateChildEnabled(enabled, influence) {
    const boneEditTargets = getChildEditTargets();
    if (boneEditTargets.length === 0) {
      return false;
    }

    for (const target of boneEditTargets) {
      options.modelManager.setChildEnabled(target.instance, target.boneIndex, enabled, influence);
    }
    return true;
  }

  /**
   * Updates child influence.
   * @param {number} influence - Influence value.
   * @returns {boolean} True when updated.
   */
  function updateChildInfluence(influence) {
    const boneEditTargets = getChildEditTargets();
    if (boneEditTargets.length === 0) {
      return false;
    }

    for (const target of boneEditTargets) {
      options.modelManager.setChildInfluence(target.instance, target.boneIndex, influence);
    }
    return true;
  }

  /**
   * Sets inverse child relation.
   * @returns {boolean} True when updated.
   */
  function setChildInverse() {
    const boneEditTargets = getChildEditTargets();
    for (const target of boneEditTargets) {
      options.modelManager.setChildInverse(target.instance, target.boneIndex);
    }
    return boneEditTargets.length > 0;
  }

  /**
   * Clears inverse child relation.
   * @returns {boolean} True when updated.
   */
  function clearChildInverse() {
    const boneEditTargets = getChildEditTargets();
    for (const target of boneEditTargets) {
      options.modelManager.clearChildInverse(target.instance, target.boneIndex);
    }
    return boneEditTargets.length > 0;
  }

  /**
   * Registers a bone keyframe.
   * @param {'all'|'translation'|'rotation'} mode - Keyframe mode.
   * @returns {boolean} True when registered.
   */
  function registerBoneKeyframe(mode = 'all') {
    const boneEditTargets = options.getBoneEditTargets();
    const eligibleTargets = options.filterBoneEditTargetsByMode(boneEditTargets, mode);
    if (eligibleTargets.length === 0) {
      return false;
    }

    return options.timelineOrchestrationService?.registerBoneKeyframe?.({ mode }) ?? false;
  }

  /**
   * Resets manual bone translation.
   * @returns {boolean} True when reset.
   */
  function resetBoneTranslation() {
    const boneEditTargets = options.getBoneEditTargets();
    if (boneEditTargets.length === 0) {
      return false;
    }

    for (const target of boneEditTargets) {
      options.modelManager.resetManualTranslation(target.instance, target.boneIndex);
    }
    return true;
  }

  /**
   * Resets manual bone rotation.
   * @returns {boolean} True when reset.
   */
  function resetBoneRotation() {
    const boneEditTargets = options.getBoneEditTargets();
    if (boneEditTargets.length === 0) {
      return false;
    }

    for (const target of boneEditTargets) {
      options.modelManager.resetManualRotation(target.instance, target.boneIndex);
    }
    return true;
  }

  /**
   * Resolves the opposite-side bone index.
   * @param {object} inst - Target model instance.
   * @param {number} boneIndex - Source bone index.
   * @returns {number} Opposite bone index or -1.
   */
  function getOppositeBoneIndex(inst, boneIndex) {
    const bone = getBone(inst.model, boneIndex);
    const name = bone?.name || '';
    const nameEn = bone?.nameEn || '';
    const rules = [
      { from: /^左/, to: '右' }, { from: /^右/, to: '左' },
      { from: /左$/, to: '右' }, { from: /右$/, to: '左' },
      { from: /^Left/i, to: 'Right' }, { from: /^Right/i, to: 'Left' },
      { from: /Left$/i, to: 'Right' }, { from: /Right$/i, to: 'Left' },
      { from: /\.l$/i, to: '.r' }, { from: /\.r$/i, to: '.l' },
      { from: /_l$/i, to: '_r' }, { from: /_r$/i, to: '_l' },
      { from: /_L$/i, to: '_R' }, { from: /_R$/i, to: '_L' },
      { from: /\.left$/i, to: '.right' }, { from: /\.right$/i, to: '.left' },
    ];

    let targetName = null;
    for (const rule of rules) {
      if (rule.from.test(name)) {
        targetName = name.replace(rule.from, rule.to);
        break;
      }
      if (rule.from.test(nameEn)) {
        const newEn = nameEn.replace(rule.from, rule.to);
        const foundIndex = inst.model.bones.findIndex((candidate) => candidate.nameEn && candidate.nameEn.toLowerCase() === newEn.toLowerCase());
        if (foundIndex !== -1) {
          return foundIndex;
        }
      }
    }

    if (targetName) {
      return findBoneIndexByName(inst.model, targetName);
    }

    return -1;
  }

  const boneClipboard = {
    pos: null,
    rot: null,
  };

  /**
   * Copies the current selected bone position.
   * @returns {boolean} True when copied.
   */
  function copyBonePos() {
    const selectedBoneContext = options.getSelectedBoneContext();
    if (!selectedBoneContext) {
      return false;
    }

    boneClipboard.pos = inspectorState.useWorldCoordinate
      ? getBoneInfoDisplayWorldPosition(selectedBoneContext.instance, selectedBoneContext.selectedBoneIndex)
      : getBoneInfoDisplayLocalPosition(selectedBoneContext.instance, selectedBoneContext.selectedBoneIndex);
    return true;
  }

  /**
   * Pastes the copied bone position.
   * @param {boolean} flip - Whether to mirror X and use opposite bone.
   * @returns {boolean} True when pasted.
   */
  function pasteBonePos(flip = false) {
    if (!boneClipboard.pos) {
      return false;
    }
    const selectedBoneContext = options.getSelectedBoneContext();
    if (!selectedBoneContext) {
      return false;
    }

    const inst = selectedBoneContext.instance;
    let targetIdx = selectedBoneContext.selectedBoneIndex;
    if (flip && targetIdx !== -1) {
      targetIdx = getOppositeBoneIndex(inst, targetIdx);
    }
    if (targetIdx === -1) {
      return false;
    }

    const value = vec3.clone(boneClipboard.pos);
    if (flip) {
      value[0] = -value[0];
    }

    if (inspectorState.useWorldCoordinate) {
      options.modelManager.setManualWorldPosition(inst, targetIdx, value);
    } else {
      options.modelManager.setManualLocalPosition(inst, targetIdx, options.getLocalPositionFromBoneInfoDisplayPosition(inst, targetIdx, value));
    }
    return true;
  }

  /**
   * Copies the current selected bone rotation.
   * @returns {boolean} True when copied.
   */
  function copyBoneRot() {
    const selectedBoneContext = options.getSelectedBoneContext();
    if (!selectedBoneContext) {
      return false;
    }

    const { local } = selectedBoneContext;
    boneClipboard.rot = inspectorState.useWorldCoordinate
      ? quat.clone(local.worldRotation)
      : getEffectiveLocalRotation(local);
    return true;
  }

  /**
   * Pastes the copied bone rotation.
   * @param {boolean} flip - Whether to mirror rotation and use opposite bone.
   * @returns {boolean} True when pasted.
   */
  function pasteBoneRot(flip = false) {
    if (!boneClipboard.rot) {
      return false;
    }
    const selectedBoneContext = options.getSelectedBoneContext();
    if (!selectedBoneContext) {
      return false;
    }

    const inst = selectedBoneContext.instance;
    let targetIdx = selectedBoneContext.selectedBoneIndex;
    if (flip && targetIdx !== -1) {
      targetIdx = getOppositeBoneIndex(inst, targetIdx);
    }
    if (targetIdx === -1) {
      return false;
    }

    const targetBone = getBone(inst.model, targetIdx);
    const targetLocal = inst.scene.boneLocalTransforms[targetIdx];
    const value = quat.clone(boneClipboard.rot);
    if (flip) {
      value[1] = -value[1];
      value[2] = -value[2];
    }

    const currentRotation = inspectorState.useWorldCoordinate
      ? quat.clone(targetLocal.worldRotation)
      : getEffectiveLocalRotation(targetLocal);
    const constrainedRotation = options.constrainRotationToBoneLocks(targetBone, currentRotation, value);
    if (inspectorState.useWorldCoordinate) {
      options.modelManager.setManualWorldRotationQuaternion(inst, targetIdx, constrainedRotation);
    } else {
      options.modelManager.setManualLocalRotationQuaternion(inst, targetIdx, constrainedRotation);
    }
    return true;
  }

  /**
   * Resolves the current IK selection context.
   * @returns {object|null} IK context.
   */
  function resolveActiveIkContext() {
    const activeBoneContext = options.resolveActiveBoneContext(options.modelManager, options.selection);
    if (!activeBoneContext) {
      return null;
    }

    const ikList = Array.isArray(activeBoneContext.instance.model?.ik) ? activeBoneContext.instance.model.ik : [];
    const ikIndex = ikList.findIndex((ik) => ik && ik.boneIndex === activeBoneContext.activeBoneIndex);
    if (ikIndex < 0) {
      return null;
    }

    return {
      ...activeBoneContext,
      ikIndex,
      ik: ikList[ikIndex],
    };
  }

  /**
   * Applies an IK enabled state.
   * @param {boolean} nextEnabled - Next enabled state.
   * @returns {boolean} True when updated.
   */
  function applyIkEnabled(nextEnabled) {
    const selectedIkContext = resolveActiveIkContext();
    if (!selectedIkContext) {
      return false;
    }

    const { instance, ik } = selectedIkContext;
    ik.enabled = Boolean(nextEnabled);
    options.syncModelIkEntryAliases(instance.model, selectedIkContext.ikIndex, ik);
    options.refreshSceneIkState(instance.scene, instance.model);
    return true;
  }

  /**
   * Applies a new IK target.
   * @param {number} nextTargetBoneIndex - Next target bone index.
   * @returns {boolean} True when updated.
   */
  function applyIkTarget(nextTargetBoneIndex) {
    const selectedIkContext = resolveActiveIkContext();
    if (!selectedIkContext || !Number.isInteger(nextTargetBoneIndex) || nextTargetBoneIndex < 0) {
      return false;
    }

    const { instance, ik, activeBoneIndex } = selectedIkContext;
    if (ik.boneIndex !== activeBoneIndex) {
      return false;
    }

    const previousBones = instance.model.bones.slice();
    options.updateRuntimeIkTargetRestPosition(instance.model, {
      ikIndex: selectedIkContext.ikIndex,
      targetBoneIndex: nextTargetBoneIndex,
    });
    options.rebuildModelIkLinks(instance.model, ik, Array.isArray(ik.links) && ik.links.length > 0 ? ik.links.length : 1);
    options.syncModelIkEntryAliases(instance.model, selectedIkContext.ikIndex, ik);
    options.modelManager.rebuildInstanceScene(instance, options.physicsEngine, previousBones);
    return true;
  }

  /**
   * Applies a new IK chain count.
   * @param {number} nextChainCount - Next chain count.
   * @returns {boolean} True when updated.
   */
  function applyIkChainCount(nextChainCount) {
    const selectedIkContext = resolveActiveIkContext();
    if (!selectedIkContext) {
      return false;
    }

    const { instance, ik } = selectedIkContext;
    if (!Number.isInteger(ik.targetBoneIndex) || ik.targetBoneIndex < 0) {
      return false;
    }

    options.rebuildModelIkLinks(instance.model, ik, nextChainCount);
    options.syncModelIkEntryAliases(instance.model, selectedIkContext.ikIndex, ik);
    options.refreshSceneIkState(instance.scene, instance.model);
    return true;
  }

  /**
   * Applies a new IK iteration count.
   * @param {number} nextIterationCount - Next iteration count.
   * @returns {boolean} True when updated.
   */
  function applyIkIterationCount(nextIterationCount) {
    const selectedIkContext = resolveActiveIkContext();
    if (!selectedIkContext) {
      return false;
    }

    const { instance, ik } = selectedIkContext;
    const normalizedIterationCount = Math.max(1, Math.round(Number(nextIterationCount) || 1));
    ik.loopCount = normalizedIterationCount;
    ik.iteration = normalizedIterationCount;
    options.syncModelIkEntryAliases(instance.model, selectedIkContext.ikIndex, ik);
    options.refreshSceneIkState(instance.scene, instance.model);
    return true;
  }

  /**
   * Toggles an IK rotation lock axis.
   * @param {'x'|'y'|'z'} axis - Target axis.
   * @returns {boolean} True when updated.
   */
  function applyIkRotationLock(axis) {
    if (!['x', 'y', 'z'].includes(axis)) {
      return false;
    }

    const activeBoneContext = options.resolveActiveBoneContext(options.modelManager, options.selection);
    const bone = activeBoneContext?.bone;
    if (!bone) {
      return false;
    }

    const locks = options.getBoneIkRotationLocks(bone);
    options.setBoneIkRotationLocks(bone, {
      ...locks,
      [axis]: !locks[axis],
    });
    return true;
  }

  /**
   * Toggles a standard bone rotation lock axis.
   * @param {'x'|'y'|'z'} axis - Target axis.
   * @returns {boolean} True when updated.
   */
  function applyRotationLock(axis) {
    if (!['x', 'y', 'z'].includes(axis)) {
      return false;
    }

    const activeBoneContext = options.resolveActiveBoneContext(options.modelManager, options.selection);
    const bone = activeBoneContext?.bone;
    if (!bone) {
      return false;
    }

    const locks = options.getBoneRotationLocks(bone);
    options.setBoneRotationLocks(bone, {
      ...locks,
      [axis]: !locks[axis],
    });
    return true;
  }

  /**
   * Creates a runtime IK on the selected bone.
   * @returns {boolean} True when created.
   */
  function applyCreateIk() {
    const activeBoneContext = options.resolveActiveBoneContext(options.modelManager, options.selection);
    if (!activeBoneContext) {
      return false;
    }

    const previousBones = activeBoneContext.instance.model.bones.slice();
    const { model } = activeBoneContext.instance;
    const createdIk = options.createRuntimeIkSetup(model, {
      setupBoneIndex: activeBoneContext.activeBoneIndex,
    });
    options.modelManager.rebuildInstanceScene(activeBoneContext.instance, options.physicsEngine, previousBones);
    options.setSingleBoneSelection(options.selection, createdIk.ikBoneIndex);
    options.selection.selectedTargetIndex = -1;
    options.selection.selectedRigidbodyIndex = -1;
    inspectorState.lastSelectedBoneIndex = -1;
    options.clearWorldRotationDisplay(inspectorState.worldRotationUiState);
    return true;
  }

  /**
   * Deletes the current runtime IK.
   * @returns {boolean} True when deleted.
   */
  function applyDeleteIk() {
    const selectedIkContext = resolveActiveIkContext();
    if (!selectedIkContext) {
      return false;
    }

    const previousBones = selectedIkContext.instance.model.bones.slice();
    const result = options.removeRuntimeIkSetup(selectedIkContext.instance.model, {
      ikIndex: selectedIkContext.ikIndex,
    });
    options.modelManager.rebuildInstanceScene(selectedIkContext.instance, options.physicsEngine, previousBones);
    options.setSingleBoneSelection(
      options.selection,
      Number.isInteger(result.setupBoneIndex) && result.setupBoneIndex >= 0
        ? result.setupBoneIndex
        : result.effectorBoneIndex,
    );
    options.selection.selectedTargetIndex = -1;
    options.selection.selectedRigidbodyIndex = -1;
    inspectorState.lastSelectedBoneIndex = -1;
    options.clearWorldRotationDisplay(inspectorState.worldRotationUiState);
    return true;
  }

  /**
   * Builds VPD export data for the selected bones.
   * @returns {{fileName: string, buffer: ArrayBuffer}|null} Export payload.
   */
  function buildSelectedBoneVpdExport() {
    const activeInstance = options.getActiveInstance?.();
    if (!activeInstance) {
      return null;
    }

    const selectedBoneIndices = options.getSelectedBoneIndices(options.selection, activeInstance);
    if (selectedBoneIndices.length === 0) {
      return null;
    }

    const vpdData = options.buildVpdPoseData?.(activeInstance, selectedBoneIndices);
    if (!vpdData || !Array.isArray(vpdData.bones) || vpdData.bones.length === 0) {
      return null;
    }

    const buffer = options.vpdWriter?.write?.(options.denormalizeVpdFromInternalUnits?.(vpdData) ?? vpdData);
    if (!buffer) {
      return null;
    }

    return {
      fileName: options.createVpdDownloadName?.(activeInstance.model?.name || vpdData.modelName) || 'pose.vpd',
      buffer,
    };
  }

  /**
   * Applies timeline-driven bone selection.
   * @param {object|null} track - Timeline track.
   * @param {object|null} keyframeEntry - Selected keyframe.
   * @returns {{shouldRefresh: boolean, interpolation: ArrayLike<number>|null}|null} Sync result.
   */
  function handleTimelineBoneSelection(track, keyframeEntry) {
    if (!track || track.category !== 'bone') {
      return null;
    }

    const activeInstance = options.getActiveInstance?.();
    if (!activeInstance) {
      return null;
    }

    const boneIndex = findBoneIndexByName(activeInstance.model, track.label);
    if (boneIndex === -1) {
      return null;
    }

    options.setSingleBoneSelection(options.selection, boneIndex);
    options.selection.selectedTargetIndex = -1;
    options.selection.selectedRigidbodyIndex = -1;

    const selectedEntries = Array.isArray(options.getSelectedTimelineEntries?.())
      ? options.getSelectedTimelineEntries()
      : [];
    const interpolation = keyframeEntry
      && selectedEntries.length === 1
      && keyframeEntry.source
      && keyframeEntry.source.interpolation
      ? keyframeEntry.source.interpolation
      : null;

    return {
      shouldRefresh: true,
      interpolation,
    };
  }

  return {
    syncBoneInputDisplayCaches,
    applyBoneInputChange,
    updateChildTargets,
    updateChildEnabled,
    updateChildInfluence,
    setChildInverse,
    clearChildInverse,
    registerBoneKeyframe,
    resetBoneTranslation,
    resetBoneRotation,
    copyBonePos,
    pasteBonePos,
    copyBoneRot,
    pasteBoneRot,
    applyRotationLock,
    resolveActiveIkContext,
    applyIkEnabled,
    applyIkTarget,
    applyIkChainCount,
    applyIkIterationCount,
    applyIkRotationLock,
    applyCreateIk,
    applyDeleteIk,
    buildSelectedBoneVpdExport,
    handleTimelineBoneSelection,
  };
}
