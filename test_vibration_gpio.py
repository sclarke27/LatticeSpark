#!/usr/bin/env python3
"""
Diagnostic script for vibration motor GPIO on LatticeSpark/Pi 5.
Run directly on the Pi: python3 test_vibration_gpio.py
"""

import time
import os
import glob

PIN = 27

print("=== GPIO Diagnostic for Vibration Motor ===\n")

# 1. List available GPIO chips
print("1. Available GPIO chips:")
chips = sorted(glob.glob("/dev/gpiochip*"))
for chip in chips:
    print(f"   {chip}")
print()

# 2. Try lgpio on each chip
print("2. Testing lgpio on each chip...")
try:
    import lgpio
    for chip_path in chips:
        chip_num = int(chip_path.replace("/dev/gpiochip", ""))
        try:
            h = lgpio.gpiochip_open(chip_num)
            info = lgpio.gpio_get_chip_info(h)
            print(f"   gpiochip{chip_num}: opened OK - {info}")

            try:
                lgpio.gpio_claim_output(h, PIN, 0)
                print(f"   gpiochip{chip_num}: claimed GPIO{PIN} as output OK")

                print(f"   gpiochip{chip_num}: writing HIGH to GPIO{PIN}...")
                lgpio.gpio_write(h, PIN, 1)
                time.sleep(1)
                print(f"   gpiochip{chip_num}: writing LOW to GPIO{PIN}...")
                lgpio.gpio_write(h, PIN, 0)
                print(f"   >>> Did the motor vibrate for 1 second? <<<")

                lgpio.gpio_free(h, PIN)
            except Exception as e:
                print(f"   gpiochip{chip_num}: GPIO{PIN} claim/write failed: {e}")

            lgpio.gpiochip_close(h)
        except Exception as e:
            print(f"   gpiochip{chip_num}: open failed: {e}")

        print()
        time.sleep(0.5)

except ImportError:
    print("   lgpio not installed!")
    print()

# 3. Try gpiozero OutputDevice
print("3. Testing gpiozero OutputDevice...")
try:
    from gpiozero import OutputDevice
    try:
        motor = OutputDevice(PIN)
        print(f"   Created OutputDevice(pin={PIN}), factory: {motor.pin_factory}")
        print(f"   Pin info: {motor.pin}")
        print(f"   Turning ON...")
        motor.on()
        time.sleep(1)
        print(f"   Turning OFF...")
        motor.off()
        print(f"   >>> Did the motor vibrate for 1 second? <<<")
        motor.close()
    except Exception as e:
        print(f"   OutputDevice failed: {e}")
except ImportError:
    print("   gpiozero not installed!")
print()

# 4. Try gpiozero with explicit LGPIOFactory
print("4. Testing gpiozero OutputDevice with LGPIOFactory...")
try:
    from gpiozero import OutputDevice
    from gpiozero.pins.lgpio import LGPIOFactory
    try:
        factory = LGPIOFactory()
        motor = OutputDevice(PIN, pin_factory=factory)
        print(f"   Created OutputDevice with LGPIOFactory, pin: {motor.pin}")
        print(f"   Turning ON...")
        motor.on()
        time.sleep(1)
        print(f"   Turning OFF...")
        motor.off()
        print(f"   >>> Did the motor vibrate for 1 second? <<<")
        motor.close()
        factory.close()
    except Exception as e:
        print(f"   OutputDevice+LGPIOFactory failed: {e}")
except ImportError as e:
    print(f"   Import failed: {e}")
print()

print("=== Done ===")
