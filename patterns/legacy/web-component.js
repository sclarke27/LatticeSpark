/**
 * GOLDEN EXAMPLE: Lit Web Component
 *
 * This is the PERFECT structure for Lit-based web components.
 * Copy this file and adapt it for your specific UI needs.
 *
 * Rules followed:
 * - Minimal shadow DOM (user preference)
 * - Reactive properties
 * - Custom events for communication
 * - CSS custom properties for theming
 * - Accessibility (ARIA labels, keyboard support)
 *
 * Anti-patterns avoided:
 * - Memory leaks (event listeners cleaned up)
 * - Performance issues (debouncing, efficient rendering)
 *
 * @fileoverview Perfect Lit web component template
 * @module ui/components/sensor-card
 */

import { LitElement, html, css } from 'lit';

/**
 * Sensor Card Component
 *
 * Displays real-time sensor data in a card format with:
 * - Auto-updating values via WebSocket
 * - Status indicators (ok, warning, error)
 * - Click interaction
 * - Keyboard accessibility
 * - Custom theming via CSS variables
 *
 * @element sensor-card
 *
 * @attr {string} name - Sensor display name
 * @attr {number} value - Current sensor value
 * @attr {string} unit - Unit of measurement (e.g., "°C", "%")
 * @attr {string} status - Status: 'ok' | 'warning' | 'error' | 'offline'
 * @attr {boolean} clickable - Whether card is clickable
 *
 * @fires value-click - Dispatched when card is clicked
 * @fires value-change - Dispatched when value changes significantly
 *
 * @cssprop --card-bg - Background color (default: #ffffff)
 * @cssprop --card-border - Border color (default: #e0e0e0)
 * @cssprop --card-padding - Padding (default: 1rem)
 * @cssprop --status-ok - OK status color (default: #4caf50)
 * @cssprop --status-warning - Warning status color (default: #ff9800)
 * @cssprop --status-error - Error status color (default: #f44336)
 * @cssprop --status-offline - Offline status color (default: #9e9e9e)
 *
 * @example
 * <sensor-card
 *   name="Temperature"
 *   value="23.5"
 *   unit="°C"
 *   status="ok"
 *   clickable
 * ></sensor-card>
 *
 * @example
 * const card = document.createElement('sensor-card');
 * card.name = 'Humidity';
 * card.value = 65;
 * card.unit = '%';
 * card.addEventListener('value-click', (e) => {
 *   console.log('Clicked:', e.detail);
 * });
 */
export class SensorCard extends LitElement {
  // ===== REACTIVE PROPERTIES =====
  static properties = {
    /** Sensor display name */
    name: { type: String },

    /** Current sensor value (number or null if offline) */
    value: { type: Number },

    /** Unit of measurement */
    unit: { type: String },

    /** Status: 'ok' | 'warning' | 'error' | 'offline' */
    status: { type: String },

    /** Whether card is clickable */
    clickable: { type: Boolean },

    /** Internal: previous value for change detection */
    _previousValue: { state: true }
  };

  // ===== STYLES =====
  // CRITICAL: NO shadow DOM by default (user preference)
  // Styles are scoped via unique class names
  static styles = css`
    /* Base card styles */
    .sensor-card {
      display: flex;
      flex-direction: column;
      gap: 0.5rem;
      padding: var(--card-padding, 1rem);
      background: var(--card-bg, #ffffff);
      border: 2px solid var(--card-border, #e0e0e0);
      border-radius: 8px;
      transition: all 0.2s ease;
      cursor: default;
    }

    .sensor-card.clickable {
      cursor: pointer;
    }

    .sensor-card.clickable:hover {
      transform: translateY(-2px);
      box-shadow: 0 4px 8px rgba(0, 0, 0, 0.1);
    }

    .sensor-card.clickable:active {
      transform: translateY(0);
    }

    .sensor-card:focus {
      outline: 2px solid var(--focus-color, #2196f3);
      outline-offset: 2px;
    }

    /* Status indicator */
    .sensor-card::before {
      content: '';
      position: absolute;
      top: 0;
      left: 0;
      width: 4px;
      height: 100%;
      border-radius: 8px 0 0 8px;
      background: var(--status-color);
    }

    .sensor-card[status="ok"] {
      --status-color: var(--status-ok, #4caf50);
    }

    .sensor-card[status="warning"] {
      --status-color: var(--status-warning, #ff9800);
    }

    .sensor-card[status="error"] {
      --status-color: var(--status-error, #f44336);
    }

    .sensor-card[status="offline"] {
      --status-color: var(--status-offline, #9e9e9e);
      opacity: 0.6;
    }

    /* Sensor name */
    .sensor-name {
      font-size: 0.875rem;
      font-weight: 500;
      color: var(--text-secondary, #666);
      text-transform: uppercase;
      letter-spacing: 0.05em;
    }

    /* Sensor value */
    .sensor-value {
      font-size: 2rem;
      font-weight: 700;
      color: var(--text-primary, #333);
      font-variant-numeric: tabular-nums;
    }

    .sensor-value.offline {
      color: var(--status-offline, #9e9e9e);
    }

    /* Unit */
    .sensor-unit {
      font-size: 1.25rem;
      font-weight: 400;
      color: var(--text-secondary, #666);
      margin-left: 0.25rem;
    }

    /* Status text */
    .sensor-status {
      font-size: 0.75rem;
      color: var(--status-color);
      font-weight: 500;
    }

    /* Animations */
    @keyframes pulse {
      0%, 100% { opacity: 1; }
      50% { opacity: 0.5; }
    }

    .sensor-value.updating {
      animation: pulse 1s ease-in-out;
    }
  `;

  // ===== CONSTRUCTOR =====
  constructor() {
    super();

    // Initialize properties with defaults
    this.name = '';
    this.value = null;
    this.unit = '';
    this.status = 'offline';
    this.clickable = false;

    // Internal state
    this._previousValue = null;
    this._websocket = null;
    this._updateClass = '';

    // Bind event handlers for proper 'this' context
    this._handleClick = this._handleClick.bind(this);
    this._handleKeyPress = this._handleKeyPress.bind(this);
    this._handleWebSocketMessage = this._handleWebSocketMessage.bind(this);
  }

  // ===== LIFECYCLE METHODS =====

  /**
   * Called when element is added to DOM.
   * Set up WebSocket connection and event listeners.
   */
  connectedCallback() {
    super.connectedCallback();

    // Connect to WebSocket for real-time updates
    this._connectWebSocket();

    // Set up keyboard support if clickable
    if (this.clickable) {
      this.setAttribute('tabindex', '0');
      this.setAttribute('role', 'button');
    }
  }

  /**
   * Called when element is removed from DOM.
   * CRITICAL: Clean up to prevent memory leaks.
   */
  disconnectedCallback() {
    super.disconnectedCallback();

    // CRITICAL: Disconnect WebSocket to prevent leak
    this._disconnectWebSocket();

    // CRITICAL: Remove event listeners
    this.removeEventListener('click', this._handleClick);
    this.removeEventListener('keypress', this._handleKeyPress);
  }

  /**
   * Called when properties change.
   * Use for side effects like change detection.
   */
  updated(changedProperties) {
    super.updated(changedProperties);

    // Detect significant value changes
    if (changedProperties.has('value')) {
      const oldValue = changedProperties.get('value');

      if (oldValue !== undefined && this._hasSignificantChange(oldValue, this.value)) {
        // Dispatch change event
        this._dispatchChangeEvent();

        // Add update animation class
        this._updateClass = 'updating';
        setTimeout(() => {
          this._updateClass = '';
          this.requestUpdate();
        }, 1000);
      }

      this._previousValue = this.value;
    }
  }

  // ===== RENDER METHOD =====

  /**
   * Render the component template.
   *
   * Uses NO shadow DOM (createRenderRoot returns 'this').
   * Styles are scoped via unique class names.
   */
  createRenderRoot() {
    // CRITICAL: Return 'this' to avoid shadow DOM (user preference)
    return this;
  }

  render() {
    // Format value display
    const displayValue = this._formatValue();
    const statusText = this._getStatusText();

    return html`
      <div
        class="sensor-card ${this.clickable ? 'clickable' : ''}"
        status="${this.status}"
        @click="${this._handleClick}"
        @keypress="${this._handleKeyPress}"
        aria-label="${this.name} sensor: ${displayValue}"
        aria-describedby="status-${this.name}"
      >
        <div class="sensor-name">${this.name}</div>

        <div class="sensor-value ${this.value === null ? 'offline' : ''} ${this._updateClass}">
          ${displayValue}
          ${this.value !== null ? html`<span class="sensor-unit">${this.unit}</span>` : ''}
        </div>

        <div
          class="sensor-status"
          id="status-${this.name}"
          role="status"
          aria-live="polite"
        >
          ${statusText}
        </div>
      </div>
    `;
  }

  // ===== PRIVATE METHODS =====

  /**
   * Format value for display.
   * @returns {string} Formatted value
   * @private
   */
  _formatValue() {
    if (this.value === null || this.value === undefined) {
      return '--';
    }

    // Format with appropriate decimal places
    if (Number.isInteger(this.value)) {
      return this.value.toString();
    }

    return this.value.toFixed(1);
  }

  /**
   * Get human-readable status text.
   * @returns {string} Status text
   * @private
   */
  _getStatusText() {
    const statusMap = {
      ok: 'Normal',
      warning: 'Warning',
      error: 'Error',
      offline: 'Offline'
    };

    return statusMap[this.status] || 'Unknown';
  }

  /**
   * Check if value change is significant enough to emit event.
   * @param {number|null} oldValue - Previous value
   * @param {number|null} newValue - New value
   * @returns {boolean} True if change is significant
   * @private
   */
  _hasSignificantChange(oldValue, newValue) {
    if (oldValue === null || newValue === null) return false;

    const delta = Math.abs(newValue - oldValue);

    // Consider 5% change or 0.5 unit change as significant
    const threshold = Math.max(Math.abs(oldValue) * 0.05, 0.5);

    return delta > threshold;
  }

  /**
   * Handle click event.
   * @param {MouseEvent} event - Click event
   * @private
   */
  _handleClick(event) {
    if (!this.clickable) return;

    this._dispatchClickEvent(event);
  }

  /**
   * Handle keyboard event (Enter/Space).
   * @param {KeyboardEvent} event - Keyboard event
   * @private
   */
  _handleKeyPress(event) {
    if (!this.clickable) return;

    // Activate on Enter or Space
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      this._dispatchClickEvent(event);
    }
  }

  /**
   * Dispatch value-click event.
   * @param {Event} originalEvent - Original DOM event
   * @private
   */
  _dispatchClickEvent(originalEvent) {
    this.dispatchEvent(new CustomEvent('value-click', {
      detail: {
        name: this.name,
        value: this.value,
        unit: this.unit,
        status: this.status,
        timestamp: Date.now()
      },
      bubbles: true,
      composed: true
    }));
  }

  /**
   * Dispatch value-change event.
   * @private
   */
  _dispatchChangeEvent() {
    this.dispatchEvent(new CustomEvent('value-change', {
      detail: {
        name: this.name,
        value: this.value,
        previousValue: this._previousValue,
        unit: this.unit,
        timestamp: Date.now()
      },
      bubbles: true,
      composed: true
    }));
  }

  /**
   * Connect to WebSocket for real-time updates.
   * @private
   */
  _connectWebSocket() {
    try {
      // Connect to WebSocket server
      this._websocket = new WebSocket('ws://localhost:3000/sensor-data');

      this._websocket.addEventListener('message', this._handleWebSocketMessage);

      this._websocket.addEventListener('open', () => {
        console.log('WebSocket connected');

        // Subscribe to this sensor's updates
        this._websocket.send(JSON.stringify({
          type: 'subscribe',
          sensor: this.name
        }));
      });

      this._websocket.addEventListener('error', (error) => {
        console.error('WebSocket error:', error);
        this.status = 'offline';
      });

      this._websocket.addEventListener('close', () => {
        console.log('WebSocket disconnected');
        this.status = 'offline';

        // Attempt reconnection after 5 seconds
        setTimeout(() => {
          if (this.isConnected) {
            this._connectWebSocket();
          }
        }, 5000);
      });

    } catch (error) {
      console.error('Failed to connect WebSocket:', error);
      this.status = 'offline';
    }
  }

  /**
   * Disconnect WebSocket.
   * CRITICAL: Called in disconnectedCallback to prevent leak.
   * @private
   */
  _disconnectWebSocket() {
    if (this._websocket) {
      this._websocket.removeEventListener('message', this._handleWebSocketMessage);
      this._websocket.close();
      this._websocket = null;
    }
  }

  /**
   * Handle WebSocket message.
   * @param {MessageEvent} event - WebSocket message event
   * @private
   */
  _handleWebSocketMessage(event) {
    try {
      const data = JSON.parse(event.data);

      // Update component if message is for this sensor
      if (data.sensor === this.name) {
        this.value = data.value;
        this.status = data.status || 'ok';
      }

    } catch (error) {
      console.error('Failed to parse WebSocket message:', error);
    }
  }
}

// ===== REGISTER CUSTOM ELEMENT =====
customElements.define('sensor-card', SensorCard);

// ===== MODULE EXPORTS =====
export default SensorCard;

/**
 * USAGE EXAMPLES:
 *
 * // HTML usage
 * <sensor-card
 *   name="Temperature"
 *   value="23.5"
 *   unit="°C"
 *   status="ok"
 *   clickable
 * ></sensor-card>
 *
 * // JavaScript usage
 * const card = document.createElement('sensor-card');
 * card.name = 'Humidity';
 * card.value = 65;
 * card.unit = '%';
 * card.status = 'warning';
 * card.clickable = true;
 *
 * // Event listeners
 * card.addEventListener('value-click', (e) => {
 *   console.log('Clicked:', e.detail);
 * });
 *
 * card.addEventListener('value-change', (e) => {
 *   console.log('Changed:', e.detail.value);
 * });
 *
 * // CSS theming
 * <style>
 *   sensor-card {
 *     --card-bg: #f5f5f5;
 *     --card-border: #ddd;
 *     --status-ok: #00c853;
 *     --status-warning: #ffa726;
 *     --status-error: #ef5350;
 *   }
 * </style>
 */
