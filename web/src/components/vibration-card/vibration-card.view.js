import { html } from 'lit';

export function render(el) {
  if (!el.component) return html``;

  const label = el.component.config?.label || el.component.id;
  const vibrating = el.isVibrating();

  return html`
    <div class="card">
      <div class="card-header">
        <h3 class="card-title">${label}</h3>
        <span class="card-type">${el.component.type}</span>
      </div>

      <div class="card-body">
        ${el.data
          ? html`
              <div class="motor-status">
                <div class="motor-icon ${vibrating ? 'vibrating' : ''}">
                  <div class="motor-inner"></div>
                </div>
                <div class="motor-label ${vibrating ? 'active' : ''}">
                  ${vibrating ? 'Vibrating' : 'Idle'}
                </div>
              </div>

              <button
                class="toggle-btn ${vibrating ? 'on' : 'off'}"
                @click=${() => el.onToggle()}
              >
                ${vibrating ? 'Turn Off' : 'Turn On'}
              </button>

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
