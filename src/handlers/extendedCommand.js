const slackService = require('../services/slack');
const imageService = require('../services/image');
const userTokens = require('../services/userTokens');
const { getOAuthUrl } = require('../services/fileServer');

async function handleExtendedSlashCommand({ command, ack, respond, client, body }) {
  await ack();

  const userId = body.user_id;
  const teamId = body.team_id;
  const initialPrompt = command.text?.trim() || '';

  try {
    // Check if user is authorized to update their profile
    if (!userTokens.isUserAuthorized(userId, teamId)) {
      const authUrl = getOAuthUrl(userId, teamId);
      
      await respond({
        text: '🔐 *Authorization Required*',
        response_type: 'ephemeral',
        blocks: [
          {
            type: 'section',
            text: {
              type: 'mrkdwn',
              text: '🔐 *Boo Extended needs permission to update your profile photo!*\n\nTo use this feature, you need to authorize the app with your personal Slack account.'
            }
          },
          {
            type: 'section',
            text: {
              type: 'mrkdwn',
              text: '👆 *Click the button below to authorize:*'
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
          }
        ]
      });
      return;
    }

    // User is authorized, show the extended modal
    await showExtendedModal(client, body.trigger_id, initialPrompt, userId, body.channel_id);
    
  } catch (error) {
    console.error('Error in extended slash command:', error);
    await respond({
      text: '❌ Sorry, something went wrong. Please try again.',
      response_type: 'ephemeral'
    });
  }
}

async function showExtendedModal(client, triggerId, initialPrompt = '', userId, channelId) {
  try {
    const modal = {
      type: 'modal',
      callback_id: 'boo_ext_modal',
      title: {
        type: 'plain_text',
        text: 'Boo Extended ✨'
      },
      submit: {
        type: 'plain_text',
        text: 'Generate'
      },
      close: {
        type: 'plain_text',
        text: 'Cancel'
      },
      private_metadata: JSON.stringify({ channelId }),
      blocks: [
        {
          type: 'input',
          block_id: 'prompt_input',
          element: {
            type: 'plain_text_input',
            action_id: 'prompt_text',
            placeholder: {
              type: 'plain_text',
              text: 'e.g., "add sunglasses and a hat, cartoon style"'
            },
            initial_value: initialPrompt,
            multiline: true,
            max_length: 500
          },
          label: {
            type: 'plain_text',
            text: 'Describe your desired edit'
          }
        },
        {
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: 'Include your current profile photo as the base for editing?'
          },
          accessory: {
            type: 'checkboxes',
            action_id: 'use_profile_photo',
            initial_options: [
              {
                text: {
                  type: 'plain_text',
                  text: 'Use my current profile photo'
                },
                value: 'include_profile'
              }
            ],
            options: [
              {
                text: {
                  type: 'plain_text',
                  text: 'Use my current profile photo'
                },
                value: 'include_profile'
              }
            ]
          }
        },
        {
          type: 'input',
          block_id: 'reference_files',
          element: {
            type: 'file_input',
            action_id: 'ref_files',
            filetypes: ['jpg', 'jpeg', 'png', 'gif', 'webp'],
            max_files: 5
          },
          label: {
            type: 'plain_text',
            text: 'Upload Reference Images (optional)'
          },
          optional: true
        },
        {
          type: 'context',
          elements: [
            {
              type: 'mrkdwn',
              text: 'Tip: You can upload up to 5 reference images. Supported formats: JPG, PNG, GIF, WebP.'
            }
          ]
        }
      ]
    };

    await client.views.open({
      trigger_id: triggerId,
      view: modal
    });

  } catch (error) {
    console.error('Error showing extended modal:', error);
    throw error;
  }
}

async function handleExtendedModalSubmission({ ack, body, view, client }) {
  await ack();

  const userId = body.user.id;
  const teamId = body.team.id;
  const isProduction = process.env.NODE_ENV === 'production';
  
  // Get the original channel ID from private metadata
  try {
    const metadata = JSON.parse(view.private_metadata || '{}');
    // originalChannelId = metadata.channelId; // Currently unused
  } catch (e) {
    // Handle metadata parsing error
  }

  try {
    // Extract form data
    const prompt = view.state.values.prompt_input.prompt_text.value?.trim();
    // For section accessories, we need to find the block and access the action
    let useProfilePhoto = false;
    for (const [, blockValues] of Object.entries(view.state.values)) {
      if (blockValues.use_profile_photo?.selected_options?.length > 0) {
        useProfilePhoto = blockValues.use_profile_photo.selected_options.some(option => option.value === 'include_profile');
        break;
      }
    }
    const uploadedFiles = view.state.values.reference_files?.ref_files?.files || [];

    if (!isProduction) {
      console.log('Extended modal submission:', {
        prompt: prompt ? `"${prompt}"` : 'empty',
        useProfilePhoto,
        uploadedFilesCount: uploadedFiles.length
      });
    }

    if (!prompt) {
      // Return validation error without closing modal
      return {
        response_action: 'errors',
        errors: {
          'prompt_input': 'Please provide a text prompt describing your desired edit.'
        }
      };
    }

    // Validate we have images to process
    if (!useProfilePhoto && uploadedFiles.length === 0) {
      return {
        response_action: 'errors',
        errors: {
          'reference_files': 'Please either check "Use my current profile photo" or upload reference images.'
        }
      };
    }

    // Close modal and process in background
    await ack({
      response_action: 'clear'
    });

    // Send processing message to user - try DM first, fallback to triggering channel
    let processingMessage;
    try {
      processingMessage = await client.chat.postMessage({
        channel: userId,
        text: `🎨 *Processing your extended edit...*\n\n*Prompt:* "${prompt}"\n*Using profile photo:* ${useProfilePhoto ? 'Yes ✓' : 'No'}\n*Reference images:* ${uploadedFiles.length}\n\nThis may take a moment!`
      });
    } catch (dmError) {
      if (dmError.data?.error === 'messages_tab_disabled') {
        // User has DMs disabled, send ephemeral message to user's DM channel instead
        // This creates an ephemeral message visible only to the user
        processingMessage = await client.chat.postEphemeral({
          channel: userId,
          user: userId,
          text: `🎨 *Processing your extended edit...*\n\n*Prompt:* "${prompt}"\n*Using profile photo:* ${useProfilePhoto ? 'Yes ✓' : 'No'}\n*Reference images:* ${uploadedFiles.length}\n\nThis may take a moment!`
        });
      } else {
        throw dmError;
      }
    }

    // Get current profile photo if needed
    let currentPhoto = null;
    if (useProfilePhoto) {
      currentPhoto = await slackService.getCurrentProfilePhoto(client, userId);
      
      if (!currentPhoto) {
        const errorText = '❌ Could not fetch your current profile photo. Please make sure you have a profile photo set.';
        try {
          await client.chat.update({
            channel: processingMessage.channel,
            ts: processingMessage.ts,
            text: errorText
          });
        } catch (updateError) {
          // If we can't update (e.g., ephemeral message), send a new message
          await client.chat.postEphemeral({
            channel: userId,
            user: userId,
            text: errorText
          });
        }
        return;
      }
    }

    // Collect reference image URLs from uploaded files
    const referenceImages = uploadedFiles.map(file => file.url_private).filter(Boolean);
    
    // Process the edit
    let editedImageResult;
    let imageToEdit;
    
    if (referenceImages.length > 0) {
      if (useProfilePhoto && currentPhoto) {
        // Edit profile photo with reference
        imageToEdit = currentPhoto;
        editedImageResult = await imageService.editImage(currentPhoto, prompt, client, userId, referenceImages[0]);
      } else {
        // Edit reference image directly
        imageToEdit = referenceImages[0];
        editedImageResult = await imageService.editImage(referenceImages[0], prompt, client, userId);
      }
    } else {
      // Edit profile photo only
      editedImageResult = await imageService.editImage(currentPhoto, prompt, client, userId);
    }

    // Show success with results
    const successBlocks = [
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `✅ *Extended edit complete!*\n\n*Prompt:* "${prompt}"`
        }
      },
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: '*Result:*'
        }
      }
    ];

    // Add the edited image when an external URL exists (optional in Slack-files-first)
    if (editedImageResult.localUrl) {
      successBlocks.push({
        type: 'image',
        title: {
          type: 'plain_text',
          text: '✨ Extended Edit Result'
        },
        image_url: editedImageResult.localUrl,
        alt_text: 'AI-edited image from extended command'
      });
    }

    // Add action buttons
    const extActions = [];
    // Only show profile update when a profile image was involved
    if (useProfilePhoto) {
      extActions.push({
        type: 'button', text: { type: 'plain_text', text: '✅ Set as Profile Picture' }, style: 'primary',
        action_id: 'approve_ext_edit',
        value: JSON.stringify({
          editedImage: editedImageResult.localUrl || null,
          slackFileId: editedImageResult.fileId || editedImageResult.slackFile?.id || null,
          slackUrl: editedImageResult.slackFile?.url_private_download || null,
          prompt,
          referenceCount: referenceImages.length,
          useProfilePhoto
        })
      });
    }
    extActions.push({ type: 'button', text: { type: 'plain_text', text: '🔄 Try Different Edit' }, action_id: 'retry_edit_message' });
    {
      const openUrl = editedImageResult.slackFile?.permalink || editedImageResult.slackFile?.permalink_public;
      if (openUrl) {
        extActions.push({ type: 'button', text: { type: 'plain_text', text: '🔎 Open in Slack' }, url: openUrl });
      }
    }
    successBlocks.push({ type: 'actions', elements: extActions });

    // Update the processing message with results
    try {
      await client.chat.update({
        channel: processingMessage.channel,
        ts: processingMessage.ts,
        text: '✅ *Extended edit complete!*',
        blocks: successBlocks
      });
    } catch (updateError) {
      // If we can't update (e.g., ephemeral message), send a new message
      await client.chat.postEphemeral({
        channel: userId,
        user: userId,
        text: '✅ *Extended edit complete!*',
        blocks: successBlocks
      });
    }

  } catch (error) {
    console.error('Extended modal submission error:', error);
    
    let errorMessage = '❌ Failed to process your extended edit. Please try again.';
    
    // Handle specific error types
    if (error.message === 'CONTENT_BLOCKED') {
      errorMessage = `🚫 **Content Blocked**\n\n${error.userMessage}\n\n*Try different prompts or reference images.*`;
    } else if (error.message === 'GENERATION_FAILED') {
      errorMessage = `⚠️ **Generation Failed**\n\n${error.userMessage}`;
    } else if (error.message === 'USER_NOT_AUTHORIZED') {
      errorMessage = '🔐 *Authorization required.*\n\nPlease authorize Boo to update your profile photo.';
    }

    // Send error message to user
    try {
      await client.chat.postMessage({
        channel: userId,
        text: errorMessage
      });
    } catch (dmError) {
      if (dmError.data?.error === 'messages_tab_disabled') {
        // Send ephemeral message instead
        await client.chat.postEphemeral({
          channel: userId,
          user: userId,
          text: errorMessage
        });
      } else {
        console.error('Failed to send error message:', dmError);
      }
    }
  }
}

// Commented out unused function
// async function showExtendedResults(client, viewId, originalImage, editedImageResult, prompt, referenceImages, useProfilePhoto) {
//   ... implementation removed
// }

module.exports = {
  handleExtendedSlashCommand,
  handleExtendedModalSubmission,
  showExtendedModal
};
