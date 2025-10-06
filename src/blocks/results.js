// Shared helpers to build result blocks and standardized actions

function toSimpleResults(results) {
  // Normalize various shapes to { localUrl, filename, fileId }
  return (results || []).map(r => {
    if (!r) return null;
    if (r.localUrl) return r; // already simple
    const rr = r.result || r;
    const name = r.originalFile?.name || rr?.filename || 'Edited Image';
    return { localUrl: rr?.localUrl, fileId: rr?.fileId, filename: name };
  }).filter(Boolean);
}

function buildImageBlocksFromResults(results) {
  const simple = toSimpleResults(results);
  const blocks = [];
  for (const item of simple) {
    if (!item.localUrl) continue;
    blocks.push({
      type: 'image',
      title: { type: 'plain_text', text: `✨ ${item.filename}` },
      image_url: item.localUrl,
      alt_text: `AI-transformed ${item.filename}`
    });
  }
  return blocks;
}

function buildStandardActions({ results, prompt, channelId, approveActionId = 'approve_edit_message', retryActionId = 'retry_same', retryPayload = {}, advancedPromptValue = null }) {
  const simple = toSimpleResults(results);
  const actions = [];

  // Update Profile Picture — only when exactly one result exists
  if (simple.length === 1 && simple[0].localUrl) {
    actions.push({
      type: 'button',
      text: { type: 'plain_text', text: '✅ Update Profile Picture' },
      style: 'primary',
      action_id: approveActionId,
      value: JSON.stringify({ editedImage: simple[0].localUrl, prompt })
    });
  }

  // Share… (open modal with channel selector)
  actions.push({
    type: 'button',
    text: { type: 'plain_text', text: '📤 Share…' },
    action_id: 'open_share_modal',
    value: JSON.stringify({ results: simple, prompt, channelId })
  });

  // Advanced
  actions.push({
    type: 'button',
    text: { type: 'plain_text', text: '⚙️ Advanced' },
    action_id: 'open_advanced_modal',
    value: JSON.stringify({ prompt: advancedPromptValue ?? prompt })
  });

  // Retry (exact same settings)
  actions.push({
    type: 'button',
    text: { type: 'plain_text', text: '🔄 Retry' },
    action_id: retryActionId,
    value: JSON.stringify(retryPayload)
  });

  return actions;
}

module.exports = {
  buildImageBlocksFromResults,
  buildStandardActions
};

