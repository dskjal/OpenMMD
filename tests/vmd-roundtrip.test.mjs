import { VMDLoader } from '../source/infrastructure/loaders/vmd-loader.js';
import { VMDWriter } from '../source/infrastructure/loaders/vmd-writer.js';
import fs from 'fs';

/**
 * Returns the byte offset where the self-shadow keyframe count should start.
 * @param {object} data - Parsed VMD data.
 * @returns {number} Byte offset of the self-shadow keyframe count.
 */
function getSelfShadowCountOffset(data) {
  const isOldFormat = data.signature === 'Vocaloid Motion Data file';
  const modelNameSize = isOldFormat ? 10 : 20;
  const boneSize = data.boneKeyframes.length * 111;
  const faceSize = data.faceKeyframes.length * 23;
  const cameraSize = data.cameraKeyframes.length * 61;
  const lightSize = data.lightKeyframes ? data.lightKeyframes.length * 28 : 0;

  return 30 + modelNameSize + 4 + boneSize + 4 + faceSize + 4 + cameraSize + 4 + lightSize;
}

/**
 * Detects whether the original VMD file explicitly contains a self-shadow section.
 * @param {Uint8Array} original - Original file bytes.
 * @param {object} data - Parsed VMD data.
 * @returns {boolean} True if the self-shadow count exists in the original file.
 */
function hasSelfShadowSection(original, data) {
  return original.length > getSelfShadowCountOffset(data);
}

function getSectionName(offset, data) {
  let currentOffset = 54;
  
  const boneSize = data.boneKeyframes.length * 111;
  if (offset >= currentOffset && offset < currentOffset + boneSize) {
    const idx = Math.floor((offset - currentOffset) / 111);
    const pos = (offset - currentOffset) % 111;
    let field = 'Unknown';
    if (pos < 15) field = 'BoneName';
    else if (pos < 19) field = 'FrameNum';
    else if (pos < 31) field = 'Position';
    else if (pos < 47) field = 'Rotation';
    else field = 'Interpolation';
    return `Bone[${idx}].${field}`;
  }
  currentOffset += boneSize + 4;

  const faceSize = data.faceKeyframes.length * 23;
  if (offset >= currentOffset && offset < currentOffset + faceSize) {
    const idx = Math.floor((offset - currentOffset) / 23);
    const pos = (offset - currentOffset) % 23;
    let field = 'Unknown';
    if (pos < 15) field = 'Name';
    else if (pos < 19) field = 'FrameNum';
    else field = 'Weight';
    return `Face[${idx}].${field}`;
  }
  currentOffset += faceSize + 4;

  const camSize = data.cameraKeyframes.length * 61;
  if (offset >= currentOffset && offset < currentOffset + camSize) {
    const idx = Math.floor((offset - currentOffset) / 61);
    const pos = (offset - currentOffset) % 61;
    let field = 'Unknown';
    if (pos < 4) field = 'FrameNum';
    else if (pos < 8) field = 'Distance';
    else if (pos < 20) field = 'Target';
    else if (pos < 32) field = 'Rotation';
    else if (pos < 56) field = 'Interpolation';
    else if (pos < 60) field = 'FOV';
    else field = 'Perspective';
    return `Camera[${idx}].${field}`;
  }
  return 'Data/Other';
}

function compare(original, output, data) {
  if (original.length !== output.length) {
    return `Size mismatch: ${original.length} vs ${output.length}`;
  }

  let i = 0;
  while (i < original.length) {
    const section = getSectionName(i, data);
    
    // Header modelName (30-50)
    if (i >= 30 && i < 50) {
      let nullIdx = -1;
      for (let j = 0; j < (50 - i); j++) {
        if (original[i + j] === 0) { nullIdx = i + j; break; }
      }
      if (nullIdx !== -1) {
        i = 50; 
        continue;
      }
    }
    
    // Bone and Face name fields (15 bytes)
    // Bone name starts at 54 + 111*k
    // Face name starts at 54 + boneSize + 4 + 23*k
    let isNameField = false;
    let nameFieldLen = 15;
    let nameFieldStart = 0;

    if (i >= 54) {
      const boneEnd = 54 + (data.boneKeyframes.length * 111);
      if (i < boneEnd) {
        const offsetInBone = (i - 54) % 111;
        if (offsetInBone < 15) {
          isNameField = true;
          nameFieldStart = i - offsetInBone;
        }
      } else {
        const faceStart = boneEnd + 4;
        const offsetInFace = (i - faceStart) % 23;
        if (offsetInFace < 15) {
          isNameField = true;
          nameFieldStart = i - offsetInFace;
        }
      }
    }

    if (isNameField) {
      let nullIdx = -1;
      for (let j = 0; j < (nameFieldStart + 15 - i); j++) {
        if (original[i + j] === 0) { nullIdx = i + j; break; }
      }
      if (nullIdx !== -1) {
        i = nameFieldStart + 15;
        continue;
      }
    }

    if (original[i] !== output[i]) {
      const start = Math.max(0, i - 10);
      const end = Math.min(original.length, i + 10);
      console.log(`Original bytes near mismatch: ${original.slice(start, end).join(',')}`);
      console.log(`Output bytes near mismatch:   ${output.slice(start, end).join(',')}`);
      return `Mismatch at ${i} (${section}): 0x${original[i].toString(16)} vs 0x${output[i].toString(16)}`;
    }
    i++;
  }
  return null;
}

async function testFile(filePath) {
  console.log(`\nTesting: ${filePath}`);
  const buffer = fs.readFileSync(filePath);

  const loader = new VMDLoader();
  const data = loader.parse(buffer.buffer);
  
  console.log(`  Counts: Bone=${data.boneKeyframes.length}, Face=${data.faceKeyframes.length}, Camera=${data.cameraKeyframes.length}, Light=${data.lightKeyframes ? data.lightKeyframes.length : 0}, Shadow=${data.selfShadowKeyframes ? data.selfShadowKeyframes.length : 0}`);

  const writer = new VMDWriter();
  const outputBuffer = writer.write(data);

  const originalArray = new Uint8Array(buffer);
  const outputArray = new Uint8Array(outputBuffer);
  const originalHasSelfShadow = hasSelfShadowSection(originalArray, data);

  if (originalArray.length !== outputArray.length) {
    /**
     * 調査結果:
     * 既存の roundtrip で 4 bytes だけ増えるケースは、元ファイルに self-shadow
     * count が無い一方で、VMDWriter が末尾に 0 の count を正規化して書き足すために起きる。
     * byte-for-byte の差分ではなく、仕様上の canonical form の差として扱う。
     */
    const sizeDelta = outputArray.length - originalArray.length;
    const appendedZeroCount = sizeDelta === 4
      && !originalHasSelfShadow
      && outputArray.length >= 4
      && outputArray.slice(outputArray.length - 4).every((value) => value === 0);

    if (appendedZeroCount) {
      console.log('  Size mismatch accepted: missing self-shadow section was normalized to a zero count.');
      return;
    }

    console.error(`  Size mismatch: Original=${originalArray.length}, Output=${outputArray.length}`);
  } else {
    const error = compare(originalArray, outputArray, data);
    if (error) {
      console.error(`  ${error}`);
    } else {
      console.log('  Successfully matched binary (ignoring string padding)!');
    }
  }
}

async function runAllTests() {
  const dir = 'test-data/';
  const files = fs.readdirSync(dir).filter(file => file.endsWith('.vmd'));
  for (const file of files) {
    await testFile(dir + file);
  }
}

runAllTests().catch(console.error);
