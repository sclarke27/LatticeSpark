import { esbuildPlugin } from '@web/dev-server-esbuild';
import { playwrightLauncher } from '@web/test-runner-playwright';

export default {
  files: 'web/test/**/*.test.js',
  nodeResolve: true,
  rootDir: '..',
  browsers: [playwrightLauncher({ product: 'chromium' })],
  plugins: [
    esbuildPlugin({ ts: true }),
    // Stub SCSS ?inline imports — tests care about logic, not styles
    {
      name: 'scss-inline-stub',
      serve(context) {
        if (context.path.endsWith('.scss') || context.path.includes('.scss?')) {
          return { body: 'export default "";', type: 'js' };
        }
      },
    },
    // Stub chart.js — tests don't need real chart rendering
    {
      name: 'chart-js-stub',
      serve(context) {
        if (context.path.includes('/chart.js/') || context.path.includes('chartjs-adapter')) {
          return {
            body: `
              export class Chart { constructor() {} update() {} destroy() {} }
              export const LineController = {};
              export const LineElement = {};
              export const PointElement = {};
              export const LinearScale = {};
              export const TimeScale = {};
              export const Filler = {};
              export const Tooltip = {};
              export const Legend = {};
              export const CategoryScale = {};
              Chart.register = function() {};
              export default Chart;
            `,
            type: 'js',
          };
        }
      },
    },
    // Stub socket.io-client — tests use mock socket
    {
      name: 'socket-io-stub',
      serve(context) {
        if (context.path.includes('/socket.io-client/')) {
          return {
            body: `
              class MockSocket {
                constructor() {
                  this._handlers = {};
                  this.connected = false;
                  this.id = 'mock-' + Math.random().toString(36).slice(2, 8);
                }
                on(event, fn) { (this._handlers[event] ??= []).push(fn); return this; }
                off(event, fn) {
                  if (!fn) delete this._handlers[event];
                  else this._handlers[event] = (this._handlers[event] || []).filter(h => h !== fn);
                  return this;
                }
                emit(event, ...args) {
                  for (const fn of this._handlers[event] || []) fn(...args);
                  return this;
                }
                connect() { this.connected = true; return this; }
                disconnect() { this.connected = false; return this; }
                close() { this.connected = false; return this; }
              }
              export function io() { return new MockSocket(); }
              export default { io };
            `,
            type: 'js',
          };
        }
      },
    },
  ],
};
