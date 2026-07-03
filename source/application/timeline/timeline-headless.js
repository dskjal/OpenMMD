import { quat } from '../../lib/esm/index.js';
import {
  createTracksFromMixedSources,
} from '../../core/animation/timeline-data.js';
import {
  createEmptyAnimationClip,
  ensureAnimationClip,
  extractCameraKeyframesFromAnimationClip,
  extractLightKeyframesFromAnimationClip,
  extractSelfShadowKeyframesFromAnimationClip,
  upsertAnimationClipCameraKeyframe,
  upsertAnimationClipLightKeyframe,
  upsertAnimationClipShadowKeyframe,
} from '../../core/animation/animation-clip.js';
import { getSelectedBoneIndices, resolveSelectedBoneIndex } from '../../core/selection/renderer-selection.js';
import { getBoneGizmoModes } from '../../core/selection/gizmo.js';
import { findVrmHumanoidBoneNameByBoneName, getBone } from '../../core/model/model-scene.js';
import { getBoneInfoDisplayLocalPosition } from '../../shared/bones/bone-display-utils.js';
import {
  deleteAnimationClipKeyframes,
  upsertAnimationClipBoneKeyframe,
  upsertAnimationClipMorphKeyframe,
  upsertAnimationClipNodeKeyframe,
  upsertAnimationClipPointerKeyframe,
} from '../../infrastructure/animation/gltf-animation.js';
import {
  assignAnimationSourceToRuntimeInstance,
  createVmdAnimationSource,
  rebindAnimationSourceToRuntimeInstance,
  syncLegacyVmdDataFromAnimationSource,
} from '../animation/runtime-animation.js';

/**
 * VRMA hips translation キー保存時に補う bindTranslation を返します。
 * @param {object|null} instance - Model instance.
 * @param {number} boneIndex - Bone index.
 * @param {string} sourceBoneName - VRMA source bone name.
 * @returns {Array<number>|null} bindTranslation.
 */
function resolveVrmaHipsBindTranslation(instance, boneIndex, sourceBoneName) {
  if (String(sourceBoneName || '').trim() !== 'hips') {
    return null;
  }

  const baseTranslation = instance?.scene?.boneLocalTransforms?.[boneIndex]?.baseTranslation || null;
  if (!(Array.isArray(baseTranslation) || ArrayBuffer.isView(baseTranslation))) {
    return null;
  }
  return Array.from(baseTranslation).slice(0, 3);
}

/**
 * DOM 非依存のタイムライン view state を管理します。
 */
export class TimelineHeadlessViewState {
  constructor() {
    this.tracks = [];
    this.visibleTrackEntries = [];
    this.maxFrame = 1000;
    this.collapsedTrackIds = new Set();
    this.selectedTrackId = null;
    this.selectedTrack = null;
    this.selectedKeyframe = null;
    this.selectedKeyframeEntries = [];
  }

  /**
   * timeline source を state に反映します。
   * @param {object|null} source - Animation source.
   * @param {object|null} model - Active model.
   * @param {object} [options={}] - Update options.
   * @param {Iterable<string>|string[]} [options.collapseState] - Collapse state.
   */
  setSource(source, model, options = {}) {
    const previousSelectedTrackId = this.selectedTrackId;
    const previousSelectedEntries = this.captureSelectedKeyframeEntries();

    const modelSource = source?.modelSource ?? source ?? null;
    const sceneSources = source?.sceneSources || {};
    this.tracks = createTracksFromMixedSources(modelSource, model, sceneSources);
    this.maxFrame = 0;

    this.tracks.forEach((track) => {
      if (track.keyframes.length === 0) {
        return;
      }
      const last = track.keyframes[track.keyframes.length - 1].frame;
      if (last > this.maxFrame) {
        this.maxFrame = last;
      }
    });

    if (Object.prototype.hasOwnProperty.call(options, 'collapseState')) {
      this.collapsedTrackIds = this.normalizeCollapseState(options.collapseState);
      this.pruneCollapsedTrackIds();
    } else {
      this.pruneCollapsedTrackIds();
      if (this.collapsedTrackIds.size === 0) {
        this.collapseAllGroups();
      }
    }

    this.selectedTrack = previousSelectedTrackId ? this.findTrackById(previousSelectedTrackId) : null;
    this.selectedTrackId = this.selectedTrack ? this.selectedTrack.id : null;
    this.selectedKeyframeEntries = [];
    this.selectedKeyframe = null;
    if (this.selectedTrack && previousSelectedEntries.length > 0) {
      this.selectedKeyframeEntries = this.restoreSelectedKeyframeEntries(previousSelectedEntries);
      this.selectedKeyframe = this.selectedKeyframeEntries[0]?.keyframe || null;
      if (this.selectedKeyframeEntries.length === 0) {
        this.selectedTrack = null;
        this.selectedTrackId = null;
      }
    }

    this.visibleTrackEntries = this.getVisibleTrackEntries();
  }

  /**
   * collapse state を返します。
   * @returns {string[]}
   */
  getCollapseState() {
    return Array.from(this.collapsedTrackIds);
  }

  /**
   * collapse state を復元します。
   * @param {Iterable<string>|string[]} collapseState - Collapse state.
   */
  setCollapseState(collapseState) {
    this.collapsedTrackIds = this.normalizeCollapseState(collapseState);
    this.pruneCollapsedTrackIds();
    this.visibleTrackEntries = this.getVisibleTrackEntries();
  }

  /**
   * 名前で track を選択します。
   * @param {string} name - Track label.
   * @param {object} [options={}] - Selection options.
   * @param {boolean} [options.expandAncestors=false] - Expand parent groups when true.
   * @returns {boolean} 変更があれば true。
   */
  setSelectedTrackByName(name, options = {}) {
    const track = this.findTrackByName(name);
    if (!track) {
      if (this.selectedTrackId === null) {
        return false;
      }
      this.clearKeyframeSelection();
      return true;
    }

    if (this.selectedTrackId === track.id) {
      return false;
    }

    if (options.expandAncestors) {
      this.expandAncestors(track);
    }
    this.applySelectedKeyframeEntries(track, []);
    return true;
  }

  /**
   * ID で track を探します。
   * @param {string} id - Track id.
   * @returns {object|null}
   */
  findTrackById(id) {
    return this.tracks.find((track) => track.id === id) || null;
  }

  /**
   * ラベル名で leaf track を探します。
   * @param {string} name - Track label.
   * @returns {object|null}
   */
  findTrackByName(name) {
    const boneTrack = this.tracks.find((track) => track.category === 'bone' && track.label === name);
    if (boneTrack) {
      return boneTrack;
    }
    return this.tracks.find((track) => track.category === 'morph' && track.label === name) || null;
  }

  /**
   * 表示中の track entries を返します。
   * @returns {{track: object, depth: number}[]}
   */
  getVisibleTrackEntries() {
    const visibleEntries = [];

    this.tracks.forEach((track) => {
      if (track.hidden || track.parentId) {
        return;
      }

      visibleEntries.push({ track, depth: 0 });
      if (this.isGroupTrackCollapsed(track)) {
        return;
      }

      (track.children || []).forEach((child) => {
        visibleEntries.push({ track: child, depth: 1 });
      });
    });

    return visibleEntries;
  }

  /**
   * keyframe 群を選択します。
   * @param {object|null} track - Selected track.
   * @param {{track: object, keyframe: object}[]} entries - Keyframe entries.
   * @returns {{track: object|null, keyframe: object|null}} 選択結果。
   */
  selectKeyframes(track, entries) {
    return this.applySelectedKeyframeEntries(track, entries);
  }

  /**
   * 単一 keyframe 選択用の後方互換ヘルパーです。
   * @param {object|null} track - Selected track.
   * @param {object|null} keyframe - Selected keyframe.
   * @returns {{track: object|null, keyframe: object|null}} 選択結果。
   */
  selectTrack(track, keyframe) {
    return this.selectKeyframes(track, keyframe ? [{ track, keyframe }] : []);
  }

  /**
   * keyframe 選択をトグルします。
   * @param {object} track - Trigger track.
   * @param {{track: object, keyframe: object}[]} entries - Incoming entries.
   * @returns {{track: object|null, keyframe: object|null}|null} 更新結果。
   */
  toggleKeyframeEntries(track, entries) {
    const normalizedEntries = this.normalizeSelectedKeyframeEntries(entries);
    if (normalizedEntries.length === 0) {
      return null;
    }

    const selectedKeys = new Set(
      this.selectedKeyframeEntries.map((entry) => this.getSelectedKeyframeEntryKey(entry.track, entry.keyframe))
    );
    const incomingKeys = normalizedEntries.map((entry) => this.getSelectedKeyframeEntryKey(entry.track, entry.keyframe));
    const allSelected = incomingKeys.every((key) => selectedKeys.has(key));

    let nextEntries;
    if (allSelected) {
      const removalKeys = new Set(incomingKeys);
      nextEntries = this.selectedKeyframeEntries.filter((entry) => (
        !removalKeys.has(this.getSelectedKeyframeEntryKey(entry.track, entry.keyframe))
      ));
    } else {
      const nextMap = new Map(
        this.selectedKeyframeEntries.map((entry) => [
          this.getSelectedKeyframeEntryKey(entry.track, entry.keyframe),
          entry,
        ])
      );
      normalizedEntries.forEach((entry) => {
        nextMap.set(this.getSelectedKeyframeEntryKey(entry.track, entry.keyframe), entry);
      });
      nextEntries = Array.from(nextMap.values());
    }

    const selectedTrack = nextEntries.length === 0
      ? null
      : track.category === 'header'
        ? (allSelected ? nextEntries[0].track : track)
        : nextEntries.some((entry) => entry.track.id === track.id)
          ? track
          : nextEntries[0].track;

    return this.applySelectedKeyframeEntries(selectedTrack, nextEntries);
  }

  /**
   * 解決済みの選択状態を適用します。
   * @param {object|null} track - Selected track.
   * @param {{track: object, keyframe: object}[]} entries - Selected entries.
   * @returns {{track: object|null, keyframe: object|null}} 適用結果。
   */
  applySelectedKeyframeEntries(track, entries) {
    const normalizedEntries = this.normalizeSelectedKeyframeEntries(entries);
    this.selectedTrack = track || null;
    this.selectedTrackId = track ? track.id : null;
    this.selectedKeyframeEntries = normalizedEntries;
    this.selectedKeyframe = normalizedEntries[0]?.keyframe || null;
    this.visibleTrackEntries = this.getVisibleTrackEntries();
    return {
      track: this.selectedTrack,
      keyframe: this.selectedKeyframe,
    };
  }

  /**
   * keyframe 選択をクリアします。
   */
  clearKeyframeSelection() {
    this.selectedTrack = null;
    this.selectedTrackId = null;
    this.selectedKeyframeEntries = [];
    this.selectedKeyframe = null;
    this.visibleTrackEntries = this.getVisibleTrackEntries();
  }

  /**
   * row が選択中かどうかを返します。
   * @param {object} track - Target track.
   * @returns {boolean}
   */
  isTrackRowSelected(track) {
    if (this.selectedTrackId === track.id) {
      return true;
    }
    if (track.category !== 'header') {
      return false;
    }
    if (!this.isGroupTrackCollapsed(track)) {
      return false;
    }
    return (track.children || []).some((child) => child.id === this.selectedTrackId);
  }

  /**
   * keyframe が選択中かどうかを返します。
   * @param {object} track - Target track.
   * @param {object} keyframe - Target keyframe.
   * @returns {boolean}
   */
  isKeyframeSelected(track, keyframe) {
    return this.selectedKeyframeEntries.some((entry) => this.isSameKeyframeEntry(entry, track, keyframe));
  }

  /**
   * header keyframe が選択中かどうかを返します。
   * @param {object} track - Header track.
   * @param {object} keyframe - Header keyframe.
   * @returns {boolean}
   */
  isHeaderKeyframeSelected(track, keyframe) {
    if (this.selectedTrackId !== track.id) {
      return false;
    }
    return this.selectedKeyframeEntries.some((entry) => entry.keyframe.frame === keyframe.frame);
  }

  /**
   * display-frame group が collapse 済みかどうかを返します。
   * @param {object} track - Header track.
   * @returns {boolean}
   */
  isGroupTrackCollapsed(track) {
    return track.category === 'header'
      && (track.children || []).length > 0
      && this.collapsedTrackIds.has(track.id);
  }

  /**
   * track の祖先 group を開きます。
   * @param {object} track - Target track.
   */
  expandAncestors(track) {
    if (track.parentId) {
      this.collapsedTrackIds.delete(track.parentId);
    }
  }

  /**
   * すべての display-frame group を collapse します。
   */
  collapseAllGroups() {
    this.collapsedTrackIds = new Set(
      this.tracks
        .filter((track) => !track.hidden && track.category === 'header' && (track.children || []).length > 0)
        .map((track) => track.id)
    );
  }

  /**
   * 現在の track tree に存在しない collapse ids を除去します。
   */
  pruneCollapsedTrackIds() {
    const validIds = new Set(
      this.tracks
        .filter((track) => !track.hidden && track.category === 'header' && (track.children || []).length > 0)
        .map((track) => track.id)
    );
    this.collapsedTrackIds = new Set(
      Array.from(this.collapsedTrackIds).filter((id) => validIds.has(id))
    );
  }

  /**
   * collapse state を正規化します。
   * @param {Iterable<string>|string[]|null|undefined} collapseState - Input state.
   * @returns {Set<string>}
   */
  normalizeCollapseState(collapseState) {
    if (!collapseState) {
      return new Set();
    }
    if (collapseState instanceof Set) {
      return new Set(collapseState);
    }
    return new Set(Array.from(collapseState));
  }

  /**
   * group row の collapse 状態をトグルします。
   * @param {object} track - Group track.
   * @returns {boolean} 更新があれば true。
   */
  toggleTrackCollapse(track) {
    if (track.category !== 'header' || (track.children || []).length === 0) {
      return false;
    }

    if (this.collapsedTrackIds.has(track.id)) {
      this.collapsedTrackIds.delete(track.id);
    } else {
      this.collapsedTrackIds.add(track.id);
    }
    this.visibleTrackEntries = this.getVisibleTrackEntries();
    return true;
  }

  /**
   * 現在の選択を安定 descriptor に変換します。
   * @returns {{trackId: string, frame: number, kind: string}[]}
   */
  captureSelectedKeyframeEntries() {
    return this.selectedKeyframeEntries.map((entry) => ({
      trackId: entry.track.id,
      frame: entry.keyframe.frame,
      kind: entry.keyframe.kind,
    }));
  }

  /**
   * 安定 descriptor から選択を復元します。
   * @param {{trackId: string, frame: number, kind: string}[]} selectedEntries - Saved entries.
   * @returns {{track: object, keyframe: object}[]}
   */
  restoreSelectedKeyframeEntries(selectedEntries) {
    const restoredEntries = [];

    selectedEntries.forEach((entry) => {
      const track = this.findTrackById(entry.trackId);
      if (!track) {
        return;
      }

      const keyframe = track.keyframes.find((candidate) => (
        candidate.frame === entry.frame && candidate.kind === entry.kind
      ));
      if (!keyframe) {
        return;
      }

      restoredEntries.push({ track, keyframe });
    });

    return restoredEntries;
  }

  /**
   * 2 つの選択エントリが同一 keyframe を指すかどうかを返します。
   * @param {{track: object, keyframe: object}} entry - Existing entry.
   * @param {object} track - Candidate track.
   * @param {object} keyframe - Candidate keyframe.
   * @returns {boolean}
   */
  isSameKeyframeEntry(entry, track, keyframe) {
    return entry.track.id === track.id && entry.keyframe === keyframe;
  }

  /**
   * keyframe entry の安定キーを返します。
   * @param {object} track - Track.
   * @param {object} keyframe - Keyframe.
   * @returns {string}
   */
  getSelectedKeyframeEntryKey(track, keyframe) {
    return `${track.id}:${keyframe.kind}:${Math.round(keyframe.frame)}`;
  }

  /**
   * keyframe entry 一覧を正規化して重複を除去します。
   * @param {{track: object, keyframe: object}[]|null|undefined} entries - Input entries.
   * @returns {{track: object, keyframe: object}[]}
   */
  normalizeSelectedKeyframeEntries(entries) {
    if (!Array.isArray(entries) || entries.length === 0) {
      return [];
    }

    const normalized = [];
    const seen = new Set();
    entries.forEach((entry) => {
      if (!entry || !entry.track || !entry.keyframe) {
        return;
      }
      const key = this.getSelectedKeyframeEntryKey(entry.track, entry.keyframe);
      if (seen.has(key)) {
        return;
      }
      seen.add(key);
      normalized.push({ track: entry.track, keyframe: entry.keyframe });
    });
    return normalized;
  }

  /**
   * drag range 内の keyframe entries を集めます。
   * @param {{x: number, y: number}} start - Drag start.
   * @param {{x: number, y: number}} current - Drag current.
   * @param {object} layout - View layout metrics.
   * @param {number} layout.pixelsPerFrame - Pixels per frame.
   * @param {number} layout.rowHeight - Row height.
   * @param {number} layout.scrollLeft - Scroll left.
   * @param {number} layout.scrollTop - Scroll top.
   * @returns {{track: object, keyframe: object}[]}
   */
  collectKeyframeEntriesInRange(start, current, layout) {
    if (!start || !current) {
      return [];
    }

    const left = Math.min(start.x, current.x);
    const right = Math.max(start.x, current.x);
    const top = Math.min(start.y, current.y);
    const bottom = Math.max(start.y, current.y);
    const padding = 6;
    const ppf = layout.pixelsPerFrame;
    const rh = layout.rowHeight;
    const scrollLeft = layout.scrollLeft;
    const scrollTop = layout.scrollTop;
    const visibleEntries = this.getVisibleTrackEntries();
    const startRow = Math.max(0, Math.floor((top + scrollTop - padding) / rh));
    const endRow = Math.min(
      visibleEntries.length - 1,
      Math.ceil((bottom + scrollTop + padding) / rh)
    );
    const startFrame = Math.floor((left + scrollLeft - padding) / ppf);
    const endFrame = Math.ceil((right + scrollLeft + padding) / ppf);
    const entries = [];

    if (startRow > endRow) {
      return [];
    }

    for (let index = startRow; index <= endRow; index++) {
      const { track } = visibleEntries[index];
      if (track.category === 'header') {
        track.keyframes.forEach((keyframe) => {
          if (keyframe.frame < startFrame || keyframe.frame > endFrame) {
            return;
          }
          const x = keyframe.frame * ppf - scrollLeft;
          const y = index * rh + rh / 2 - scrollTop;
          if (!isPointInsideRangeSelection(x, y, left, top, right, bottom, padding)) {
            return;
          }
          entries.push(...this.collectDisplayFrameSelection(track, keyframe.frame));
        });
        continue;
      }

      track.keyframes.forEach((keyframe) => {
        if (keyframe.frame < startFrame || keyframe.frame > endFrame) {
          return;
        }
        const x = keyframe.frame * ppf - scrollLeft;
        const y = index * rh + rh / 2 - scrollTop;
        if (!isPointInsideRangeSelection(x, y, left, top, right, bottom, padding)) {
          return;
        }
        entries.push({ track, keyframe });
      });
    }

    return this.normalizeSelectedKeyframeEntries(entries);
  }

  /**
   * 指定座標に対する keyframe hit を返します。
   * @param {number} mx - Canvas-local X.
   * @param {number} my - Canvas-local Y.
   * @param {object} layout - View layout metrics.
   * @param {number} layout.pixelsPerFrame - Pixels per frame.
   * @param {number} layout.rowHeight - Row height.
   * @param {number} layout.scrollLeft - Scroll left.
   * @param {number} layout.scrollTop - Scroll top.
   * @returns {{track: object, entries: {track: object, keyframe: object}[]}|null}
   */
  findKeyframeHit(mx, my, layout) {
    const ppf = layout.pixelsPerFrame;
    const rh = layout.rowHeight;
    const scrollLeft = layout.scrollLeft;
    const scrollTop = layout.scrollTop;
    const visibleEntries = this.getVisibleTrackEntries();
    let bestHit = null;

    for (let i = visibleEntries.length - 1; i >= 0; i--) {
      const { track } = visibleEntries[i];
      const rowY = i * rh + rh / 2 - scrollTop;
      const rowDistance = Math.abs(my - rowY);
      if (rowDistance > rh / 2) {
        continue;
      }

      for (let j = track.keyframes.length - 1; j >= 0; j--) {
        const keyframe = track.keyframes[j];
        const kfX = keyframe.frame * ppf - scrollLeft;
        const xDistance = Math.abs(mx - kfX);
        if (xDistance >= 6) {
          continue;
        }

        const hit = track.category === 'header'
          ? {
              track,
              entries: this.collectDisplayFrameSelection(track, keyframe.frame),
            }
          : {
              track,
              entries: [{ track, keyframe }],
            };

        if (hit.entries.length === 0) {
          continue;
        }

        const hitScore = {
          rowDistance,
          xDistance,
          isHeader: track.category === 'header',
        };

        if (!bestHit) {
          bestHit = { ...hit, score: hitScore };
          continue;
        }

        const bestScore = bestHit.score;
        const isBetter = (
          hitScore.rowDistance < bestScore.rowDistance
          || (hitScore.rowDistance === bestScore.rowDistance && hitScore.xDistance < bestScore.xDistance)
          || (
            hitScore.rowDistance === bestScore.rowDistance
            && hitScore.xDistance === bestScore.xDistance
            && hitScore.isHeader
            && !bestScore.isHeader
          )
        );
        if (isBetter) {
          bestHit = { ...hit, score: hitScore };
        }
      }
    }

    if (!bestHit) {
      return null;
    }
    return {
      track: bestHit.track,
      entries: bestHit.entries,
    };
  }

  /**
   * display-frame position に存在する child keyframes を返します。
   * @param {object} displayFrameTrack - Header track.
   * @param {number} frame - Frame number.
   * @returns {{track: object, keyframe: object}[]}
   */
  collectDisplayFrameSelection(displayFrameTrack, frame) {
    const entries = [];
    const children = displayFrameTrack.children || [];

    children.forEach((child) => {
      child.keyframes.forEach((keyframe) => {
        if (keyframe.frame !== frame) {
          return;
        }
        entries.push({ track: child, keyframe });
      });
    });

    return entries;
  }
}

/**
 * DOM 非依存のタイムライン controller を管理します。
 */
export class TimelineHeadlessController {
  constructor(options) {
    this.modelManager = options.modelManager;
    this.selection = options.selection;
    this.timelineView = options.timelineView;
    this.interpolationPanel = options.interpolationPanel;
    this.vmdManager = options.vmdManager;
    this.refreshScene = options.refreshScene;
    this.updateVmdListUI = options.updateVmdListUI;
    this.lastTimelineModel = null;
    this.currentFrame = 0;
    this.isPlaying = false;
    this.loop = true;
    this.playbackRangeStart = 0;
    this.playbackRangeEnd = null;
    this.lastFrameTime = 0;
    this.jumped = false;
    this.timelineFramePerMilliSec = 0.03;
    this.sceneAnimationSources = {
      camera: null,
      light: null,
      shadow: null,
    };
  }

  getActiveInstance() {
    return this.modelManager.instances[this.selection.activeInstanceIndex];
  }

  /**
   * scene animation source を返します。
   * @param {'camera'|'light'|'shadow'} targetType - scene target type。
   * @returns {object|null}
   */
  getSceneAnimationSource(targetType) {
    const normalizedTargetType = String(targetType || '').trim();
    if (normalizedTargetType !== 'camera' && normalizedTargetType !== 'light' && normalizedTargetType !== 'shadow') {
      return null;
    }
    return this.sceneAnimationSources[normalizedTargetType] || null;
  }

  /**
   * scene animation source 群を返します。
   * @returns {{camera: object|null, light: object|null, shadow: object|null}}
   */
  getSceneAnimationSources() {
    return {
      camera: this.sceneAnimationSources.camera || null,
      light: this.sceneAnimationSources.light || null,
      shadow: this.sceneAnimationSources.shadow || null,
    };
  }

  /**
   * 現在の共有フレームを返します。
   * @returns {number}
   */
  getCurrentFrame() {
    return Number.isFinite(this.currentFrame) ? this.currentFrame : 0;
  }

  /**
   * 再生コントローラーとして自分自身を返します。
   * @returns {TimelineHeadlessController}
   */
  getPlaybackController() {
    return this;
  }

  /**
   * すべての animationController に共有再生状態を反映します。
   * @param {object} [options={}] - Sync options.
   * @param {object|null} [options.instance=null] - Restrict to one instance.
   */
  syncAnimationControllers(options = {}) {
    const instances = options.instance ? [options.instance] : this.modelManager.instances;
    for (const inst of instances) {
      const controller = inst?.animationController ?? null;
      if (!controller) {
        continue;
      }

      controller.currentFrame = this.getCurrentFrame();
      controller.isPlaying = this.isPlaying;
      controller.loop = this.loop;
      controller.playbackRangeStart = this.playbackRangeStart;
      controller.playbackRangeEnd = this.playbackRangeEnd;
      controller.lastFrameTime = this.lastFrameTime;
      controller.jumped = this.jumped;
    }
  }

  /**
   * インスタンス 1 件へ共有再生状態を反映します。
   * @param {object|null} instance - Model instance.
   */
  syncInstancePlaybackState(instance) {
    this.syncAnimationControllers({ instance });
  }

  /**
   * 現在の共有フレームを設定します。
   * @param {number} frame - Frame number.
   * @param {object} [options={}] - Set options.
   * @param {boolean} [options.jumped=false] - Mark as jumped when true.
   */
  setCurrentFrame(frame, options = {}) {
    this.currentFrame = Math.max(0, Number.isFinite(frame) ? frame : 0);
    this.lastFrameTime = Date.now();
    this.jumped = Boolean(options.jumped);
    this.syncAnimationControllers();
  }

  togglePlayback() {
    if (this.isPlaying) {
      this.stop();
    } else {
      this.play();
    }
    return this.isPlaying;
  }

  /**
   * 共有再生範囲を設定します。
   * @param {number} start - Playback start.
   * @param {number|null} [end=null] - Playback end.
   * @returns {boolean}
   */
  setPlaybackRange(start, end = null) {
    const normalizedStart = Number.isFinite(start) ? Math.max(0, start) : 0;
    const normalizedEnd = Number.isFinite(end) ? Math.max(normalizedStart, end) : null;
    this.playbackRangeStart = normalizedStart;
    this.playbackRangeEnd = normalizedEnd;
    this.syncAnimationControllers();

    let clamped = false;
    if (this.currentFrame < normalizedStart) {
      this.currentFrame = normalizedStart;
      this.jumped = true;
      clamped = true;
    } else if (normalizedEnd !== null && this.currentFrame > normalizedEnd) {
      this.currentFrame = normalizedEnd;
      this.jumped = true;
      clamped = true;
    }

    if (clamped) {
      this.lastFrameTime = Date.now();
      this.syncAnimationControllers();
      this.onFrameChanged({ keepManualValues: true });
    }
    return clamped;
  }

  /**
   * 共有再生範囲を返します。
   * @returns {{start: number, end: number|null}}
   */
  getPlaybackRange() {
    return {
      start: this.playbackRangeStart ?? 0,
      end: this.playbackRangeEnd ?? null,
    };
  }

  /**
   * 全 source の最大終端フレームを返します。
   * @returns {number}
   */
  getMaxFrame() {
    let maxFrame = 0;
    for (const instance of this.modelManager.instances) {
      const controller = instance?.animationController ?? null;
      if (Number.isFinite(controller?.maxFrame) && controller.maxFrame > maxFrame) {
        maxFrame = controller.maxFrame;
      }
    }
    for (const source of Object.values(this.sceneAnimationSources)) {
      const frames = this._collectSourceKeyframeFrames(source);
      if (frames.length > 0 && frames[frames.length - 1] > maxFrame) {
        maxFrame = frames[frames.length - 1];
      }
    }
    return maxFrame;
  }

  /**
   * 共有フレームを移動します。
   * @param {number} frame - Target frame.
   * @param {object} [options={}] - Seek options.
   */
  seek(frame, options = {}) {
    const targetFrame = Math.max(0, Number.isFinite(frame) ? frame : 0);
    this.jumped = Math.abs(targetFrame - this.currentFrame) > 1 || targetFrame < this.currentFrame;
    this.currentFrame = targetFrame;
    this.lastFrameTime = Date.now();
    this.syncAnimationControllers();
    this.onFrameChanged(options);
  }

  /**
   * フレーム単位で移動します。
   * @param {number} delta - Frame delta.
   * @param {object} [options={}] - Seek options.
   */
  stepFrame(delta, options = {}) {
    this.seek(this.currentFrame + delta, options);
  }

  /**
   * keyframe 単位で移動します。
   * @param {number} direction - Positive for next, negative for previous.
   * @param {object} [options={}] - Seek options.
   */
  stepKeyframe(direction, options = {}) {
    const inst = this.getActiveInstance();
    if (!inst) {
      return;
    }

    const frameNumbers = this._collectActiveKeyframeFrames(inst);
    if (frameNumbers.length === 0) {
      return;
    }

    const targetFrame = direction > 0
      ? this._findNextKeyframeFrame(frameNumbers, this.currentFrame)
      : this._findPreviousKeyframeFrame(frameNumbers, this.currentFrame);
    if (targetFrame === null) {
      return;
    }

    this.seek(targetFrame, options);
  }

  rewind() {
    this.seek(this.playbackRangeStart);
  }

  goToEnd() {
    const endFrame = this.playbackRangeEnd !== null ? this.playbackRangeEnd : this.getMaxFrame();
    this.seek(endFrame);
  }

  /**
   * フレーム変更時の副作用を処理します。
   * @param {object} [options={}] - Change options.
   * @param {boolean} [options.keepManualValues=false] - Preserve manual values when true.
   */
  onFrameChanged(options = {}) {
    const inst = this.getActiveInstance();
    if (!inst) {
      return;
    }

    if (!options.keepManualValues) {
      this.invalidateManualValues(inst);
    }

    this.refreshScene();
  }

  play() {
    if (this.currentFrame < this.playbackRangeStart) {
      this.currentFrame = this.playbackRangeStart;
      this.jumped = true;
    } else if (this.playbackRangeEnd !== null && this.currentFrame > this.playbackRangeEnd) {
      this.currentFrame = this.playbackRangeStart;
      this.jumped = true;
    } else {
      this.jumped = false;
    }

    this.isPlaying = true;
    this.lastFrameTime = Date.now();
    this.syncAnimationControllers();
    this.refreshScene?.();
  }

  stop() {
    this.isPlaying = false;
    this.lastFrameTime = Date.now();
    this.syncAnimationControllers();
    this.refreshScene?.();
  }

  /**
   * 再生を 1 ステップ進めます。
   * @param {number} [step=1] - Playback direction/step.
   * @returns {boolean}
   */
  advancePlayback(step = 1) {
    if (!this.isPlaying || step === 0) {
      this.syncAnimationControllers();
      return false;
    }

    const now = Date.now();
    const elapsedTime = now - this.lastFrameTime;
    if (elapsedTime < 1 / this.timelineFramePerMilliSec) {
      this.syncAnimationControllers();
      return false;
    }

    this.lastFrameTime = now;
    const prevFrame = this.currentFrame;
    this.currentFrame += step * elapsedTime * this.timelineFramePerMilliSec;
    const playbackStart = Math.max(0, this.playbackRangeStart);
    const playbackEnd = this.playbackRangeEnd !== null
      ? this.playbackRangeEnd
      : this.getMaxFrame();

    this.jumped = false;
    if (this.currentFrame < playbackStart) {
      this.currentFrame = playbackStart;
      this.jumped = true;
    } else if (this.currentFrame > playbackEnd) {
      if (this.playbackRangeEnd !== null) {
        this.currentFrame = playbackEnd;
        this.isPlaying = false;
        this.jumped = true;
      } else if (this.loop) {
        const loopStart = playbackStart;
        const loopEnd = Math.max(loopStart, playbackEnd);
        const loopSpan = Math.max(loopEnd - loopStart, 1);
        this.currentFrame = loopStart + ((this.currentFrame - loopStart) % loopSpan);
        if (this.currentFrame < prevFrame) {
          this.jumped = true;
        }
      } else {
        this.currentFrame = playbackEnd;
        this.isPlaying = false;
        this.jumped = true;
      }
    }

    this.syncAnimationControllers();
    return this.currentFrame !== prevFrame;
  }

  /**
   * 手動補正値を無効化します。
   * @param {object|null} inst - Model instance.
   */
  invalidateManualValues(inst) {
    if (!inst || (!inst.animationSource && inst.vmd == null)) {
      return;
    }

    const scene = inst.scene;
    if (!scene?.boneLocalTransforms) {
      return;
    }

    for (let index = 0; index < scene.boneLocalTransforms.length; index++) {
      this.modelManager.resetManualTransform(inst, index);
    }
    inst.morphController?.resetManualWeight?.();
  }

  /**
   * アクティブインスタンスを切り替えます。
   * @param {number} index - Active instance index.
   */
  setActiveInstance(index) {
    const inst = this.modelManager.instances[index];
    if (inst) {
      this.lastTimelineModel = null;
      this.rebuildTimelineSource();
      this.syncInstancePlaybackState(inst);
    }
  }

  /**
   * VMD をアクティブインスタンスへ割り当てます。
   * @param {object|null} vmd - VMD data.
   * @param {string|null} vmdName - VMD filename.
   */
  assignVmdToActiveInstance(vmd, vmdName) {
    this.assignAnimationSourceToActiveInstance(vmd ? {
      kind: 'vmd',
      name: vmdName,
      data: vmd,
      targetType: 'model',
    } : null);
  }

  /**
   * animation source を指定インスタンスへ割り当てます。
   * @param {object|null} instance - Model instance.
   * @param {object|null} source - Animation source.
   */
  assignAnimationSourceToInstance(instance, source) {
    const inst = instance || null;
    if (!inst) {
      return;
    }
    assignAnimationSourceToRuntimeInstance(inst, source);
    this.syncInstancePlaybackState(inst);
  }

  /**
   * scene animation source を設定します。
   * @param {'camera'|'light'|'shadow'} targetType - scene target type。
   * @param {object|null} source - Animation source.
   */
  assignSceneAnimationSource(targetType, source) {
    const normalizedTargetType = String(targetType || '').trim();
    if (normalizedTargetType !== 'camera' && normalizedTargetType !== 'light' && normalizedTargetType !== 'shadow') {
      return;
    }

    this.sceneAnimationSources[normalizedTargetType] = source
      ? { ...source, targetType: normalizedTargetType }
      : null;
    this.rebuildTimelineSource();
    if (this.updateVmdListUI) {
      this.updateVmdListUI();
    }
  }

  /**
   * animation source をアクティブインスタンスへ割り当てます。
   * @param {object|null} source - Animation source.
   */
  assignAnimationSourceToActiveInstance(source) {
    const inst = this.getActiveInstance();
    if (!inst) {
      return;
    }

    this.assignAnimationSourceToInstance(inst, source ? { ...source, targetType: 'model' } : null);
    if (this.vmdManager) {
      this.vmdManager.selectedListValue = source
        ? `${String(source.kind || 'vmd').trim()}:model:${String(source.name || '').trim()}`
        : '';
    }
    this.rebuildTimelineSource();
    if (this.updateVmdListUI) {
      this.updateVmdListUI();
    }
  }

  /**
   * timeline source を再構築して view へ反映します。
   */
  rebuildTimelineSource() {
    const inst = this.getActiveInstance();
    if (!this.timelineView) {
      return;
    }

    const model = inst ? inst.model : null;
    const source = inst ? this._getTimelineSourceForInstance(inst) : null;
    const isModelChanged = this.lastTimelineModel !== model;
    this.lastTimelineModel = model;

    if (isModelChanged) {
      this.timelineView.collapsedTrackIds = new Set();
      this.timelineView.setSource({ modelSource: source, sceneSources: this.getSceneAnimationSources() }, model);
      return;
    }

    const collapseState = this.timelineView.getCollapseState ? this.timelineView.getCollapseState() : [];
    this.timelineView.setSource({ modelSource: source, sceneSources: this.getSceneAnimationSources() }, model, { collapseState });
  }

  /**
   * 現在フレームの bone keyframe を登録します。
   * @param {object} [options={}] - Register options.
   * @param {'all'|'translation'|'rotation'} [options.mode='all'] - Registration mode.
   */
  registerBoneKeyframe(options = {}) {
    const inst = this.getActiveInstance();
    const boneIndices = getSelectedBoneIndices(this.selection, inst);
    if (!inst || boneIndices.length === 0) {
      return;
    }

    const mode = options.mode || 'all';
    const currentFrame = this.currentFrame;
    const interpolation = this.interpolationPanel ? this.interpolationPanel.getInterpolationArray() : null;
    let changed = false;

    for (const boneIndex of boneIndices) {
      const bone = getBone(inst.model, boneIndex);
      const local = inst.scene.boneLocalTransforms[boneIndex];
      if (!bone || !local) {
        continue;
      }

      const gizmoModes = getBoneGizmoModes(bone);
      if (mode === 'translation' && !gizmoModes.translatable) {
        continue;
      }
      if (mode === 'rotation' && !gizmoModes.rotatable) {
        continue;
      }

      const pos = getBoneInfoDisplayLocalPosition(inst, boneIndex);
      const rot = quat.multiply(quat.create(), local.manualRotation, local.rotation);

      if (this._isActiveGltfSource(inst)) {
        const scaleValue = Array.from(local.scale || [1, 1, 1]);
        const hasScaleChannel = (inst.animationSource?.clip?.channels || []).some((channel) => (
          channel?.target?.kind === 'bone'
          && channel?.target?.name === bone.name
          && channel?.target?.path === 'scale'
        ));
        upsertAnimationClipBoneKeyframe(inst.animationSource.clip, bone.name, Math.round(currentFrame), {
          translation: mode === 'rotation' ? null : pos,
          rotation: mode === 'translation' ? null : rot,
          scale: mode === 'all' && (hasScaleChannel || !isUnitScale(scaleValue)) ? scaleValue : null,
        });
        this.modelManager.resetManualTransform(inst, boneIndex);
        changed = true;
        continue;
      }

      if (this._isVrmaEditingTarget(inst)) {
        const sourceBoneName = this._resolveVrmaSourceBoneName(inst.model, bone.name);
        if (!sourceBoneName) {
          continue;
        }
        const translationValue = mode === 'rotation'
          ? null
          : Array.from(pos);
        const source = this._ensureEditableVrmaSource(inst);
        upsertAnimationClipBoneKeyframe(source.clip, sourceBoneName, Math.round(currentFrame), {
          translation: translationValue,
          rotation: mode === 'translation' ? null : rot,
        });
        if (translationValue) {
          const translationChannel = source.clip.channels.find((channel) => (
            channel?.target?.kind === 'bone'
            && channel?.target?.name === sourceBoneName
            && channel?.target?.path === 'translation'
          ));
          const bindTranslation = resolveVrmaHipsBindTranslation(inst, boneIndex, sourceBoneName);
          if (translationChannel && bindTranslation && !Array.isArray(translationChannel.target.bindTranslation) && !ArrayBuffer.isView(translationChannel.target.bindTranslation)) {
            translationChannel.target.bindTranslation = bindTranslation;
          }
        }
        this.modelManager.resetManualTransform(inst, boneIndex);
        changed = true;
        continue;
      }

      const source = this._ensureEditableVmd(inst);
      upsertAnimationClipBoneKeyframe(source.clip, bone.name, Math.round(currentFrame), {
        translation: mode === 'rotation' ? null : pos,
        rotation: mode === 'translation' ? null : rot,
        interpolation,
      });
      this.modelManager.resetManualTransform(inst, boneIndex);
      changed = true;
    }

    if (!changed) {
      return;
    }

    this._refreshActiveAnimationSource(inst, currentFrame);
    this.rebuildTimelineSource();
    if (this.updateVmdListUI) {
      this.updateVmdListUI();
    }
  }

  /**
   * 現在フレームの morph keyframe を登録します。
   * @param {string} name - Morph name.
   * @param {number} weight - Morph weight.
   */
  registerMorphKeyframe(name, weight) {
    const inst = this.getActiveInstance();
    if (!inst) {
      return;
    }
    if (this._isVrmaEditingTarget(inst) && isVrmaNonAnimatableExpression(name)) {
      this._warnVrmaUnsupportedKeyframe(`expression '${name}'`);
      return;
    }

    const currentFrame = this.currentFrame;
    if (this._isActiveGltfSource(inst)) {
      upsertAnimationClipMorphKeyframe(inst.animationSource.clip, name, currentFrame, weight);
    } else if (this._isVrmaEditingTarget(inst)) {
      const source = this._ensureEditableVrmaSource(inst);
      upsertAnimationClipMorphKeyframe(source.clip, name, currentFrame, weight, {
        vrmaExpressionName: this._resolveVrmaExpressionName(inst.model, name),
        vrmaExpressionType: resolveVrmaExpressionType(name),
      });
    } else {
      const source = this._ensureEditableVmd(inst);
      upsertAnimationClipMorphKeyframe(source.clip, name, currentFrame, weight);
    }

    const morphIndex = inst.model.morphs.findIndex((morph) => morph.name === name);
    if (morphIndex !== -1) {
      inst.morphController.setManualWeight(morphIndex, -1);
    }

    this._refreshActiveAnimationSource(inst, currentFrame);
    this.rebuildTimelineSource();
    if (this.updateVmdListUI) {
      this.updateVmdListUI();
    }
  }

  /**
   * 現在フレームの camera keyframe を登録します。
   * @param {object} options - Camera options.
   * @param {number} options.distance - Camera distance.
   * @param {ArrayLike<number>} options.target - Camera target position.
   * @param {ArrayLike<number>} options.rotation - Camera rotation.
   * @param {number} options.fov - Camera FOV in degrees.
   * @param {Uint8Array|ArrayLike<number>} [options.interpolation] - Interpolation bytes.
   * @param {Uint8Array|ArrayLike<number>} [options.fovInterpolation] - FOV interpolation bytes.
   * @param {number} [options.perspective=1] - Perspective toggle.
   */
  registerCameraKeyframe(options) {
    const currentFrame = this.currentFrame;
    const source = this._ensureEditableSceneVmd('camera');
    upsertAnimationClipCameraKeyframe(source.clip, Math.round(currentFrame), {
      distance: options.distance,
      target: options.target,
      rotation: options.rotation,
      fov: Math.round(options.fov),
      perspective: options.perspective ?? 1,
    });

    this._refreshSceneAnimationSource('camera', currentFrame);
    this.rebuildTimelineSource();
    if (this.updateVmdListUI) {
      this.updateVmdListUI();
    }
  }

  /**
   * 現在フレームの light keyframe を登録します。
   * @param {object} options - Light keyframe options.
   * @param {ArrayLike<number>} options.color - Light color RGB.
   * @param {ArrayLike<number>|null} [options.position] - Light position.
   * @param {ArrayLike<number>} [options.direction] - Direction vector.
   * @param {ArrayLike<number>} [options.rotation] - Rotation quaternion.
   * @param {'all'|'rotation'} [options.mode='all'] - Save mode.
   */
  registerLightKeyframe(options) {
    const currentFrame = this.currentFrame;
    const mode = options?.mode || 'all';
    const source = this._ensureEditableSceneVmd('light');
    upsertAnimationClipLightKeyframe(source.clip, Math.round(currentFrame), {
      color: Array.from(options?.color || [1, 1, 1]).slice(0, 3),
      position: mode === 'rotation'
        ? null
        : Array.isArray(options?.position) || ArrayBuffer.isView(options?.position)
          ? Array.from(options.position).slice(0, 3)
          : null,
      direction: Array.isArray(options?.direction) || ArrayBuffer.isView(options?.direction)
        ? Array.from(options.direction).slice(0, 3)
        : null,
      rotation: Array.isArray(options?.rotation) || ArrayBuffer.isView(options?.rotation)
        ? Array.from(options.rotation).slice(0, 4)
        : null,
      keyedPosition: mode !== 'rotation',
      keyedRotation: true,
    });

    this._refreshSceneAnimationSource('light', currentFrame);
    this.rebuildTimelineSource();
    if (this.updateVmdListUI) {
      this.updateVmdListUI();
    }
  }

  /**
   * timelineView 上で選択中の keyframes を削除します。
   * @returns {boolean}
   */
  deleteSelectedKeyframes() {
    const inst = this.getActiveInstance();
    if (!this.timelineView) {
      return false;
    }

    const selectedEntries = Array.isArray(this.timelineView.selectedKeyframeEntries)
      ? this.timelineView.selectedKeyframeEntries
      : [];
    if (selectedEntries.length === 0) {
      return false;
    }

    const selectedSourcesByCategory = new Map();
    selectedEntries.forEach((entry) => {
      if (entry && entry.track && entry.keyframe && entry.keyframe.source) {
        if (!selectedSourcesByCategory.has(entry.track.category)) {
          selectedSourcesByCategory.set(entry.track.category, new Set());
        }
        selectedSourcesByCategory.get(entry.track.category).add(entry.keyframe.source);
      }
    });
    if (selectedSourcesByCategory.size === 0) {
      return false;
    }

    let changed = false;
    const modelClip = inst ? (inst?.animationSource?.clip || ensureAnimationClip(inst?.vmd) || null) : null;
    if (inst && !inst?.animationSource && inst?.vmd && modelClip) {
      inst.animationSource = createVmdAnimationSource(inst.vmdName || inst.animationSourceName, inst.vmd, modelClip, {
        targetType: 'model',
      });
      inst.animationSourceKind = 'vmd';
      inst.animationSourceType = 'vmd';
    }
    if (modelClip) {
      const modelSources = new Set([
        ...(selectedSourcesByCategory.get('bone') || []),
        ...(selectedSourcesByCategory.get('morph') || []),
      ]);
      if (modelSources.size > 0) {
        changed = deleteAnimationClipKeyframes(modelClip, modelSources) || changed;
      }
    }

    for (const targetType of ['camera', 'light', 'shadow']) {
      const sceneSource = this.getSceneAnimationSource(targetType);
      const sceneSources = selectedSourcesByCategory.get(targetType);
      if (!sceneSource?.clip || !sceneSources || sceneSources.size === 0) {
        continue;
      }
      changed = deleteAnimationClipKeyframes(sceneSource.clip, sceneSources) || changed;
      this._refreshSceneAnimationSource(targetType, this.currentFrame);
    }

    if (!changed) {
      return false;
    }

    if (typeof this.timelineView.clearKeyframeSelection === 'function') {
      this.timelineView.clearKeyframeSelection(false);
    }

    if (inst && modelClip) {
      this._refreshActiveAnimationSource(inst, this.currentFrame);
    }
    this.rebuildTimelineSource();
    if (this.updateVmdListUI) {
      this.updateVmdListUI();
    }
    this.onFrameChanged({ keepManualValues: true });

    return true;
  }

  /**
   * view state を同期します。
   */
  syncViewState() {
    const inst = this.getActiveInstance();
    if (this.timelineView) {
      this.timelineView.setCurrentFrame(this.currentFrame);
    }

    if (inst && this.timelineView) {
      let selectedName = null;
      const selectedBoneIndex = resolveSelectedBoneIndex(inst, this.selection);
      if (selectedBoneIndex !== -1) {
        selectedName = getBone(inst.model, selectedBoneIndex)?.name || '';
      }

      if (selectedName) {
        this.timelineView.setSelectedTrackByName(selectedName);
      }
    }
  }

  /**
   * 新規 VMD 名を生成します。
   * @returns {string}
   */
  generateNewVmdName() {
    let baseName = 'NewVMD';
    let name = `${baseName}.vmd`;
    let count = 1;
    while (this.vmdManager.vmds.has(name)) {
      name = `${baseName}.${count.toString().padStart(3, '0')}.vmd`;
      count++;
    }
    return name;
  }

  /**
   * scene 用の新規 VMD 名を生成します。
   * @param {'camera'|'light'|'shadow'} targetType - scene target type。
   * @returns {string}
   */
  generateNewSceneVmdName(targetType) {
    const normalizedTargetType = String(targetType || '').trim();
    const baseName = normalizedTargetType === 'camera'
      ? 'Camera'
      : normalizedTargetType === 'light'
        ? 'Light'
        : 'Shadow';
    let name = `${baseName}.vmd`;
    let count = 1;
    while (this.vmdManager.getSceneVmdSource?.(normalizedTargetType, name)) {
      name = `${baseName}.${count.toString().padStart(3, '0')}.vmd`;
      count++;
    }
    return name;
  }

  /**
   * 新規 VRMA 名を生成します。
   * @returns {string}
   */
  generateNewVrmaName() {
    let baseName = 'NewVRMA';
    let name = `${baseName}.vrma`;
    let count = 1;
    while (this.vmdManager.vrmas?.has?.(name)) {
      name = `${baseName}.${count.toString().padStart(3, '0')}.vrma`;
      count++;
    }
    return name;
  }

  /**
   * インスタンスの timeline source を返します。
   * @param {object|null} inst - Model instance.
   * @returns {object|null}
   */
  _getTimelineSourceForInstance(inst) {
    if (!inst) {
      return null;
    }
    if (inst.animationSource) {
      return inst.animationSource;
    }
    if (inst.vmd) {
      return inst.vmd;
    }
    return null;
  }

  /**
   * glTF source がアクティブかどうかを返します。
   * @param {object|null} inst - Model instance.
   * @returns {boolean}
   */
  _isActiveGltfSource(inst) {
    return Boolean(
      inst?.animationSource
      && String(inst.animationSourceKind || inst.animationSourceType || '').trim() === 'gltf'
    );
  }

  /**
   * VRMA clip を編集対象として扱うかどうかを返します。
   * @param {object|null} inst - Model instance.
   * @returns {boolean}
   */
  _isVrmaEditingTarget(inst) {
    return String(inst?.model?.magic || '').trim() === 'Vrm'
      && (
        String(inst?.animationSourceKind || inst?.animationSourceType || '').trim() === 'vrma'
        || (!inst?.animationSource && !inst?.vmd)
      );
  }

  /**
   * VRMA 未対応 keyframe の警告を出します。
   * @param {string} kind - Unsupported key kind.
   */
  _warnVrmaUnsupportedKeyframe(kind) {
    const message = `VRMA does not support ${kind} keyframes in the current editor path.`;
    console.warn(`[OpenMMD] ${message}`);
    if (typeof alert === 'function') {
      alert(message);
    }
  }

  /**
   * VMD 編集用データを初期化します。
   * @param {object} inst - Model instance.
   */
  _ensureEditableVmd(inst) {
    if (String(inst?.animationSourceKind || inst?.animationSourceType || '').trim() === 'vmd' && inst?.animationSource?.clip) {
      return inst.animationSource;
    }
    inst.vmdName = this.generateNewVmdName();
    inst.animationSource = createVmdAnimationSource(
      inst.vmdName,
      null,
      createEmptyAnimationClip({
        name: String(inst?.model?.name || 'Default'),
        timelineFps: 30,
        metadata: {
          sourceFormat: 'vmd',
          modelName: String(inst?.model?.name || 'Default'),
        },
      }),
      {
        targetType: 'model',
      },
    );
    syncLegacyVmdDataFromAnimationSource(inst.animationSource);
    inst.vmd = inst.animationSource.data || null;
    inst.animationSourceName = inst.vmdName;
    inst.animationSourceKind = 'vmd';
    inst.animationSourceType = 'vmd';
    this.vmdManager.vmds.set(inst.vmdName, inst.vmd);
    this.vmdManager.registerAnimationSource?.(inst.animationSource);
    return inst.animationSource;
  }

  /**
   * scene 用 VMD source を初期化して返します。
   * @param {'camera'|'light'|'shadow'} targetType - scene target type。
   * @returns {object}
   */
  _ensureEditableSceneVmd(targetType) {
    const normalizedTargetType = String(targetType || '').trim();
    const currentSource = this.getSceneAnimationSource(normalizedTargetType);
    if (currentSource?.clip) {
      return currentSource;
    }

    const source = createVmdAnimationSource(
      this.generateNewSceneVmdName(normalizedTargetType),
      null,
      createEmptyAnimationClip({
        name: normalizedTargetType,
        timelineFps: 30,
        metadata: {
          sourceFormat: 'vmd',
          modelName: normalizedTargetType,
        },
      }),
      {
        targetType: normalizedTargetType,
      },
    );
    syncLegacyVmdDataFromAnimationSource(source);
    this.sceneAnimationSources[normalizedTargetType] = source;
    this.vmdManager.registerAnimationSource?.(source);
    return source;
  }

  /**
   * VRMA 編集用 source を初期化して返します。
   * @param {object} inst - Model instance.
   * @returns {object}
   */
  _ensureEditableVrmaSource(inst) {
    if (inst?.animationSourceKind === 'vrma' && inst?.animationSource?.clip) {
      return inst.animationSource;
    }

    const name = this.generateNewVrmaName();
    const source = {
      kind: 'vrma',
      name,
      preserveIkEnabled: true,
      clip: createEmptyAnimationClip({
        name: String(inst?.model?.name || 'VRMA Animation'),
        timelineFps: 30,
        metadata: {
          sourceFormat: 'vrma',
          vrmAnimation: {
            humanBones: Object.fromEntries(
              Object.keys(inst?.model?.vrm?.humanoidBoneNameMap || {}).map((key) => [key, key])
            ),
            expressions: {},
          },
        },
      }),
    };
    inst.vmd = null;
    inst.vmdName = null;
    inst.animationSource = source;
    inst.animationSourceName = name;
    inst.animationSourceKind = 'vrma';
    inst.animationSourceType = 'vrma';
    this.vmdManager.vrmas.set(name, source);
    this.vmdManager.registerAnimationSource?.(source);
    return source;
  }

  /**
   * VRMA source に保存する bone 名を返します。
   * @param {object|null} model - Model data.
   * @param {string} boneName - Runtime bone name.
   * @returns {string}
   */
  _resolveVrmaSourceBoneName(model, boneName) {
    const normalizedBoneName = String(boneName || '').trim();
    if (!normalizedBoneName) {
      return '';
    }

    const humanoidBoneName = findVrmHumanoidBoneNameByBoneName(model, normalizedBoneName);
    if (humanoidBoneName) {
      return humanoidBoneName;
    }

    if (
      String(model?.magic || '').trim() === 'Vrm'
      && (normalizedBoneName === '全ての親' || normalizedBoneName === '下半身')
    ) {
      return normalizedBoneName;
    }

    return '';
  }

  /**
   * VRMA source に保存する expression 名を返します。
   * @param {object|null} _model - Model data.
   * @param {string} morphName - Morph name.
   * @returns {string}
   */
  _resolveVrmaExpressionName(_model, morphName) {
    return String(morphName || '').trim();
  }

  /**
   * アクティブ source を controller へ再反映します。
   * @param {object} inst - Model instance.
   * @param {number} currentFrame - Frame to preserve.
   */
  _refreshActiveAnimationSource(inst, currentFrame) {
    if (String(inst?.animationSourceKind || inst?.animationSourceType || '').trim() === 'vmd' && inst?.animationSource?.clip) {
      syncLegacyVmdDataFromAnimationSource(inst.animationSource);
      inst.vmd = inst.animationSource.data || null;
      inst.vmdName = inst.animationSource.name || inst.vmdName || null;
      inst.animationSourceKind = 'vmd';
      inst.animationSourceType = 'vmd';
    }
    this.vmdManager?.registerAnimationSource?.(inst?.animationSource || null);
    rebindAnimationSourceToRuntimeInstance(inst);
    this.currentFrame = Math.max(0, Number.isFinite(currentFrame) ? currentFrame : this.currentFrame);
    this.lastFrameTime = Date.now();
    this.jumped = false;
    this.syncAnimationControllers({ instance: inst });
  }

  /**
   * scene source を再同期します。
   * @param {'camera'|'light'|'shadow'} targetType - scene target type。
   * @param {number} currentFrame - Frame to preserve.
   */
  _refreshSceneAnimationSource(targetType, currentFrame) {
    const source = this.getSceneAnimationSource(targetType);
    if (!source?.clip) {
      return;
    }
    syncLegacyVmdDataFromAnimationSource(source);
    this.vmdManager?.registerAnimationSource?.(source);
    if (this.vmdManager) {
      this.vmdManager.selectedListValue = `vmd:${targetType}:${source.name}`;
    }
    this.currentFrame = Math.max(0, Number.isFinite(currentFrame) ? currentFrame : this.currentFrame);
    this.lastFrameTime = Date.now();
    this.jumped = false;
    this.syncAnimationControllers();
  }

  /**
   * アクティブ source から keyframe フレーム一覧を集めます。
   * @param {object|null} inst - Model instance.
   * @returns {number[]}
   */
  _collectActiveKeyframeFrames(inst) {
    const frames = new Set();
    for (const frameNum of this._collectSourceKeyframeFrames(this._getTimelineSourceForInstance(inst))) {
      frames.add(frameNum);
    }
    for (const source of Object.values(this.sceneAnimationSources)) {
      for (const frameNum of this._collectSourceKeyframeFrames(source)) {
        frames.add(frameNum);
      }
    }

    return Array.from(frames).sort((left, right) => left - right);
  }

  /**
   * source から frame 一覧を集めます。
   * @param {object|null} source - animation source。
   * @returns {number[]}
   */
  _collectSourceKeyframeFrames(source) {
    if (!source) {
      return [];
    }

    const frames = new Set();
    const clip = source?.clip || source;
    if (Array.isArray(source.boneKeyframes) || Array.isArray(source.motions)) {
      this._collectVmdFrameNumbers(frames, source.boneKeyframes || source.motions || []);
    }
    if (Array.isArray(source.faceKeyframes) || Array.isArray(source.morphs) || Array.isArray(source.faces)) {
      this._collectVmdFrameNumbers(frames, source.faceKeyframes || source.morphs || source.faces || []);
    }
    if (Array.isArray(source.cameraKeyframes)) {
      this._collectVmdFrameNumbers(frames, source.cameraKeyframes);
    }
    if (Array.isArray(source.lightKeyframes)) {
      this._collectVmdFrameNumbers(frames, source.lightKeyframes);
    }
    if (Array.isArray(source.selfShadowKeyframes)) {
      this._collectVmdFrameNumbers(frames, source.selfShadowKeyframes);
    }

    if (Array.isArray(clip?.channels)) {
      const timelineFps = Number.isFinite(clip.timelineFps) && clip.timelineFps > 0 ? clip.timelineFps : 30;
      for (const channel of clip.channels) {
        for (const keyframe of channel?.sampler?.keyframes || []) {
          const frameNum = Number.isFinite(keyframe?.frameNum)
            ? Math.round(keyframe.frameNum)
            : Math.round((Number(keyframe?.time) || 0) * timelineFps);
          if (Number.isFinite(frameNum)) {
            frames.add(frameNum);
          }
        }
      }
      this._collectVmdFrameNumbers(frames, extractCameraKeyframesFromAnimationClip(clip));
      this._collectVmdFrameNumbers(frames, extractLightKeyframesFromAnimationClip(clip));
      this._collectVmdFrameNumbers(frames, extractSelfShadowKeyframesFromAnimationClip(clip));
    }

    return Array.from(frames).sort((left, right) => left - right);
  }

  /**
   * VMD 系 keyframes からフレーム番号を抽出します。
   * @param {Set<number>} frames - Output set.
   * @param {Array<object>} keyframes - Keyframe array.
   */
  _collectVmdFrameNumbers(frames, keyframes) {
    for (const keyframe of keyframes) {
      if (!keyframe) {
        continue;
      }
      const frameNum = Number.isFinite(keyframe.frameNum) ? Math.round(keyframe.frameNum) : null;
      if (frameNum !== null) {
        frames.add(frameNum);
      }
    }
  }

  /**
   * 現在フレームより後ろの keyframe を返します。
   * @param {number[]} frameNumbers - Sorted frame numbers.
   * @param {number} currentFrame - Current frame.
   * @returns {number|null}
   */
  _findNextKeyframeFrame(frameNumbers, currentFrame) {
    for (const frameNum of frameNumbers) {
      if (frameNum > currentFrame + 0.01) {
        return frameNum;
      }
    }
    return null;
  }

  /**
   * 現在フレームより前の keyframe を返します。
   * @param {number[]} frameNumbers - Sorted frame numbers.
   * @param {number} currentFrame - Current frame.
   * @returns {number|null}
   */
  _findPreviousKeyframeFrame(frameNumbers, currentFrame) {
    for (let index = frameNumbers.length - 1; index >= 0; index--) {
      const frameNum = frameNumbers[index];
      if (frameNum < currentFrame - 0.01) {
        return frameNum;
      }
    }
    return null;
  }
}

/**
 * VRMA preset expression 名の集合です。
 */
const VRMA_PRESET_EXPRESSION_NAMES = new Set([
  'happy',
  'angry',
  'sad',
  'relaxed',
  'surprised',
  'aa',
  'ih',
  'ou',
  'ee',
  'oh',
  'blink',
  'blinkLeft',
  'blinkRight',
  'lookUp',
  'lookDown',
  'lookLeft',
  'lookRight',
  'neutral',
]);

/**
 * expression 名から preset/custom 種別を返します。
 * @param {string} expressionName - Expression name.
 * @returns {'preset'|'custom'}
 */
function resolveVrmaExpressionType(expressionName) {
  return VRMA_PRESET_EXPRESSION_NAMES.has(String(expressionName || '').trim()) ? 'preset' : 'custom';
}

/**
 * VRMA でアニメーション不可の expression かどうかを返します。
 * @param {string} expressionName - Expression name.
 * @returns {boolean}
 */
function isVrmaNonAnimatableExpression(expressionName) {
  return ['lookUp', 'lookDown', 'lookLeft', 'lookRight'].includes(String(expressionName || '').trim());
}

/**
 * scale が単位行列かどうかを判定します。
 * @param {ArrayLike<number>} scale - Scale value.
 * @returns {boolean}
 */
function isUnitScale(scale) {
  return Math.abs((Number(scale?.[0]) || 0) - 1) <= 1e-6
    && Math.abs((Number(scale?.[1]) || 0) - 1) <= 1e-6
    && Math.abs((Number(scale?.[2]) || 0) - 1) <= 1e-6;
}

/**
 * point が drag selection に含まれるかどうかを返します。
 * @param {number} x - Point X.
 * @param {number} y - Point Y.
 * @param {number} left - Selection left.
 * @param {number} top - Selection top.
 * @param {number} right - Selection right.
 * @param {number} bottom - Selection bottom.
 * @param {number} padding - Hit padding.
 * @returns {boolean}
 */
function isPointInsideRangeSelection(x, y, left, top, right, bottom, padding) {
  return (
    x >= left - padding
    && x <= right + padding
    && y >= top - padding
    && y <= bottom + padding
  );
}
