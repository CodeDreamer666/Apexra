const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
async function serveGame(root, transform = s => s) {
  root = path.resolve(root);
  const server = http.createServer((req, res) => {
    const route = new URL(req.url, 'http://localhost').pathname;
    const target = path.resolve(root, '.' + (route === '/' ? '/index.html' : decodeURIComponent(route)));
    if (!target.startsWith(root + path.sep)) { res.writeHead(403); res.end(); return; }
    try {
      let body = fs.readFileSync(target);
      if (target.endsWith('.html')) body = transform(body.toString());
      const mime = target.endsWith('.html') ? 'text/html' : target.endsWith('.js') ? 'application/javascript' : target.endsWith('.png') ? 'image/png' : target.endsWith('.ico') ? 'image/x-icon' : 'application/octet-stream';
      res.writeHead(200, { 'Content-Type': mime, 'Cache-Control': 'no-store' }); res.end(body);
    } catch { res.writeHead(404); res.end(); }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  return { url: 'http://127.0.0.1:' + server.address().port, close: () => new Promise(resolve => server.close(resolve)) };
}
module.exports = { serveGame };
