#!/usr/bin/env node

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { LeaseManager } from '../../src/fleet/lease-manager.js';

describe('LeaseManager', () => {
  it('acquires a new lease', () => {
    const manager = new LeaseManager();
    const result = manager.acquireOrRenew('node1.relay', 'owner-a', 5000);
    assert.equal(result.ok, true);
    assert.equal(result.lease.ownerId, 'owner-a');
  });

  it('renews lease for same owner', () => {
    const manager = new LeaseManager();
    manager.acquireOrRenew('node1.relay', 'owner-a', 100);
    const renewed = manager.acquireOrRenew('node1.relay', 'owner-a', 200);
    assert.equal(renewed.ok, true);
    assert.equal(renewed.lease.ownerId, 'owner-a');
  });

  it('rejects lease for a different owner during active lease', () => {
    const manager = new LeaseManager();
    manager.acquireOrRenew('node1.relay', 'owner-a', 5000);
    const conflict = manager.acquireOrRenew('node1.relay', 'owner-b', 5000);
    assert.equal(conflict.ok, false);
    assert.match(conflict.error, /another owner/i);
  });

  it('clears lease', () => {
    const manager = new LeaseManager();
    manager.acquireOrRenew('node1.relay', 'owner-a', 5000);
    manager.clear('node1.relay');
    assert.equal(manager.get('node1.relay'), null);
  });
});
