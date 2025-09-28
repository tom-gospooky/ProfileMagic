/**
 * Short-lived cache for recent image files to support modal file selection
 * Stores candidate files by {team_id, user_id, channel_id} for a few minutes
 */

const fileCache = new Map();
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

function getCacheKey(teamId, userId, channelId) {
  return `${teamId}:${userId}:${channelId}`;
}

function cleanExpiredEntries() {
  const now = Date.now();
  for (const [key, entry] of fileCache.entries()) {
    if (now - entry.timestamp > CACHE_TTL) {
      fileCache.delete(key);
    }
  }
}

function setCachedFiles(teamId, userId, channelId, files) {
  cleanExpiredEntries();
  const key = getCacheKey(teamId, userId, channelId);
  fileCache.set(key, {
    files,
    timestamp: Date.now()
  });
}

function getCachedFiles(teamId, userId, channelId) {
  cleanExpiredEntries();
  const key = getCacheKey(teamId, userId, channelId);
  const entry = fileCache.get(key);
  return entry ? entry.files : null;
}

function clearCache(teamId, userId, channelId) {
  const key = getCacheKey(teamId, userId, channelId);
  fileCache.delete(key);
}

module.exports = {
  setCachedFiles,
  getCachedFiles,
  clearCache
};