# Coding Rules

> Follow these rules when writing code for the CrowPi3 framework.

## Rules by Topic

### [Testing](common/testing.md)
- 80% coverage minimum
- AAA pattern (Arrange, Act, Assert)
- Mock external dependencies
- No shared state between tests

### [Error Handling](common/error-handling.md)
- Circuit breaker pattern for hardware
- Custom error hierarchy with context
- Retry with exponential backoff
- Never silent failures

### [Async/Await](javascript/async-await.md)
- Always async/await, never callbacks or `.then()` chains
- `Promise.all()` for parallel operations
- Timeouts on all I/O operations

### [Component Structure](javascript/component-structure.md)
- Extend EventEmitter
- Private fields with `#` prefix
- Idempotent `initialize()` / `destroy()`
- Standard events: ready, data, error, change

### [Python Bridge Patterns](python/bridge-patterns.md)
- JSON-RPC protocol over stdin/stdout
- Type hints on all functions
- `flush=True` on every `print()` to stdout
- Log to stderr, data to stdout
- Resource cleanup via atexit + finally

### Driver Auto-Discovery
- Drivers auto-discovered from `src/hardware-manager/drivers/` via `importlib`
- Naming convention: Type `BH1750` -> file `bh1750_driver.py` -> class `BH1750Driver`
- No manual registration needed
- All metric values must be numeric (int), not bool, for web UI compatibility

## Quick Reference

| Language | Key Rules |
|----------|-----------|
| JavaScript | async/await, EventEmitter, `#` private fields, < 300 lines per file |
| Python | JSON-RPC, 100% type hints, stderr logging, `flush=True` |
| Testing | 80%+ coverage, AAA pattern, mocked hardware, no shared state |
| Error Handling | Circuit breaker, retry with backoff, structured logging |

## Related

- [CLAUDE.md](../CLAUDE.md) — Quick reference and component catalog
- [patterns/](../patterns/) — Golden code examples to copy from
- [anti-patterns/](../anti-patterns/) — Common mistakes to avoid
