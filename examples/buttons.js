#!/usr/bin/env node
/**
 * 4-Button Panel Example
 *
 * Demonstrates button press detection using the LatticeSpark framework.
 * Uses SPI/ADC to read a 4-button resistor ladder panel.
 *
 * This example shows:
 * 1. Loading configuration from JSON file
 * 2. Initializing the coordinator
 * 3. Polling for button presses
 * 4. Detecting state changes
 * 5. Proper cleanup
 *
 * Usage:
 *   node examples/buttons.js
 *
 * Requirements:
 * - 4-button panel connected via SPI (bus 0, device 1)
 * - spidev library installed
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
  console.log('LatticeSpark Framework - 4-Button Panel Example');
  console.log('='.repeat(60));
  console.log('');
  console.log('Press buttons 1-4 to see them detected.');
  console.log('Press Ctrl+C to exit.');
  console.log('');

  let coordinator = null;

  try {
    // Step 1: Create coordinator with config file
    console.log('1. Creating coordinator...');
    const configFile = join(__dirname, '..', 'config', 'components.json');

    coordinator = await createSensorCoordinator({ configFile });
    console.log('   ✓ Coordinator ready');
    console.log('');

    // Step 2: Initial read
    console.log('2. Initial reading...');
    const initial = await coordinator.read('button_panel');
    console.log(`   Button: ${initial.button > 0 ? initial.button : 'none'}`);
    console.log('');

    // Step 3: Poll for changes
    console.log('3. Monitoring for button presses (10 seconds)...');
    console.log('');

    let lastButton = initial.button;

    for (let i = 0; i < 100; i++) {
      await new Promise(resolve => setTimeout(resolve, 100));

      const reading = await coordinator.read('button_panel');

      if (reading.button !== lastButton) {
        const timestamp = new Date(reading.timestamp * 1000).toISOString();
        if (reading.button > 0) {
          console.log(`   [${timestamp}] Button ${reading.button} pressed`);
        } else {
          console.log(`   [${timestamp}] Released`);
        }
        lastButton = reading.button;
      }
    }

    console.log('');
    console.log('='.repeat(60));
    console.log('Example completed successfully! ✓');
    console.log('='.repeat(60));

  } catch (error) {
    console.error();
    console.error('Error:', error.message);
    console.error();

    if (error.message.includes('spidev')) {
      console.error('Solution: Install spidev library:');
      console.error('  pip3 install spidev --break-system-packages');
    } else if (error.message.includes('SPI')) {
      console.error('Solution: Enable SPI in raspi-config and check connections');
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
