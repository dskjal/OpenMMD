import { cp, mkdir, rm, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const projectRoot = fileURLToPath(new URL('..', import.meta.url));
const distDir = path.join(projectRoot, 'dist');
const entries = [
  'index.html',
  'source',
  'fonts',
  'models',
  'pose-library',
  'test-data',
  'toon-textures',
];

/**
 * Copies a file or directory into the Pages output.
 * @param {string} entry - Source entry name.
 * @returns {Promise<void>} Completion promise.
 */
async function copyEntry(entry) {
  await cp(path.join(projectRoot, entry), path.join(distDir, entry), {
    recursive: true,
    force: true,
  });
}

await rm(distDir, { recursive: true, force: true });
await mkdir(distDir, { recursive: true });

for (const entry of entries) {
  await copyEntry(entry);
}

await writeFile(path.join(distDir, '.nojekyll'), '');

console.log(`Pages output written to ${distDir}`);
