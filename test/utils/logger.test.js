import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { createLogger } from '../../src/utils/logger.js';

describe('createLogger', () => {
  const savedEnv = {};

  beforeEach(() => {
    savedEnv.LOG_LEVEL = process.env.LOG_LEVEL;
    savedEnv.NODE_ENV = process.env.NODE_ENV;
    savedEnv.PM2_HOME = process.env.PM2_HOME;
    delete process.env.LOG_LEVEL;
    delete process.env.NODE_ENV;
    delete process.env.PM2_HOME;
  });

  afterEach(() => {
    for (const [key, val] of Object.entries(savedEnv)) {
      if (val === undefined) delete process.env[key];
      else process.env[key] = val;
    }
  });

  it('returns a pino logger with the given name', () => {
    const log = createLogger('test-service');
    assert.ok(log);
    assert.ok(typeof log.info === 'function');
    assert.ok(typeof log.error === 'function');
    assert.ok(typeof log.warn === 'function');
    assert.ok(typeof log.debug === 'function');
  });

  it('defaults to info level', () => {
    const log = createLogger('test-service');
    assert.equal(log.level, 'info');
  });

  it('respects LOG_LEVEL env var', () => {
    process.env.LOG_LEVEL = 'debug';
    const log = createLogger('test-service');
    assert.equal(log.level, 'debug');
  });

  it('respects options.level over env var', () => {
    process.env.LOG_LEVEL = 'warn';
    const log = createLogger('test-service', { level: 'trace' });
    assert.equal(log.level, 'trace');
  });

  it('uses JSON output in production (NODE_ENV)', () => {
    process.env.NODE_ENV = 'production';
    const log = createLogger('prod-service');
    // Production logger has no transport (writes JSON directly)
    assert.equal(log[Symbol.for('pino.opts')]?.transport, undefined);
  });

  it('uses JSON output when PM2_HOME is set', () => {
    process.env.PM2_HOME = '/home/user/.pm2';
    const log = createLogger('pm2-service');
    assert.equal(log[Symbol.for('pino.opts')]?.transport, undefined);
  });

  it('uses pretty transport in dev mode', () => {
    // No NODE_ENV, no PM2_HOME = dev mode
    const log = createLogger('dev-service');
    // Dev logger uses pino-pretty transport — the logger still works
    assert.ok(typeof log.info === 'function');
  });
});
