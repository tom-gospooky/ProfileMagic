// Standalone Railway-compatible file server
require('dotenv').config();
const express = require('express');
const path = require('path');
const fs = require('fs/promises');

const app = express();

// Choose a safe, writable temp dir
const TEMP_DIR = process.env.TEMP_DIR || path.join(process.cwd(), 'temp');

async function ensureTempDir() {
  try {
    await fs.mkdir(TEMP_DIR, { recursive: true });
    console.log(`✅ Temp directory ready: ${TEMP_DIR}`);
  } catch (err) {
    console.error('❌ Failed to create temp dir:', err);
    throw err;
  }
}

// Basic root + health
app.get('/', (_, res) => res.status(200).json({ 
  service: 'ProfileMagic FileServer',
  status: 'running',
  timestamp: new Date().toISOString(),
  port: process.env.PORT,
  tempDir: TEMP_DIR
}));

app.get('/health', (_, res) => res.status(200).json({ 
  status: 'ok',
  service: 'ProfileMagic FileServer',
  timestamp: new Date().toISOString(),
  port: process.env.PORT
}));

// Static files under /files/*
app.use('/files', express.static(TEMP_DIR, {
  fallthrough: false,
  setHeaders: (res) => {
    res.setHeader('Cache-Control', 'public, max-age=300, immutable');
    res.setHeader('X-Content-Type-Options', 'nosniff');
  }
}));

// 404 handler
app.use((req, res) => {
  console.log(`404: ${req.method} ${req.path}`);
  res.status(404).json({ error: 'Not found', path: req.path });
});

// Error handler
app.use((err, req, res, next) => {
  console.error('Server error:', err);
  res.status(500).json({ error: 'Internal error' });
});

const PORT = Number(process.env.PORT) || 3000;

console.log(`🚀 Starting ProfileMagic FileServer...`);
console.log(`🔧 PORT: ${process.env.PORT} (using ${PORT})`);
console.log(`📁 TEMP_DIR: ${TEMP_DIR}`);

ensureTempDir().then(() => {
  app.listen(PORT, '0.0.0.0', (err) => {
    if (err) {
      console.error('❌ Failed to start server:', err);
      process.exit(1);
    }
    console.log(`✅ File server listening on 0.0.0.0:${PORT}`);
    console.log(`🔗 Health check: http://localhost:${PORT}/health`);
  });
}).catch(err => {
  console.error('❌ Failed to initialize:', err);
  process.exit(1);
});