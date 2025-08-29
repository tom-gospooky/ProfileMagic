const fs = require('fs');
const path = require('path');

// Simple file-based storage for user tokens
// In production, consider using a proper database
const TOKENS_FILE = path.join(__dirname, '../../data/user_tokens.json');

// Ensure data directory exists
function ensureDataDirectory() {
  const dataDir = path.dirname(TOKENS_FILE);
  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
  }
}

// Load tokens from file
function loadTokens() {
  try {
    ensureDataDirectory();
    if (!fs.existsSync(TOKENS_FILE)) {
      return {};
    }
    const data = fs.readFileSync(TOKENS_FILE, 'utf8');
    return JSON.parse(data);
  } catch (error) {
    console.error('Error loading user tokens:', error.message);
    return {};
  }
}

// Save tokens to file
function saveTokens(tokens) {
  try {
    ensureDataDirectory();
    fs.writeFileSync(TOKENS_FILE, JSON.stringify(tokens, null, 2));
  } catch (error) {
    console.error('Error saving user tokens:', error.message);
  }
}

// Store user token
function storeUserToken(userId, teamId, userToken) {
  const tokens = loadTokens();
  const key = `${teamId}:${userId}`;
  
  tokens[key] = {
    userId,
    teamId,
    token: userToken,
    createdAt: new Date().toISOString(),
    lastUsed: new Date().toISOString()
  };
  
  saveTokens(tokens);
  console.log(`Stored user token for ${userId} in team ${teamId}`);
}

// Get user token
function getUserToken(userId, teamId) {
  const tokens = loadTokens();
  const key = `${teamId}:${userId}`;
  const tokenData = tokens[key];
  
  if (tokenData) {
    // Update last used timestamp
    tokenData.lastUsed = new Date().toISOString();
    saveTokens(tokens);
    return tokenData.token;
  }
  
  return null;
}

// Check if user is authorized
function isUserAuthorized(userId, teamId) {
  return !!getUserToken(userId, teamId);
}

// Remove user token (for cleanup or logout)
function removeUserToken(userId, teamId) {
  const tokens = loadTokens();
  const key = `${teamId}:${userId}`;
  
  if (tokens[key]) {
    delete tokens[key];
    saveTokens(tokens);
    console.log(`Removed user token for ${userId} in team ${teamId}`);
  }
}

// Get stats about stored tokens
function getTokenStats() {
  const tokens = loadTokens();
  const keys = Object.keys(tokens);
  
  return {
    totalUsers: keys.length,
    users: keys.map(key => {
      const data = tokens[key];
      return {
        userId: data.userId,
        teamId: data.teamId,
        createdAt: data.createdAt,
        lastUsed: data.lastUsed
      };
    })
  };
}

module.exports = {
  storeUserToken,
  getUserToken,
  isUserAuthorized,
  removeUserToken,
  getTokenStats
};