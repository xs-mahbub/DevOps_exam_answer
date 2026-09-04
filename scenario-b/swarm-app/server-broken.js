const http = require('http');
const server = http.createServer((req, res) => {
  res.writeHead(500);
  res.end('Broken');
});
server.listen(3000);
