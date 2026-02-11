import { unsafeCSS } from 'lit';
import { BaseCard } from '../shared/base-card.js';
import styles from './vibration-card.scss?inline';
import { render } from './vibration-card.view.js';

export class VibrationCard extends BaseCard {
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

  isVibrating() {
    return (this.data?.vibrating ?? 0) === 1;
  }

  onToggle() {
    const newValue = this.isVibrating() ? 0 : 1;
    this.dispatchEvent(new CustomEvent('component-write', {
      bubbles: true,
      composed: true,
      detail: {
        componentId: this.component?.id,
        data: { vibrating: newValue }
      }
    }));
  }

  render() {
    return render(this);
  }
}

customElements.define('vibration-card', VibrationCard);
