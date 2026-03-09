import { unsafeCSS } from 'lit';
import { BaseChartCard, Chart } from '../shared/base-chart-card.js';
import { getColor, AXIS_COLORS } from '../shared/metrics-config.js';
import { TIME_RANGES, DEFAULT_RANGE_ID, MAX_DISPLAY_POINTS, getRangeById, downsample } from './time-ranges.js';
import styles from './sensor-card.scss?inline';
import { render } from './sensor-card.view.js';

const GRID_COLOR = 'rgba(255, 255, 255, 0.05)';
const TICK_COLOR = 'rgba(255, 255, 255, 0.5)';
const AXIS_LABELS = ['x', 'y', 'z'];

function colorWithAlpha(rgb) {
  return rgb.replace('rgb', 'rgba').replace(')', ', 0.1)');
}

function getCanvasId(componentId, key) {
  return `chart-${componentId}-${key}`;
}

// Ranges <= 5 minutes use bezier curves; longer ranges disable tension for decimation
const DECIMATION_THRESHOLD = 300; // seconds

function useDecimation(range) {
  return range && range.seconds > DECIMATION_THRESHOLD;
}

function getTension(range) {
  return useDecimation(range) ? 0 : 0.4;
}

function buildChartOptions({ precision, unit, showLegend = false, range }) {
  const decimate = useDecimation(range);
  return {
    responsive: true,
    maintainAspectRatio: false,
    animation: false,
    parsing: false,
    interaction: { mode: 'index', intersect: false },
    plugins: {
      legend: showLegend
        ? {
            display: true,
            position: 'top',
            align: 'end',
            labels: {
              color: 'rgba(255, 255, 255, 0.7)',
              boxWidth: 12,
              boxHeight: 2,
              padding: 8,
              font: { size: 10 }
            }
          }
        : { display: false },
      tooltip: {
        mode: 'index',
        intersect: false,
        callbacks: {
          label: (context) => {
            const prefix = showLegend ? `${context.dataset.label}: ` : '';
            return `${prefix}${context.parsed.y.toFixed(precision)} ${unit}`;
          }
        }
      },
      decimation: decimate
        ? { enabled: true, algorithm: 'lttb', samples: 500 }
        : { enabled: false }
    },
    scales: {
      x: {
        type: 'time',
        time: {
          displayFormats: {
            second: 'HH:mm:ss',
            minute: 'HH:mm',
            hour: 'HH:mm',
            day: 'MMM d',
          },
          ...(range && range.seconds > 86400 ? { unit: 'hour' } : {}),
        },
        grid: { color: GRID_COLOR },
        ticks: { color: TICK_COLOR, maxRotation: 0, font: { size: 10 } }
      },
      y: {
        beginAtZero: false,
        grid: { color: GRID_COLOR },
        ticks: {
          color: TICK_COLOR,
          font: { size: 10 },
          callback: (value) => `${value.toFixed(precision)} ${unit}`
        }
      }
    }
  };
}

export class SensorCard extends BaseChartCard {
  static properties = {
    component: { type: Object },
    data: { type: Object },
    activeTab: { type: String },
    timeRange: { type: String }
  };

  static styles = unsafeCSS(styles);

  connectedCallback() {
    super.connectedCallback();
    const saved = localStorage.getItem(`latticespark-time-range-${this.component?.id}`);
    this.timeRange = (saved && TIME_RANGES.some(r => r.id === saved)) ? saved : DEFAULT_RANGE_ID;
  }

  setTimeRange(rangeId) {
    this.timeRange = rangeId;
    if (this.component?.id) {
      localStorage.setItem(`latticespark-time-range-${this.component.id}`, rangeId);
    }
    this.destroyCharts();
    requestAnimationFrame(() => this.updateCharts());
  }

  getMetricsConfig() {
    return this.component?.config?.metrics || [];
  }

  getTabs() {
    return this.getMetricsConfig();
  }

  getActiveTabConfig() {
    return this.getMetricsConfig().find(m => m.id === this.activeTab);
  }

  selectTab(tabId) {
    this.activeTab = tabId;
  }

  handleTabKeydown(e) {
    const tabs = this.getTabs();
    if (tabs.length < 2) return;

    const currentIndex = tabs.findIndex(t => t.id === this.activeTab);
    let newIndex = -1;

    if (e.key === 'ArrowRight' || e.key === 'ArrowDown') {
      newIndex = (currentIndex + 1) % tabs.length;
    } else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
      newIndex = (currentIndex - 1 + tabs.length) % tabs.length;
    } else if (e.key === 'Home') {
      newIndex = 0;
    } else if (e.key === 'End') {
      newIndex = tabs.length - 1;
    }

    if (newIndex >= 0) {
      e.preventDefault();
      this.selectTab(tabs[newIndex].id);
      this.updateComplete.then(() => {
        const buttons = this.shadowRoot.querySelectorAll('[role="tab"]');
        buttons[newIndex]?.focus();
      });
    }
  }

  updated(changedProperties) {
    if (changedProperties.has('data') && this.data && !this.activeTab) {
      const tabs = this.getTabs();
      if (tabs.length > 0) {
        this.activeTab = tabs[0].id;
      }
    }

    if (changedProperties.has('activeTab') && this.activeTab) {
      this.destroyCharts();
      requestAnimationFrame(() => this.updateCharts());
    }

    super.updated(changedProperties);
  }

  addLiveDataPoint() {
    if (!this.data) return;

    const tab = this.getActiveTabConfig();
    if (!tab) return;

    if (tab.type === 'label_map') return;

    const now = this.data.timestamp * 1000;

    if (tab.type === 'axis') {
      this._addPointToChart(tab.chartKey, tab.keys, now);
    } else {
      this._addPointToSingleChart(tab.keys[0], now);
    }
  }

  _addPointToSingleChart(metric, now) {
    const canvasId = getCanvasId(this.component?.id, metric);
    const chart = this.charts.get(canvasId);
    if (!chart) return;

    const value = this.data[metric];
    if (value === undefined) return;

    const range = getRangeById(this.timeRange);
    const data = chart.data.datasets[0].data;
    data.push({ x: now, y: value });

    const cutoff = now - range.seconds * 1000;
    let trimIndex = 0;
    while (trimIndex < data.length && data[trimIndex].x < cutoff) {
      trimIndex++;
    }
    if (trimIndex > 0) data.splice(0, trimIndex);
    if (data.length > range.fetchLimit) {
      data.splice(0, data.length - range.fetchLimit);
    }

    chart.update('none');
  }

  _addPointToChart(chartKey, metrics, now) {
    const canvasId = getCanvasId(this.component?.id, chartKey);
    const chart = this.charts.get(canvasId);
    if (!chart) return;

    const range = getRangeById(this.timeRange);
    const cutoff = now - range.seconds * 1000;

    metrics.forEach((metric, i) => {
      const value = this.data[metric];
      if (value === undefined) return;

      const data = chart.data.datasets[i].data;
      data.push({ x: now, y: value });

      let trimIndex = 0;
      while (trimIndex < data.length && data[trimIndex].x < cutoff) {
        trimIndex++;
      }
      if (trimIndex > 0) data.splice(0, trimIndex);
      if (data.length > range.fetchLimit) {
        data.splice(0, data.length - range.fetchLimit);
      }
    });

    chart.update('none');
  }

  updateCharts() {
    const tab = this.getActiveTabConfig();
    if (!tab) return;

    if (tab.type === 'label_map') return;

    if (tab.type === 'axis') {
      this._createCombinedChart(tab);
    } else {
      this._createSingleChart(tab);
    }
  }

  _createSingleChart(tab) {
    const metric = tab.keys[0];
    const canvasId = getCanvasId(this.component?.id, metric);
    const canvas = this.shadowRoot?.getElementById(canvasId);
    if (!canvas) return;

    if (this.charts.has(canvasId)) {
      this.charts.get(canvasId).destroy();
    }

    const color = getColor(metric);
    const range = getRangeById(this.timeRange);

    const chart = new Chart(canvas, {
      type: 'line',
      data: {
        datasets: [{
          label: tab.label,
          data: [],
          borderColor: color,
          backgroundColor: colorWithAlpha(color),
          borderWidth: 2,
          pointRadius: 0,
          pointHoverRadius: 4,
          tension: getTension(range)
        }]
      },
      options: buildChartOptions({ precision: tab.precision, unit: tab.unit, range })
    });

    this.charts.set(canvasId, chart);
    this._loadHistory(canvasId, [metric]);
  }

  _createCombinedChart(tab) {
    const canvasId = getCanvasId(this.component?.id, tab.chartKey);
    const canvas = this.shadowRoot?.getElementById(canvasId);
    if (!canvas) return;

    if (this.charts.has(canvasId)) {
      this.charts.get(canvasId).destroy();
    }

    const range = getRangeById(this.timeRange);
    const tension = getTension(range);
    const datasets = tab.keys.map((_metric, i) => {
      const color = AXIS_COLORS[AXIS_LABELS[i]];
      return {
        label: AXIS_LABELS[i].toUpperCase(),
        data: [],
        borderColor: color,
        backgroundColor: colorWithAlpha(color),
        borderWidth: 1.5,
        pointRadius: 0,
        pointHoverRadius: 3,
        tension
      };
    });

    const chart = new Chart(canvas, {
      type: 'line',
      data: { datasets },
      options: buildChartOptions({ precision: tab.precision, unit: tab.unit, showLegend: true, range })
    });

    this.charts.set(canvasId, chart);
    this._loadHistory(canvasId, tab.keys);
  }

  async _loadHistory(canvasId, metrics) {
    const componentId = this.component?.id;
    if (!componentId) return;

    const range = getRangeById(this.timeRange);
    const start = (Date.now() / 1000) - range.seconds;

    try {
      // Fetch history for each metric in parallel
      const results = await Promise.all(
        metrics.map(async (metric) => {
          const res = await fetch(
            `/api/history/${encodeURIComponent(componentId)}?metric=${encodeURIComponent(metric)}&start=${start}&limit=${range.fetchLimit}`
          );
          if (!res.ok) return [];
          const json = await res.json();
          return json.data || [];
        })
      );

      const chart = this.charts.get(canvasId);
      if (!chart) return;

      // Populate each dataset (results come newest-first, reverse for chronological)
      metrics.forEach((metric, i) => {
        const raw = results[i]
          .reverse()
          .map(d => ({ x: d.timestamp * 1000, y: d.value }));

        const points = downsample(raw, MAX_DISPLAY_POINTS);

        const dataset = chart.data.datasets[i];
        if (dataset) {
          dataset.data = points;
        }
      });

      chart.update('none');
    } catch (error) {
      console.warn(`Failed to load history for ${componentId}:`, error.message);
    }
  }

  render() {
    return render(this);
  }
}

customElements.define('sensor-card', SensorCard);
