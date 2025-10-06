// Common block builders to keep layouts consistent

function buildSuccessHeader(prompt, metaLines = []) {
  const lines = [];
  lines.push('✅ *Edit complete!*');
  if (prompt && String(prompt).trim().length) {
    lines.push(`*Prompt:* "${prompt}"`);
  }
  if (Array.isArray(metaLines) && metaLines.length) {
    for (const l of metaLines) {
      if (l && String(l).trim().length) lines.push(l);
    }
  }
  return {
    type: 'section',
    text: { type: 'mrkdwn', text: lines.join('\n') }
  };
}

function buildErrorSection(message) {
  return {
    type: 'section',
    text: { type: 'mrkdwn', text: message }
  };
}

module.exports = {
  buildSuccessHeader,
  buildErrorSection
};

