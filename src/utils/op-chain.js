/**
 * Create a serial operation queue: enqueued async fns run strictly one at a
 * time in FIFO order. A rejected op does not break the chain; the returned
 * promise reflects that op's own result/rejection.
 *
 * INVARIANT: a function passed to the returned enqueue must never call the
 * same enqueue itself — the inner op would wait on the chain that is waiting
 * on it (deadlock).
 */
export function createOpChain() {
  let tail = Promise.resolve();
  return function enqueue(fn) {
    const run = tail.then(() => fn());
    tail = run.then(() => {}, () => {});
    return run;
  };
}
