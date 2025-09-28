const { getPreset } = require('../utils/presets');
const slackService = require('../services/slack');
const imageService = require('../services/image');
const axios = require('axios');
const { getOAuthUrl } = require('../services/fileServer');
const { showExtendedModal } = require('./extendedCommand');
const fileCache = require('../utils/fileCache');

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

async function handleMessageShortcut({ ack, shortcut, client }) {
  await ack();

  const userId = shortcut.user.id;
  const messageTs = shortcut.message_ts;
  const channelId = shortcut.channel.id;
  const isProduction = process.env.NODE_ENV === 'production';

  if (!isProduction) {
    console.log(`Message shortcut triggered by user ${userId} on message ${messageTs}`);
  }

  try {
    // Get the message content
    const messageInfo = await client.conversations.history({
      channel: channelId,
      latest: messageTs,
      limit: 1,
      inclusive: true
    });

    if (!messageInfo.messages || messageInfo.messages.length === 0) {
      await client.chat.postEphemeral({
        channel: channelId,
        user: userId,
        text: '❌ Could not find the selected message. Please try again.'
      });
      return;
    }

    const message = messageInfo.messages[0];
    let prompt = '';
    let images = [];

    // Extract text as prompt
    if (message.text) {
      prompt = message.text.trim();
    }

    // Extract images from message files
    if (message.files) {
      for (const file of message.files) {
        if (file.mimetype && file.mimetype.startsWith('image/')) {
          images.push({
            url: file.url_private,
            name: file.name || 'image',
            id: file.id
          });
        }
      }
    }

    // Check for user profile photo as fallback if no images
    let useProfilePhoto = false;
    if (images.length === 0) {
      const currentPhoto = await slackService.getCurrentProfilePhoto(client, userId);
      if (currentPhoto) {
        images.push({
          url: currentPhoto,
          name: 'profile_photo',
          id: 'profile'
        });
        useProfilePhoto = true;
      }
    }

    // Validate we have content to work with
    if (images.length === 0) {
      await client.chat.postEphemeral({
        channel: channelId,
        user: userId,
        text: '❌ No images found in the selected message and no profile photo available. Please select a message with images or set a profile photo first.'
      });
      return;
    }

    if (!prompt || prompt.length === 0) {
      await client.chat.postEphemeral({
        channel: channelId,
        user: userId,
        text: '❌ No text found in the selected message to use as a prompt. Please select a message with text that describes how you want to edit the image.'
      });
      return;
    }

    if (!isProduction) {
      console.log(`Processing ${images.length} images with prompt: "${prompt}"`);
      console.log(`Using profile photo: ${useProfilePhoto}`);
    }

    // Process the first image with the prompt
    const imageToEdit = images[0];
    const referenceImage = images.length > 1 ? images[1] : null;

    // Show processing message
    const processingMessage = await client.chat.postEphemeral({
      channel: channelId,
      user: userId,
      text: `🎨 *Processing your image with NB shortcut...*\n\n*Prompt:* "${prompt}"\n*Image:* ${imageToEdit.name}\n${referenceImage ? `*Reference:* ${referenceImage.name}` : ''}\n\nThis may take a moment!`
    });

    try {
      // Edit the image
      const editedResult = await imageService.editImage(
        imageToEdit.url, 
        prompt, 
        client, 
        userId, 
        referenceImage ? referenceImage.url : null
      );

      // Create success message with before/after
      const successBlocks = [
        {
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: `✅ *Image edited with NB shortcut!* 🎉\n\n*Prompt:* "${prompt}"\n*Source:* ${useProfilePhoto ? 'Profile photo' : imageToEdit.name}\n${referenceImage ? `*Reference:* ${referenceImage.name}` : ''}`
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

      // Add the edited image
      if (editedResult.fileId) {
        successBlocks.push({
          type: 'image',
          title: {
            type: 'plain_text',
            text: '✨ AI-Edited Image'
          },
          slack_file: {
            id: editedResult.fileId
          },
          alt_text: 'AI-edited image from message shortcut'
        });
      } else if (editedResult.localUrl) {
        successBlocks.push({
          type: 'image',
          title: {
            type: 'plain_text',
            text: '✨ AI-Edited Image'
          },
          image_url: editedResult.localUrl,
          alt_text: 'AI-edited image from message shortcut'
        });
      }

      // Add action buttons for profile photo update
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
            action_id: 'approve_edit_message',
            value: JSON.stringify({ 
              editedImage: editedResult.localUrl, 
              prompt: prompt 
            })
          },
          {
            type: 'button',
            text: {
              type: 'plain_text',
              text: '🔄 Try Different Edit'
            },
            action_id: 'retry_edit_message'
          }
        ]
      });

      // Update the processing message with results
      await client.chat.update({
        channel: channelId,
        ts: processingMessage.ts,
        text: `✅ *Image edited with NB shortcut!*`,
        blocks: successBlocks
      });

    } catch (editError) {
      console.error('Image editing error:', editError.message);
      
      let errorMessage = '❌ Failed to edit your image. Please try again with a different prompt.';
      
      // Handle specific error types
      if (editError.message === 'CONTENT_BLOCKED') {
        errorMessage = `🚫 **Content Blocked**\n\n${editError.userMessage}\n\n*Try different prompts or images.*`;
      } else if (editError.message === 'GENERATION_FAILED') {
        errorMessage = `⚠️ **Generation Failed**\n\n${editError.userMessage}`;
      }

      // Update processing message with error
      await client.chat.update({
        channel: channelId,
        ts: processingMessage.ts,
        text: errorMessage
      });
    }

  } catch (error) {
    console.error('Message shortcut error:', error.message);
    await client.chat.postEphemeral({
      channel: channelId,
      user: userId,
      text: '❌ Something went wrong processing your shortcut. Please try again.'
    });
  }
}

async function handleFileSelectionModal({ ack, body, view, client }) {
  await ack();

  const userId = body.user.id;
  const teamId = body.team.id;
  const isProduction = process.env.NODE_ENV === 'production';

  try {
    // Parse metadata
    const metadata = JSON.parse(view.private_metadata);
    const { channelId, profilePhoto } = metadata;

    // Get values from the modal
    const promptValue = view.state.values.prompt_input?.prompt_text?.value?.trim();
    const uploadedFiles = view.state.values.file_input?.image_files?.files || [];
    const useProfileRef = view.state.values.profile_reference?.use_profile_reference?.selected_options || [];

    if (!promptValue) {
      return await client.views.update({
        view_id: body.view.id,
        view: {
          type: 'modal',
          title: { type: 'plain_text', text: 'Missing Prompt' },
          blocks: [{
            type: 'section',
            text: {
              type: 'mrkdwn',
              text: '❌ Please enter a prompt describing how you want to transform your images.'
            }
          }],
          close: { type: 'plain_text', text: 'Close' }
        }
      });
    }

    if (!uploadedFiles || uploadedFiles.length === 0) {
      return await client.views.update({
        view_id: body.view.id,
        view: {
          type: 'modal',
          title: { type: 'plain_text', text: 'No Files Uploaded' },
          blocks: [{
            type: 'section',
            text: {
              type: 'mrkdwn',
              text: '❌ Please upload at least one image to transform.'
            }
          }],
          close: { type: 'plain_text', text: 'Close' }
        }
      });
    }

    // Determine reference image URL
    let referenceImageUrl = null;
    if (useProfileRef.length > 0 && profilePhoto) {
      referenceImageUrl = profilePhoto;
    }

    if (!isProduction) {
      console.log(`Processing ${uploadedFiles.length} uploaded files with prompt: "${promptValue}"`);
      console.log(`Reference image: ${referenceImageUrl ? 'Yes (profile photo)' : 'No'}`);
    }

    // Show processing modal
    await client.views.update({
      view_id: body.view.id,
      view: {
        type: 'modal',
        title: { type: 'plain_text', text: 'Processing...' },
        blocks: [{
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: `🎨 *Transforming ${uploadedFiles.length} image${uploadedFiles.length === 1 ? '' : 's'}...*\n\n*Prompt:* "${promptValue}"\n\nThis may take a moment!`
          }
        }],
        close: { type: 'plain_text', text: 'Close' }
      }
    });

    // Get file URLs for processing
    const imageUrls = [];
    for (const file of uploadedFiles) {
      try {
        // Get file info from Slack
        const fileInfo = await client.files.info({
          file: file.id
        });

        if (fileInfo.file && fileInfo.file.url_private_download) {
          imageUrls.push(fileInfo.file.url_private_download);
        } else if (fileInfo.file && fileInfo.file.url_private) {
          imageUrls.push(fileInfo.file.url_private);
        }
      } catch (fileError) {
        console.error(`Failed to get info for file ${file.id}:`, fileError.message);
      }
    }

    if (imageUrls.length === 0) {
      return await client.views.update({
        view_id: body.view.id,
        view: {
          type: 'modal',
          title: { type: 'plain_text', text: 'File Access Error' },
          blocks: [{
            type: 'section',
            text: {
              type: 'mrkdwn',
              text: '❌ Could not access the uploaded files. Please try again.'
            }
          }],
          close: { type: 'plain_text', text: 'Close' }
        }
      });
    }

    // Process images
    let results = [];

    if (imageUrls.length === 1) {
      // Single image processing
      try {
        const result = await imageService.editImage(imageUrls[0], promptValue, client, userId, referenceImageUrl);
        results.push({
          success: true,
          result: result,
          index: 0,
          originalFile: { name: uploadedFiles[0].name || 'uploaded_image' }
        });
      } catch (error) {
        results.push({
          success: false,
          error: error.message,
          index: 0,
          originalFile: { name: uploadedFiles[0].name || 'uploaded_image' }
        });
      }
    } else {
      // Multiple image processing
      const batchResult = await imageService.editMultipleImages(imageUrls, promptValue, client, userId, referenceImageUrl);
      results = batchResult.results.map((r, index) => ({
        ...r,
        originalFile: { name: uploadedFiles[index]?.name || `uploaded_image_${index + 1}` }
      }));
    }

    // Build result modal
    const successful = results.filter(r => r.success);
    const failed = results.filter(r => !r.success);

    const resultBlocks = [
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `✅ *Transformation complete!*\n\n*Prompt:* "${promptValue}"\n*Successful:* ${successful.length}\n*Failed:* ${failed.length}`
        }
      }
    ];

    // Add successful results
    for (const result of successful) {
      if (result.result.fileId) {
        resultBlocks.push({
          type: 'image',
          title: {
            type: 'plain_text',
            text: `✨ ${result.originalFile.name}`
          },
          slack_file: {
            id: result.result.fileId
          },
          alt_text: `AI-transformed ${result.originalFile.name}`
        });
      } else if (result.result.localUrl) {
        resultBlocks.push({
          type: 'image',
          title: {
            type: 'plain_text',
            text: `✨ ${result.originalFile.name}`
          },
          image_url: result.result.localUrl,
          alt_text: `AI-transformed ${result.originalFile.name}`
        });
      }
    }

    // Add errors if any
    if (failed.length > 0) {
      resultBlocks.push({
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `*Failed transformations:*\n${failed.map(f => `• ${f.originalFile.name}: ${f.error}`).join('\n')}`
        }
      });
    }

    // Add action buttons for successful edits
    if (successful.length > 0) {
      resultBlocks.push({
        type: 'actions',
        elements: successful.length === 1 ? [
          {
            type: 'button',
            text: { type: 'plain_text', text: '✅ Set as Profile Picture' },
            style: 'primary',
            action_id: 'approve_edit',
            value: JSON.stringify({
              editedImage: successful[0].result.localUrl,
              prompt: promptValue
            })
          },
          {
            type: 'button',
            text: { type: 'plain_text', text: '🔄 Try Again' },
            action_id: 'retry_edit'
          }
        ] : [
          {
            type: 'button',
            text: { type: 'plain_text', text: '🔄 Try Again' },
            action_id: 'retry_edit'
          }
        ]
      });
    }

    // Update modal with results
    await client.views.update({
      view_id: body.view.id,
      view: {
        type: 'modal',
        callback_id: 'file_selection_results',
        title: { type: 'plain_text', text: 'Results ✨' },
        blocks: resultBlocks,
        close: { type: 'plain_text', text: 'Done' }
      }
    });

  } catch (error) {
    console.error('File selection modal error:', error);

    let errorMessage = '❌ Failed to process your images. Please try again.';

    if (error.message === 'CONTENT_BLOCKED') {
      errorMessage = `🚫 **Content Blocked**\n\n${error.userMessage}\n\n*Try different prompts or images.*`;
    } else if (error.message === 'GENERATION_FAILED') {
      errorMessage = `⚠️ **Generation Failed**\n\n${error.userMessage}`;
    }

    await client.views.update({
      view_id: body.view.id,
      view: {
        type: 'modal',
        title: { type: 'plain_text', text: 'Error' },
        blocks: [{
          type: 'section',
          text: { type: 'mrkdwn', text: errorMessage }
        }],
        close: { type: 'plain_text', text: 'Close' }
      }
    });
  }
}

async function handleProfileOnlyModal({ ack, body, view, client }) {
  await ack();

  const userId = body.user.id;
  const teamId = body.team.id;

  try {
    // Parse metadata
    const metadata = JSON.parse(view.private_metadata);
    const { channelId } = metadata;

    // Get prompt from modal
    const promptValue = view.state.values.prompt_input?.prompt_text?.value?.trim();

    if (!promptValue) {
      return await client.views.update({
        view_id: body.view.id,
        view: {
          type: 'modal',
          title: { type: 'plain_text', text: 'Missing Prompt' },
          blocks: [{
            type: 'section',
            text: {
              type: 'mrkdwn',
              text: '❌ Please enter a prompt describing how you want to edit your profile photo.'
            }
          }],
          close: { type: 'plain_text', text: 'Close' }
        }
      });
    }

    // Get current profile photo
    const currentPhoto = await slackService.getCurrentProfilePhoto(client, userId);
    if (!currentPhoto) {
      return await client.views.update({
        view_id: body.view.id,
        view: {
          type: 'modal',
          title: { type: 'plain_text', text: 'No Profile Photo' },
          blocks: [{
            type: 'section',
            text: {
              type: 'mrkdwn',
              text: '❌ Could not find your profile photo. Please set a profile photo first.'
            }
          }],
          close: { type: 'plain_text', text: 'Close' }
        }
      });
    }

    // Show processing modal
    await client.views.update({
      view_id: body.view.id,
      view: {
        type: 'modal',
        title: { type: 'plain_text', text: 'Processing...' },
        blocks: [{
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: `🎨 *Editing your profile photo...*\n\n*Prompt:* "${promptValue}"\n\nThis may take a moment!`
          }
        }],
        close: { type: 'plain_text', text: 'Close' }
      }
    });

    // Process the profile photo
    const result = await imageService.editImage(currentPhoto, promptValue, client, userId);

    // Build result modal
    const resultBlocks = [
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `✅ *Profile photo edited!*\n\n*Prompt:* "${promptValue}"`
        }
      },
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: '*Before & After:*'
        }
      },
      {
        type: 'image',
        title: { type: 'plain_text', text: '📸 Original' },
        image_url: currentPhoto,
        alt_text: 'Original profile photo'
      }
    ];

    // Add edited image
    if (result.fileId) {
      resultBlocks.push({
        type: 'image',
        title: { type: 'plain_text', text: '✨ AI-Edited' },
        slack_file: { id: result.fileId },
        alt_text: 'AI-edited profile photo'
      });
    } else if (result.localUrl) {
      resultBlocks.push({
        type: 'image',
        title: { type: 'plain_text', text: '✨ AI-Edited' },
        image_url: result.localUrl,
        alt_text: 'AI-edited profile photo'
      });
    }

    // Add action buttons
    resultBlocks.push({
      type: 'actions',
      elements: [
        {
          type: 'button',
          text: { type: 'plain_text', text: '✅ Set as Profile Picture' },
          style: 'primary',
          action_id: 'approve_edit',
          value: JSON.stringify({
            editedImage: result.localUrl,
            prompt: promptValue
          })
        },
        {
          type: 'button',
          text: { type: 'plain_text', text: '🔄 Try Again' },
          action_id: 'retry_edit'
        }
      ]
    });

    // Update modal with results
    await client.views.update({
      view_id: body.view.id,
      view: {
        type: 'modal',
        callback_id: 'profile_edit_results',
        title: { type: 'plain_text', text: 'Profile Edit Complete' },
        blocks: resultBlocks,
        close: { type: 'plain_text', text: 'Done' }
      }
    });

  } catch (error) {
    console.error('Profile only modal error:', error);

    let errorMessage = '❌ Failed to edit your profile photo. Please try again.';
    if (error.message === 'CONTENT_BLOCKED') {
      errorMessage = `🚫 **Content Blocked**\n\n${error.userMessage}\n\n*Try a different prompt.*`;
    } else if (error.message === 'GENERATION_FAILED') {
      errorMessage = `⚠️ **Generation Failed**\n\n${error.userMessage}`;
    }

    await client.views.update({
      view_id: body.view.id,
      view: {
        type: 'modal',
        title: { type: 'plain_text', text: 'Error' },
        blocks: [{
          type: 'section',
          text: { type: 'mrkdwn', text: errorMessage }
        }],
        close: { type: 'plain_text', text: 'Close' }
      }
    });
  }
}

async function handleUploadGuide({ ack, body, client }) {
  await ack();

  try {
    await client.views.push({
      trigger_id: body.trigger_id,
      view: {
        type: 'modal',
        callback_id: 'upload_guide_modal',
        title: {
          type: 'plain_text',
          text: 'Upload Images 📤'
        },
        blocks: [
          {
            type: 'section',
            text: {
              type: 'mrkdwn',
              text: '*How to upload images from your computer:*'
            }
          },
          {
            type: 'section',
            text: {
              type: 'mrkdwn',
              text: '*Step 1: Find the paperclip icon* 📎\nLook for the paperclip (attachment) icon in the Slack message input area.'
            }
          },
          {
            type: 'section',
            text: {
              type: 'mrkdwn',
              text: '*Step 2: Click "Your computer"* 💻\nSelect "Upload from computer" or "Your computer" option.'
            }
          },
          {
            type: 'section',
            text: {
              type: 'mrkdwn',
              text: '*Step 3: Choose your images* 🖼️\nSelect one or more images (JPG, PNG, GIF, etc.) from your computer.'
            }
          },
          {
            type: 'section',
            text: {
              type: 'mrkdwn',
              text: '*Step 4: Upload to this channel* 📤\nMake sure to upload them to this channel or DM where ProfileMagic can see them.'
            }
          },
          {
            type: 'section',
            text: {
              type: 'mrkdwn',
              text: '*Step 5: Run `/boo` again* 🔄\nAfter uploading, close this modal and try `/boo add a hat` again. Your new images will appear!'
            }
          },
          {
            type: 'divider'
          },
          {
            type: 'section',
            text: {
              type: 'mrkdwn',
              text: '*💡 Tips:*\n• You can upload multiple images at once\n• ProfileMagic works with JPG, PNG, GIF formats\n• Images stay private to this conversation\n• Larger images will be automatically resized'
            }
          }
        ],
        close: {
          type: 'plain_text',
          text: 'Got it!'
        }
      }
    });
  } catch (error) {
    console.error('Error showing upload guide:', error);
  }
}

async function handleProfileReferenceToggle({ ack, body, client }) {
  await ack();

  try {
    const metadata = JSON.parse(body.view.private_metadata);
    const { teamId, userId, channelId, profilePhoto } = metadata;

    // Get current form state
    const currentView = body.view;
    const isChecked = body.actions[0].selected_options && body.actions[0].selected_options.length > 0;

    // Create new blocks array
    const blocks = [...currentView.blocks];

    // Find the file input block
    const fileInputIndex = blocks.findIndex(block => block.block_id === 'file_input');

    if (isChecked && profilePhoto) {
      // Add profile photo thumbnail after the file input block
      const thumbnailBlock = {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: '*👤 Your Profile Photo*\n_Will be used as style reference_'
        },
        accessory: {
          type: 'image',
          image_url: profilePhoto,
          alt_text: 'Your current profile photo'
        }
      };

      // Insert thumbnail after the file input (or replace existing thumbnail)
      const nextBlockIndex = fileInputIndex + 1;
      if (nextBlockIndex < blocks.length && blocks[nextBlockIndex].type === 'section' &&
          blocks[nextBlockIndex].text?.text?.includes('Your Profile Photo')) {
        // Replace existing thumbnail
        blocks[nextBlockIndex] = thumbnailBlock;
      } else {
        // Insert new thumbnail
        blocks.splice(nextBlockIndex, 0, thumbnailBlock);
      }
    } else {
      // Remove profile photo thumbnail if unchecked
      const nextBlockIndex = fileInputIndex + 1;
      if (nextBlockIndex < blocks.length && blocks[nextBlockIndex].type === 'section' &&
          blocks[nextBlockIndex].text?.text?.includes('Your Profile Photo')) {
        blocks.splice(nextBlockIndex, 1);
      }
    }

    // Update the view with new blocks
    await client.views.update({
      view_id: body.view.id,
      view: {
        ...currentView,
        blocks: blocks
      }
    });

  } catch (error) {
    console.error('Error handling profile reference toggle:', error);
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
  handleOpenExtendedModal,
  handleMessageShortcut,
  handleFileSelectionModal,
  handleProfileOnlyModal,
  handleUploadGuide,
  handleProfileReferenceToggle
};