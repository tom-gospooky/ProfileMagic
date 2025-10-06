// Shared helpers for Share modal and share message blocks

function buildShareModalView({ results, prompt, channelId, userId }) {
  const view = {
    type: 'modal',
    callback_id: 'share_to_channel_modal',
    title: { type: 'plain_text', text: 'Share to Channel' },
    submit: { type: 'plain_text', text: 'Share' },
    close: { type: 'plain_text', text: 'Cancel' },
    private_metadata: JSON.stringify({ results, prompt, defaultChannel: channelId, userId }),
    blocks: [
      {
        type: 'input',
        block_id: 'channel_select',
        element: {
          type: 'conversations_select',
          action_id: 'selected_channel',
          placeholder: { type: 'plain_text', text: 'Select a channel or DM' },
          initial_conversation: channelId,
          filter: { include: ['public', 'private', 'im', 'mpim'] }
        },
        label: { type: 'plain_text', text: 'Destination' }
      },
      {
        type: 'input',
        block_id: 'caption_input',
        optional: true,
        element: {
          type: 'plain_text_input',
          action_id: 'share_caption',
          placeholder: { type: 'plain_text', text: 'Add a message (optional)' }
        },
        label: { type: 'plain_text', text: 'Caption (optional)' }
      }
    ]
  };

  // Half-size preview via accessory image
  if (results && results[0]?.localUrl) {
    view.blocks.push({
      type: 'section',
      text: { type: 'mrkdwn', text: '*Preview*' },
      accessory: { type: 'image', image_url: results[0].localUrl, alt_text: 'Preview' }
    });
  }
  view.blocks.push({ type: 'context', elements: [{ type: 'mrkdwn', text: 'Images will be attached to your message.' }] });
  return view;
}

function buildShareMessageBlocks({ results, caption }) {
  const blocks = [];
  if (caption && caption.length) {
    blocks.push({ type: 'section', text: { type: 'mrkdwn', text: caption } });
  }
  for (const result of results || []) {
    if (!result?.localUrl) continue;
    blocks.push({
      type: 'image',
      title: { type: 'plain_text', text: `✨ ${result.filename || 'Edited Image'}` },
      image_url: result.localUrl,
      alt_text: `AI-transformed ${result.filename || 'Edited Image'}`
    });
  }
  return blocks;
}

module.exports = {
  buildShareModalView,
  buildShareMessageBlocks
};

