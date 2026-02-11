import { html } from 'lit';

const PRESETS = [0, 45, 90, 135, 180];

function renderGauge(angle) {
  // Semicircle gauge: 0° = left, 180° = right
  // SVG arc from -90° to +90° (top semicircle)
  // Needle rotates from -90° (0°) to +90° (180°)
  const needleRotation = angle - 90;

  return html`
    <svg class="gauge" viewBox="0 0 200 110" xmlns="http://www.w3.org/2000/svg">
      <!-- Track arc -->
      <path d="M 10 100 A 90 90 0 0 1 190 100"
            fill="none" stroke="var(--border)" stroke-width="8" stroke-linecap="round" />

      <!-- Filled arc (0 to current angle) -->
      ${angle > 0 ? html`
        <path d="${describeArc(100, 100, 90, 180, 180 + angle)}"
              fill="none" stroke="var(--accent)" stroke-width="8" stroke-linecap="round" />
      ` : ''}

      <!-- Tick marks -->
      ${[0, 45, 90, 135, 180].map(deg => {
        const rad = (180 + deg) * Math.PI / 180;
        const x1 = 100 + 78 * Math.cos(rad);
        const y1 = 100 + 78 * Math.sin(rad);
        const x2 = 100 + 90 * Math.cos(rad);
        const y2 = 100 + 90 * Math.sin(rad);
        return html`<line x1=${x1} y1=${y1} x2=${x2} y2=${y2}
                          stroke="var(--text-secondary)" stroke-width="2" />`;
      })}

      <!-- Needle -->
      <line x1="100" y1="100"
            x2=${100 + 70 * Math.cos((180 + angle) * Math.PI / 180)}
            y2=${100 + 70 * Math.sin((180 + angle) * Math.PI / 180)}
            stroke="var(--accent)" stroke-width="3" stroke-linecap="round" />

      <!-- Center dot -->
      <circle cx="100" cy="100" r="5" fill="var(--accent)" />
    </svg>
  `;
}

function describeArc(cx, cy, r, startAngle, endAngle) {
  const start = polarToCartesian(cx, cy, r, endAngle);
  const end = polarToCartesian(cx, cy, r, startAngle);
  const largeArc = endAngle - startAngle > 180 ? 1 : 0;
  return `M ${start.x} ${start.y} A ${r} ${r} 0 ${largeArc} 0 ${end.x} ${end.y}`;
}

function polarToCartesian(cx, cy, r, angleDeg) {
  const rad = angleDeg * Math.PI / 180;
  return { x: cx + r * Math.cos(rad), y: cy + r * Math.sin(rad) };
}

export function render(el) {
  if (!el.component) return html``;

  const label = el.component.config?.label || el.component.id;
  const angle = el.getAngle();

  return html`
    <div class="card">
      <div class="card-header">
        <h3 class="card-title">${label}</h3>
        <span class="card-type">${el.component.type}</span>
      </div>

      <div class="card-body">
        ${el.data
          ? html`
              <div class="gauge-container">
                ${renderGauge(angle)}
                <div class="angle-display">${angle}&deg;</div>
              </div>

              <div class="slider-control">
                <input type="range" min="0" max="180" step="1"
                       .value=${String(angle)}
                       @input=${(e) => el.onAngleInput(e)}
                       @change=${(e) => el.onAngleChange(e)} />
                <div class="slider-labels">
                  <span>0&deg;</span>
                  <span>90&deg;</span>
                  <span>180&deg;</span>
                </div>
              </div>

              <div class="presets">
                ${PRESETS.map(preset => html`
                  <button class="preset-btn ${angle === preset ? 'active' : ''}"
                          @click=${() => el.onPreset(preset)}>
                    ${preset}&deg;
                  </button>
                `)}
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
