#!/usr/bin/env node
/**
 * Touch Sensor Example
 *
 * Demonstrates capacitive touch detection using the CrowPi3 framework.
 * Uses touch sensor on GPIO pin 17.
 *
 * This example shows:
 * 1. Loading configuration from JSON file
 * 2. Initializing the coordinator
 * 3. Polling for touch state
 * 4. Detecting state changes
 * 5. Proper cleanup
 *
 * Usage:
 *   node examples/touch-sensor.js
 *
 * Requirements:
 * - Touch sensor on GPIO 17
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
  console.log('CrowPi3 Framework - Touch Sensor Example');
  console.log('='.repeat(60));
  console.log('');
  console.log('Touch the sensor pad to detect contact.');
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
    const initial = await coordinator.read('touch_sensor');
    console.log(`   Touch: ${initial.touched ? 'touched' : 'not touched'}`);
    console.log('');

    // Step 3: Poll for changes
    console.log('3. Monitoring for touch (15 seconds)...');
    console.log('');

    let lastTouched = initial.touched;

    for (let i = 0; i < 150; i++) {
      await new Promise(resolve => setTimeout(resolve, 100));

      const reading = await coordinator.read('touch_sensor');

      if (reading.touched !== lastTouched) {
        const timestamp = new Date(reading.timestamp * 1000).toISOString();
        if (reading.touched) {
          console.log(`   [${timestamp}] Touched!`);
        } else {
          console.log(`   [${timestamp}] Released`);
        }
        lastTouched = reading.touched;
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

    if (error.message.includes('gpiozero')) {
      console.error('Solution: Install gpiozero library:');
      console.error('  pip3 install gpiozero --break-system-packages');
    } else if (error.message.includes('GPIO')) {
      console.error('Solution: Check sensor connection on GPIO 17');
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
