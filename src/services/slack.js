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
        'User-Agent': 'ProfileMagic/1.0'
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

async function downloadImage(imageUrl) {
  try {
    const headers = { 'User-Agent': 'ProfileMagic/1.0' };
    // If this is a Slack private file URL, include bot auth
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
      timeout: 30000, // 30 second timeout
      headers,
      maxRedirects: 5,
      validateStatus: function (status) {
        return status >= 200 && status < 300; // Accept only success status codes
      }
    });

    if (!response.data) {
      throw new Error('No image data received');
    }

    return Buffer.from(response.data);
  } catch (error) {
    console.error('Image download error:', error.message);
    if (error.response) {
      console.error('Status:', error.response.status, 'URL:', imageUrl);
    }
    throw error;
  }
}

// Variant that returns both buffer and mimeType
async function downloadImageWithMime(imageUrl) {
  try {
    const headers = { 'User-Agent': 'ProfileMagic/1.0' };
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

    const buffer = Buffer.from(response.data);
    const mimeType = (response.headers && response.headers['content-type']) || null;
    return { buffer, mimeType };
  } catch (error) {
    console.error('Image download (with mime) error:', error.message);
    if (error.response) {
      console.error('Status:', error.response.status, 'URL:', imageUrl);
    }
    throw error;
  }
}

module.exports = {
  getCurrentProfilePhoto,
  updateProfilePhoto,
  downloadImage
  ,downloadImageWithMime
};
