import { expect } from '@open-wc/testing';
import { BaseCard } from '../../src/components/shared/base-card.js';

// Register the element so we can create instances
if (!customElements.get('test-base-card')) {
  customElements.define('test-base-card', class extends BaseCard {});
}

describe('BaseCard', () => {
  let card;

  beforeEach(() => {
    card = document.createElement('test-base-card');
  });

  describe('formatTimestamp()', () => {
    it('returns empty string for null/undefined', () => {
      expect(card.formatTimestamp(null)).to.equal('');
      expect(card.formatTimestamp(undefined)).to.equal('');
      expect(card.formatTimestamp(0)).to.equal('');
    });

    it('converts Unix timestamp to locale time string', () => {
      // 2024-01-15T12:00:00Z
      const ts = 1705320000;
      const result = card.formatTimestamp(ts);
      // Should be a non-empty time string
      expect(result).to.be.a('string').that.is.not.empty;
      // Should contain typical time separators
      expect(result).to.match(/\d/);
    });
  });

  describe('getDataAge()', () => {
    it('returns null for null/undefined timestamp', () => {
      expect(card.getDataAge(null)).to.be.null;
      expect(card.getDataAge(undefined)).to.be.null;
    });

    it('returns age in seconds for valid timestamp', () => {
      const nowSec = Date.now() / 1000;
      const age = card.getDataAge(nowSec - 30);
      // Should be approximately 30 seconds
      expect(age).to.be.at.least(29);
      expect(age).to.be.at.most(31);
    });

    it('returns 0 for current timestamp', () => {
      const nowSec = Date.now() / 1000;
      const age = card.getDataAge(nowSec);
      expect(age).to.be.at.most(1);
    });
  });

  describe('formatDataAge()', () => {
    it('returns empty string for null timestamp', () => {
      expect(card.formatDataAge(null)).to.equal('');
    });

    it('returns "just now" for recent data', () => {
      const nowSec = Date.now() / 1000;
      expect(card.formatDataAge(nowSec)).to.equal('just now');
    });

    it('returns seconds format for data < 60s old', () => {
      const nowSec = Date.now() / 1000 - 15;
      const result = card.formatDataAge(nowSec);
      expect(result).to.match(/\d+s ago/);
    });

    it('returns minutes format for data >= 60s old', () => {
      const nowSec = Date.now() / 1000 - 150;
      const result = card.formatDataAge(nowSec);
      expect(result).to.match(/\d+m \d+s ago/);
    });

    it('returns hours format for data >= 3600s old', () => {
      const nowSec = Date.now() / 1000 - 7200;
      const result = card.formatDataAge(nowSec);
      expect(result).to.match(/\d+h ago/);
    });
  });

  describe('getDataFreshness()', () => {
    it('returns "unknown" for null timestamp', () => {
      expect(card.getDataFreshness(null)).to.equal('unknown');
    });

    it('returns "fresh" for data < 10s old', () => {
      const nowSec = Date.now() / 1000;
      expect(card.getDataFreshness(nowSec)).to.equal('fresh');
    });

    it('returns "stale" for data 10-30s old', () => {
      const nowSec = Date.now() / 1000 - 15;
      expect(card.getDataFreshness(nowSec)).to.equal('stale');
    });

    it('returns "old" for data > 30s old', () => {
      const nowSec = Date.now() / 1000 - 60;
      expect(card.getDataFreshness(nowSec)).to.equal('old');
    });
  });
});
