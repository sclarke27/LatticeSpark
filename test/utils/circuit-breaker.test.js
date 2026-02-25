import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { CircuitBreaker } from '../../src/utils/circuit-breaker.js';

describe('CircuitBreaker', () => {
  let breaker;

  beforeEach(() => {
    breaker = new CircuitBreaker({ threshold: 3, cooldownMs: 100, maxCooldownMs: 400 });
  });

  it('starts in closed state', () => {
    assert.equal(breaker.state, 'closed');
    assert.equal(breaker.failures, 0);
    assert.equal(breaker.opens, 0);
  });

  it('allows requests when closed', () => {
    const { allowed } = breaker.allowRequest();
    assert.equal(allowed, true);
  });

  it('stays closed below threshold', () => {
    breaker.recordFailure();
    breaker.recordFailure();
    assert.equal(breaker.state, 'closed');
    assert.equal(breaker.failures, 2);
    assert.equal(breaker.allowRequest().allowed, true);
  });

  it('opens after reaching threshold failures', () => {
    for (let i = 0; i < 3; i++) breaker.recordFailure();
    assert.equal(breaker.state, 'open');
    assert.equal(breaker.opens, 1);
  });

  it('recordFailure returns tripped=true when breaker opens', () => {
    breaker.recordFailure();
    breaker.recordFailure();
    const result = breaker.recordFailure();
    assert.equal(result.tripped, true);
    assert.equal(result.failures, 3);
    assert.equal(result.opens, 1);
  });

  it('rejects requests when open', () => {
    for (let i = 0; i < 3; i++) breaker.recordFailure();
    const { allowed, reason, remainingMs } = breaker.allowRequest();
    assert.equal(allowed, false);
    assert.ok(reason);
    assert.ok(typeof remainingMs === 'number');
  });

  it('transitions to half-open after cooldown', async () => {
    for (let i = 0; i < 3; i++) breaker.recordFailure();
    assert.equal(breaker.state, 'open');

    // Wait for cooldown
    await new Promise((r) => setTimeout(r, 120));
    assert.equal(breaker.state, 'half-open');
    assert.equal(breaker.allowRequest().allowed, true);
  });

  it('closes on successful half-open attempt', async () => {
    for (let i = 0; i < 3; i++) breaker.recordFailure();
    await new Promise((r) => setTimeout(r, 120));
    assert.equal(breaker.state, 'half-open');

    const { wasOpen } = breaker.recordSuccess();
    assert.equal(wasOpen, true);
    assert.equal(breaker.state, 'closed');
    assert.equal(breaker.failures, 0);
  });

  it('re-opens with incremented opens on failed half-open attempt', async () => {
    for (let i = 0; i < 3; i++) breaker.recordFailure();
    await new Promise((r) => setTimeout(r, 120));
    assert.equal(breaker.state, 'half-open');

    const result = breaker.recordFailure();
    assert.equal(result.tripped, true);
    assert.equal(breaker.state, 'open');
    assert.equal(breaker.opens, 2);
  });

  it('doubles cooldown on each re-open', async () => {
    // Use a breaker with larger cooldowns to avoid timing flakiness
    const b = new CircuitBreaker({ threshold: 3, cooldownMs: 200, maxCooldownMs: 1600 });

    // First open: cooldown = 200ms
    for (let i = 0; i < 3; i++) b.recordFailure();
    assert.equal(b.state, 'open');
    await new Promise((r) => setTimeout(r, 220));
    assert.equal(b.state, 'half-open');
    b.recordFailure(); // fail half-open → re-open (opens=2)
    assert.equal(b.state, 'open');

    // Second open: cooldown = 400ms
    // After 220ms, should still be open
    await new Promise((r) => setTimeout(r, 220));
    assert.equal(b.state, 'open');

    // After another 220ms (total ~440ms > 400ms), should be half-open
    await new Promise((r) => setTimeout(r, 220));
    assert.equal(b.state, 'half-open');
  });

  it('respects maxCooldownMs cap', async () => {
    // Trip open many times to push cooldown past max
    for (let trip = 0; trip < 5; trip++) {
      for (let i = 0; i < 3; i++) breaker.recordFailure();
      // Force past cooldown for next trip
      await new Promise((r) => setTimeout(r, 500));
      if (breaker.state === 'half-open') {
        breaker.recordFailure(); // fail half-open
      }
    }

    // Cooldown should be capped at 400ms, not growing beyond
    const { remainingMs } = breaker.allowRequest();
    assert.ok(remainingMs <= 400, `remainingMs ${remainingMs} should be <= 400`);
  });

  it('reset() returns to clean closed state', () => {
    for (let i = 0; i < 3; i++) breaker.recordFailure();
    assert.equal(breaker.state, 'open');

    breaker.reset();
    assert.equal(breaker.state, 'closed');
    assert.equal(breaker.failures, 0);
    assert.equal(breaker.opens, 0);
    assert.equal(breaker.allowRequest().allowed, true);
  });

  it('recordSuccess when closed returns wasOpen=false', () => {
    const { wasOpen } = breaker.recordSuccess();
    assert.equal(wasOpen, false);
  });

  it('works with default options', () => {
    const defaultBreaker = new CircuitBreaker();
    assert.equal(defaultBreaker.state, 'closed');
    // Default threshold is 15
    for (let i = 0; i < 14; i++) defaultBreaker.recordFailure();
    assert.equal(defaultBreaker.state, 'closed');
    defaultBreaker.recordFailure();
    assert.equal(defaultBreaker.state, 'open');
  });
});
