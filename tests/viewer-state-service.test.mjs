import assert from 'node:assert/strict';
import test from 'node:test';

import { createViewerStateService } from '../source/application/viewer/viewer-state-service.js';

test('viewer state service waits until command dependencies are ready through injected timers', async () => {
  let ready = false;
  let currentTime = 0;
  const service = createViewerStateService({
    runtime: {},
    commands: () => ready ? {
      loadZipModel() {},
      loadVmd() {},
      setEnvironmentHdrPath() {},
      setEnvironmentHdrIntensity() {},
    } : {},
    document: null,
    setTimeoutImpl(resolve) {
      currentTime += 100;
      ready = true;
      resolve();
    },
    nowImpl() {
      return currentTime;
    },
  });

  await service.waitUntilReady();
  assert.equal(service.isReady(), true);
});
