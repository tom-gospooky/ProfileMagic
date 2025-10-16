const axios = require('axios');

// Message Orchestrator for creating and updating a single updatable
// "Processing…" container – prefers updatable containers where possible.

// updateHandle shape:
// - { type: 'response_url', responseUrl }
// - { type: 'chat', channel, ts }

async function openDmChannel(client, userId) {
  const im = await client.conversations.open({ users: userId });
  const dmId = im?.channel?.id || userId; // fallback
  return dmId;
}

async function createProcessing({ client, channelId, userId, responseUrl = null, preferUpdatable = false, threadTs = null, text = '🎨 Processing...' }) {
  // Path 1: response_url based temporary message (ephemeral). Only when not
  // requesting an updatable container explicitly.
  if (responseUrl && !preferUpdatable) {
    try {
      const isDM = channelId?.startsWith('D');
      await axios.post(responseUrl, {
        response_type: 'ephemeral',
        text,
        replace_original: false,
        ...(threadTs && !isDM ? { thread_ts: threadTs } : {})
      });
      return { type: 'response_url', responseUrl };
    } catch (e) {
      // fall through to chat-based flow
    }
  }

  // Path 2: chat-based updatable container. Prefer a DM so we always have a ts.
  const isIm = typeof channelId === 'string' && channelId.startsWith('D');
  const destChannel = isIm ? channelId : await openDmChannel(client, userId);
  const result = await client.chat.postMessage({ channel: destChannel, text });
  const ts = result?.ts || result?.message_ts;
  return { type: 'chat', channel: result?.channel || destChannel, ts };
}

async function updateProcessing({ client, updateHandle, text, blocks = undefined, channelId = null, threadTs = null }) {
  if (!updateHandle) throw new Error('No update handle');
  if (updateHandle.type === 'response_url') {
    const isDM = channelId?.startsWith('D');
    await axios.post(updateHandle.responseUrl, {
      response_type: 'ephemeral',
      text,
      blocks,
      replace_original: true,
      ...(threadTs && !isDM ? { thread_ts: threadTs } : {})
    });
    return;
  }
  await client.chat.update({ channel: updateHandle.channel, ts: updateHandle.ts, text, blocks });
}

async function updateProcessingError(args) {
  return updateProcessing(args);
}

module.exports = {
  createProcessing,
  updateProcessing,
  updateProcessingError,
};

