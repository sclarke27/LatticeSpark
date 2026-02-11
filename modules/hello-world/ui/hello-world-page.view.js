import { html } from 'lit';

export function render(el) {
  const temp = el.sensorData?.temperature_sensor;
  const lastMessage = el.moduleState?.lastMessage;
  const lcdText = el.moduleState?.lcdText ?? '';

  return html`
    <div class="page">
      <h2>Hello World Module</h2>

      <div class="info-grid">
        <div class="info-card">
          <span class="label">Temperature</span>
          <span class="value">${temp?.temperature != null ? `${temp.temperature}°C` : '—'}</span>
        </div>
        <div class="info-card">
          <span class="label">Humidity</span>
          <span class="value">${temp?.humidity != null ? `${temp.humidity}%` : '—'}</span>
        </div>
        <div class="info-card">
          <span class="label">LCD Display</span>
          <span class="value value-sm">${lcdText || '—'}</span>
        </div>
      </div>

      <div class="actions">
        <div class="lcd-control">
          <input type="text"
                 class="lcd-input"
                 placeholder="Text for LCD (16 chars)"
                 maxlength="16"
                 .value=${el.lcdInput}
                 @input=${(e) => { el.lcdInput = e.target.value; }}>
          <button class="btn-action" @click=${() => el.sendLcd()}>Send to LCD</button>
        </div>

        <div class="greet-control">
          <button class="btn-action" @click=${() => el.greet()}>Send Greeting</button>
          ${lastMessage ? html`<p class="result">${lastMessage}</p>` : ''}
        </div>
      </div>
    </div>
  `;
}
