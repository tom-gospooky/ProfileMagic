const { getPreset } = require('../utils/presets');
const slackService = require('../services/slack');
const imageService = require('../services/image');
const axios = require('axios');
const userTokens = require('../services/userTokens');
const { getOAuthUrl } = require('../services/fileServer');
const { showExtendedModal } = require('./extendedCommand');
const { buildStandardActions } = require('../blocks/results');
const { LIMITS } = require('../constants/imageProcessing');
const { parseActionValue, parsePrivateMetadata, extractChannelId, resolveImageSourceUrl, logBestEffortError } = require('../utils/interactiveHelpers');
const { showAuthorizationModal, showSuccessModal, showErrorModal, showProcessingModal } = require('../utils/modalHelpers');

async function handleOpenAdvancedModal({ ack, body, client }) {
  await ack();

  try {
    const parsed = parseActionValue(body, {});
    const prompt = parsed.prompt || '';
    const channelId = extractChannelId(body);

    const { showFileSelectionModal } = require('./slashCommand');
    await showFileSelectionModal(
      client,
      body.trigger_id,
      body.team.id,
      body.user.id,
      channelId,
      prompt,
      body.response_url || null
    );
  } catch (error) {
    console.error('Error opening advanced modal:', error.message);
    // Best-effort ephemeral guidance
    try {
      const channelId = extractChannelId(body) || body.user.id;
      await client.chat.postEphemeral({
        channel: channelId,
        user: body.user.id,
        text: '❌ Could not open the advanced modal. Please run `/boo` again.'
      });
    } catch (e) {
      logBestEffortError('postEphemeral in handleOpenAdvancedModal', e);
    }
  }
}

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

async function handlePreviewAction({ ack }) {
  await ack();
  // This handles modal submissions for the preview modal
}

async function handlePresetSelect({ ack }) {
  await ack();
  // This handles the radio button selection (no action needed, handled in modal submission)
}

async function handleApprove({ ack, body, client }) {
  await ack();

  const userId = body.user.id;
  const teamId = body.team.id;

  const actionValue = parseActionValue(body, {});
  const editedImageUrl = actionValue.editedImage || null;
  const prompt = actionValue.prompt || 'unknown';
  const slackFileId = actionValue.slackFileId || null;
  const slackUrl = actionValue.slackUrl || null;

  const isProduction = process.env.NODE_ENV === 'production';
  try {
    if (!isProduction) console.log(`Updating profile photo for user ${userId}`);

    // Resolve a usable URL
    const sourceUrl = await resolveImageSourceUrl(client, slackUrl, editedImageUrl, slackFileId);

    // Update the user's profile photo
    await slackService.updateProfilePhoto(client, userId, teamId, sourceUrl);

    // Show success modal
    await showSuccessModal(client, body.view.id, prompt);

  } catch (error) {
    console.error('Edit approval error:', error.message);

    // Handle authorization error
    if (error.message === 'USER_NOT_AUTHORIZED') {
      await showAuthorizationModal(client, body.view.id, userId, teamId);
    } else {
      await showErrorModal(client, body.view.id);
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
  let slackFileId = null;
  let slackUrl = null;

  try {
    // Parse the JSON value that contains both editedImage and prompt
    const actionValue = JSON.parse(body.actions[0].value);
    editedImageUrl = actionValue.editedImage || null;
    prompt = actionValue.prompt;
    slackFileId = actionValue.slackFileId || null;
    slackUrl = actionValue.slackUrl || null;
  } catch (parseError) {
    // Fallback for old format (just the URL)
    editedImageUrl = body.actions[0].value;
    prompt = 'unknown';
  }

  try {
    if (!isProduction) console.log(`Updating profile photo for user ${userId}`);
    
    // Resolve a usable URL
    let sourceUrl = slackUrl || editedImageUrl;
    if (!sourceUrl && slackFileId) {
      try {
        const info = await client.files.info({ file: slackFileId });
        sourceUrl = info?.file?.url_private_download || info?.file?.url_private;
      } catch (_) {}
    }
    if (!sourceUrl) throw new Error('No edited image available');

    // Update the user's profile photo
    await slackService.updateProfilePhoto(client, userId, teamId, sourceUrl);
    
    // Show success message in current context (no DM required)
    if (body.response_url) {
      // For interactive components, use response_url if available
      await axios.post(body.response_url, {
        text: '✅ *Profile picture updated!* 🎉',
        response_type: 'ephemeral'
      });
    }

  } catch (error) {
    console.error('Edit approval error:', error.message);
    
    // Handle authorization error
    if (error.message === 'USER_NOT_AUTHORIZED') {
      const authUrl = getOAuthUrl(userId, teamId);

      if (body.response_url) {
        await axios.post(body.response_url, {
          text: '🔐 *Authorization Required*',
          response_type: 'ephemeral',
          blocks: [
            {
              type: 'section',
              text: {
                type: 'mrkdwn',
                text: '*Boo needs permission to update your profile photo!*\n\nClick the button below to authorize the app.'
              }
            },
            {
              type: 'actions',
              elements: [
                {
                  type: 'button',
                  text: {
                    type: 'plain_text',
                    text: '🔗 Authorize Boo'
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

  try {
    // Re-open the file selection modal so the user can run a fresh edit
    const { showFileSelectionModal } = require('./slashCommand');
    let prompt = '';
    try {
      const raw = body.actions?.[0]?.value;
      if (raw) {
        const parsed = JSON.parse(raw);
        prompt = parsed.prompt || '';
      }
    } catch (_) {}

    await showFileSelectionModal(
      client,
      body.trigger_id,
      body.team.id,
      body.user.id,
      body.channel.id,
      prompt,
      null
    );
  } catch (error) {
    console.error('Error re-opening modal:', error.message);
    await client.chat.postEphemeral({
      channel: body.channel.id,
      user: body.user.id,
      text: '❌ Could not open the modal. Please run `/boo` again.'
    });
  }
}

// Retry with exact same settings from results (modal flow)
async function handleRetrySame({ ack, body, client }) {
  await ack();

  try {
    const payload = parseActionValue(body, {});
    const userId = body.user.id;

    // 🔍 DEBUG LOGGING - Diagnose channel ID issue
    console.log('🔍 handleRetrySame DEBUG:', {
      'body.channel.id': body.channel?.id,
      'body.channel.name': body.channel?.name,
      'body.container.channel_id': body.container?.channel_id,
      'body.message.channel': body.message?.channel,
      'payload.channelId': payload.channelId,
      'extractChannelId(body)': extractChannelId(body),
      'userId': userId
    });

    const channelId = payload.channelId || extractChannelId(body);
    console.log('🎯 Final channelId used for retry:', channelId);
    console.log('🎯 Is DM channel?', channelId?.startsWith('D'));

    const promptValue = payload.prompt || '';
    const files = Array.isArray(payload.files) ? payload.files : [];
    const useProfileRef = payload.useProfileRef ? ['include_profile_reference'] : [];
    const threadTs = body.message?.thread_ts || body.message?.ts || body.container?.thread_ts || body.container?.message_ts || null;

    // Retry: Use response_url to maintain permission for user-to-user DMs
    // Set replaceOriginal=false to keep previous messages visible
    await processImagesAsync(
      client,
      userId,
      channelId,
      promptValue,
      files,
      useProfileRef,
      null,
      body.response_url || null, // Use response_url for DM permission
      threadTs,
      false // replaceOriginal=false keeps prior result
    );
  } catch (error) {
    console.error('Retry same-settings error:', error);
    try {
      const channelId = extractChannelId(body);
      await client.chat.postEphemeral({
        channel: channelId,
        user: body.user.id,
        text: '❌ Could not retry with the same settings. Please try again.'
      });
    } catch (e) {
      logBestEffortError('postEphemeral in handleRetrySame', e);
    }
  }
}

// Retry with exact same settings for direct prompt flow (profile-only)
async function handleRetryDirect({ ack, body, client }) {
  await ack();

  try {
    const payload = parseActionValue(body, {});
    const userId = body.user.id;

    // 🔍 DEBUG LOGGING - Diagnose channel ID issue
    console.log('🔍 handleRetryDirect DEBUG:', {
      'body.channel.id': body.channel?.id,
      'body.channel.name': body.channel?.name,
      'body.container.channel_id': body.container?.channel_id,
      'body.message.channel': body.message?.channel,
      'payload.channelId': payload.channelId,
      'extractChannelId(body)': extractChannelId(body),
      'userId': userId
    });

    const channelId = payload.channelId || extractChannelId(body);
    console.log('🎯 Final channelId used for retry:', channelId);
    console.log('🎯 Is DM channel?', channelId?.startsWith('D'));

    const promptValue = payload.prompt || '';
    const threadTs = body.message?.thread_ts || body.message?.ts || body.container?.thread_ts || body.container?.message_ts || null;

    // Retry: Use response_url to maintain permission for user-to-user DMs
    // Set replaceOriginal=false to keep previous messages visible
    await processImagesAsync(
      client,
      userId,
      channelId,
      promptValue,
      [],
      ['include_profile_reference'],
      null,
      body.response_url || null, // Use response_url for DM permission
      threadTs,
      false // replaceOriginal=false keeps prior result
    );
  } catch (error) {
    console.error('Retry direct error:', error);
    try {
      const channelId = extractChannelId(body);
      await client.chat.postEphemeral({
        channel: channelId,
        user: body.user.id,
        text: '❌ Could not retry the edit. Please try again.'
      });
    } catch (e) {
      logBestEffortError('postEphemeral in handleRetryDirect', e);
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

    // Show success with new result (no before/after), consistent header
    const { buildSuccessHeader } = require('../blocks/common');
    const successBlocks = [ buildSuccessHeader(originalPrompt, [`*Reference:* ${imageData.filename}`]) ];

    // Add edited image with reference only
    if (editedImageResult.localUrl) {
      successBlocks.push({
        type: 'image',
        title: {
          type: 'plain_text',
          text: '✨ Edited'
        },
        image_url: editedImageResult.localUrl,
        alt_text: 'AI-edited profile photo with reference'
      });
    }

    // Add standardized action buttons
    const results = [{
      localUrl: editedImageResult.localUrl || null,
      fileId: editedImageResult.fileId || editedImageResult.slackFile?.id || null,
      slackUrl: editedImageResult.slackFile?.url_private_download || null,
      filename: imageData.filename || 'Edited Image.jpg'
    }];
    const actionElements = buildStandardActions({
      results,
      prompt: originalPrompt,
      approveActionId: 'approve_edit',
      retryActionId: 'retry_edit',
      retryPayload: {}
    });
    successBlocks.push({ type: 'actions', elements: actionElements });

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
    const { buildErrorBlocks } = require('../blocks/common');
    await client.views.update({
      view_id: body.view.id,
      view: {
        type: 'modal',
        title: { type: 'plain_text', text: 'Error' },
        blocks: buildErrorBlocks(error),
        close: { type: 'plain_text', text: 'Close' }
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
  let slackFileId = null;
  let slackUrl = null;
  let referenceCount = 0;
  let useProfilePhoto = false;

  try {
    // Parse the JSON value that contains editedImage, prompt, and reference count
    const actionValue = JSON.parse(body.actions[0].value);
    editedImageUrl = actionValue.editedImage || null;
    prompt = actionValue.prompt;
    referenceCount = actionValue.referenceCount || 0;
    useProfilePhoto = actionValue.useProfilePhoto || false;
    slackFileId = actionValue.slackFileId || null;
    slackUrl = actionValue.slackUrl || null;
  } catch (parseError) {
    console.error('Failed to parse extended action value:', parseError);
    return;
  }

  const isProduction = process.env.NODE_ENV === 'production';
  try {
    if (!isProduction) console.log(`Updating profile photo for user ${userId} (extended)`);
    
    // Resolve best URL
    let sourceUrl = slackUrl || editedImageUrl;
    if (!sourceUrl && slackFileId) {
      try {
        const info = await client.files.info({ file: slackFileId });
        sourceUrl = info?.file?.url_private_download || info?.file?.url_private;
      } catch (_) {}
    }
    if (!sourceUrl) throw new Error('No edited image available');

    // Update the user's profile photo
    await slackService.updateProfilePhoto(client, userId, teamId, sourceUrl);
    
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
                text: '*Boo needs permission to update your profile photo!*\n\nClick the button below to authorize the app.'
              }
            },
            {
              type: 'actions',
              elements: [
                {
                  type: 'button',
                  text: {
                    type: 'plain_text',
                    text: '🔗 Authorize Boo'
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

async function handleMessageShortcut({ ack, shortcut, body, client }) {
  await ack();

  const sc = shortcut || {};
  const b = body || {};
  const container = sc.container || b.container || {};
  const msg = sc.message || b.message || {};

  const userId = sc.user?.id || b.user?.id || sc.user_id || b.user_id;
  const messageTs = sc.message_ts || msg.ts || container.message_ts || b.message_ts;
  const channelId = sc.channel?.id || sc.channel_id || b.channel?.id || b.channel_id || container.channel_id || msg.channel || msg.channel_id;
  const threadTs = msg.thread_ts || container.thread_ts || messageTs;
  const isProduction = process.env.NODE_ENV === 'production';

  if (!isProduction) {
    console.log('Shortcut debug:', {
      userId, messageTs, channelId,
      hasContainer: !!container.channel_id, hasMsg: !!msg.ts
    });
  }

  if (!channelId || !messageTs) {
    console.error('Shortcut payload missing channel or message_ts');
    try {
      // Best-effort DM back to the user with guidance
      await client.chat.postMessage({ channel: userId, text: '❌ Could not resolve the selected message or channel. Please try again from a channel or thread message.' });
    } catch (_) {}
    return;
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

    // Show processing message (in thread if applicable)
    const processingMessage = await client.chat.postEphemeral({
      channel: channelId,
      user: userId,
      text: `🎨 *Processing your image with NB shortcut...*\n\n*Prompt:* "${prompt}"\n*Image:* ${imageToEdit.name}\n${referenceImage ? `*Reference:* ${referenceImage.name}` : ''}\n\nThis may take a moment!`,
      thread_ts: threadTs
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

      // Create success message with consistent header
      const { buildSuccessHeader } = require('../blocks/common');
      const meta = [
        `*Source:* ${useProfilePhoto ? 'Profile photo' : imageToEdit.name}`,
        referenceImage ? `*Reference:* ${referenceImage.name}` : ''
      ].filter(Boolean);
      const successBlocks = [ buildSuccessHeader(prompt, meta) ];

      // Add the edited image when an external URL exists
      if (editedResult.localUrl) {
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
            text: { type: 'plain_text', text: '✅ Set as Profile Picture' },
            style: 'primary',
            action_id: 'approve_edit_message',
            value: JSON.stringify({
              editedImage: editedResult.localUrl || null,
              slackFileId: editedResult.fileId || editedResult.slackFile?.id || null,
              slackUrl: editedResult.slackFile?.url_private_download || null,
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

      // Ephemerals can't be updated—send a new ephemeral with blocks (in-thread if applicable)
      await client.chat.postEphemeral({
        channel: channelId,
        user: userId,
        text: '✅ Edit complete!',
        blocks: successBlocks,
        thread_ts: threadTs
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

      // Send new ephemeral with error (in-thread if applicable)
      const { buildErrorBlocks, buildErrorText } = require('../blocks/common');
      const blocksErr = buildErrorBlocks(editError);
      const textErr = buildErrorText(editError);
      await client.chat.postEphemeral({ channel: channelId, user: userId, text: textErr, blocks: blocksErr, thread_ts: threadTs });
    }

  } catch (error) {
    console.error('Message shortcut error:', error.message);
    const { buildErrorBlocks, buildErrorText } = require('../blocks/common');
    const generic = new Error('GENERATION_FAILED');
    generic.userMessage = 'Something went wrong processing your shortcut. Please try again.';
    await client.chat.postEphemeral({ channel: channelId, user: userId, text: buildErrorText(generic), blocks: buildErrorBlocks(generic) });
  }
}

async function handleFileSelectionModal({ ack, body, view, client }) {
  const userId = body.user.id;

  try {
    // Parse metadata
    const metadata = JSON.parse(view.private_metadata);
    const { channelId, profilePhoto, responseUrl, threadTs } = metadata;

    // Get values from the modal
    const promptValue = view.state.values.prompt_input?.prompt_text?.value?.trim();
    const uploadedFiles = view.state.values.file_input?.image_files?.files || [];
    const useProfileRef = view.state.values.profile_reference?.use_profile_reference?.selected_options || [];

    // Validate inputs BEFORE acknowledging
    if (!promptValue) {
      return await ack({
        response_action: 'errors',
        errors: {
          'prompt_input': 'Please enter a prompt describing how you want to transform your images.'
        }
      });
    }

    // Validate we have either uploaded files OR profile photo reference
    const hasUploadedFiles = uploadedFiles && uploadedFiles.length > 0;
    const hasProfileRef = useProfileRef.length > 0 && profilePhoto;

    if (!hasUploadedFiles && !hasProfileRef) {
      return await ack({
        response_action: 'errors',
        errors: {
          'file_input': 'Please either upload images OR check "Use my current profile photo as image reference".'
        }
      });
    }

    // Validation passed - acknowledge and close modal
    await ack({
      response_action: 'clear'
    });

    console.log(`✅ Modal acknowledged and closed for user ${userId}`);
    console.log('Channel/User info:', { channelId, userId, hasProfilePhoto: !!profilePhoto });

    // Process asynchronously AFTER modal is acknowledged
    processImagesAsync(client, userId, channelId, promptValue, uploadedFiles, useProfileRef, profilePhoto, responseUrl, threadTs || null)
      .catch(async error => {
        console.error('Critical error in background processing:', error);
        // Try to send error message to user
        const fallbackResult = await sendMessageRobust(client, channelId, userId, '❌ Something went wrong with image processing. Please try again.');
        if (!fallbackResult) {
          console.error('Failed to deliver error message via any channel.');
        }
      });

  } catch (error) {
    console.error('File selection modal error:', error);
    // If we haven't ack'd yet, send error response
    try {
      await ack({
        response_action: 'errors',
        errors: {
          "prompt_input": "Something went wrong. Please try again."
        }
      });
    } catch (ackError) {
      console.error('Failed to ack modal with error:', ackError);
    }
  }
}

// Try to join a public channel if not in it
async function ensureBotInChannel(client, channelId) {
  try {
    if (typeof channelId === 'string' && channelId.startsWith('C')) {
      await client.conversations.join({ channel: channelId });
      console.log(`↩️ Joined channel ${channelId}`);
    }
  } catch (e) {
    console.log('Join attempt skipped/failed:', e.data?.error || e.message);
  }
}

// Resolve a safe destination channel for sharing.
// - For public channels (C*): attempt join
// - For private (G*): verify membership; if not a member, return null with reason
// - For DMs or missing: open DM with the user
async function ensureDestinationChannelId(client, desiredChannelId, userId) {
  try {
    if (!desiredChannelId || typeof desiredChannelId !== 'string') {
      const im = await client.conversations.open({ users: userId });
      return { channelId: im.channel?.id, reason: 'opened_dm' };
    }
    if (desiredChannelId.startsWith('D')) {
      // Return provided DM channel as-is (might be user-to-user DM from slash command)
      // Do NOT call conversations.open as it returns bot-user DM, not the original DM
      return { channelId: desiredChannelId, reason: 'dm' };
    }
    if (desiredChannelId.startsWith('C')) {
      try { await ensureBotInChannel(client, desiredChannelId); } catch (_) {}
      return { channelId: desiredChannelId, reason: 'public' };
    }
    if (desiredChannelId.startsWith('G')) {
      try {
        const info = await client.conversations.info({ channel: desiredChannelId });
        const isMember = info?.channel?.is_member === true || info?.channel?.is_member === 'true';
        if (!isMember) {
          return { channelId: null, reason: 'not_in_private' };
        }
        return { channelId: desiredChannelId, reason: 'private' };
      } catch (e) {
        return { channelId: null, reason: e.data?.error || 'channel_not_found' };
      }
    }
    // Fallback: try as-is
    return { channelId: desiredChannelId, reason: 'unknown' };
  } catch (e) {
    console.log('ensureDestinationChannelId error:', e.message);
    try {
      const im = await client.conversations.open({ users: userId });
      return { channelId: im.channel?.id, reason: 'fallback_dm' };
    } catch (_) {
      return { channelId: null, reason: 'failed_open_dm' };
    }
  }
}

// Robust message delivery with fallback cascade
// Returns Slack API result augmented with { deliveryMethod }
// options.allowPublic: when true, may post publicly; otherwise never posts publicly
async function sendMessageRobust(client, channelId, userId, text, blocks = undefined, options = {}) {
  const allowPublic = !!options.allowPublic;
  const threadTs = options.threadTs || undefined;
  const isImChannel = typeof channelId === 'string' && channelId.startsWith('D');
  const methods = [];

  // Default privacy: ephemeral first, then DM. Only use public when explicitly allowed.
  if (!isImChannel) {
    methods.push({
      name: 'ephemeral',
      fn: () => client.chat.postEphemeral({ channel: channelId, user: userId, text, blocks, ...(threadTs ? { thread_ts: threadTs } : {}) })
    });
  } else {
    // For DM channels, post directly to the DM conversation (channelId), not open new DM with userId
    methods.push({
      name: 'dm_in_channel',
      fn: () => client.chat.postMessage({ channel: channelId, text, blocks, ...(threadTs ? { thread_ts: threadTs } : {}) })
    });
  }

  // Fallback: open/use DM with user (may create new DM if channelId failed)
  methods.push({
    name: 'dm_to_user',
    fn: () => client.chat.postMessage({ channel: userId, text, blocks, ...(threadTs ? { thread_ts: threadTs } : {}) })
  });

  if (allowPublic) {
    methods.unshift({
      name: 'public_message',
      fn: () => client.chat.postMessage({ channel: channelId, text, blocks, ...(threadTs ? { thread_ts: threadTs } : {}) })
    });
  }

  for (const method of methods) {
    try {
      let result;
      try {
        result = await method.fn();
      } catch (firstError) {
        // Attempt a one-time join & retry for public channels when not_in_channel
        const errCode = firstError.data?.error || firstError.code || firstError.message;
        const isPublicChan = typeof channelId === 'string' && channelId.startsWith('C');
        if (method.name === 'ephemeral' && isPublicChan && ['not_in_channel','channel_not_found'].includes(errCode)) {
          try {
            await ensureBotInChannel(client, channelId);
            result = await method.fn();
          } catch (_) {
            throw firstError;
          }
        } else if (allowPublic && method.name === 'public_message' && ['not_in_channel','channel_not_found'].includes(errCode)) {
          await ensureBotInChannel(client, channelId);
          result = await method.fn();
        } else {
          throw firstError;
        }
      }
      console.log(`✅ Message sent successfully via ${method.name}`);
      // annotate delivery method for callers
      if (result && typeof result === 'object') {
        result.deliveryMethod = method.name;
      }
      return result;
    } catch (error) {
      try {
        const { logSlackError } = require('../utils/logging');
        logSlackError(`sendMessageRobust:${method.name}`, error);
      } catch (_) {
        console.log(`❌ ${method.name} failed:`, error.data?.error || error.message);
      }
      continue;
    }
  }

  console.log('⚠️ All message methods failed, continuing processing...');
  return null; // Return null instead of throwing to allow processing to continue
}

async function processImagesAsync(client, userId, channelId, promptValue, uploadedFiles, useProfileRef, profilePhoto, responseUrl = null, threadTs = null, replaceOriginal = true) {
  console.log('🚀 processImagesAsync STARTED');
  console.log('Parameters:', { userId, channelId, promptValue, uploadedFilesCount: uploadedFiles?.length || 0, useProfileRefCount: useProfileRef?.length || 0, hasProfilePhoto: !!profilePhoto });

  let processingMsg = null;
  let processingTs = null;
  let processingChannel = null;
  let usedResponseUrl = false;

  try {
    // Determine profile photo to include if requested
    let profileImageUrl = null;
    if (useProfileRef.length > 0) {
      console.log('🔄 Fetching fresh profile photo...');
      const slackService = require('../services/slack');
      profileImageUrl = await slackService.getCurrentProfilePhoto(client, userId);
      if (!profileImageUrl) {
        console.error('❌ Failed to fetch current profile photo');
      } else {
        console.log('✅ Fresh profile photo retrieved successfully');
      }
    }

    console.log(`Processing ${uploadedFiles?.length || 0} uploaded files with prompt: "${promptValue}"`);
    console.log(`Include profile photo: ${profileImageUrl ? 'Yes' : 'No'}`);
    console.log(`Target channel: ${channelId}, User: ${userId}`);

    // Send processing message using robust cascade approach
    // We will process each image individually; message shows total count
    // const plannedSourcesCount = (uploadedFiles?.length || 0) + (profileImageUrl ? 1 : 0);
    const text = `🎨 Processing...`;
    // const text = `🎨 *Processing ${plannedSourcesCount} image${plannedSourcesCount === 1 ? '' : 's'}...*\n*Prompt:* "${promptValue}"\n\nYour results will appear here shortly!`;

    console.log('📤 Attempting to send processing message...');
    if (responseUrl) {
      console.log('🔍 RESPONSE_URL DEBUG:', {
        hasResponseUrl: !!responseUrl,
        urlPreview: responseUrl?.substring(0, 50) + '...',
        replaceOriginal: !!replaceOriginal,
        channelId,
        userId,
        isUserToUserDM: channelId?.startsWith('D'),
        hasThreadTs: !!threadTs
      });

      try {
        const response = await axios.post(responseUrl, {
          response_type: 'ephemeral',
          text,
          replace_original: !!replaceOriginal,
          ...(threadTs ? { thread_ts: threadTs } : {})
        });

        console.log('✅ response_url POST succeeded:', {
          status: response.status,
          statusText: response.statusText,
          dataPreview: JSON.stringify(response.data || {}).substring(0, 100)
        });
        usedResponseUrl = true;
      } catch (e) {
        console.log('❌ response_url POST FAILED:', {
          status: e.response?.status,
          statusText: e.response?.statusText,
          errorData: e.response?.data,
          errorMessage: e.message,
          willFallbackTo: 'sendMessageRobust'
        });
        usedResponseUrl = false;
        processingMsg = await sendMessageRobust(client, channelId, userId, text, undefined, { allowPublic: false, threadTs });
        processingTs = processingMsg?.ts || processingMsg?.message_ts || null;
        processingChannel = processingMsg?.channel || channelId;
      }
    } else {
      console.log('⚠️ No response_url provided, using sendMessageRobust directly');
      processingMsg = await sendMessageRobust(client, channelId, userId, text, undefined, { allowPublic: false, threadTs });
      processingTs = processingMsg?.ts || processingMsg?.message_ts || null;
      processingChannel = processingMsg?.channel || channelId;
    }

    // Build sources for processing (uploaded + optional profile)
    let sources = [];
    for (const file of uploadedFiles) {
      try {
        // Get file info from Slack
        const fileInfo = await client.files.info({
          file: file.id
        });

        if (fileInfo.file && fileInfo.file.url_private_download) {
          sources.push({ url: fileInfo.file.url_private_download, name: file.name || 'uploaded_image' });
        } else if (fileInfo.file && fileInfo.file.url_private) {
          sources.push({ url: fileInfo.file.url_private, name: file.name || 'uploaded_image' });
        }
      } catch (fileError) {
        console.error(`Failed to get info for file ${file.id}:`, fileError.message);
      }
    }

    // If profile selected, ensure it is included
    // Gemini limit: allow at most N images per request (user precedence rule: profile takes precedence)
    const uploaded = [...sources];
    sources = uploaded; // start from uploaded
    if (profileImageUrl) {
      // Build combined list: keep first two uploads and profile photo
      const trimmedUploads = uploaded.slice(0, Math.max(0, LIMITS.MAX_IMAGES_PER_REQUEST - 1));
      sources = [...trimmedUploads, { url: profileImageUrl, name: 'profile_photo', isProfile: true }];
      if (uploaded.length > trimmedUploads.length) {
        console.log(`✂️ Trimmed uploaded images from ${uploaded.length} to ${trimmedUploads.length} to include profile photo`);
      }
    } else {
      // No profile: cap uploads to max
      if (sources.length > LIMITS.MAX_IMAGES_PER_REQUEST) {
        console.log(`✂️ Trimmed uploaded images from ${sources.length} to ${LIMITS.MAX_IMAGES_PER_REQUEST}`);
        sources = sources.slice(0, LIMITS.MAX_IMAGES_PER_REQUEST);
      }
    }

    // Validate we have at least one image to process
    if (sources.length === 0) {
      await sendMessageRobust(client, channelId, userId, '❌ Could not access any images to process. Please try again.');
      return;
    }


    // Process images directly (no setTimeout needed)
    try {
        let results = [];

        if (sources.length === 1) {
          // Single image processing
          try {
            const result = await imageService.editImage(sources[0].url, promptValue, client, userId, null, channelId);
            results.push({ success: true, result, index: 0, originalFile: { name: sources[0].name } });
          } catch (error) {
            results.push({ success: false, error: error.message, index: 0, originalFile: { name: sources[0].name } });
          }
        } else {
          // Multiple images processed together to produce ONE result
          const urls = sources.map(s => s.url);
          try {
            const result = await imageService.editImageGroup(urls, promptValue, client, userId, channelId);
            results.push({ success: true, result, index: 0, originalFile: { name: sources.map(s => s.name).join(', ') } });
          } catch (error) {
            results.push({ success: false, error: error.message, index: 0, originalFile: { name: 'combined_images' } });
          }
        }

        // Build result blocks
        const successful = results.filter(r => r.success);
        const failed = results.filter(r => !r.success);

        const { buildSuccessHeader } = require('../blocks/common');
        const resultBlocks = [ buildSuccessHeader(promptValue) ];

        // Add successful results (use public URL for reliability)
        {
          const { buildImageBlocksFromResults, buildStandardActions } = require('../blocks/results');
          const imgBlocks = buildImageBlocksFromResults(successful);
          resultBlocks.push(...imgBlocks);

          // Add standardized action buttons
          if (successful.length > 0) {
            const profileSelected = Array.isArray(useProfileRef) && useProfileRef.length > 0;
            const actions = buildStandardActions({
              results: successful,
              prompt: promptValue,
              channelId: channelId,
              approveActionId: 'approve_edit_message',
              retryActionId: 'retry_same',
              retryPayload: {
                prompt: promptValue,
                channelId: channelId,
                files: (uploadedFiles || []).map(f => ({ id: f.id, name: f.name })),
                useProfileRef: !!profileSelected
              },
              advancedPromptValue: promptValue
            });
            resultBlocks.push({ type: 'actions', elements: actions });
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

        // Actions already added via buildStandardActions above; avoid duplicates

        // Update the processing message with results (handle response_url vs chat.update)
        const { SUCCESS_TEXT } = require('../blocks/common');
        const successText = SUCCESS_TEXT;

        if (usedResponseUrl && responseUrl) {
          console.log('🔍 RESULT UPDATE via response_url:', {
            hasResponseUrl: !!responseUrl,
            replaceOriginal: !!replaceOriginal,
            blockCount: resultBlocks.length,
            channelId,
            isUserToUserDM: channelId?.startsWith('D')
          });

          try {
            const response = await axios.post(responseUrl, {
              response_type: 'ephemeral',
              text: successText,
              blocks: resultBlocks,
              replace_original: !!replaceOriginal,
              ...(threadTs ? { thread_ts: threadTs } : {})
            });

            console.log('✅ Result update via response_url succeeded:', {
              status: response.status,
              statusText: response.statusText
            });
          } catch (e) {
            console.log('❌ response_url result update FAILED:', {
              status: e.response?.status,
              statusText: e.response?.statusText,
              errorData: e.response?.data,
              errorMessage: e.message,
              willFallbackTo: 'sendMessageRobust'
            });
            await sendMessageRobust(client, channelId, userId, successText, resultBlocks, { allowPublic: false, threadTs });
          }
        } else if (processingTs && processingMsg?.deliveryMethod !== 'ephemeral') {
          try {
            await client.chat.update({
              channel: processingChannel,
              ts: processingTs,
              text: successText,
              blocks: resultBlocks
            });
            console.log('✅ Results updated in processing message');
          } catch (updateError) {
            try { const { logSlackError } = require('../utils/logging'); logSlackError('chat.update(results)', updateError); } catch(_) { console.log('❌ Failed to update processing message:', updateError.message); }
            // Fallback: send new message
            await sendMessageRobust(client, channelId, userId, successText, resultBlocks, { allowPublic: false, threadTs });
          }
        } else {
          console.log('⚠️ No processing message to update, sending new results message');
          await sendMessageRobust(client, channelId, userId, successText, resultBlocks, { allowPublic: false, threadTs });
        }

      } catch (error) {
        console.error('Background processing error:', error);

        let errorMessage = '❌ Failed to process your images. Please try again.';

        if (error.message === 'CONTENT_BLOCKED') {
          errorMessage = `🚫 **Content Blocked**\n\n${error.userMessage}\n\n*Try different prompts or images.*`;
        } else if (error.message === 'GENERATION_FAILED') {
          errorMessage = `⚠️ **Generation Failed**\n\n${error.userMessage}`;
        }

        // Update the processing message with error
        const errorBlocks = [{
          type: 'section',
          text: { type: 'mrkdwn', text: errorMessage }
        }];

        if (usedResponseUrl && responseUrl) {
          console.log('🔍 ERROR UPDATE via response_url:', {
            hasResponseUrl: !!responseUrl,
            replaceOriginal: !!replaceOriginal,
            channelId,
            isUserToUserDM: channelId?.startsWith('D')
          });

          try {
            const response = await axios.post(responseUrl, {
              response_type: 'ephemeral',
              text: errorMessage,
              blocks: errorBlocks,
              replace_original: !!replaceOriginal,
              ...(threadTs ? { thread_ts: threadTs } : {})
            });

            console.log('✅ Error update via response_url succeeded:', {
              status: response.status,
              statusText: response.statusText
            });
          } catch (e) {
            console.log('❌ response_url error update FAILED:', {
              status: e.response?.status,
              statusText: e.response?.statusText,
              errorData: e.response?.data,
              errorMessage: e.message,
              willFallbackTo: 'sendMessageRobust'
            });
            await sendMessageRobust(client, channelId, userId, errorMessage, errorBlocks, { allowPublic: false, threadTs });
          }
        } else if (processingTs && processingMsg?.deliveryMethod !== 'ephemeral') {
          try {
            await client.chat.update({
              channel: processingChannel,
              ts: processingTs,
              text: errorMessage,
              blocks: errorBlocks
            });
          } catch (updateError) {
            try { const { logSlackError } = require('../utils/logging'); logSlackError('chat.update(error)', updateError); } catch(_) { console.log('❌ Failed to update processing message with error:', updateError.message); }
            await sendMessageRobust(client, channelId, userId, errorMessage, errorBlocks, { allowPublic: false, threadTs });
          }
        } else {
          await sendMessageRobust(client, channelId, userId, errorMessage, errorBlocks, { allowPublic: false, threadTs });
        }
    }

  } catch (error) {
    console.error('Image processing error:', error);

    let errorMessage = '❌ Failed to process your images. Please try again.';

    if (error.message === 'CONTENT_BLOCKED') {
      errorMessage = `🚫 **Content Blocked**\n\n${error.userMessage}\n\n*Try different prompts or images.*`;
    } else if (error.message === 'GENERATION_FAILED') {
      errorMessage = `⚠️ **Generation Failed**\n\n${error.userMessage}`;
    }

    // Send error message using robust delivery
    try {
      await sendMessageRobust(client, channelId, userId, errorMessage, undefined, { allowPublic: false, threadTs });
    } catch (messageError) {
      console.error('All error message delivery methods failed:', messageError);
    }
  }
}

async function handleProfileOnlyModal({ ack, body, view, client }) {
  await ack();

  const userId = body.user.id;

  try {
    // Parse metadata
    const metadata = JSON.parse(view.private_metadata);

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

    // Build result modal with consistent header
    const { buildSuccessHeader } = require('../blocks/common');
    const resultBlocks = [ buildSuccessHeader(promptValue) ];

    // Add edited image
    if (result.localUrl) {
      resultBlocks.push({
        type: 'image',
        title: { type: 'plain_text', text: '✨ Edited' },
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
              text: '*Step 4: Upload to this channel* 📤\nMake sure to upload them to this channel or DM where Boo can see them.'
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
              text: '*💡 Tips:*\n• You can upload multiple images at once\n• Boo works with JPG, PNG, GIF formats\n• Images stay private to this conversation\n• Larger images will be automatically resized'
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
    const { profilePhoto } = metadata;

    // Get current form state
    const currentView = body.view;
    const isChecked = body.actions[0].selected_options && body.actions[0].selected_options.length > 0;

    // Create new blocks array
    const blocks = [...currentView.blocks];

    // Find the file input block
    const fileInputIndex = blocks.findIndex(block => block.block_id === 'file_input');

    if (isChecked && profilePhoto) {
      // Add profile photo as a small image block right after the file input to simulate being part of the files
      const thumbnailBlock = {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: '*👤 Profile Photo*\n_Added as reference image_'
        },
        accessory: {
          type: 'image',
          image_url: profilePhoto,
          alt_text: 'Your current profile photo (reference)'
        }
      };

      // Insert thumbnail right after the file input (or replace existing thumbnail)
      const nextBlockIndex = fileInputIndex + 1;
      if (nextBlockIndex < blocks.length && blocks[nextBlockIndex].type === 'section' &&
          blocks[nextBlockIndex].text?.text?.includes('Profile Photo')) {
        // Replace existing thumbnail
        blocks[nextBlockIndex] = thumbnailBlock;
      } else {
        // Insert new thumbnail after file input
        blocks.splice(nextBlockIndex, 0, thumbnailBlock);
      }
    } else {
      // Remove profile photo thumbnail if unchecked
      const nextBlockIndex = fileInputIndex + 1;
      if (nextBlockIndex < blocks.length && blocks[nextBlockIndex].type === 'section' &&
          blocks[nextBlockIndex].text?.text?.includes('Profile Photo')) {
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

async function handleSendToChannel({ ack, body, client }) {
  await ack();

  const userId = body.user.id;
  const parsed = JSON.parse(body.actions[0].value);
  const { results, prompt, channelId } = parsed;

  try {
    // Build public message blocks
    const messageBlocks = [
      {
        type: 'section',
        text: { type: 'mrkdwn', text: `🎨 *<@${userId}> shared AI-transformed image*\n\n*Prompt:* "${prompt}"` }
      }
    ];

    for (const result of results) {
      // Use our hosted image URL for reliable rendering in any channel
      if (result.localUrl) {
        messageBlocks.push({
          type: 'image',
          title: { type: 'plain_text', text: `✨ ${result.filename}` },
          image_url: result.localUrl,
          alt_text: `AI-transformed ${result.filename}`
        });
      }
    }

    // Post publicly into the current channel
    await ensureBotInChannel(client, channelId);
    await client.chat.postMessage({
      channel: channelId,
      text: `🎨 <@${userId}> shared AI-transformed image using prompt: "${prompt}"`,
      blocks: messageBlocks
    });

    // Send an ephemeral helper to let the user re-share with a custom caption
    const helperBlocks = [
      {
        type: 'section',
        text: { type: 'mrkdwn', text: '✅ Your image has been posted to this channel. Want to add your own caption and share again?' }
      }
    ];
    if (results[0]?.localUrl) {
      helperBlocks.push({
        type: 'image',
        title: { type: 'plain_text', text: 'Preview' },
        image_url: results[0].localUrl,
        alt_text: 'Preview'
      });
    }
    helperBlocks.push({
      type: 'actions',
      elements: [
        {
          type: 'button',
          text: { type: 'plain_text', text: '📝 Add Caption & Share' },
          action_id: 'open_share_modal',
          value: JSON.stringify({ results, prompt, channelId })
        }
      ]
    });

    await client.chat.postEphemeral({ channel: channelId, user: userId, text: 'Shared', blocks: helperBlocks });
  } catch (error) {
    console.error('Error sending to channel:', error);
    await client.chat.postEphemeral({
      channel: body.channel.id,
      user: userId,
      text: '❌ Failed to send images to channel. Please invite the app to the channel or try again.'
    });
  }
}

async function handleOpenShareModal({ ack, body, client }) {
  await ack();
  const userId = body.user.id;
  try {
    const payload = JSON.parse(body.actions[0].value);
    const { results, prompt, channelId } = payload;
    const { buildShareModalView } = require('../blocks/share');
    await client.views.open({ trigger_id: body.trigger_id, view: buildShareModalView({ results, prompt, channelId, userId }) });
  } catch (e) {
    console.error('Failed to open Share modal:', e);
  }
}

// Global shortcut: open the same modal as /boo, defaulting to a DM channel with the user
async function handleGlobalShortcut({ ack, shortcut, client }) {
  await ack();

  try {
    const userId = shortcut.user?.id || shortcut.user_id;
    const teamId = shortcut.team?.id || shortcut.team_id;
    // Open IM to get a valid channel id for ephemerals
    const dm = await client.conversations.open({ users: userId });
    const dmChannelId = dm.channel?.id;

    const { showFileSelectionModal } = require('./slashCommand');
    await showFileSelectionModal(
      client,
      shortcut.trigger_id,
      teamId,
      userId,
      dmChannelId,
      ''
    );
  } catch (e) {
    console.error('Global shortcut error:', e.message);
  }
}

async function handleShareToChannelSubmission({ ack, body, client }) {
  // Close modal immediately
  await ack({ response_action: 'clear' });

  const userId = body.user.id;
  const teamId = body.team.id;
  const meta = JSON.parse(body.view.private_metadata || '{}');
  const { results, prompt, defaultChannel } = meta;
  const selectedChannel = body.view.state.values?.channel_select?.selected_channel?.selected_conversation || defaultChannel;
  const caption = body.view.state.values.caption_input?.share_caption?.value?.trim();

  try {
    // Use the user's token to post as the user
    const userToken = userTokens.getUserToken(userId, teamId);
    if (!userToken) {
      try {
        const { getOAuthUrl } = require('../services/fileServer');
        const authUrl = getOAuthUrl(userId, teamId);
        await client.chat.postEphemeral({
          channel: body.user.id,
          user: userId,
          text: '🔐 Please authorize Boo to share files as you.',
          blocks: [
            { type: 'section', text: { type: 'mrkdwn', text: '*Authorization Required*\nBoo needs permission to share images as you.' } },
            { type: 'actions', elements: [ { type: 'button', text: { type: 'plain_text', text: '🔗 Authorize Boo' }, url: authUrl, style: 'primary' } ] }
          ]
        });
      } catch (_) {}
      return;
    }

    const { WebClient } = require('@slack/web-api');
    const userClient = new WebClient(userToken);

    // Resolve destination channel: selection (if member) else DM
    let destinationChannelId = null;
    let notifyFallback = false;
    if (typeof selectedChannel === 'string' && selectedChannel.length > 0) {
      if (selectedChannel.startsWith('D')) {
        destinationChannelId = selectedChannel;
      } else if (selectedChannel.startsWith('C') || selectedChannel.startsWith('G')) {
        try {
          const info = await userClient.conversations.info({ channel: selectedChannel });
          if (info?.channel?.is_member) destinationChannelId = selectedChannel;
        } catch (e) {
          console.log('User conversations.info failed:', e.data?.error || e.message);
        }
      }
    }
    if (!destinationChannelId) {
      const im = await client.conversations.open({ users: userId });
      destinationChannelId = im.channel?.id;
      notifyFallback = true;
    }

    // Upload helper (as user)
    async function uploadBufferAsFile(buffer, filename, initial_comment = undefined) {
      const name = (filename && /\.(jpg|jpeg|png|gif|webp)$/i.test(filename)) ? filename : `${(filename || 'edited_image').replace(/\.+$/,'')}.jpg`;
      try {
        await userClient.files.uploadV2({ channel_id: destinationChannelId, file: buffer, filename: name, initial_comment });
        return true;
      } catch (e) {
        console.log('user files.uploadV2 failed:', e.data?.error || e.message);
        return false;
      }
    }

    // Share: download from our hosted URL and upload
    let firstShared = true;
    for (const r of results || []) {
      const filename = r.filename || 'edited_image.jpg';
      const initial_comment = firstShared && caption ? caption : undefined;
      firstShared = false;
      const url = r.localUrl || r.slackUrl;
      if (!url) continue;
      try {
        const resp = await axios.get(url, { responseType: 'arraybuffer' });
        const ok = await uploadBufferAsFile(Buffer.from(resp.data), filename, initial_comment);
        if (!ok) console.log('Upload failed for', filename);
      } catch (dlErr) {
        console.log('Download failed for', url, dlErr.message);
      }
    }

    // Confirmation to user
    try {
      let text = '✅ Shared your image(s) as native Slack files.';
      if (notifyFallback && selectedChannel) text += ' (Could not access selected conversation; shared via DM instead.)';
      await client.chat.postEphemeral({ channel: destinationChannelId, user: userId, text });
    } catch (_) {}

  } catch (error) {
    console.error('Error sharing to channel from modal:', error);
    await client.chat.postMessage({ channel: userId, text: '❌ Could not share to the selected channel. Please ensure you are a member and try again.' });
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
  handleRetrySame,
  handleRetryDirect,
  handleReferenceImageModal,
  handleReferenceImageSubmission,
  handleApproveExtended,
  handleRetryExtended,
  handleOpenExtendedModal,
  handleOpenAdvancedModal,
  handleMessageShortcut,
  handleFileSelectionModal,
  handleProfileOnlyModal,
  handleUploadGuide,
  handleProfileReferenceToggle,
  handleSendToChannel,
  handleShareToChannelSubmission,
  handleOpenShareModal,
  handleGlobalShortcut
};
