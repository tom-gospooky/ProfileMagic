// Common block builders to keep layouts consistent
const SUCCESS_TEXT = '✅ Edit complete!';

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
  buildErrorSection,
  buildErrorBlocks,
  buildErrorText,
  SUCCESS_TEXT
};

function titleForError(error) {
  const code = (error && error.message) || '';
  if (code === 'CONTENT_BLOCKED') return '🚫 Content Blocked';
  if (code === 'GENERATION_FAILED') return '⚠️ Generation Failed';
  return '❌ Something went wrong';
}

function messageForError(error) {
  const code = (error && error.message) || '';
  if (error && error.userMessage) return error.userMessage;
  if (code === 'CONTENT_BLOCKED') return 'Your prompt was blocked by content safety filters.';
  if (code === 'GENERATION_FAILED') return 'The AI could not complete the edit. Please try rephrasing your prompt.';
  return 'Please try again.';
}

function tipForError(error) {
  const code = (error && error.message) || '';
  if (code === 'CONTENT_BLOCKED') return '*Try different prompts or images.*';
  return '';
}

function buildErrorText(error) {
  return titleForError(error);
}

function buildErrorBlocks(error) {
  const parts = [ `*${titleForError(error)}*`, '', messageForError(error) ];
  const tip = tipForError(error);
  if (tip) parts.push('', tip);
  return [ { type: 'section', text: { type: 'mrkdwn', text: parts.join('\n') } } ];
}
