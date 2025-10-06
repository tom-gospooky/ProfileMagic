const userTokens = require('../services/userTokens');
const { getOAuthUrl } = require('../services/fileServer');

/**
 * Check if user is authorized and send authorization request if not
 * @param {string} userId - Slack user ID
 * @param {string} teamId - Slack team ID
 * @param {Function} respond - Function to send response (from slash command or ack)
 * @param {object} options - Optional configuration
 * @param {string} options.customMessage - Custom authorization message
 * @returns {boolean} - True if authorized, false if not
 */
async function requireAuthorization(userId, teamId, respond, options = {}) {
  if (!userTokens.isUserAuthorized(userId, teamId)) {
    await sendAuthorizationRequired(userId, teamId, respond, options);
    return false;
  }
  return true;
}

/**
 * Send authorization required message
 * @param {string} userId - Slack user ID
 * @param {string} teamId - Slack team ID
 * @param {Function} respond - Function to send response
 * @param {object} options - Optional configuration
 * @param {string} options.customMessage - Custom authorization message
 */
async function sendAuthorizationRequired(userId, teamId, respond, options = {}) {
  const authUrl = getOAuthUrl(userId, teamId);
  const message = options.customMessage || '*Boo needs permission to update your profile photo!*';

  await respond({
    text: '🔐 *Authorization Required*',
    response_type: 'ephemeral',
    blocks: [
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: message
        },
        accessory: {
          type: 'button',
          text: {
            type: 'plain_text',
            text: '🔗 Authorize Boo',
            emoji: true
          },
          url: authUrl,
          style: 'primary'
        }
      },
      {
        type: 'context',
        elements: [
          {
            type: 'mrkdwn',
            text: '🔒 _Your authorization is stored securely and only used for profile picture updates._'
          }
        ]
      }
    ]
  });
}

module.exports = {
  requireAuthorization,
  sendAuthorizationRequired
};
