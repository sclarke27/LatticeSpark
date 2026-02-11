import { html } from 'lit';

export function render(el) {
  if (!el.component) return html``;

  const label = el.component.config?.label || el.component.id;
  const active = el.isActive();

  return html`
    <div class="card">
      <div class="card-header">
        <h3 class="card-title">${label}</h3>
        <span class="card-type">${el.component.type}</span>
      </div>

      <div class="card-body">
        ${el.data
          ? html`
              <div class="relay-status">
                <div class="relay-icon ${active ? 'active' : ''}">
                  <svg viewBox="0 0 48 48" xmlns="http://www.w3.org/2000/svg">
                    <!-- Relay coil body -->
                    <rect x="10" y="14" width="28" height="20" rx="3"
                          fill="none" stroke="currentColor" stroke-width="2.5" />
                    <!-- Contact arm -->
                    <line x1="14" y1="${active ? '14' : '11'}"
                          x2="34" y2="${active ? '14' : '11'}"
                          stroke="currentColor" stroke-width="2.5" stroke-linecap="round" />
                    <!-- Terminals -->
                    <circle cx="18" cy="8" r="2" fill="currentColor" />
                    <circle cx="30" cy="8" r="2" fill="currentColor" />
                    <!-- Connection lines -->
                    <line x1="18" y1="10" x2="18" y2="${active ? '14' : '11'}"
                          stroke="currentColor" stroke-width="2" />
                    <line x1="30" y1="10" x2="30" y2="${active ? '14' : '11'}"
                          stroke="currentColor" stroke-width="2" />
                    <!-- Coil symbol -->
                    <path d="M 18 24 Q 21 20 24 24 Q 27 28 30 24"
                          fill="none" stroke="currentColor" stroke-width="2" />
                  </svg>
                </div>
                <div class="relay-label ${active ? 'active' : ''}">
                  ${active ? 'Closed (ON)' : 'Open (OFF)'}
                </div>
              </div>

              <button
                class="toggle-btn ${active ? 'on' : 'off'}"
                @click=${() => el.onToggle()}
              >
                ${active ? 'Turn Off' : 'Turn On'}
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
