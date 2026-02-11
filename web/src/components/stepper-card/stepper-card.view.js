import { html } from 'lit';

function polarToCartesian(cx, cy, r, angleDeg) {
  const rad = angleDeg * Math.PI / 180;
  return { x: cx + r * Math.cos(rad), y: cy + r * Math.sin(rad) };
}

function renderGauge(degrees, stepping) {
  // Full circle gauge: 0° = top (12 o'clock), clockwise
  // SVG: 0° points right, so offset by -90 to put 0° at top
  const needleAngle = degrees - 90;

  // Needle endpoint
  const nx = 100 + 70 * Math.cos(needleAngle * Math.PI / 180);
  const ny = 100 + 70 * Math.sin(needleAngle * Math.PI / 180);

  // Tick marks at 0, 90, 180, 270
  const ticks = [0, 90, 180, 270];

  return html`
    <svg class="gauge" viewBox="0 0 200 200" xmlns="http://www.w3.org/2000/svg">
      <!-- Track circle -->
      <circle cx="100" cy="100" r="90"
              fill="none" stroke="var(--border)" stroke-width="8" />

      <!-- Tick marks -->
      ${ticks.map(deg => {
        const svgAngle = deg - 90;
        const rad = svgAngle * Math.PI / 180;
        const x1 = 100 + 78 * Math.cos(rad);
        const y1 = 100 + 78 * Math.sin(rad);
        const x2 = 100 + 90 * Math.cos(rad);
        const y2 = 100 + 90 * Math.sin(rad);
        return html`<line x1=${x1} y1=${y1} x2=${x2} y2=${y2}
                          stroke="var(--text-secondary)" stroke-width="2" />`;
      })}

      <!-- Tick labels -->
      ${ticks.map(deg => {
        const svgAngle = deg - 90;
        const rad = svgAngle * Math.PI / 180;
        const x = 100 + 66 * Math.cos(rad);
        const y = 100 + 66 * Math.sin(rad);
        return html`<text x=${x} y=${y}
                          text-anchor="middle" dominant-baseline="central"
                          fill="var(--text-secondary)" font-size="10">
                      ${deg}
                    </text>`;
      })}

      <!-- Needle -->
      <line x1="100" y1="100" x2=${nx} y2=${ny}
            stroke="var(--accent)" stroke-width="3" stroke-linecap="round" />

      <!-- Center dot -->
      <circle cx="100" cy="100" r="5"
              fill="var(--accent)"
              class="${stepping ? 'pulse' : ''}" />
    </svg>
  `;
}

export function render(el) {
  if (!el.component) return html``;

  const label = el.component.config?.label || el.component.id;
  const degrees = el.getDegrees();
  const stepping = el.isStepping();
  const direction = el.getDirection();

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
                ${renderGauge(degrees, stepping)}
                <div class="angle-display">${degrees}&deg;</div>
                <div class="status-indicator ${stepping ? 'active' : ''}">
                  ${direction}
                </div>
              </div>

              <div class="presets">
                <div class="preset-row">
                  <button class="preset-btn" @click=${() => el.onPreset(-90)}>-90&deg;</button>
                  <button class="preset-btn" @click=${() => el.onPreset(-180)}>-180&deg;</button>
                  <button class="preset-btn" @click=${() => el.onPreset(-360)}>-360&deg;</button>
                </div>
                <div class="preset-row">
                  <button class="preset-btn" @click=${() => el.onPreset(90)}>+90&deg;</button>
                  <button class="preset-btn" @click=${() => el.onPreset(180)}>+180&deg;</button>
                  <button class="preset-btn" @click=${() => el.onPreset(360)}>+360&deg;</button>
                </div>
                <div class="preset-row">
                  <button class="preset-btn home-btn" @click=${() => el.onHome()}>Home</button>
                  <button class="preset-btn stop-btn" @click=${() => el.onStop()}>Stop</button>
                </div>
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
