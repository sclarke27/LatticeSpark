import { LitElement } from 'lit';

/**
 * Base class for all dashboard cards.
 * Provides shared timestamp formatting utilities.
 */
export class BaseCard extends LitElement {
  formatTimestamp(timestamp) {
    if (!timestamp) return '';
    const date = new Date(timestamp * 1000);
    return date.toLocaleTimeString();
  }

  getDataAge(timestamp) {
    if (!timestamp) return null;
    return Math.floor(Date.now() / 1000 - timestamp);
  }

  formatDataAge(timestamp) {
    const age = this.getDataAge(timestamp);
    if (age === null) return '';
    if (age < 5) return 'just now';
    if (age < 60) return `${age}s ago`;
    if (age < 3600) return `${Math.floor(age / 60)}m ${age % 60}s ago`;
    return `${Math.floor(age / 3600)}h ago`;
  }

  getDataFreshness(timestamp) {
    const age = this.getDataAge(timestamp);
    if (age === null) return 'unknown';
    if (age < 10) return 'fresh';
    if (age < 30) return 'stale';
    return 'old';
  }
}
