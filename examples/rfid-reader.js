#!/usr/bin/env node
/**
 * RFID Reader Example
 *
 * Demonstrates MFRC522 NFC/RFID card reading using the CrowPi3 framework.
 * Uses SPI-based MFRC522 reader module.
 *
 * This example shows:
 * 1. Loading configuration from JSON file
 * 2. Initializing the coordinator
 * 3. Polling for RFID card presence
 * 4. Displaying card UID
 * 5. Proper cleanup
 *
 * Usage:
 *   node examples/rfid-reader.js
 *
 * Requirements:
 * - MFRC522 module on SPI bus 0
 * - mfrc522 library installed (pip3 install mfrc522)
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
  console.log('CrowPi3 Framework - RFID Reader Example');
  console.log('='.repeat(60));
  console.log('');
  console.log('Hold an RFID/NFC card near the reader.');
  console.log('Press Ctrl+C to exit.');
  console.log('');

  let coordinator = null;

  try {
    // Step 1: Create coordinator with config file
    console.log('1. Creating coordinator...');
    const configFile = join(__dirname, '..', 'config', 'components.json');

    coordinator = await createSensorCoordinator({ configFile });
    console.log('   Coordinator ready');
    console.log('');

    // Step 2: Scan for cards
    console.log('2. Scanning for RFID cards (30 seconds)...');
    console.log('');

    let lastUid = 0;

    for (let i = 0; i < 150; i++) {
      await new Promise(resolve => setTimeout(resolve, 200));

      const reading = await coordinator.read('rfid_reader');

      if (reading.uid !== 0 && reading.uid !== lastUid) {
        const hex = '0x' + reading.uid.toString(16).toUpperCase().padStart(8, '0');
        console.log(`   [RFID] Card detected: ${hex}`);
        lastUid = reading.uid;
      } else if (reading.uid === 0 && lastUid !== 0) {
        console.log('   [RFID] Card removed');
        lastUid = 0;
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

    if (error.message.includes('mfrc522')) {
      console.error('Solution: Install mfrc522 library:');
      console.error('  pip3 install mfrc522 --break-system-packages');
    } else if (error.message.includes('SPI')) {
      console.error('Solution: Enable SPI in raspi-config');
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
