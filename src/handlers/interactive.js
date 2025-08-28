const { getPreset } = require('../utils/presets');
const slackService = require('../services/slack');
const imageService = require('../services/image');

async function handlePresetSelection({ ack, body, view, client }) {
  await ack();

  const userId = body.user.id;
  const selectedPresetId = view.state.values.section.select_preset.selected_option?.value;

  if (!selectedPresetId) {
    return;
  }

  try {
    const preset = getPreset(selectedPresetId);
    
    // Get current profile photo
    const currentPhoto = await slackService.getCurrentProfilePhoto(client, userId);
    
    if (!currentPhoto) {
      await client.chat.postEphemeral({
        channel: body.user.id,
        user: userId,
        text: '❌ Could not fetch your current profile photo. Please make sure you have a profile photo set.'
      });
      return;
    }

    // Edit the image using the preset prompt
    const editedImage = await imageService.editImage(currentPhoto, preset.prompt);
    
    // Import and use the updated showPreviewModal from slashCommand
    const { showPreviewModal } = require('./slashCommand');
    await showPreviewModal(client, body.trigger_id, currentPhoto, editedImage, preset.prompt);
    
  } catch (error) {
    console.error('Error processing preset selection:', error);
    await client.chat.postEphemeral({
      channel: body.user.id,
      user: userId,
      text: '❌ Failed to process your image. Please try again.'
    });
  }
}

async function handlePreviewAction({ ack, body, view, client }) {
  await ack();
  // This handles modal submissions for the preview modal
}

async function handlePresetSelect({ ack, body, client }) {
  await ack();
  // This handles the radio button selection (no action needed, handled in modal submission)
}

async function handleApprove({ ack, body, client }) {
  await ack();

  const userId = body.user.id;
  let editedImageUrl;
  let prompt;

  try {
    // Parse the JSON value that contains both editedImage and prompt
    const actionValue = JSON.parse(body.actions[0].value);
    editedImageUrl = actionValue.editedImage;
    prompt = actionValue.prompt;
  } catch (parseError) {
    // Fallback for old format (just the URL)
    editedImageUrl = body.actions[0].value;
    prompt = "unknown";
  }

  try {
    console.log(`Updating profile photo for user ${userId} with image: ${editedImageUrl}`);
    
    // Update the user's profile photo
    await slackService.updateProfilePhoto(client, userId, editedImageUrl);
    
    // Close modal and show success message
    await client.views.update({
      view_id: body.view.id,
      view: {
        type: 'modal',
        title: {
          type: 'plain_text',
          text: 'Success! ✅'
        },
        blocks: [
          {
            type: 'section',
            text: {
              type: 'mrkdwn',
              text: `*Your profile photo has been updated!* 🎉\n\n*Applied transformation:* "${prompt}"\n\nYour new profile photo is now live across Slack.`
            }
          }
        ],
        close: {
          type: 'plain_text',
          text: 'Done'
        }
      }
    });

  } catch (error) {
    console.error('Error approving edit:', error);
    
    await client.views.update({
      view_id: body.view.id,
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
              text: '*Failed to update your profile photo.*\n\nPlease try again or contact your workspace admin if the problem persists.'
            }
          }
        ],
        close: {
          type: 'plain_text',
          text: 'Close'
        }
      }
    });
  }
}

async function handleRetry({ ack, body, client }) {
  await ack();

  // Close current modal and re-open preset selection
  await client.views.update({
    view_id: body.view.id,
    view: {
      type: 'modal',
      callback_id: 'preset_selection_modal',
      title: {
        type: 'plain_text',
        text: 'Try Again ✨'
      },
      blocks: [
        {
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: '*Want to try a different transformation?*\n\nChoose another preset or use `/boo your custom prompt` for a custom edit.'
          }
        },
        {
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: 'You can also close this dialog and try `/boo` with your own custom prompt.'
          }
        }
      ],
      close: {
        type: 'plain_text',
        text: 'Close'
      }
    }
  });
}

async function handleCancel({ ack, body, client }) {
  await ack();

  // Close the modal
  await client.views.update({
    view_id: body.view.id,
    view: {
      type: 'modal',
      title: {
        type: 'plain_text',
        text: 'Cancelled'
      },
      blocks: [
        {
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: 'No changes were made to your profile photo.\n\nUse `/boo` anytime to try again!'
          }
        }
      ],
      close: {
        type: 'plain_text',
        text: 'Close'
      }
    }
  });
}


async function handleApproveMessage({ ack, body, client }) {
  await ack();

  const userId = body.user.id;
  let editedImageUrl;
  let prompt;

  try {
    // Parse the JSON value that contains both editedImage and prompt
    const actionValue = JSON.parse(body.actions[0].value);
    editedImageUrl = actionValue.editedImage;
    prompt = actionValue.prompt;
  } catch (parseError) {
    // Fallback for old format (just the URL)
    editedImageUrl = body.actions[0].value;
    prompt = "unknown";
  }

  try {
    console.log(`Updating profile photo for user ${userId} with image: ${editedImageUrl}`);
    
    // Update the user's profile photo
    await slackService.updateProfilePhoto(client, userId, editedImageUrl);
    
    // Send success response as DM
    await client.chat.postMessage({
      channel: userId, // DM the user directly
      text: `✅ *Success! Your profile photo has been updated!* 🎉\n\n*Applied transformation:* "${prompt}"\n\nYour new profile photo is now live across Slack.`
    });

  } catch (error) {
    console.error('Error approving edit:', error);
    
    await client.chat.postMessage({
      channel: userId, // DM the user directly
      text: '❌ *Failed to update your profile photo.*\n\nPlease try again or contact your workspace admin if the problem persists.'
    });
  }
}

async function handleRetryMessage({ ack, body, client }) {
  await ack();

  await client.chat.postMessage({
    channel: body.user.id, // DM the user directly
    text: '🔄 *Want to try a different transformation?*\n\nUse `/boo your custom prompt` to create a new edit with a different prompt!'
  });
}

module.exports = {
  handlePresetSelection,
  handlePreviewAction,
  handlePresetSelect,
  handleApprove,
  handleRetry,
  handleCancel,
  handleApproveMessage,
  handleRetryMessage
};