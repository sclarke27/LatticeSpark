import { html } from 'lit';
import { html as staticHtml, unsafeStatic } from 'lit/static-html.js';
import { themes, getThemeList } from './theme-registry.js';
import { modulePages } from '../../module-manifest.js';

// Map component types to their card tag names.
// To add a new card: add its type here and import it in crowpi-dashboard.js.
const CARD_REGISTRY = {
  LCD1602: 'lcd-card',
  Vibration: 'vibration-card',
  Buttons: 'buttons-card',
  SevenSegment: 'segment-card',
  Buzzer: 'buzzer-card',
  LEDMatrix: 'matrix-card',
  Servo: 'servo-card',
  Stepper: 'stepper-card',
  Relay: 'relay-card',
  PixelStrip: 'pixelstrip-card'
};

function getCardTag(component) {
  return CARD_REGISTRY[component.type] || 'sensor-card';
}

function renderCard(component, data, theme) {
  const tag = unsafeStatic(getCardTag(component));
  return staticHtml`<${tag} .component=${component} .data=${data} theme=${theme}></${tag}>`;
}

function getStatusClass(el) {
  if (el.connected) return 'online';
  if (el.reconnecting) return 'reconnecting';
  return 'offline';
}

function getStatusText(el) {
  if (el.connected) return 'Connected';
  if (el.reconnecting) return 'Reconnecting...';
  return 'Disconnected';
}

function getLedClass(el, index) {
  // 0=PWR, 1=LINK, 2=ERR
  if (index === 0) return el.connected ? 'on-green' : 'off';
  if (index === 1) return el.reconnecting ? 'on-amber' : (el.connected ? 'on-green' : 'off');
  return (!el.connected && !el.reconnecting) ? 'on-red' : 'off';
}

function getStatusDotClass(el) {
  const sc = getStatusClass(el);
  if (sc === 'online') return 'on-green';
  if (sc === 'reconnecting') return 'on-amber';
  return 'on-red';
}

// ── Shared Fragments ──

function renderThemeSelector(el) {
  const list = getThemeList();
  return html`
    <select class="theme-select"
            .value=${el.theme}
            @change=${(e) => el.setTheme(e.target.value)}>
      ${list.map(t => html`<option value=${t.value}>${t.label}</option>`)}
    </select>
  `;
}

// ── Default Header ──

function renderDefaultHeader(el) {
  return html`
    <div class="header">
      <div class="header-content">
        <h1>CrowPi3 Dashboard</h1>
        <div class="header-right">
          ${renderThemeSelector(el)}
          <div class="status">
            <span class="status-indicator ${getStatusClass(el)}"></span>
            ${getStatusText(el)}
          </div>
        </div>
      </div>
    </div>
  `;
}

// ── Universal Themed Chrome ──

function renderThemedTopBar(el, config) {
  return html`
    <div class="chrome-top-bar">
      <div class="chrome-brand">
        ${config.brandDot ? html`<span class="chrome-brand-dot">${config.brandDot}</span>` : ''}
        <h1 class="chrome-title">${config.brandTitle}</h1>
        ${config.brandSub ? html`<span class="chrome-brand-sub">${config.brandSub}</span>` : ''}
        ${config.modelBadge ? html`<span class="chrome-badge">${config.modelBadge}</span>` : ''}
      </div>
      <div class="chrome-right">
        ${config.leds ? html`
          <div class="chrome-indicators">
            ${config.leds.map((label, i) => html`
              <div class="chrome-led ${getLedClass(el, i)}"></div>
              <span class="chrome-led-label">${label}</span>
            `)}
          </div>
        ` : ''}
        ${config.powerLed ? html`
          <div class="chrome-power">
            <div class="chrome-power-led"></div>
            <span class="chrome-power-label">POWER</span>
          </div>
        ` : ''}
        ${config.showClock ? html`<div class="chrome-clock">${el.clockTime}</div>` : ''}
        ${renderThemeSelector(el)}
        <div class="chrome-status">
          <div class="chrome-led ${getStatusDotClass(el)}"></div>
          <span class="chrome-status-label ${getStatusClass(el)}">${getStatusText(el).toUpperCase()}</span>
        </div>
      </div>
    </div>
    ${config.bezelStrip ? html`<div class="chrome-strip"></div>` : ''}
  `;
}

function renderThemedBottomBar(config) {
  if (!config.bottomLeft && !config.bottomRight) return '';
  return html`
    ${config.bezelStrip ? html`<div class="chrome-strip"></div>` : ''}
    <div class="chrome-bottom-bar">
      <span class="chrome-bottom-text">${config.bottomLeft || ''}</span>
      ${config.vents ? html`
        <div class="chrome-vents">
          ${Array(config.vents).fill(0).map(() => html`<div class="chrome-vent"></div>`)}
        </div>
      ` : ''}
      <span class="chrome-bottom-text">${config.bottomRight || ''}</span>
    </div>
  `;
}

// ── Tab Bar ──

function renderTabBar(el) {
  return html`
    <div class="tab-bar">
      <button class="tab-item ${el.activeView === 'dashboard' ? 'active' : ''}"
              @click=${() => { el.activeView = 'dashboard'; }}>
        Dashboard
      </button>
      <button class="tab-item ${el.activeView === 'modules' ? 'active' : ''}"
              @click=${() => { el.activeView = 'modules'; }}>
        Modules
      </button>
      ${el.modulePages.map(mod => html`
        <button class="tab-item ${el.activeView === mod.id ? 'active' : ''}"
                @click=${() => { loadModulePage(mod.id); el.activeView = mod.id; }}>
          ${mod.ui?.label || mod.name}
        </button>
      `)}
    </div>
  `;
}

// Track which module pages have been loaded
const loadedPages = new Set();

export function loadModulePage(moduleId) {
  if (loadedPages.has(moduleId)) return;
  const loader = modulePages[moduleId];
  if (loader) {
    loader();
    loadedPages.add(moduleId);
  }
}

const SAFE_ID_RE = /^[a-z][a-z0-9-]*$/;

function renderModulePage(el) {
  const moduleId = el.activeView;
  if (!SAFE_ID_RE.test(moduleId)) return html`<div class="error">Invalid module ID</div>`;
  const tag = unsafeStatic(`${moduleId}-page`);
  return staticHtml`<${tag}
    .moduleId=${moduleId}
    .moduleState=${el.moduleStates[moduleId] ?? null}
    .sensorData=${el.sensorData}
    theme=${el.theme}
  ></${tag}>`;
}

// ── Main Render ──

export function render(el) {
  const config = themes[el.theme] || themes.default;
  const isDefault = !config.brandTitle;

  return html`
    ${isDefault ? renderDefaultHeader(el) : renderThemedTopBar(el, config)}
    ${renderTabBar(el)}

    <div class="container">
      ${el.activeView === 'dashboard'
        ? (el.components.length === 0
            ? html`<div class="loading">Loading sensors...</div>`
            : html`
                <div class="sensors-grid">
                  ${el.components
                    .filter(component => component.type !== 'Camera')
                    .map(component =>
                      renderCard(component, el.sensorData[component.id], el.theme)
                    )}
                </div>
              `
          )
        : el.activeView === 'modules'
          ? html`<modules-manager .modules=${el.allModules} theme=${el.theme}></modules-manager>`
          : renderModulePage(el)
      }
    </div>

    ${!isDefault ? renderThemedBottomBar(config) : ''}
  `;
}
