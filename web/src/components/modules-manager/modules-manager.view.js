import { html } from 'lit';

function statusClass(status) {
  if (status === 'running') return 'status-running';
  if (status === 'error') return 'status-error';
  if (status === 'disabled') return 'status-disabled';
  return 'status-stopped';
}

function statusLabel(status) {
  if (status === 'running') return 'Running';
  if (status === 'error') return 'Error';
  if (status === 'disabled') return 'Disabled';
  return 'Stopped';
}

function formatInterval(ms) {
  if (!ms) return null;
  if (ms >= 60000) return `${ms / 60000}m`;
  if (ms >= 1000) return `${ms / 1000}s`;
  return `${ms}ms`;
}

export function render(el) {
  if (el.modules.length === 0) {
    return html`<div class="empty">No modules discovered.</div>`;
  }

  return html`
    <div class="modules-grid">
      ${el.modules.map(mod => html`
        <div class="module-card ${statusClass(mod.status)}">
          <div class="module-header">
            <div class="module-title">
              <span class="status-dot ${statusClass(mod.status)}"></span>
              <span class="module-name">${mod.name}</span>
              <span class="module-version">v${mod.version || '0.0.0'}</span>
            </div>
            <span class="status-label ${statusClass(mod.status)}">${statusLabel(mod.status)}</span>
          </div>

          ${mod.description ? html`<p class="module-desc">${mod.description}</p>` : ''}

          <div class="module-meta">
            ${mod.components?.read?.length ? html`
              <div class="meta-row">
                <span class="meta-label">Reads</span>
                <span class="meta-value">${mod.components.read.join(', ')}</span>
              </div>
            ` : ''}
            ${mod.components?.write?.length ? html`
              <div class="meta-row">
                <span class="meta-label">Writes</span>
                <span class="meta-value">${mod.components.write.join(', ')}</span>
              </div>
            ` : ''}
            <div class="meta-row">
              <span class="meta-label">Triggers</span>
              <span class="meta-value">
                ${[
                  mod.triggers?.interval ? `Every ${formatInterval(mod.triggers.interval)}` : null,
                  mod.triggers?.onChange?.length ? `onChange: ${mod.triggers.onChange.join(', ')}` : null
                ].filter(Boolean).join(' + ') || 'None'}
              </span>
            </div>
          </div>

          ${mod.status === 'error' && mod.lastError ? html`
            <div class="module-error">${mod.lastError}</div>
          ` : ''}

          <div class="module-actions">
            <button class="btn-toggle ${mod.enabled ? 'on' : ''}"
                    @click=${() => el.toggleModule(mod.id, mod.enabled)}>
              ${mod.enabled ? 'Disable' : 'Enable'}
            </button>
            ${mod.status === 'running' ? html`
              <button class="btn-restart" @click=${() => el.restartModule(mod.id)}>Restart</button>
            ` : ''}
            ${mod.ui?.page ? html`
              <button class="btn-view" @click=${() => el.viewPage(mod.id)}>View Page</button>
            ` : ''}
          </div>
        </div>
      `)}
    </div>
  `;
}
