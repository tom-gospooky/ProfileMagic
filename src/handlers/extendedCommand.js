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
              text: '🔐 *ProfileMagic Extended needs permission to update your profile photo!*\n\nTo use this feature, you need to authorize the app with your personal Slack account.'
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
          }
        ]
      });
      return;
    }

    // User is authorized, show the extended modal
    await showExtendedModal(client, body.trigger_id, initialPrompt, userId);
    
  } catch (error) {
    console.error('Error in extended slash command:', error);
    await respond({
      text: '❌ Sorry, something went wrong. Please try again.',
      response_type: 'ephemeral'
    });
  }
}

async function showExtendedModal(client, triggerId, initialPrompt = '', userId) {
  try {
    // Get current profile photo for preview
    let currentPhoto = null;
    try {
      currentPhoto = await slackService.getCurrentProfilePhoto(client, userId);
    } catch (error) {
      console.log('Could not fetch current profile photo:', error.message);
    }

    const modal = {
      type: 'modal',
      callback_id: 'boo_ext_modal',
      title: {
        type: 'plain_text',
        text: 'ProfileMagic Extended ✨'
      },
      submit: {
        type: 'plain_text',
        text: 'Generate Edit'
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
            text: '*🎨 Create advanced profile edits with custom prompts and reference images!*'
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
              text: 'e.g., "add sunglasses and a hat, cartoon style"'
            },
            initial_value: initialPrompt,
            multiline: true,
            max_length: 500
          },
          label: {
            type: 'plain_text',
            text: '✍️ Describe your desired edit'
          }
        },
        {
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: '*📎 Reference Images (Optional)*\nUpload images to this channel first, then paste their URLs below. These will guide the AI editing process.'
          }
        },
        {
          type: 'input',
          block_id: 'ref_image_1',
          element: {
            type: 'plain_text_input',
            action_id: 'ref_url_1',
            placeholder: {
              type: 'plain_text',
              text: 'https://files.slack.com/...'
            }
          },
          label: {
            type: 'plain_text',
            text: '🖼️ Reference Image URL #1'
          },
          optional: true
        },
        {
          type: 'input',
          block_id: 'ref_image_2',
          element: {
            type: 'plain_text_input',
            action_id: 'ref_url_2',
            placeholder: {
              type: 'plain_text',
              text: 'https://files.slack.com/...'
            }
          },
          label: {
            type: 'plain_text',
            text: '🖼️ Reference Image URL #2'
          },
          optional: true
        },
        {
          type: 'input',
          block_id: 'ref_image_3',
          element: {
            type: 'plain_text_input',
            action_id: 'ref_url_3',
            placeholder: {
              type: 'plain_text',
              text: 'https://files.slack.com/...'
            }
          },
          label: {
            type: 'plain_text',
            text: '🖼️ Reference Image URL #3'
          },
          optional: true
        },
        {
          type: 'context',
          elements: [
            {
              type: 'mrkdwn',
              text: '💡 *Tip:* Upload images to this channel, right-click them, and copy the link to get the URL.'
            }
          ]
        }
      ]
    };

    // Add current profile preview if available
    if (currentPhoto) {
      modal.blocks.splice(2, 0, {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: '*📸 Your Current Profile Photo:*'
        }
      }, {
        type: 'image',
        image_url: currentPhoto,
        alt_text: 'Current profile photo'
      });
    }

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

  try {
    // Extract form data
    const prompt = view.state.values.prompt_input.prompt_text.value?.trim();
    const refUrl1 = view.state.values.ref_image_1.ref_url_1.value?.trim();
    const refUrl2 = view.state.values.ref_image_2.ref_url_2.value?.trim();
    const refUrl3 = view.state.values.ref_image_3.ref_url_3.value?.trim();

    if (!prompt) {
      // Show error - prompt is required
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
                text: '*Please provide a text prompt describing your desired edit.*'
              }
            }
          ],
          close: {
            type: 'plain_text',
            text: 'Close'
          }
        }
      });
      return;
    }

    // Show processing message
    await client.views.update({
      view_id: body.view.id,
      view: {
        type: 'modal',
        title: {
          type: 'plain_text',
          text: 'Processing... 🎨'
        },
        blocks: [
          {
            type: 'section',
            text: {
              type: 'mrkdwn',
              text: '*🎨 Creating your extended edit...*\n\nThis may take a moment with multiple reference images!'
            }
          },
          {
            type: 'section',
            text: {
              type: 'mrkdwn',
              text: `*Prompt:* "${prompt}"`
            }
          }
        ],
        close: {
          type: 'plain_text',
          text: 'Close'
        }
      }
    });

    // Collect reference images
    const referenceImages = [refUrl1, refUrl2, refUrl3].filter(url => 
      url && (url.includes('slack.com') || url.includes('files.slack.com'))
    );

    // Get current profile photo
    const currentPhoto = await slackService.getCurrentProfilePhoto(client, userId);
    
    if (!currentPhoto) {
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
                text: '*Could not fetch your current profile photo.*\n\nPlease make sure you have a profile photo set.'
              }
            }
          ],
          close: {
            type: 'plain_text',
            text: 'Close'
          }
        }
      });
      return;
    }

    // Process the edit with reference images
    let editedImageResult;
    if (referenceImages.length > 0) {
      // Use the first reference image for now (can be extended later)
      editedImageResult = await imageService.editImage(currentPhoto, prompt, client, userId, referenceImages[0]);
    } else {
      editedImageResult = await imageService.editImage(currentPhoto, prompt, client, userId);
    }

    // Show success with results
    await showExtendedResults(client, body.view.id, currentPhoto, editedImageResult, prompt, referenceImages);

  } catch (error) {
    console.error('Extended modal submission error:', error);
    
    let errorMessage = '❌ Failed to process your extended edit. Please try again.';
    
    if (error.message === 'CONTENT_BLOCKED') {
      errorMessage = `🚫 **Content Blocked**\n\n${error.userMessage}\n\n*Try different prompts or reference images.*`;
    } else if (error.message === 'GENERATION_FAILED') {
      errorMessage = `⚠️ **Generation Failed**\n\n${error.userMessage}`;
    }

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
              text: errorMessage
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

async function showExtendedResults(client, viewId, originalImage, editedImageResult, prompt, referenceImages) {
  const successBlocks = [
    {
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: `✅ *Extended Edit Complete!*\n\n*Prompt:* "${prompt}"`
      }
    }
  ];

  // Show reference images info if any were used
  if (referenceImages.length > 0) {
    successBlocks.push({
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: `*Reference Images Used:* ${referenceImages.length}`
      }
    });
  }

  successBlocks.push({
    type: 'section',
    text: {
      type: 'mrkdwn',
      text: '*Before & After:*'
    }
  });

  // Add original image
  successBlocks.push({
    type: 'image',
    title: {
      type: 'plain_text',
      text: '📸 Original'
    },
    image_url: originalImage,
    alt_text: 'Original profile photo'
  });

  // Add edited image
  if (editedImageResult.fileId) {
    successBlocks.push({
      type: 'image',
      title: {
        type: 'plain_text',
        text: '✨ Extended Edit Result'
      },
      slack_file: {
        id: editedImageResult.fileId
      },
      alt_text: 'AI-edited profile photo'
    });
  } else if (editedImageResult.localUrl) {
    successBlocks.push({
      type: 'image',
      title: {
        type: 'plain_text',
        text: '✨ Extended Edit Result'
      },
      image_url: editedImageResult.localUrl,
      alt_text: 'AI-edited profile photo'
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
        action_id: 'approve_ext_edit',
        value: JSON.stringify({ 
          editedImage: editedImageResult.localUrl, 
          prompt,
          referenceCount: referenceImages.length 
        })
      },
      {
        type: 'button',
        text: {
          type: 'plain_text',
          text: '🔄 Try Again'
        },
        action_id: 'retry_ext_edit'
      }
    ]
  });

  await client.views.update({
    view_id: viewId,
    view: {
      type: 'modal',
      callback_id: 'ext_results_modal',
      title: {
        type: 'plain_text',
        text: 'Extended Edit Results ✨'
      },
      blocks: successBlocks,
      close: {
        type: 'plain_text',
        text: 'Close'
      }
    }
  });
}

module.exports = {
  handleExtendedSlashCommand,
  handleExtendedModalSubmission,
  showExtendedModal
};