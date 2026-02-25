import { expect } from '@open-wc/testing';
import { themes, getThemeList } from '../../src/components/latticespark-dashboard/theme-registry.js';

describe('theme-registry', () => {
  describe('themes', () => {
    it('contains at least 3 themes', () => {
      const keys = Object.keys(themes);
      expect(keys.length).to.be.at.least(3);
    });

    it('includes default, commodore, and gameboy themes', () => {
      expect(themes).to.have.property('default');
      expect(themes).to.have.property('commodore');
      expect(themes).to.have.property('gameboy');
    });

    it('every theme has a label string', () => {
      for (const [key, theme] of Object.entries(themes)) {
        expect(theme.label, `theme "${key}" missing label`).to.be.a('string').that.is.not.empty;
      }
    });
  });

  describe('getThemeList()', () => {
    it('returns an array of { value, label } objects', () => {
      const list = getThemeList();
      expect(list).to.be.an('array');
      for (const item of list) {
        expect(item).to.have.property('value').that.is.a('string');
        expect(item).to.have.property('label').that.is.a('string');
      }
    });

    it('has the same count as themes object', () => {
      expect(getThemeList().length).to.equal(Object.keys(themes).length);
    });

    it('value matches the themes object key', () => {
      const list = getThemeList();
      const keys = Object.keys(themes);
      for (const item of list) {
        expect(keys).to.include(item.value);
        expect(item.label).to.equal(themes[item.value].label);
      }
    });
  });
});
