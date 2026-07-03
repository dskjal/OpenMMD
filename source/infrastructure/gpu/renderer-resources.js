import { createMaterialResources, createEmptyTexture, loadSphereTexture, loadTexture, loadToonTexture } from './material-resources.js';
const LINEAR_COLOR_FORMAT = 'rgba16float';
const SSS_MASK_RENDER_FORMAT = 'rgba16float';
const SSS_MASK_RESOLVED_FORMAT = 'rgba32float';
/**
 * モデルの頂点とボーン座標をスケールします。
 * @param {object} model - モデルデータ。
 * @param {number} unitScale - スケール倍率。
 */
export function scaleModel(model, unitScale) {
  if (unitScale === 1.0) {
    return;
  }

  const scaleVec3 = (vec) => {
    if (!Array.isArray(vec) || vec.length < 3) {
      return;
    }
    vec[0] *= unitScale;
    vec[1] *= unitScale;
    vec[2] *= unitScale;
  };

  const stride = 27;
  for (let i = 0; i < model.vertices.length; i += stride) {
    model.vertices[i + 0] *= unitScale;
    model.vertices[i + 1] *= unitScale;
    model.vertices[i + 2] *= unitScale;
    for (let j = 17; j < 26; j++) {
      model.vertices[i + j] *= unitScale;
    }
  }

  for (const bone of model.bones) {
    bone.position[0] *= unitScale;
    bone.position[1] *= unitScale;
    bone.position[2] *= unitScale;
    if (Array.isArray(bone.tailOffset)) {
      scaleVec3(bone.tailOffset);
    }
  }

  if (Array.isArray(model.rigidBodies)) {
    for (const rigidBody of model.rigidBodies) {
      if (!rigidBody) {
        continue;
      }
      scaleVec3(rigidBody.size);
      scaleVec3(rigidBody.position);
    }
  }

  if (Array.isArray(model.joints)) {
    for (const joint of model.joints) {
      if (!joint) {
        continue;
      }
      scaleVec3(joint.position);
      scaleVec3(joint.posMin);
      scaleVec3(joint.posMax);
    }
  }

  if (Array.isArray(model.morphs)) {
    for (const morph of model.morphs) {
      if (!morph || !Array.isArray(morph.offsets)) {
        continue;
      }

      for (const offset of morph.offsets) {
        if (!offset || typeof offset !== 'object') {
          continue;
        }
        scaleVec3(offset.position);
        scaleVec3(offset.translation);
      }
    }
  }
}

/**
 * キャンバスターゲットを作成します。
 * @param {GPUDevice} device - WebGPU デバイス。
 * @param {HTMLCanvasElement} canvas - 描画対象キャンバス。
 * @param {GPUTextureFormat} format - テクスチャフォーマット。
 * @param {number} initialSampleCount - 初期 MSAA サンプル数。
 * @returns {object} キャンバスターゲット。
 */
export function createCanvasTargets(device, canvas, format, initialSampleCount, initialInternalResolution = 'auto') {
  let renderTexture = null;
  let resolveTexture = null;
  let prepassNormalRenderTexture = null;
  let prepassNormalResolveTexture = null;
  let prepassDepthRenderTexture = null;
  let prepassDepthResolveTexture = null;
  let normalRenderTexture = null;
  let normalResolveTexture = null;
  let gridOverlayRenderTexture = null;
  let gridOverlayResolveTexture = null;
  let uiOverlayRenderTexture = null;
  let uiOverlayResolveTexture = null;
  let postEffectTextureA = null;
  let postEffectTextureB = null;
  let dofBlurTexture = null;
  let bloomDownsampleTextures = [];
  let bloomUpsampleTextures = [];
  let bloomLevelSizes = [];
  let ssssTextureA = null;
  let ssssTextureB = null;
  let ssssMaskRenderTexture = null;
  let ssssMaskTexture = null;
  let contactShadowMaskTexture = null;
  let ambientOcclusionMaskTexture = null;
  let captureTexture = null;
  let captureTextureFormat = format;
  let pickWorldTexture = null;
  let pickDepthTexture = null;
  let depthTextures = new Map();
  let sampleCount = initialSampleCount;

  const resize = (newSampleCount = sampleCount, internalResolution = 'auto') => {
    sampleCount = newSampleCount;

    if (internalResolution === 'auto') {
      canvas.width = canvas.clientWidth;
      canvas.height = canvas.clientHeight;
    } else {
      const parts = internalResolution.split('x');
      if (parts.length === 2) {
        canvas.width = parseInt(parts[0], 10);
        canvas.height = parseInt(parts[1], 10);
      } else {
        canvas.width = canvas.clientWidth;
        canvas.height = canvas.clientHeight;
      }
    }

    if (renderTexture) {
      renderTexture.destroy();
    }
    if (resolveTexture) {
      resolveTexture.destroy();
      resolveTexture = null;
    }
    if (normalRenderTexture) {
      normalRenderTexture.destroy();
      normalRenderTexture = null;
    }
    if (normalResolveTexture) {
      normalResolveTexture.destroy();
      normalResolveTexture = null;
    }
    if (prepassNormalRenderTexture) {
      prepassNormalRenderTexture.destroy();
      prepassNormalRenderTexture = null;
    }
    if (prepassNormalResolveTexture) {
      prepassNormalResolveTexture.destroy();
      prepassNormalResolveTexture = null;
    }
    if (prepassDepthRenderTexture) {
      prepassDepthRenderTexture.destroy();
      prepassDepthRenderTexture = null;
    }
    if (prepassDepthResolveTexture) {
      prepassDepthResolveTexture.destroy();
      prepassDepthResolveTexture = null;
    }
    if (gridOverlayRenderTexture) {
      gridOverlayRenderTexture.destroy();
      gridOverlayRenderTexture = null;
    }
    if (gridOverlayResolveTexture) {
      gridOverlayResolveTexture.destroy();
      gridOverlayResolveTexture = null;
    }
    if (uiOverlayRenderTexture) {
      uiOverlayRenderTexture.destroy();
      uiOverlayRenderTexture = null;
    }
    if (uiOverlayResolveTexture) {
      uiOverlayResolveTexture.destroy();
      uiOverlayResolveTexture = null;
    }
    if (postEffectTextureA) {
      postEffectTextureA.destroy();
      postEffectTextureA = null;
    }
    if (postEffectTextureB) {
      postEffectTextureB.destroy();
      postEffectTextureB = null;
    }
    if (dofBlurTexture) {
      dofBlurTexture.destroy();
      dofBlurTexture = null;
    }
    for (const texture of bloomDownsampleTextures) {
      texture.destroy();
    }
    bloomDownsampleTextures = [];
    for (const texture of bloomUpsampleTextures) {
      texture.destroy();
    }
    bloomUpsampleTextures = [];
    bloomLevelSizes = [];
    if (ssssTextureA) {
      ssssTextureA.destroy();
      ssssTextureA = null;
    }
    if (ssssTextureB) {
      ssssTextureB.destroy();
      ssssTextureB = null;
    }
    if (ssssMaskRenderTexture) {
      ssssMaskRenderTexture.destroy();
      ssssMaskRenderTexture = null;
    }
    if (ssssMaskTexture) {
      ssssMaskTexture.destroy();
      ssssMaskTexture = null;
    }
    if (contactShadowMaskTexture) {
      contactShadowMaskTexture.destroy();
      contactShadowMaskTexture = null;
    }
    if (ambientOcclusionMaskTexture) {
      ambientOcclusionMaskTexture.destroy();
      ambientOcclusionMaskTexture = null;
    }
    if (captureTexture) {
      captureTexture.destroy();
      captureTexture = null;
    }
    if (pickWorldTexture) {
      pickWorldTexture.destroy();
      pickWorldTexture = null;
    }
    if (pickDepthTexture) {
      pickDepthTexture.destroy();
      pickDepthTexture = null;
    }
    for (const texture of depthTextures.values()) {
      texture.destroy();
    }
    depthTextures.clear();

    renderTexture = device.createTexture({
      size: [canvas.width, canvas.height],
      sampleCount,
      format: LINEAR_COLOR_FORMAT,
      usage: GPUTextureUsage.RENDER_ATTACHMENT | (sampleCount === 1 ? GPUTextureUsage.TEXTURE_BINDING : 0),
    });
    if (sampleCount > 1) {
      resolveTexture = device.createTexture({
        size: [canvas.width, canvas.height],
        format: LINEAR_COLOR_FORMAT,
        usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING,
      });
    }
    prepassNormalRenderTexture = device.createTexture({
      size: [canvas.width, canvas.height],
      sampleCount,
      format: 'rgba16float',
      usage: GPUTextureUsage.RENDER_ATTACHMENT | (sampleCount === 1 ? GPUTextureUsage.TEXTURE_BINDING : 0),
    });
    if (sampleCount > 1) {
      prepassNormalResolveTexture = device.createTexture({
        size: [canvas.width, canvas.height],
        format: 'rgba16float',
        usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING,
      });
    }
    prepassDepthRenderTexture = device.createTexture({
      size: [canvas.width, canvas.height],
      sampleCount,
      format: 'rgba16float',
      usage: GPUTextureUsage.RENDER_ATTACHMENT | (sampleCount === 1 ? GPUTextureUsage.TEXTURE_BINDING : 0),
    });
    if (sampleCount > 1) {
      prepassDepthResolveTexture = device.createTexture({
        size: [canvas.width, canvas.height],
        format: 'rgba16float',
        usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING,
      });
    }
    normalRenderTexture = device.createTexture({
      size: [canvas.width, canvas.height],
      sampleCount,
      format: 'rgba16float',
      usage: GPUTextureUsage.RENDER_ATTACHMENT | (sampleCount === 1 ? GPUTextureUsage.TEXTURE_BINDING : 0),
    });
    if (sampleCount > 1) {
      normalResolveTexture = device.createTexture({
        size: [canvas.width, canvas.height],
        format: 'rgba16float',
        usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING,
      });
    }

    gridOverlayRenderTexture = device.createTexture({
      size: [canvas.width, canvas.height],
      sampleCount: 4,
      format: LINEAR_COLOR_FORMAT,
      usage: GPUTextureUsage.RENDER_ATTACHMENT,
    });
    gridOverlayResolveTexture = device.createTexture({
      size: [canvas.width, canvas.height],
      format: LINEAR_COLOR_FORMAT,
      usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING,
    });

    uiOverlayRenderTexture = device.createTexture({
      size: [canvas.width, canvas.height],
      sampleCount: 4,
      format: LINEAR_COLOR_FORMAT,
      usage: GPUTextureUsage.RENDER_ATTACHMENT,
    });
    uiOverlayResolveTexture = device.createTexture({
      size: [canvas.width, canvas.height],
      format: LINEAR_COLOR_FORMAT,
      usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING,
    });

    postEffectTextureA = device.createTexture({
      size: [canvas.width, canvas.height],
      format: LINEAR_COLOR_FORMAT,
      usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING,
    });
    postEffectTextureB = device.createTexture({
      size: [canvas.width, canvas.height],
      format: LINEAR_COLOR_FORMAT,
      usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING,
    });
    dofBlurTexture = device.createTexture({
      size: [canvas.width, canvas.height],
      format: 'rgba32float',
      usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING,
    });

    for (let level = 0; level < 5; level += 1) {
      const divisor = 2 ** (level + 1);
      const levelWidth = Math.max(1, Math.floor(canvas.width / divisor));
      const levelHeight = Math.max(1, Math.floor(canvas.height / divisor));
      bloomLevelSizes.push({ width: levelWidth, height: levelHeight });
      bloomDownsampleTextures.push(device.createTexture({
        size: [levelWidth, levelHeight],
        format: LINEAR_COLOR_FORMAT,
        usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING,
      }));
      bloomUpsampleTextures.push(device.createTexture({
        size: [levelWidth, levelHeight],
        format: LINEAR_COLOR_FORMAT,
        usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING,
      }));
    }
    ssssTextureA = device.createTexture({
      size: [canvas.width, canvas.height],
      format: 'rgba16float',
      usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING,
    });
    ssssTextureB = device.createTexture({
      size: [canvas.width, canvas.height],
      format: 'rgba16float',
      usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING,
    });
    ssssMaskRenderTexture = device.createTexture({
      size: [canvas.width, canvas.height],
      sampleCount,
      format: SSS_MASK_RENDER_FORMAT,
      usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING,
    });
    ssssMaskTexture = device.createTexture({
      size: [canvas.width, canvas.height],
      format: SSS_MASK_RESOLVED_FORMAT,
      usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING,
    });
    contactShadowMaskTexture = device.createTexture({
      size: [canvas.width, canvas.height],
      format: 'rgba32float',
      usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING,
    });
    ambientOcclusionMaskTexture = device.createTexture({
      size: [canvas.width, canvas.height],
      format: 'rgba32float',
      usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING,
    });
    captureTexture = device.createTexture({
      size: [canvas.width, canvas.height],
      format,
      usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC | GPUTextureUsage.TEXTURE_BINDING,
    });
    captureTextureFormat = format;

    pickWorldTexture = device.createTexture({
      size: [canvas.width, canvas.height],
      format: 'rgba32float',
      usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC,
    });
    pickDepthTexture = device.createTexture({
      size: [canvas.width, canvas.height],
      format: 'depth32float',
      sampleCount: 1,
      usage: GPUTextureUsage.RENDER_ATTACHMENT,
    });

    const depthTexture = device.createTexture({
      size: [canvas.width, canvas.height],
      format: 'depth24plus',
      sampleCount,
      usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING,
    });
    depthTextures.set(sampleCount, depthTexture);
  };

  resize(sampleCount, initialInternalResolution);

  return {
    resize,
    getRenderView() {
      return renderTexture.createView();
    },
    getResolveView() {
      return resolveTexture ? resolveTexture.createView() : null;
    },
    getPrepassNormalRenderView() {
      return prepassNormalRenderTexture.createView();
    },
    getPrepassNormalView() {
      return (prepassNormalResolveTexture ?? prepassNormalRenderTexture).createView();
    },
    getPrepassDepthRenderView() {
      return prepassDepthRenderTexture.createView();
    },
    getPrepassDepthView() {
      return (prepassDepthResolveTexture ?? prepassDepthRenderTexture).createView();
    },
    getSceneNormalRenderView() {
      return normalRenderTexture.createView();
    },
    getSceneNormalView() {
      return (normalResolveTexture ?? normalRenderTexture).createView();
    },
    getPostProcessInputView() {
      return resolveTexture ? resolveTexture.createView() : renderTexture.createView();
    },
    getGridOverlayRenderView() {
      return gridOverlayRenderTexture.createView();
    },
    getGridOverlayView() {
      return gridOverlayResolveTexture.createView();
    },
    getUiOverlayRenderView() {
      return uiOverlayRenderTexture.createView();
    },
    getUiOverlayView() {
      return uiOverlayResolveTexture.createView();
    },
    getPostEffectOutputView() {
      return postEffectTextureA.createView();
    },
    getPostEffectPingView() {
      return postEffectTextureA.createView();
    },
    getPostEffectPongView() {
      return postEffectTextureB.createView();
    },
    getDofBlurView() {
      return dofBlurTexture.createView();
    },
    getBloomDownsampleView(level = 0) {
      const texture = bloomDownsampleTextures[level] ?? bloomDownsampleTextures[0];
      return texture.createView();
    },
    getBloomUpsampleView(level = 0) {
      const texture = bloomUpsampleTextures[level] ?? bloomUpsampleTextures[0];
      return texture.createView();
    },
    getBloomLevelCount() {
      return Math.min(bloomDownsampleTextures.length, bloomUpsampleTextures.length);
    },
    getBloomLevelSize(level = 0) {
      return bloomLevelSizes[level] ?? bloomLevelSizes[0] ?? { width: 1, height: 1 };
    },
    getSsssPingView() {
      return ssssTextureA.createView();
    },
    getSsssPongView() {
      return ssssTextureB.createView();
    },
    getSsssMaskRenderView() {
      return ssssMaskRenderTexture.createView();
    },
    getSsssMaskView() {
      return ssssMaskTexture.createView();
    },
    getContactShadowMaskView() {
      return contactShadowMaskTexture.createView();
    },
    getAmbientOcclusionMaskView() {
      return ambientOcclusionMaskTexture.createView();
    },
    getCaptureTexture() {
      return captureTexture;
    },
    getCaptureTextureFormat() {
      return captureTextureFormat;
    },
    getPickWorldView() {
      return pickWorldTexture.createView();
    },
    getPickWorldTexture() {
      return pickWorldTexture;
    },
    getPickDepthView() {
      return pickDepthTexture.createView();
    },
    getPickDepthTexture() {
      return pickDepthTexture;
    },
    getDepthView(msaaSampleCount) {
      if (!depthTextures.has(msaaSampleCount)) {
        depthTextures.set(msaaSampleCount, device.createTexture({
          size: [canvas.width, canvas.height],
          format: 'depth24plus',
          sampleCount: msaaSampleCount,
          usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING,
        }));
      }
      return depthTextures.get(msaaSampleCount).createView();
    },
  };
}

/**
 * メッシュ用 GPU バッファを作成します。
 * @param {GPUDevice} device - WebGPU デバイス。
 * @param {object} model - モデルデータ。
 * @returns {{vertexBuffer: GPUBuffer, indexBuffer: GPUBuffer, indexFormat: string}} メッシュバッファ。
 */
export function createMeshBuffers(device, model) {
  if (!model.vertices) {
    throw new Error('Model vertices are missing');
  }

  const vertexBuffer = device.createBuffer({
    size: alignTo4(model.vertices.byteLength),
    usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
  });
  device.queue.writeBuffer(vertexBuffer, 0, model.vertices);

  const indexBufferSize = alignTo4(model.indices.byteLength);
  const indexBuffer = device.createBuffer({
    size: indexBufferSize,
    usage: GPUBufferUsage.INDEX | GPUBufferUsage.COPY_DST,
  });
  if (model.indices.byteLength % 4 !== 0) {
    const paddedIndices = new Uint8Array(indexBufferSize);
    paddedIndices.set(new Uint8Array(model.indices.buffer, model.indices.byteOffset, model.indices.byteLength));
    device.queue.writeBuffer(indexBuffer, 0, paddedIndices);
  } else {
    device.queue.writeBuffer(indexBuffer, 0, model.indices);
  }

  return {
    vertexBuffer,
    indexBuffer,
    indexFormat: model.indices instanceof Uint32Array ? 'uint32' : 'uint16',
  };
}

/**
 * シェーダーモジュールを作成します。
 * @param {GPUDevice} device - WebGPU デバイス。
 * @param {string} shaderPath - シェーダーパス。
 * @returns {Promise<GPUShaderModule>} シェーダーモジュール。
 */
export async function loadShaderModule(device, shaderPath) {
  const response = await fetch(shaderPath);
  if (!response.ok) {
    throw new Error(`Failed to load shader: ${response.status} ${response.statusText}`);
  }
  return device.createShaderModule({ code: await response.text() });
}

function alignTo4(value) {
  return (value + 3) & ~3;
}

export {
  createEmptyTexture,
  createMaterialResources,
  loadSphereTexture,
  loadTexture,
  loadToonTexture,
};
