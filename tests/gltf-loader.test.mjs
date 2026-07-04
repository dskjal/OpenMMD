import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { execFile } from 'node:child_process';
import test from 'node:test';
import { pathToFileURL } from 'node:url';
import JSZipModule from '../source/lib/jszip.js';
import { Color, Mesh, PlaneGeometry } from 'three';
import { AnimationController } from '../source/core/animation/animation.js';
import { GLTFModelLoader } from '../source/infrastructure/loaders/gltf-loader.js';
import { ModelManager } from '../source/core/model/model-manager.js';
import { loadTextureResource } from '../source/infrastructure/gpu/material-resources.js';
import {
  createSceneState,
  getBoneByName,
  loadModelData,
  loadModelDataFromFile,
} from '../source/core/model/model-scene.js';
import { createMeshBuffers } from '../source/infrastructure/gpu/renderer-resources.js';
import { MorphController } from '../source/core/model/morphing.js';
import { createPipelineResources } from '../source/infrastructure/gpu/model-manager-pipelines.js';
import {
  createThreeAnimationClipsFromSources,
  exportAnimationSourcesToGlb,
} from '../source/infrastructure/animation/gltf-animation.js';
import { createTracksFromAnimationSource } from '../source/core/animation/timeline-data.js';

test('glTF plane.glb loads into the current rendering pipeline', async () => {
  const originalFetch = globalThis.fetch;
  const originalSelf = globalThis.self;
  globalThis.fetch = createFileFetchMock();
  globalThis.self = globalThis;

  try {
    const pathLoaded = await loadModelData(null, 1, './test-data/plane.glb');
    const fileLoaded = await loadModelDataFromFile(createFileLike('./test-data/plane.glb'), 1);

    verifyGlTFModel(pathLoaded.model);
    verifyGlTFModel(fileLoaded.model);

    const device = createMockDevice();
    installGpuConstants();

    const model = pathLoaded.model;
    const scene = createSceneState(device, model);
    const meshBuffers = createMeshBuffers(device, model);
    const morphController = new MorphController(device, model);
    morphController.update();

    assert.equal(meshBuffers.indexFormat, 'uint16');
    assert.equal(scene.boneCount, 1);
    assert.equal(scene.sortedBoneIndices[0], 0);

    const manager = createPipelineManagerMock(device);
    const pipelineResources = await createPipelineResources(manager, scene, model, null, '');

    assert.equal(pipelineResources.materials.length, 1);
    assert.equal(pipelineResources.materials[0].indexCount, 6);
    assert.equal(pipelineResources.materials[0].alphaMode, 'opaque');
    assert.equal(model.materials[0].shaderName, 'gltf-shader.wgsl');
    assert.equal(pipelineResources.defaultShaderName, 'gltf-shader.wgsl');
    assert.ok(pipelineResources.msaa.pipeline);
    assert.ok(pipelineResources.nonMsaa.pipeline);
    assert.equal(pipelineResources.shaderPipelines['gltf-shader.wgsl'].msaa.pipeline.descriptor.primitive.cullMode, 'back');
    assert.equal(pipelineResources.shaderPipelines['gltf-shader.wgsl'].nonMsaa.pipeline.descriptor.primitive.cullMode, 'back');
    assert.equal(pipelineResources.shaderPipelines['gltf-shader.wgsl'].msaa.transparentPipeline.descriptor.primitive.cullMode, 'back');
    assert.equal(pipelineResources.shaderPipelines['gltf-shader.wgsl'].depthPrepassMsaa.depthPrepassPipeline.descriptor.primitive.cullMode, 'back');
    assert.equal(pipelineResources.shaderPipelines['gltf-shader.wgsl'].msaa.edgePipeline.descriptor.primitive.cullMode, 'front');
    assert.equal(pipelineResources.shaderPipelines['gltf-shader.wgsl'].nonMsaa.edgePipeline.descriptor.primitive.cullMode, 'front');
    assert.equal(pipelineResources.shaderPipelines['gltf-shader.wgsl'].msaa.edgePipeline.descriptor.depthStencil.depthWriteEnabled, false);
    assert.equal(pipelineResources.shaderPipelines['gltf-shader.wgsl'].nonMsaa.edgePipeline.descriptor.depthStencil.depthWriteEnabled, false);
  } finally {
    globalThis.fetch = originalFetch;
    globalThis.self = originalSelf;
  }
});

test('glTF armature-animation-test.glb loads bones and skinning data', async () => {
  const originalFetch = globalThis.fetch;
  const originalSelf = globalThis.self;
  globalThis.fetch = createFileFetchMock();
  globalThis.self = globalThis;

  try {
    const loaded = await loadModelDataFromFile(createFileLike('./test-data/armature-animation-test.glb'), 1);
    const model = loaded.model;

    assert.equal(model.magic, 'Gltf');
    assert.equal(model.hasDummyBone, false);
    assert.equal(model.dummyBoneIndex, -1);
    assert.equal(model.bones.length, 3);
    assert.deepEqual(model.bones.map((bone) => bone.name), ['Bone', 'Bone001', 'Bone001_leaf']);
    assert.equal(model.bones[0].parentIndex, -1);
    assert.deepEqual(model.bones[0].position, [0, 0, 0]);
    assert.equal(model.bones[0].tailIndex, 1);
    assert.equal(model.bones[1].parentIndex, 0);
    assert.deepEqual(model.bones[1].position, [0, 1, 0]);
    assert.equal(model.bones[1].tailIndex, 2);
    assert.equal(model.bones[2].parentIndex, 1);
    assert.deepEqual(model.bones[2].position, [0, 2, 0]);
    assert.equal(Array.isArray(model.gltfAnimationSources), true);
    assert.equal(model.gltfAnimationSources.length > 0, true);
    const bone001TranslationChannel = model.gltfAnimationSources[0].clip.channels.find((channel) => (
      channel?.target?.kind === 'bone'
      && channel?.target?.name === 'Bone001'
      && channel?.target?.path === 'translation'
    ));
    assert.ok(bone001TranslationChannel);
    assert.deepEqual(bone001TranslationChannel.sampler.keyframes[0].value, [0, 0, 0]);
    const timelineTracks = createTracksFromAnimationSource(model.gltfAnimationSources[0].clip, model);
    assert.deepEqual(timelineTracks.map((track) => track.id), ['bone:Bone', 'bone:Bone001', 'bone:Bone001_leaf']);
    assert.equal(timelineTracks[1].parentId, null);
    assert.equal(timelineTracks[1].keyframes.length > 0, true);
    assert.equal(timelineTracks[1].keyframes.some((keyframe) => keyframe.frame === 30), true);
    assert.equal(model.vertexCount, 48);
    assert.equal(model.vertices.length, 48 * 27);
    assert.equal(model.indices.length, 108);
    assert.equal(model.materials.length, 1);
    assert.equal(model.materials[0].indexCount, 108);
    assert.equal(model.materials[0].shaderName, 'gltf-shader.wgsl');

    const influencedBoneIndices = new Set();
    for (let i = 0; i < model.vertexCount; i++) {
      const stride = i * 27;
      for (let j = 0; j < 4; j++) {
        const weight = model.vertices[stride + 12 + j];
        if (weight > 0) {
          influencedBoneIndices.add(model.vertices[stride + 8 + j]);
        }
      }
    }
    assert.deepEqual([...influencedBoneIndices].sort((a, b) => a - b), [0, 1]);
    assert.equal(model.vertices[8], 1);
    assert.equal(model.vertices[12], 1);
    assert.equal(model.vertices[16], 0);

    installGpuConstants();
    const device = createMockDevice();
    const scene = createSceneState(device, model);
    const animationController = new AnimationController(model, null);
    animationController.setAnimationClip(model.gltfAnimationSources[0].clip);
    animationController.update(0, scene.boneLocalTransforms);
    const manager = new ModelManager(device, {}, 'bgra8unorm', 1, {});
    manager.recomputeBoneMatrices(model, scene);

    assert.deepEqual(Array.from(scene.boneLocalTransforms[1].translation), [0, 0, 0]);
    assert.deepEqual(Array.from(scene.boneLocalTransforms[2].translation), [0, 0, 0]);
    assert.deepEqual(scene.boneWorldPositions[1], [0, 1, 0]);
    assert.deepEqual(scene.boneWorldPositions[2], [0, 2, 0]);

    assert.equal(scene.boneCount, 3);
    assert.deepEqual(scene.sortedBoneIndices, [0, 1, 2]);
    assert.equal(model.gltfAnimationSources[0].kind, 'gltf');
    assert.equal(Array.isArray(model.gltfAnimationSources[0].clip.channels), true);
    assert.equal(model.gltfAssetContext?.scene?.type, 'Group');
  } finally {
    globalThis.fetch = originalFetch;
    globalThis.self = originalSelf;
  }
});

test('glTF armature-animation-test.glb exports edited animation sources back to GLB', async () => {
  const originalFetch = globalThis.fetch;
  const originalSelf = globalThis.self;
  const originalFileReader = globalThis.FileReader;
  globalThis.fetch = createFileFetchMock();
  globalThis.self = globalThis;
  globalThis.FileReader = createFileReaderMock();

  try {
    const loaded = await loadModelDataFromFile(createFileLike('./test-data/armature-animation-test.glb'), 1);
    const source = loaded.model.gltfAnimationSources[0];
    assert.ok(source);
    const translationChannel = source.clip.channels.find((channel) => (
      channel?.target?.kind === 'bone'
      && channel?.target?.name === 'Bone001'
      && channel?.target?.path === 'translation'
    ));
    assert.ok(translationChannel);
    translationChannel.sampler.keyframes[0].value = [1, 2, 3];

    const exportedClips = createThreeAnimationClipsFromSources(loaded.model.gltfAnimationSources);
    const exportedTrack = exportedClips[0].tracks.find((track) => (
      typeof track?.name === 'string'
      && track.name.includes('Bone001')
      && track.name.endsWith('.position')
    ));
    assert.ok(exportedTrack);
    assert.deepEqual(Array.from(exportedTrack.values).slice(0, 3), [1, 3, 3]);

    const buffer = await exportAnimationSourcesToGlb(
      loaded.model.gltfAssetContext.scene,
      loaded.model.gltfAnimationSources,
    );
    assert.ok(buffer instanceof ArrayBuffer);

    const reparsed = await new GLTFModelLoader().parse(buffer, 'edited.glb', null);
    assert.equal(reparsed.gltfAnimationSources.length > 0, true);
  } finally {
    globalThis.fetch = originalFetch;
    globalThis.self = originalSelf;
    globalThis.FileReader = originalFileReader;
  }
});

test('glTF material shader override keeps pipeline resources usable', async () => {
  const originalFetch = globalThis.fetch;
  const originalSelf = globalThis.self;
  globalThis.fetch = createFileFetchMock();
  globalThis.self = globalThis;

  try {
    const loaded = await loadModelData(null, 1, './test-data/plane.glb');
    const device = createMockDevice();
    installGpuConstants();

    loaded.model.materials[0].shaderName = 'mtoon-shader.wgsl';

    const scene = createSceneState(device, loaded.model);
    const manager = createPipelineManagerMock(device);
    const pipelineResources = await createPipelineResources(manager, scene, loaded.model, null, '');

    assert.equal(pipelineResources.defaultShaderName, 'gltf-shader.wgsl');
    assert.equal(pipelineResources.shaderPipelines['gltf-shader.wgsl'] !== undefined, true);
    assert.ok(pipelineResources.msaa.pipeline);
    assert.ok(pipelineResources.nonMsaa.pipeline);
  } finally {
    globalThis.fetch = originalFetch;
    globalThis.self = originalSelf;
  }
});

test('VRM AliciaSolid.vrm loads as Vrm and auto-assigns MToon materials', async () => {
  const originalFetch = globalThis.fetch;
  const originalSelf = globalThis.self;
  const originalCreateImageBitmap = globalThis.createImageBitmap;
  globalThis.fetch = createFileFetchMock();
  globalThis.self = globalThis;
  globalThis.createImageBitmap = createImageBitmapMock;

  try {
    const loaded = await loadModelDataFromFile(createFileLike('./test-data/AliciaSolid.vrm'), 1);
    const model = loaded.model;

    assert.equal(model.magic, 'Vrm');
    assert.equal(model.vrm?.version, 'vrm0');
    assert.equal(model.gltfAssetContext?.sourceHandedness, 'right');
    assert.equal(Array.isArray(model.morphs), true);
    assert.equal(model.morphs.length > 0, true);
    assert.equal(Array.isArray(model.displayFrames), true);
    assert.ok(model.displayFrames.some((displayFrame) => displayFrame.nameEn === 'Expressions'), 'VRM displayFrames should include Expressions');
    assert.equal(typeof model.vrm?.expressions?.preset, 'object');
    assert.equal(model.morphs.some((morph) => morph.type === 100), true);
    assert.ok(model.morphs.some((morph) => morph.name === 'aa'), 'VRM0 preset a should normalize to aa');
    assert.ok(model.morphs.some((morph) => morph.name === 'ih'), 'VRM0 preset i should normalize to ih');
    assert.ok(model.morphs.some((morph) => morph.name === 'happy'), 'VRM0 preset joy should normalize to happy');
    assert.ok(model.morphs.some((morph) => morph.name === 'sad'), 'VRM0 preset sorrow should normalize to sad');
    assert.ok(model.morphs.some((morph) => morph.name === 'relaxed'), 'VRM0 preset fun should normalize to relaxed');
    assert.ok((model.morphs.find((morph) => morph.name === 'aa')?.vrmExpressionDefinition?.vertexOffsets?.length || 0) > 0);
    assert.ok((model.morphs.find((morph) => morph.name === 'happy')?.vrmExpressionDefinition?.vertexOffsets?.length || 0) > 0);

    const device = createMockDevice();
    installGpuConstants();
    const scene = createSceneState(device, model);
    const manager = new ModelManager(device, {}, 'bgra8unorm', 1, {});
    manager.recomputeBoneMatrices(model, scene);

    const skirtBoneIndex = model.bones.findIndex((bone) => bone.name === 'skirt_01_01');
    const hairBoneIndex = model.bones.findIndex((bone) => bone.name === 'hair1_L');
    assert.ok(skirtBoneIndex >= 0, 'AliciaSolid.vrm should contain a skirt test bone');
    assert.ok(hairBoneIndex >= 0, 'AliciaSolid.vrm should contain a hair test bone');

    assert.ok(scene.boneLocalTransforms[skirtBoneIndex], 'AliciaSolid.vrm should initialize the skirt test transform');
    assert.ok(scene.boneLocalTransforms[hairBoneIndex], 'AliciaSolid.vrm should initialize the hair test transform');

    assert.equal(model.bones[0]?.name, '全ての親');
    assert.ok(Array.isArray(model.bones[0]?.position));
    assert.ok(model.bones[0].position.every((value) => Math.abs(Number(value) || 0) < 1e-6));
    assert.equal(model.bones[0]?.parentIndex, -1);
    assert.deepEqual(model.bones[0]?.baseRotationQuaternion, [0, 0, 0, 1]);
    assert.deepEqual(Array.from(scene.boneLocalTransforms[0].worldRotation), [0, 0, 0, 1]);
    assert.equal(Boolean(model.bones[0]?.flags & 0x0004), true);
    assert.deepEqual(getHumanoidBone(model, 'leftUpperArm')?.position, [0.0707421629400071, 1.2705180410499999, -0.009377892763838583]);
    assert.deepEqual(getBoneByName(model, 'hair1_L')?.position, [0.065724313626417, 1.4674627544999999, -0.08173758755799979]);
    assert.deepEqual(getHumanoidBone(model, 'leftShoulder')?.localY, [0, 1, 0]);
    assert.deepEqual(getHumanoidBone(model, 'leftUpperArm')?.localY, [0, 1, 0]);
    assert.deepEqual(getHumanoidBone(model, 'leftLowerArm')?.localY, [0, 1, 0]);
    assert.deepEqual(getHumanoidBone(model, 'leftHand')?.localY, [0, 1, 0]);
    assert.deepEqual(getHumanoidBone(model, 'rightShoulder')?.localY, [0, 1, 0]);
    assert.deepEqual(getHumanoidBone(model, 'rightUpperArm')?.localY, [0, 1, 0]);
    assert.deepEqual(getHumanoidBone(model, 'rightLowerArm')?.localY, [0, 1, 0]);
    assert.deepEqual(getHumanoidBone(model, 'rightHand')?.localY, [0, 1, 0]);
    assert.deepEqual(getHumanoidBone(model, 'rightIndexProximal')?.localY, [0, 1, 0]);
    assert.deepEqual(getHumanoidBone(model, 'rightHand')?.localZ, [0, 0, 1]);
    assert.equal(model.vrm?.springBone?.sourceVersion, 'vrm0-secondaryAnimation');
    assert.equal(model.materials.length > 0, true);
    assert.equal(model.materials.every((material) => material.shaderName === 'mtoon-shader.wgsl'), true);
    assert.equal(model.materials.some((material) => material.alphaMode === 'transparent'), true);
    assert.equal(model.materials.some((material) => material.hasEdge === true), true);
    assert.equal(Array.isArray(model.vrm?.springBone?.springs), true);
    assert.equal(model.vrm.springBone.springs.length > 0, true);
    assert.equal(model.vrm.springBone.colliders.length > 0, true);
    assert.equal(model.vrm.springBone.colliderGroups.length > 0, true);
    assert.ok(Array.isArray(model.vrm.springBone.colliders[0].shape.offset));
    assert.ok(model.vrm.springBone.colliders[0].shape.offset.every((value, index) => (
      Math.abs((Number(value) || 0) - [-0.025884293, -0.120000005, 0][index]) <= 1e-6
    )));
    assert.equal(
      model.vrm.springBone.springs.some((spring) => spring.joints.length === 1),
      true,
      'AliciaSolid.vrm should preserve childless secondaryAnimation roots as single-joint springs',
    );

    const rightLegIk = model.ik.find((ik) => model.bones[ik.boneIndex]?.name === '右足ＩＫ');
    const leftLegIk = model.ik.find((ik) => model.bones[ik.boneIndex]?.name === '左足ＩＫ');
    const rightToeIk = model.ik.find((ik) => model.bones[ik.boneIndex]?.name === '右つま先ＩＫ');
    const leftToeIk = model.ik.find((ik) => model.bones[ik.boneIndex]?.name === '左つま先ＩＫ');
    const allParentBone = model.bones.find((bone) => bone.name === '全ての親');
    const allParentBoneIndex = model.bones.findIndex((bone) => bone.name === '全ての親');
    const lowerBodyBone = model.bones.find((bone) => bone.name === '下半身');
    const lowerBodyBoneIndex = model.bones.findIndex((bone) => bone.name === '下半身');
    const hipsBoneName = model.vrm?.humanoidBoneNameMap?.hips;
    const spineBoneName = model.vrm?.humanoidBoneNameMap?.spine;
    const hipsBone = model.bones.find((bone) => bone.name === hipsBoneName);
    const spineBone = model.bones.find((bone) => bone.name === spineBoneName);
    const hipsChildren = model.bones
      .map((bone, index) => ({ bone, index }))
      .filter((entry) => entry.bone?.parentIndex === model.bones.findIndex((bone) => bone.name === hipsBoneName))
      .map((entry) => entry.bone.name);
    const lowerBodyChildren = model.bones
      .map((bone, index) => ({ bone, index }))
      .filter((entry) => entry.bone?.parentIndex === lowerBodyBoneIndex)
      .map((entry) => entry.bone.name);

    assert.ok(rightLegIk, 'VRM rightLowerLeg IK should be created');
    assert.ok(leftLegIk, 'VRM leftLowerLeg IK should be created');
    assert.ok(rightToeIk, 'VRM rightFoot IK should be created');
    assert.ok(leftToeIk, 'VRM leftFoot IK should be created');
    assert.ok(allParentBone, 'VRM all-parent bone should exist');
    assert.ok(hipsBone, 'VRM hips bone should exist');
    assert.ok(lowerBodyBone, 'VRM lower-body bone should exist');
    assert.ok(spineBone, 'VRM spine bone should exist');
    assert.equal(model.ik.length >= 4, true);
    assert.equal(lowerBodyBone.parentIndex, model.bones.findIndex((bone) => bone.name === hipsBoneName));
    assert.deepEqual(lowerBodyBone.position, spineBone.position);
    assert.deepEqual(lowerBodyBone.rotationLocks, { x: false, y: false, z: false });
    assert.equal(spineBone.parentIndex, model.bones.findIndex((bone) => bone.name === hipsBoneName));
    assert.deepEqual([...hipsChildren].sort(), ['下半身', spineBoneName].sort());
    assert.equal(lowerBodyChildren.includes(model.vrm?.humanoidBoneNameMap?.leftUpperLeg), true);
    assert.equal(lowerBodyChildren.includes(model.vrm?.humanoidBoneNameMap?.rightUpperLeg), true);

    assert.equal(rightLegIk.loopCount, 200);
    assert.equal(rightLegIk.iteration, 200);
    assert.equal(rightLegIk.chainLength, 2);
    assert.equal(Boolean(model.bones[rightLegIk.boneIndex].flags & 0x0004), true);
    assert.deepEqual(model.bones[rightLegIk.boneIndex].rotationLocks, { x: false, y: false, z: false });
    assert.equal(model.bones[rightLegIk.boneIndex].parentIndex, allParentBoneIndex);
    assert.equal(model.bones[rightLegIk.targetBoneIndex]?.name, model.vrm?.humanoidBoneNameMap?.rightFoot);
    assert.deepEqual(
      rightLegIk.links.map((link) => model.bones[link.boneIndex]?.name),
      [
        model.vrm?.humanoidBoneNameMap?.rightUpperLeg,
        model.vrm?.humanoidBoneNameMap?.rightLowerLeg,
      ],
    );
    assert.equal(rightLegIk.links[0].hasLimit, false);
    assert.equal(rightLegIk.links[1].hasLimit, true);
    assert.deepEqual(rightLegIk.links[1].minAngle, [-Math.PI, 0, 0]);
    assert.deepEqual(rightLegIk.links[1].maxAngle, [-0.008, 0, 0]);

    assert.equal(leftLegIk.loopCount, 200);
    assert.equal(leftLegIk.iteration, 200);
    assert.equal(leftLegIk.chainLength, 2);
    assert.equal(Boolean(model.bones[leftLegIk.boneIndex].flags & 0x0004), true);
    assert.deepEqual(model.bones[leftLegIk.boneIndex].rotationLocks, { x: false, y: false, z: false });
    assert.equal(model.bones[leftLegIk.boneIndex].parentIndex, allParentBoneIndex);
    assert.equal(model.bones[leftLegIk.targetBoneIndex]?.name, model.vrm?.humanoidBoneNameMap?.leftFoot);
    assert.deepEqual(
      leftLegIk.links.map((link) => model.bones[link.boneIndex]?.name),
      [
        model.vrm?.humanoidBoneNameMap?.leftUpperLeg,
        model.vrm?.humanoidBoneNameMap?.leftLowerLeg,
      ],
    );
    assert.equal(leftLegIk.links[0].hasLimit, false);
    assert.equal(leftLegIk.links[1].hasLimit, true);
    assert.deepEqual(leftLegIk.links[1].minAngle, [-Math.PI, 0, 0]);
    assert.deepEqual(leftLegIk.links[1].maxAngle, [-0.008, 0, 0]);

    assert.equal(rightToeIk.loopCount, 10);
    assert.equal(rightToeIk.iteration, 10);
    assert.equal(rightToeIk.chainLength, 1);
    assert.equal(Boolean(model.bones[rightToeIk.boneIndex].flags & 0x0004), true);
    assert.deepEqual(model.bones[rightToeIk.boneIndex].rotationLocks, { x: false, y: false, z: false });
    assert.equal(model.bones[rightToeIk.boneIndex].parentIndex, rightLegIk.boneIndex);
    assert.equal(model.bones[rightToeIk.targetBoneIndex]?.name, model.vrm?.humanoidBoneNameMap?.rightToes);
    assert.deepEqual(
      rightToeIk.links.map((link) => model.bones[link.boneIndex]?.name),
      [model.vrm?.humanoidBoneNameMap?.rightFoot],
    );

    assert.equal(leftToeIk.loopCount, 10);
    assert.equal(leftToeIk.iteration, 10);
    assert.equal(leftToeIk.chainLength, 1);
    assert.equal(Boolean(model.bones[leftToeIk.boneIndex].flags & 0x0004), true);
    assert.deepEqual(model.bones[leftToeIk.boneIndex].rotationLocks, { x: false, y: false, z: false });
    assert.equal(model.bones[leftToeIk.boneIndex].parentIndex, leftLegIk.boneIndex);
    assert.equal(model.bones[leftToeIk.targetBoneIndex]?.name, model.vrm?.humanoidBoneNameMap?.leftToes);
    assert.deepEqual(
      leftToeIk.links.map((link) => model.bones[link.boneIndex]?.name),
      [model.vrm?.humanoidBoneNameMap?.leftFoot],
    );

    assert.equal(Boolean(hipsBone.flags & 0x0004), true, 'VRM hips bone should remain translatable');
    assert.equal(
      model.bones.every((bone) => (
        bone.name === '全ての親'
          || bone.name === hipsBoneName
          || bone.name === '右足ＩＫ'
          || bone.name === '左足ＩＫ'
          || bone.name === '右つま先ＩＫ'
          || bone.name === '左つま先ＩＫ'
          ? Boolean(bone.flags & 0x0004)
          : !Boolean(bone.flags & 0x0004)
      )),
      true,
      'VRM bones other than the root, hips and auto-generated IK bones should default to non-translatable',
    );

    const displayFrames = Array.isArray(model.displayFrames) ? model.displayFrames : [];
    assert.equal(displayFrames.length > 0, true, 'VRM displayFrames should be generated');
    assert.deepEqual(
      displayFrames.map((displayFrame) => displayFrame.nameEn),
      ['Torso', 'Head', 'Legs', 'Arms', 'Fingers', 'Expressions', 'rest'].filter((nameEn) => (
        displayFrames.some((displayFrame) => displayFrame.nameEn === nameEn)
      )),
    );
      assert.equal(
        displayFrames.every((displayFrame) => displayFrame.specialFlag === 0),
        true,
        'VRM displayFrames should use non-special frames',
      );

      const frameBoneNames = new Set();
      const frameMorphNames = new Set();
      for (const displayFrame of displayFrames) {
        for (const frameEntry of displayFrame.frames || []) {
          if (frameEntry.type === 0) {
            const bone = model.bones[frameEntry.index];
            assert.ok(bone, 'VRM displayFrame frame should resolve to a bone');
            assert.equal(frameBoneNames.has(bone.name), false, `bone ${bone.name} should not appear in multiple displayFrames`);
            frameBoneNames.add(bone.name);
          } else if (frameEntry.type === 1) {
            const morph = model.morphs[frameEntry.index];
            assert.ok(morph, 'VRM displayFrame frame should resolve to a morph');
            assert.equal(displayFrame.nameEn, 'Expressions', 'VRM morph displayFrames should be grouped under Expressions');
            assert.equal(frameMorphNames.has(morph.name), false, `morph ${morph.name} should not appear in multiple displayFrames`);
            frameMorphNames.add(morph.name);
          } else {
            assert.fail(`Unexpected VRM displayFrame entry type: ${frameEntry.type}`);
          }
        }
      }
      assert.equal(frameBoneNames.size, model.bones.length, 'VRM displayFrames should cover every bone exactly once');
      assert.equal(frameMorphNames.size, model.morphs.length, 'VRM expression displayFrames should cover every morph exactly once');

      const bodyMaterial = model.materials.find((material) => material.name === 'Alicia_body');
      assert.ok(bodyMaterial);
      assert.equal(bodyMaterial.mtoon?.enabled, true);
    assert.equal(bodyMaterial.mtoon?.indirectLightIntensity, 0.1);
    assert.deepEqual(bodyMaterial.mtoon?.shadeColor, [1, 0.8666667, 0.840000033]);
    assert.equal(bodyMaterial.mtoon?.outlineWidthMode, 1);
    assert.equal(bodyMaterial.mtoon?.hasShadeMultiplyTexture, false);
    assert.equal(bodyMaterial.shadeMultiplyTexture, undefined);
    assert.equal(bodyMaterial.toonTexture, undefined);

    const transparentHair = model.materials.find((material) => material.name === 'Alicia_hair_trans_zwrite');
    assert.ok(transparentHair);
    assert.equal(transparentHair.alphaMode, 'transparent');
    assert.equal(transparentHair.mtoon?.transparentWithZWrite, true);
    assert.equal(transparentHair.sortIndex > bodyMaterial.sortIndex, true);

    assert.equal(
      model.materials.every((material) => material.toonTexture === undefined),
      true,
      'AliciaSolid.vrm should not assign any toonTexture values',
    );
    assert.equal(
      model.materials.every((material) => material.shadeMultiplyTexture === undefined),
      true,
      'AliciaSolid.vrm should not assign any shadeMultiplyTexture values',
    );
  } finally {
    globalThis.fetch = originalFetch;
    globalThis.self = originalSelf;
    globalThis.createImageBitmap = originalCreateImageBitmap;
  }
});

test('VRM AliciaSolid.vrm in test-data keeps all materials without toon textures', async () => {
  const originalFetch = globalThis.fetch;
  const originalSelf = globalThis.self;
  const originalCreateImageBitmap = globalThis.createImageBitmap;
  globalThis.fetch = createFileFetchMock();
  globalThis.self = globalThis;
  globalThis.createImageBitmap = createImageBitmapMock;

  try {
    const loaded = await loadModelDataFromFile(createFileLike('./test-data/AliciaSolid.vrm'), 1);
    const model = loaded.model;

    assert.equal(model.materials.length > 0, true);
    assert.equal(
      model.materials.every((material) => material.toonTexture === undefined),
      true,
      'test-data/AliciaSolid.vrm should not assign any toonTexture values',
    );
    assert.equal(
      model.materials.every((material) => material.shadeMultiplyTexture === undefined),
      true,
      'test-data/AliciaSolid.vrm should not assign any shadeMultiplyTexture values',
    );
    assert.equal(
      model.materials.every((material) => material.mtoon?.hasShadeMultiplyTexture === false),
      true,
      'test-data/AliciaSolid.vrm should not enable shadeMultiplyTexture on any material',
    );
  } finally {
    globalThis.fetch = originalFetch;
    globalThis.self = originalSelf;
    globalThis.createImageBitmap = originalCreateImageBitmap;
  }
});



/**
 * glTF モデルの基本形を検証します。
 * @param {object} model - モデルデータ。
 */
function verifyGlTFModel(model) {
  assert.equal(model.magic, 'Gltf');
  assert.equal(model.vertexCount, 4);
  assert.equal(model.vertices.length, 4 * 27);
  assert.equal(model.indices.length, 6);
  assert.equal(model.materials.length, 1);
  assert.equal(model.materials[0].shaderName, 'gltf-shader.wgsl');
  assert.equal(model.textures.length, 0);
  assert.equal(model.bones.length, 1);
  assert.equal(model.hasDummyBone, true);
  assert.equal(model.dummyBoneIndex, 0);
  assert.equal(model.morphs.length, 0);
  assert.equal(model.rigidBodies.length, 0);
  assert.equal(model.joints.length, 0);
  assert.equal(model.materials[0].drawShadow, true);
  assert.equal(model.materials[0].receiveShadow, true);
  assert.equal(model.materials[0].noCull, true);
  assert.equal(model.materials[0].indexCount, 6);
  assert.equal(model.materials[0].metalic, 0);
  assert.equal(model.materials[0].roughness, 0.5);
  assert.deepEqual(model.materials[0].emissive, [0, 0, 0]);
  assert.equal(model.materials[0].emissiveStrength, 1);
}

test('GLTFModelLoader keeps emissive color and emissive strength separate', async () => {
  const loader = new GLTFModelLoader();
  const geometry = new PlaneGeometry(1, 1, 1, 1);
  const material = {
    name: 'emissive',
    emissive: new Color(0.25, 0.5, 0.75),
    emissiveIntensity: 2.5,
  };
  const mesh = new Mesh(geometry, material);
  mesh.updateMatrixWorld(true);

  const result = await loader._convertPrimitive(
    mesh,
    geometry,
    { materialIndex: 0, start: 0, count: geometry.index.count },
    material,
    [],
    new Map(),
  );

  assert.ok(result);
  assert.deepEqual(result.material.emissive, [0.25, 0.5, 0.75]);
  assert.equal(result.material.emissiveStrength, 2.5);
});

/**
 * File 互換オブジェクトを作成します。
 * @param {string} path - 読み込み対象パス。
 * @returns {{name: string, arrayBuffer: function(): Promise<ArrayBuffer>, text: function(): Promise<string>}} File 互換オブジェクト。
 */
function createFileLike(path) {
  return {
    name: path.split(/[\\/]/).pop(),
    arrayBuffer: async () => {
      const data = await fs.readFile(path);
      return data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength);
    },
    text: async () => {
      const data = await fs.readFile(path);
      return data.toString('utf-8');
    },
  };
}

/**
 * humanoid 名に対応する bone を返します。
 * @param {object} model - モデルデータ。
 * @param {string} humanoidBoneName - humanoid 名。
 * @returns {object|null} bone。
 */
function getHumanoidBone(model, humanoidBoneName) {
  const boneName = model?.vrm?.humanoidBoneNameMap?.[humanoidBoneName];
  return model?.bones?.find((bone) => bone?.name === boneName) || null;
}

/**
 * fetch をファイル読み込みへ差し替えます。
 * @returns {function} fetch 互換関数。
 */
function createFileFetchMock() {
  return async (input) => {
    const url = new URL(input, pathToFileURL(`${process.cwd()}/`));
    const data = await fs.readFile(url);
    return {
      ok: true,
      status: 200,
      statusText: 'OK',
      arrayBuffer: async () => data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength),
      text: async () => data.toString('utf-8'),
    };
  };
}

/**
 * GLTFExporter 用の FileReader モックを作成します。
 * @returns {typeof FileReader} FileReader 互換クラス。
 */
function createFileReaderMock() {
  return class FileReaderMock {
    constructor() {
      this.result = null;
      this.onloadend = null;
    }

    readAsArrayBuffer(blob) {
      blob.arrayBuffer().then((buffer) => {
        this.result = buffer;
        this.onloadend?.();
      });
    }
  };
}

/**
 * createImageBitmap のモックを作成します。
 * data URI を返すことで、ローダーの texture 追跡を簡単にします。
 * @param {Blob} blob - 読み込み対象。
 * @returns {Promise<object>} ImageBitmap 互換オブジェクト。
 */
async function createImageBitmapMock(blob) {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  const base64 = Buffer.from(bytes).toString('base64');
  const source = `data:${blob.type || 'image/png'};base64,${base64}`;
  return {
    width: 1,
    height: 1,
    currentSrc: source,
    src: source,
  };
}

/**
 * GLB/VRM の JSON を読み取ります。
 * @param {Buffer|Uint8Array|ArrayBuffer} input - GLB/VRM バイナリ。
 * @returns {object} glTF JSON。
 */
function parseGlbJsonForChild(input) {
  const view = input instanceof DataView ? input : new DataView(input.buffer, input.byteOffset || 0, input.byteLength || input.buffer.byteLength);
  const jsonLength = view.getUint32(12, true);
  const jsonText = new TextDecoder('utf-8').decode(new Uint8Array(view.buffer, view.byteOffset + 20, jsonLength));
  return JSON.parse(jsonText.trimEnd());
}

/**
 * GLB/VRM を再構築します。
 * @param {Buffer|Uint8Array|ArrayBuffer} input - 元の GLB/VRM。
 * @param {string} jsonText - 新しい JSON テキスト。
 * @returns {Uint8Array} 再構築済み GLB/VRM。
 */
function rebuildGlbForChild(input, jsonText) {
  const source = input instanceof Uint8Array
    ? input
    : new Uint8Array(input.buffer || input, input.byteOffset || 0, input.byteLength || input.buffer.byteLength);
  const view = new DataView(source.buffer, source.byteOffset, source.byteLength);
  const chunks = [];
  let offset = 12;

  while (offset + 8 <= source.byteLength) {
    const chunkLength = view.getUint32(offset, true);
    const chunkType = new TextDecoder('ascii').decode(new Uint8Array(source.buffer, source.byteOffset + offset + 4, 4));
    const dataStart = offset + 8;
    const dataEnd = dataStart + chunkLength;
    chunks.push({
      type: chunkType,
      data: new Uint8Array(source.buffer.slice(source.byteOffset + dataStart, source.byteOffset + dataEnd)),
    });
    offset = dataEnd;
  }

  const encodedChunks = chunks.map((chunk) => (
    chunk.type === 'JSON'
      ? encodeGlbChunkForChild('JSON', new TextEncoder().encode(jsonText), 0x20)
      : encodeGlbChunkForChild(chunk.type, chunk.data, 0x00)
  ));

  const totalLength = 12 + encodedChunks.reduce((sum, chunk) => sum + chunk.byteLength, 0);
  const output = new Uint8Array(totalLength);
  const outputView = new DataView(output.buffer);
  writeAsciiForChild(output, 0, 'glTF');
  outputView.setUint32(4, 2, true);
  outputView.setUint32(8, totalLength, true);

  let writeOffset = 12;
  for (const chunk of encodedChunks) {
    output.set(chunk, writeOffset);
    writeOffset += chunk.byteLength;
  }

  return output;
}

/**
 * GLB/VRM チャンクをエンコードします。
 * @param {string} type - チャンク種別。
 * @param {Uint8Array} data - チャンクデータ。
 * @param {number} padByte - パディングバイト。
 * @returns {Uint8Array} エンコード済みチャンク。
 */
function encodeGlbChunkForChild(type, data, padByte) {
  const padding = (4 - (data.byteLength % 4)) % 4;
  const chunk = new Uint8Array(8 + data.byteLength + padding);
  const view = new DataView(chunk.buffer);
  view.setUint32(0, data.byteLength + padding, true);
  writeAsciiForChild(chunk, 4, type);
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
function writeAsciiForChild(target, offset, value) {
  for (let i = 0; i < value.length; i++) {
    target[offset + i] = value.charCodeAt(i) & 0xFF;
  }
}

/**
 * 子プロセス実行を Promise 化します。
 * @param {string} file - 実行ファイル。
 * @param {Array<string>} args - 引数。
 * @param {object} [options={}] - 実行オプション。
 * @returns {Promise<{stdout: string, stderr: string}>} 実行結果。
 */
function execFileAsync(file, args, options = {}) {
  return new Promise((resolve, reject) => {
    execFile(file, args, options, (error, stdout, stderr) => {
      if (error) {
        error.stdout = stdout;
        error.stderr = stderr;
        reject(error);
        return;
      }
      resolve({ stdout, stderr });
    });
  });
}

/**
 * GLB/VRM の JSON に外部テクスチャ参照を追加して再構築します。
 * @param {ArrayBuffer} input - 元の GLB/VRM。
 * @param {string} imageUri - 追加する画像 URI。
 * @param {string} textureName - 追加するテクスチャ名。
 * @returns {ArrayBuffer} 再構築済み GLB/VRM。
 */
function rebuildGlbWithExternalTexture(input, imageUri, textureName) {
  const gltf = parseGlbJson(input);
  if (!Array.isArray(gltf.images)) {
    gltf.images = [];
  }
  if (!Array.isArray(gltf.textures)) {
    gltf.textures = [];
  }
  if (!Array.isArray(gltf.materials) || gltf.materials.length === 0) {
    throw new Error('GLB fixture does not contain a material to patch.');
  }

  const imageIndex = gltf.images.length;
  const textureIndex = gltf.textures.length;
  gltf.images.push({
    mimeType: 'image/png',
    name: textureName,
    uri: imageUri,
  });
  gltf.textures.push({
    source: imageIndex,
  });

  const material = gltf.materials[0];
  material.pbrMetallicRoughness = {
    ...(material.pbrMetallicRoughness || {}),
    baseColorTexture: {
      index: textureIndex,
      texCoord: 0,
    },
  };

  return rebuildGlb(input, JSON.stringify(gltf));
}

/**
 * GLB/VRM の JSON を読み取ります。
 * @param {ArrayBuffer} input - GLB/VRM バイナリ。
 * @returns {object} glTF JSON。
 */
function parseGlbJson(input) {
  const view = new DataView(input);
  const jsonLength = view.getUint32(12, true);
  const jsonText = new TextDecoder('utf-8').decode(new Uint8Array(input, 20, jsonLength));
  return JSON.parse(jsonText.trimEnd());
}

/**
 * GLB/VRM を再構築します。
 * @param {ArrayBuffer} input - 元の GLB/VRM。
 * @param {string} jsonText - 新しい JSON テキスト。
 * @returns {ArrayBuffer} 再構築済み GLB/VRM。
 */
function rebuildGlb(input, jsonText) {
  const view = new DataView(input);
  const chunks = [];
  let offset = 12;

  while (offset + 8 <= input.byteLength) {
    const chunkLength = view.getUint32(offset, true);
    const chunkType = new TextDecoder('ascii').decode(new Uint8Array(input, offset + 4, 4));
    const dataStart = offset + 8;
    const dataEnd = dataStart + chunkLength;
    chunks.push({
      type: chunkType,
      data: new Uint8Array(input.slice(dataStart, dataEnd)),
    });
    offset = dataEnd;
  }

  const encodedChunks = chunks.map((chunk) => (
    chunk.type === 'JSON'
      ? encodeGlbChunk('JSON', new TextEncoder().encode(jsonText), 0x20)
      : encodeGlbChunk(chunk.type, chunk.data, 0x00)
  ));

  const totalLength = 12 + encodedChunks.reduce((sum, chunk) => sum + chunk.byteLength, 0);
  const output = new ArrayBuffer(totalLength);
  const outputView = new DataView(output);
  const outputBytes = new Uint8Array(output);
  writeAscii(outputBytes, 0, 'glTF');
  outputView.setUint32(4, 2, true);
  outputView.setUint32(8, totalLength, true);

  let writeOffset = 12;
  for (const chunk of encodedChunks) {
    outputBytes.set(chunk, writeOffset);
    writeOffset += chunk.byteLength;
  }

  return output;
}

/**
 * GLB/VRM チャンクをエンコードします。
 * @param {string} type - チャンク種別。
 * @param {Uint8Array} data - チャンクデータ。
 * @param {number} padByte - パディングバイト。
 * @returns {Uint8Array} エンコード済みチャンク。
 */
function encodeGlbChunk(type, data, padByte) {
  const padding = (4 - (data.byteLength % 4)) % 4;
  const chunk = new Uint8Array(8 + data.byteLength + padding);
  const view = new DataView(chunk.buffer);
  view.setUint32(0, data.byteLength + padding, true);
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
 * GPU 定数をインストールします。
 */
function installGpuConstants() {
  globalThis.GPUBufferUsage = globalThis.GPUBufferUsage || {
    VERTEX: 1,
    INDEX: 2,
    UNIFORM: 4,
    STORAGE: 8,
    COPY_DST: 16,
    RENDER_ATTACHMENT: 32,
    TEXTURE_BINDING: 64,
  };
  globalThis.GPUTextureUsage = globalThis.GPUTextureUsage || {
    TEXTURE_BINDING: 1,
    COPY_DST: 2,
    RENDER_ATTACHMENT: 4,
    STORAGE_BINDING: 8,
    COPY_SRC: 16,
  };
  globalThis.GPUShaderStage = globalThis.GPUShaderStage || {
    VERTEX: 1,
    FRAGMENT: 2,
  };
}

/**
 * モック GPU デバイスを作成します。
 * @returns {object} GPUDevice 互換オブジェクト。
 */
function createMockDevice() {
  return {
    createBuffer(desc) {
      return {
        size: desc.size,
        destroy() {},
      };
    },
    createTexture(desc) {
      return {
        desc,
        createView() {
          return { texture: this };
        },
        destroy() {},
      };
    },
    createBindGroupLayout({ entries }) {
      return { entries };
    },
    createBindGroup({ layout, entries }) {
      return { layout, entries };
    },
    createPipelineLayout({ bindGroupLayouts }) {
      return { bindGroupLayouts };
    },
    createRenderPipeline(descriptor) {
      return { descriptor };
    },
    queue: {
      writeBuffer() {},
      writeTexture() {},
      copyExternalImageToTexture() {},
    },
  };
}

/**
 * createPipelineResources 用の manager モックを作成します。
 * @param {object} device - モック GPU デバイス。
 * @returns {object} manager 互換オブジェクト。
 */
function createPipelineManagerMock(device) {
  return {
    device,
    shaderModule: { label: 'shader' },
    shaderManager: createShaderManagerMock(),
    presentationFormat: 'rgba8unorm',
    msaaSampleCount: 1,
    boneBindGroupLayout: device.createBindGroupLayout({ entries: [] }),
    globalResources: {
      globalBindGroupLayout: device.createBindGroupLayout({ entries: [] }),
      shadowBindGroupLayout: device.createBindGroupLayout({ entries: [] }),
      matBindGroupLayout: device.createBindGroupLayout({ entries: [] }),
      globalBindGroup: { label: 'globalBindGroup' },
      shadowGlobalBindGroup: { label: 'shadowGlobalBindGroup' },
    },
  };
}

/**
 * シェーダマネージャのモックを作成します。
 * @returns {object} shaderManager 互換オブジェクト。
 */
function createShaderManagerMock() {
  return {
    getDefaultShaderNameForModel(model) {
      if (model?.magic === 'Gltf') {
        return 'gltf-shader.wgsl';
      }
      if (model?.magic === 'Vrm') {
        return 'mtoon-shader.wgsl';
      }
      return 'mmd-shader.wgsl';
    },
    async getShaderModule(shaderName) {
      return {
        label: shaderName,
        async getCompilationInfo() {
          return { messages: [] };
        },
      };
    },
  };
}
