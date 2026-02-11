#!/usr/bin/env node
/**
 * Vibration Motor Example
 *
 * Demonstrates controlling the vibration motor
 * using the LatticeSpark framework.
 *
 * This example shows:
 * 1. Reading motor state
 * 2. Turning motor on/off
 * 3. Pulsing pattern
 * 4. Proper cleanup (motor off)
 *
 * Usage:
 *   node examples/vibration.js
 *
 * Requirements:
 * - Vibration motor on GPIO 27
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
  console.log('LatticeSpark Framework - Vibration Motor Example');
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
    const initial = await coordinator.read('vibration_motor');
    console.log(`   Vibrating: ${initial.vibrating ? 'YES' : 'NO'}`);
    console.log('');

    // Step 3: Turn on
    console.log('3. Turning vibration ON...');
    await coordinator.write('vibration_motor', { vibrating: 1 });
    await sleep(1000);

    // Step 4: Read back state
    const state = await coordinator.read('vibration_motor');
    console.log(`   Vibrating: ${state.vibrating ? 'YES' : 'NO'}`);
    console.log('');

    // Step 5: Turn off
    console.log('4. Turning vibration OFF...');
    await coordinator.write('vibration_motor', { vibrating: 0 });
    await sleep(500);
    console.log('');

    // Step 6: Pulse pattern
    console.log('5. Pulse pattern (3x short bursts)...');
    for (let i = 0; i < 3; i++) {
      await coordinator.write('vibration_motor', { vibrating: 1 });
      console.log(`   Pulse ${i + 1} ON`);
      await sleep(300);
      await coordinator.write('vibration_motor', { vibrating: 0 });
      console.log(`   Pulse ${i + 1} OFF`);
      await sleep(300);
    }
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
