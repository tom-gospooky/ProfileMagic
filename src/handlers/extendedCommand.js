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
            text: '*⚙️ Profile Photo Settings*'
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
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: '*📎 Reference Images (Optional)*\nSelect image files to guide the AI editing process.'
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
            text: '🖼️ Upload Reference Images'
          },
          optional: true
        },
        {
          type: 'context',
          elements: [
            {
              type: 'mrkdwn',
              text: '💡 *Tip:* You can upload up to 5 reference images. Supported formats: JPG, PNG, GIF, WebP.'
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
    const useProfilePhoto = view.state.values.use_profile_photo?.selected_options?.some(
      option => option.value === 'include_profile'
    ) || false;
    const uploadedFiles = view.state.values.reference_files?.ref_files?.files || [];

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
    const processingText = useProfilePhoto ? 
      '*🎨 Creating your extended edit with your profile photo...*' : 
      '*🎨 Creating your extended edit...*';
    
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
              text: `${processingText}\n\nThis may take a moment with multiple reference images!`
            }
          },
          {
            type: 'section',
            text: {
              type: 'mrkdwn',
              text: `*Prompt:* "${prompt}"\n*Using profile photo:* ${useProfilePhoto ? 'Yes ✓' : 'No'}\n*Reference images:* ${uploadedFiles.length}`
            }
          }
        ],
        close: {
          type: 'plain_text',
          text: 'Close'
        }
      }
    });

    // Get current profile photo if needed
    let currentPhoto = null;
    if (useProfilePhoto) {
      currentPhoto = await slackService.getCurrentProfilePhoto(client, userId);
      
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
                  text: '*Could not fetch your current profile photo.*\n\nPlease make sure you have a profile photo set, or uncheck "Use my current profile photo".'
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
    }

    // Collect reference image URLs from uploaded files
    const referenceImages = uploadedFiles.map(file => file.url_private).filter(Boolean);

    // Process the edit with or without profile photo
    let editedImageResult;
    if (referenceImages.length > 0) {
      // Use the first reference image (can be extended later for multiple images)
      if (useProfilePhoto && currentPhoto) {
        editedImageResult = await imageService.editImage(currentPhoto, prompt, client, userId, referenceImages[0]);
      } else {
        // Edit the reference image directly without profile photo
        editedImageResult = await imageService.editImage(referenceImages[0], prompt, client, userId);
      }
    } else {
      if (useProfilePhoto && currentPhoto) {
        editedImageResult = await imageService.editImage(currentPhoto, prompt, client, userId);
      } else {
        // No profile photo and no reference images - show error
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
                  text: '*No images to process.*\n\nPlease either:\n• Check "Use my current profile photo", or\n• Upload reference images to edit'
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
    }

    // Show success with results
    await showExtendedResults(client, body.view.id, currentPhoto, editedImageResult, prompt, referenceImages, useProfilePhoto);

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

async function showExtendedResults(client, viewId, originalImage, editedImageResult, prompt, referenceImages, useProfilePhoto) {
  const successBlocks = [
    {
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: `✅ *Extended Edit Complete!*\n\n*Prompt:* "${prompt}"`
      }
    },
    {
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: `*Settings:*\n• Profile photo used: ${useProfilePhoto ? 'Yes ✓' : 'No'}\n• Reference images: ${referenceImages.length}`
      }
    }
  ];

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
          referenceCount: referenceImages.length,
          useProfilePhoto
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