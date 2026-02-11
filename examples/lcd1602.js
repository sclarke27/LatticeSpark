#!/usr/bin/env node
/**
 * LCD1602 Display Example
 *
 * Demonstrates controlling the 16x2 character LCD display
 * using the LatticeSpark framework.
 *
 * This example shows:
 * 1. Reading current display state
 * 2. Writing text to both lines
 * 3. Updating a single line
 * 4. Toggling backlight
 * 5. Proper cleanup (clears display)
 *
 * Usage:
 *   node examples/lcd1602.js
 *
 * Requirements:
 * - LCD1602 with I2C backpack at 0x21
 * - Adafruit_CharLCD library installed
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
  console.log('LatticeSpark Framework - LCD1602 Display Example');
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
    console.log('2. Reading initial LCD state...');
    const initial = await coordinator.read('lcd_display');
    console.log(`   Line 1: "${initial.line1}"`);
    console.log(`   Line 2: "${initial.line2}"`);
    console.log(`   Backlight: ${initial.backlight ? 'ON' : 'OFF'}`);
    console.log('');

    // Step 3: Write text to both lines
    console.log('3. Writing text to LCD...');
    await coordinator.write('lcd_display', {
      line1: 'Hello World!',
      line2: 'LatticeSpark LCD'
    });
    console.log('   Wrote: "Hello World!" / "LatticeSpark LCD"');
    await sleep(2000);

    // Step 4: Update just line 2
    console.log('4. Updating line 2...');
    await coordinator.write('lcd_display', { line2: 'Line 2 updated!' });
    console.log('   Line 2: "Line 2 updated!"');
    await sleep(2000);

    // Step 5: Toggle backlight
    console.log('5. Toggling backlight...');
    await coordinator.write('lcd_display', { backlight: 0 });
    console.log('   Backlight OFF');
    await sleep(1000);
    await coordinator.write('lcd_display', { backlight: 1 });
    console.log('   Backlight ON');
    await sleep(1000);

    // Step 6: Read back state
    console.log('6. Reading back state...');
    const state = await coordinator.read('lcd_display');
    console.log(`   Line 1: "${state.line1}"`);
    console.log(`   Line 2: "${state.line2}"`);
    console.log(`   Backlight: ${state.backlight ? 'ON' : 'OFF'}`);
    console.log('');

    // Step 7: Clear display
    console.log('7. Clearing display...');
    await coordinator.write('lcd_display', { line1: '', line2: '' });
    console.log('   Display cleared');
    console.log('');

    console.log('='.repeat(60));
    console.log('Example completed successfully!');
    console.log('='.repeat(60));

  } catch (error) {
    console.error();
    console.error('Error:', error.message);
    console.error();

    if (error.message.includes('Adafruit_CharLCD')) {
      console.error('Solution: Install Adafruit_CharLCD library:');
      console.error('  pip3 install Adafruit-CharLCD --break-system-packages');
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
