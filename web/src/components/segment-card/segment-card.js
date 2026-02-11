import { unsafeCSS } from 'lit';
import { BaseCard } from '../shared/base-card.js';
import styles from './segment-card.scss?inline';
import { render } from './segment-card.view.js';

export class SegmentCard extends BaseCard {
  static properties = {
    component: { type: Object },
    data: { type: Object },
    _textInput: { type: String, state: true }
  };

  static styles = unsafeCSS(styles);

  constructor() {
    super();
    this.component = null;
    this.data = null;
    this._textInput = '';
    this._initialSynced = false;
  }

  getText() {
    return this.data?.text ?? '    ';
  }

  getColon() {
    return this.data?.colon ?? 0;
  }

  getDigits() {
    // Parse text into [{char, decimal}] handling '.' as decimal on prior digit
    const text = this.getText();
    const digits = [];
    let i = 0;
    while (i < text.length && digits.length < 4) {
      const ch = text[i];
      if (ch === '.') {
        if (digits.length > 0) {
          digits[digits.length - 1].decimal = true;
        } else {
          digits.push({ char: ' ', decimal: true });
        }
        i++;
        continue;
      }
      const hasDecimal = i + 1 < text.length && text[i + 1] === '.';
      digits.push({ char: ch, decimal: hasDecimal });
      i += hasDecimal ? 2 : 1;
    }
    while (digits.length < 4) {
      digits.push({ char: ' ', decimal: false });
    }
    return digits;
  }

  onTextInput(e) {
    // Allow digits, spaces, and dots
    this._textInput = e.target.value.replace(/[^0-9. ]/g, '').slice(0, 8);
  }

  onSend() {
    this.dispatchEvent(new CustomEvent('component-write', {
      bubbles: true,
      composed: true,
      detail: {
        componentId: this.component?.id,
        data: {
          text: this._textInput
        }
      }
    }));
  }

  onColonToggle() {
    const newValue = this.getColon() ? 0 : 1;
    this.dispatchEvent(new CustomEvent('component-write', {
      bubbles: true,
      composed: true,
      detail: {
        componentId: this.component?.id,
        data: { colon: newValue }
      }
    }));
  }

  updated(changedProperties) {
    if (changedProperties.has('data') && this.data && !this._initialSynced) {
      this._textInput = this.getText().trim();
      this._initialSynced = true;
    }
  }

  render() {
    return render(this);
  }
}

customElements.define('segment-card', SegmentCard);
