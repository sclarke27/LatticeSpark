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

function renderLocalModules(el) {
  if (el.modules.length === 0) {
    return html`<div class="empty">No local modules discovered.</div>`;
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

function renderSpokeControls(el) {
  const selectedSpoke = el.spokes.find(s => s.nodeId === el.selectedNodeId) || null;
  const selectedJob = el.fleetJobs?.[el.selectedNodeId] || null;
  const selectedModules = el.spokeModules?.[el.selectedNodeId] || [];
  const moduleBundleOptions = el.moduleBundles.map(b => `${b.bundleId}@${b.version}`);
  const firmwareBundleOptions = el.firmwareBundles.map(b => `${b.bundleId}@${b.version}`);

  return html`
    <section class="fleet-section">
      <h3>Spokes</h3>
      ${el.fleetError ? html`<div class="fleet-error">${el.fleetError}</div>` : ''}
      ${el.spokes.length === 0 ? html`<div class="empty">No spokes connected.</div>` : html`
        <div class="fleet-grid">
          <div class="fleet-panel">
            <label class="field-label" for="spoke-select">Selected Spoke</label>
            <select id="spoke-select" class="field-input"
                    .value=${el.selectedNodeId}
                    @change=${(e) => { el.selectedNodeId = e.target.value; }}>
              ${el.spokes.map(spoke => html`
                <option value=${spoke.nodeId}>
                  ${spoke.nodeId} (${spoke.connected ? 'online' : 'offline'})
                </option>
              `)}
            </select>
            ${selectedSpoke ? html`
              <div class="spoke-meta">
                <span>Status: ${selectedSpoke.connected ? 'online' : 'offline'}</span>
                <span>Queue: ${selectedSpoke.queueDepth ?? 0}</span>
                <span>Ack: ${selectedSpoke.replayAckSeq ?? 0}</span>
              </div>
            ` : ''}
            ${selectedJob ? html`
              <div class="spoke-job">
                <span>Firmware Job: ${selectedJob.jobId || 'n/a'}</span>
                <span>Status: ${selectedJob.status || 'unknown'}</span>
                ${selectedJob.detail ? html`<span>Detail: ${selectedJob.detail}</span>` : ''}
              </div>
            ` : ''}
          </div>

          <div class="fleet-panel">
            <label class="field-label" for="remote-module-id">Remote Module ID</label>
            <input id="remote-module-id" class="field-input" type="text" placeholder="my-module"
                   .value=${el.remoteModuleId}
                   @input=${(e) => { el.remoteModuleId = e.target.value.trim(); }}>
            ${selectedModules.length > 0 ? html`
              <div class="remote-module-list">
                ${selectedModules.map(mod => html`
                  <button class="module-chip" @click=${() => { el.remoteModuleId = mod.id; }}>
                    ${mod.id} (${mod.status})
                  </button>
                `)}
              </div>
            ` : ''}
            <div class="panel-actions">
              <button class="btn-secondary"
                      @click=${() => el.dispatchSpokeModuleAction(el.remoteModuleId, 'enable')}>Enable</button>
              <button class="btn-secondary"
                      @click=${() => el.dispatchSpokeModuleAction(el.remoteModuleId, 'disable')}>Disable</button>
              <button class="btn-secondary"
                      @click=${() => el.dispatchSpokeModuleAction(el.remoteModuleId, 'restart')}>Restart</button>
            </div>
          </div>

          <div class="fleet-panel">
            <label class="field-label" for="module-bundle">Module Bundle</label>
            <select id="module-bundle" class="field-input"
                    .value=${el.deployModuleRef}
                    @change=${(e) => { el.deployModuleRef = e.target.value; }}>
              <option value="">Select bundle</option>
              ${moduleBundleOptions.map(ref => html`<option value=${ref}>${ref}</option>`)}
            </select>
            <div class="panel-actions">
              <button class="btn-primary" @click=${() => el.dispatchModuleDeploy()}>Deploy Module</button>
            </div>
          </div>

          <div class="fleet-panel">
            <label class="field-label" for="firmware-bundle">Firmware Bundle</label>
            <select id="firmware-bundle" class="field-input"
                    .value=${el.deployFirmwareRef}
                    @change=${(e) => { el.deployFirmwareRef = e.target.value; }}>
              <option value="">Select firmware</option>
              ${firmwareBundleOptions.map(ref => html`<option value=${ref}>${ref}</option>`)}
            </select>
            <label class="field-label" for="firmware-source-id">Source ID</label>
            <input id="firmware-source-id" class="field-input" type="text" placeholder="uno-main"
                   .value=${el.firmwareSourceId}
                   @input=${(e) => { el.firmwareSourceId = e.target.value; }}>
            <div class="panel-actions">
              <button class="btn-primary" @click=${() => el.dispatchFirmwareDeploy()}>Deploy Firmware</button>
              <button class="btn-secondary" @click=${() => el.dispatchFirmwareRollback()}>Rollback</button>
            </div>
          </div>
        </div>
      `}
    </section>
  `;
}

export function render(el) {
  return html`
    <section>
      <h3>Local Modules</h3>
      ${renderLocalModules(el)}
    </section>
    ${el.fleetEnabled
      ? renderSpokeControls(el)
      : html`
        <section class="fleet-section">
          <h3>Spokes</h3>
          <div class="empty">Fleet controls are available on hub nodes only.</div>
        </section>
      `}
  `;
}
