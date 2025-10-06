/**
 * Modal helper utilities for interactive handlers
 */

const { getOAuthUrl } = require('../services/fileServer');

/**
 * Show authorization required modal
 * @param {object} client - Slack WebClient
 * @param {string} viewId - Modal view ID to update
 * @param {string} userId - User ID
 * @param {string} teamId - Team ID
 */
async function showAuthorizationModal(client, viewId, userId, teamId) {
  const authUrl = getOAuthUrl(userId, teamId);

  await client.views.update({
    view_id: viewId,
    view: {
      type: 'modal',
      title: { type: 'plain_text', text: 'Authorization Required 🔐' },
      blocks: [
        {
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: '*Boo needs permission to update your profile photo!*\n\nClick the button below to authorize the app.'
          }
        },
        {
          type: 'actions',
          elements: [
            {
              type: 'button',
              text: { type: 'plain_text', text: '🔗 Authorize Boo' },
              url: authUrl,
              style: 'primary'
            }
          ]
        }
      ],
      close: { type: 'plain_text', text: 'Close' }
    }
  });
}

/**
 * Show success modal
 * @param {object} client - Slack WebClient
 * @param {string} viewId - Modal view ID to update
 * @param {string} prompt - The prompt that was used
 * @param {object} options - Additional options
 * @param {string} options.message - Custom success message
 */
async function showSuccessModal(client, viewId, prompt, options = {}) {
  const message = options.message || `*Your profile photo has been updated!* 🎉\n\n*Applied transformation:* "${prompt}"\n\nYour new profile photo is now live across Slack.`;

  await client.views.update({
    view_id: viewId,
    view: {
      type: 'modal',
      title: { type: 'plain_text', text: 'Success! ✅' },
      blocks: [
        {
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: message
          }
        }
      ],
      close: { type: 'plain_text', text: 'Done' }
    }
  });
}

/**
 * Show error modal
 * @param {object} client - Slack WebClient
 * @param {string} viewId - Modal view ID to update
 * @param {string} errorMessage - Error message to display
 */
async function showErrorModal(client, viewId, errorMessage = null) {
  const message = errorMessage || '*Failed to update your profile photo.*\n\nPlease try again or contact your workspace admin if the problem persists.';

  await client.views.update({
    view_id: viewId,
    view: {
      type: 'modal',
      title: { type: 'plain_text', text: 'Error ❌' },
      blocks: [
        {
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: message
          }
        }
      ],
      close: { type: 'plain_text', text: 'Close' }
    }
  });
}

/**
 * Show processing modal
 * @param {object} client - Slack WebClient
 * @param {string} viewId - Modal view ID to update
 * @param {string} message - Processing message
 */
async function showProcessingModal(client, viewId, message = '🎨 Processing your request...') {
  await client.views.update({
    view_id: viewId,
    view: {
      type: 'modal',
      title: { type: 'plain_text', text: 'Processing...' },
      blocks: [
        {
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: message
          }
        }
      ],
      close: { type: 'plain_text', text: 'Cancel' }
    }
  });
}

module.exports = {
  showAuthorizationModal,
  showSuccessModal,
  showErrorModal,
  showProcessingModal,
};
