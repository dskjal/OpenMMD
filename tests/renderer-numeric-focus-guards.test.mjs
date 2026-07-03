import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const rendererSource = readFileSync(new URL('../source/bootstrap/openmmd-app.js', import.meta.url), 'utf8');
const inspectorSyncSource = readFileSync(new URL('../source/application/scene/inspector-sync-coordinator.js', import.meta.url), 'utf8');
const shadowControllerSource = readFileSync(new URL('../source/ui/panels/shadow-panel-controller.js', import.meta.url), 'utf8');
const boneInspectorControllerSource = readFileSync(new URL('../source/ui/panels/bone-inspector-controller.js', import.meta.url), 'utf8');
const lightPanelControllerSource = readFileSync(new URL('../source/ui/panels/light-panel-controller.js', import.meta.url), 'utf8');

test('renderer numeric sync uses shared numeric focus guards for custom controls', () => {
  assert.match(rendererSource, /isNumericInputFocused,/);
  assert.match(rendererSource, /function restoreNumericInputValueIfInvalid\(input, fallbackValue, format = \(value\) => String\(value\)\) \{/);
  assert.match(boneInspectorControllerSource, /function isAnyNumericInputFocused\(inputs\) \{/);
  assert.match(boneInspectorControllerSource, /isBoneInfoEditing: isAnyNumericInputFocused\(uiState\.positionInputs\) \|\| isAnyNumericInputFocused\(uiState\.rotationInputs\)/);
  assert.match(boneInspectorControllerSource, /isWorldRotationEditing: inspectorState\.useWorldCoordinate === true && isAnyNumericInputFocused\(uiState\.rotationInputs\)/);
  assert.match(rendererSource, /if \(!isNumericInputFocused\(childUiState\.influenceRange\)\) \{/);
  assert.match(inspectorSyncSource, /if \(!isNumericInputFocused\(input\) && input\.value !== nextValue\) \{/);
  assert.match(inspectorSyncSource, /if \(!input \|\| isNumericInputFocused\(input\)\) \{/);
  assert.match(lightPanelControllerSource, /const isRotationEditing = isAnyNumericInputFocused\(uiState\.rotationInputs\);/);
  assert.doesNotMatch(rendererSource, /matches\(':focus'\)/);
});

test('renderer standalone numeric inputs only restore invalid text on blur', () => {
  assert.match(rendererSource, /boneThicknessInput\.addEventListener\('blur', \(\) => \{\s*restoreNumericInputValueIfInvalid\(boneThicknessInput, rendererState\.boneThickness\);/);
  assert.doesNotMatch(rendererSource, /boneThicknessInput\.addEventListener\('change'/);
  assert.match(shadowControllerSource, /shadowBiasInput\?\.addEventListener\('blur', \(\) => \{\s*restoreNumericInputValueIfInvalid\(uiState\.shadowBiasInput, service\.getShadowState\(\)\.shadowBias\);/);
  assert.match(shadowControllerSource, /edgeOpacityInput\?\.addEventListener\('blur', \(\) => \{\s*restoreNumericInputValueIfInvalid\(uiState\.edgeOpacityInput, service\.getShadowState\(\)\.shadowEdgeOpacity\);/);
  assert.match(shadowControllerSource, /shadowStrengthInput\?\.addEventListener\('blur', \(\) => \{\s*restoreNumericInputValueIfInvalid\(uiState\.shadowStrengthInput, service\.getShadowState\(\)\.shadowStrength\);/);
  assert.doesNotMatch(shadowControllerSource, /shadowBiasInput.*addEventListener\('change'/);
  assert.doesNotMatch(shadowControllerSource, /edgeOpacityInput.*addEventListener\('change'/);
  assert.doesNotMatch(shadowControllerSource, /shadowStrengthInput.*addEventListener\('change'/);
});
