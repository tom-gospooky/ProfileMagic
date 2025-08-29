const { getAllPresets } = require('../utils/presets');
const slackService = require('../services/slack');
const imageService = require('../services/image');
const userTokens = require('../services/userTokens');
const { getOAuthUrl } = require('../services/fileServer');

async function handleSlashCommand({ command, ack, respond, client, body }) {
  await ack();

  const userId = body.user_id;
  const teamId = body.team_id;
  const prompt = command.text?.trim();

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
              text: '🔐 *ProfileMagic needs permission to update your profile photo!*\n\nTo use this feature, you need to authorize the app with your personal Slack account.'
            }
          },
          {
            type: 'section',
            text: {
              type: 'mrkdwn',
              text: `👆 *Click the button below to authorize:*`
            },
            accessory: {
              type: 'button',
              text: {
                type: 'plain_text',
                text: '🔗 Authorize ProfileMagic',
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
      return;
    }

    // User is authorized, proceed with normal flow
    if (prompt) {
      await processDirectPrompt(client, userId, teamId, prompt, body.trigger_id, respond);
    } else {
      // Show preset selection modal
      await showPresetModal(client, body.trigger_id);
    }
  } catch (error) {
    console.error('Error in slash command:', error);
    await respond({
      text: '❌ Sorry, something went wrong. Please try again.',
      response_type: 'ephemeral'
    });
  }
}

async function processDirectPrompt(client, userId, teamId, prompt, triggerId, respond) {
  // Process in background after acknowledging the command
  setTimeout(async () => {
    try {
      // Get current profile photo
      const currentPhoto = await slackService.getCurrentProfilePhoto(client, userId);
      
      if (!currentPhoto) {
        // Send DM to user since we can't use respond() again
        await client.chat.postMessage({
          channel: userId, // DM the user directly
          text: '❌ Could not fetch your current profile photo. Please make sure you have a profile photo set.'
        });
        return;
      }

      // Edit the image (without reference for now)
      const editedImageResult = await imageService.editImage(currentPhoto, prompt, client, userId);
      
      // Send single response with before/after images and action buttons  
      let successText = `✅ *Image processing completed successfully!*\n\n*Prompt used:* "${prompt}"`;
      
      const responseBlocks = [
        {
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: successText
          }
        },
        {
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: '*Before & After Comparison:*'
          }
        }
      ];

      // Add original image
      responseBlocks.push({
        type: 'image',
        title: {
          type: 'plain_text',
          text: '📸 Original Image'
        },
        image_url: currentPhoto,
        alt_text: 'Original profile photo'
      });

      // Add edited image
      if (editedImageResult.fileId) {
        // Use Slack file if upload succeeded
        responseBlocks.push({
          type: 'image',
          title: {
            type: 'plain_text',
            text: '✨ AI-Edited Image'
          },
          slack_file: {
            id: editedImageResult.fileId
          },
          alt_text: 'AI-edited profile photo'
        });
      } else if (editedImageResult.localUrl) {
        // Fallback to public URL if Slack upload failed
        responseBlocks.push({
          type: 'image',
          title: {
            type: 'plain_text',
            text: '✨ AI-Edited Image'
          },
          image_url: editedImageResult.localUrl,
          alt_text: 'AI-edited profile photo'
        });
      }

      // Add action buttons
      responseBlocks.push({
        type: 'actions',
        elements: [
          {
            type: 'button',
            text: {
              type: 'plain_text',
              text: '✅ Set as Profile Picture'
            },
            style: 'primary',
            action_id: 'approve_edit_message',
            value: JSON.stringify({ editedImage: editedImageResult.localUrl, prompt })
          },
          {
            type: 'button',
            text: {
              type: 'plain_text',
              text: '🔄 Retry'
            },
            action_id: 'retry_edit_message'
          },
          {
            type: 'button',
            text: {
              type: 'plain_text',
              text: '📎 Use Reference Image'
            },
            action_id: 'use_reference_image',
            value: JSON.stringify({ originalPrompt: prompt, currentPhoto, editedImage: editedImageResult.localUrl })
          }
        ]
      });

      // Send single comprehensive response
      await respond({
        text: `✅ *Image processing completed successfully!*\n\n*Prompt used:* "${prompt}"`,
        response_type: 'ephemeral',
        blocks: responseBlocks
      });
      
    } catch (error) {
      console.error('Error processing direct prompt:', error);
      
      let errorMessage = '❌ Failed to process your image. Please try again.';
      
      // Check for specific error types
      if (error.message === 'CONTENT_BLOCKED') {
        errorMessage = `🚫 **Content Blocked**\n\n${error.userMessage}\n\n*Try prompts like:* "make cartoon style", "add sunglasses", "vintage filter", etc.`;
      } else if (error.message === 'GENERATION_FAILED') {
        errorMessage = `⚠️ **Generation Failed**\n\n${error.userMessage}`;
      }
      
      // Send response with specific error feedback
      try {
        await respond({
          text: errorMessage,
          response_type: 'ephemeral'
        });
      } catch (respondError) {
        // Fallback to DM if respond fails
        try {
          await client.chat.postMessage({
            channel: userId,
            text: errorMessage
          });
        } catch (dmError) {
          console.error('Failed to send error message:', dmError);
        }
      }
    }
  }, 100); // Small delay to ensure command is acknowledged first
  
  // Send immediate acknowledgment
  await respond({
    text: '🎨 Processing your image transformation... This may take a moment!',
    response_type: 'ephemeral'
  });
}

async function showPresetModal(client, triggerId) {
  const presets = getAllPresets();
  
  const presetOptions = presets.map(preset => ({
    text: {
      type: 'plain_text',
      text: preset.name
    },
    description: {
      type: 'plain_text',
      text: preset.description
    },
    value: preset.id
  }));

  const modal = {
    type: 'modal',
    callback_id: 'preset_selection_modal',
    title: {
      type: 'plain_text',
      text: 'Profile Magic ✨'
    },
    blocks: [
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: '*Choose how you want to transform your profile photo:*'
        }
      },
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: 'Select a preset below, or cancel and use `/boo your custom prompt`'
        },
        accessory: {
          type: 'radio_buttons',
          action_id: 'select_preset',
          options: presetOptions
        }
      }
    ],
    submit: {
      type: 'plain_text',
      text: 'Transform'
    },
    close: {
      type: 'plain_text',
      text: 'Cancel'
    }
  };

  await client.views.open({
    trigger_id: triggerId,
    view: modal
  });
}

async function showPreviewModal(client, triggerId, originalImage, editedImage, prompt) {
  // Check if editedImage is a localhost URL
  const isLocalhost = editedImage.includes('localhost') || editedImage.includes('127.0.0.1');
  
  const blocks = [
    {
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: `*✅ Image processing completed successfully!*\n\n*Prompt used:* "${prompt}"`
      }
    }
  ];

  // Only show images if they're not localhost URLs
  if (!isLocalhost) {
    blocks.push(
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: '*Before → After*'
        }
      },
      {
        type: 'image',
        title: {
          type: 'plain_text',
          text: 'Original'
        },
        image_url: originalImage,
        alt_text: 'Original profile photo'
      },
      {
        type: 'image',
        title: {
          type: 'plain_text',
          text: 'Edited'
        },
        image_url: editedImage,
        alt_text: 'Edited profile photo'
      }
    );
  } else {
    blocks.push({
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: `*Image URLs:*\n• Original: ${originalImage}\n• Edited: ${editedImage}\n\n_Note: Images cannot be previewed in this development setup, but have been generated successfully._`
      }
    });
  }

  blocks.push({
    type: 'actions',
    elements: [
      {
        type: 'button',
        text: {
          type: 'plain_text',
          text: '✅ Set as Profile Picture'
        },
        style: 'primary',
        action_id: 'approve_edit',
        value: JSON.stringify({ editedImage, prompt })
      },
      {
        type: 'button',
        text: {
          type: 'plain_text',
          text: '🔄 Retry'
        },
        action_id: 'retry_edit',
        value: JSON.stringify({ originalImage, prompt })
      },
      {
        type: 'button',
        text: {
          type: 'plain_text',
          text: '❌ Cancel'
        },
        action_id: 'cancel_edit'
      }
    ]
  });

  const modal = {
    type: 'modal',
    callback_id: 'preview_modal',
    title: {
      type: 'plain_text',
      text: 'Image Edit Complete'
    },
    blocks: blocks
  };

  await client.views.open({
    trigger_id: triggerId,
    view: modal
  });
}

module.exports = handleSlashCommand;
module.exports.showPreviewModal = showPreviewModal;