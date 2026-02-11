#!/usr/bin/env node
/**
 * Flame Sensor Example
 *
 * Demonstrates flame detection using the CrowPi3 framework.
 * Uses flame detector sensor on GPIO pin 4.
 *
 * This example shows:
 * 1. Loading configuration from JSON file
 * 2. Initializing the coordinator
 * 3. Polling for flame state
 * 4. Detecting state changes
 * 5. Proper cleanup
 *
 * Usage:
 *   node examples/flame-sensor.js
 *
 * Requirements:
 * - Flame detector sensor on GPIO 4
 * - gpiozero library installed
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
  console.log('CrowPi3 Framework - Flame Sensor Example');
  console.log('='.repeat(60));
  console.log('');
  console.log('Hold a flame near the sensor to detect it.');
  console.log('Press Ctrl+C to exit.');
  console.log('');

  let coordinator = null;

  try {
    // Step 1: Create coordinator with config file
    console.log('1. Creating coordinator...');
    const configFile = join(__dirname, '..', 'config', 'components.json');

    coordinator = await createSensorCoordinator({ configFile });
    console.log('   ✓ Coordinator ready');
    console.log('');

    // Step 2: Initial read
    console.log('2. Initial reading...');
    const initial = await coordinator.read('flame_detector');
    console.log(`   Flame: ${initial.detected ? 'DETECTED' : 'none'}`);
    console.log('');

    // Step 3: Poll for changes
    console.log('3. Monitoring for flame detection (10 seconds)...');
    console.log('');

    let lastDetected = initial.detected;

    for (let i = 0; i < 200; i++) {
      await new Promise(resolve => setTimeout(resolve, 50));

      const reading = await coordinator.read('flame_detector');

      if (reading.detected !== lastDetected) {
        const timestamp = new Date(reading.timestamp * 1000).toISOString();
        if (reading.detected) {
          console.log(`   [${timestamp}] 🔥 Flame detected!`);
        } else {
          console.log(`   [${timestamp}] No flame`);
        }
        lastDetected = reading.detected;
      }
    }

    console.log('');
    console.log('='.repeat(60));
    console.log('Example completed successfully! ✓');
    console.log('='.repeat(60));

  } catch (error) {
    console.error();
    console.error('Error:', error.message);
    console.error();

    if (error.message.includes('gpiozero')) {
      console.error('Solution: Install gpiozero library:');
      console.error('  pip3 install gpiozero --break-system-packages');
    } else if (error.message.includes('GPIO')) {
      console.error('Solution: Check sensor connection on GPIO 4');
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
