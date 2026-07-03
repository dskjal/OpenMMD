import test from 'node:test';
import assert from 'node:assert/strict';

import { createBootstrapCoordinatorRegistry } from '../source/bootstrap/bootstrap-coordinator-registry.js';

test('bootstrap coordinator registry invoker resolves latest callback', () => {
  const registry = createBootstrapCoordinatorRegistry();
  const invoker = registry.getInvoker('refreshScene');
  const calls = [];

  invoker('initial');
  registry.set('refreshScene', (...args) => {
    calls.push(args);
  });
  invoker('updated', 1);

  assert.deepEqual(calls, [['updated', 1]]);
});
