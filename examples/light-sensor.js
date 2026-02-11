#!/usr/bin/env node
/**
 * Light Sensor Example
 *
 * Demonstrates ambient light reading using the CrowPi3 framework.
 * Uses BH1750 I2C ambient light sensor.
 *
 * This example shows:
 * 1. Loading configuration from JSON file
 * 2. Initializing the coordinator
 * 3. Reading light intensity in lux
 * 4. Handling events
 * 5. Proper cleanup
 *
 * Usage:
 *   node examples/light-sensor.js
 *
 * Requirements:
 * - BH1750 sensor on I2C bus (address 0x5c)
 * - smbus2 library installed
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
  console.log('CrowPi3 Framework - Light Sensor Example');
  console.log('='.repeat(60));
  console.log('');

  let coordinator = null;

  try {
    // Step 1: Create coordinator with config file
    console.log('1. Creating coordinator...');
    const configFile = join(__dirname, '..', 'config', 'components.json');
    console.log(`   Config file: ${configFile}`);

    coordinator = await createSensorCoordinator({ configFile });
    console.log('   ✓ Coordinator ready');
    console.log('');

    // Step 2: List registered components
    console.log('2. Registered components:');
    const components = coordinator.getComponents();
    for (const component of components) {
      console.log(`   - ${component.id} (${component.type})`);
    }
    console.log('');

    // Step 3: Setup event listeners
    console.log('3. Setting up event listeners...');

    coordinator.on('component:data', (event) => {
      console.log(`   [EVENT] Data from ${event.componentId}:`, event.data);
    });

    coordinator.on('component:error', (event) => {
      console.error(`   [EVENT] Error from ${event.componentId}:`, event.error.message);
    });

    console.log('   ✓ Event listeners ready');
    console.log('');

    // Step 4: Read from light sensor
    console.log('4. Reading light sensor...');
    console.log('   (This may take a moment)');
    console.log('');

    const reading = await coordinator.read('light_sensor');

    console.log('   ✓ Reading successful!');
    console.log('');
    console.log('   Light:     ' + reading.light + ' lx');
    console.log('   Timestamp: ' + new Date(reading.timestamp * 1000).toISOString());
    console.log('');

    // Step 5: Read multiple times to show consistency
    console.log('5. Reading 5 more times (1 second apart)...');
    console.log('');

    for (let i = 1; i <= 5; i++) {
      // Wait 1 second between reads
      await new Promise(resolve => setTimeout(resolve, 1000));

      const reading = await coordinator.read('light_sensor');
      console.log(`   Reading ${i}: ${reading.light} lx`);
    }
    console.log('');

    console.log('='.repeat(60));
    console.log('Example completed successfully! ✓');
    console.log('='.repeat(60));

  } catch (error) {
    console.error();
    console.error('Error:', error.message);
    console.error();

    if (error.message.includes('smbus') || error.message.includes('SMBus')) {
      console.error('Solution: Install smbus2 library:');
      console.error('  pip3 install smbus2 --break-system-packages');
    } else if (error.message.includes('not responding') || error.message.includes('I2C')) {
      console.error('Solution: Check sensor connection on I2C bus (address 0x5c)');
      console.error('  Run: i2cdetect -y 1');
    }

    console.error();
    process.exit(1);

  } finally {
    // Step 6: Cleanup
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
