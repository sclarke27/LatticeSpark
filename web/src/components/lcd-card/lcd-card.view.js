import { html } from 'lit';

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
              <div class="lcd-preview ${el.getBacklight() ? 'backlight-on' : 'backlight-off'}">
                <div class="lcd-line">${(el.getLine1() || '').padEnd(el.columns)}</div>
                <div class="lcd-line">${(el.getLine2() || '').padEnd(el.columns)}</div>
              </div>

              <div class="lcd-inputs">
                <div class="input-row">
                  <label class="input-label">Line 1</label>
                  <input
                    type="text"
                    class="lcd-input"
                    maxlength="${el.columns}"
                    .value=${el._line1Input}
                    @input=${(e) => el.onLine1Input(e)}
                    placeholder="Enter text..."
                  />
                </div>
                <div class="input-row">
                  <label class="input-label">Line 2</label>
                  <input
                    type="text"
                    class="lcd-input"
                    maxlength="${el.columns}"
                    .value=${el._line2Input}
                    @input=${(e) => el.onLine2Input(e)}
                    placeholder="Enter text..."
                  />
                </div>
              </div>

              <div class="lcd-actions">
                <button
                  class="backlight-btn ${el.getBacklight() ? 'on' : 'off'}"
                  @click=${() => el.onBacklightToggle()}
                >
                  Backlight: ${el.getBacklight() ? 'ON' : 'OFF'}
                </button>
                <button
                  class="send-btn"
                  @click=${() => el.onSend()}
                >
                  Send
                </button>
              </div>

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
