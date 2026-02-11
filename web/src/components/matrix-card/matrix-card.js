import { unsafeCSS } from 'lit';
import { BaseCard } from '../shared/base-card.js';
import styles from './matrix-card.scss?inline';
import { render } from './matrix-card.view.js';

const PRESETS = ['heart', 'smiley', 'checkerboard', 'border', 'x_mark', 'diamond'];

export class MatrixCard extends BaseCard {
  static properties = {
    component: { type: Object },
    data: { type: Object },
    _paintColor: { type: String, state: true },
    _activeTab: { type: String, state: true }
  };

  static styles = unsafeCSS(styles);

  constructor() {
    super();
    this.component = null;
    this.data = null;
    this._paintColor = '#ff0000';
    this._activeTab = 'grid';
  }

  get presets() {
    return PRESETS;
  }

  getGrid() {
    if (!this.data?.grid) return Array(64).fill([0, 0, 0]);
    try {
      return JSON.parse(this.data.grid);
    } catch {
      return Array(64).fill([0, 0, 0]);
    }
  }

  getActivePreset() {
    return this.data?.preset || '';
  }

  pixelCss(index) {
    const grid = this.getGrid();
    const [r, g, b] = grid[index] || [0, 0, 0];
    if (r === 0 && g === 0 && b === 0) return 'background: #111;';
    return `background: rgb(${r}, ${g}, ${b}); box-shadow: 0 0 4px rgba(${r}, ${g}, ${b}, 0.5);`;
  }

  hexToRgb(hex) {
    const r = parseInt(hex.slice(1, 3), 16);
    const g = parseInt(hex.slice(3, 5), 16);
    const b = parseInt(hex.slice(5, 7), 16);
    return { r, g, b };
  }

  onPixelClick(index) {
    const { r, g, b } = this.hexToRgb(this._paintColor);
    this._sendWrite({ pixel: index, r, g, b });
  }

  onColorChange(e) {
    this._paintColor = e.target.value;
  }

  onPresetClick(name) {
    this._sendWrite({ preset: name });
  }

  onFill() {
    const { r, g, b } = this.hexToRgb(this._paintColor);
    this._sendWrite({ fill: 1, r, g, b });
  }

  onClear() {
    this._sendWrite({ clear: 1 });
  }

  _sendWrite(data) {
    this.dispatchEvent(new CustomEvent('component-write', {
      bubbles: true,
      composed: true,
      detail: {
        componentId: this.component?.id,
        data
      }
    }));
  }

  render() {
    return render(this);
  }
}

customElements.define('matrix-card', MatrixCard);
