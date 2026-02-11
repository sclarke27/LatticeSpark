#!/usr/bin/env node
/**
 * Relay Example
 *
 * Demonstrates controlling the relay module
 * using the LatticeSpark framework.
 *
 * This example shows:
 * 1. Reading relay state
 * 2. Turning relay on/off
 * 3. Toggle pattern
 * 4. Proper cleanup (relay off)
 *
 * Usage:
 *   node examples/relay.js
 *
 * Requirements:
 * - Relay module on GPIO 21
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
  console.log('LatticeSpark Framework - Relay Example');
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
    const initial = await coordinator.read('relay');
    console.log(`   Relay: ${initial.active ? 'ON' : 'OFF'}`);
    console.log('');

    // Step 3: Turn on
    console.log('3. Turning relay ON...');
    await coordinator.write('relay', { active: 1 });
    await sleep(1000);

    // Step 4: Read back state
    const state = await coordinator.read('relay');
    console.log(`   Relay: ${state.active ? 'ON' : 'OFF'}`);
    console.log('');

    // Step 5: Turn off
    console.log('4. Turning relay OFF...');
    await coordinator.write('relay', { active: 0 });
    await sleep(500);
    console.log('');

    // Step 6: Toggle pattern
    console.log('5. Toggle pattern (3x)...');
    for (let i = 0; i < 3; i++) {
      await coordinator.write('relay', { active: 1 });
      console.log(`   Toggle ${i + 1} ON`);
      await sleep(500);
      await coordinator.write('relay', { active: 0 });
      console.log(`   Toggle ${i + 1} OFF`);
      await sleep(500);
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
