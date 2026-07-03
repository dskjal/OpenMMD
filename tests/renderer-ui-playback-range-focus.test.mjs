import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const rendererUiSource = readFileSync(new URL('../source/ui/renderer-ui.js', import.meta.url), 'utf8');

test('renderer-ui playback range inputs guard blur and change during sibling focus transfer', () => {
  assert.match(rendererUiSource, /shouldSkipNumericInputCommit,/);
  assert.match(rendererUiSource, /playbackRangeStartInput\.addEventListener\('change', \(event\) => \{\s*if \(shouldSkipNumericInputCommit\(event, playbackRangeEndInput\)\) \{\s*return;\s*\}\s*applyPlaybackRangeFromInputs\(\);/);
  assert.match(rendererUiSource, /playbackRangeStartInput\.addEventListener\('blur', \(event\) => \{\s*if \(shouldSkipNumericInputCommit\(event, playbackRangeEndInput\)\) \{\s*return;\s*\}\s*applyPlaybackRangeFromInputs\(\);/);
  assert.match(rendererUiSource, /playbackRangeEndInput\.addEventListener\('change', \(event\) => \{\s*if \(shouldSkipNumericInputCommit\(event, playbackRangeStartInput\)\) \{\s*return;\s*\}\s*applyPlaybackRangeFromInputs\(\);/);
  assert.match(rendererUiSource, /playbackRangeEndInput\.addEventListener\('blur', \(event\) => \{\s*if \(shouldSkipNumericInputCommit\(event, playbackRangeStartInput\)\) \{\s*return;\s*\}\s*applyPlaybackRangeFromInputs\(\);/);
});
