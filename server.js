// Standalone Railway-compatible file server
require('dotenv').config();

// Bullet-proof startup logging to catch crashes
process.on('uncaughtException', (e) => {
  console.error('Uncaught Exception:', e);
  // don't exit; let health check see 500s instead of 502s while you debug
});
process.on('unhandledRejection', (e) => {
  console.error('Unhandled Rejection:', e);
});

console.log('Booting file server...', {
  node: process.version,
  cwd: process.cwd(),
  portEnv: process.env.PORT,
  tempDirEnv: process.env.TEMP_DIR
});

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

// Debug endpoint to confirm env and cwd
app.get('/debug', (req, res) => {
  res.json({
    pid: process.pid,
    node: process.version,
    cwd: process.cwd(),
    port: process.env.PORT,
    tempDir: TEMP_DIR,
    envKeys: Object.keys(process.env).sort().slice(0, 30) // don't dump secrets
  });
});

// Static files under /files/*
app.use('/files', express.static(TEMP_DIR, {
  fallthrough: true, // Allow 404s to be handled by next middleware
  setHeaders: (res) => {
    res.setHeader('Cache-Control', 'public, max-age=300, immutable');
    res.setHeader('X-Content-Type-Options', 'nosniff');
  }
}));

// Handle 404s for missing files specifically  
app.use('/files', (req, res) => {
  res.status(404).json({ error: 'File not found', path: req.path });
});

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