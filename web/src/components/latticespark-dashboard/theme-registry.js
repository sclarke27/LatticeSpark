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
    brandTitle: 'LatticeSpark Control Console',
    modelBadge: 'MODEL III',
    leds: ['PWR', 'LINK', 'ERR'],
    showClock: true,
    bezelStrip: true,
    bottomLeft: 'LatticeSpark \u00B7 Elecrow Industries',
    bottomRight: 'Control Console Edition',
    vents: 5,
  },
  gameboy: {
    label: 'Game Boy',
    brandDot: '\u25CF',
    brandTitle: 'LatticeSpark',
    brandSub: 'SENSOR SYSTEM',
    powerLed: true,
    showClock: true,
    bezelStrip: true,
    bottomLeft: 'LatticeSpark \u00B7 Elecrow',
    bottomRight: 'GAME BOY EDITION',
  },
  snes: {
    label: 'SNES',
    brandTitle: 'LatticeSpark',
    modelBadge: 'SUPER',
    powerLed: true,
    showClock: true,
    bezelStrip: true,
    bottomLeft: 'LatticeSpark \u00B7 Elecrow',
    bottomRight: '\u2605 SUPER EDITION \u2605',
  }
};

export function getThemeList() {
  return Object.entries(themes).map(([value, { label }]) => ({ value, label }));
}
