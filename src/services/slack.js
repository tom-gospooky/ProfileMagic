const fs = require('fs');
const path = require('path');
const axios = require('axios');
const { WebClient } = require('@slack/web-api');
const userTokens = require('./userTokens');

async function getCurrentProfilePhoto(client, userId) {
  try {
    const result = await client.users.profile.get({
      user: userId
    });

    console.log('Profile API response:', {
      hasProfile: !!result.profile,
      image512: result.profile?.image_512,
      image192: result.profile?.image_192,
      image72: result.profile?.image_72
    });

    const profileImage = result.profile.image_512 || result.profile.image_192 || result.profile.image_72;

    if (!profileImage) {
      throw new Error('No profile image found');
    }

    console.log('Selected profile image URL:', profileImage);

    // Validate URL
    try {
      new URL(profileImage);
    } catch (urlError) {
      console.error('Invalid profile image URL:', profileImage);
      throw new Error(`Invalid profile image URL: ${profileImage}`);
    }

    return profileImage;
  } catch (error) {
    console.error('Profile photo fetch error:', error.message);
    throw error;
  }
}

async function updateProfilePhoto(botClient, userId, teamId, imageUrl) {
  try {
    // Get the user's individual token
    const userToken = userTokens.getUserToken(userId, teamId);
    
    if (!userToken) {
      throw new Error('USER_NOT_AUTHORIZED');
    }
    
    // Create a user client with their personal token
    const userClient = new WebClient(userToken);
    
    // First, download the image with timeout and retry logic
    const response = await axios({
      method: 'GET',
      url: imageUrl,
      responseType: 'stream',
      timeout: 30000, // 30 second timeout
      headers: {
        'User-Agent': 'Boo/1.0'
      },
      maxRedirects: 5
    });

    // Create temp directory if it doesn't exist
    const tempDir = path.join(__dirname, '../../temp');
    if (!fs.existsSync(tempDir)) {
      fs.mkdirSync(tempDir, { recursive: true });
    }

    // Save image temporarily
    const tempImagePath = path.join(tempDir, `profile_${userId}_${Date.now()}.jpg`);
    const writer = fs.createWriteStream(tempImagePath);
    
    response.data.pipe(writer);

    await new Promise((resolve, reject) => {
      writer.on('finish', resolve);
      writer.on('error', reject);
    });

    // Upload to Slack using user's personal token
    const imageBuffer = fs.readFileSync(tempImagePath);
    
    // Use the user client (not bot client) - this will update the user's own profile
    const result = await userClient.users.setPhoto({
      image: imageBuffer
    });

    // Clean up temp file
    fs.unlinkSync(tempImagePath);

    return result;
  } catch (error) {
    console.error('Profile photo update error:', error.message);
    try { const { logSlackError } = require('../utils/logging'); logSlackError('users.setPhoto', error); } catch(_) {}
    
    // Handle the case where user needs to authorize
    if (error.message === 'USER_NOT_AUTHORIZED') {
      throw error;
    }
    
    // Already logged a sanitized payload above
    
    // Handle specific Slack API errors
    if (error.data?.error === 'missing_scope') {
      throw new Error('Missing permissions. Please re-authorize the app.');
    } else if (error.data?.error === 'invalid_auth') {
      throw new Error('Invalid user token. Please re-authorize the app.');
    } else if (error.data?.error === 'not_authed') {
      throw new Error('User authorization required. Please authorize the app.');
    }
    
    throw error;
  }
}

// Download image with optional mime type return
async function downloadImageWithMime(imageUrl) {
  try {
    const headers = { 'User-Agent': 'Boo/1.0' };
    try {
      const u = new URL(imageUrl);
      if (u.hostname.includes('slack.com')) {
        if (process.env.SLACK_BOT_TOKEN) {
          headers['Authorization'] = `Bearer ${process.env.SLACK_BOT_TOKEN}`;
        }
      }
    } catch (_) {}

    const response = await axios({
      method: 'GET',
      url: imageUrl,
      responseType: 'arraybuffer',
      timeout: 30000,
      headers,
      maxRedirects: 5,
      validateStatus: (status) => status >= 200 && status < 300
    });

    if (!response.data) {
      throw new Error('No image data received');
    }

    const buffer = Buffer.from(response.data);
    const mimeType = (response.headers && response.headers['content-type']) || null;
    return { buffer, mimeType };
  } catch (error) {
    console.error('Image download error:', error.message);
    if (error.response) {
      console.error('Status:', error.response.status, 'URL:', imageUrl);
    }
    throw error;
  }
}

// Legacy wrapper for backward compatibility - returns buffer only
async function downloadImage(imageUrl) {
  const { buffer } = await downloadImageWithMime(imageUrl);
  return buffer;
}

module.exports = {
  getCurrentProfilePhoto,
  updateProfilePhoto,
  downloadImage
  ,downloadImageWithMime
};
