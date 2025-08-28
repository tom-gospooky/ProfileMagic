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
    console.error('Error fetching profile photo:', error);
    throw error;
  }
}

async function updateProfilePhoto(client, userId, imageUrl) {
  try {
    // First, download the image
    const response = await axios({
      method: 'GET',
      url: imageUrl,
      responseType: 'stream'
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
    const userClient = new (require('@slack/web-api').WebClient)(process.env.SLACK_USER_TOKEN);
    
    const result = await userClient.users.setPhoto({
      image: imageBuffer
    });

    // Clean up temp file
    fs.unlinkSync(tempImagePath);

    return result;
  } catch (error) {
    console.error('Error updating profile photo:', error);
    
    // If user token is not available or invalid, throw a specific error
    if (error.data?.error === 'missing_scope' || error.data?.error === 'invalid_auth') {
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
      responseType: 'arraybuffer'
    });

    return Buffer.from(response.data);
  } catch (error) {
    console.error('Error downloading image:', error);
    throw error;
  }
}

module.exports = {
  getCurrentProfilePhoto,
  updateProfilePhoto,
  downloadImage
};