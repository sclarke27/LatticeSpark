#!/usr/bin/env node
/**
 * IMU Sensor Example (Accelerometer + Gyroscope + Magnetometer)
 *
 * Demonstrates end-to-end IMU sensor reading using the CrowPi3 framework.
 * Uses ICM-20948 9-axis inertial measurement unit.
 *
 * This example shows:
 * 1. Loading configuration from JSON file
 * 2. Initializing the coordinator
 * 3. Reading 9-axis motion data
 * 4. Handling events
 * 5. Proper cleanup
 *
 * Usage:
 *   node examples/imu-sensor.js
 *
 * Requirements:
 * - ICM-20948 sensor on I2C bus (address 0x68)
 * - adafruit-circuitpython-icm20x library installed
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
  console.log('CrowPi3 Framework - IMU Sensor Example');
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
      if (event.componentId === 'imu_sensor') {
        const d = event.data;
        console.log(`   [EVENT] IMU: A(${d.accel_x}, ${d.accel_y}, ${d.accel_z}) G(${d.gyro_x}, ${d.gyro_y}, ${d.gyro_z})`);
      }
    });

    coordinator.on('component:error', (event) => {
      console.error(`   [EVENT] Error from ${event.componentId}:`, event.error.message);
    });

    console.log('   ✓ Event listeners ready');
    console.log('');

    // Step 4: Read from IMU sensor
    console.log('4. Reading IMU sensor...');
    console.log('   (This may take a moment)');
    console.log('');

    const reading = await coordinator.read('imu_sensor');

    console.log('   ✓ Reading successful!');
    console.log('');
    console.log('   📊 Accelerometer (m/s²):');
    console.log(`     X: ${reading.accel_x}`);
    console.log(`     Y: ${reading.accel_y}`);
    console.log(`     Z: ${reading.accel_z}`);
    console.log('');
    console.log('   🔄 Gyroscope (°/s):');
    console.log(`     X: ${reading.gyro_x}`);
    console.log(`     Y: ${reading.gyro_y}`);
    console.log(`     Z: ${reading.gyro_z}`);
    console.log('');
    console.log('   🧭 Magnetometer (μT):');
    console.log(`     X: ${reading.mag_x}`);
    console.log(`     Y: ${reading.mag_y}`);
    console.log(`     Z: ${reading.mag_z}`);
    console.log('');
    console.log(`   Timestamp: ${new Date(reading.timestamp * 1000).toISOString()}`);
    console.log('');

    // Step 5: Read multiple times to show real-time motion
    console.log('5. Reading 20 times (100ms apart)...');
    console.log('   Tilt, shake, or rotate the device to see changes!');
    console.log('');

    for (let i = 1; i <= 20; i++) {
      // Wait 100ms between reads
      await new Promise(resolve => setTimeout(resolve, 100));

      const r = await coordinator.read('imu_sensor');

      // Format for compact display
      const accel = `A(${r.accel_x.toString().padStart(6)}, ${r.accel_y.toString().padStart(6)}, ${r.accel_z.toString().padStart(6)})`;
      const gyro = `G(${r.gyro_x.toString().padStart(7)}, ${r.gyro_y.toString().padStart(7)}, ${r.gyro_z.toString().padStart(7)})`;

      console.log(`   ${i.toString().padStart(2)}: ${accel} ${gyro}`);
    }

    console.log('');
    console.log('='.repeat(60));
    console.log('Example completed successfully! ✓');
    console.log('='.repeat(60));

  } catch (error) {
    console.error('');
    console.error('Error:', error.message);
    console.error('');

    if (error.message.includes('icm20x') || error.message.includes('ICM')) {
      console.error('Solution: Install icm20x library:');
      console.error('  pip3 install adafruit-circuitpython-icm20x --break-system-packages');
    } else if (error.message.includes('not responding') || error.message.includes('I2C')) {
      console.error('Solution: Check IMU sensor connection on I2C bus (address 0x68)');
      console.error('  Run: i2cdetect -y 1');
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
