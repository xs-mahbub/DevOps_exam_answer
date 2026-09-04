const http = require('http');
const os = require('os');

const server = http.createServer((req, res) => {
  res.setHeader('X-Served-By', os.hostname());
  res.setHeader('X-App-Version', process.env.APP_VERSION || 'v1');
  
  if (req.url === '/healthz') {
    if (process.env.FAIL_HEALTH === 'true') {
      res.writeHead(500, { 'Content-Type': 'text/plain' });
      return res.end('Unhealthy');
    }
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    return res.end('OK');
  }
  
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ status: 'running', version: process.env.APP_VERSION || 'v1', host: os.hostname() }));
});

server.listen(3000, () => {
  console.log('App running on port 3000');
});
