#!/usr/bin/env node
/**
 * Ultrasonic Distance Sensor Example
 *
 * Demonstrates end-to-end distance sensor reading using the LatticeSpark framework.
 * Uses HC-SR04 style ultrasonic distance sensor.
 *
 * This example shows:
 * 1. Loading configuration from JSON file
 * 2. Initializing the coordinator
 * 3. Reading distance data
 * 4. Handling events
 * 5. Proper cleanup
 *
 * Usage:
 *   node examples/distance-sensor.js
 *
 * Requirements:
 * - Ultrasonic sensor on GPIO (TRIG: GPIO27, ECHO: GPIO25)
 * - RPi.GPIO library installed
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
  console.log('LatticeSpark Framework - Distance Sensor Example');
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

    // Step 4: Read from distance sensor
    console.log('4. Reading distance sensor...');
    console.log('   (This may take a moment)');
    console.log('');

    const reading = await coordinator.read('distance_sensor');

    console.log('   ✓ Reading successful!');
    console.log('');
    console.log('   Distance: ' + reading.distance + ' cm');
    console.log('   Timestamp: ' + new Date(reading.timestamp * 1000).toISOString());
    console.log('');

    // Step 5: Read multiple times to show consistency
    console.log('5. Reading 10 times (500ms apart)...');
    console.log('   Move your hand closer/farther to see changes!');
    console.log('');

    for (let i = 1; i <= 10; i++) {
      // Wait 500ms between reads
      await new Promise(resolve => setTimeout(resolve, 500));

      const reading = await coordinator.read('distance_sensor');
      console.log(`   Reading ${i}: ${reading.distance} cm`);
    }

    console.log('');
    console.log('='.repeat(60));
    console.log('Example completed successfully! ✓');
    console.log('='.repeat(60));

  } catch (error) {
    console.error('');
    console.error('Error:', error.message);
    console.error('');

    if (error.message.includes('RPi.GPIO')) {
      console.error('Solution: Install RPi.GPIO library:');
      console.error('  pip3 install RPi.GPIO --break-system-packages');
    } else if (error.message.includes('not responding') || error.message.includes('GPIO')) {
      console.error('Solution: Check ultrasonic sensor connection');
      console.error('  TRIG: GPIO27');
      console.error('  ECHO: GPIO25');
    }

    console.error('');
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
