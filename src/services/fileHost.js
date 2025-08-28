const express = require('express');
const path = require('path');
const fs = require('fs');

let fileServer = null;
const PORT = process.env.FILE_HOST_PORT || 3001;

function startFileServer() {
  if (fileServer) {
    return Promise.resolve(PORT);
  }

  return new Promise((resolve, reject) => {
    const app = express();
    
    // Serve static files from temp directory
    const tempDir = path.join(__dirname, '../../temp');
    if (!fs.existsSync(tempDir)) {
      fs.mkdirSync(tempDir, { recursive: true });
    }
    
    app.use('/files', express.static(tempDir));
    
    fileServer = app.listen(PORT, (err) => {
      if (err) {
        reject(err);
      } else {
        console.log(`File server running on port ${PORT}`);
        resolve(PORT);
      }
    });
  });
}

function getFileUrl(filename) {
  const baseUrl = process.env.BASE_URL || `http://localhost:${PORT}`;
  return `${baseUrl}/files/${filename}`;
}

function saveTemporaryFile(buffer, filename) {
  const tempDir = path.join(__dirname, '../../temp');
  if (!fs.existsSync(tempDir)) {
    fs.mkdirSync(tempDir, { recursive: true });
  }
  
  const filePath = path.join(tempDir, filename);
  fs.writeFileSync(filePath, buffer);
  
  return getFileUrl(filename);
}

function cleanupOldFiles() {
  const tempDir = path.join(__dirname, '../../temp');
  if (!fs.existsSync(tempDir)) {
    return;
  }

  const files = fs.readdirSync(tempDir);
  const now = Date.now();
  const maxAge = 30 * 60 * 1000; // 30 minutes

  files.forEach(file => {
    const filePath = path.join(tempDir, file);
    const stat = fs.statSync(filePath);
    
    if (now - stat.mtime.getTime() > maxAge) {
      fs.unlinkSync(filePath);
      console.log(`Cleaned up old file: ${file}`);
    }
  });
}

// Clean up old files every 15 minutes
setInterval(cleanupOldFiles, 15 * 60 * 1000);

module.exports = {
  startFileServer,
  getFileUrl,
  saveTemporaryFile,
  cleanupOldFiles
};