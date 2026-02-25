import { LitElement, unsafeCSS } from 'lit';
import { render } from './modules-manager.view.js';
import styles from './modules-manager.scss?inline';

export class ModulesManager extends LitElement {
  static styles = unsafeCSS(styles);

  static properties = {
    modules: { type: Array },
    spokes: { type: Array },
    moduleBundles: { type: Array },
    firmwareBundles: { type: Array },
    fleetError: { type: String },
    fleetJobs: { type: Object },
    spokeModules: { type: Object },
    selectedNodeId: { type: String },
    deployModuleRef: { type: String },
    deployFirmwareRef: { type: String },
    firmwareSourceId: { type: String },
    remoteModuleId: { type: String },
    fleetEnabled: { type: Boolean },
    theme: { type: String, reflect: true }
  };

  constructor() {
    super();
    this.modules = [];
    this.spokes = [];
    this.moduleBundles = [];
    this.firmwareBundles = [];
    this.fleetError = '';
    this.fleetJobs = {};
    this.spokeModules = {};
    this.selectedNodeId = '';
    this.deployModuleRef = '';
    this.deployFirmwareRef = '';
    this.firmwareSourceId = '';
    this.remoteModuleId = '';
    this.fleetEnabled = false;
    this.theme = 'default';
  }

  updated(changed) {
    if (changed.has('spokes')) {
      const validIds = new Set(this.spokes.map(s => s.nodeId));
      if (!this.selectedNodeId && this.spokes.length > 0) {
        this.selectedNodeId = this.spokes[0].nodeId;
      } else if (this.selectedNodeId && !validIds.has(this.selectedNodeId)) {
        this.selectedNodeId = this.spokes[0]?.nodeId || '';
      }
    }
  }

  toggleModule(moduleId, currentlyEnabled) {
    const action = currentlyEnabled ? 'disable' : 'enable';
    this.dispatchEvent(new CustomEvent('module-action', {
      detail: { moduleId, action },
      bubbles: true,
      composed: true
    }));
  }

  restartModule(moduleId) {
    this.dispatchEvent(new CustomEvent('module-action', {
      detail: { moduleId, action: 'restart' },
      bubbles: true,
      composed: true
    }));
  }

  viewPage(moduleId) {
    this.dispatchEvent(new CustomEvent('module-navigate', {
      detail: { moduleId },
      bubbles: true,
      composed: true
    }));
  }

  dispatchSpokeModuleAction(moduleId, action) {
    if (!this.selectedNodeId || !moduleId) return;
    this.dispatchEvent(new CustomEvent('spoke-module-action', {
      detail: { nodeId: this.selectedNodeId, moduleId, action },
      bubbles: true,
      composed: true
    }));
  }

  dispatchModuleDeploy() {
    if (!this.selectedNodeId || !this.deployModuleRef) return;
    const [bundleId, version] = this.deployModuleRef.split('@');
    this.dispatchEvent(new CustomEvent('module-deploy', {
      detail: { nodeId: this.selectedNodeId, bundleId, version },
      bubbles: true,
      composed: true
    }));
  }

  dispatchFirmwareDeploy() {
    if (!this.selectedNodeId || !this.deployFirmwareRef) return;
    const [bundleId, version] = this.deployFirmwareRef.split('@');
    this.dispatchEvent(new CustomEvent('firmware-deploy', {
      detail: {
        nodeId: this.selectedNodeId,
        bundleId,
        version,
        sourceId: this.firmwareSourceId || null
      },
      bubbles: true,
      composed: true
    }));
  }

  dispatchFirmwareRollback() {
    if (!this.selectedNodeId) return;
    this.dispatchEvent(new CustomEvent('firmware-rollback', {
      detail: {
        nodeId: this.selectedNodeId,
        sourceId: this.firmwareSourceId || null
      },
      bubbles: true,
      composed: true
    }));
  }

  render() {
    return render(this);
  }
}

customElements.define('modules-manager', ModulesManager);
