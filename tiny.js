// Absolute minimum test server for Railway diagnosis
console.log('Environment check:', {
  PORT: process.env.PORT,
  NODE_ENV: process.env.NODE_ENV,
  cwd: process.cwd()
});

require('http')
  .createServer((req, res) => {
    console.log('Request received:', req.method, req.url);
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('TINY SERVER OK');
  })
  .listen(process.env.PORT || 3000, '0.0.0.0', () => {
    console.log('Tiny server up on port', process.env.PORT || 3000);
    console.log('Server should be accessible at Railway URL');
  });