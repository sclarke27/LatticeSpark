import { writeFile, rename, mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';

/**
 * Atomically write a JSON object to a file using tmp+rename.
 *
 * @param {string} filePath - Destination file path
 * @param {*} data - Data to JSON.stringify
 * @param {Object} [options]
 * @param {boolean} [options.ensureDir=false] - Create parent directories if missing
 */
export async function atomicWriteJson(filePath, data, { ensureDir = false } = {}) {
  if (ensureDir) {
    await mkdir(dirname(filePath), { recursive: true });
  }
  const tmpPath = `${filePath}.tmp`;
  await writeFile(tmpPath, JSON.stringify(data, null, 2) + '\n');
  await rename(tmpPath, filePath);
}
