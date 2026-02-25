import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { withTimeout } from '../../src/utils/timeout.js';

describe('withTimeout', () => {
  it('resolves when promise completes within timeout', async () => {
    const result = await withTimeout(Promise.resolve('ok'), 1000, 'test');
    assert.equal(result, 'ok');
  });

  it('rejects with timeout error when promise exceeds timeout', async () => {
    const slow = new Promise((resolve) => setTimeout(resolve, 5000));
    await assert.rejects(
      () => withTimeout(slow, 50, 'slow-op'),
      { message: 'Timeout: slow-op took longer than 50ms' }
    );
  });

  it('preserves original rejection when promise fails within timeout', async () => {
    await assert.rejects(
      () => withTimeout(Promise.reject(new Error('boom')), 1000, 'test'),
      { message: 'boom' }
    );
  });

  it('includes label and duration in timeout error message', async () => {
    const slow = new Promise((resolve) => setTimeout(resolve, 5000));
    await assert.rejects(
      () => withTimeout(slow, 100, 'my-operation'),
      (err) => {
        assert.match(err.message, /my-operation/);
        assert.match(err.message, /100ms/);
        return true;
      }
    );
  });
});
