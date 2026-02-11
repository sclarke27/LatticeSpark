#!/usr/bin/env node
/**
 * 7-Segment Display Example
 *
 * Demonstrates controlling the 4-digit 7-segment display
 * using the CrowPi3 framework.
 *
 * This example shows:
 * 1. Reading current display state
 * 2. Writing digits to the display
 * 3. Toggling the colon
 * 4. Counting animation
 * 5. Proper cleanup (clears display)
 *
 * Usage:
 *   node examples/segment-display.js
 *
 * Requirements:
 * - HT16K33-based 7-segment display at I2C 0x70
 * - Adafruit_LED_Backpack library installed
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
  console.log('CrowPi3 Framework - 7-Segment Display Example');
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
    console.log('2. Reading initial display state...');
    const initial = await coordinator.read('segment_display');
    console.log(`   Text: "${initial.text}"`);
    console.log(`   Colon: ${initial.colon ? 'ON' : 'OFF'}`);
    console.log('');

    // Step 3: Show all 8s with colon
    console.log('3. Showing "8888" with colon...');
    await coordinator.write('segment_display', { text: '8888', colon: 1 });
    console.log('   Display: 88:88');
    await sleep(2000);

    // Step 4: Show a time-like display
    console.log('4. Showing "12:34"...');
    await coordinator.write('segment_display', { text: '1234', colon: 1 });
    console.log('   Display: 12:34');
    await sleep(2000);

    // Step 5: Toggle colon off
    console.log('5. Colon OFF...');
    await coordinator.write('segment_display', { colon: 0 });
    console.log('   Display: 1234 (no colon)');
    await sleep(1000);

    // Step 6: Counting animation
    console.log('6. Counting 0-20...');
    for (let i = 0; i <= 20; i++) {
      const text = String(i).padStart(4, ' ');
      await coordinator.write('segment_display', { text, colon: 0 });
      await sleep(200);
    }
    console.log('   Count complete');
    await sleep(1000);

    // Step 7: Decimal point demo (dots only after digit 1 and digit 3)
    console.log('7. Decimal point demo...');
    for (const val of ['12.34', '56.78', ' 9.99.']) {
      await coordinator.write('segment_display', { text: val, colon: 0 });
      console.log(`   Display: ${val}`);
      await sleep(1500);
    }

    // Step 8: Read back state
    console.log('8. Reading back state...');
    const state = await coordinator.read('segment_display');
    console.log(`   Text: "${state.text}"`);
    console.log(`   Colon: ${state.colon ? 'ON' : 'OFF'}`);
    console.log('');

    // Step 9: Clear display
    console.log('9. Clearing display...');
    await coordinator.write('segment_display', { text: '    ', colon: 0 });
    console.log('   Display cleared');
    console.log('');

    console.log('='.repeat(60));
    console.log('Example completed successfully!');
    console.log('='.repeat(60));

  } catch (error) {
    console.error();
    console.error('Error:', error.message);
    console.error();

    if (error.message.includes('Adafruit_LED_Backpack')) {
      console.error('Solution: Install Adafruit_LED_Backpack library:');
      console.error('  pip3 install Adafruit-LED-Backpack --break-system-packages');
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

main();
