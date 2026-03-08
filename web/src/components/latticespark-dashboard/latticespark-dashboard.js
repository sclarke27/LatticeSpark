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
    standaloneModules: { type: Array },
    moduleStates: { type: Object },
    spokes: { type: Array },
    moduleBundles: { type: Array },
    firmwareBundles: { type: Array },
    fleetError: { type: String },
    fleetJobs: { type: Object },
    spokeModules: { type: Object },
    localNodeId: { type: String },
    localRole: { type: String }
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
    this.standaloneModules = [];
    this.moduleStates = {};
    this.spokes = [];
    this.moduleBundles = [];
    this.firmwareBundles = [];
    this.fleetError = '';
    this.fleetJobs = {};
    this.spokeModules = {};
    this.localNodeId = 'local';
    this.localRole = 'standalone';
    this.socket = null;
    this.moduleSocket = null;
    this._clockInterval = null;
    this._fleetPollInterval = null;
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
    this._spokeModuleActionHandler = async (e) => {
      const { nodeId, moduleId, action } = e.detail;
      try {
        await fetch(`/api/spokes/${encodeURIComponent(nodeId)}/modules/${encodeURIComponent(moduleId)}/${encodeURIComponent(action)}`, {
          method: 'POST'
        });
        await this.refreshFleetData();
      } catch (err) {
        console.error(`[dashboard] Spoke module action failed (${nodeId}/${moduleId}/${action}):`, err.message);
      }
    };
    this._moduleDeployHandler = async (e) => {
      const { nodeId, bundleId, version } = e.detail;
      try {
        await fetch(`/api/spokes/${encodeURIComponent(nodeId)}/modules/deploy`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ bundleId, version })
        });
        await this.refreshFleetData();
      } catch (err) {
        console.error(`[dashboard] Module deploy failed (${nodeId}):`, err.message);
      }
    };
    this._firmwareDeployHandler = async (e) => {
      const { nodeId, bundleId, version, sourceId } = e.detail;
      try {
        const resp = await fetch(`/api/spokes/${encodeURIComponent(nodeId)}/firmware/deploy`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ bundleId, version, sourceId })
        });
        const payload = await resp.json().catch(() => ({}));
        if (payload?.job?.jobId) {
          this.fleetJobs = { ...this.fleetJobs, [nodeId]: payload.job };
        }
        await this.refreshFleetData();
      } catch (err) {
        console.error(`[dashboard] Firmware deploy failed (${nodeId}):`, err.message);
      }
    };
    this._firmwareRollbackHandler = async (e) => {
      const { nodeId, sourceId } = e.detail;
      try {
        const resp = await fetch(`/api/spokes/${encodeURIComponent(nodeId)}/firmware/rollback`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ sourceId })
        });
        const payload = await resp.json().catch(() => ({}));
        this.fleetJobs = {
          ...this.fleetJobs,
          [nodeId]: {
            ...(this.fleetJobs[nodeId] || {}),
            status: payload?.error ? 'failed' : 'requested',
            detail: payload?.error || 'Rollback requested',
            updatedAt: Date.now()
          }
        };
        await this.refreshFleetData();
      } catch (err) {
        console.error(`[dashboard] Firmware rollback failed (${nodeId}):`, err.message);
      }
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
    this.addEventListener('spoke-module-action', this._spokeModuleActionHandler);
    this.addEventListener('module-deploy', this._moduleDeployHandler);
    this.addEventListener('firmware-deploy', this._firmwareDeployHandler);
    this.addEventListener('firmware-rollback', this._firmwareRollbackHandler);
    this._startClock();
  }

  async _fetchConfigAndConnect() {
    try {
      const resp = await fetch('/api/config');
      const config = await resp.json();
      this.localNodeId = typeof config.nodeId === 'string' && config.nodeId.trim()
        ? config.nodeId.trim()
        : 'local';
      this.localRole = typeof config.role === 'string' && config.role.trim()
        ? config.role.trim()
        : 'standalone';
    } catch {
      // Dev mode or config unavailable
      this.localNodeId = 'local';
      this.localRole = 'standalone';
    }
    if (this.localRole === 'hub') {
      this.startFleetPolling();
    } else {
      this.stopFleetPolling();
      this.spokes = [];
      this.moduleBundles = [];
      this.firmwareBundles = [];
      this.fleetJobs = {};
      this.spokeModules = {};
      this.fleetError = '';
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
    this.removeEventListener('spoke-module-action', this._spokeModuleActionHandler);
    this.removeEventListener('module-deploy', this._moduleDeployHandler);
    this.removeEventListener('firmware-deploy', this._firmwareDeployHandler);
    this.removeEventListener('firmware-rollback', this._firmwareRollbackHandler);
    this.stopFleetPolling();
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

  startFleetPolling() {
    if (this.localRole !== 'hub') return;
    if (this._fleetPollInterval) return;
    this.refreshFleetData();
    this._fleetPollInterval = setInterval(() => {
      this.refreshFleetData();
    }, 10000);
  }

  stopFleetPolling() {
    if (this._fleetPollInterval) {
      clearInterval(this._fleetPollInterval);
      this._fleetPollInterval = null;
    }
  }

  async refreshFleetData() {
    if (this.localRole !== 'hub') {
      this.spokes = [];
      this.moduleBundles = [];
      this.firmwareBundles = [];
      this.spokeModules = {};
      this.fleetJobs = {};
      this.fleetError = '';
      return;
    }
    try {
      const [spokesResp, moduleBundlesResp, firmwareBundlesResp] = await Promise.all([
        fetch('/api/spokes'),
        fetch('/api/module-bundles'),
        fetch('/api/firmware/bundles')
      ]);

      if (spokesResp.ok) {
        const data = await spokesResp.json();
        this.spokes = Array.isArray(data?.spokes) ? data.spokes : [];
        const moduleResults = await Promise.all(this.spokes.map(async (spoke) => {
          try {
            const resp = await fetch(`/api/spokes/${encodeURIComponent(spoke.nodeId)}/modules`);
            if (!resp.ok) return [spoke.nodeId, []];
            const payload = await resp.json();
            return [spoke.nodeId, Array.isArray(payload?.modules) ? payload.modules : []];
          } catch {
            return [spoke.nodeId, []];
          }
        }));
        this.spokeModules = Object.fromEntries(moduleResults);
      } else {
        this.spokes = [];
        this.spokeModules = {};
      }

      if (moduleBundlesResp.ok) {
        const data = await moduleBundlesResp.json();
        this.moduleBundles = Array.isArray(data?.bundles) ? data.bundles : [];
      }

      if (firmwareBundlesResp.ok) {
        const data = await firmwareBundlesResp.json();
        this.firmwareBundles = Array.isArray(data?.bundles) ? data.bundles : [];
      }

      const jobEntries = Object.entries(this.fleetJobs || {});
      if (jobEntries.length > 0) {
        const updates = await Promise.all(jobEntries.map(async ([nodeId, job]) => {
          if (!job?.jobId) return [nodeId, job];
          try {
            const resp = await fetch(`/api/spokes/${encodeURIComponent(nodeId)}/firmware/jobs/${encodeURIComponent(job.jobId)}`);
            if (!resp.ok) return [nodeId, job];
            const latest = await resp.json();
            return [nodeId, latest];
          } catch {
            return [nodeId, job];
          }
        }));
        this.fleetJobs = Object.fromEntries(updates);
      }

      if (!spokesResp.ok && !moduleBundlesResp.ok && !firmwareBundlesResp.ok) {
        this.fleetError = 'Fleet APIs unavailable';
      } else {
        this.fleetError = '';
      }
    } catch (err) {
      this.fleetError = err.message;
    }
  }

  connectSocket() {
    const socketUrl = window.location.origin;
    this.socket = io(socketUrl, {
      transports: ['websocket'],
      reconnection: true,
      reconnectionAttempts: Infinity,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 30000,
      // Auth is injected by the web proxy via X-API-Key header on upgrade
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
      // Auth is injected by the web proxy via X-API-Key header on upgrade
    });

    this.moduleSocket.on('modules', (modules) => {
      this.allModules = modules;
      this.modulePages = modules.filter(m => m.ui?.page);
      this.standaloneModules = modules.filter(m => m.ui?.standalone);
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
