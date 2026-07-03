import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs/promises';
import { VMDLoader } from '../source/infrastructure/loaders/vmd-loader.js';

test('VMD Loader truncated file test', async () => {
    const loader = new VMDLoader();
    const buffer = (await fs.readFile('./test-data/2分ループステップ1.vmd')).buffer;
    
    // This should not throw RangeError anymore
    const vmd = loader.parse(buffer);
    
    assert.ok(vmd.signature.startsWith('Vocaloid Motion Data'), 'Should have valid signature');
    assert.ok(vmd.boneKeyframes.length > 0, 'Should have bone keyframes');
    assert.ok(vmd.faceKeyframes.length > 0, 'Should have face keyframes');
    
    console.log(`Successfully parsed VMD: ${vmd.boneKeyframes.length} bone frames, ${vmd.faceKeyframes.length} face frames.`);
});
