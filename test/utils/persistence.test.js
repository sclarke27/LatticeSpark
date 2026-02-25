import { describe, it, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, rm, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { atomicWriteJson } from '../../src/utils/persistence.js';

const TEST_DIR = join(tmpdir(), 'latticespark-persistence-test');

afterEach(async () => {
  await rm(TEST_DIR, { recursive: true, force: true });
});

describe('atomicWriteJson', () => {
  it('writes JSON data to file', async () => {
    const filePath = join(TEST_DIR, 'test.json');
    const data = { name: 'test', value: 42 };
    await atomicWriteJson(filePath, data, { ensureDir: true });

    const content = await readFile(filePath, 'utf8');
    const parsed = JSON.parse(content);
    assert.deepEqual(parsed, data);
  });

  it('formats JSON with 2-space indent and trailing newline', async () => {
    const filePath = join(TEST_DIR, 'formatted.json');
    await atomicWriteJson(filePath, { a: 1 }, { ensureDir: true });

    const content = await readFile(filePath, 'utf8');
    assert.equal(content, '{\n  "a": 1\n}\n');
  });

  it('creates parent directories when ensureDir is true', async () => {
    const filePath = join(TEST_DIR, 'deep', 'nested', 'file.json');
    await atomicWriteJson(filePath, { ok: true }, { ensureDir: true });

    const s = await stat(filePath);
    assert.ok(s.isFile());
  });

  it('overwrites existing file', async () => {
    const filePath = join(TEST_DIR, 'overwrite.json');
    await atomicWriteJson(filePath, { version: 1 }, { ensureDir: true });
    await atomicWriteJson(filePath, { version: 2 });

    const content = JSON.parse(await readFile(filePath, 'utf8'));
    assert.equal(content.version, 2);
  });

  it('does not leave tmp file on success', async () => {
    const filePath = join(TEST_DIR, 'clean.json');
    await atomicWriteJson(filePath, { ok: true }, { ensureDir: true });

    await assert.rejects(
      () => stat(`${filePath}.tmp`),
      { code: 'ENOENT' }
    );
  });
});
