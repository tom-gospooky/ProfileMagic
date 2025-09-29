const express = require('express');
const path = require('path');
const fs = require('fs/promises');
const axios = require('axios');
const userTokens = require('./userTokens');

const app = express();

// Choose a safe, writable temp dir
const TEMP_DIR = process.env.TEMP_DIR || path.join(process.cwd(), 'temp');

async function ensureTempDir() {
  await fs.mkdir(TEMP_DIR, { recursive: true });
}

// Basic root + health
app.get('/', (_, res) => res.status(200).json({ 
  service: 'Boo FileServer',
  status: 'running',
  timestamp: new Date().toISOString()
}));

app.get('/health', (_, res) => res.status(200).json({ 
  status: 'ok',
  service: 'Boo FileServer',
  timestamp: new Date().toISOString(),
  tempDir: TEMP_DIR
}));

// OAuth routes for user token collection
app.get('/auth/slack', (req, res) => {
  // Extract state parameter which contains user and team info
  const { state } = req.query;
  
  if (!state) {
    return res.status(400).json({ error: 'Missing state parameter' });
  }
  
  try {
    // Decode the state parameter
    const stateData = JSON.parse(Buffer.from(state, 'base64').toString());
    const { userId, teamId } = stateData;
    
    // Build Slack OAuth URL with user scopes
    const scopes = 'users.profile:read,users.profile:write';
    const clientId = process.env.SLACK_CLIENT_ID;
    
    if (!clientId) {
      throw new Error('SLACK_CLIENT_ID not configured');
    }
    
    const oauthUrl = 'https://slack.com/oauth/v2/authorize?' +
      `client_id=${clientId}&` +
      'scope=&' +
      `user_scope=${encodeURIComponent(scopes)}&` +
      `redirect_uri=${encodeURIComponent(getOAuthRedirectUrl())}&` +
      `state=${encodeURIComponent(state)}`;
    
    res.redirect(oauthUrl);
    
  } catch (error) {
    console.error('OAuth initiation error:', error);
    res.status(500).json({ error: 'Failed to initiate OAuth' });
  }
});

app.get('/auth/slack/callback', async (req, res) => {
  const { code, state, error } = req.query;
  
  if (error) {
    console.error('OAuth error:', error);
    return res.status(400).send(`
      <html>
        <body>
          <h2>❌ Authorization Failed</h2>
          <p>Error: ${error}</p>
          <p>Please try again by running the /boo command in Slack.</p>
        </body>
      </html>
    `);
  }
  
  if (!code || !state) {
    return res.status(400).send(`
      <html>
        <body>
          <h2>❌ Invalid Request</h2>
          <p>Missing authorization code or state.</p>
          <p>Please try again by running the /boo command in Slack.</p>
        </body>
      </html>
    `);
  }
  
  try {
    // Decode state to get user info
    const stateData = JSON.parse(Buffer.from(state, 'base64').toString());
    const { userId, teamId } = stateData;
    
    // Exchange code for access token
    const tokenResponse = await axios.post('https://slack.com/api/oauth.v2.access', {
      client_id: process.env.SLACK_CLIENT_ID,
      client_secret: process.env.SLACK_CLIENT_SECRET,
      code: code,
      redirect_uri: getOAuthRedirectUrl()
    }, {
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded'
      }
    });
    
    const { data } = tokenResponse;
    
    if (!data.ok) {
      throw new Error(`OAuth token exchange failed: ${data.error}`);
    }
    
    // Extract user token
    const userToken = data.authed_user?.access_token;
    
    if (!userToken) {
      throw new Error('No user token received from Slack');
    }
    
    // Store the user token
    userTokens.storeUserToken(userId, teamId, userToken);
    
    // Success page
    res.send(`
      <html>
        <head>
          <style>
            body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; margin: 40px; }
            .success { color: #28a745; }
            .container { max-width: 500px; margin: 0 auto; text-align: center; }
          </style>
        </head>
        <body>
          <div class="container">
            <h2 class="success">👻 Authorization Successful!</h2>
            <p>You can close this window and try the <code>/boo</code> command again in Slack.</p>
            <hr>
            <small>Your token is stored securely and only used for profile picture updates.</small>
          </div>
        </body>
      </html>
    `);
    
  } catch (error) {
    console.error('OAuth callback error:', error);
    res.status(500).send(`
      <html>
        <body>
          <h2>❌ Authorization Failed</h2>
          <p>Failed to complete authorization: ${error.message}</p>
          <p>Please try again by running the /boo command in Slack.</p>
        </body>
      </html>
    `);
  }
});

// Static files under /files/*
// Direct-download helper: if query has ?dl=1, force attachment
app.get('/files/:filename', async (req, res, next) => {
  try {
    if (req.query && req.query.dl === '1') {
      const filePath = path.join(TEMP_DIR, req.params.filename);
      return res.download(filePath, req.params.filename);
    }
    return next();
  } catch (e) {
    console.error('Download route error:', e.message);
    return res.status(404).json({ error: 'File not found' });
  }
});

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
function startCleanupJob(dir, maxAgeMs = (Number(process.env.FILE_TTL_MINUTES || 120) * 60 * 1000)) {
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
  // Railway sets RAILWAY_STATIC_URL, or we can construct from other env vars
  const baseUrl = process.env.BASE_URL ||
                  process.env.RAILWAY_STATIC_URL ||
                  `https://profilemagic-production.up.railway.app`;
  const fileUrl = `${baseUrl}/files/${filename}`;
  console.log(`Generated file URL: ${fileUrl}`);
  return fileUrl;
}

function getOAuthRedirectUrl() {
  const baseUrl = process.env.BASE_URL || `http://localhost:${process.env.PORT || 3000}`;
  return `${baseUrl}/auth/slack/callback`;
}

function getOAuthUrl(userId, teamId) {
  const baseUrl = process.env.BASE_URL || `http://localhost:${process.env.PORT || 3000}`;
  const state = Buffer.from(JSON.stringify({ userId, teamId })).toString('base64');
  return `${baseUrl}/auth/slack?state=${encodeURIComponent(state)}`;
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
  getOAuthUrl,
  getOAuthRedirectUrl,
  saveTemporaryFile,
  ensureTempDir,
  TEMP_DIR
};
