#!/usr/bin/env node
/**
 * Motion Sensor Example
 *
 * Demonstrates PIR motion detection using the LatticeSpark framework.
 * Uses passive infrared sensor on GPIO pin 23.
 *
 * This example shows:
 * 1. Loading configuration from JSON file
 * 2. Initializing the coordinator
 * 3. Polling for motion state
 * 4. Detecting state changes
 * 5. Proper cleanup
 *
 * Usage:
 *   node examples/motion-sensor.js
 *
 * Requirements:
 * - PIR motion sensor on GPIO 23
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
  console.log('LatticeSpark Framework - Motion Sensor Example');
  console.log('='.repeat(60));
  console.log('');
  console.log('Wave your hand near the sensor to detect motion.');
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
    const initial = await coordinator.read('motion_sensor');
    console.log(`   Motion: ${initial.motion ? 'detected' : 'none'}`);
    console.log('');

    // Step 3: Poll for changes
    console.log('3. Monitoring for motion (15 seconds)...');
    console.log('');

    let lastMotion = initial.motion;

    for (let i = 0; i < 150; i++) {
      await new Promise(resolve => setTimeout(resolve, 100));

      const reading = await coordinator.read('motion_sensor');

      if (reading.motion !== lastMotion) {
        const timestamp = new Date(reading.timestamp * 1000).toISOString();
        if (reading.motion) {
          console.log(`   [${timestamp}] Motion detected!`);
        } else {
          console.log(`   [${timestamp}] Motion stopped`);
        }
        lastMotion = reading.motion;
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
      console.error('Solution: Check sensor connection on GPIO 23');
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
