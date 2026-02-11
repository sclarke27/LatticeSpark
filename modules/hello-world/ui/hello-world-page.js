import { unsafeCSS } from 'lit';
import { BaseModulePage } from '../../../web/src/components/shared/base-module-page.js';
import { render } from './hello-world-page.view.js';
import styles from './hello-world-page.scss?inline';

export class HelloWorldPage extends BaseModulePage {
  static styles = unsafeCSS(styles);

  static properties = {
    ...BaseModulePage.properties,
    lcdInput: { type: String }
  };

  constructor() {
    super();
    this.lcdInput = '';
  }

  greet() {
    this.sendCommand('greet', { name: 'World' });
  }

  sendLcd() {
    if (!this.lcdInput) return;
    this.sendCommand('lcd', { text: this.lcdInput });
  }

  render() {
    return render(this);
  }
}

customElements.define('hello-world-page', HelloWorldPage);
