# Anti-Patterns - What NOT to Do

> Common mistakes that break hardware systems. Learn from these failures.

## Anti-Pattern Categories

### [Async Mistakes](async-mistakes.md)

Common async/await anti-patterns:
- Sequential awaits when parallel is possible (3x slower)
- Fire and forget (silent crashes)
- Missing timeouts (hangs forever)
- Async in event handlers (errors disappear)
- Floating promises (unhandled rejections)

### [Memory Leaks](memory-leaks.md)

Patterns that leak memory in long-running processes:
- Event listeners not removed (accumulates)
- Timers not cleared (runs forever)
- Growing arrays never cleared (OOM)
- Caches without eviction
- Child processes not killed (zombies)

### [Security Issues](security-issues.md)

Security vulnerabilities to avoid:
- Command injection
- Path traversal
- Hardcoded secrets
- No authentication
- Logging sensitive data

## Most Critical Fixes

| Anti-Pattern | Severity | Fix |
|--------------|----------|-----|
| Command injection | CRITICAL | Use array args, disable shell |
| Event listeners not removed | HIGH | `removeAllListeners()` in `destroy()` |
| Missing timeouts | HIGH | `Promise.race()` with timeout |
| Floating promises | HIGH | Always `await` or `.catch()` |
| Sequential awaits | MEDIUM | Use `Promise.all()` |
| Hardcoded secrets | MEDIUM | Use environment variables |

## Quick Fixes

### Remove Event Listeners
```javascript
// WRONG
async destroy() { await this.#bridge.kill(); }

// RIGHT
async destroy() {
  this.removeAllListeners();
  await this.#bridge.kill();
}
```

### Add Timeout
```javascript
// WRONG
const data = await sensor.read();

// RIGHT
const data = await Promise.race([
  sensor.read(),
  timeout(5000)
]);
```

### Use Promise.all()
```javascript
// WRONG (sequential)
const temp = await sensors.dht11.read();
const distance = await sensors.ultrasonic.read();

// RIGHT (parallel)
const [temp, distance] = await Promise.all([
  sensors.dht11.read(),
  sensors.ultrasonic.read()
]);
```

## Related

- [rules/](../rules/) — What TO do (positive rules)
- [patterns/](../patterns/) — Golden code examples
- [CLAUDE.md](../CLAUDE.md) — Quick reference
