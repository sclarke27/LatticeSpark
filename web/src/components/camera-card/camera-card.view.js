import { html, nothing } from 'lit';

function renderProcessors(el) {
  if (!el.processors || el.processors.length === 0) return nothing;

  return html`
    <div class="processors">
      <div class="processors-label">Processors</div>
      <div class="processor-toggles">
        ${el.processors.map(proc => html`
          <button
            class="processor-btn ${proc.enabled ? 'on' : 'off'}"
            @click=${() => el.onToggleProcessor(proc.name, proc.enabled)}
          >
            <span class="processor-name">${proc.description}</span>
            <span class="processor-status">${proc.enabled ? 'ON' : 'OFF'}</span>
          </button>
        `)}
      </div>
    </div>
  `;
}

function renderDetections(el) {
  if (!el.lastDetection) return nothing;

  const { detections, count } = el.lastDetection;
  if (!count) return nothing;

  // Summarize by type
  const summary = {};
  for (const d of detections) {
    const type = d.type || 'unknown';
    summary[type] = (summary[type] || 0) + 1;
  }

  const parts = Object.entries(summary).map(([type, n]) =>
    `${n} ${type}${n > 1 ? 's' : ''}`
  );

  return html`
    <div class="detections">
      Detected: ${parts.join(', ')}
    </div>
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
        <div class="stream-container">
          ${el.streamError
            ? html`<div class="no-data">Camera unavailable</div>`
            : html`
                <img
                  class="stream"
                  src=${el.streamUrl}
                  alt="Camera stream"
                  @error=${() => el.onStreamError()}
                  @load=${() => el.onStreamLoad()}
                />
              `
          }
        </div>

        ${renderDetections(el)}
        ${renderProcessors(el)}
      </div>
    </div>
  `;
}
