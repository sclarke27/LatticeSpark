#!/usr/bin/env node
/**
 * 8x8 RGB LED Matrix Example
 *
 * Demonstrates controlling the 8x8 LED matrix
 * using the LatticeSpark framework.
 *
 * This example shows:
 * 1. Fill all LEDs with a color
 * 2. Apply presets (heart, smiley, etc.)
 * 3. Set individual pixels
 * 4. Clear the display
 *
 * Usage:
 *   node examples/led-matrix.js
 *
 * Requirements:
 * - 8x8 WS2812B LED matrix on GPIO 10
 * - elecrow_ws281x library installed
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
  console.log('LatticeSpark Framework - 8x8 LED Matrix Example');
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

    // Step 2: Fill red
    console.log('2. Fill all red...');
    await coordinator.write('led_matrix', { fill: 1, r: 255, g: 0, b: 0 });
    await sleep(1500);

    // Step 3: Fill green
    console.log('3. Fill all green...');
    await coordinator.write('led_matrix', { fill: 1, r: 0, g: 255, b: 0 });
    await sleep(1500);

    // Step 4: Fill blue
    console.log('4. Fill all blue...');
    await coordinator.write('led_matrix', { fill: 1, r: 0, g: 0, b: 255 });
    await sleep(1500);

    // Step 5: Heart preset
    console.log('5. Heart preset...');
    await coordinator.write('led_matrix', { preset: 'heart' });
    await sleep(2000);

    // Step 6: Smiley preset
    console.log('6. Smiley preset...');
    await coordinator.write('led_matrix', { preset: 'smiley' });
    await sleep(2000);

    // Step 7: Checkerboard preset
    console.log('7. Checkerboard preset...');
    await coordinator.write('led_matrix', { preset: 'checkerboard' });
    await sleep(2000);

    // Step 8: Border preset
    console.log('8. Border preset...');
    await coordinator.write('led_matrix', { preset: 'border' });
    await sleep(2000);

    // Step 9: X mark preset
    console.log('9. X mark preset...');
    await coordinator.write('led_matrix', { preset: 'x_mark' });
    await sleep(2000);

    // Step 10: Diamond preset
    console.log('10. Diamond preset...');
    await coordinator.write('led_matrix', { preset: 'diamond' });
    await sleep(2000);

    // Step 11: Individual pixels - draw a diagonal
    console.log('11. Drawing diagonal...');
    await coordinator.write('led_matrix', { clear: 1 });
    for (let i = 0; i < 8; i++) {
      const pixel = i * 8 + i; // diagonal: 0, 9, 18, 27, 36, 45, 54, 63
      await coordinator.write('led_matrix', { pixel, r: 255, g: 128, b: 0 });
      await sleep(200);
    }
    await sleep(1500);

    // Step 12: Read state
    console.log('12. Reading state...');
    const state = await coordinator.read('led_matrix');
    console.log(`   Preset: ${state.preset || '(none)'}`);
    const grid = JSON.parse(state.grid);
    const litCount = grid.filter(([r, g, b]) => r > 0 || g > 0 || b > 0).length;
    console.log(`   Lit pixels: ${litCount}/64`);
    console.log('');

    // Step 13: Clear
    console.log('13. Clearing...');
    await coordinator.write('led_matrix', { clear: 1 });
    await sleep(500);

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
