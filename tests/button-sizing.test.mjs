import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const indexHtml = readFileSync(new URL('../index.html', import.meta.url), 'utf8');

test('model and VMD delete buttons expose independent sizing hooks', () => {
  assert.match(indexHtml, /--model-list-delete-button-size:\s*34px;/);
  assert.match(indexHtml, /--vmd-action-button-height:\s*24px;/);
  assert.match(indexHtml, /--vmd-delete-button-size:\s*24px;/);
  assert.equal(indexHtml.includes('model-list-delete-button'), true);
  assert.equal(indexHtml.includes('vmd-save-button'), true);
  assert.equal(indexHtml.includes('vmd-delete-button'), true);
});

test('physics controls expose the new global disable toggle', () => {
  assert.equal(indexHtml.includes('id="label-reset-rigidbody" data-i18n="Physics"'), true);
  assert.equal(indexHtml.includes('id="disablePhysics"'), true);
  assert.equal(indexHtml.includes('data-i18n="Disable Physics"'), true);
  assert.match(indexHtml, /id="reset-rigidbody"[\s\S]*id="disablePhysics"/);
});

test('video export transparent background control exposes the supported formats tooltip', () => {
  assert.equal(indexHtml.includes('id="video-export-transparent-background"'), true);
  assert.equal(indexHtml.includes('title="WebM と MKV のみ対応"'), true);
});

test('bone child picker exposes the colorize icon button', () => {
  assert.equal(indexHtml.includes('id="bone-child-pick"'), true);
  assert.equal(indexHtml.includes('data-i18n="Pick Child Bone"'), false);
  assert.equal(indexHtml.includes('title="Pick Child Bone"'), true);
  assert.match(indexHtml, /id="bone-child-pick"[\s\S]*fonts\/colorize_24dp_1F1F1F_FILL0_wght400_GRAD0_opsz24\.svg/);
});

test('post effect color temperature control exposes the viewport eyedropper button', () => {
  assert.equal(indexHtml.includes('id="color-temperature-pick"'), true);
  assert.equal(indexHtml.includes('title="Pick viewport color"'), true);
  assert.match(indexHtml, /class="morph-item color-temperature-item"[\s\S]*id="color-temperature-pick"[\s\S]*fonts\/colorize_24dp_1F1F1F_FILL0_wght400_GRAD0_opsz24\.svg/);
});

test('bone info headers expose shared key registration icons', () => {
  assert.equal(indexHtml.includes('id="bone-pos-key"'), true);
  assert.equal(indexHtml.includes('id="bone-rot-key"'), true);
  assert.match(indexHtml, /id="bone-pos-header"[\s\S]*id="bone-pos-key"/);
  assert.match(indexHtml, /id="bone-rot-header"[\s\S]*id="bone-rot-key"/);
  assert.equal(indexHtml.includes('bone-row-key-icon'), true);
  assert.match(indexHtml, /id="bone-pos-x"[\s\S]*bone-row-key-icon/);
  assert.match(indexHtml, /id="bone-rot-x"[\s\S]*id="bone-rot-lock-x"[\s\S]*bone-row-key-icon/);
  assert.match(indexHtml, /id="bone-rot-y"[\s\S]*id="bone-rot-lock-y"[\s\S]*bone-row-key-icon/);
  assert.match(indexHtml, /id="bone-rot-z"[\s\S]*id="bone-rot-lock-z"[\s\S]*bone-row-key-icon/);
});

test('bone info panel exposes the active bone parent summary at the top', () => {
  const boneTabStart = indexHtml.indexOf('<div id="tab-bone"');
  const renderTabStart = indexHtml.indexOf('<div id="tab-render"');
  assert.ok(boneTabStart >= 0);
  assert.ok(renderTabStart > boneTabStart);

  const boneTabSection = indexHtml.slice(boneTabStart, renderTabStart);
  assert.match(boneTabSection, /id="label-bone-parent-name"[\s\S]*data-i18n="Parent Bone"/);
  assert.match(boneTabSection, /id="bone-parent-bone-name"[\s\S]*>None<\/div>/);
  assert.ok(boneTabSection.indexOf('id="bone-parent-bone-name"') < boneTabSection.indexOf('class="bone-table"'));
});

test('shortcut panel exposes shared bone reset buttons', () => {
  assert.equal(indexHtml.includes('id="shortcut-reset-bone-pos"'), true);
  assert.equal(indexHtml.includes('id="shortcut-reset-bone-rot"'), true);
  assert.equal(indexHtml.includes('id="showBoneAxes"'), true);
  assert.equal(indexHtml.includes('data-i18n="Axis"'), true);
  assert.equal(indexHtml.includes('id="hideSpringBones"'), true);
  assert.equal(indexHtml.includes('data-i18n="Hide SpringBone Bones"'), true);
  assert.match(indexHtml, /id="selectedBoneName">None<\/div>[\s\S]*id="shortcut-reset-bone-pos"/);
  assert.match(indexHtml, /id="shortcut-reset-bone-pos"[\s\S]*id="shortcut-reset-bone-rot"/);
  assert.match(indexHtml, /id="showBones"[\s\S]*id="showBoneAxes"[\s\S]*id="boneThickness"/);
  assert.match(indexHtml, /id="hideIkBones"[\s\S]*id="hideSpringBones"/);
  assert.match(indexHtml, /id="reset-bone-pos"[\s\S]*id="reset-bone-rot"/);
});

test('shortcut panel no longer exposes the preferred rotation axis checkbox', () => {
  assert.equal(indexHtml.includes('id="preferPrimaryRotationAxisOnly"'), false);
  assert.equal(indexHtml.includes('Prefer Primary Rotation Axis Only'), false);
});

test('bone info panel exposes the VPD save button at the bottom of the controls', () => {
  assert.equal(indexHtml.includes('id="save-vpd"'), true);
  assert.equal(indexHtml.includes('data-i18n="Save VPD"'), true);
  assert.equal(indexHtml.includes('id="bone-ik-target-bone-list"'), true);
  assert.equal(indexHtml.includes('id="bone-ik-chain-count-range"'), true);
  assert.equal(indexHtml.includes('id="bone-ik-iteration-count-range"'), true);
  assert.equal(indexHtml.includes('id="bone-ik-rot-lock-x"'), true);
  assert.equal(indexHtml.includes('id="bone-ik-rot-lock-y"'), true);
  assert.equal(indexHtml.includes('id="bone-ik-rot-lock-z"'), true);
  assert.equal(indexHtml.includes('id="bone-ik-create"'), true);
  assert.equal(indexHtml.includes('id="bone-ik-delete"'), true);
  const boneTabStart = indexHtml.indexOf('<div id="tab-bone"');
  const renderTabStart = indexHtml.indexOf('<div id="tab-render"');
  assert.ok(boneTabStart >= 0);
  assert.ok(renderTabStart > boneTabStart);
  const boneTabSection = indexHtml.slice(boneTabStart, renderTabStart);
  assert.ok(boneTabSection.lastIndexOf('id="bone-ik-rot-lock-z"') > boneTabSection.lastIndexOf('id="bone-child-set-inverse"'));
  assert.ok(boneTabSection.lastIndexOf('id="bone-ik-chain-count-range"') > boneTabSection.lastIndexOf('id="bone-child-set-inverse"'));
  assert.ok(boneTabSection.lastIndexOf('id="bone-ik-chain-count-range"') > boneTabSection.lastIndexOf('id="bone-ik-rot-lock-z"'));
  assert.ok(boneTabSection.lastIndexOf('id="bone-ik-iteration-count-range"') > boneTabSection.lastIndexOf('id="bone-ik-chain-count-range"'));
  assert.ok(boneTabSection.lastIndexOf('id="bone-ik-delete"') > boneTabSection.lastIndexOf('id="bone-ik-iteration-count-range"'));
  assert.ok(boneTabSection.lastIndexOf('id="save-vpd"') > boneTabSection.lastIndexOf('id="bone-ik-delete"'));
  assert.equal(boneTabSection.includes('id="save-vpd"'), true);
});
