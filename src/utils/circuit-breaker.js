/**
 * Reusable circuit breaker with configurable thresholds and exponential backoff cooldown.
 *
 * States: closed → open (at threshold) → half-open (after cooldown) → closed (on success)
 *
 * @example
 * const breaker = new CircuitBreaker({ threshold: 5, cooldownMs: 5000 });
 * const { allowed } = breaker.allowRequest();
 * if (!allowed) throw new Error('Circuit open');
 * try { await doWork(); breaker.recordSuccess(); }
 * catch (err) { breaker.recordFailure(); throw err; }
 */
export class CircuitBreaker {
  #threshold;
  #cooldownMs;
  #maxCooldownMs;
  #failures;
  #opens;
  #lastFailure;
  #state; // 'closed' | 'open' | 'half-open'

  /**
   * @param {Object} [options]
   * @param {number} [options.threshold=15] - Consecutive failures before opening
   * @param {number} [options.cooldownMs=5000] - Base cooldown in ms (doubles on each re-open)
   * @param {number} [options.maxCooldownMs=60000] - Maximum cooldown cap in ms
   */
  constructor({ threshold = 15, cooldownMs = 5000, maxCooldownMs = 60000 } = {}) {
    this.#threshold = threshold;
    this.#cooldownMs = cooldownMs;
    this.#maxCooldownMs = maxCooldownMs;
    this.#failures = 0;
    this.#opens = 0;
    this.#lastFailure = 0;
    this.#state = 'closed';
  }

  /** Current state: 'closed' | 'open' | 'half-open' */
  get state() {
    if (this.#state === 'open') {
      // Check if cooldown has elapsed → transition to half-open
      const cooldown = this.#currentCooldown();
      if (Date.now() - this.#lastFailure >= cooldown) {
        this.#state = 'half-open';
      }
    }
    return this.#state;
  }

  /** Current failure count */
  get failures() {
    return this.#failures;
  }

  /** Number of times the breaker has tripped open */
  get opens() {
    return this.#opens;
  }

  /**
   * Check if a request should be allowed through.
   * @returns {{ allowed: boolean, reason?: string, remainingMs?: number }}
   */
  allowRequest() {
    const currentState = this.state; // triggers half-open transition if applicable
    if (currentState === 'closed' || currentState === 'half-open') {
      return { allowed: true };
    }
    // Open — calculate remaining cooldown
    const cooldown = this.#currentCooldown();
    const elapsed = Date.now() - this.#lastFailure;
    const remainingMs = Math.max(0, cooldown - elapsed);
    return {
      allowed: false,
      reason: `Circuit open (${Math.ceil(remainingMs / 1000)}s remaining)`,
      remainingMs
    };
  }

  /**
   * Record a successful operation. Resets the breaker to closed state.
   * @returns {{ wasOpen: boolean }}
   */
  recordSuccess() {
    const wasOpen = this.#state === 'half-open' || this.#state === 'open';
    this.#failures = 0;
    this.#state = 'closed';
    return { wasOpen };
  }

  /**
   * Record a failed operation. May trip the breaker open.
   * @returns {{ tripped: boolean, failures: number, opens: number }}
   */
  recordFailure() {
    this.#failures++;
    this.#lastFailure = Date.now();

    if (this.#state === 'half-open') {
      // Half-open attempt failed → re-open with incremented opens count
      this.#opens++;
      this.#state = 'open';
      return { tripped: true, failures: this.#failures, opens: this.#opens };
    }

    if (this.#failures >= this.#threshold && this.#state === 'closed') {
      this.#opens++;
      this.#state = 'open';
      return { tripped: true, failures: this.#failures, opens: this.#opens };
    }

    return { tripped: false, failures: this.#failures, opens: this.#opens };
  }

  /** Reset to clean closed state. */
  reset() {
    this.#failures = 0;
    this.#opens = 0;
    this.#lastFailure = 0;
    this.#state = 'closed';
  }

  /** Calculate current cooldown based on number of opens. */
  #currentCooldown() {
    return Math.min(
      this.#cooldownMs * Math.pow(2, Math.max(0, this.#opens - 1)),
      this.#maxCooldownMs
    );
  }
}
