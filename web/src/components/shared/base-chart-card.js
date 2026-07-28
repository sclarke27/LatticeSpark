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
  Legend,
  Decimation
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
  Legend,
  Decimation
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
    this._isVisible = false;
    this._needsCatchUp = false;
    this._visibilityObserver = null;
  }

  connectedCallback() {
    super.connectedCallback();
    this._visibilityObserver = new IntersectionObserver(
      ([entry]) => {
        this._isVisible = entry.isIntersecting;
        if (this._isVisible && this._needsCatchUp) {
          this._needsCatchUp = false;
          this.addLiveDataPoint();
        }
      },
      { rootMargin: '100px' }
    );
    this._visibilityObserver.observe(this);
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    if (this._visibilityObserver) {
      this._visibilityObserver.disconnect();
      this._visibilityObserver = null;
    }
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
      const prev = changedProperties.get('component');
      if (this._chartConfigChanged(prev, this.component)) {
        // Destroy first: positional element reuse (spokes joining/leaving)
        // would otherwise leak detached charts keyed by the old component id
        this.destroyCharts();
        this.updateCharts();
      }
    }

    if (changedProperties.has('data') && this.data) {
      this._scheduleChartUpdate();
    }
  }

  // Components broadcasts deliver fresh object references every time; only
  // rebuild charts (and refetch history) when identity or chart config changed.
  _chartConfigChanged(prev, next) {
    if (!prev || !next) return true;
    if (prev.id !== next.id) return true;
    const prevMetrics = prev.config?.metrics;
    const nextMetrics = next.config?.metrics;
    if (prevMetrics === nextMetrics) return false;
    return JSON.stringify(prevMetrics ?? null) !== JSON.stringify(nextMetrics ?? null);
  }

  _scheduleChartUpdate() {
    if (!this._isVisible) {
      this._needsCatchUp = true;
      return;
    }

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
