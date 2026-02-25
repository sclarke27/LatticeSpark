const DEFAULT_LEASE_TTL_MS = 5000;

export class LeaseManager {
  #leases;

  constructor() {
    this.#leases = new Map();
  }

  acquireOrRenew(key, ownerId, ttlMs = DEFAULT_LEASE_TTL_MS) {
    if (!key || !ownerId) {
      return { ok: false, error: 'Missing lease key or ownerId' };
    }

    const now = Date.now();
    const lease = this.#leases.get(key);

    if (!lease || lease.expiresAt <= now || lease.ownerId === ownerId) {
      const effectiveTtl = Number.isFinite(ttlMs) && ttlMs > 0 ? ttlMs : DEFAULT_LEASE_TTL_MS;
      const updated = {
        ownerId,
        expiresAt: now + effectiveTtl,
        ttlMs: effectiveTtl
      };
      this.#leases.set(key, updated);
      return { ok: true, lease: { ...updated, key } };
    }

    return {
      ok: false,
      error: 'Lease already held by another owner',
      lease: {
        key,
        ownerId: lease.ownerId,
        expiresAt: lease.expiresAt,
        remainingMs: Math.max(0, lease.expiresAt - now)
      }
    };
  }

  get(key) {
    const lease = this.#leases.get(key);
    if (!lease) return null;

    if (lease.expiresAt <= Date.now()) {
      this.#leases.delete(key);
      return null;
    }
    return { key, ...lease };
  }

  clear(key) {
    return this.#leases.delete(key);
  }

  listActive() {
    const now = Date.now();
    const rows = [];
    for (const [key, lease] of this.#leases.entries()) {
      if (lease.expiresAt <= now) {
        this.#leases.delete(key);
        continue;
      }
      rows.push({
        key,
        ownerId: lease.ownerId,
        expiresAt: lease.expiresAt,
        remainingMs: lease.expiresAt - now
      });
    }
    return rows;
  }
}

export const LEASE_DEFAULT_TTL_MS = DEFAULT_LEASE_TTL_MS;
