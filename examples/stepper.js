#!/usr/bin/env node
/**
 * Stepper Motor Example
 *
 * Demonstrates controlling the 28BYJ-48 stepper motor
 * using the CrowPi3 framework.
 *
 * This example shows:
 * 1. Reading stepper state (position, degrees)
 * 2. Rotating by degrees (+90, -90, +360)
 * 3. Rotating by steps
 * 4. Returning home (position 0)
 *
 * Usage:
 *   node examples/stepper.js
 *
 * Requirements:
 * - 28BYJ-48 stepper with ULN2003 driver
 * - GPIO 5, 6, 13, 25
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
  console.log('CrowPi3 Framework - Stepper Motor Example');
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

    // Step 2: Read initial state
    console.log('2. Reading initial state...');
    let state = await coordinator.read('stepper_motor');
    console.log(`   Position: ${state.position} steps (${state.degrees}°)`);
    console.log('');

    // Step 3: Rotate 90 degrees clockwise (~1.1s)
    console.log('3. Rotating +90 degrees...');
    await coordinator.write('stepper_motor', { degrees: 90 });
    await sleep(1500);  // 1024 steps @ 1.1ms = ~1.1s + margin
    state = await coordinator.read('stepper_motor');
    console.log(`   Position: ${state.position} steps (${state.degrees}°)`);
    console.log('');

    // Step 4: Rotate 90 degrees counter-clockwise
    console.log('4. Rotating -90 degrees...');
    await coordinator.write('stepper_motor', { degrees: -90 });
    await sleep(1500);
    state = await coordinator.read('stepper_motor');
    console.log(`   Position: ${state.position} steps (${state.degrees}°)`);
    console.log('');

    // Step 5: Full revolution (~4.5s)
    console.log('5. Full revolution (360 degrees)...');
    await coordinator.write('stepper_motor', { degrees: 360 });
    await sleep(5000);  // 4096 steps @ 1.1ms = ~4.5s + margin
    state = await coordinator.read('stepper_motor');
    console.log(`   Position: ${state.position} steps (${state.degrees}°)`);
    console.log('');

    // Step 6: Rotate by steps (1024 steps = quarter turn)
    console.log('6. Moving 1024 steps (quarter turn)...');
    await coordinator.write('stepper_motor', { steps: 1024 });
    await sleep(1500);
    state = await coordinator.read('stepper_motor');
    console.log(`   Position: ${state.position} steps (${state.degrees}°)`);
    console.log('');

    // Step 7: Return home
    console.log('7. Returning home...');
    await coordinator.write('stepper_motor', { home: 1 });
    await sleep(6000);  // May need to return from far position
    state = await coordinator.read('stepper_motor');
    console.log(`   Position: ${state.position} steps (${state.degrees}°)`);
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
