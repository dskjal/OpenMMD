import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const indexHtml = readFileSync(new URL('../index.html', import.meta.url), 'utf8');

test('animation mapping tab is present in the markup and is initialized', () => {
  const textureButtonIndex = indexHtml.indexOf('data-tab-target="tab-texture"');
  const animationMappingButtonIndex = indexHtml.indexOf('data-tab-target="tab-animation-mapping"');

  assert.ok(textureButtonIndex >= 0);
  assert.ok(animationMappingButtonIndex > textureButtonIndex);
  assert.match(indexHtml, /id="tab-animation-mapping"/);
  assert.match(indexHtml, /id="animation-mapping-grid"/);
  assert.match(indexHtml, /import\s+\{\s*bootstrapBrowserOpenMmdApp\s*\}\s+from\s+'\.\/source\/bootstrap\/browser-openmmd-app\.js';/);
  assert.match(indexHtml, /await bootstrapBrowserOpenMmdApp\(\);/);
});
