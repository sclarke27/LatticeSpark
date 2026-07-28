import { html } from 'lit';
import { fixture, expect } from '@open-wc/testing';
import { BaseChartCard } from '../../src/components/shared/base-chart-card.js';

class TestChartCard extends BaseChartCard {
  static properties = {
    component: { type: Object },
    data: { type: Object }
  };

  constructor() {
    super();
    this.updateChartsCalls = 0;
    this.livePoints = 0;
  }

  updateCharts() { this.updateChartsCalls++; }

  addLiveDataPoint() { this.livePoints++; }

  render() { return html``; }
}
customElements.define('test-chart-card', TestChartCard);

const COMPONENT = {
  id: 'a',
  config: { metrics: [{ id: 'temperature', unit: '°C', precision: 1 }] }
};

function clone(obj) {
  return JSON.parse(JSON.stringify(obj));
}

describe('BaseChartCard conditional rebuild', () => {
  it('calls updateCharts on initial component assignment', async () => {
    const el = await fixture(html`<test-chart-card .component=${COMPONENT}></test-chart-card>`);
    expect(el.updateChartsCalls).to.equal(1);
  });

  it('skips rebuild when a fresh deep-equal component arrives', async () => {
    const el = await fixture(html`<test-chart-card .component=${COMPONENT}></test-chart-card>`);

    // Simulates a components broadcast: same content, new object reference
    el.component = clone(COMPONENT);
    await el.updateComplete;

    expect(el.updateChartsCalls).to.equal(1);
  });

  it('rebuilds when the component id changes', async () => {
    const el = await fixture(html`<test-chart-card .component=${COMPONENT}></test-chart-card>`);

    el.component = { ...clone(COMPONENT), id: 'b' };
    await el.updateComplete;

    expect(el.updateChartsCalls).to.equal(2);
  });

  it('rebuilds when config.metrics changes', async () => {
    const el = await fixture(html`<test-chart-card .component=${COMPONENT}></test-chart-card>`);

    const changed = clone(COMPONENT);
    changed.config.metrics[0].precision = 3;
    el.component = changed;
    await el.updateComplete;

    expect(el.updateChartsCalls).to.equal(2);
  });

  it('destroys stale charts on a material change', async () => {
    const el = await fixture(html`<test-chart-card .component=${COMPONENT}></test-chart-card>`);
    let destroyed = 0;
    el.charts.set('chart-a-temperature', { destroy: () => { destroyed++; } });

    el.component = { ...clone(COMPONENT), id: 'b' };
    await el.updateComplete;

    expect(destroyed).to.equal(1);
    expect(el.charts.size).to.equal(0);
  });

  it('data updates still schedule live appends when component is unchanged', async () => {
    const el = await fixture(html`<test-chart-card .component=${COMPONENT}></test-chart-card>`);
    el._isVisible = true;

    el.component = clone(COMPONENT); // deep-equal: no rebuild
    el.data = { temperature: 21.5, timestamp: Date.now() / 1000 };
    await el.updateComplete;

    expect(el.updateChartsCalls).to.equal(1);
    expect(el.livePoints).to.equal(1);
  });

  it('_chartConfigChanged treats missing prev/next as changed', async () => {
    const el = await fixture(html`<test-chart-card .component=${COMPONENT}></test-chart-card>`);
    expect(el._chartConfigChanged(undefined, { id: 'a' })).to.be.true;
    expect(el._chartConfigChanged({ id: 'a' }, undefined)).to.be.true;
    expect(el._chartConfigChanged(clone(COMPONENT), clone(COMPONENT))).to.be.false;
  });
});
