// Theme configuration registry.
// Each theme defines chrome layout data used by the universal template.
// Adding a new theme: add an entry here + token SCSS + chrome SCSS.

export const themes = {
  default: {
    label: 'Default',
  },
  light: {
    label: 'Light',
  },
  commodore: {
    label: 'Commodore',
    brandTitle: 'CrowPi3 Control Console',
    modelBadge: 'MODEL III',
    leds: ['PWR', 'LINK', 'ERR'],
    showClock: true,
    bezelStrip: true,
    bottomLeft: 'CrowPi3 \u00B7 Elecrow Industries',
    bottomRight: 'Control Console Edition',
    vents: 5,
  },
  gameboy: {
    label: 'Game Boy',
    brandDot: '\u25CF',
    brandTitle: 'CrowPi3',
    brandSub: 'SENSOR SYSTEM',
    powerLed: true,
    showClock: true,
    bezelStrip: true,
    bottomLeft: 'CrowPi3 \u00B7 Elecrow',
    bottomRight: 'GAME BOY EDITION',
  }
};

export function getThemeList() {
  return Object.entries(themes).map(([value, { label }]) => ({ value, label }));
}
