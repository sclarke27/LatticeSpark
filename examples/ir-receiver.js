#!/usr/bin/env node
/**
 * IR Remote Receiver Example
 *
 * Demonstrates infrared remote control reception using the CrowPi3 framework.
 * Uses NEC protocol IR receiver on GPIO pin 20.
 *
 * This example shows:
 * 1. Loading configuration from JSON file
 * 2. Initializing the coordinator
 * 3. Polling for remote control button presses
 * 4. Displaying key codes and names
 * 5. Proper cleanup
 *
 * Usage:
 *   node examples/ir-receiver.js
 *
 * Requirements:
 * - IR receiver module on GPIO 20
 * - NEC protocol IR remote control
 * - gpiozero library installed
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
  console.log('CrowPi3 Framework - IR Remote Receiver Example');
  console.log('='.repeat(60));
  console.log('');
  console.log('Point your remote at the IR receiver and press buttons.');
  console.log('Press Ctrl+C to exit.');
  console.log('');

  // NEC remote key code -> name mapping
  const KEY_NAMES = {
    0x45: 'CH-', 0x46: 'CH', 0x47: 'CH+',
    0x44: 'PREV', 0x40: 'NEXT', 0x43: 'PLAY/PAUSE',
    0x07: 'VOL-', 0x15: 'VOL+', 0x09: 'EQ',
    0x16: '0', 0x19: '100+', 0x0D: '200+',
    0x0C: '1', 0x18: '2', 0x5E: '3',
    0x08: '4', 0x1C: '5', 0x5A: '6',
    0x42: '7', 0x52: '8', 0x4A: '9',
  };

  let coordinator = null;

  try {
    // Step 1: Create coordinator with config file
    console.log('1. Creating coordinator...');
    const configFile = join(__dirname, '..', 'config', 'components.json');

    coordinator = await createSensorCoordinator({ configFile });
    console.log('   Coordinator ready');
    console.log('');

    // Step 2: Listen for remote presses
    console.log('2. Listening for IR remote presses (30 seconds)...');
    console.log('');

    for (let i = 0; i < 300; i++) {
      await new Promise(resolve => setTimeout(resolve, 100));

      const reading = await coordinator.read('ir_receiver');

      if (reading.key_code !== 0) {
        const hex = '0x' + reading.key_code.toString(16).toUpperCase().padStart(2, '0');
        const name = KEY_NAMES[reading.key_code] || 'unknown';
        console.log(`   [IR] Key: ${name} (code: ${hex})`);
      }
    }

    console.log('');
    console.log('='.repeat(60));
    console.log('Example completed successfully!');
    console.log('='.repeat(60));

  } catch (error) {
    console.error();
    console.error('Error:', error.message);
    console.error();

    if (error.message.includes('gpiozero')) {
      console.error('Solution: Install gpiozero library:');
      console.error('  pip3 install gpiozero --break-system-packages');
    } else if (error.message.includes('GPIO')) {
      console.error('Solution: Check IR receiver connection on GPIO 20');
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
