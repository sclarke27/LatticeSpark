import { unsafeCSS } from 'lit';
import { BaseCard } from '../shared/base-card.js';
import styles from './relay-card.scss?inline';
import { render } from './relay-card.view.js';

export class RelayCard extends BaseCard {
  static properties = {
    component: { type: Object },
    data: { type: Object }
  };

  static styles = unsafeCSS(styles);

  constructor() {
    super();
    this.component = null;
    this.data = null;
  }

  isActive() {
    return (this.data?.active ?? 0) === 1;
  }

  onToggle() {
    const newValue = this.isActive() ? 0 : 1;
    this.dispatchEvent(new CustomEvent('component-write', {
      bubbles: true,
      composed: true,
      detail: {
        componentId: this.component?.id,
        data: { active: newValue }
      }
    }));
  }

  render() {
    return render(this);
  }
}

customElements.define('relay-card', RelayCard);
