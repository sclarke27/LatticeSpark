import { html } from 'lit';
import { AXIS_COLORS } from '../shared/metrics-config.js';
import { TIME_RANGES } from './time-ranges.js';

const AXIS_LABELS = ['x', 'y', 'z'];

function renderSingleMetric(el, tab) {
  const key = tab.keys[0];
  const value = el.data[key];
  const display = value != null ? value.toFixed(tab.precision) : '--';

  return html`
    <div class="reading">
      <span class="reading-label">${tab.label}</span>
      <span>
        <span class="reading-value">${display}</span>
        <span class="reading-unit">${tab.unit}</span>
      </span>
    </div>
    <div class="chart-container">
      <canvas id="chart-${el.component.id}-${key}" aria-label="${tab.label} chart"></canvas>
    </div>
  `;
}

function renderAxisMetrics(el, tab) {
  return html`
    <div class="sensor-group">
      <div class="axis-readings">
        ${tab.keys.map((key, i) => {
          const axis = AXIS_LABELS[i];
          const value = el.data[key];
          const display = value != null ? value.toFixed(tab.precision) : '--';

          return html`
            <div class="axis-value">
              <div class="axis-label">
                <span class="color-dot" style="background: ${AXIS_COLORS[axis]}"></span>${axis.toUpperCase()}
              </div>
              <div>
                <span class="axis-number">${display}</span>
                <span class="axis-unit">${tab.unit}</span>
              </div>
            </div>
          `;
        })}
      </div>
      <div class="chart-container">
        <canvas id="chart-${el.component.id}-${tab.chartKey}" aria-label="${tab.label} chart"></canvas>
      </div>
    </div>
  `;
}

function renderLabelMapMetric(el, tab) {
  const key = tab.keys[0];
  const value = el.data[key];
  const map = tab.map || {};
  const defaultLabel = tab.defaultLabel || '--';

  const label = (value != null && value !== 0) ? (map[String(value)] || `0x${value.toString(16).toUpperCase()}`) : defaultLabel;

  return html`
    <div class="label-map-display">
      <span class="label-map-title">${tab.label}</span>
      <span class="label-map-value">${label}</span>
    </div>
  `;
}

function renderActiveTab(el) {
  const tab = el.getActiveTabConfig();
  if (!tab) return html``;

  if (tab.type === 'axis') {
    return renderAxisMetrics(el, tab);
  }
  if (tab.type === 'label_map') {
    return renderLabelMapMetric(el, tab);
  }
  return renderSingleMetric(el, tab);
}

export function render(el) {
  if (!el.component) return html``;

  const tabs = el.getTabs();
  const label = el.component.config?.label || el.component.id;

  return html`
    <div class="card">
      <div class="card-header">
        <h3 class="card-title">${label}</h3>
        <select class="time-range-select"
                .value=${el.timeRange}
                @change=${(e) => el.setTimeRange(e.target.value)}>
          ${TIME_RANGES.map(r => html`
            <option value=${r.id} ?selected=${r.id === el.timeRange}>${r.label}</option>
          `)}
        </select>
        <span class="card-type">${el.component.type}</span>
      </div>

      <div class="card-body">
        ${el.data
          ? html`
              ${tabs.length > 1
                ? html`
                    <div class="tab-bar" role="tablist" @keydown=${(e) => el.handleTabKeydown(e)}>
                      ${tabs.map(tab => html`
                        <button class="tab ${el.activeTab === tab.id ? 'active' : ''}"
                                role="tab"
                                aria-selected=${el.activeTab === tab.id}
                                tabindex=${el.activeTab === tab.id ? 0 : -1}
                                @click=${() => el.selectTab(tab.id)}>
                          ${tab.icon} ${tab.label}
                        </button>
                      `)}
                    </div>
                  `
                : ''
              }
              <div class="current-readings">
                ${renderActiveTab(el)}
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
