import { html } from 'lit';

export function render(el) {
  if (!el.component) return html``;

  const label = el.component.config?.label || el.component.id;
  const buzzing = el.isBuzzing();

  return html`
    <div class="card">
      <div class="card-header">
        <h3 class="card-title">${label}</h3>
        <span class="card-type">${el.component.type}</span>
      </div>

      <div class="card-body">
        ${el.data
          ? html`
              <div class="buzzer-status">
                <div class="buzzer-icon ${buzzing ? 'buzzing' : ''}">
                  <svg viewBox="0 0 24 24" width="32" height="32" fill="none" stroke="currentColor" stroke-width="2">
                    <path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9"/>
                    <path d="M13.73 21a2 2 0 0 1-3.46 0"/>
                  </svg>
                </div>
                <div class="buzzer-label ${buzzing ? 'active' : ''}">
                  ${buzzing ? 'Buzzing' : 'Silent'}
                </div>
              </div>

              <button
                class="toggle-btn ${buzzing ? 'on' : 'off'}"
                @click=${() => el.onToggle()}
              >
                ${buzzing ? 'Turn Off' : 'Turn On'}
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
