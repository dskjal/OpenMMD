import { guessAudioMimeType } from '../../infrastructure/io/file-loading.js';
import { composeAudioBufferChannelData } from '../../shared/export/video-export-utils.js';

/**
 * Clamps a value to the inclusive 0..1 range.
 * @param {number} value - Input value.
 * @returns {number} Clamped value.
 */
function clampVolume(value) {
  if (!Number.isFinite(value)) {
    return 1;
  }
  return Math.min(1, Math.max(0, value));
}

/**
 * Returns whether an audio element can play a MIME type.
 * @param {HTMLAudioElement} audio - Probe audio element.
 * @param {string} mimeType - MIME type.
 * @returns {boolean} True when the browser reports support.
 */
function canPlayMimeType(audio, mimeType) {
  const normalizedMimeType = String(mimeType || '').trim();
  if (!normalizedMimeType || !audio || typeof audio.canPlayType !== 'function') {
    return false;
  }

  const support = audio.canPlayType(normalizedMimeType);
  return support === 'probably' || support === 'maybe';
}

/**
 * Returns the active playback controller.
 * @param {function(): object|null} [getPlaybackController] - Controller getter.
 * @returns {object|null} Active animation controller.
 */
function resolveActiveController(getPlaybackController) {
  return getPlaybackController?.() ?? null;
}

/**
 * Resolves the playable audio source object.
 * @param {File|Blob|{blob?:Blob,file?:Blob}} file - Audio source.
 * @returns {Blob|File} Object URL source.
 */
function resolveAudioSource(file) {
  if (file instanceof Blob) {
    return file;
  }

  if (file?.blob instanceof Blob) {
    return file.blob;
  }

  if (file?.file instanceof Blob) {
    return file.file;
  }

  return file;
}

/**
 * Resolves an audio MIME type from a file-like object.
 * @param {File|Blob|{name?:string,type?:string,blob?:Blob,file?:Blob}} file - Audio source.
 * @returns {string} Audio MIME type.
 */
function resolveAudioMimeType(file) {
  const directMimeType = String(file?.type || file?.blob?.type || file?.file?.type || '').trim();
  const fileName = String(file?.name || file?.fileName || '').trim();
  return guessAudioMimeType(fileName, directMimeType);
}

/**
 * Resolves a display name from a file-like object.
 * @param {File|Blob|{name?:string,fileName?:string}} file - Audio source.
 * @returns {string} File name.
 */
function resolveAudioFileName(file) {
  return String(file?.name || file?.fileName || 'BGM');
}

/**
 * BGM playback and UI manager.
 */
export class BgmManager {
  /**
   * @param {object} [options] - Manager options.
   * @param {function(): HTMLAudioElement} [options.audioFactory] - Audio element factory.
   * @param {{createObjectURL:function(Blob): string, revokeObjectURL:function(string): void}} [options.urlApi] - URL API.
   * @param {function(): object|null} [options.getPlaybackController] - Returns the active playback controller.
   * @param {function(): {start:number, end:number|null}} [options.getPlaybackRange] - Returns the active playback range.
   * @param {number} [options.playbackFps=30] - Animation FPS used for time mapping.
   * @param {function(object): void} [options.onStateChanged] - UI refresh callback.
   */
  constructor(options = {}) {
    this.audioFactory = options.audioFactory || (() => new Audio());
    this.urlApi = options.urlApi || URL;
    this.getPlaybackController = options.getPlaybackController || (() => null);
    this.getPlaybackRange = options.getPlaybackRange || (() => ({ start: 0, end: null }));
    this.playbackFps = Number.isFinite(options.playbackFps) && options.playbackFps > 0 ? options.playbackFps : 30;
    this.onStateChanged = typeof options.onStateChanged === 'function' ? options.onStateChanged : null;

    /** @type {HTMLAudioElement|null} */
    this.audio = null;
    /** @type {string} */
    this.objectUrl = '';
    /** @type {string} */
    this.fileName = '';
    /** @type {string} */
    this.mimeType = '';
    /** @type {Blob|File|null} */
    this.sourceBlob = null;
    /** @type {string} */
    this.errorMessage = '';
    /** @type {boolean} */
    this.hasSource = false;
    /** @type {boolean} */
    this.isReady = false;
    /** @type {boolean} */
    this.isPlaying = false;
    /** @type {number} */
    this.volume = 1;
    /** @type {boolean} */
    this.loop = false;
    /** @type {File[]} */
    this.candidateFiles = [];
    /** @type {number} */
    this.selectedCandidateIndex = -1;
    /** @type {number|null} */
    this.pendingSeekTime = null;
    /** @type {boolean} */
    this.pendingShouldPlay = false;
    /** @type {object|null} */
    this.lastController = null;
    /** @type {AudioBuffer|null} */
    this.decodedAudioBuffer = null;
    /** @type {Promise<AudioBuffer|null>|null} */
    this.decodedAudioBufferPromise = null;

    this._onLoadedMetadata = () => {
      this.isReady = true;
      this._applyPendingSync();
      this._emitStateChanged();
    };

    this._onAudioError = () => {
      this.errorMessage = 'Failed to load BGM.';
      this.isReady = false;
      this.isPlaying = false;
      this.pendingSeekTime = null;
      this.pendingShouldPlay = false;
      this._emitStateChanged();
    };
  }

  /**
   * Returns a serializable snapshot of the current BGM state.
   * @returns {object} BGM state snapshot.
   */
  getState() {
    return {
      fileName: this.fileName,
      mimeType: this.mimeType,
      errorMessage: this.errorMessage,
      hasSource: this.hasSource,
      isReady: this.isReady,
      isPlaying: this.isPlaying,
      volume: this.volume,
      loop: this.loop,
      candidateCount: this.candidateFiles.length,
      selectedCandidateIndex: this.selectedCandidateIndex,
    };
  }

  /**
   * Releases the current audio source.
   * @param {object} [options] - Clear options.
   * @param {boolean} [options.preserveCandidates=false] - Keep candidate list.
   */
  clear(options = {}) {
    const preserveCandidates = options.preserveCandidates === true;
    if (this.audio) {
      this.audio.pause?.();
      this.audio.removeEventListener?.('loadedmetadata', this._onLoadedMetadata);
      this.audio.removeEventListener?.('error', this._onAudioError);
      if ('src' in this.audio) {
        this.audio.src = '';
      }
    }

    if (this.objectUrl) {
      this.urlApi.revokeObjectURL(this.objectUrl);
    }

    this.audio = null;
    this.objectUrl = '';
    this.fileName = '';
    this.mimeType = '';
    this.errorMessage = '';
    this.hasSource = false;
    this.isReady = false;
    this.isPlaying = false;
    this.sourceBlob = null;
    this.decodedAudioBuffer = null;
    this.decodedAudioBufferPromise = null;
    if (!preserveCandidates) {
      this.candidateFiles = [];
      this.selectedCandidateIndex = -1;
    }
    this.pendingSeekTime = null;
    this.pendingShouldPlay = false;
    this._emitStateChanged();
  }

  /**
   * Destroys the manager and releases resources.
   */
  destroy() {
    this.clear();
  }

  /**
   * Updates the volume.
   * @param {number} volume - Normalized volume.
   */
  setVolume(volume) {
    this.volume = clampVolume(volume);
    if (this.audio) {
      this.audio.volume = this.volume;
    }
    this._emitStateChanged();
  }

  /**
   * Updates the loop flag.
   * @param {boolean} loop - Loop enabled state.
   */
  setLoop(loop) {
    this.loop = Boolean(loop);
    if (this.audio) {
      this.audio.loop = this.loop;
    }
    this._emitStateChanged();
  }

  /**
   * Clears the currently stored BGM candidates.
   */
  clearCandidates() {
    this.candidateFiles = [];
    this.selectedCandidateIndex = -1;
    this._emitStateChanged();
  }

  /**
   * Registers audio candidates detected from a drop operation.
   * @param {File[]} files - Candidate files.
   */
  async setCandidateFiles(files) {
    const nextFiles = Array.isArray(files) ? files.filter(Boolean) : [];
    if (nextFiles.length === 0) {
      this.clearCandidates();
      return;
    }

    this.candidateFiles = nextFiles;
    this.selectedCandidateIndex = 0;
    this._emitStateChanged();

    await this.loadFile(nextFiles[0], { preserveCandidates: true });
  }

  /**
   * Loads one of the stored candidate files.
   * @param {number} index - Candidate index.
   */
  async selectCandidate(index) {
    if (!Number.isInteger(index) || index < 0 || index >= this.candidateFiles.length) {
      return;
    }

    this.selectedCandidateIndex = index;
    this._emitStateChanged();
    await this.loadFile(this.candidateFiles[index], { preserveCandidates: true });
  }

  /**
   * Loads a BGM file if the browser can play it directly.
   * @param {File|Blob|{name?:string,type?:string,blob?:Blob,file?:Blob}} file - Audio file.
   * @param {object} [options] - Load options.
   * @param {boolean} [options.preserveCandidates=false] - Keep candidate list after loading.
   * @returns {Promise<{accepted:boolean, reason?:string}>} Load result.
   */
  async loadFile(file, options = {}) {
    this.errorMessage = '';
    this.pendingSeekTime = null;
    this.pendingShouldPlay = false;

    if (!file) {
      return { accepted: false, reason: 'missing-file' };
    }

    const probeAudio = this.audioFactory();
    const mimeType = resolveAudioMimeType(file);
    if (!canPlayMimeType(probeAudio, mimeType)) {
      this.errorMessage = 'Unsupported audio format.';
      this._emitStateChanged();
      return { accepted: false, reason: 'unsupported-format' };
    }

    const preserveCandidates = options.preserveCandidates === true;
    this.clear({ preserveCandidates });

    const audio = this.audioFactory();
    this.audio = audio;
    this.hasSource = true;
    this.isReady = false;
    this.isPlaying = false;
    this.sourceBlob = resolveAudioSource(file);
    this.decodedAudioBuffer = null;
    this.decodedAudioBufferPromise = null;
    this.fileName = resolveAudioFileName(file);
    this.mimeType = mimeType;
    this.objectUrl = this.urlApi.createObjectURL(this.sourceBlob);
    this.volume = clampVolume(this.volume);

    audio.preload = 'auto';
    audio.loop = this.loop;
    audio.volume = this.volume;
    audio.src = this.objectUrl;
    audio.addEventListener('loadedmetadata', this._onLoadedMetadata);
    audio.addEventListener('error', this._onAudioError);

    if (typeof audio.load === 'function') {
      audio.load();
    }

    this.errorMessage = '';
    this._emitStateChanged();
    this.syncFromActivePlayback({ forceSeek: true });
    return { accepted: true, mimeType };
  }

  /**
   * Decodes the currently loaded audio source for export.
   * @returns {Promise<AudioBuffer|null>} Decoded audio buffer.
   */
  async ensureDecodedAudioBuffer() {
    if (this.decodedAudioBuffer) {
      return this.decodedAudioBuffer;
    }

    if (this.decodedAudioBufferPromise) {
      return this.decodedAudioBufferPromise;
    }

    if (!this.sourceBlob || typeof this.sourceBlob.arrayBuffer !== 'function') {
      return null;
    }

    const AudioContextCtor = globalThis.AudioContext || globalThis.webkitAudioContext || null;
    if (!AudioContextCtor) {
      return null;
    }

    this.decodedAudioBufferPromise = (async () => {
      const context = new AudioContextCtor();
      try {
        const arrayBuffer = await this.sourceBlob.arrayBuffer();
        const decoded = await context.decodeAudioData(arrayBuffer.slice(0));
        this.decodedAudioBuffer = decoded;
        return decoded;
      } finally {
        if (typeof context.close === 'function') {
          try {
            await context.close();
          } catch {
            // Ignore decode context shutdown errors.
          }
        }
      }
    })();

    try {
      return await this.decodedAudioBufferPromise;
    } finally {
      this.decodedAudioBufferPromise = null;
    }
  }

  /**
   * Builds an export-ready AudioBuffer from the loaded BGM.
   * @param {number} durationSeconds - Export duration.
   * @param {object} [options] - Export options.
   * @param {number} [options.offsetSeconds=0] - Export start offset in source seconds.
   * @returns {Promise<AudioBuffer|null>} Export audio buffer.
   */
  async getExportAudioBuffer(durationSeconds, options = {}) {
    const sourceBuffer = await this.ensureDecodedAudioBuffer();
    if (!sourceBuffer) {
      return null;
    }

    const duration = Math.max(0, Number(durationSeconds) || 0);
    if (duration <= 0) {
      return null;
    }

    const { channelData, sampleRate, length, numberOfChannels } = composeAudioBufferChannelData(sourceBuffer, duration, {
      loop: this.loop,
      gain: clampVolume(this.volume),
      offsetSeconds: Number.isFinite(options.offsetSeconds) ? options.offsetSeconds : 0,
    });
    if (length <= 0) {
      return null;
    }

    const AudioContextCtor = globalThis.AudioContext || globalThis.webkitAudioContext || null;
    if (AudioContextCtor) {
      const context = new AudioContextCtor();
      try {
        const audioBuffer = context.createBuffer(numberOfChannels, length, sampleRate);
        for (let channelIndex = 0; channelIndex < numberOfChannels; channelIndex++) {
          audioBuffer.copyToChannel(channelData[channelIndex] || new Float32Array(length), channelIndex);
        }
        return audioBuffer;
      } finally {
        if (typeof context.close === 'function') {
          try {
            await context.close();
          } catch {
            // Ignore close errors for temporary contexts.
          }
        }
      }
    }

    return null;
  }

  /**
   * Syncs the BGM state from the active playback controller.
   * @param {object|null} [controller] - Animation controller.
   * @param {object} [options] - Sync options.
   * @param {boolean} [options.forceSeek=false] - Force audio seek.
   */
  syncFromController(controller = null, options = {}) {
    if (!this.audio) {
      return;
    }

    this.lastController = controller ?? this.lastController;
    const playbackController = controller ?? this.lastController ?? null;
    const playbackRange = this._resolvePlaybackRange(playbackController);
    const currentFrame = Number.isFinite(playbackController?.currentFrame) ? playbackController.currentFrame : 0;
    const isPlaying = Boolean(playbackController?.isPlaying);
    const desiredTime = Math.max(0, (currentFrame - playbackRange.start) / this.playbackFps);

    this.audio.volume = this.volume;
    this.audio.loop = this.loop;

    if (!this.isReady) {
      this.pendingSeekTime = desiredTime;
      this.pendingShouldPlay = isPlaying;
      this.isPlaying = false;
      this._emitStateChanged();
      return;
    }

    this._syncReadyAudio(desiredTime, isPlaying, Boolean(options.forceSeek));
  }

  /**
   * Syncs from the active playback controller returned by the configured getter.
   * @param {object} [options] - Sync options.
   */
  syncFromActivePlayback(options = {}) {
    const controller = this.getPlaybackController ? this.getPlaybackController() : null;
    this.syncFromController(controller, options);
  }

  /**
   * Returns the active playback range.
   * @param {object|null} controller - Animation controller.
   * @returns {{start:number, end:number|null}} Playback range.
   */
  _resolvePlaybackRange(controller) {
    const fallback = { start: 0, end: null };
    const playbackRange = this.getPlaybackRange ? this.getPlaybackRange() : fallback;
    if (controller && Number.isFinite(controller.playbackRangeStart)) {
      return {
        start: Math.max(0, controller.playbackRangeStart),
        end: Number.isFinite(controller.playbackRangeEnd) ? controller.playbackRangeEnd : null,
      };
    }
    return {
      start: Number.isFinite(playbackRange?.start) ? Math.max(0, playbackRange.start) : 0,
      end: Number.isFinite(playbackRange?.end) ? playbackRange.end : null,
    };
  }

  /**
   * Applies pending seek/play state once metadata has loaded.
   */
  _applyPendingSync() {
    if (!this.audio) {
      return;
    }

    if (this.pendingSeekTime !== null) {
      this._setAudioCurrentTime(this.pendingSeekTime);
    }

    const shouldPlay = this.pendingShouldPlay;
    this.pendingSeekTime = null;
    this.pendingShouldPlay = false;

    if (shouldPlay) {
      this._startPlayback();
    } else {
      this.audio.pause?.();
      this.isPlaying = false;
    }
  }

  /**
   * Syncs a ready audio element.
   * @param {number} desiredTime - Desired playback time.
   * @param {boolean} shouldPlay - Whether audio should be playing.
   * @param {boolean} forceSeek - Whether the audio should seek immediately.
   */
  _syncReadyAudio(desiredTime, shouldPlay, forceSeek) {
    if (!this.audio) {
      return;
    }

    const targetTime = this._resolveTargetTime(desiredTime);
    const duration = Number.isFinite(this.audio.duration) && this.audio.duration > 0 ? this.audio.duration : null;
    if (shouldPlay && duration && !this.loop && desiredTime >= duration) {
      this._setAudioCurrentTime(Math.max(0, duration - 0.001));
      this.audio.pause?.();
      this.isPlaying = false;
      this._emitStateChanged();
      return;
    }

    if (!shouldPlay) {
      this._setAudioCurrentTime(targetTime);
      this.audio.pause?.();
      this.isPlaying = false;
      this._emitStateChanged();
      return;
    }

    const currentTime = Number.isFinite(this.audio.currentTime) ? this.audio.currentTime : 0;
    const drift = Math.abs(currentTime - targetTime);
    if (forceSeek || this.audio.paused || drift > 0.35) {
      this._setAudioCurrentTime(targetTime);
    }

    this._startPlayback();
    this._emitStateChanged();
  }

  /**
   * Starts playback and tracks the result.
   */
  _startPlayback() {
    if (!this.audio) {
      return;
    }

    this.isPlaying = true;
    if (!this.audio.paused) {
      return;
    }

    const playPromise = this.audio.play?.();
    if (playPromise && typeof playPromise.catch === 'function') {
      playPromise.catch(() => {
        this.isPlaying = false;
        this._emitStateChanged();
      });
    }
  }

  /**
   * Resolves a target time against the audio duration and loop setting.
   * @param {number} desiredTime - Desired playback time.
   * @returns {number} Normalized target time.
   */
  _resolveTargetTime(desiredTime) {
    if (!this.audio) {
      return Math.max(0, desiredTime);
    }

    const duration = Number.isFinite(this.audio.duration) && this.audio.duration > 0 ? this.audio.duration : null;
    if (!duration) {
      return Math.max(0, desiredTime);
    }

    if (this.loop) {
      return ((desiredTime % duration) + duration) % duration;
    }

    if (desiredTime >= duration) {
      return Math.max(0, duration - 0.001);
    }

    return Math.max(0, desiredTime);
  }

  /**
   * Sets the current playback position.
   * @param {number} time - Playback time.
   */
  _setAudioCurrentTime(time) {
    if (!this.audio) {
      return;
    }

    try {
      this.audio.currentTime = Math.max(0, time);
    } catch {
      // Ignore browsers that refuse seeking before the element is ready.
    }
  }

  /**
   * Emits a state change notification.
   */
  _emitStateChanged() {
    this.onStateChanged?.(this.getState());
    this.refreshExportUi?.(this.getState());
  }
}
