#!/usr/bin/env node
// Fake hardware manager that becomes ready, then dies shortly after —
// used to pin the 'restart' event contract the coordinator consumes.
process.stdout.write(JSON.stringify({ jsonrpc: '2.0', method: 'ready', params: {} }) + '\n');
setTimeout(() => process.exit(1), 100);
