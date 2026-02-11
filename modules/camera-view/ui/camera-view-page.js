import { unsafeCSS } from 'lit';
import { io } from 'socket.io-client';
import { BaseModulePage } from '../../../web/src/components/shared/base-module-page.js';
import { render } from './camera-view-page.view.js';
import styles from './camera-view-page.scss?inline';

export class CameraViewPage extends BaseModulePage {
  static styles = unsafeCSS(styles);

  static properties = {
    ...BaseModulePage.properties,
    streamError: { type: Boolean },
    processors: { type: Array },
    lastDetection: { type: Object }
  };

  constructor() {
    super();
    this.streamError = false;
    this.processors = [];
    this.lastDetection = null;
    this._socket = null;
    this._retryTimer = null;
    this._detectionTimer = null;
    this._streamCacheBust = Date.now();
  }

  connectedCallback() {
    super.connectedCallback();
    this._connectSocket();
    this._fetchProcessors();
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    clearTimeout(this._retryTimer);
    clearTimeout(this._detectionTimer);
    if (this._socket) {
      this._socket.off('camera:detection');
      this._socket.disconnect();
      this._socket = null;
    }
  }

  _connectSocket() {
    this._socket = io(window.location.origin, {
      transports: ['websocket'],
      reconnection: true,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 30000
    });

    this._socket.on('camera:detection', (data) => {
      this.lastDetection = data;
      clearTimeout(this._detectionTimer);
      this._detectionTimer = setTimeout(() => {
        this.lastDetection = null;
      }, 2000);
    });
  }

  _fetchProcessors() {
    this.dispatchEvent(new CustomEvent('camera-control', {
      bubbles: true,
      composed: true,
      detail: {
        action: 'get_processors',
        params: {},
        callback: (result) => {
          if (result?.processors) {
            this.processors = result.processors.map(p => ({
              name: p.name,
              description: p.name.replace(/_/g, ' '),
              enabled: p.enabled || false
            }));
          }
        }
      }
    }));
  }

  get streamUrl() {
    return `/api/camera/stream?t=${this._streamCacheBust}`;
  }

  onStreamError() {
    this.streamError = true;
    clearTimeout(this._retryTimer);
    this._retryTimer = setTimeout(() => {
      this._streamCacheBust = Date.now();
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
            this.processors = this.processors.map(p =>
              p.name === name ? { ...p, enabled: !currentlyEnabled } : p
            );
          }
        }
      }
    }));
  }

  render() {
    return render(this);
  }
}

customElements.define('camera-view-page', CameraViewPage);
