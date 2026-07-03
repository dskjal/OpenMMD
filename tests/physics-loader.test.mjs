import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import test from 'node:test';
import { pathToFileURL } from 'node:url';
import { PMXLoader } from '../source/infrastructure/loaders/pmx-loader.js';

test('PMX Physics Loader Test', async () => {
  installFileFetch();

  const loader = new PMXLoader();
  const model = await loader.load('./test-data/Alicia_solid.pmx');

  assert.ok(Array.isArray(model.rigidBodies), 'model.rigidBodies should be an array');
  assert.ok(model.rigidBodies.length > 0, 'model.rigidBodies should not be empty');
  console.log(`Loaded ${model.rigidBodies.length} rigid bodies`);
  console.log(`Follow bone count: ${model.rigidBodies.filter(b => b.physicsMode === 0).length}`);
  console.log(`Physics(physicsMode===1) count: ${model.rigidBodies.filter(b => b.physicsMode === 1).length}`);
  console.log(`Physics + bone(physicsMode===2) count: ${model.rigidBodies.filter(b => b.physicsMode === 2).length}`);

  // Verify first rigid body fields according to PMX 2.1 spec
  const rb = model.rigidBodies[0];
  assert.ok(rb.name, 'Rigid body should have a name');
  assert.ok(rb.boneIndex !== undefined, 'Rigid body should have boneIndex');
  assert.ok(rb.groupId !== undefined, 'Rigid body should have groupId');
  assert.ok(rb.collisionMask !== undefined, 'Rigid body should have collisionMask');
  assert.ok(rb.shape !== undefined, 'Rigid body should have shape');
  
  assert.strictEqual(rb.size.length, 3, 'Shape size should be vec3');
  assert.strictEqual(rb.position.length, 3, 'Shape position should be vec3');
  assert.strictEqual(rb.rotation.length, 3, 'Shape rotation should be vec3');
  
  assert.ok(typeof rb.mass === 'number', 'Mass should be a number');
  assert.ok(typeof rb.moveAttenuation === 'number', 'Move attenuation should be a number');
  assert.ok(typeof rb.rotationDamping === 'number', 'Rotation damping should be a number');
  assert.ok(typeof rb.repulsion === 'number', 'Repulsion should be a number');
  assert.ok(typeof rb.friction === 'number', 'Friction should be a number');
  assert.ok(rb.physicsMode !== undefined, 'Rigid body should have physicsMode');

  console.log(`First rigid body: "${rb.name}"`);
  console.log(` - Bone Index: ${rb.boneIndex}`);
  console.log(` - Shape: ${rb.shape} (0:Sphere, 1:Box, 2:Capsule)`);
  console.log(` - Physics Mode: ${rb.physicsMode} (0:Follow, 1:Physics, 2:Physics+Bone)`);

  assert.ok(Array.isArray(model.joints), 'model.joints should be an array');
  assert.ok(model.joints.length > 0, 'model.joints should not be empty');
  console.log(`Loaded ${model.joints.length} joints`);

  // Verify first joint
  const joint = model.joints[0];
  assert.ok(joint.name, 'Joint should have a name');
  assert.ok(joint.rigidBodyIndexA !== undefined, 'Joint should have rigidBodyIndexA');
  assert.ok(Array.isArray(joint.position), 'Joint should have a position array');
  console.log(`First joint: "${joint.name}" connecting RB ${joint.rigidBodyIndexA} and ${joint.rigidBodyIndexB}`);

  console.log('Physics loader test passed!');
});

function installFileFetch() {
  globalThis.fetch = async (input) => {
    const url = input instanceof URL ? input : new URL(input, pathToFileURL(process.cwd() + '/'));
    const data = await fs.readFile(url);
    return {
      ok: true,
      status: 200,
      statusText: 'OK',
      arrayBuffer: async () => data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength),
    };
  };
}
