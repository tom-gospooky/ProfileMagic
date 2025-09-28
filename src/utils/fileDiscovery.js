/**
 * Utilities for discovering recent image files from Slack conversations
 */

async function getRecentImages(client, teamId, userId, channelId, limit = 10, prioritizeRecent = true) {
  const images = [];
  const isProduction = process.env.NODE_ENV === 'production';

  try {
    if (!isProduction) console.log(`Getting recent images for user ${userId} in channel ${channelId}`);

    // Try to get files using files.list API first (more reliable)
    try {
      const filesList = await client.files.list({
        user: userId,
        types: 'images',
        count: Math.min(limit * 2, 100), // Get more to filter later
      });

      if (filesList.files && filesList.files.length > 0) {
        if (!isProduction) console.log(`Found ${filesList.files.length} files from files.list`);

        for (const file of filesList.files) {
          if (file.mimetype && file.mimetype.startsWith('image/')) {
            images.push({
              id: file.id,
              name: file.name || `image_${file.id}`,
              title: file.title || file.name || `Image ${images.length + 1}`,
              mimetype: file.mimetype,
              url_private: file.url_private,
              url_private_download: file.url_private_download,
              thumb_360: file.thumb_360,
              permalink: file.permalink,
              timestamp: file.timestamp,
              channel_id: channelId,
              channel_name: 'Your Files'
            });
          }
        }
      }
    } catch (filesError) {
      if (!isProduction) console.log('files.list failed, trying conversations approach:', filesError.message);
    }

    // If prioritizing recent (like for slash commands), check current channel first
    if (prioritizeRecent && channelId) {
      try {
        const recentHistory = await client.conversations.history({
          channel: channelId,
          limit: 10 // Check last 10 messages for very recent uploads
        });

        for (const message of recentHistory.messages || []) {
          if (message.files) {
            for (const file of message.files) {
              if (file.mimetype && file.mimetype.startsWith('image/')) {
                // Check if we already have this file
                if (images.some(img => img.id === file.id)) continue;

                images.unshift({ // Add to beginning for priority
                  id: file.id,
                  name: file.name || `recent_image_${file.id}`,
                  title: file.title || file.name || 'Recently uploaded image',
                  mimetype: file.mimetype,
                  url_private: file.url_private,
                  url_private_download: file.url_private_download,
                  thumb_360: file.thumb_360,
                  permalink: file.permalink,
                  timestamp: message.ts,
                  channel_id: channelId,
                  channel_name: 'This Channel (Recent)',
                  isRecent: true
                });
              }
            }
          }
        }
      } catch (channelError) {
        if (!isProduction) console.log('Recent channel check failed:', channelError.message);
      }
    }

    // If we still don't have enough images, try conversations approach
    if (images.length < 5) {
      try {
        // Get conversations list for the user (channels they're in + DMs)
        const conversationsList = await client.users.conversations({
          user: userId,
          types: 'public_channel,private_channel,mpim,im',
          limit: 20
        });

        const conversationsToCheck = [
          channelId, // Current channel first
          userId,    // DM with bot second
          ...conversationsList.channels
            .filter(c => c.id !== channelId && c.id !== userId)
            .slice(0, 5) // Limit to 5 additional channels
            .map(c => c.id)
        ];

        if (!isProduction) console.log(`Checking ${conversationsToCheck.length} conversations`);

        // Check each conversation for recent image files
        for (const convId of conversationsToCheck) {
          if (images.length >= limit) break;

          try {
            // Get recent messages with files
            const history = await client.conversations.history({
              channel: convId,
              limit: 50
            });

            // Extract image files from messages
            for (const message of history.messages || []) {
              if (message.files) {
                for (const file of message.files) {
                  if (file.mimetype && file.mimetype.startsWith('image/')) {
                    // Skip if we already have enough images
                    if (images.length >= limit) break;

                    // Check if we already have this file (by ID)
                    if (images.some(img => img.id === file.id)) continue;

                    images.push({
                      id: file.id,
                      name: file.name || `image_${file.id}`,
                      title: file.title || file.name || `Image from ${getChannelDisplayName(conversationsList.channels, convId, userId)}`,
                      mimetype: file.mimetype,
                      url_private: file.url_private,
                      url_private_download: file.url_private_download,
                      thumb_360: file.thumb_360,
                      permalink: file.permalink,
                      timestamp: message.ts,
                      channel_id: convId,
                      channel_name: getChannelDisplayName(conversationsList.channels, convId, userId)
                    });
                  }
                }
              }
            }
          } catch (convError) {
            if (!isProduction) console.log(`Failed to get history for conversation ${convId}:`, convError.message);
            // Continue with other conversations
          }
        }
      } catch (conversationsError) {
        if (!isProduction) console.log('conversations approach failed:', conversationsError.message);
      }
    }

    // Sort by timestamp (most recent first)
    images.sort((a, b) => parseFloat(b.timestamp || 0) - parseFloat(a.timestamp || 0));

    const finalImages = images.slice(0, limit);
    if (!isProduction) console.log(`Returning ${finalImages.length} images`);

    return finalImages;

  } catch (error) {
    console.error('Error getting recent images:', error);
    return [];
  }
}

function getChannelDisplayName(channels, channelId, userId) {
  if (channelId === userId) {
    return 'Direct message with ProfileMagic';
  }

  const channel = channels.find(c => c.id === channelId);
  if (!channel) return 'Unknown channel';

  if (channel.is_im) return 'Direct message';
  if (channel.is_mpim) return channel.name || 'Group message';
  return `#${channel.name}`;
}

async function getUserProfilePhoto(client, userId) {
  try {
    const userInfo = await client.users.info({ user: userId });
    const profilePhoto = userInfo.user?.profile?.image_512 ||
                        userInfo.user?.profile?.image_192 ||
                        userInfo.user?.profile?.image_72;

    return profilePhoto ? {
      id: `profile_${userId}`,
      name: 'Current Profile Photo',
      title: 'Your current profile photo',
      mimetype: 'image/jpeg',
      url_private: profilePhoto,
      url_private_download: profilePhoto,
      thumb_360: userInfo.user?.profile?.image_192 || profilePhoto,
      isProfilePhoto: true,
      channel_name: 'Your Profile'
    } : null;
  } catch (error) {
    console.error('Error getting user profile photo:', error);
    return null;
  }
}

module.exports = {
  getRecentImages,
  getUserProfilePhoto
};