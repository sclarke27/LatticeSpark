import { unsafeCSS } from 'lit';
import { BaseCard } from '../shared/base-card.js';
import styles from './pixelstrip-card.scss?inline';
import { render } from './pixelstrip-card.view.js';

export class PixelstripCard extends BaseCard {
  static properties = {
    component: { type: Object },
    data: { type: Object },
    _selectedLed: { type: Number, state: true }
  };

  static styles = unsafeCSS(styles);

  constructor() {
    super();
    this.component = null;
    this.data = null;
    this._selectedLed = -1;
  }

  get numLeds() {
    return this.component?.config?.numLeds || 6;
  }

  getLedColor(index) {
    if (!this.data) return { r: 0, g: 0, b: 0 };
    return {
      r: this.data[`led_${index}_r`] || 0,
      g: this.data[`led_${index}_g`] || 0,
      b: this.data[`led_${index}_b`] || 0
    };
  }

  getLedCssColor(index) {
    const { r, g, b } = this.getLedColor(index);
    return `rgb(${r}, ${g}, ${b})`;
  }

  getLedHexColor(index) {
    const { r, g, b } = this.getLedColor(index);
    return '#' + [r, g, b].map(v => v.toString(16).padStart(2, '0')).join('');
  }

  getBrightness() {
    return this.data?.brightness ?? 255;
  }

  onLedClick(index, e) {
    this._selectedLed = index;
    const input = this.shadowRoot.querySelector('#color-picker');
    if (input) {
      // Position picker at the clicked LED circle
      const rect = e.currentTarget.getBoundingClientRect();
      const hostRect = this.getBoundingClientRect();
      input.style.left = `${rect.left - hostRect.left}px`;
      input.style.top = `${rect.bottom - hostRect.top + 4}px`;

      input.value = this.getLedHexColor(index);
      input.click();
    }
  }

  onColorInput(e) {
    if (this._selectedLed < 0) return;
    const hex = e.target.value;
    const r = parseInt(hex.slice(1, 3), 16);
    const g = parseInt(hex.slice(3, 5), 16);
    const b = parseInt(hex.slice(5, 7), 16);

    this.dispatchEvent(new CustomEvent('component-write', {
      bubbles: true,
      composed: true,
      detail: {
        componentId: this.component?.id,
        data: { led: this._selectedLed, r, g, b }
      }
    }));
  }

  onBrightnessChange(e) {
    const brightness = parseInt(e.target.value, 10);
    this.dispatchEvent(new CustomEvent('component-write', {
      bubbles: true,
      composed: true,
      detail: {
        componentId: this.component?.id,
        data: { brightness }
      }
    }));
  }

  render() {
    return render(this);
  }
}

customElements.define('pixelstrip-card', PixelstripCard);
