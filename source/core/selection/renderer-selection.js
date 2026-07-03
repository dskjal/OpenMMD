/**
 * レンダラーの選択状態を扱う helper です。
 */

/**
 * 現在のアクティブインスタンスを返します。
 * @param {object|null} modelManager - モデル管理インスタンス。
 * @param {object} selection - 現在の選択状態。
 * @returns {object|null} アクティブインスタンス。
 */
export function resolveActiveInstance(modelManager, selection) {
  if (!modelManager || !Array.isArray(modelManager.instances)) {
    return null;
  }

  const index = Number.isInteger(selection?.activeInstanceIndex)
    ? selection.activeInstanceIndex
    : -1;
  if (index < 0 || index >= modelManager.instances.length) {
    return null;
  }

  return modelManager.instances[index] || null;
}

/**
 * インスタンス切り替え時に選択状態を初期化します。
 * @param {object} selection - 現在の選択状態。
 */
export function resetSelectionForInstanceChange(selection) {
  selection.selectedBoneIndex = -1;
  selection.selectedBoneIndices = [];
  selection.activeBoneIndex = -1;
  selection.selectedTargetIndex = -1;
  selection.selectedRigidbodyIndex = -1;
  selection.selectedLight = false;
}

/**
 * ボーン選択をすべて解除します。
 * @param {object} selection - 現在の選択状態。
 */
export function clearBoneSelection(selection) {
  selection.selectedBoneIndex = -1;
  selection.selectedBoneIndices = [];
  selection.activeBoneIndex = -1;
}

/**
 * ライト選択を解除します。
 * @param {object} selection - 現在の選択状態。
 */
export function clearLightSelection(selection) {
  selection.selectedLight = false;
}

/**
 * ライトを選択します。
 * @param {object} selection - 現在の選択状態。
 */
export function setLightSelection(selection) {
  clearBoneSelection(selection);
  selection.selectedTargetIndex = -1;
  selection.selectedRigidbodyIndex = -1;
  selection.selectedLight = true;
}

/**
 * 単一ボーンを選択します。
 * @param {object} selection - 現在の選択状態。
 * @param {number} boneIndex - 選択するボーンインデックス。
 */
export function setSingleBoneSelection(selection, boneIndex) {
  if (!Number.isInteger(boneIndex) || boneIndex < 0) {
    clearBoneSelection(selection);
    return;
  }

  clearLightSelection(selection);
  selection.selectedBoneIndices = [boneIndex];
  selection.activeBoneIndex = boneIndex;
  selection.selectedBoneIndex = boneIndex;
}

/**
 * 複数ボーンを選択します。
 * @param {object} selection - 現在の選択状態。
 * @param {Array<number>} boneIndices - 選択するボーンインデックス一覧。
 * @param {object} [options={}] - 選択オプション。
 * @param {number} [options.activeBoneIndex=-1] - 明示的なアクティブボーン。
 */
export function setMultiBoneSelection(selection, boneIndices, options = {}) {
  const dedupedIndices = [];
  for (const boneIndex of Array.isArray(boneIndices) ? boneIndices : []) {
    if (!Number.isInteger(boneIndex) || boneIndex < 0 || dedupedIndices.includes(boneIndex)) {
      continue;
    }
    dedupedIndices.push(boneIndex);
  }

  if (dedupedIndices.length === 0) {
    clearBoneSelection(selection);
    return;
  }

  clearLightSelection(selection);
  selection.selectedBoneIndices = dedupedIndices;
  const activeBoneIndex = Number.isInteger(options.activeBoneIndex) ? options.activeBoneIndex : -1;
  if (dedupedIndices.length === 1) {
    selection.activeBoneIndex = dedupedIndices[0];
    selection.selectedBoneIndex = dedupedIndices[0];
    return;
  }

  if (activeBoneIndex >= 0 && dedupedIndices.includes(activeBoneIndex)) {
    selection.activeBoneIndex = activeBoneIndex;
    selection.selectedBoneIndex = activeBoneIndex;
  } else {
    selection.activeBoneIndex = -1;
    selection.selectedBoneIndex = -1;
  }
}

/**
 * ボーン選択をトグルします。
 * @param {object} selection - 現在の選択状態。
 * @param {number} boneIndex - トグル対象ボーンインデックス。
 */
export function toggleBoneSelection(selection, boneIndex) {
  if (!Number.isInteger(boneIndex) || boneIndex < 0) {
    return;
  }

  clearLightSelection(selection);
  const currentIndices = Array.isArray(selection.selectedBoneIndices) ? selection.selectedBoneIndices.slice() : [];
  const existingIndex = currentIndices.indexOf(boneIndex);
  if (existingIndex === -1) {
    currentIndices.push(boneIndex);
    selection.selectedBoneIndices = currentIndices;
    selection.activeBoneIndex = boneIndex;
    selection.selectedBoneIndex = boneIndex;
    return;
  }

  currentIndices.splice(existingIndex, 1);
  selection.selectedBoneIndices = currentIndices;
  if (currentIndices.length === 0) {
    clearBoneSelection(selection);
    return;
  }

  if (selection.activeBoneIndex === boneIndex) {
    const nextActiveBoneIndex = currentIndices[currentIndices.length - 1];
    selection.activeBoneIndex = nextActiveBoneIndex;
    selection.selectedBoneIndex = nextActiveBoneIndex;
    return;
  }

  if (currentIndices.length === 1) {
    selection.activeBoneIndex = currentIndices[0];
    selection.selectedBoneIndex = currentIndices[0];
    return;
  }

  if (!currentIndices.includes(selection.activeBoneIndex)) {
    const nextActiveBoneIndex = currentIndices[currentIndices.length - 1];
    selection.activeBoneIndex = nextActiveBoneIndex;
    selection.selectedBoneIndex = nextActiveBoneIndex;
    return;
  }

  selection.selectedBoneIndex = selection.activeBoneIndex;
}

/**
 * ボーン選択ヒットを selection に反映します。
 * @param {object} selection - 現在の選択状態。
 * @param {number} boneIndex - 選択対象ボーン。
 * @param {number} targetIndex - IK ターゲット index。
 * @param {boolean} additive - 追加選択かどうか。
 */
export function applyBoneSelectionFromHit(selection, boneIndex, targetIndex, additive) {
  if (!Number.isInteger(boneIndex) || boneIndex < 0) {
    return;
  }

  clearLightSelection(selection);
  if (additive) {
    const currentIndices = getSelectedBoneIndices(selection, null);
    const existingIndex = currentIndices.indexOf(boneIndex);
    if (existingIndex !== -1) {
      currentIndices.splice(existingIndex, 1);
      if (currentIndices.length === 0) {
        clearBoneSelection(selection);
      } else if (currentIndices.length === 1) {
        setSingleBoneSelection(selection, currentIndices[0]);
      } else {
        setMultiBoneSelection(selection, currentIndices, { activeBoneIndex: currentIndices[currentIndices.length - 1] });
      }
    } else {
      currentIndices.push(boneIndex);
      setMultiBoneSelection(selection, currentIndices, { activeBoneIndex: boneIndex });
    }
  } else {
    setSingleBoneSelection(selection, boneIndex);
  }

  selection.selectedTargetIndex = Array.isArray(selection.selectedBoneIndices) && selection.selectedBoneIndices.includes(boneIndex)
    ? targetIndex
    : -1;
  selection.selectedRigidbodyIndex = -1;
}

/**
 * ボックス選択の結果を selection に反映します。
 * @param {object} selection - 現在の選択状態。
 * @param {Array<number>} boneIndices - 選択されたボーン一覧。
 * @param {boolean} additive - 追加選択かどうか。
 */
export function applyBoneBoxSelection(selection, boneIndices, additive) {
  const dedupedIndices = [];
  for (const boneIndex of Array.isArray(boneIndices) ? boneIndices : []) {
    if (!Number.isInteger(boneIndex) || boneIndex < 0 || dedupedIndices.includes(boneIndex)) {
      continue;
    }
    dedupedIndices.push(boneIndex);
  }

  if (dedupedIndices.length === 0) {
    clearBoneSelection(selection);
    selection.selectedTargetIndex = -1;
    selection.selectedRigidbodyIndex = -1;
    clearLightSelection(selection);
    return;
  }

  clearLightSelection(selection);
  if (additive) {
    const currentIndices = getSelectedBoneIndices(selection, null);
    const mergedIndices = Array.from(new Set([
      ...currentIndices,
      ...dedupedIndices,
    ])).sort((a, b) => a - b);
    if (mergedIndices.length === 1) {
      setSingleBoneSelection(selection, mergedIndices[0]);
    } else {
      setMultiBoneSelection(selection, mergedIndices, { activeBoneIndex: -1 });
    }
  } else if (dedupedIndices.length === 1) {
    setSingleBoneSelection(selection, dedupedIndices[0]);
  } else {
    setMultiBoneSelection(selection, dedupedIndices, { activeBoneIndex: -1 });
  }

  selection.selectedTargetIndex = -1;
  selection.selectedRigidbodyIndex = -1;
}

/**
 * モデル切替時に既定で選択するボーンインデックスを返します。
 * @param {object|null} model - モデルデータ。
 * @returns {number} 既定ボーンインデックス。該当なしの場合は -1。
 */
export function resolveDefaultSelectedBoneIndex(model) {
  if (!model || !Array.isArray(model.bones) || model.bones.length === 0) {
    return -1;
  }

  if (model.hasDummyBone === true) {
    const dummyBoneIndex = Number.isInteger(model.dummyBoneIndex) ? model.dummyBoneIndex : 0;
    if (dummyBoneIndex >= 0 && dummyBoneIndex < model.bones.length) {
      return dummyBoneIndex;
    }
  }

  return -1;
}

/**
 * 現在のボーン選択インデックスを返します。
 * IK ターゲットが選択されている場合は、その対応ボーンを返します。
 * @param {object|null} instance - モデルインスタンス。
 * @param {object} selection - 現在の選択状態。
 * @returns {number} 選択中ボーンインデックス。該当なしの場合は -1。
 */
export function resolveSelectedBoneIndex(instance, selection) {
  const scene = instance?.scene || instance || null;
  const selectedBoneIndices = Array.isArray(selection?.selectedBoneIndices) ? selection.selectedBoneIndices : [];
  const activeBoneIndex = Number.isInteger(selection?.activeBoneIndex) ? selection.activeBoneIndex : -1;
  let selectedBoneIndex = activeBoneIndex;
  if (selectedBoneIndex < 0 && selectedBoneIndices.length === 1) {
    selectedBoneIndex = selectedBoneIndices[0];
  }
  if (selectedBoneIndex < 0 && selectedBoneIndices.length === 0) {
    selectedBoneIndex = Number.isInteger(selection?.selectedBoneIndex) ? selection.selectedBoneIndex : -1;
  }
  if (selectedBoneIndex === -1 && Number.isInteger(selection?.selectedTargetIndex) && selection.selectedTargetIndex !== -1) {
    selectedBoneIndex = scene?.ikTargets?.[selection.selectedTargetIndex]?.boneIndex ?? -1;
  }

  return Number.isInteger(selectedBoneIndex) && selectedBoneIndex >= 0 ? selectedBoneIndex : -1;
}

/**
 * 選択中のボーンインデックス一覧を返します。
 * @param {object} selection - 現在の選択状態。
 * @param {object|null} instance - モデルインスタンス。
 * @returns {Array<number>} 選択中ボーンインデックスの配列。
 */
export function getSelectedBoneIndices(selection, instance) {
  const selectedBoneIndices = [];
  const sourceIndices = Array.isArray(selection?.selectedBoneIndices) ? selection.selectedBoneIndices : [];

  for (const value of sourceIndices) {
    if (!Number.isInteger(value) || value < 0 || selectedBoneIndices.includes(value)) {
      continue;
    }
    selectedBoneIndices.push(value);
  }

  if (selectedBoneIndices.length > 0) {
    return selectedBoneIndices;
  }

  const activeBoneIndex = Number.isInteger(selection?.activeBoneIndex) ? selection.activeBoneIndex : -1;
  if (activeBoneIndex >= 0) {
    selectedBoneIndices.push(activeBoneIndex);
    return selectedBoneIndices;
  }

  const selectedBoneIndex = resolveSelectedBoneIndex(instance, selection);
  if (selectedBoneIndex >= 0) {
    selectedBoneIndices.push(selectedBoneIndex);
  }

  return selectedBoneIndices;
}

/**
 * 現在のアクティブボーンの選択コンテキストを返します。
 * @param {object|null} modelManager - モデル管理インスタンス。
 * @param {object} selection - 現在の選択状態。
 * @returns {{instance: object, activeBoneIndex: number, boneIndex: number, bone: object, local: object, bindBone: object}|null} 選択コンテキスト。
 */
export function resolveActiveBoneContext(modelManager, selection) {
  const instance = resolveActiveInstance(modelManager, selection);
  if (!instance) {
    return null;
  }

  const activeBoneIndex = Number.isInteger(selection?.activeBoneIndex)
    ? selection.activeBoneIndex
    : resolveSelectedBoneIndex(instance, selection);
  if (activeBoneIndex < 0) {
    return null;
  }

  const local = instance.scene.boneLocalTransforms?.[activeBoneIndex] || null;
  const bone = instance.model.bones?.[activeBoneIndex] || null;
  const bindBone = instance.model.bindBones?.[activeBoneIndex] || null;
  if (!local || !bone || !bindBone) {
    return null;
  }

  return {
    instance,
    activeBoneIndex,
    boneIndex: activeBoneIndex,
    bone,
    local,
    bindBone,
  };
}

/**
 * 現在のボーン選択コンテキストを返します。
 * @param {object|null} modelManager - モデル管理インスタンス。
 * @param {object} selection - 現在の選択状態。
 * @returns {{instance: object, selectedBoneIndex: number, bone: object, local: object, bindBone: object}|null} 選択コンテキスト。
 */
export function resolveSelectedBoneContext(modelManager, selection) {
  const instance = resolveActiveInstance(modelManager, selection);
  if (!instance) {
    return null;
  }

  const selectedBoneIndex = resolveSelectedBoneIndex(instance, selection);
  if (selectedBoneIndex < 0) {
    return null;
  }

  const local = instance.scene.boneLocalTransforms?.[selectedBoneIndex] || null;
  const bone = instance.model.bones?.[selectedBoneIndex] || null;
  const bindBone = instance.model.bindBones?.[selectedBoneIndex] || null;
  if (!local || !bone || !bindBone) {
    return null;
  }

  return {
    instance,
    selectedBoneIndex,
    bone,
    local,
    bindBone,
  };
}
