/**
 * DDS texture loader.
 * Based on Babylon.js DDS loader.
 */

const DDS_MAGIC = 0x20534444;

const DDSD_MIPMAPCOUNT = 0x20000;
const DDPF_FOURCC = 0x4;

function FourCC(s) {
  return s.charCodeAt(0) + (s.charCodeAt(1) << 8) + (s.charCodeAt(2) << 16) + (s.charCodeAt(3) << 24);
}

const FOURCC_DXT1 = FourCC('DXT1');
const FOURCC_DXT3 = FourCC('DXT3');
const FOURCC_DXT5 = FourCC('DXT5');
const FOURCC_DX10 = FourCC('DX10');

// DX10 formats (WebGPU mappings)
const DXGI_FORMAT_BC1_UNORM = 71;
const DXGI_FORMAT_BC2_UNORM = 74;
const DXGI_FORMAT_BC3_UNORM = 77;
const DXGI_FORMAT_BC7_UNORM = 98;

/**
 * Parses a DDS file and returns texture data.
 * @param {ArrayBuffer} arrayBuffer - The DDS file data.
 * @returns {object} The parsed texture data.
 */
export function parseDDS(arrayBuffer) {
  const header = new Int32Array(arrayBuffer, 0, 32);
  if (header[0] !== DDS_MAGIC) {
    throw new Error('Invalid DDS magic number');
  }

  const height = header[3];
  const width = header[4];
  const mipmapCount = (header[2] & DDSD_MIPMAPCOUNT) ? Math.max(1, header[7]) : 1;
  const fourCC = header[21];

  let format;
  let blockBytes;
  let headerSize = 128;

  if (header[20] & DDPF_FOURCC) {
    switch (fourCC) {
      case FOURCC_DXT1:
        format = 'bc1-rgba-unorm';
        blockBytes = 8;
        break;
      case FOURCC_DXT3:
        format = 'bc2-rgba-unorm';
        blockBytes = 16;
        break;
      case FOURCC_DXT5:
        format = 'bc3-rgba-unorm';
        blockBytes = 16;
        break;
      case FOURCC_DX10: {
        const dx10Header = new Int32Array(arrayBuffer, 128, 5);
        const dxgiFormat = dx10Header[0];
        headerSize += 20;
        if (dxgiFormat === DXGI_FORMAT_BC1_UNORM) {
          format = 'bc1-rgba-unorm';
          blockBytes = 8;
        } else if (dxgiFormat === DXGI_FORMAT_BC2_UNORM) {
          format = 'bc2-rgba-unorm';
          blockBytes = 16;
        } else if (dxgiFormat === DXGI_FORMAT_BC3_UNORM) {
          format = 'bc3-rgba-unorm';
          blockBytes = 16;
        } else if (dxgiFormat === DXGI_FORMAT_BC7_UNORM) {
          format = 'bc7-rgba-unorm';
          blockBytes = 16;
        } else {
          throw new Error(`Unsupported DX10 format: ${dxgiFormat}`);
        }
        break;
      }
      default:
        throw new Error(`Unsupported FourCC: ${fourCC.toString(16)}`);
    }
  } else {
    throw new Error('Uncompressed DDS formats not supported yet');
  }

  const mipmaps = [];
  let currentOffset = headerSize;
  let currentWidth = width;
  let currentHeight = height;

  for (let i = 0; i < mipmapCount; i++) {
    const numBlocksWide = Math.max(1, Math.ceil(currentWidth / 4));
    const numBlocksHigh = Math.max(1, Math.ceil(currentHeight / 4));
    const size = numBlocksWide * numBlocksHigh * blockBytes;

    if (currentOffset + size > arrayBuffer.byteLength) {
      break;
    }

    mipmaps.push({
      data: new Uint8Array(arrayBuffer, currentOffset, size),
      width: currentWidth,
      height: currentHeight,
    });
    currentOffset += size;
    currentWidth = Math.max(1, currentWidth >> 1);
    currentHeight = Math.max(1, currentHeight >> 1);
  }

  return {
    width,
    height,
    format,
    mipmaps,
  };
}
