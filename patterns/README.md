# Patterns - Golden Examples

Production-ready code examples to copy from when adding new components.

## Hardware Drivers (Python)

| Pattern | File | Use when |
|---------|------|----------|
| GPIO Sensor | [hardware-drivers/dht11-driver.py](hardware-drivers/dht11-driver.py) | Creating a new hardware driver |

This is the reference pattern for all Python drivers. It demonstrates:
- Extending `BaseDriver` with `initialize()`, `read()`, `cleanup()`
- Proper type hints and error handling
- Read throttling and value validation
- Logging to stderr, data to stdout

For GPIO-based binary sensors, see the `GPIOInputDriver` and `GPIOOutputDriver` base classes in `src/hardware-manager/drivers/` — they reduce a driver to ~5 lines.

## Legacy Patterns

The `legacy/` directory contains the old single-sensor approach from before the coordinator architecture. These are preserved for reference but should not be used as templates for new code.

- `sensor-component.js` — Old DHT11Sensor class
- `python-bridge.py` — Old bridge approach
- `test-suite.test.js` — Old testing approach
- `web-component.js` — Old UI component

See [legacy/README.md](legacy/README.md) for details.

## Related Documentation

- [rules/](../rules/) — Coding rules to follow
- [anti-patterns/](../anti-patterns/) — Common mistakes to avoid
- [CLAUDE.md](../CLAUDE.md) — Quick reference for adding components
