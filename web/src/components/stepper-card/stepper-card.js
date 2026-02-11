import { unsafeCSS } from 'lit';
import { BaseCard } from '../shared/base-card.js';
import styles from './stepper-card.scss?inline';
import { render } from './stepper-card.view.js';

export class StepperCard extends BaseCard {
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

  getDegrees() {
    return this.data?.degrees ?? 0;
  }

  isStepping() {
    return this.data?.stepping === 1;
  }

  getDirection() {
    const dir = this.data?.direction ?? 0;
    if (dir === 1) return 'CW';
    if (dir === -1) return 'CCW';
    return 'Stopped';
  }

  onPreset(degrees) {
    this.dispatchEvent(new CustomEvent('component-write', {
      bubbles: true,
      composed: true,
      detail: {
        componentId: this.component?.id,
        data: { degrees }
      }
    }));
  }

  onHome() {
    this.dispatchEvent(new CustomEvent('component-write', {
      bubbles: true,
      composed: true,
      detail: {
        componentId: this.component?.id,
        data: { home: 1 }
      }
    }));
  }

  onStop() {
    this.dispatchEvent(new CustomEvent('component-write', {
      bubbles: true,
      composed: true,
      detail: {
        componentId: this.component?.id,
        data: { stop: 1 }
      }
    }));
  }

  render() {
    return render(this);
  }
}

customElements.define('stepper-card', StepperCard);
