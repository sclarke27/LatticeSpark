import { unsafeCSS } from 'lit';
import { BaseCard } from '../shared/base-card.js';
import styles from './buttons-card.scss?inline';
import { render } from './buttons-card.view.js';

export class ButtonsCard extends BaseCard {
  static properties = {
    component: { type: Object },
    data: { type: Object }
  };

  static styles = unsafeCSS(styles);

  constructor() {
    super();
    this.component = null;
    this.data = null;
  }

  getActiveButton() {
    return this.data?.button ?? 0;
  }

  render() {
    return render(this);
  }
}

customElements.define('buttons-card', ButtonsCard);
