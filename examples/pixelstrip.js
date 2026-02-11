#!/usr/bin/env node
/**
 * PixelStrip RGB LED Example
 *
 * Demonstrates controlling the 6-LED WS2812B RGB strip
 * using the LatticeSpark framework.
 *
 * This example shows:
 * 1. Reading current LED state
 * 2. Setting individual LED colors
 * 3. Setting all LEDs to one color
 * 4. Adjusting brightness
 * 5. Proper cleanup (turns LEDs off)
 *
 * Usage:
 *   node examples/pixelstrip.js
 *
 * Requirements:
 * - WS2812B LED strip on GPIO 10 (SPI)
 * - elecrow_ws281x library installed
 */

import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { createSensorCoordinator } from '../src/coordinator/sensor-coordinator.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const COLORS = [
  { r: 255, g: 0, b: 0 },     // Red
  { r: 0, g: 255, b: 0 },     // Green
  { r: 0, g: 0, b: 255 },     // Blue
  { r: 255, g: 255, b: 0 },   // Yellow
  { r: 255, g: 0, b: 255 },   // Magenta
  { r: 0, g: 255, b: 255 },   // Cyan
];

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function main() {
  console.log('='.repeat(60));
  console.log('LatticeSpark Framework - PixelStrip RGB LED Example');
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
    console.log('2. Reading initial LED state...');
    const initial = await coordinator.read('pixelstrip');
    console.log(`   Brightness: ${initial.brightness}`);
    for (let i = 0; i < 6; i++) {
      console.log(`   LED ${i}: (${initial[`led_${i}_r`]}, ${initial[`led_${i}_g`]}, ${initial[`led_${i}_b`]})`);
    }
    console.log('');

    // Step 3: Set each LED to a different color
    console.log('3. Setting individual LED colors...');
    for (let i = 0; i < 6; i++) {
      const color = COLORS[i];
      await coordinator.write('pixelstrip', { led: i, ...color });
      console.log(`   LED ${i} -> (${color.r}, ${color.g}, ${color.b})`);
      await sleep(300);
    }
    console.log('');

    // Step 4: Read back state
    console.log('4. Reading back LED state...');
    const state = await coordinator.read('pixelstrip');
    for (let i = 0; i < 6; i++) {
      console.log(`   LED ${i}: (${state[`led_${i}_r`]}, ${state[`led_${i}_g`]}, ${state[`led_${i}_b`]})`);
    }
    console.log('');

    // Step 5: Adjust brightness
    console.log('5. Adjusting brightness...');
    for (const level of [128, 64, 32, 128, 255]) {
      await coordinator.write('pixelstrip', { brightness: level });
      console.log(`   Brightness: ${level}`);
      await sleep(500);
    }
    console.log('');

    // Step 6: Set all LEDs to white
    console.log('6. Setting all LEDs to white...');
    await coordinator.write('pixelstrip', { all_r: 255, all_g: 255, all_b: 255 });
    await sleep(1000);
    console.log('   All LEDs white');
    console.log('');

    // Step 7: Turn off
    console.log('7. Turning all LEDs off...');
    await coordinator.write('pixelstrip', { all_r: 0, all_g: 0, all_b: 0 });
    console.log('   All LEDs off');
    console.log('');

    console.log('='.repeat(60));
    console.log('Example completed successfully!');
    console.log('='.repeat(60));

  } catch (error) {
    console.error();
    console.error('Error:', error.message);
    console.error();

    if (error.message.includes('elecrow_ws281x')) {
      console.error('Solution: Install elecrow_ws281x library:');
      console.error('  pip3 install elecrow_ws281x --break-system-packages');
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
