import { unsafeCSS } from 'lit';
import { BaseCard } from '../shared/base-card.js';
import styles from './lcd-card.scss?inline';
import { render } from './lcd-card.view.js';

export class LcdCard extends BaseCard {
  static properties = {
    component: { type: Object },
    data: { type: Object },
    _line1Input: { type: String, state: true },
    _line2Input: { type: String, state: true }
  };

  static styles = unsafeCSS(styles);

  constructor() {
    super();
    this.component = null;
    this.data = null;
    this._line1Input = '';
    this._line2Input = '';
    this._initialSynced = false;
  }

  get columns() {
    return this.component?.config?.columns || 16;
  }

  getLine1() {
    return this.data?.line1 ?? '';
  }

  getLine2() {
    return this.data?.line2 ?? '';
  }

  getBacklight() {
    return this.data?.backlight ?? 1;
  }

  onLine1Input(e) {
    this._line1Input = e.target.value.slice(0, this.columns);
  }

  onLine2Input(e) {
    this._line2Input = e.target.value.slice(0, this.columns);
  }

  onSend() {
    this.dispatchEvent(new CustomEvent('component-write', {
      bubbles: true,
      composed: true,
      detail: {
        componentId: this.component?.id,
        data: {
          line1: this._line1Input,
          line2: this._line2Input
        }
      }
    }));
  }

  onBacklightToggle() {
    const newValue = this.getBacklight() ? 0 : 1;
    this.dispatchEvent(new CustomEvent('component-write', {
      bubbles: true,
      composed: true,
      detail: {
        componentId: this.component?.id,
        data: { backlight: newValue }
      }
    }));
  }

  updated(changedProperties) {
    super.updated(changedProperties);
    if (changedProperties.has('data') && this.data && !this._initialSynced) {
      this._line1Input = this.getLine1();
      this._line2Input = this.getLine2();
      this._initialSynced = true;
    }
  }

  render() {
    return render(this);
  }
}

customElements.define('lcd-card', LcdCard);
