function validatePrompt(prompt) {
  if (!prompt || typeof prompt !== 'string') {
    return { valid: false, error: 'Prompt must be a non-empty string' };
  }

  const trimmedPrompt = prompt.trim();
  
  if (trimmedPrompt.length === 0) {
    return { valid: false, error: 'Prompt cannot be empty' };
  }

  if (trimmedPrompt.length > 500) {
    return { valid: false, error: 'Prompt must be 500 characters or less' };
  }

  // Check for potentially harmful content
  const forbiddenPatterns = [
    /\b(nude|naked|nsfw|sexual|explicit)\b/i,
    /\b(violence|violent|kill|death|blood)\b/i,
    /\b(hate|racist|offensive|inappropriate)\b/i
  ];

  for (const pattern of forbiddenPatterns) {
    if (pattern.test(trimmedPrompt)) {
      return { valid: false, error: 'Prompt contains inappropriate content' };
    }
  }

  return { valid: true, prompt: trimmedPrompt };
}

function validateImageUrl(url) {
  if (!url || typeof url !== 'string') {
    return { valid: false, error: 'Image URL must be a valid string' };
  }

  try {
    const urlObj = new URL(url);
    
    // Check if it's HTTP/HTTPS
    if (!['http:', 'https:'].includes(urlObj.protocol)) {
      return { valid: false, error: 'Image URL must use HTTP or HTTPS protocol' };
    }

    return { valid: true, url };
  } catch (error) {
    return { valid: false, error: 'Invalid image URL format' };
  }
}

function validateSlackUserId(userId) {
  if (!userId || typeof userId !== 'string') {
    return { valid: false, error: 'User ID must be a valid string' };
  }

  // Slack user IDs typically start with 'U' and are 9-11 characters
  const slackUserIdPattern = /^U[A-Z0-9]{8,10}$/;
  
  if (!slackUserIdPattern.test(userId)) {
    return { valid: false, error: 'Invalid Slack user ID format' };
  }

  return { valid: true, userId };
}

module.exports = {
  validatePrompt,
  validateImageUrl,
  validateSlackUserId
};