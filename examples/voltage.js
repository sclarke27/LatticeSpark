#!/usr/bin/env node
/**
 * Voltage Sensor Example
 *
 * Demonstrates reading the voltage sensor via SPI ADC
 * using the CrowPi3 framework.
 *
 * This example shows:
 * 1. Reading voltage value
 * 2. Continuous monitoring
 *
 * NOTE: SPI CE1 is broken on Pi 5 (RP1 chip).
 * This sensor is disabled by default.
 *
 * Usage:
 *   node examples/voltage.js
 *
 * Requirements:
 * - ADC on SPI(0,1), channel 6
 * - spidev library installed
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
  console.log('CrowPi3 Framework - Voltage Sensor Example');
  console.log('='.repeat(60));
  console.log('');
  console.log('NOTE: SPI CE1 is broken on Pi 5.');
  console.log('This example may not work on Pi 5 hardware.');
  console.log('');

  let coordinator = null;

  try {
    // Step 1: Create coordinator
    console.log('1. Creating coordinator...');
    const configFile = join(__dirname, '..', 'config', 'components.json');
    coordinator = await createSensorCoordinator({ configFile });
    console.log('   Coordinator ready');
    console.log('');

    // Step 2: Read voltage
    console.log('2. Reading voltage...');
    const reading = await coordinator.read('voltage_sensor');
    console.log(`   Voltage: ${reading.voltage}V`);
    console.log('');

    // Step 3: Continuous monitoring (5 readings)
    console.log('3. Continuous monitoring (5 readings)...');
    for (let i = 0; i < 5; i++) {
      const data = await coordinator.read('voltage_sensor');
      console.log(`   Reading ${i + 1}: ${data.voltage}V`);
      await sleep(1000);
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
