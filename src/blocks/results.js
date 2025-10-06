// Shared helpers to build result blocks and standardized actions

function coerceFilenameExt(name, defExt = 'jpg') {
  if (!name || typeof name !== 'string') return `Edited Image.${defExt}`;
  const trimmed = name.trim();
  if (/\.(jpg|jpeg|png|gif|webp)$/i.test(trimmed)) return trimmed;
  return `${trimmed}.${defExt}`;
}

function toSimpleResults(results) {
  // Normalize to { localUrl?, filename, fileId?, slackUrl?, permalink? }
  return (results || [])
    .map(r => {
      if (!r) return null;
      const rr = r.result || r;
      const filenameRaw = r.originalFile?.name || rr?.filename || 'Edited Image';
      const filename = coerceFilenameExt(filenameRaw);
      // Prefer Slack file info when present
      const slackFile = rr?.slackFile || r?.slackFile;
      const slackUrl = slackFile?.url_private_download || slackFile?.url_private || r?.slackUrl;
      const fileId = rr?.fileId || r?.fileId || slackFile?.id;
      const localUrl = rr?.localUrl || r?.localUrl || null; // may be absent in Slack-files-first
      const permalink = slackFile?.permalink_public || slackFile?.permalink || r?.permalink;
      return { localUrl, filename, fileId, slackUrl, permalink };
    })
    .filter(Boolean);
}

function buildImageBlocksFromResults(results) {
  const simple = toSimpleResults(results);
  const blocks = [];
  for (const item of simple) {
    if (!item.localUrl) continue;
    blocks.push({
      type: 'image',
      title: { type: 'plain_text', text: '✨ Edited' },
      image_url: item.localUrl,
      alt_text: 'AI-transformed image'
    });
  }
  return blocks;
}

function buildStandardActions({ results, prompt, channelId, approveActionId = 'approve_edit_message', retryActionId = 'retry_same', retryPayload = {}, advancedPromptValue = null }) {
  const simple = toSimpleResults(results);
  const actions = [];

  // Update Profile Picture — only when exactly one result exists
  if (simple.length === 1) {
    const one = simple[0];
    actions.push({
      type: 'button',
      text: { type: 'plain_text', text: '✅ Update Profile Picture' },
      style: 'primary',
      action_id: approveActionId,
      value: JSON.stringify({
        // Back-compat: include editedImage when available
        editedImage: one.localUrl || null,
        // Slack-files-first:
        slackFileId: one.fileId || null,
        slackUrl: one.slackUrl || null,
        prompt
      })
    });
  }

  // Share… (open modal with channel selector)
  actions.push({
    type: 'button',
    text: { type: 'plain_text', text: '🔥 Share…' },
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
