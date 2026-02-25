import express from 'express';
import { createServer } from 'node:http';
import { createLogger } from '../utils/logger.js';

/**
 * Base class for LatticeSpark HTTP services.
 *
 * Provides shared boilerplate: Express app, HTTP server, signal handlers,
 * health check, graceful shutdown with force-exit timeout.
 *
 * Subclasses override:
 * - initialize() — register routes, Socket.IO, connect to dependencies
 * - onShutdown() — service-specific cleanup (stop polling, close sockets, etc.)
 */
export class BaseService {
  /**
   * @param {string} name - Service name (used in logs and health check)
   * @param {Object} options
   * @param {number} options.port - Port to listen on
   * @param {Object} [options.expressOptions] - Options passed to express.json()
   */
  constructor(name, { port, expressOptions } = {}) {
    this.name = name;
    this.port = port;
    this.log = createLogger(name);
    this.app = express();
    this.httpServer = createServer(this.app);
    this.app.use(express.json(expressOptions));
    this._shutdownCalled = false;
  }

  /**
   * Override to register routes, Socket.IO, connect to dependencies, etc.
   * Called by start() before the server begins listening.
   */
  async initialize() {}

  /**
   * Override for service-specific shutdown logic.
   * Called by shutdown() before closing the HTTP server.
   */
  async onShutdown() {}

  /**
   * Register a /health endpoint.
   * @param {function} checkFn - Async function returning the health payload.
   *   Should return { status: 'ok' | 'degraded', ...details }.
   */
  registerHealthCheck(checkFn) {
    this.app.get('/health', async (req, res) => {
      try {
        const result = await checkFn(req);
        const status = result.status === 'ok' ? 200 : 503;
        res.status(status).json(result);
      } catch (err) {
        res.status(503).json({ status: 'error', error: err.message });
      }
    });
  }

  /**
   * Start the service: set up handlers, initialize, and listen.
   * @returns {Promise<void>} Resolves when the server is listening.
   */
  async start() {
    this._setupProcessHandlers();
    this._setupPortErrorHandler();

    await this.initialize();

    return new Promise((resolve) => {
      this.httpServer.listen(this.port, () => {
        this.log.info('Listening on port %d', this.port);
        resolve();
      });
    });
  }

  /**
   * Gracefully shut down the service.
   * @param {number} [timeoutMs=10000] - Force-exit after this many ms
   */
  async shutdown(timeoutMs = 10000) {
    if (this._shutdownCalled) return;
    this._shutdownCalled = true;

    this.log.info('Shutting down...');
    const forceTimer = setTimeout(() => {
      this.log.error('Force exit after %dms', timeoutMs);
      process.exit(1);
    }, timeoutMs);
    forceTimer.unref(); // Don't keep process alive just for the timer

    try {
      await this.onShutdown();
      this.httpServer.close(() => {
        clearTimeout(forceTimer);
        process.exit(0);
      });
    } catch (err) {
      this.log.error({ err }, 'Shutdown error');
      clearTimeout(forceTimer);
      process.exit(1);
    }
  }

  /** @private */
  _setupProcessHandlers() {
    process.on('SIGINT', () => this.shutdown());
    process.on('SIGTERM', () => this.shutdown());
    process.on('unhandledRejection', (reason) => {
      this.log.error({ err: reason }, 'Unhandled promise rejection');
    });
  }

  /** @private */
  _setupPortErrorHandler() {
    this.httpServer.on('error', (err) => {
      if (err.code === 'EADDRINUSE') {
        this.log.error('Port %d already in use. Kill the old process or choose a different port.', this.port);
      } else {
        this.log.error({ err }, 'Server error');
      }
      process.exit(1);
    });
  }
}
