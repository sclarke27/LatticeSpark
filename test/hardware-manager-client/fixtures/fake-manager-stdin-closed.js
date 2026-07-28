#!/usr/bin/env node
// Test fixture: emits the JSON-RPC ready notification, closes its stdin so
// parent writes hit EPIPE, then stays alive (so 'exit' does not fire).
process.stdout.write(JSON.stringify({ jsonrpc: '2.0', method: 'ready', params: {} }) + '\n');
process.stdin.destroy();
setInterval(() => {}, 1000);
