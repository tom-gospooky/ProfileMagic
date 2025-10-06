/**
 * Constants for image processing operations
 */

module.exports = {
  // Image size limits (in bytes)
  IMAGE_SIZE_LIMITS: {
    GEMINI_MAX_BYTES: 4 * 1024 * 1024,              // 4MB - Gemini API limit
    PROACTIVE_COMPRESS_THRESHOLD: 7 * 1024 * 1024,  // 7MB - proactive compression trigger
    PROACTIVE_COMPRESS_TARGET: 3 * 1024 * 1024,     // 3MB - target after proactive compression
    RETRY_COMPRESS_TARGET: 2 * 1024 * 1024,         // 2MB - aggressive compression on retry
  },

  // API retry configuration
  API_RETRY: {
    MAX_ATTEMPTS: 2,           // Maximum retry attempts
    BACKOFF_BASE_MS: 400,      // Base backoff time in milliseconds
  },

  // Timeouts (in milliseconds)
  TIMEOUTS: {
    IMAGE_DOWNLOAD_MS: 30000,  // 30 seconds for image downloads
  },

  // Processing limits
  LIMITS: {
    MAX_IMAGES_PER_REQUEST: 3, // Maximum images per processing request
  },
};
