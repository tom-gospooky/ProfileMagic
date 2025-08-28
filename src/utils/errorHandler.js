class ProfileMagicError extends Error {
  constructor(message, code, userMessage) {
    super(message);
    this.name = 'ProfileMagicError';
    this.code = code;
    this.userMessage = userMessage || 'An unexpected error occurred. Please try again.';
  }
}

const ErrorCodes = {
  NO_PROFILE_PHOTO: 'NO_PROFILE_PHOTO',
  PROFILE_FETCH_FAILED: 'PROFILE_FETCH_FAILED',
  IMAGE_EDIT_FAILED: 'IMAGE_EDIT_FAILED',
  PROFILE_UPDATE_FAILED: 'PROFILE_UPDATE_FAILED',
  API_ERROR: 'API_ERROR',
  INVALID_INPUT: 'INVALID_INPUT',
  RATE_LIMIT: 'RATE_LIMIT'
};

function createError(code, details = '') {
  const errorMap = {
    [ErrorCodes.NO_PROFILE_PHOTO]: {
      message: `No profile photo found: ${details}`,
      userMessage: '❌ Could not find your profile photo. Please make sure you have a profile photo set in Slack.'
    },
    [ErrorCodes.PROFILE_FETCH_FAILED]: {
      message: `Failed to fetch profile photo: ${details}`,
      userMessage: '❌ Could not access your profile photo. Please check your permissions and try again.'
    },
    [ErrorCodes.IMAGE_EDIT_FAILED]: {
      message: `Image editing failed: ${details}`,
      userMessage: '❌ Failed to edit your image. The AI service might be temporarily unavailable. Please try again.'
    },
    [ErrorCodes.PROFILE_UPDATE_FAILED]: {
      message: `Profile update failed: ${details}`,
      userMessage: '❌ Could not update your profile photo. Please check your permissions or try again later.'
    },
    [ErrorCodes.API_ERROR]: {
      message: `API error: ${details}`,
      userMessage: '❌ There was an issue with the image editing service. Please try again in a moment.'
    },
    [ErrorCodes.INVALID_INPUT]: {
      message: `Invalid input: ${details}`,
      userMessage: '❌ Invalid input provided. Please check your command and try again.'
    },
    [ErrorCodes.RATE_LIMIT]: {
      message: `Rate limit exceeded: ${details}`,
      userMessage: '❌ Too many requests. Please wait a moment before trying again.'
    }
  };

  const error = errorMap[code] || {
    message: `Unknown error: ${details}`,
    userMessage: '❌ An unexpected error occurred. Please try again.'
  };

  return new ProfileMagicError(error.message, code, error.userMessage);
}

async function handleError(error, client, userId, channelId) {
  console.error('ProfileMagic Error:', error);

  let userMessage = '❌ Sorry, something went wrong. Please try again.';
  
  if (error instanceof ProfileMagicError) {
    userMessage = error.userMessage;
  } else if (error.message?.includes('rate limit')) {
    userMessage = '❌ Too many requests. Please wait a moment before trying again.';
  } else if (error.message?.includes('permission')) {
    userMessage = '❌ Permission denied. Please contact your workspace admin.';
  } else if (error.message?.includes('network') || error.message?.includes('timeout')) {
    userMessage = '❌ Network issue detected. Please check your connection and try again.';
  }

  try {
    if (client && userId && channelId) {
      await client.chat.postEphemeral({
        channel: channelId,
        user: userId,
        text: userMessage
      });
    }
  } catch (postError) {
    console.error('Failed to send error message to user:', postError);
  }
}

async function handleModalError(error, client, viewId) {
  console.error('ProfileMagic Modal Error:', error);

  let userMessage = 'Something went wrong. Please try again.';
  
  if (error instanceof ProfileMagicError) {
    userMessage = error.userMessage.replace('❌ ', '');
  }

  try {
    await client.views.update({
      view_id: viewId,
      view: {
        type: 'modal',
        title: {
          type: 'plain_text',
          text: 'Error ❌'
        },
        blocks: [
          {
            type: 'section',
            text: {
              type: 'mrkdwn',
              text: `*${userMessage}*\n\nPlease close this dialog and try again.`
            }
          }
        ],
        close: {
          type: 'plain_text',
          text: 'Close'
        }
      }
    });
  } catch (updateError) {
    console.error('Failed to update modal with error message:', updateError);
  }
}

function logError(error, context = {}) {
  const logData = {
    timestamp: new Date().toISOString(),
    error: error.message,
    stack: error.stack,
    code: error.code || 'UNKNOWN',
    context
  };
  
  console.error('ProfileMagic Error Log:', JSON.stringify(logData, null, 2));
}

module.exports = {
  ProfileMagicError,
  ErrorCodes,
  createError,
  handleError,
  handleModalError,
  logError
};