import { expect } from '@open-wc/testing';
import {
  TIME_RANGES,
  MAX_DISPLAY_POINTS,
  getRangeById,
  downsample
} from '../../src/components/sensor-card/time-ranges.js';

describe('time-ranges', () => {
  describe('downsample()', () => {
    it('returns the same array untouched when at or under maxPoints', () => {
      const points = Array.from({ length: 10 }, (_, i) => ({ x: i, y: i }));
      expect(downsample(points, 10)).to.equal(points);
      expect(downsample(points, 100)).to.equal(points);
    });

    it('returns exactly maxPoints entries when over', () => {
      const points = Array.from({ length: 1000 }, (_, i) => ({ x: i, y: i }));
      expect(downsample(points, 100)).to.have.lengthOf(100);
    });

    it('always includes the input last point', () => {
      const points = Array.from({ length: 777 }, (_, i) => ({ x: i, y: i }));
      const out = downsample(points, 50);
      expect(out[out.length - 1]).to.equal(points[points.length - 1]);
    });

    it('preserves ascending x order', () => {
      const points = Array.from({ length: 1234 }, (_, i) => ({ x: i, y: i }));
      const out = downsample(points, 200);
      for (let i = 1; i < out.length; i++) {
        expect(out[i].x).to.be.greaterThan(out[i - 1].x);
      }
    });

    it('defaults maxPoints to MAX_DISPLAY_POINTS', () => {
      const points = Array.from({ length: MAX_DISPLAY_POINTS * 3 }, (_, i) => ({ x: i, y: i }));
      expect(downsample(points)).to.have.lengthOf(MAX_DISPLAY_POINTS);
    });
  });

  describe('getRangeById()', () => {
    it('returns the matching range', () => {
      expect(getRangeById('30m').seconds).to.equal(1800);
    });

    it('falls back to the first range for unknown ids', () => {
      expect(getRangeById('nope')).to.equal(TIME_RANGES[0]);
    });
  });
});
