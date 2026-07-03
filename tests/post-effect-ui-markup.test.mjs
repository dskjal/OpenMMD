import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const indexHtml = readFileSync(new URL('../index.html', import.meta.url), 'utf8');

test('post effect bloom alpha and light controls are separated', () => {
  assert.match(indexHtml, /id="bloom-alpha"[\s\S]*min="0"[\s\S]*max="1"/);
  assert.match(indexHtml, /id="bloom-shadow-multiplier"[\s\S]*min="0"[\s\S]*max="1"/);
  assert.match(indexHtml, /id="show-bloom-shadow-debug"/);
  const postEffectStart = indexHtml.indexOf('<div id="tab-post-effect"');
  const lightTabStart = indexHtml.indexOf('<div id="tab-light"');
  const morphTabStart = indexHtml.indexOf('<div id="tab-morph"');
  const debugTabStart = indexHtml.indexOf('<div id="tab-debug"');
  assert.ok(postEffectStart >= 0);
  assert.ok(lightTabStart >= 0);
  assert.ok(morphTabStart > lightTabStart);
  assert.ok(debugTabStart > postEffectStart);

  const postEffectSection = indexHtml.slice(postEffectStart, debugTabStart);
  assert.equal(postEffectSection.includes('id="gltf-light-strength"'), false);
  assert.equal(postEffectSection.includes('id="light-color-swatch"'), false);
  assert.match(postEffectSection, /id="bloom-alpha"[\s\S]*id="bloom-shadow-multiplier"/);
  assert.equal(postEffectSection.includes('id="show-bloom-shadow-debug"'), false);

  const debugSection = indexHtml.slice(debugTabStart);
  assert.match(debugSection, /id="show-animation-debug"/);
  assert.match(debugSection, /data-i18n="Show Animation Data"/);
  assert.match(debugSection, /id="show-bloom-shadow-debug"/);
  assert.match(debugSection, /id="bloom-shadow-debug-mode"/);
  assert.match(debugSection, /<option value="5">Scene Input<\/option>/);
  assert.match(debugSection, /<option value="6">Bloom Extract<\/option>/);
  assert.match(debugSection, /<option value="7">Bloom Upsample<\/option>/);
  assert.match(debugSection, /<option value="8">Post Effect Output<\/option>/);
  assert.match(debugSection, /id="camera-debug-output"[\s\S]*id="animation-debug-table"[\s\S]*id="animation-debug-output"/);
  assert.match(debugSection, /data-i18n="Animation Data"/);
  assert.match(debugSection, /<th scope="col"[^>]*>ボーン名<\/th>[\s\S]*<th scope="col"[^>]*>X \(deg\)<\/th>[\s\S]*<th scope="col"[^>]*>Y \(deg\)<\/th>[\s\S]*<th scope="col"[^>]*>Z \(deg\)<\/th>/);
  assert.equal(debugSection.includes('id="bloom-shadow-debug-overlay"'), false);
  assert.equal(debugSection.includes('id="bloom-shadow-debug-canvas"'), false);

  const lightSection = indexHtml.slice(lightTabStart, morphTabStart);
  assert.match(lightSection, /id="light-color-swatch"/);
  assert.match(lightSection, /id="light-color-strength-range"/);
  assert.match(lightSection, /id="light-pos-x"/);
  assert.match(lightSection, /id="light-rot-z"/);
});
