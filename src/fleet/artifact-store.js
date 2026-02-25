import { mkdir, readFile, readdir, rename, stat, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import crypto from 'node:crypto';

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
    const manifestPath = join(bundleDir, 'manifest.json');

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

    const manifest = {
      bundleId,
      version,
      signature: payload.signature || null,
      archiveChecksum: checksum,
      metadata: payload.metadata || {},
      createdAt: Date.now()
    };

    if (payload.manifest && typeof payload.manifest === 'object') {
      manifest.manifest = payload.manifest;
    }

    const tmpManifest = `${manifestPath}.tmp`;
    await writeFile(tmpManifest, JSON.stringify(manifest, null, 2));
    await rename(tmpManifest, manifestPath);

    return {
      bundleId,
      version,
      archiveChecksum: checksum,
      zipPath
    };
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
