import { expect } from '@open-wc/testing';
import '../../src/components/sensor-card/sensor-card.js';
import { MAX_DISPLAY_POINTS } from '../../src/components/sensor-card/time-ranges.js';

// Elements are created WITHOUT DOM attach: connectedCallback (localStorage,
// IntersectionObserver) never runs, and _addPointTo*/updated are exercised
// directly against hand-made fake charts seeded into el.charts.

function makeCard({ componentId = 'c1', timeRange = '30m' } = {}) {
  const el = document.createElement('sensor-card');
  el.component = { id: componentId, config: { metrics: [] } };
  el.timeRange = timeRange;
  return el;
}

function makeChart(datasetCount = 1, seedPoints = []) {
  return {
    updateCount: 0,
    data: {
      datasets: Array.from({ length: datasetCount }, () => ({ data: [...seedPoints] }))
    },
    update() { this.updateCount++; }
  };
}

function inWindowPoints(count, now, windowMs) {
  // Evenly spaced inside the window, oldest first
  return Array.from({ length: count }, (_, i) => ({
    x: now - windowMs + ((i + 1) * windowMs) / (count + 1),
    y: i
  }));
}

describe('SensorCard live chart array caps', () => {
  it('re-downsamples to MAX_DISPLAY_POINTS once past 2x cap', () => {
    const el = makeCard();
    const now = Date.now();
    const chart = makeChart(1, inWindowPoints(1000, now, 1800 * 1000));
    el.charts.set('chart-c1-temperature', chart);
    el.data = { temperature: 21.5, timestamp: now / 1000 };

    el._addPointToSingleChart('temperature', now);

    const data = chart.data.datasets[0].data;
    expect(data).to.have.lengthOf(MAX_DISPLAY_POINTS);
    expect(data[data.length - 1]).to.deep.equal({ x: now, y: 21.5 });
    expect(chart.updateCount).to.equal(1);
  });

  it('does not downsample below the threshold (same array reference)', () => {
    const el = makeCard();
    const now = Date.now();
    const chart = makeChart(1, inWindowPoints(100, now, 1800 * 1000));
    el.charts.set('chart-c1-temperature', chart);
    const ref = chart.data.datasets[0].data;
    el.data = { temperature: 21.5, timestamp: now / 1000 };

    el._addPointToSingleChart('temperature', now);

    expect(chart.data.datasets[0].data).to.equal(ref);
    expect(ref).to.have.lengthOf(101);
  });

  it('short ranges keep the sliding-window splice behavior', () => {
    // 1m range: fetchLimit 500 < downsample threshold — splice, not collapse
    const el = makeCard({ timeRange: '1m' });
    const now = Date.now();
    const seed = inWindowPoints(500, now, 60 * 1000);
    const oldestSeed = seed[0];
    const chart = makeChart(1, seed);
    el.charts.set('chart-c1-temperature', chart);
    const ref = chart.data.datasets[0].data;
    el.data = { temperature: 21.5, timestamp: now / 1000 };

    el._addPointToSingleChart('temperature', now);

    const data = chart.data.datasets[0].data;
    expect(data).to.equal(ref); // no reassignment
    expect(data).to.have.lengthOf(500);
    expect(data[0]).to.not.deep.equal(oldestSeed); // oldest dropped
    expect(data[data.length - 1]).to.deep.equal({ x: now, y: 21.5 });
  });

  it('still trims points outside the time window', () => {
    const el = makeCard();
    const now = Date.now();
    const stale = [{ x: now - 1800 * 1000 - 60000, y: 1 }, { x: now - 1800 * 1000 - 30000, y: 2 }];
    const chart = makeChart(1, stale);
    el.charts.set('chart-c1-temperature', chart);
    el.data = { temperature: 21.5, timestamp: now / 1000 };

    el._addPointToSingleChart('temperature', now);

    const data = chart.data.datasets[0].data;
    expect(data).to.have.lengthOf(1);
    expect(data[0]).to.deep.equal({ x: now, y: 21.5 });
  });

  it('caps every dataset on the multi-axis path with one update()', () => {
    const el = makeCard();
    const now = Date.now();
    const chart = makeChart(3, inWindowPoints(1000, now, 1800 * 1000));
    el.charts.set('chart-c1-gyro', chart);
    el.data = { gx: 1, gy: 2, gz: 3, timestamp: now / 1000 };

    el._addPointToChart('gyro', ['gx', 'gy', 'gz'], now);

    const expected = [1, 2, 3];
    chart.data.datasets.forEach((dataset, i) => {
      expect(dataset.data).to.have.lengthOf(MAX_DISPLAY_POINTS);
      expect(dataset.data[dataset.data.length - 1]).to.deep.equal({ x: now, y: expected[i] });
    });
    expect(chart.updateCount).to.equal(1);
  });

  it('is a no-op when the chart is missing', () => {
    const el = makeCard();
    el.data = { temperature: 21.5, timestamp: Date.now() / 1000 };
    expect(() => el._addPointToSingleChart('temperature', Date.now())).to.not.throw();
  });
});

describe('SensorCard activeTab reset on component id change', () => {
  it('resets activeTab to the new component first tab', () => {
    const el = document.createElement('sensor-card');
    el.component = {
      id: 'b',
      config: {
        metrics: [
          { id: 'humidity', keys: ['humidity'] },
          { id: 'temperature', keys: ['temperature'] }
        ]
      }
    };
    el.activeTab = 'stale-tab-from-old-component';

    // Drive updated() directly with the previous component value
    el.updated(new Map([['component', { id: 'a', config: { metrics: [] } }]]));

    expect(el.activeTab).to.equal('humidity');
  });

  it('keeps activeTab when the id is unchanged', () => {
    const el = document.createElement('sensor-card');
    el.component = { id: 'a', config: { metrics: [{ id: 'humidity', keys: ['humidity'] }] } };
    el.activeTab = 'humidity';

    el.updated(new Map([['component', { id: 'a', config: { metrics: [{ id: 'humidity', keys: ['humidity'] }] } }]]));

    expect(el.activeTab).to.equal('humidity');
  });
});
