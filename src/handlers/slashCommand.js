const { getAllPresets } = require('../utils/presets');
const slackService = require('../services/slack');
const imageService = require('../services/image');
const userTokens = require('../services/userTokens');
const { getOAuthUrl } = require('../services/fileServer');
const { getUserProfilePhoto } = require('../utils/fileDiscovery');

async function handleSlashCommand({ command, ack, respond, client, body }) {
  const userId = body.user_id;
  const teamId = body.team_id;
  const channelId = body.channel_id;
  const prompt = command.text?.trim();
  const threadTs = body.thread_ts || null;
  const responseUrl = body.response_url;

  // Acknowledge immediately with no response to open modal instantly
  await ack();

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
              text: '🔐 *Boo needs permission to update your profile photo!*'
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
      return;
    }

    // User is authorized
    if (prompt && prompt.length > 0) {
      // Direct automatic generation based on current profile + text
      await processDirectPrompt(client, userId, teamId, prompt, body.trigger_id, respond, channelId, threadTs);
    } else {
      // No text: open the advanced modal (file selection)
      await showFileSelectionModal(client, body.trigger_id, teamId, userId, channelId, '', responseUrl, threadTs);
    }
  } catch (error) {
    console.error('Error in slash command:', error);
    await respond({
      text: '❌ Sorry, something went wrong. Please try again.',
      response_type: 'ephemeral'
    });
  }
}

async function processDirectPrompt(client, userId, teamId, prompt, triggerId, respond, channelId, threadTs) {
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
      
      // Send single response with unified layout (no before/after)
      let successText = `✅ *Edit complete!*`;
      
      const responseBlocks = [
        {
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: successText
          }
        }
      ];

      // Add edited image (use hosted URL for reliability)
      if (editedImageResult.localUrl) {
        responseBlocks.push({
          type: 'image',
          title: { type: 'plain_text', text: '✨ AI-Edited Image' },
          image_url: editedImageResult.localUrl,
          alt_text: 'AI-edited profile photo'
        });
      }

      // Standardized action buttons across flows
      const actions = [];
      // Update Profile Picture
      actions.push({
        type: 'button',
        text: { type: 'plain_text', text: '✅ Update Profile Picture' },
        style: 'primary',
        action_id: 'approve_edit_message',
        value: JSON.stringify({ editedImage: editedImageResult.localUrl, prompt })
      });
      // Post (no modal, current channel)
      actions.push({
        type: 'button',
        text: { type: 'plain_text', text: '📣 Post' },
        action_id: 'send_to_channel',
        value: JSON.stringify({
          results: [{ localUrl: editedImageResult.localUrl, filename: 'Edited Image' }],
          prompt,
          channelId
        })
      });
      // Share… (open modal with channel selector)
      actions.push({
        type: 'button',
        text: { type: 'plain_text', text: '📤 Share…' },
        action_id: 'open_share_modal',
        value: JSON.stringify({
          results: [{ localUrl: editedImageResult.localUrl, filename: 'Edited Image' }],
          prompt,
          channelId
        })
      });
      // Advanced
      actions.push({
        type: 'button',
        text: { type: 'plain_text', text: '⚙️ Advanced' },
        action_id: 'open_advanced_modal',
        value: JSON.stringify({ prompt })
      });
      // Retry (process same settings again)
      actions.push({
        type: 'button',
        text: { type: 'plain_text', text: '🔄 Retry' },
        action_id: 'retry_direct',
        value: JSON.stringify({ prompt, channelId })
      });
      responseBlocks.push({ type: 'actions', elements: actions });

      // Send single comprehensive response
      await respond({
        text: `✅ *Edit complete!*\n\n*Prompt used:* "${prompt}"`,
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
    text: '🎨 Processing...',
    response_type: 'ephemeral'
  });
}

async function showFileSelectionModal(client, triggerId, teamId, userId, channelId, prompt = '', responseUrl = null, threadTs = null) {
  try {
    // Get user profile photo for optional reference
    const profilePhoto = await getUserProfilePhoto(client, userId);

    const modal = {
      type: 'modal',
      callback_id: 'file_selection_modal',
      title: {
        type: 'plain_text',
        text: 'Boo ✨'
      },
      blocks: [

        {
          type: 'input',
          block_id: 'prompt_input',
          element: {
            type: 'plain_text_input',
            action_id: 'prompt_text',
            placeholder: {
              type: 'plain_text',
              text: 'E.g., "add sunglasses", "cartoon style", "vintage filter"'
            },
            initial_value: prompt || '',
            multiline: false
          },
          label: {
            type: 'plain_text',
            text: 'Prompt:'
          }
        },
        {
          type: 'input',
          block_id: 'file_input',
          element: {
            type: 'file_input',
            action_id: 'image_files',
            filetypes: ['jpg', 'jpeg', 'png', 'gif', 'webp'],
            max_files: 5
          },
          label: {
            type: 'plain_text',
            text: 'Use a reference image:'
          },
          optional: true
        }
      ],
      submit: {
        type: 'plain_text',
        text: 'Transform Images'
      },
      close: {
        type: 'plain_text',
        text: 'Cancel'
      },
      private_metadata: JSON.stringify({ teamId, userId, channelId, responseUrl: responseUrl || null, threadTs: threadTs || null, profilePhoto: profilePhoto ? profilePhoto : null })
    };

    // Add profile photo option if available
    if (profilePhoto) {
      modal.blocks.push({
        type: 'input',
        block_id: 'profile_reference',
        element: {
          type: 'checkboxes',
          action_id: 'use_profile_reference',
          initial_options: [{
            text: {
              type: 'plain_text',
              text: 'Use my current profile photo as an image reference',
              emoji: true
            },
            value: 'include_profile_reference'
          }],
          options: [{
            text: {
              type: 'plain_text',
              text: 'Use my current profile photo as an image reference',
              emoji: true
            },
            value: 'include_profile_reference'
          }]
        },
        label: {
          type: 'plain_text',
          text: 'Optional reference:'
        },
        optional: true
      });
    }


    await client.views.open({
      trigger_id: triggerId,
      view: modal
    });

  } catch (error) {
    console.error('Error showing file selection modal:', error);
    // Fallback to profile-only edit
    if (profilePhoto) {
      await showProfileOnlyModal(client, triggerId, teamId, userId, channelId, prompt);
    } else {
      await showNoImagesModal(client, triggerId, prompt);
    }
  }
}

async function showNoImagesModal(client, triggerId, prompt = '') {
  const modal = {
    type: 'modal',
    callback_id: 'no_images_modal',
    title: {
      type: 'plain_text',
      text: 'Upload Images First 📸'
    },
    blocks: [
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: '*No recent images found!*\n\nTo use Boo, you need to upload some images first:'
        }
      },
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: '*How to upload images:*\n\n1. 📎 Click the paperclip icon in Slack\n2. 🖼️ Select \"Upload from computer\"\n3. 🎯 Choose your images (JPG, PNG, etc.)\n4. 📤 Upload them to this channel or DM\n5. 🔄 Try `/boo` command again'
        }
      },
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: '*💡 Pro tip:* Make sure the Boo app is in any channel where you upload images, or upload directly to this DM.'
        }
      },
      {
        type: 'divider'
      },
      {
        type: 'input',
        block_id: 'prompt_input',
        element: {
          type: 'plain_text_input',
          action_id: 'prompt_text',
          placeholder: {
            type: 'plain_text',
            text: 'E.g., "make it cartoon style", "add sunglasses", "vintage filter"'
          },
          initial_value: prompt || '',
          multiline: false
        },
        label: {
          type: 'plain_text',
          text: 'Save your edit idea for when you upload images:'
        },
        optional: true
      }
    ],
    close: {
      type: 'plain_text',
      text: 'Got it'
    }
  };

  await client.views.open({
    trigger_id: triggerId,
    view: modal
  });
}

async function showProfileOnlyModal(client, triggerId, teamId, userId, channelId, prompt = '') {
  const modal = {
    type: 'modal',
    callback_id: 'profile_only_modal',
    title: {
      type: 'plain_text',
      text: 'Edit Profile Photo'
    },
    blocks: [
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: '*Transform your profile photo with AI! 🎨*\n\nI found your profile photo. You can edit it, or upload more images first.'
        }
      },
      {
        type: 'input',
        block_id: 'prompt_input',
        element: {
          type: 'plain_text_input',
          action_id: 'prompt_text',
          placeholder: {
            type: 'plain_text',
            text: 'E.g., "add sunglasses", "make it cartoon style", "vintage filter"'
          },
          initial_value: prompt || '',
          multiline: false
        },
        label: {
          type: 'plain_text',
          text: 'How should I edit your profile photo?'
        }
      },
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: '*📷 Profile Photo Found*\nI\'ll use your current profile photo for editing.'
        }
      },
      {
        type: 'divider'
      },
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: '*Want to edit other images?*\n\n📎 Upload images to this channel first, then try `/boo` again to see them in the selection menu.'
        }
      }
    ],
    submit: {
      type: 'plain_text',
      text: 'Edit Profile Photo'
    },
    close: {
      type: 'plain_text',
      text: 'Cancel'
    },
    private_metadata: JSON.stringify({
      teamId,
      userId,
      channelId,
      profilePhoto: true
    })
  };

  await client.views.open({
    trigger_id: triggerId,
    view: modal
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
      text: 'Boo ✨'
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
        text: `*✅ Edit complete!*\n\n*Prompt used:* "${prompt}"`
      }
    }
  ];

  // Only show edited image (no before/after)
  if (!isLocalhost) {
    blocks.push(
      {
        type: 'image',
        title: {
          type: 'plain_text',
          text: '✨ Edited'
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
          text: '✅ Update Profile Picture'
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
module.exports.showFileSelectionModal = showFileSelectionModal;
