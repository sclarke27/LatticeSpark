import { html } from 'lit';

export function render(el) {
  if (!el.component) return html``;

  const label = el.component.config?.label || el.component.id;
  const digits = el.getDigits();
  const colon = el.getColon();

  return html`
    <div class="card">
      <div class="card-header">
        <h3 class="card-title">${label}</h3>
        <span class="card-type">${el.component.type}</span>
      </div>

      <div class="card-body">
        ${el.data
          ? html`
              <div class="segment-preview">
                <span class="segment-digit">${digits[0].char === ' ' ? '' : digits[0].char}</span>
                <span class="segment-digit">${digits[1].char === ' ' ? '' : digits[1].char}${digits[1].decimal ? '.' : ''}</span>
                <span class="segment-colon ${colon ? 'on' : 'off'}">:</span>
                <span class="segment-digit">${digits[2].char === ' ' ? '' : digits[2].char}</span>
                <span class="segment-digit">${digits[3].char === ' ' ? '' : digits[3].char}${digits[3].decimal ? '.' : ''}</span>
              </div>

              <div class="segment-inputs">
                <div class="input-row">
                  <label class="input-label">Text</label>
                  <input
                    type="text"
                    class="segment-input"
                    maxlength="8"
                    .value=${el._textInput}
                    @input=${(e) => el.onTextInput(e)}
                    placeholder="e.g. 12.34"
                  />
                </div>
              </div>

              <div class="segment-actions">
                <button
                  class="colon-btn ${colon ? 'on' : 'off'}"
                  @click=${() => el.onColonToggle()}
                >
                  Colon: ${colon ? 'ON' : 'OFF'}
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
