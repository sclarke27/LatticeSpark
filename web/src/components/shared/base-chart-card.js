import { BaseCard } from './base-card.js';
import {
  Chart,
  LineController,
  LineElement,
  PointElement,
  LinearScale,
  TimeScale,
  Title,
  Tooltip,
  Legend
} from 'chart.js';
import 'chartjs-adapter-date-fns';

// Register Chart.js components once
Chart.register(
  LineController,
  LineElement,
  PointElement,
  LinearScale,
  TimeScale,
  Title,
  Tooltip,
  Legend
);

export { Chart };

const CHART_UPDATE_INTERVAL = 500; // Max chart update rate: 2/second

export class BaseChartCard extends BaseCard {
  constructor() {
    super();
    this.charts = new Map();
    this._lastChartUpdate = 0;
    this._chartUpdatePending = false;
    this._chartUpdateTimeout = null;
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    if (this._chartUpdateTimeout) {
      clearTimeout(this._chartUpdateTimeout);
      this._chartUpdateTimeout = null;
    }
    this.destroyCharts();
    this._chartUpdatePending = false;
  }

  updated(changedProperties) {
    super.updated(changedProperties);

    if (changedProperties.has('component')) {
      this.updateCharts();
    }

    if (changedProperties.has('data') && this.data) {
      this._scheduleChartUpdate();
    }
  }

  _scheduleChartUpdate() {
    const now = Date.now();
    const elapsed = now - this._lastChartUpdate;

    if (elapsed >= CHART_UPDATE_INTERVAL) {
      this._lastChartUpdate = now;
      this.addLiveDataPoint();
    } else if (!this._chartUpdatePending) {
      this._chartUpdatePending = true;
      this._chartUpdateTimeout = setTimeout(() => {
        this._chartUpdatePending = false;
        this._chartUpdateTimeout = null;
        this._lastChartUpdate = Date.now();
        this.addLiveDataPoint();
      }, CHART_UPDATE_INTERVAL - elapsed);
    }
  }

  destroyCharts() {
    this.charts.forEach(chart => chart.destroy());
    this.charts.clear();
  }

  // Subclasses must implement:
  addLiveDataPoint() {}
  updateCharts() {}
}
