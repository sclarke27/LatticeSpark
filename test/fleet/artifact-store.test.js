import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readdir, readFile, writeFile, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { Readable } from 'node:stream';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ArtifactStore } from '../../src/fleet/artifact-store.js';

const ZIP_B64 = Buffer.from('zip').toString('base64');

describe('ArtifactStore version retention', () => {
  let baseDir;
  let store;

  beforeEach(async () => {
    baseDir = await mkdtemp(join(tmpdir(), 'artifact-store-'));
    store = new ArtifactStore({ baseDir, kind: 'module' });
    await store.initialize();
  });

  afterEach(async () => {
    await rm(baseDir, { recursive: true, force: true });
  });

  async function saveVersions(bundleId, versions) {
    for (const version of versions) {
      await store.saveBundle({ bundleId, version, zipBase64: ZIP_B64 });
      // manifest createdAt has ms resolution — keep them strictly ordered
      await new Promise((r) => setTimeout(r, 2));
    }
  }

  async function versionDirs(bundleId) {
    const entries = await readdir(join(baseDir, bundleId), { withFileTypes: true });
    return entries.filter((e) => e.isDirectory()).map((e) => e.name).sort();
  }

  it('keeps only the newest 5 versions after saving 7', async () => {
    // Act
    await saveVersions('demo', ['v1', 'v2', 'v3', 'v4', 'v5', 'v6', 'v7']);

    // Assert
    assert.deepStrictEqual(await versionDirs('demo'), ['v3', 'v4', 'v5', 'v6', 'v7']);
    const listed = await store.listBundles();
    assert.equal(listed.length, 5);
  });

  it('retained versions stay fully retrievable; pruned return null', async () => {
    // Arrange
    await saveVersions('demo', ['v1', 'v2', 'v3', 'v4', 'v5', 'v6', 'v7']);

    // Act & Assert - 5th-newest still viable for rollback-by-redeploy
    const oldestKept = await store.getBundle('demo', 'v3');
    assert.ok(oldestKept);
    assert.equal(oldestKept.zipBase64, ZIP_B64);
    assert.equal(await store.getBundle('demo', 'v1'), null);
  });

  it('pruneOldVersions honors explicit keep and no-ops under it', async () => {
    // Arrange
    await saveVersions('demo', ['v1', 'v2', 'v3', 'v4']);

    // Act
    const pruned = await store.pruneOldVersions('demo', 2);

    // Assert
    assert.deepStrictEqual(pruned.sort(), ['v1', 'v2']);
    assert.deepStrictEqual(await versionDirs('demo'), ['v3', 'v4']);
    assert.deepStrictEqual(await store.pruneOldVersions('demo', 2), []);
  });

  it('prune is scoped per bundleId', async () => {
    // Arrange
    await saveVersions('alpha', ['v1', 'v2', 'v3']);
    await saveVersions('beta', ['v1', 'v2', 'v3', 'v4', 'v5', 'v6']);

    // Assert - beta pruned to 5, alpha untouched
    assert.deepStrictEqual(await versionDirs('alpha'), ['v1', 'v2', 'v3']);
    assert.equal((await versionDirs('beta')).length, 5);
  });

  it('corrupt manifest sorts oldest and prunes first; saveBundle still succeeds', async () => {
    // Arrange - a version dir with garbage manifest
    const corruptDir = join(baseDir, 'demo', 'corrupt');
    await mkdir(corruptDir, { recursive: true });
    await writeFile(join(corruptDir, 'manifest.json'), 'not-json{{{');
    await saveVersions('demo', ['v1', 'v2', 'v3', 'v4', 'v5']);

    // Assert - 6 dirs existed; corrupt one was pruned first
    const dirs = await versionDirs('demo');
    assert.equal(dirs.length, 5);
    assert.ok(!dirs.includes('corrupt'));
  });

  it('saveBundle return shape is unchanged', async () => {
    // Act
    const saved = await store.saveBundle({ bundleId: 'demo', version: 'v1', zipBase64: ZIP_B64 });

    // Assert
    assert.deepStrictEqual(Object.keys(saved).sort(),
      ['archiveChecksum', 'bundleId', 'version', 'zipPath']);
    assert.equal(saved.bundleId, 'demo');
    assert.equal(saved.version, 'v1');
  });
});

describe('ArtifactStore.saveBundleFromStream', () => {
  let baseDir;
  let store;

  beforeEach(async () => {
    baseDir = await mkdtemp(join(tmpdir(), 'artifact-store-'));
    store = new ArtifactStore({ baseDir, kind: 'module' });
    await store.initialize();
  });

  afterEach(async () => {
    await rm(baseDir, { recursive: true, force: true });
  });

  async function filesIn(dir) {
    try {
      return await readdir(dir);
    } catch {
      return [];
    }
  }

  it('writes zip + manifest and returns the streamed sha256', async () => {
    // Arrange
    const payload = Buffer.from('streamed-zip-bytes');
    const expected = createHash('sha256').update(payload).digest('hex');

    // Act
    const saved = await store.saveBundleFromStream({
      bundleId: 'demo',
      version: 'v1',
      stream: Readable.from([payload])
    });

    // Assert
    assert.equal(saved.archiveChecksum, expected);
    const written = await readFile(join(baseDir, 'demo', 'v1', 'module.zip'));
    assert.deepStrictEqual(written, payload);
    const manifest = JSON.parse(
      await readFile(join(baseDir, 'demo', 'v1', 'manifest.json'), 'utf-8')
    );
    assert.equal(manifest.archiveChecksum, expected);
  });

  it('rejects on checksum mismatch and leaves no zip or tmp file', async () => {
    // Act & Assert
    await assert.rejects(
      () => store.saveBundleFromStream({
        bundleId: 'demo',
        version: 'v1',
        stream: Readable.from([Buffer.from('data')]),
        archiveChecksum: 'deadbeef'
      }),
      { message: /archiveChecksum mismatch/ }
    );
    const files = await filesIn(join(baseDir, 'demo', 'v1'));
    assert.ok(!files.includes('module.zip'));
    assert.ok(!files.some((f) => f.includes('.tmp-')));
  });

  it('rejects oversized streams with BUNDLE_TOO_LARGE and cleans up', async () => {
    // Act & Assert
    await assert.rejects(
      () => store.saveBundleFromStream({
        bundleId: 'demo',
        version: 'v1',
        stream: Readable.from([Buffer.alloc(64), Buffer.alloc(64)]),
        maxBytes: 100
      }),
      (err) => err.code === 'BUNDLE_TOO_LARGE'
    );
    const files = await filesIn(join(baseDir, 'demo', 'v1'));
    assert.ok(!files.some((f) => f.includes('.tmp-')));
  });

  it('rejects an empty stream', async () => {
    await assert.rejects(
      () => store.saveBundleFromStream({
        bundleId: 'demo',
        version: 'v1',
        stream: Readable.from([])
      }),
      { message: /empty/ }
    );
  });

  it('rejects invalid bundleId before writing anything', async () => {
    // toSafeId collapses whitespace-only ids to '' (slashes sanitize to dashes)
    await assert.rejects(
      () => store.saveBundleFromStream({
        bundleId: '   ',
        version: 'v1',
        stream: Readable.from([Buffer.from('data')])
      }),
      { message: /Invalid bundleId/ }
    );
    assert.deepStrictEqual(await filesIn(baseDir), []);
  });

  it('getBundle round-trips a streamed save as zipBase64', async () => {
    // Arrange
    const payload = Buffer.from('round-trip-payload');
    await store.saveBundleFromStream({
      bundleId: 'demo',
      version: 'v1',
      stream: Readable.from([payload])
    });

    // Act - proves the Socket.IO deploy leg is unaffected
    const bundle = await store.getBundle('demo', 'v1');

    // Assert
    assert.equal(bundle.zipBase64, payload.toString('base64'));
  });
});
