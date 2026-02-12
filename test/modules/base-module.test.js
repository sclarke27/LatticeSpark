#!/usr/bin/env node
/**
 * Unit Tests for BaseModule
 *
 * Tests the base class lifecycle methods and property accessors.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { BaseModule } from '../../src/modules/base-module.js';

describe('BaseModule', () => {
  const mockContext = { read: () => {}, write: () => {} };
  const mockConfig = { name: 'test-module', enabled: true };

  describe('Constructor', () => {
    it('should store context and config', () => {
      // Arrange & Act
      const mod = new BaseModule(mockContext, mockConfig);

      // Assert
      assert.ok(mod);
      assert.equal(mod.ctx, mockContext);
      assert.deepStrictEqual(mod.config, mockConfig);
    });
  });

  describe('Getters', () => {
    it('should return context via ctx getter', () => {
      // Arrange
      const mod = new BaseModule(mockContext, mockConfig);

      // Act & Assert
      assert.equal(mod.ctx, mockContext);
    });

    it('should return config via config getter', () => {
      // Arrange
      const mod = new BaseModule(mockContext, mockConfig);

      // Act & Assert
      assert.equal(mod.config, mockConfig);
    });
  });

  describe('Lifecycle Methods', () => {
    it('should resolve initialize() without error', async () => {
      // Arrange
      const mod = new BaseModule(mockContext, mockConfig);

      // Act & Assert
      await assert.doesNotReject(() => mod.initialize());
    });

    it('should resolve execute() without error', async () => {
      // Arrange
      const mod = new BaseModule(mockContext, mockConfig);

      // Act & Assert
      await assert.doesNotReject(() => mod.execute());
    });

    it('should resolve onSensorChange() without error', async () => {
      // Arrange
      const mod = new BaseModule(mockContext, mockConfig);

      // Act & Assert
      await assert.doesNotReject(() => mod.onSensorChange('temp-sensor', { temperature: 30 }, { temperature: 25 }));
    });

    it('should resolve handleCommand() without error', async () => {
      // Arrange
      const mod = new BaseModule(mockContext, mockConfig);

      // Act & Assert
      await assert.doesNotReject(() => mod.handleCommand('setThreshold', { value: 30 }));
    });

    it('should resolve cleanup() without error', async () => {
      // Arrange
      const mod = new BaseModule(mockContext, mockConfig);

      // Act & Assert
      await assert.doesNotReject(() => mod.cleanup());
    });
  });
});
