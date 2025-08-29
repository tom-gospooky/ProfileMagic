// Absolute minimum test server for Railway diagnosis
require('http')
  .createServer((_, res) => res.end('TINY SERVER OK'))
  .listen(process.env.PORT || 3000, '0.0.0.0', () => {
    console.log('Tiny server up on', process.env.PORT || 3000);
  });