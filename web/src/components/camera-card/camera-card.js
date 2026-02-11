import { unsafeCSS } from 'lit';
import { BaseCard } from '../shared/base-card.js';
import styles from './camera-card.scss?inline';
import { render } from './camera-card.view.js';

export class CameraCard extends BaseCard {
  static properties = {
    component: { type: Object },
    data: { type: Object },
    streamError: { type: Boolean },
    processors: { type: Array },
    lastDetection: { type: Object }
  };

  static styles = unsafeCSS(styles);

  constructor() {
    super();
    this.component = null;
    this.data = null;
    this.streamError = false;
    this.processors = [];
    this.lastDetection = null;
    this._retryTimer = null;
    this._detectionTimer = null;
    this._streamCacheBust = Date.now();
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    clearTimeout(this._retryTimer);
    clearTimeout(this._detectionTimer);
    // Stop MJPEG stream by clearing the img src
    const img = this.shadowRoot?.querySelector('img.stream');
    if (img) img.src = '';
  }

  connectedCallback() {
    super.connectedCallback();
    // Load initial processor list from config
    const procs = this.component?.config?.processors;
    if (procs && typeof procs === 'object' && !Array.isArray(procs)) {
      // Config format: { face_detector: { enabled: false }, ... }
      this.processors = Object.entries(procs).map(([name, conf]) => ({
        name,
        description: name.replace(/_/g, ' '),
        enabled: conf.enabled || false
      }));
    }
  }

  get streamUrl() {
    return `/api/camera/stream?t=${this._streamCacheBust}`;
  }

  onStreamError() {
    this.streamError = true;
    // Retry after 3 seconds — camera may not be ready yet
    clearTimeout(this._retryTimer);
    this._retryTimer = setTimeout(() => {
      this._streamCacheBust = Date.now();  // New URL to avoid cached error
      this.streamError = false;
    }, 3000);
  }

  onStreamLoad() {
    this.streamError = false;
    clearTimeout(this._retryTimer);
  }

  onToggleProcessor(name, currentlyEnabled) {
    const action = currentlyEnabled ? 'disable_processor' : 'enable_processor';
    this.dispatchEvent(new CustomEvent('camera-control', {
      bubbles: true,
      composed: true,
      detail: {
        action,
        params: { name },
        callback: (result) => {
          if (result.success || result.status === 'ok') {
            // Update local state
            this.processors = this.processors.map(p =>
              p.name === name ? { ...p, enabled: !currentlyEnabled } : p
            );
          }
        }
      }
    }));
  }

  /** Called by dashboard when camera:detection event arrives. */
  onDetection(data) {
    this.lastDetection = data;
    // Auto-clear after 2s of no new detections
    clearTimeout(this._detectionTimer);
    this._detectionTimer = setTimeout(() => {
      this.lastDetection = null;
    }, 2000);
  }

  render() {
    return render(this);
  }
}

customElements.define('camera-card', CameraCard);
