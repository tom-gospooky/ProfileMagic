const { getPreset } = require('../utils/presets');
const slackService = require('../services/slack');
const imageService = require('../services/image');
const axios = require('axios');
const { getOAuthUrl } = require('../services/fileServer');
const { showExtendedModal } = require('./extendedCommand');

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
    console.error('Preset selection error:', error.message);
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
  const teamId = body.team.id;
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

  const isProduction = process.env.NODE_ENV === 'production';
  try {
    if (!isProduction) console.log(`Updating profile photo for user ${userId}`);
    
    // Update the user's profile photo
    await slackService.updateProfilePhoto(client, userId, teamId, editedImageUrl);
    
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
    console.error('Edit approval error:', error.message);
    
    // Handle authorization error
    if (error.message === 'USER_NOT_AUTHORIZED') {
      const authUrl = getOAuthUrl(userId, teamId);
      
      await client.views.update({
        view_id: body.view.id,
        view: {
          type: 'modal',
          title: {
            type: 'plain_text',
            text: 'Authorization Required 🔐'
          },
          blocks: [
            {
              type: 'section',
              text: {
                type: 'mrkdwn',
                text: '*ProfileMagic needs permission to update your profile photo!*\n\nClick the button below to authorize the app.'
              }
            },
            {
              type: 'actions',
              elements: [
                {
                  type: 'button',
                  text: {
                    type: 'plain_text',
                    text: '🔗 Authorize ProfileMagic'
                  },
                  url: authUrl,
                  style: 'primary'
                }
              ]
            }
          ],
          close: {
            type: 'plain_text',
            text: 'Close'
          }
        }
      });
    } else {
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
  const teamId = body.team.id;
  const isProduction = process.env.NODE_ENV === 'production';
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
    if (!isProduction) console.log(`Updating profile photo for user ${userId}`);
    
    // Update the user's profile photo
    await slackService.updateProfilePhoto(client, userId, teamId, editedImageUrl);
    
    // Show success message in current context (no DM required)
    if (body.response_url) {
      // For interactive components, use response_url if available
      const axios = require('axios');
      await axios.post(body.response_url, {
        text: `✅ *Profile picture updated!* 🎉`,
        response_type: 'ephemeral'
      });
    }

  } catch (error) {
    console.error('Edit approval error:', error.message);
    
    // Handle authorization error
    if (error.message === 'USER_NOT_AUTHORIZED') {
      const authUrl = getOAuthUrl(userId, teamId);
      
      if (body.response_url) {
        const axios = require('axios');
        await axios.post(body.response_url, {
          text: '🔐 *Authorization Required*',
          response_type: 'ephemeral',
          blocks: [
            {
              type: 'section',
              text: {
                type: 'mrkdwn',
                text: '*ProfileMagic needs permission to update your profile photo!*\n\nClick the button below to authorize the app.'
              }
            },
            {
              type: 'actions',
              elements: [
                {
                  type: 'button',
                  text: {
                    type: 'plain_text',
                    text: '🔗 Authorize ProfileMagic'
                  },
                  url: authUrl,
                  style: 'primary'
                }
              ]
            }
          ]
        });
      }
    } else {
      // Show error message in current context (no DM required)
      if (body.response_url) {
        const axios = require('axios');
        await axios.post(body.response_url, {
          text: '❌ *Failed to update your profile photo.*\n\nPlease try again or contact your workspace admin if the problem persists.',
          response_type: 'ephemeral'
        });
      }
    }
  }
}

async function handleRetryMessage({ ack, body, client }) {
  await ack();

  // Send new ephemeral message instead of replacing the original
  try {
    await client.chat.postEphemeral({
      channel: body.channel.id,
      user: body.user.id,
      text: '🔄 *Want to try a different transformation?*\n\nUse `/boo your custom prompt` to create a new edit with a different prompt!',
      blocks: [
        {
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: '🔄 *Want to try a different transformation?*\n\nUse `/boo your custom prompt` to create a new edit with a different prompt!'
          }
        },
        {
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: '*Example prompts:*\n• `/boo add sunglasses`\n• `/boo make it cartoon style`\n• `/boo add a hat`\n• `/boo vintage filter`'
          }
        }
      ]
    });
  } catch (error) {
    console.error('Error sending retry message:', error.message);
    // Fallback to response_url if chat.postEphemeral fails
    if (body.response_url) {
      const axios = require('axios');
      await axios.post(body.response_url, {
        text: '🔄 *Want to try a different transformation?*\n\nUse `/boo your custom prompt` to create a new edit with a different prompt!',
        response_type: 'ephemeral'
      });
    }
  }
}

async function handleReferenceImageModal({ ack, body, client }) {
  await ack();
  
  try {
    // Parse the action value to get context
    const actionData = JSON.parse(body.actions[0].value);
    const { originalPrompt, currentPhoto, editedImage } = actionData;
    
    // Get recent files from the channel to show as options
    const channelHistory = await client.conversations.history({
      channel: body.channel.id,
      limit: 20
    });
    
    // Find image files from recent messages
    const imageFiles = [];
    for (const message of channelHistory.messages) {
      if (message.files) {
        for (const file of message.files) {
          if (file.mimetype && file.mimetype.startsWith('image/')) {
            imageFiles.push({
              text: {
                type: 'plain_text',
                text: `${file.name} (${new Date(file.timestamp * 1000).toLocaleDateString()})`
              },
              value: JSON.stringify({
                fileId: file.id,
                url: file.url_private,
                filename: file.name,
                originalPrompt,
                currentPhoto,
                editedImage
              })
            });
          }
        }
      }
    }
    
    // Show modal with recent images
    await client.views.open({
      trigger_id: body.trigger_id,
      view: {
        type: 'modal',
        callback_id: 'reference_image_modal',
        title: {
          type: 'plain_text',
          text: 'Choose Reference Image'
        },
        submit: {
          type: 'plain_text',
          text: 'Use This Image'
        },
        close: {
          type: 'plain_text',
          text: 'Cancel'
        },
        blocks: [
          {
            type: 'section',
            text: {
              type: 'mrkdwn',
              text: `📎 *Select a reference image* to enhance your edit:\n\n*Original prompt:* "${originalPrompt}"`
            }
          },
          {
            type: 'input',
            block_id: 'reference_selection',
            element: {
              type: 'static_select',
              action_id: 'selected_reference',
              placeholder: {
                type: 'plain_text',
                text: 'Choose an image from recent uploads'
              },
              options: imageFiles.length > 0 ? imageFiles.slice(0, 10) : [{
                text: {
                  type: 'plain_text',
                  text: 'No recent images found'
                },
                value: 'none'
              }]
            },
            label: {
              type: 'plain_text',
              text: 'Reference Image'
            }
          },
          {
            type: 'section',
            text: {
              type: 'mrkdwn',
              text: '_💡 Tip: Upload an image to this channel first, then use this modal to select it as a reference._'
            }
          }
        ]
      }
    });
    
  } catch (error) {
    console.error('Error opening reference image modal:', error.message);
  }
}

async function handleReferenceImageSubmission({ ack, body, view, client }) {
  await ack();

  const userId = body.user.id;
  const isProduction = process.env.NODE_ENV === 'production';

  try {
    // Get the selected reference image
    const selectedValue = view.state.values.reference_selection.selected_reference.selected_option?.value;
    
    if (!selectedValue || selectedValue === 'none') {
      await client.views.update({
        view_id: body.view.id,
        view: {
          type: 'modal',
          title: {
            type: 'plain_text',
            text: 'No Selection'
          },
          blocks: [{
            type: 'section',
            text: {
              type: 'mrkdwn',
              text: '❌ No reference image was selected. Please try again.'
            }
          }],
          close: {
            type: 'plain_text',
            text: 'Close'
          }
        }
      });
      return;
    }

    // Parse the selected image data
    const imageData = JSON.parse(selectedValue);
    const { url, originalPrompt, currentPhoto } = imageData;

    if (!isProduction) console.log(`Processing with reference image: ${imageData.filename}`);

    // Show processing message
    await client.views.update({
      view_id: body.view.id,
      view: {
        type: 'modal',
        title: {
          type: 'plain_text',
          text: 'Processing...'
        },
        blocks: [{
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: '🎨 *Processing your image with reference...*\\n\\nThis may take a moment!'
          }
        }],
        close: {
          type: 'plain_text',
          text: 'Close'
        }
      }
    });

    // Process the image with reference
    const editedImageResult = await imageService.editImage(currentPhoto, originalPrompt, client, userId, url);

    // Show success with new result
    const successBlocks = [
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `✅ *Image processed with reference!*\\n\\n*Prompt:* "${originalPrompt}"\\n*Reference:* ${imageData.filename}`
        }
      },
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: '*Before & After with Reference:*'
        }
      }
    ];

    // Add original image
    successBlocks.push({
      type: 'image',
      title: {
        type: 'plain_text',
        text: '📸 Original Image'
      },
      image_url: currentPhoto,
      alt_text: 'Original profile photo'
    });

    // Add edited image with reference
    if (editedImageResult.fileId) {
      successBlocks.push({
        type: 'image',
        title: {
          type: 'plain_text',
          text: '✨ AI-Edited with Reference'
        },
        slack_file: {
          id: editedImageResult.fileId
        },
        alt_text: 'AI-edited profile photo with reference'
      });
    } else if (editedImageResult.localUrl) {
      successBlocks.push({
        type: 'image',
        title: {
          type: 'plain_text',
          text: '✨ AI-Edited with Reference'
        },
        image_url: editedImageResult.localUrl,
        alt_text: 'AI-edited profile photo with reference'
      });
    }

    // Add action buttons
    successBlocks.push({
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
          value: JSON.stringify({ editedImage: editedImageResult.localUrl, prompt: originalPrompt })
        },
        {
          type: 'button',
          text: {
            type: 'plain_text',
            text: '🔄 Try Again'
          },
          action_id: 'retry_edit'
        }
      ]
    });

    await client.views.update({
      view_id: body.view.id,
      view: {
        type: 'modal',
        callback_id: 'preview_modal',
        title: {
          type: 'plain_text',
          text: 'Reference Edit Complete'
        },
        blocks: successBlocks
      }
    });

  } catch (error) {
    console.error('Reference image processing error:', error.message);
    
    let errorMessage = '❌ Failed to process image with reference. Please try again.';
    
    // Check for specific error types
    if (error.message === 'CONTENT_BLOCKED') {
      errorMessage = `🚫 **Content Blocked**\\n\\n${error.userMessage}\\n\\n*Try different prompts or reference images.*`;
    } else if (error.message === 'GENERATION_FAILED') {
      errorMessage = `⚠️ **Generation Failed**\\n\\n${error.userMessage}`;
    }

    await client.views.update({
      view_id: body.view.id,
      view: {
        type: 'modal',
        title: {
          type: 'plain_text',
          text: 'Error'
        },
        blocks: [{
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: errorMessage
          }
        }],
        close: {
          type: 'plain_text',
          text: 'Close'
        }
      }
    });
  }
}

async function handleApproveExtended({ ack, body, client }) {
  await ack();

  const userId = body.user.id;
  const teamId = body.team.id;
  let editedImageUrl;
  let prompt;
  let referenceCount = 0;
  let useProfilePhoto = false;

  try {
    // Parse the JSON value that contains editedImage, prompt, and reference count
    const actionValue = JSON.parse(body.actions[0].value);
    editedImageUrl = actionValue.editedImage;
    prompt = actionValue.prompt;
    referenceCount = actionValue.referenceCount || 0;
    useProfilePhoto = actionValue.useProfilePhoto || false;
  } catch (parseError) {
    console.error('Failed to parse extended action value:', parseError);
    return;
  }

  const isProduction = process.env.NODE_ENV === 'production';
  try {
    if (!isProduction) console.log(`Updating profile photo for user ${userId} (extended)`);
    
    // Update the user's profile photo
    await slackService.updateProfilePhoto(client, userId, teamId, editedImageUrl);
    
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
              text: `*Your extended profile edit has been applied!* 🎉\n\n*Prompt:* "${prompt}"\n*Profile photo used:* ${useProfilePhoto ? 'Yes' : 'No'}\n*Reference images used:* ${referenceCount}\n\nYour new profile photo is now live across Slack.`
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
    console.error('Extended edit approval error:', error.message);
    
    // Handle authorization error
    if (error.message === 'USER_NOT_AUTHORIZED') {
      const authUrl = getOAuthUrl(userId, teamId);
      
      await client.views.update({
        view_id: body.view.id,
        view: {
          type: 'modal',
          title: {
            type: 'plain_text',
            text: 'Authorization Required 🔐'
          },
          blocks: [
            {
              type: 'section',
              text: {
                type: 'mrkdwn',
                text: '*ProfileMagic needs permission to update your profile photo!*\n\nClick the button below to authorize the app.'
              }
            },
            {
              type: 'actions',
              elements: [
                {
                  type: 'button',
                  text: {
                    type: 'plain_text',
                    text: '🔗 Authorize ProfileMagic'
                  },
                  url: authUrl,
                  style: 'primary'
                }
              ]
            }
          ],
          close: {
            type: 'plain_text',
            text: 'Close'
          }
        }
      });
    } else {
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
}

async function handleRetryExtended({ ack, body, client }) {
  await ack();

  const userId = body.user.id;

  try {
    // Close current modal and re-open extended modal
    await client.views.update({
      view_id: body.view.id,
      view: {
        type: 'modal',
        callback_id: 'retry_extended_modal',
        title: {
          type: 'plain_text',
          text: 'Try Extended Edit Again ✨'
        },
        blocks: [
          {
            type: 'section',
            text: {
              type: 'mrkdwn',
              text: '*Want to create a different extended edit?*\n\nClick below to open the extended editor again with new prompts and reference images.'
            }
          },
          {
            type: 'actions',
            elements: [
              {
                type: 'button',
                text: {
                  type: 'plain_text',
                  text: '🎨 Open Extended Editor'
                },
                style: 'primary',
                action_id: 'open_extended_modal'
              }
            ]
          }
        ],
        close: {
          type: 'plain_text',
          text: 'Close'
        }
      }
    });
  } catch (error) {
    console.error('Extended retry error:', error);
  }
}

async function handleOpenExtendedModal({ ack, body, client }) {
  await ack();

  const userId = body.user.id;

  try {
    await showExtendedModal(client, body.trigger_id, '', userId);
  } catch (error) {
    console.error('Error opening extended modal:', error);
  }
}

module.exports = {
  handlePresetSelection,
  handlePreviewAction,
  handlePresetSelect,
  handleApprove,
  handleRetry,
  handleCancel,
  handleApproveMessage,
  handleRetryMessage,
  handleReferenceImageModal,
  handleReferenceImageSubmission,
  handleApproveExtended,
  handleRetryExtended,
  handleOpenExtendedModal
};