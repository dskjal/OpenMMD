import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import test from 'node:test';

import { AnimationController } from '../source/core/animation/animation.js';
import { getManualRotationFromWorldRotation, getManualTranslationFromWorldPosition } from '../source/shared/bones/bone-transform-utils.js';
import { quaternionFromEulerXYZ } from '../source/shared/math/math-utils.js';
import { loadModelData } from '../source/core/model/model-scene.js';
import { TimelineManager } from '../source/application/timeline/timeline-manager.js';
import { VMDManager } from '../source/infrastructure/animation/vmd-manager.js';
import { loadZipArchive } from '../source/infrastructure/io/file-loading.js';
import { mat4, quat, vec3 } from '../source/lib/esm/index.js';

/**
 * Creates a lightweight animation instance for API flow tests.
 * @param {object} model - Parsed model.
 * @returns {object} Model instance.
 */
function createTestInstance(model) {
  const morphController = {
    resetManualWeight() {},
    setManualWeight() {},
    update() {},
  };

  return {
    model,
    morphController,
    animationController: new AnimationController(model, morphController),
    scene: createTestScene(model),
    vmd: null,
    vmdName: null,
  };
}

/**
 * Creates a minimal scene state for API tests.
 * @param {object} model - Parsed model.
 * @returns {object} Scene state.
 */
function createTestScene(model) {
  const boneLocalTransforms = model.bones.map((bone, index) => createTestBoneLocalTransform(model, bone, index));
  const boneCount = boneLocalTransforms.length;

  return {
    boneCount,
    boneLocalTransforms,
    boneWorldPositions: Array.from({ length: boneCount }, () => vec3.create()),
    sortedBoneIndices: model.bones
      .map((bone, index) => ({ index, level: Number.isFinite(bone.transformLevel) ? bone.transformLevel : 0 }))
      .sort((a, b) => a.level - b.level || a.index - b.index)
      .map((item) => item.index),
    inverseBindMatrices: model.bones.map((bone) => mat4TranslationFromBone(bone)),
    ikChains: [],
    _tempMat: mat4.create(),
    _tempQuat: quat.create(),
    _tempQuat2: quat.create(),
    _tempVec3: vec3.create(),
    _identityQuat: quat.create(),
  };
}

/**
 * Creates a local transform for a test scene.
 * @param {object} model - Parsed model.
 * @param {object} bone - Bone definition.
 * @param {number} index - Bone index.
 * @returns {object} Local transform.
 */
function createTestBoneLocalTransform(model, bone, index) {
  const lx = bone.localX || [1, 0, 0];
  const ly = bone.localY || [0, 1, 0];
  const lz = bone.localZ || [0, 0, 1];
  const matrix = [lx[0], lx[1], lx[2], ly[0], ly[1], ly[2], lz[0], lz[1], lz[2]];
  const worldRotation = quat.create();
  quat.fromMat3(worldRotation, matrix);

  const baseTranslation = vec3.create();
  const parent = bone.parentIndex !== -1 ? model.bones[bone.parentIndex] : null;
  if (parent) {
    vec3.set(
      baseTranslation,
      bone.position[0] - parent.position[0],
      bone.position[1] - parent.position[1],
      bone.position[2] - parent.position[2],
    );
  } else {
    vec3.set(baseTranslation, bone.position[0], bone.position[1], bone.position[2]);
  }

  const worldMatrix = mat4.create();
  mat4.fromTranslation(worldMatrix, baseTranslation);

  return {
    translation: vec3.fromValues(0, 0, 0),
    rotation: quat.fromValues(0, 0, 0, 1),
    manualTranslation: vec3.fromValues(0, 0, 0),
    manualRotation: quat.fromValues(0, 0, 0, 1),
    scale: vec3.fromValues(1, 1, 1),
    worldMatrix,
    skinMatrix: mat4.create(),
    worldRotation,
    localX: lx,
    localY: ly,
    localZ: lz,
    baseTranslation,
    localDirty: true,
    worldDirty: true,
    physicsMode: -1,
  };
}

/**
 * Creates a translation matrix for inverse bind data in tests.
 * @param {object} bone - Bone definition.
 * @returns {mat4} Translation matrix.
 */
function mat4TranslationFromBone(bone) {
  const matrix = mat4.create();
  mat4.fromTranslation(matrix, [-bone.position[0], -bone.position[1], -bone.position[2]]);
  return matrix;
}

/**
 * Waits until a predicate becomes true.
 * @param {() => boolean} predicate - Completion predicate.
 * @param {number} [timeoutMs=1000] - Timeout.
 * @returns {Promise<void>} Completion promise.
 */
async function waitFor(predicate, timeoutMs = 1000) {
  const startedAt = Date.now();
  while (!predicate()) {
    if (Date.now() - startedAt > timeoutMs) {
      throw new Error('Timed out waiting for condition.');
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

/**
 * Creates a minimal EventSource mock for bridge tests.
 * @returns {typeof EventSource & { instances: object[] }} Mock constructor.
 */
function createEventSourceMock() {
  class MockEventSource {
    constructor(url) {
      this.url = url;
      this.closed = false;
      this.listeners = new Map();
      MockEventSource.instances.push(this);
    }

    addEventListener(type, handler) {
      if (!this.listeners.has(type)) {
        this.listeners.set(type, []);
      }
      this.listeners.get(type).push(handler);
    }

    close() {
      this.closed = true;
    }

    emit(type, data) {
      const handlers = this.listeners.get(type) || [];
      const event = {
        data: typeof data === 'string' ? data : JSON.stringify(data),
      };
      for (const handler of handlers) {
        handler(event);
      }
    }
  }

  MockEventSource.instances = [];
  return MockEventSource;
}

/**
 * Installs a minimal viewer runtime for the command bridge.
 * @param {object} options - Test options.
 * @returns {object} Cleanup handle.
 */
async function installRuntime(options) {
  const previous = {
    window: globalThis.window,
    document: globalThis.document,
  };

  const modelManager = {
    instances: options.instances,
    removeModel(index) {
      this.instances.splice(index, 1);
    },
    recomputeBoneMatrices() {},
    writeBoneMatrices() {},
    resetManualTransform(instance, boneIndex) {
      const local = instance?.scene?.boneLocalTransforms?.[boneIndex];
      if (!local) {
        return;
      }

      vec3.set(local.manualTranslation, 0, 0, 0);
      quat.identity(local.manualRotation);
      local.localDirty = true;
      local.worldDirty = true;
    },
    setManualLocalPosition(instance, boneIndex, position) {
      const local = instance?.scene?.boneLocalTransforms?.[boneIndex];
      if (!local) {
        return;
      }

      vec3.subtract(local.manualTranslation, position, local.translation);
      local.localDirty = true;
      local.worldDirty = true;
    },
    setManualWorldPosition(instance, boneIndex, position) {
      const local = instance?.scene?.boneLocalTransforms?.[boneIndex];
      const bone = instance?.model?.bones?.[boneIndex];
      if (!local || !bone) {
        return;
      }

      getManualTranslationFromWorldPosition(instance.scene, bone, local, position, local.manualTranslation);
      local.localDirty = true;
      local.worldDirty = true;
    },
    setManualLocalRotationEuler(instance, boneIndex, eulerRadians) {
      const targetRotation = quaternionFromEulerXYZ(eulerRadians);
      this.setManualLocalRotationQuaternion(instance, boneIndex, targetRotation);
    },
    setManualLocalRotationQuaternion(instance, boneIndex, targetRotation) {
      const local = instance?.scene?.boneLocalTransforms?.[boneIndex];
      if (!local) {
        return;
      }

      const invAnimRot = quat.invert(quat.create(), local.rotation);
      quat.multiply(local.manualRotation, targetRotation, invAnimRot);
      quat.normalize(local.manualRotation, local.manualRotation);
      local.localDirty = true;
      local.worldDirty = true;
    },
    setManualWorldRotationEuler(instance, boneIndex, eulerRadians) {
      const targetRotation = quaternionFromEulerXYZ(eulerRadians);
      this.setManualWorldRotationQuaternion(instance, boneIndex, targetRotation);
    },
    setManualWorldRotationQuaternion(instance, boneIndex, targetRotation) {
      const local = instance?.scene?.boneLocalTransforms?.[boneIndex];
      const bone = instance?.model?.bones?.[boneIndex];
      if (!local || !bone) {
        return;
      }

      getManualRotationFromWorldRotation(instance.scene, bone, local, targetRotation, local.manualRotation);
      local.localDirty = true;
      local.worldDirty = true;
    },
  };
  const selection = {
    activeInstanceIndex: options.instances.length > 0 ? 0 : -1,
  };
  const rendererState = {
    environmentHdrPath: 'test-data/sundowner_deck_1k.hdr',
    environmentHdrName: 'sundowner_deck_1k.hdr',
    environmentHdrIntensity: 1.0,
    environmentHdrLoaded: true,
  };
  const vmdManager = new VMDManager();
  const timelineManager = new TimelineManager({
    modelManager,
    selection,
    timelineView: null,
    interpolationPanel: null,
    vmdManager,
    refreshScene() {},
    updateVmdListUI() {},
  });

  globalThis.document = { fullscreenElement: null };
  const runtimeObject = {
    atob: globalThis.atob,
    btoa: globalThis.btoa,
    document: globalThis.document,
    setTimeout: globalThis.setTimeout,
    clearTimeout: globalThis.clearTimeout,
    setInterval: globalThis.setInterval,
    clearInterval: globalThis.clearInterval,
    loadZipModel: options.loadZipModel,
    loadVmd: options.loadVmd,
    loadEnvironmentHdrFile: async (file) => {
      rendererState.environmentHdrPath = typeof file?.name === 'string' && file.name.trim()
        ? file.name.trim()
        : rendererState.environmentHdrPath;
      rendererState.environmentHdrName = rendererState.environmentHdrPath.split(/[\\/]/).pop() || rendererState.environmentHdrPath;
      rendererState.environmentHdrLoaded = true;
    },
    setEnvironmentHdrPath: async (hdrPath) => {
      rendererState.environmentHdrPath = typeof hdrPath === 'string' && hdrPath.trim()
        ? hdrPath.trim()
        : rendererState.environmentHdrPath;
      rendererState.environmentHdrName = rendererState.environmentHdrPath.split(/[\\/]/).pop() || rendererState.environmentHdrPath;
      rendererState.environmentHdrLoaded = true;
    },
    setEnvironmentHdrIntensity: (intensity) => {
      rendererState.environmentHdrIntensity = Number.isFinite(Number(intensity))
        ? Number(intensity)
        : rendererState.environmentHdrIntensity;
    },
    modelManager,
    selection,
    vmdManager,
    rendererState,
    physicsEngine: null,
    videoExportManager: options.videoExportManager,
    enterAppFullscreen: async () => {},
    exitAppFullscreen: async () => {},
  };
  const commands = {
    loadZipModel: (...args) => runtimeObject.loadZipModel?.(...args),
    loadVmd: (...args) => runtimeObject.loadVmd?.(...args),
    loadEnvironmentHdrFile: (...args) => runtimeObject.loadEnvironmentHdrFile?.(...args),
    setEnvironmentHdrPath: (...args) => runtimeObject.setEnvironmentHdrPath?.(...args),
    setEnvironmentHdrIntensity: (...args) => runtimeObject.setEnvironmentHdrIntensity?.(...args),
    togglePlayback: () => timelineManager?.togglePlayback?.(),
    play: () => timelineManager?.play?.(),
    pause: () => timelineManager?.stop?.(),
    rewind: () => timelineManager?.rewind?.(),
    goToEnd: () => timelineManager?.goToEnd?.(),
    seek: (...args) => timelineManager?.seek?.(...args),
    stepFrame: (...args) => timelineManager?.stepFrame?.(...args),
    stepKeyframe: (...args) => timelineManager?.stepKeyframe?.(...args),
    setPlaybackRange: (...args) => timelineManager?.setPlaybackRange?.(...args),
    getPlaybackRange: () => timelineManager?.getPlaybackRange?.(),
    getPlaybackController: () => timelineManager?.getPlaybackController?.(),
    assignVmdToActiveInstance: (...args) => timelineManager?.assignVmdToActiveInstance?.(...args),
    exportVideo: (...args) => runtimeObject.videoExportManager?.exportVideo?.(...args),
    removeActiveModel() {
      const index = runtimeObject.selection.activeInstanceIndex;
      if (index < 0 || index >= runtimeObject.modelManager.instances.length) {
        return;
      }
      runtimeObject.modelManager.removeModel(index);
      runtimeObject.selection.activeInstanceIndex = runtimeObject.modelManager.instances.length > 0
        ? Math.min(index, runtimeObject.modelManager.instances.length - 1)
        : -1;
    },
    activateInstance(index) {
      runtimeObject.selection.activeInstanceIndex = index;
      timelineManager?.setActiveInstance?.(index);
    },
    selectModel(index) {
      this.activateInstance(index);
    },
    resetPhysics() {},
    enterFullscreen: async () => runtimeObject.enterAppFullscreen?.(),
    exitFullscreen: async () => runtimeObject.exitAppFullscreen?.(),
    syncBgmPlayback() {},
    setBoneParams(payload) {
      const targets = Array.isArray(payload?.targets) ? payload.targets : [];
      const instance = runtimeObject.modelManager.instances[runtimeObject.selection.activeInstanceIndex];
      for (const target of targets) {
        const boneIndex = instance?.model?.bones?.findIndex((bone) => bone?.name === target?.boneName) ?? -1;
        if (boneIndex < 0) {
          continue;
        }
        if (target.kind === 'position') {
          if (target.space === 'world') {
            runtimeObject.modelManager.setManualWorldPosition(instance, boneIndex, target.value);
          } else {
            runtimeObject.modelManager.setManualLocalPosition(instance, boneIndex, target.value);
          }
        }
      }
      runtimeObject.modelManager.recomputeBoneMatrices(instance.model, instance.scene);
      runtimeObject.modelManager.writeBoneMatrices(instance.scene);
    },
  };
  globalThis.window = runtimeObject;

  const bridge = await import(`../source/application/integration/api-bridge.js?test=${Date.now()}`);
  const apiBridge = bridge.createApiBridge({
    runtime: runtimeObject,
    commands,
  });
  const executeCommand = (message, extraOptions = {}) => apiBridge.executeCommand(message, extraOptions);
  const setupOpenMmdMessageBridge = (extraOptions = {}) => apiBridge.install({
    ...extraOptions,
  });
  return {
    bridge,
    executeCommand,
    setupOpenMmdMessageBridge,
    runtimeObject,
    commands,
    modelManager,
    selection,
    timelineManager,
    vmdManager,
    rendererState,
    restore() {
      globalThis.window = previous.window;
      globalThis.document = previous.document;
    },
  };
}

test('API control flow loads Alicia, assigns the VMD, exports video data, and returns bytes', async () => {
  const zipBytes = await fs.readFile('./test-data/alicia.zip');
  const vmdBytes = await fs.readFile('./test-data/2分ループステップ1.vmd');
  const zipFile = new File([zipBytes], 'alicia.zip');
  const vmdFile = new File([vmdBytes], '2分ループステップ1.vmd');

  const runtime = await installRuntime({
    instances: [
      {
        model: { name: 'legacy' },
        animationController: {
          currentFrame: 0,
          isPlaying: false,
          setVmd() {},
          togglePlayback() {},
          play() {},
          stop() {},
          rewind() {},
          goToEnd() {},
          setPlaybackRange() { return false; },
        },
      },
    ],
    loadZipModel: async (zipFiles) => {
      const modelPath = Object.keys(zipFiles).find((path) => path.toLowerCase().endsWith('.pmx'));
      assert.ok(modelPath, 'zip should contain a pmx model');
      const { model } = await loadModelData(zipFiles, 1, modelPath);
      const instance = createTestInstance(model);
      runtime.modelManager.instances.push(instance);
      runtime.selection.activeInstanceIndex = runtime.modelManager.instances.length - 1;
      runtime.commands.activateInstance(runtime.selection.activeInstanceIndex);
      return instance;
    },
    loadVmd: async (file) => runtime.vmdManager.loadVmd(file),
    videoExportManager: null,
  });

  try {
    const { executeCommand } = runtime;
    let capturedExportOptions = null;
    globalThis.window.videoExportManager = {
      async exportVideo(options) {
        capturedExportOptions = options;
        const blob = new Blob([JSON.stringify({
          modelName: runtime.modelManager.instances[runtime.selection.activeInstanceIndex]?.model?.name,
          vmdName: runtime.modelManager.instances[runtime.selection.activeInstanceIndex]?.vmdName,
          options,
        })], { type: 'video/webm' });
        return {
          blob,
          filename: 'openmmd-export.webm',
          mimeType: 'video/webm',
        };
      },
    };

    const initialState = await executeCommand({ command: 'get-state' });
    assert.equal(initialState.modelNames.length, 1);
    assert.equal(initialState.activeModelName, 'legacy');

    await executeCommand({ command: 'unload-model' });
    const afterUnloadState = await executeCommand({ command: 'get-state' });
    assert.equal(afterUnloadState.modelNames.length, 0);
    assert.equal(afterUnloadState.activeInstanceIndex, -1);

    await executeCommand({
      command: 'load-zip',
      payload: {
        file: zipFile,
      },
    }, {
      loadZipArchive,
    });

    const loadedState = await executeCommand({ command: 'get-state' });
    assert.equal(loadedState.modelNames.length, 1);
    assert.match(loadedState.activeModelName, /Alicia|アリシア/i);

    await executeCommand({
      command: 'load-vmd',
      payload: {
        file: vmdFile,
      },
    });

    const vmdName = '2分ループステップ1.vmd';
    assert.ok(runtime.vmdManager.vmds.has(vmdName), 'vmd should be loaded into the manager');

    await executeCommand({ command: 'assign-vmd', payload: { vmdName } });
    const activeInstance = runtime.modelManager.instances[runtime.selection.activeInstanceIndex];
    assert.equal(activeInstance.vmdName, vmdName);
    assert.ok(activeInstance.vmd, 'vmd should be assigned to the active model');

    await executeCommand({ command: 'set-playback-range', payload: { start: 0, end: 30 } });
    assert.deepEqual(runtime.commands.getPlaybackRange(), { start: 0, end: 30 });

    const exportResult = await executeCommand({
      command: 'export-video',
      payload: {
        format: 'webm',
        codec: 'vp9',
        width: 640,
        height: 360,
        exportFps: 30,
        includeAudio: true,
        transparentBackground: true,
      },
    });

    assert.ok(capturedExportOptions, 'exportVideo should be called');
    assert.equal(capturedExportOptions.startFrame, 0);
    assert.equal(capturedExportOptions.endFrame, 30);
    assert.equal(capturedExportOptions.includeAudio, true);
    assert.equal(capturedExportOptions.transparentBackground, true);
    assert.equal(exportResult.filename, 'openmmd-export.webm');
    assert.equal(exportResult.mimeType, 'video/webm');
    assert.ok(exportResult.blob instanceof Blob, 'export should return a Blob');
    assert.ok(exportResult.blob.size > 0, 'exported video data should not be empty');

    const exportedJson = JSON.parse(await exportResult.blob.text());
    assert.match(exportedJson.modelName, /Alicia|アリシア/i);
    assert.equal(exportedJson.vmdName, vmdName);
    assert.equal(exportedJson.options.endFrame, 30);
  } finally {
    runtime.restore();
  }
});

test('API control flow accepts an injected runtime object', async () => {
  const runtime = await installRuntime({
    instances: [
      {
        model: { name: 'legacy' },
        animationController: {
          currentFrame: 12,
          isPlaying: false,
          setVmd() {},
          togglePlayback() {},
          play() {},
          stop() {},
          rewind() {},
          goToEnd() {},
          setPlaybackRange() { return false; },
        },
      },
    ],
    loadZipModel: async () => {},
    loadVmd: async () => {},
    videoExportManager: null,
  });

  try {
    const { executeCommand } = runtime;
    const state = await executeCommand({ command: 'get-state' }, { runtime: runtime.runtimeObject });
    assert.equal(state.activeModelName, 'legacy');
    assert.equal(state.activeInstanceIndex, 0);
  } finally {
    runtime.restore();
  }
});

test('API control flow set-bone-params moves the active center bone on local Y', async () => {
  const zipBytes = await fs.readFile('./test-data/alicia.zip');
  const zipFile = new File([zipBytes], 'alicia.zip');

  const runtime = await installRuntime({
    instances: [
      {
        model: { name: 'legacy' },
        animationController: {
          currentFrame: 0,
          isPlaying: false,
          setVmd() {},
          togglePlayback() {},
          play() {},
          stop() {},
          rewind() {},
          goToEnd() {},
          setPlaybackRange() { return false; },
        },
      },
    ],
    loadZipModel: async (zipFiles) => {
      const modelPath = Object.keys(zipFiles).find((path) => path.toLowerCase().endsWith('.pmx'));
      assert.ok(modelPath, 'zip should contain a pmx model');
      const { model } = await loadModelData(zipFiles, 1, modelPath);
      const instance = createTestInstance(model);
      runtime.modelManager.instances.push(instance);
      runtime.selection.activeInstanceIndex = runtime.modelManager.instances.length - 1;
      runtime.commands.activateInstance(runtime.selection.activeInstanceIndex);
      return instance;
    },
    loadVmd: async () => {},
    videoExportManager: null,
  });

  try {
    const { executeCommand } = runtime;

    await executeCommand({
      command: 'load-zip',
      payload: {
        file: zipFile,
      },
    }, {
      loadZipArchive,
    });

    const response = await executeCommand({
      command: 'set-bone-params',
      payload: {
        targets: [
          {
            boneName: 'センター',
            space: 'local',
            kind: 'position',
            value: [0, 2, 0],
          },
        ],
      },
    });

    const activeModel = response.models.find((model) => model.isActive);
    assert.ok(activeModel, 'active model should be present in the snapshot');
    const centerBone = activeModel.bones.find((bone) => bone.name === 'センター');
    assert.ok(centerBone, 'センター bone should be present');
    assert.deepEqual(centerBone.local.position, [0, 2, 0]);
  } finally {
    runtime.restore();
  }
});

test('API control flow can load HDR environments and change brightness', async () => {
  const runtime = await installRuntime({
    instances: [
      {
        model: { name: 'legacy' },
        animationController: {
          currentFrame: 0,
          isPlaying: false,
          setVmd() {},
          togglePlayback() {},
          play() {},
          stop() {},
          rewind() {},
          goToEnd() {},
          setPlaybackRange() { return false; },
        },
      },
    ],
    loadZipModel: async () => {},
    loadVmd: async () => {},
    videoExportManager: null,
  });

  try {
    const { executeCommand } = runtime;
    const file = new File(['dummy'], 'studio.hdr');

    const loadResult = await executeCommand({
      command: 'load-environment-hdr',
      payload: { file },
    });

    assert.equal(loadResult.loaded, 'hdr');
    assert.equal(loadResult.fileName, 'studio.hdr');
    assert.equal(runtime.rendererState.environmentHdrName, 'studio.hdr');

    const intensityResult = await executeCommand({
      command: 'set-environment-hdr-intensity',
      payload: { intensity: 2.25 },
    });

    assert.equal(runtime.rendererState.environmentHdrIntensity, 2.25);
    assert.equal(intensityResult.environmentHdrIntensity, 2.25);
    assert.equal(intensityResult.environmentHdrName, 'studio.hdr');
  } finally {
    runtime.restore();
  }
});

test('server bridge forwards command results back to the local API server', async () => {
  const runtime = await installRuntime({
    instances: [
      {
        model: { name: 'legacy' },
        animationController: {
          currentFrame: 0,
          isPlaying: false,
          setVmd() {},
          togglePlayback() {},
          play() {},
          stop() {},
          rewind() {},
          goToEnd() {},
          setPlaybackRange() { return false; },
        },
      },
    ],
    loadZipModel: async () => {},
    loadVmd: async () => {},
    videoExportManager: null,
  });

  const previousFetch = globalThis.fetch;
  const previousEventSource = globalThis.EventSource;
  const fetchCalls = [];
  const postedCommandResults = [];
  const runtimeStatePosts = [];
  const MockEventSource = createEventSourceMock();

  globalThis.EventSource = MockEventSource;
  globalThis.fetch = async (url, init = {}) => {
    const requestUrl = String(url);
    const bodyText = typeof init.body === 'string' ? init.body : '';
    fetchCalls.push({ url: requestUrl, init, bodyText });
    if (requestUrl.endsWith('/api/command-result')) {
      postedCommandResults.push(JSON.parse(bodyText));
    }
    if (requestUrl.endsWith('/api/runtime-state')) {
      runtimeStatePosts.push(JSON.parse(bodyText));
    }
    return {
      ok: true,
      status: 200,
      json: async () => ({ ok: true }),
    };
  };

  try {
    const bridge = runtime.setupOpenMmdMessageBridge({
      loadZipArchive,
      transport: 'server',
    });
    assert.equal(MockEventSource.instances.length, 1);

    runtime.window = globalThis.window;
    globalThis.window.videoExportManager = {
      async exportVideo(options) {
        const blob = new Blob([JSON.stringify({
          options,
        })], { type: 'video/webm' });
        return {
          blob,
          filename: 'openmmd-export.webm',
          mimeType: 'video/webm',
        };
      },
    };

    const eventSource = MockEventSource.instances[0];
    eventSource.emit('command', {
      namespace: 'openmmd-api',
      type: 'command',
      id: 'cmd-bridge-test',
      command: 'export-video',
      payload: {
        format: 'webm',
        codec: 'vp9',
        width: 640,
        height: 360,
        exportFps: 30,
        includeAudio: false,
      },
    });

    await waitFor(() => postedCommandResults.length > 0);

    assert.ok(fetchCalls.some((call) => call.url.endsWith('/api/runtime-state')));
    assert.equal(postedCommandResults[0].namespace, 'openmmd-api');
    assert.equal(postedCommandResults[0].type, 'response');
    assert.equal(postedCommandResults[0].id, 'cmd-bridge-test');
    assert.equal(postedCommandResults[0].ok, true);
    assert.equal(postedCommandResults[0].result.filename, 'openmmd-export.webm');
    assert.equal(postedCommandResults[0].result.mimeType, 'video/webm');
    assert.ok(postedCommandResults[0].result.blob.fileData.length > 0);
    assert.equal(postedCommandResults[0].result.blob.fileName, 'openmmd-export.webm');
    assert.equal(postedCommandResults[0].result.blob.fileType, 'video/webm');
    assert.ok(runtimeStatePosts.length > 0);

    bridge.dispose();
    assert.equal(eventSource.closed, true);
  } finally {
    globalThis.fetch = previousFetch;
    globalThis.EventSource = previousEventSource;
    runtime.restore();
  }
});
