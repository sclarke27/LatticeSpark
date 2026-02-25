import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeNodeId } from '../../src/utils/normalization.js';

describe('normalizeNodeId', () => {
  it('lowercases input', () => {
    assert.equal(normalizeNodeId('MyNode'), 'mynode');
  });

  it('trims whitespace', () => {
    assert.equal(normalizeNodeId('  spoke-1  '), 'spoke-1');
  });

  it('handles null', () => {
    assert.equal(normalizeNodeId(null), '');
  });

  it('handles undefined', () => {
    assert.equal(normalizeNodeId(undefined), '');
  });

  it('handles empty string', () => {
    assert.equal(normalizeNodeId(''), '');
  });

  it('handles numeric input', () => {
    assert.equal(normalizeNodeId(42), '42');
  });

  it('lowercases and trims combined', () => {
    assert.equal(normalizeNodeId('  Spoke-1  '), 'spoke-1');
  });
});
