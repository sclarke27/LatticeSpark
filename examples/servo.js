#!/usr/bin/env node
/**
 * Servo Motor Example
 *
 * Demonstrates controlling the SG90 servo motor
 * using the CrowPi3 framework.
 *
 * This example shows:
 * 1. Reading servo angle
 * 2. Setting specific angles (0, 90, 180)
 * 3. Smooth sweep pattern
 * 4. Proper cleanup (return to center)
 *
 * Usage:
 *   node examples/servo.js
 *
 * Requirements:
 * - SG90 servo on GPIO 19
 * - gpiozero library installed
 */

import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { createSensorCoordinator } from '../src/coordinator/sensor-coordinator.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function main() {
  console.log('='.repeat(60));
  console.log('CrowPi3 Framework - Servo Motor Example');
  console.log('='.repeat(60));
  console.log('');

  let coordinator = null;

  try {
    // Step 1: Create coordinator
    console.log('1. Creating coordinator...');
    const configFile = join(__dirname, '..', 'config', 'components.json');
    coordinator = await createSensorCoordinator({ configFile });
    console.log('   Coordinator ready');
    console.log('');

    // Step 2: Read initial position
    console.log('2. Reading initial position...');
    const initial = await coordinator.read('servo');
    console.log(`   Angle: ${initial.angle} degrees`);
    console.log('');

    // Step 3: Move to specific angles
    const angles = [0, 45, 90, 135, 180];
    console.log('3. Moving to specific angles...');
    for (const angle of angles) {
      await coordinator.write('servo', { angle });
      console.log(`   Moved to ${angle} degrees`);
      await sleep(500);
    }
    console.log('');

    // Step 4: Smooth sweep
    console.log('4. Smooth sweep (180 -> 0 -> 90)...');
    for (let angle = 180; angle >= 0; angle -= 10) {
      await coordinator.write('servo', { angle });
      await sleep(50);
    }
    console.log('   Swept to 0');
    await sleep(300);

    for (let angle = 0; angle <= 90; angle += 10) {
      await coordinator.write('servo', { angle });
      await sleep(50);
    }
    console.log('   Swept to 90 (center)');
    console.log('');

    // Step 5: Read final position
    const final = await coordinator.read('servo');
    console.log(`5. Final position: ${final.angle} degrees`);
    console.log('');

    console.log('='.repeat(60));
    console.log('Example completed successfully!');
    console.log('='.repeat(60));

  } catch (error) {
    console.error();
    console.error('Error:', error.message);
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

main();
