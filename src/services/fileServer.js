const express = require('express');
const path = require('path');
const fs = require('fs/promises');

const app = express();

// Choose a safe, writable temp dir
const TEMP_DIR = process.env.TEMP_DIR || path.join(process.cwd(), 'temp');

async function ensureTempDir() {
  await fs.mkdir(TEMP_DIR, { recursive: true });
}

// Basic root + health
app.get('/', (_, res) => res.status(200).json({ 
  service: 'ProfileMagic FileServer',
  status: 'running',
  timestamp: new Date().toISOString()
}));

app.get('/health', (_, res) => res.status(200).json({ 
  status: 'ok',
  service: 'ProfileMagic FileServer',
  timestamp: new Date().toISOString(),
  tempDir: TEMP_DIR
}));

// Static files under /files/*
app.use('/files', express.static(TEMP_DIR, {
  fallthrough: false, // 404 instead of next()
  // Optional: modest caching
  setHeaders: (res) => {
    res.setHeader('Cache-Control', 'public, max-age=300, immutable');
    res.setHeader('X-Content-Type-Options', 'nosniff');
  }
}));

// 404 (for anything else)
app.use((req, res) => res.status(404).json({ error: 'Not found', path: req.path }));

// Simple error handler so we don't crash the process
app.use((err, req, res, next) => {
  console.error('Server error:', err);
  res.status(500).json({ error: 'Internal error' });
});

// Cleanup job (non-blocking)
function startCleanupJob(dir, maxAgeMs = 30 * 60 * 1000) {
  const fsNative = require('fs');
  const { join } = require('path');
  
  setInterval(() => {
    fsNative.promises.readdir(dir)
      .then(files => Promise.all(files.map(async f => {
        const p = join(dir, f);
        try {
          const st = await fsNative.promises.stat(p);
          if (Date.now() - st.mtimeMs > maxAgeMs) {
            await fsNative.promises.unlink(p);
            console.log(`Cleaned up old file: ${f}`);
          }
        } catch (e) {
          console.warn('Cleanup skipped file:', f, e.message);
        }
      })))
      .catch(e => console.warn('Cleanup error:', e.message));
  }, 5 * 60 * 1000).unref(); // don't block shutdown
}

// Utility functions for file management
function getFileUrl(filename) {
  const baseUrl = process.env.BASE_URL || `http://localhost:${process.env.PORT || 3000}`;
  return `${baseUrl}/files/${filename}`;
}

async function saveTemporaryFile(buffer, filename) {
  await ensureTempDir();
  const filePath = path.join(TEMP_DIR, filename);
  await fs.writeFile(filePath, buffer);
  return getFileUrl(filename);
}

// Start server function
async function startFileServer() {
  const PORT = Number(process.env.PORT) || 3000;
  
  try {
    await ensureTempDir();
    console.log(`Created temp directory: ${TEMP_DIR}`);
    
    // Start cleanup job
    startCleanupJob(TEMP_DIR);
    
    return new Promise((resolve, reject) => {
      const server = app.listen(PORT, '0.0.0.0', (err) => {
        if (err) {
          console.error('Failed to start file server:', err);
          reject(err);
        } else {
          console.log(`File server listening on 0.0.0.0:${PORT}, dir: ${TEMP_DIR}`);
          resolve(PORT);
        }
      });
      
      server.on('error', (err) => {
        console.error('File server error:', err);
        reject(err);
      });
    });
  } catch (err) {
    console.error('Failed to init temp dir:', err);
    throw err;
  }
}

module.exports = {
  startFileServer,
  getFileUrl,
  saveTemporaryFile,
  ensureTempDir,
  TEMP_DIR
};