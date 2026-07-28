import { mkdir, readFile, readdir, rename, rm, stat, writeFile } from 'node:fs/promises';
import { existsSync, createWriteStream } from 'node:fs';
import { pipeline } from 'node:stream/promises';
import { join } from 'node:path';
import crypto from 'node:crypto';
import { createLogger } from '../utils/logger.js';

const log = createLogger('artifact-store');
const DEFAULT_KEEP_VERSIONS = 5;

function toSafeId(value) {
  if (typeof value !== 'string') return '';
  return value.trim().toLowerCase().replace(/[^a-z0-9._-]/g, '-');
}

function assertRequired(payload, fields) {
  for (const field of fields) {
    if (payload[field] === undefined || payload[field] === null || payload[field] === '') {
      throw new Error(`Missing required field: ${field}`);
    }
  }
}

export class ArtifactStore {
  #baseDir;
  #kind;

  constructor({ baseDir, kind }) {
    this.#baseDir = baseDir;
    this.#kind = kind;
  }

  async initialize() {
    await mkdir(this.#baseDir, { recursive: true });
  }

  async saveBundle(payload) {
    assertRequired(payload, ['bundleId', 'version', 'zipBase64']);
    const bundleId = toSafeId(payload.bundleId);
    const version = toSafeId(payload.version);
    if (!bundleId || !version) {
      throw new Error('Invalid bundleId or version');
    }

    const bundleDir = join(this.#baseDir, bundleId, version);
    await mkdir(bundleDir, { recursive: true });

    const zipPath = join(bundleDir, `${this.#kind}.zip`);

    const zipBuffer = Buffer.from(payload.zipBase64, 'base64');
    if (zipBuffer.length === 0) {
      throw new Error('Bundle zip payload is empty');
    }

    const checksum = crypto.createHash('sha256').update(zipBuffer).digest('hex');
    if (payload.archiveChecksum && payload.archiveChecksum !== checksum) {
      throw new Error('archiveChecksum mismatch');
    }

    const tmpZip = `${zipPath}.tmp`;
    await writeFile(tmpZip, zipBuffer);
    await rename(tmpZip, zipPath);

    await this.#writeManifest(bundleDir, {
      bundleId,
      version,
      signature: payload.signature || null,
      checksum,
      metadata: payload.metadata || {},
      manifest: payload.manifest
    });

    // Bound disk growth — a prune failure must never fail a successful upload
    try {
      await this.pruneOldVersions(bundleId);
    } catch (err) {
      log.warn({ err, bundleId }, 'Failed to prune old bundle versions');
    }

    return {
      bundleId,
      version,
      archiveChecksum: checksum,
      zipPath
    };
  }

  /**
   * Save a bundle from a readable stream (raw archive body) without buffering
   * it in memory: pipe stream -> incremental sha256 -> temp file -> rename.
   */
  async saveBundleFromStream({
    bundleId,
    version,
    stream,
    archiveChecksum = null,
    signature = null,
    metadata = {},
    manifest = null,
    maxBytes = 100 * 1024 * 1024
  }) {
    const safeBundleId = toSafeId(bundleId);
    const safeVersion = toSafeId(version);
    if (!safeBundleId || !safeVersion) {
      throw new Error('Invalid bundleId or version');
    }

    const bundleDir = join(this.#baseDir, safeBundleId, safeVersion);
    await mkdir(bundleDir, { recursive: true });

    const zipPath = join(bundleDir, `${this.#kind}.zip`);
    const tmpZip = `${zipPath}.tmp-${process.pid}-${Date.now()}`;
    const hash = crypto.createHash('sha256');
    let size = 0;

    try {
      await pipeline(
        stream,
        async function* (source) {
          for await (const chunk of source) {
            size += chunk.length;
            if (size > maxBytes) {
              const err = new Error(`Bundle exceeds ${maxBytes} byte limit`);
              err.code = 'BUNDLE_TOO_LARGE';
              throw err;
            }
            hash.update(chunk);
            yield chunk;
          }
        },
        createWriteStream(tmpZip)
      );
      if (size === 0) {
        throw new Error('Bundle zip payload is empty');
      }
      const checksum = hash.digest('hex');
      if (archiveChecksum && archiveChecksum !== checksum) {
        throw new Error('archiveChecksum mismatch');
      }
      await rename(tmpZip, zipPath);
      await this.#writeManifest(bundleDir, {
        bundleId: safeBundleId,
        version: safeVersion,
        signature,
        checksum,
        metadata,
        manifest
      });

      try {
        await this.pruneOldVersions(safeBundleId);
      } catch (err) {
        log.warn({ err, bundleId: safeBundleId }, 'Failed to prune old bundle versions');
      }

      return {
        bundleId: safeBundleId,
        version: safeVersion,
        archiveChecksum: checksum,
        zipPath
      };
    } catch (err) {
      await rm(tmpZip, { force: true });
      throw err;
    }
  }

  async #writeManifest(bundleDir, { bundleId, version, signature, checksum, metadata, manifest }) {
    const manifestPath = join(bundleDir, 'manifest.json');
    const manifestDoc = {
      bundleId,
      version,
      signature: signature || null,
      archiveChecksum: checksum,
      metadata: metadata || {},
      createdAt: Date.now()
    };

    if (manifest && typeof manifest === 'object') {
      manifestDoc.manifest = manifest;
    }

    const tmpManifest = `${manifestPath}.tmp`;
    await writeFile(tmpManifest, JSON.stringify(manifestDoc, null, 2));
    await rename(tmpManifest, manifestPath);
  }

  /**
   * Delete the oldest versions of a bundle beyond `keep`, ranked by manifest
   * createdAt (corrupt/unreadable manifests sort oldest and prune first).
   * @returns {Promise<string[]>} pruned version names
   */
  async pruneOldVersions(bundleId, keep = DEFAULT_KEEP_VERSIONS) {
    const safeBundleId = toSafeId(bundleId);
    const bundleDir = join(this.#baseDir, safeBundleId);
    if (!safeBundleId || !existsSync(bundleDir)) return [];

    const entries = await readdir(bundleDir, { withFileTypes: true });
    const versions = [];
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      let createdAt = 0;
      try {
        const manifest = JSON.parse(
          await readFile(join(bundleDir, entry.name, 'manifest.json'), 'utf-8')
        );
        createdAt = manifest.createdAt || 0;
      } catch { /* unreadable manifest sorts oldest, pruned first */ }
      versions.push({ version: entry.name, createdAt });
    }

    if (versions.length <= keep) return [];
    versions.sort((a, b) => b.createdAt - a.createdAt);
    const pruned = [];
    for (const { version } of versions.slice(keep)) {
      await rm(join(bundleDir, version), { recursive: true, force: true });
      pruned.push(version);
    }
    return pruned;
  }

  async getBundle(bundleId, version) {
    const safeBundleId = toSafeId(bundleId);
    const safeVersion = toSafeId(version);
    const manifestPath = join(this.#baseDir, safeBundleId, safeVersion, 'manifest.json');
    const zipPath = join(this.#baseDir, safeBundleId, safeVersion, `${this.#kind}.zip`);

    if (!existsSync(manifestPath) || !existsSync(zipPath)) {
      return null;
    }

    const manifest = JSON.parse(await readFile(manifestPath, 'utf-8'));
    const zipBuffer = await readFile(zipPath);
    return {
      ...manifest,
      bundleId: safeBundleId,
      version: safeVersion,
      zipPath,
      zipBase64: zipBuffer.toString('base64')
    };
  }

  async listBundles() {
    if (!existsSync(this.#baseDir)) return [];
    const bundles = [];

    const bundleIds = await readdir(this.#baseDir, { withFileTypes: true });
    for (const entry of bundleIds) {
      if (!entry.isDirectory()) continue;
      const bundleId = entry.name;
      const bundleDir = join(this.#baseDir, bundleId);
      const versions = await readdir(bundleDir, { withFileTypes: true });
      for (const versionEntry of versions) {
        if (!versionEntry.isDirectory()) continue;
        const version = versionEntry.name;
        const manifestPath = join(bundleDir, version, 'manifest.json');
        if (!existsSync(manifestPath)) continue;
        const manifest = JSON.parse(await readFile(manifestPath, 'utf-8'));
        const zipPath = join(bundleDir, version, `${this.#kind}.zip`);
        const archiveSizeBytes = existsSync(zipPath) ? (await stat(zipPath)).size : 0;
        bundles.push({
          bundleId,
          version,
          archiveChecksum: manifest.archiveChecksum || null,
          signature: manifest.signature || null,
          createdAt: manifest.createdAt || null,
          metadata: manifest.metadata || {},
          manifest: manifest.manifest || null,
          archiveSizeBytes
        });
      }
    }

    bundles.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
    return bundles;
  }
}
