import { unsafeCSS } from 'lit';
import { BaseCard } from '../shared/base-card.js';
import styles from './buzzer-card.scss?inline';
import { render } from './buzzer-card.view.js';

export class BuzzerCard extends BaseCard {
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

  isBuzzing() {
    return (this.data?.buzzing ?? 0) === 1;
  }

  onToggle() {
    const newValue = this.isBuzzing() ? 0 : 1;
    this.dispatchEvent(new CustomEvent('component-write', {
      bubbles: true,
      composed: true,
      detail: {
        componentId: this.component?.id,
        data: { buzzing: newValue }
      }
    }));
  }

  render() {
    return render(this);
  }
}

customElements.define('buzzer-card', BuzzerCard);
