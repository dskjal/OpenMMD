import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import test from 'node:test';
import { pathToFileURL } from 'node:url';
import { loadModelData } from '../source/core/model/model-scene.js';

test('PMD Bone Flags Initialization Test', async () => {
  // Mock fetch for loadModelData
  globalThis.fetch = async (input) => {
    const url = new URL(input, pathToFileURL(process.cwd() + '/'));
    const data = await fs.readFile(url);
    return {
      ok: true,
      status: 200,
      arrayBuffer: async () => data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength),
    };
  };

  const { model } = await loadModelData(null, 1.0, './test-data/miku_v2.pmd');

  const BONE_FLAG_ROTATABLE = 0x0002;
  const BONE_FLAG_TRANSLATABLE = 0x0004;
  const BONE_FLAG_VISIBLE = 0x0008;

  // Find center bone (usually type 1 in PMD)
  const centerBone = model.bones.find(b => b.name === 'センター' || b.type === 1);
  assert.ok(centerBone, 'Should have center bone');
  assert.ok(centerBone.flags & BONE_FLAG_ROTATABLE, 'Center bone should be rotatable');
  assert.ok(centerBone.flags & BONE_FLAG_TRANSLATABLE, 'Center bone should be translatable');
  assert.ok(centerBone.flags & BONE_FLAG_VISIBLE, 'Center bone should be visible');

  const ikBone = model.bones.find(b => b.type === 2);
  assert.ok(ikBone, 'Should have an IK bone');
  assert.ok(ikBone.flags & BONE_FLAG_ROTATABLE, 'IK bone should be rotatable');
  assert.ok(ikBone.flags & BONE_FLAG_TRANSLATABLE, 'IK bone should be translatable');

  // Find a regular bone (usually type 0 in PMD)
  const armBone = model.bones.find(b => b.name.includes('腕') && b.type === 0);
  if (armBone) {
    assert.ok(armBone.flags & BONE_FLAG_ROTATABLE, 'Arm bone should be rotatable');
    assert.ok(!(armBone.flags & BONE_FLAG_TRANSLATABLE), 'Arm bone should NOT be translatable');
    assert.ok(armBone.flags & BONE_FLAG_VISIBLE, 'Arm bone should be visible');
  }

  // Find a hidden bone (type 7) if exists
  const hiddenBone = model.bones.find(b => b.type === 7);
  if (hiddenBone) {
    assert.ok(!(hiddenBone.flags & BONE_FLAG_VISIBLE), 'Hidden bone should NOT be visible');
  }
});
