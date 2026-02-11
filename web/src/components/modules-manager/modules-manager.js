import { LitElement, unsafeCSS } from 'lit';
import { render } from './modules-manager.view.js';
import styles from './modules-manager.scss?inline';

export class ModulesManager extends LitElement {
  static styles = unsafeCSS(styles);

  static properties = {
    modules: { type: Array },
    theme: { type: String, reflect: true }
  };

  constructor() {
    super();
    this.modules = [];
    this.theme = 'default';
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

  render() {
    return render(this);
  }
}

customElements.define('modules-manager', ModulesManager);
