import { unsafeCSS } from 'lit';
import { BaseCard } from '../shared/base-card.js';
import styles from './servo-card.scss?inline';
import { render } from './servo-card.view.js';

export class ServoCard extends BaseCard {
  static properties = {
    component: { type: Object },
    data: { type: Object }
  };

  static styles = unsafeCSS(styles);

  constructor() {
    super();
    this.component = null;
    this.data = null;
    this._lastWriteTime = 0;
    this._pendingWrite = null;
    this._dragging = false;
    this._dragAngle = 90;
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    if (this._pendingWrite) {
      clearTimeout(this._pendingWrite);
      this._pendingWrite = null;
    }
  }

  getAngle() {
    if (this._dragging) return this._dragAngle;
    return this.data?.angle ?? 90;
  }

  onAngleInput(e) {
    const angle = parseInt(e.target.value, 10);
    this._dragging = true;
    this._dragAngle = angle;
    this.requestUpdate();
    this._throttledWrite(angle);
  }

  onAngleChange(e) {
    const angle = parseInt(e.target.value, 10);
    this._dragging = false;
    // Flush final position immediately
    clearTimeout(this._pendingWrite);
    this._pendingWrite = null;
    this._sendWrite(angle);
  }

  _throttledWrite(angle) {
    const now = Date.now();
    const elapsed = now - this._lastWriteTime;
    const THROTTLE_MS = 150;

    if (elapsed >= THROTTLE_MS) {
      this._lastWriteTime = now;
      clearTimeout(this._pendingWrite);
      this._pendingWrite = null;
      this._sendWrite(angle);
    } else if (!this._pendingWrite) {
      this._pendingWrite = setTimeout(() => {
        this._pendingWrite = null;
        this._lastWriteTime = Date.now();
        this._sendWrite(angle);
      }, THROTTLE_MS - elapsed);
    }
  }

  _sendWrite(angle) {
    this.dispatchEvent(new CustomEvent('component-write', {
      bubbles: true,
      composed: true,
      detail: {
        componentId: this.component?.id,
        data: { angle }
      }
    }));
  }

  onPreset(angle) {
    this.dispatchEvent(new CustomEvent('component-write', {
      bubbles: true,
      composed: true,
      detail: {
        componentId: this.component?.id,
        data: { angle }
      }
    }));
  }

  render() {
    return render(this);
  }
}

customElements.define('servo-card', ServoCard);
