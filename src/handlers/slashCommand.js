const { getAllPresets } = require('../utils/presets');
const slackService = require('../services/slack');
const imageService = require('../services/image');

async function handleSlashCommand({ command, ack, respond, client, body }) {
  await ack();

  const userId = body.user_id;
  const prompt = command.text?.trim();

  try {
    // If user provided a prompt, process it directly
    if (prompt) {
      await processDirectPrompt(client, userId, prompt, body.trigger_id, respond);
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

async function processDirectPrompt(client, userId, prompt, triggerId, respond) {
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

      // Edit the image
      const editedImageResult = await imageService.editImage(currentPhoto, prompt, client, userId);
      
      // Send follow-up response with interactive buttons (instead of modal due to trigger_id expiring)
      await respond({
        text: `✅ *Image processing completed successfully!*\n\n*Prompt used:* "${prompt}"`,
        response_type: 'ephemeral',
        blocks: [
          {
            type: 'section',
            text: {
              type: 'mrkdwn',
              text: `✅ *Image processing completed successfully!*\n\n*Prompt used:* "${prompt}"`
            }
          }
        ]
      });

      // Add image block if we have a successful result
      if (editedImageResult.fileId) {
        // Add image block using Slack file
        await respond({
          text: '🖼️ Here\'s your edited image:',
          response_type: 'ephemeral',
          blocks: [
            {
              type: 'image',
              title: {
                type: 'plain_text',
                text: 'AI-Edited Profile Photo'
              },
              slack_file: {
                id: editedImageResult.fileId
              },
              alt_text: 'AI-edited profile photo'
            },
            {
              type: 'actions',
              elements: [
                {
                  type: 'button',
                  text: {
                    type: 'plain_text',
                    text: '✅ Apply to Profile'
                  },
                  style: 'primary',
                  action_id: 'approve_edit_message',
                  value: JSON.stringify({ editedImage: editedImageResult.localUrl, prompt })
                }
              ]
            }
          ]
        });
      } else {
        // Fallback: show URL if no Slack file
        await respond({
          text: `🖼️ Image URL: ${editedImageResult.localUrl}`,
          response_type: 'ephemeral',
          blocks: [
            {
              type: 'actions',
              elements: [
                {
                  type: 'button',
                  text: {
                    type: 'plain_text',
                    text: '✅ Apply to Profile'
                  },
                  style: 'primary',
                  action_id: 'approve_edit_message',
                  value: JSON.stringify({ editedImage: editedImageResult.localUrl, prompt })
                }
              ]
            }
          ]
        });
      }
      
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
          text: '✅ Apply to Profile'
        },
        style: 'primary',
        action_id: 'approve_edit',
        value: JSON.stringify({ editedImage, prompt })
      },
      {
        type: 'button',
        text: {
          type: 'plain_text',
          text: '🔄 Try Different Edit'
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