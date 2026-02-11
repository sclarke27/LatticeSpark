#!/usr/bin/env node
/**
 * Rotary Encoder Example
 *
 * Demonstrates rotary encoder tracking using the CrowPi3 framework.
 * Uses TCA9534 I2C GPIO expander at address 0x3c.
 *
 * This example shows:
 * 1. Loading configuration from JSON file
 * 2. Initializing the coordinator
 * 3. Polling for encoder rotation
 * 4. Detecting position and direction changes
 * 5. Proper cleanup
 *
 * Usage:
 *   node examples/encoder.js
 *
 * Requirements:
 * - TCA9534 GPIO expander on I2C bus at 0x3c
 * - smbus2 library installed
 */

import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { createSensorCoordinator } from '../src/coordinator/sensor-coordinator.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

/**
 * Main function
 */
async function main() {
  console.log('='.repeat(60));
  console.log('CrowPi3 Framework - Rotary Encoder Example');
  console.log('='.repeat(60));
  console.log('');
  console.log('Turn the encoder knob to detect changes.');
  console.log('Press Ctrl+C to exit.');
  console.log('');

  let coordinator = null;

  try {
    // Step 1: Create coordinator with config file
    console.log('1. Creating coordinator...');
    const configFile = join(__dirname, '..', 'config', 'components.json');

    coordinator = await createSensorCoordinator({ configFile });
    console.log('   Coordinator ready');
    console.log('');

    // Step 2: Initial read
    console.log('2. Initial reading...');
    const initial = await coordinator.read('encoder');
    console.log(`   Position: ${initial.position}`);
    console.log('');

    // Step 3: Poll for changes
    console.log('3. Monitoring for encoder changes (15 seconds)...');
    console.log('');

    let lastPosition = initial.position;

    for (let i = 0; i < 150; i++) {
      await new Promise(resolve => setTimeout(resolve, 100));

      const reading = await coordinator.read('encoder');

      // Detect rotation
      if (reading.position !== lastPosition) {
        const dir = reading.direction === 1 ? 'CW' : 'CCW';
        console.log(`   [Rotation] ${dir} -> Position: ${reading.position}`);
        lastPosition = reading.position;
      }
    }

    console.log('');
    console.log('='.repeat(60));
    console.log('Example completed successfully!');
    console.log('='.repeat(60));

  } catch (error) {
    console.error();
    console.error('Error:', error.message);
    console.error();

    if (error.message.includes('smbus2')) {
      console.error('Solution: Install smbus2 library:');
      console.error('  pip3 install smbus2 --break-system-packages');
    } else if (error.message.includes('I2C') || error.message.includes('0x3c')) {
      console.error('Solution: Check TCA9534 connection on I2C bus');
      console.error('  i2cdetect -y 1');
    }

    console.error();
    process.exit(1);

  } finally {
    if (coordinator) {
      console.log('');
      console.log('Cleaning up...');
      await coordinator.shutdown();
      console.log('Done.');
    }
  }
}

// Run main function
main();
