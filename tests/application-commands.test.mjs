import assert from 'node:assert/strict';
import test from 'node:test';

import { createApplicationCommands } from '../source/application/commands/application-commands.js';

test('assignVmdToActiveInstance delegates to the timeline orchestration service', () => {
  const calls = [];
  const commands = createApplicationCommands({
    timelineOrchestrationService: {
      assignVmdToActiveInstance(...args) {
        calls.push(['assignVmdToActiveInstance', ...args]);
      },
    },
  });

  commands.assignVmdToActiveInstance({ keyframes: [] }, 'test.vmd');

  assert.deepEqual(calls, [
    ['assignVmdToActiveInstance', { keyframes: [] }, 'test.vmd'],
  ]);
});

test('registerMorphKeyframe delegates to the timeline orchestration service', () => {
  const calls = [];
  const commands = createApplicationCommands({
    timelineOrchestrationService: {
      registerMorphKeyframe(name, weight) {
        calls.push(['registerMorphKeyframe', name, weight]);
        return 'registered';
      },
    },
  });

  const result = commands.registerMorphKeyframe('smile', 0.5);

  assert.equal(result, 'registered');
  assert.deepEqual(calls, [['registerMorphKeyframe', 'smile', 0.5]]);
});

test('activateInstance delegates to the model lifecycle service', () => {
  const calls = [];
  const commands = createApplicationCommands({
    modelLifecycleService: {
      activateInstance(index) {
        calls.push(['activateInstance', index]);
      },
    },
  });

  commands.activateInstance(1);

  assert.deepEqual(calls, [['activateInstance', 1]]);
});

test('loadZipModel delegates to the asset loading service', async () => {
  const calls = [];
  const commands = createApplicationCommands({
    assetLoadingService: {
      async loadZipModel(zipFiles) {
        calls.push(zipFiles);
        return 'loaded';
      },
    },
  });

  const zipFiles = { 'model.pmx': {} };
  const result = await commands.loadZipModel(zipFiles);

  assert.equal(result, 'loaded');
  assert.deepEqual(calls, [zipFiles]);
});

test('removeModelAtIndex delegates to the model lifecycle service', () => {
  const calls = [];
  const commands = createApplicationCommands({
    modelLifecycleService: {
      removeModelAtIndex(index) {
        calls.push(index);
      },
    },
  });

  commands.removeModelAtIndex(3);

  assert.deepEqual(calls, [3]);
});
