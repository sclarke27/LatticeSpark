#!/usr/bin/env node
/**
 * Camera Client
 *
 * HTTP client for communicating with the standalone Camera Service.
 * Camera service runs as its own PM2 process — no process spawning needed.
 *
 * Features:
 * - REST API calls for camera control (fetch-based)
 * - Health polling to detect camera readiness
 * - SSE subscription for real-time detection events
 * - EventEmitter for notifications and errors
 *
 * Events:
 * - 'ready' - Camera service is healthy and ready
 * - 'detection' - ML detection event from SSE stream
 * - 'error' - Error occurred
 * - 'disconnected' - Camera service became unreachable
 */

import http from 'http';
import { EventEmitter } from 'events';

export class CameraClient extends EventEmitter {
  static DEFAULT_CONFIG = {
    url: 'http://localhost:8081',
    pollInterval: 5000,    // Health poll interval (ms)
    connectTimeout: 15000, // Initial connect timeout (ms)
    requestTimeout: 10000, // Per-request timeout (ms)
  };

  #baseUrl;
  #isReady;
  #pollTimer;
  #sseRequest;
  #config;

  constructor(config = {}) {
    super();
    this.#config = { ...CameraClient.DEFAULT_CONFIG, ...config };
    this.#baseUrl = this.#config.url;
    this.#isReady = false;
    this.#pollTimer = null;
    this.#sseRequest = null;
  }

  /** Whether the camera service is ready. */
  get isReady() {
    return this.#isReady;
  }

  /** Base URL of the camera service. */
  get baseUrl() {
    return this.#baseUrl;
  }

  /** MJPEG port (extracted from base URL for proxy compatibility). */
  get mjpegPort() {
    try {
      return new URL(this.#baseUrl).port || 8081;
    } catch {
      return 8081;
    }
  }

  /**
   * Start monitoring the camera service.
   * Polls /health continuously — emits 'ready' and 'disconnected' as service
   * comes and goes. Never times out, never stops (until cleanup()).
   * Use this for resilient startup where camera-service may start later.
   */
  startMonitoring() {
    this.#startHealthPoll();
  }

  /**
   * Connect to the camera service.
   * Polls /health until the service responds, then subscribes to SSE detections.
   * Resolves when the camera is ready, or rejects on timeout.
   */
  async connect() {
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.#stopHealthPoll();
        reject(new Error('Camera service did not become ready'));
      }, this.#config.connectTimeout);

      this.once('ready', (status) => {
        clearTimeout(timeout);
        resolve(status);
      });

      this.#startHealthPoll();
    });
  }

  /**
   * Poll /health at regular intervals.
   * Emits 'ready' on first successful response, 'disconnected' when it goes away.
   * @private
   */
  #startHealthPoll() {
    const poll = async () => {
      try {
        const status = await this.#fetch('/health');
        if (!this.#isReady) {
          this.#isReady = true;
          this.#subscribeDetections();
          this.emit('ready', status);
        }
      } catch {
        if (this.#isReady) {
          this.#isReady = false;
          this.#unsubscribeDetections();
          this.emit('disconnected');
        }
      }
    };

    // Poll immediately, then at interval
    poll();
    this.#pollTimer = setInterval(poll, this.#config.pollInterval);
  }

  #stopHealthPoll() {
    if (this.#pollTimer) {
      clearInterval(this.#pollTimer);
      this.#pollTimer = null;
    }
  }

  /**
   * Subscribe to SSE detection events from the camera service.
   * @private
   */
  #subscribeDetections() {
    if (this.#sseRequest) return;

    const url = new URL('/api/detections/stream', this.#baseUrl);
    const req = http.request(url, (res) => {
      if (res.statusCode !== 200) {
        return;
      }

      let buffer = '';
      res.setEncoding('utf-8');
      res.on('data', (chunk) => {
        buffer += chunk;
        // Parse SSE events (data: {json}\n\n)
        const parts = buffer.split('\n\n');
        buffer = parts.pop(); // Keep incomplete part

        for (const part of parts) {
          const lines = part.split('\n');
          for (const line of lines) {
            if (line.startsWith('data: ')) {
              try {
                const data = JSON.parse(line.slice(6));
                this.emit('detection', data);
              } catch {
                // Ignore parse errors
              }
            }
            // Skip keepalive comments (lines starting with ':')
          }
        }
      });

      res.on('end', () => {
        this.#sseRequest = null;
        // Resubscribe immediately if camera is still ready
        if (this.#isReady) {
          this.#subscribeDetections();
        }
      });
    });

    req.on('error', () => {
      this.#sseRequest = null;
    });

    req.end();
    this.#sseRequest = req;
  }

  #unsubscribeDetections() {
    if (this.#sseRequest) {
      this.#sseRequest.destroy();
      this.#sseRequest = null;
    }
  }

  // --- REST API Methods ---

  /** Get camera status. */
  async getStatus() {
    return this.#fetch('/api/status');
  }

  /** Get list of available processors with status. */
  async getProcessors() {
    return this.#fetch('/api/processors');
  }

  /** Enable an ML processor by name. */
  async enableProcessor(name) {
    return this.#fetch('/api/processors/enable', {
      method: 'POST',
      body: { name },
    });
  }

  /** Disable an ML processor by name. */
  async disableProcessor(name) {
    return this.#fetch('/api/processors/disable', {
      method: 'POST',
      body: { name },
    });
  }

  /**
   * Fetch helper with timeout and JSON parsing.
   * @private
   */
  async #fetch(path, options = {}) {
    const url = `${this.#baseUrl}${path}`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.#config.requestTimeout);

    try {
      const fetchOptions = {
        method: options.method || 'GET',
        signal: controller.signal,
      };

      if (options.body) {
        fetchOptions.headers = { 'Content-Type': 'application/json' };
        fetchOptions.body = JSON.stringify(options.body);
      }

      const response = await fetch(url, fetchOptions);
      const data = await response.json();

      if (!response.ok) {
        const error = new Error(data.error || `HTTP ${response.status}`);
        error.status = response.status;
        throw error;
      }

      return data;
    } finally {
      clearTimeout(timer);
    }
  }

  /**
   * Clean up — stop polling and SSE subscription.
   */
  cleanup() {
    this.#stopHealthPoll();
    this.#unsubscribeDetections();
    this.#isReady = false;
    this.removeAllListeners();
  }
}

/**
 * Create and connect a camera client.
 */
export async function createCameraClient(config = {}) {
  const client = new CameraClient(config);
  await client.connect();
  return client;
}
