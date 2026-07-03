import test from 'node:test';
import assert from 'node:assert/strict';

import { createViewerStateService } from '../source/application/viewer/viewer-state-service.js';

test('viewer state service prefers viewer port over runtime option', () => {
  const service = createViewerStateService({
    ports: () => ({
      viewer: {
        modelManager: {
          instances: [],
        },
        selection: {
          activeInstanceIndex: -1,
        },
        vmdManager: {
          vmds: new Map(),
        },
        rendererState: {
          postEffects: {},
        },
      },
    }),
    runtime: () => null,
    commands: () => ({
      loadZipModel() {},
      loadVmd() {},
      setEnvironmentHdrPath() {},
      setEnvironmentHdrIntensity() {},
    }),
  });

  const state = service.getViewerState();
  assert.equal(state.activeInstanceIndex, -1);
  assert.deepEqual(state.modelNames, []);
});
