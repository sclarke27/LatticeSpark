#!/usr/bin/env node
/**
 * Unit Tests for Module Loader
 *
 * Tests config validation, component reference validation, and dynamic loading.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { validateConfig, validateComponentRefs } from '../../src/modules/module-loader.js';

/**
 * Helper: returns a valid module config object.
 * Override individual fields as needed per test.
 */
function validConfig(overrides = {}) {
  return {
    name: 'Test Module',
    enabled: true,
    components: { read: ['temp-sensor'], write: ['buzzer'] },
    triggers: { interval: 1000 },
    ...overrides,
  };
}

describe('module-loader', () => {
  // ─── validateConfig ────────────────────────────────────────────────

  describe('validateConfig', () => {
    it('should return empty array for valid config', () => {
      // Arrange
      const config = validConfig();

      // Act
      const errors = validateConfig('my-module', config);

      // Assert
      assert.deepStrictEqual(errors, []);
    });

    // ── Module ID validation ──

    it('should error when module ID has no hyphen', () => {
      // Arrange
      const config = validConfig();

      // Act
      const errors = validateConfig('mymodule', config);

      // Assert
      assert.ok(errors.length > 0);
      assert.ok(errors.some(e => e.includes('kebab-case')));
    });

    it('should error when module ID has uppercase letters', () => {
      // Arrange
      const config = validConfig();

      // Act
      const errors = validateConfig('My-Module', config);

      // Assert
      assert.ok(errors.length > 0);
      assert.ok(errors.some(e => e.includes('kebab-case')));
    });

    it('should accept valid module ID with hyphen', () => {
      // Arrange
      const config = validConfig();

      // Act
      const errors = validateConfig('my-module', config);

      // Assert
      assert.deepStrictEqual(errors, []);
    });

    // ── Required fields ──

    it('should error when "name" field is missing', () => {
      // Arrange
      const config = validConfig();
      delete config.name;

      // Act
      const errors = validateConfig('my-module', config);

      // Assert
      assert.ok(errors.some(e => e.includes('"name"')));
    });

    it('should error when "enabled" field is missing', () => {
      // Arrange
      const config = validConfig();
      delete config.enabled;

      // Act
      const errors = validateConfig('my-module', config);

      // Assert
      assert.ok(errors.some(e => e.includes('"enabled"')));
    });

    it('should error when "components" field is missing', () => {
      // Arrange
      const config = validConfig();
      delete config.components;

      // Act
      const errors = validateConfig('my-module', config);

      // Assert
      assert.ok(errors.some(e => e.includes('"components"')));
    });

    it('should error when "triggers" field is missing', () => {
      // Arrange
      const config = validConfig();
      delete config.triggers;

      // Act
      const errors = validateConfig('my-module', config);

      // Assert
      assert.ok(errors.some(e => e.includes('"triggers"')));
    });

    // ── Type checks ──

    it('should error when enabled is not a boolean', () => {
      // Arrange
      const config = validConfig({ enabled: 'yes' });

      // Act
      const errors = validateConfig('my-module', config);

      // Assert
      assert.ok(errors.some(e => e.includes('"enabled" must be a boolean')));
    });

    it('should error when components.read is not an array', () => {
      // Arrange
      const config = validConfig({ components: { read: 'temp-sensor' } });

      // Act
      const errors = validateConfig('my-module', config);

      // Assert
      assert.ok(errors.some(e => e.includes('"components.read" must be an array')));
    });

    // ── Trigger validation ──

    it('should error when no triggers are defined (no interval, no onChange)', () => {
      // Arrange
      const config = validConfig({ triggers: {} });

      // Act
      const errors = validateConfig('my-module', config);

      // Assert
      assert.ok(errors.some(e => e.includes('At least one trigger')));
    });

    it('should error when triggers.interval is too small (<100)', () => {
      // Arrange
      const config = validConfig({ triggers: { interval: 50 } });

      // Act
      const errors = validateConfig('my-module', config);

      // Assert
      assert.ok(errors.some(e => e.includes('>= 100')));
    });

    it('should accept valid triggers.interval (1000)', () => {
      // Arrange
      const config = validConfig({ triggers: { interval: 1000 } });

      // Act
      const errors = validateConfig('my-module', config);

      // Assert
      assert.deepStrictEqual(errors, []);
    });

    it('should accept valid triggers.onChange array', () => {
      // Arrange
      const config = validConfig({
        triggers: { onChange: ['temp-sensor'] },
      });

      // Act
      const errors = validateConfig('my-module', config);

      // Assert
      assert.deepStrictEqual(errors, []);
    });

    // ── UI validation ──

    it('should error when ui.page is true but ui.label is missing', () => {
      // Arrange
      const config = validConfig({ ui: { page: true } });

      // Act
      const errors = validateConfig('my-module', config);

      // Assert
      assert.ok(errors.some(e => e.includes('"ui.label" is required')));
    });
  });

  // ─── validateComponentRefs ─────────────────────────────────────────

  describe('validateComponentRefs', () => {
    const knownComponents = [
      { id: 'temp-sensor', type: 'AHT10' },
      { id: 'buzzer', type: 'Buzzer' },
    ];

    it('should return empty array when all refs are valid', () => {
      // Arrange
      const config = validConfig();

      // Act
      const warnings = validateComponentRefs(config, knownComponents);

      // Assert
      assert.deepStrictEqual(warnings, []);
    });

    it('should warn when a read component is missing', () => {
      // Arrange
      const config = validConfig({
        components: { read: ['nonexistent'] },
      });

      // Act
      const warnings = validateComponentRefs(config, knownComponents);

      // Assert
      assert.ok(warnings.length > 0);
      assert.ok(warnings.some(w => w.includes('Read component "nonexistent"')));
    });

    it('should warn when a write component is missing', () => {
      // Arrange
      const config = validConfig({
        components: { read: ['temp-sensor'], write: ['nonexistent'] },
      });

      // Act
      const warnings = validateComponentRefs(config, knownComponents);

      // Assert
      assert.ok(warnings.length > 0);
      assert.ok(warnings.some(w => w.includes('Write component "nonexistent"')));
    });

    it('should warn when an onChange component is missing', () => {
      // Arrange
      const config = validConfig({
        components: { read: ['temp-sensor'] },
        triggers: { onChange: ['nonexistent'] },
      });

      // Act
      const warnings = validateComponentRefs(config, knownComponents);

      // Assert
      assert.ok(warnings.length > 0);
      assert.ok(warnings.some(w => w.includes('onChange trigger component "nonexistent"')));
    });
  });
});
