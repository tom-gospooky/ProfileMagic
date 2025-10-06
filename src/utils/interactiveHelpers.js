/**
 * Utility functions for interactive handlers
 */

/**
 * Parse action value from body with error handling
 * @param {object} body - Slack body object
 * @param {*} defaultValue - Default value if parsing fails
 * @returns {*} Parsed value or default
 */
function parseActionValue(body, defaultValue = null) {
  try {
    const raw = body.actions?.[0]?.value;
    return raw ? JSON.parse(raw) : defaultValue;
  } catch {
    return defaultValue;
  }
}

/**
 * Parse private metadata from view with error handling
 * @param {object} view - Slack view object
 * @param {*} defaultValue - Default value if parsing fails
 * @returns {*} Parsed metadata or default
 */
function parsePrivateMetadata(view, defaultValue = {}) {
  try {
    return JSON.parse(view.private_metadata || '{}');
  } catch {
    return defaultValue;
  }
}

/**
 * Extract channel ID from various body structures
 * @param {object} body - Slack body object
 * @param {object} shortcut - Slack shortcut object (optional)
 * @param {object} container - Container object (optional)
 * @param {object} message - Message object (optional)
 * @returns {string|null} Channel ID or null
 */
function extractChannelId(body, shortcut = null, container = null, message = null) {
  return (
    shortcut?.channel?.id ||
    shortcut?.channel_id ||
    body?.channel?.id ||
    body?.channel_id ||
    container?.channel_id ||
    message?.channel ||
    message?.channel_id ||
    null
  );
}

/**
 * Resolve image source URL from various sources
 * @param {object} client - Slack WebClient
 * @param {string} slackUrl - Slack file URL
 * @param {string} editedImageUrl - Local/external URL
 * @param {string} slackFileId - Slack file ID
 * @returns {Promise<string>} Resolved URL
 * @throws {Error} If no URL can be resolved
 */
async function resolveImageSourceUrl(client, slackUrl, editedImageUrl, slackFileId) {
  let sourceUrl = slackUrl || editedImageUrl;

  if (!sourceUrl && slackFileId) {
    try {
      const info = await client.files.info({ file: slackFileId });
      sourceUrl = info?.file?.url_private_download || info?.file?.url_private;
    } catch (e) {
      console.warn('Failed to resolve URL from file ID:', e.message);
    }
  }

  if (!sourceUrl) {
    throw new Error('No edited image available');
  }

  return sourceUrl;
}

/**
 * Log best-effort errors that don't need to fail operations
 * @param {string} context - Context description
 * @param {Error} error - Error object
 */
function logBestEffortError(context, error) {
  if (process.env.NODE_ENV !== 'production') {
    console.log(`[Best-effort] ${context}:`, error.message || error);
  }
}

module.exports = {
  parseActionValue,
  parsePrivateMetadata,
  extractChannelId,
  resolveImageSourceUrl,
  logBestEffortError,
};
