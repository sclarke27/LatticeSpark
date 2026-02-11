import { html } from 'lit';

export function render(el) {
  if (!el.component) return html``;

  const label = el.component.config?.label || el.component.id;
  const numLeds = el.numLeds;

  return html`
    <div class="card">
      <div class="card-header">
        <h3 class="card-title">${label}</h3>
        <span class="card-type">${el.component.type}</span>
      </div>

      <div class="card-body">
        ${el.data
          ? html`
              <div class="led-strip">
                ${Array.from({ length: numLeds }, (_, i) => html`
                  <button
                    class="led-circle"
                    style="background: ${el.getLedCssColor(i)}; box-shadow: 0 0 12px ${el.getLedCssColor(i)}"
                    title="LED ${i + 1}"
                    @click=${(e) => el.onLedClick(i, e)}
                  ></button>
                `)}
              </div>

              <div class="brightness-control">
                <label class="brightness-label">
                  Brightness
                  <span class="brightness-value">${el.getBrightness()}</span>
                </label>
                <input
                  type="range"
                  min="0"
                  max="255"
                  .value=${String(el.getBrightness())}
                  @change=${(e) => el.onBrightnessChange(e)}
                />
              </div>

              <input
                type="color"
                id="color-picker"
                class="hidden-picker"
                @input=${(e) => el.onColorInput(e)}
              />

              <div class="timestamp ${el.getDataFreshness(el.data.timestamp)}">
                ${el.formatDataAge(el.data.timestamp)}
              </div>
            `
          : html`<div class="no-data">Waiting for data...</div>`
        }
      </div>
    </div>
  `;
}
