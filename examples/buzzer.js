#!/usr/bin/env node
/**
 * Active Buzzer Example
 *
 * Demonstrates controlling the active buzzer
 * using the LatticeSpark framework.
 *
 * This example shows:
 * 1. Reading buzzer state
 * 2. Short beep
 * 3. Long beep
 * 4. Beep pattern (SOS)
 * 5. Proper cleanup (buzzer off)
 *
 * Usage:
 *   node examples/buzzer.js
 *
 * Requirements:
 * - Active buzzer on GPIO 18
 */

import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { createSensorCoordinator } from '../src/coordinator/sensor-coordinator.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function beep(coordinator, ms) {
  await coordinator.write('buzzer', { buzzing: 1 });
  await sleep(ms);
  await coordinator.write('buzzer', { buzzing: 0 });
}

async function main() {
  console.log('='.repeat(60));
  console.log('LatticeSpark Framework - Active Buzzer Example');
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
    console.log('2. Reading buzzer state...');
    const initial = await coordinator.read('buzzer');
    console.log(`   Buzzing: ${initial.buzzing ? 'ON' : 'OFF'}`);
    console.log('');

    // Step 3: Short beep
    console.log('3. Short beep (100ms)...');
    await beep(coordinator, 100);
    await sleep(300);

    // Step 4: Long beep
    console.log('4. Long beep (500ms)...');
    await beep(coordinator, 500);
    await sleep(300);

    // Step 5: Three quick beeps
    console.log('5. Three quick beeps...');
    for (let i = 0; i < 3; i++) {
      await beep(coordinator, 80);
      await sleep(120);
    }
    await sleep(500);

    // Step 6: SOS pattern (... --- ...)
    console.log('6. SOS pattern...');
    // S: three short
    for (let i = 0; i < 3; i++) {
      await beep(coordinator, 100);
      await sleep(100);
    }
    await sleep(200);
    // O: three long
    for (let i = 0; i < 3; i++) {
      await beep(coordinator, 300);
      await sleep(100);
    }
    await sleep(200);
    // S: three short
    for (let i = 0; i < 3; i++) {
      await beep(coordinator, 100);
      await sleep(100);
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
