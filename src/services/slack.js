const fs = require('fs');
const path = require('path');
const axios = require('axios');

async function getCurrentProfilePhoto(client, userId) {
  try {
    const result = await client.users.profile.get({
      user: userId
    });

    const profileImage = result.profile.image_512 || result.profile.image_192 || result.profile.image_72;
    
    if (!profileImage) {
      throw new Error('No profile image found');
    }

    return profileImage;
  } catch (error) {
    console.error('Profile photo fetch error:', error.message);
    throw error;
  }
}

async function updateProfilePhoto(client, userId, imageUrl) {
  try {
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

    // Upload to Slack using user token (required for setPhoto)
    // Note: This requires the user to have authorized the app with user scopes
    const imageBuffer = fs.readFileSync(tempImagePath);
    
    // Use user token for setPhoto API call
    if (!process.env.SLACK_USER_TOKEN) {
      throw new Error('User authorization required. Please reinstall the app to enable profile photo updates.');
    }
    
    const userClient = new (require('@slack/web-api').WebClient)(process.env.SLACK_USER_TOKEN);
    
    const result = await userClient.users.setPhoto({
      image: imageBuffer
    });

    // Clean up temp file
    fs.unlinkSync(tempImagePath);

    return result;
  } catch (error) {
    console.error('Profile photo update error:', error.message);
    if (error.data) {
      console.error('Slack API error data:', error.data);
    }
    
    // Handle specific Slack API errors
    if (error.data?.error === 'missing_scope') {
      throw new Error('Missing permissions. The user token needs users.profile:write scope.');
    } else if (error.data?.error === 'invalid_auth') {
      throw new Error('Invalid user token. Please reinstall the app to re-authorize.');
    } else if (error.data?.error === 'not_authed') {
      throw new Error('User authorization required. Please reinstall the app and authorize with your personal account.');
    }
    
    throw error;
  }
}

async function downloadImage(imageUrl) {
  try {
    const response = await axios({
      method: 'GET',
      url: imageUrl,
      responseType: 'arraybuffer',
      timeout: 30000, // 30 second timeout
      headers: {
        'User-Agent': 'ProfileMagic/1.0'
      },
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

module.exports = {
  getCurrentProfilePhoto,
  updateProfilePhoto,
  downloadImage
};