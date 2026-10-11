import { appendFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
export default {
  root: fileURLToPath(new URL('.', import.meta.url)),
  server: { host: '127.0.0.1', port: 5189, strictPort: true, fs: { allow: [fileURLToPath(new URL('../..', import.meta.url))] } },
  plugins: [{ name: 'local-benchmark-results', configureServer(server) {
    server.middlewares.use('/__results', (req, res) => {
      if (req.method !== 'POST') { res.statusCode = 405; res.end(); return; }
      let body = '';
      req.on('data', (data) => { body += data; });
      req.on('end', () => { void appendFile('/tmp/wiki-graph-adapter-results.jsonl', body + '\n').then(() => res.end('ok')); });
    });
  } }],
};
