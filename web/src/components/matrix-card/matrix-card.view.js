import { html } from 'lit';

function renderGridTab(el) {
  return html`
    <div class="matrix-grid">
      ${Array.from({ length: 64 }, (_, i) => html`
        <div
          class="pixel"
          style="${el.pixelCss(i)}"
          @click=${() => el.onPixelClick(i)}
        ></div>
      `)}
    </div>

    <div class="color-row">
      <label class="control-label">Paint color</label>
      <input
        type="color"
        .value=${el._paintColor}
        @input=${(e) => el.onColorChange(e)}
        class="color-picker"
      />
      <button class="action-btn fill-btn" @click=${() => el.onFill()}>Fill</button>
      <button class="action-btn clear-btn" @click=${() => el.onClear()}>Clear</button>
    </div>
  `;
}

function renderPresetsTab(el) {
  const activePreset = el.getActivePreset();

  return html`
    <div class="preset-list">
      ${el.presets.map(name => html`
        <button
          class="preset-btn ${activePreset === name ? 'active' : ''}"
          @click=${() => el.onPresetClick(name)}
        >${name.replace('_', ' ')}</button>
      `)}
    </div>
    <button class="action-btn clear-btn preset-clear" @click=${() => el.onClear()}>Clear</button>
  `;
}

export function render(el) {
  if (!el.component) return html``;

  const label = el.component.config?.label || el.component.id;

  return html`
    <div class="card">
      <div class="card-header">
        <h3 class="card-title">${label}</h3>
        <span class="card-type">${el.component.type}</span>
      </div>

      <div class="card-body">
        ${el.data
          ? html`
              <div class="tabs">
                <button
                  class="tab ${el._activeTab === 'grid' ? 'active' : ''}"
                  @click=${() => { el._activeTab = 'grid'; }}
                >Grid</button>
                <button
                  class="tab ${el._activeTab === 'presets' ? 'active' : ''}"
                  @click=${() => { el._activeTab = 'presets'; }}
                >Presets</button>
              </div>

              <div class="tab-content">
                ${el._activeTab === 'grid' ? renderGridTab(el) : renderPresetsTab(el)}
              </div>
            `
          : html`<div class="no-data">Waiting for data...</div>`
        }
      </div>
    </div>
  `;
}
