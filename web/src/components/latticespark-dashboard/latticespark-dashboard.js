import { LitElement, unsafeCSS } from 'lit';
import { io } from 'socket.io-client';
import styles from './latticespark-dashboard.scss?inline';
import { render, loadModulePage } from './latticespark-dashboard.view.js';
import '../sensor-card/sensor-card.js';
import '../pixelstrip-card/pixelstrip-card.js';
import '../lcd-card/lcd-card.js';
import '../vibration-card/vibration-card.js';
import '../buttons-card/buttons-card.js';
import '../segment-card/segment-card.js';
import '../buzzer-card/buzzer-card.js';
import '../matrix-card/matrix-card.js';
import '../servo-card/servo-card.js';
import '../stepper-card/stepper-card.js';
import '../relay-card/relay-card.js';
import '../modules-manager/modules-manager.js';

export class LatticeSparkDashboard extends LitElement {
  static properties = {
    components: { type: Array },
    sensorData: { type: Object },
    connected: { type: Boolean },
    reconnecting: { type: Boolean },
    theme: { type: String, reflect: true },
    clockTime: { type: String },
    activeView: { type: String },
    allModules: { type: Array },
    modulePages: { type: Array },
    moduleStates: { type: Object }
  };

  static styles = unsafeCSS(styles);

  constructor() {
    super();
    this.components = [];
    this.sensorData = {};
    this.connected = false;
    this.reconnecting = false;
    this.theme = 'default';
    this.clockTime = '00:00:00';
    this.activeView = 'dashboard';
    this.allModules = [];
    this.modulePages = [];
    this.moduleStates = {};
    this.socket = null;
    this.moduleSocket = null;
    this._apiKey = null;
    this._clockInterval = null;
    this._writeHandler = (e) => {
      if (this.socket?.connected) {
        this.socket.emit('component:write', e.detail);
      }
    };
    this._cameraControlHandler = (e) => {
      if (this.socket?.connected) {
        const { action, params, callback } = e.detail;
        this.socket.emit('camera:control', { action, params }, (result) => {
          callback?.(result);
        });
      }
    };
    this._moduleCommandHandler = (e) => {
      if (this.moduleSocket?.connected) {
        const { callback, ...payload } = e.detail;
        this.moduleSocket.emit('module:command', payload, (result) => {
          callback?.(result);
        });
      } else {
        e.detail.callback?.({ error: 'Not connected to module service' });
      }
    };
    this._moduleActionHandler = async (e) => {
      const { moduleId, action } = e.detail;
      try {
        await fetch(`/api/modules/${moduleId}/${action}`, { method: 'POST' });
      } catch (err) {
        console.error(`[dashboard] Module ${action} failed for ${moduleId}:`, err.message);
      }
    };
    this._moduleNavigateHandler = (e) => {
      const { moduleId } = e.detail;
      loadModulePage(moduleId);
      this.activeView = moduleId;
    };
  }

  connectedCallback() {
    super.connectedCallback();
    const saved = localStorage.getItem('latticespark-theme');
    if (saved) this.setTheme(saved);
    this._fetchConfigAndConnect();
    this.addEventListener('component-write', this._writeHandler);
    this.addEventListener('camera-control', this._cameraControlHandler);
    this.addEventListener('module-command', this._moduleCommandHandler);
    this.addEventListener('module-action', this._moduleActionHandler);
    this.addEventListener('module-navigate', this._moduleNavigateHandler);
    this._startClock();
  }

  async _fetchConfigAndConnect() {
    try {
      const resp = await fetch('/api/config');
      const config = await resp.json();
      this._apiKey = config.apiKey || null;
    } catch {
      // Dev mode or config unavailable — connect without auth
      this._apiKey = null;
    }
    this.connectSocket();
    this.connectModuleSocket();
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    this._stopClock();
    this.removeEventListener('component-write', this._writeHandler);
    this.removeEventListener('camera-control', this._cameraControlHandler);
    this.removeEventListener('module-command', this._moduleCommandHandler);
    this.removeEventListener('module-action', this._moduleActionHandler);
    this.removeEventListener('module-navigate', this._moduleNavigateHandler);
    if (this.socket) {
      this.socket.off('connect');
      this.socket.off('disconnect');
      this.socket.off('reconnect_attempt');
      this.socket.off('components');
      this.socket.off('sensor:batch');
      this.socket.off('sensor:error');
      this.socket.off('error');
      this.socket.disconnect();
      this.socket = null;
    }
    if (this.moduleSocket) {
      this.moduleSocket.off('modules');
      this.moduleSocket.off('module:state');
      this.moduleSocket.off('module:status');
      this.moduleSocket.disconnect();
      this.moduleSocket = null;
    }
  }

  setTheme(name) {
    this.theme = name;
    if (name === 'default') {
      delete document.documentElement.dataset.theme;
    } else {
      document.documentElement.dataset.theme = name;
    }
    localStorage.setItem('latticespark-theme', name);
  }

  _startClock() {
    this._updateClock();
    this._clockInterval = setInterval(() => this._updateClock(), 1000);
  }

  _stopClock() {
    if (this._clockInterval) {
      clearInterval(this._clockInterval);
      this._clockInterval = null;
    }
  }

  _updateClock() {
    this.clockTime = new Date().toTimeString().split(' ')[0];
  }

  connectSocket() {
    const socketUrl = window.location.origin;
    this.socket = io(socketUrl, {
      transports: ['websocket'],
      reconnection: true,
      reconnectionAttempts: Infinity,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 30000,
      ...(this._apiKey ? { auth: { apiKey: this._apiKey } } : {})
    });

    this.socket.on('connect', () => {
      console.log('Connected to server');
      this.connected = true;
      this.reconnecting = false;
    });

    this.socket.on('disconnect', () => {
      console.log('Disconnected from server');
      this.connected = false;
    });

    this.socket.on('reconnect_attempt', (attempt) => {
      console.log(`Reconnection attempt ${attempt}`);
      this.reconnecting = true;
    });

    this.socket.on('components', (components) => {
      this.components = components;
      // Prune stale entries from sensorData
      const validIds = new Set(components.map(c => c.id));
      const pruned = {};
      for (const id of Object.keys(this.sensorData)) {
        if (validIds.has(id)) pruned[id] = this.sensorData[id];
      }
      this.sensorData = pruned;
    });

    this.socket.on('sensor:batch', (batch) => {
      // Only accept data for known components to prevent stale re-adds
      const validIds = new Set(this.components.map(c => c.id));
      const filtered = {};
      for (const [id, data] of Object.entries(batch)) {
        if (validIds.has(id)) filtered[id] = data;
      }
      if (Object.keys(filtered).length > 0) {
        this.sensorData = { ...this.sensorData, ...filtered };
      }
    });

    this.socket.on('sensor:error', ({ componentId, error }) => {
      console.error('Sensor error:', componentId, error);
    });

    this.socket.on('error', ({ message }) => {
      console.error('Server error:', message);
    });
  }

  connectModuleSocket() {
    const socketUrl = window.location.origin;
    this.moduleSocket = io(socketUrl, {
      path: '/modules-io',
      transports: ['websocket'],
      reconnection: true,
      reconnectionAttempts: Infinity,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 30000,
      ...(this._apiKey ? { auth: { apiKey: this._apiKey } } : {})
    });

    this.moduleSocket.on('modules', (modules) => {
      this.allModules = modules;
      this.modulePages = modules.filter(m => m.ui?.page);
    });

    this.moduleSocket.on('module:state', ({ moduleId, state }) => {
      this.moduleStates = { ...this.moduleStates, [moduleId]: state };
    });

    this.moduleSocket.on('module:status', ({ moduleId, status, lastError }) => {
      this.allModules = this.allModules.map(m =>
        m.id === moduleId ? { ...m, status, lastError } : m
      );
      this.modulePages = this.modulePages.map(m =>
        m.id === moduleId ? { ...m, status } : m
      );
    });
  }

  render() {
    return render(this);
  }
}

customElements.define('latticespark-dashboard', LatticeSparkDashboard);
