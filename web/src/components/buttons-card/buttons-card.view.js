import { html } from 'lit';

export function render(el) {
  if (!el.component) return html``;

  const label = el.component.config?.label || el.component.id;
  const activeButton = el.getActiveButton();

  return html`
    <div class="card">
      <div class="card-header">
        <h3 class="card-title">${label}</h3>
        <span class="card-type">${el.component.type}</span>
      </div>

      <div class="card-body">
        ${el.data
          ? html`
              <div class="buttons-grid">
                ${[1, 2, 3, 4].map(num => html`
                  <div class="button-indicator ${activeButton === num ? 'active' : ''}">
                    <div class="button-circle">
                      <span class="button-num">${num}</span>
                    </div>
                  </div>
                `)}
              </div>

              <div class="button-label ${activeButton > 0 ? 'active' : ''}">
                ${activeButton > 0 ? `Button ${activeButton} pressed` : 'No button pressed'}
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
