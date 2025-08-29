require('dotenv').config();
const { App, SocketModeReceiver } = require('@slack/bolt');
const slashCommandHandler = require('./handlers/slashCommand');
const interactiveHandler = require('./handlers/interactive');
const fileServer = require('./services/fileServer');

// Validate required environment variables
const requiredEnvVars = [
  'SLACK_BOT_TOKEN',
  'SLACK_SIGNING_SECRET', 
  'SLACK_APP_TOKEN',
  'GEMINI_API_KEY'
];

for (const envVar of requiredEnvVars) {
  if (!process.env[envVar]) {
    console.error(`❌ Missing required environment variable: ${envVar}`);
    process.exit(1);
  }
}

const isProduction = process.env.NODE_ENV === 'production';
if (!isProduction) console.log('✅ All required environment variables are set');

// Create a Socket Mode receiver that doesn't start an HTTP server
const receiver = new SocketModeReceiver({
  appToken: process.env.SLACK_APP_TOKEN,
});

const app = new App({
  token: process.env.SLACK_BOT_TOKEN,
  signingSecret: process.env.SLACK_SIGNING_SECRET,
  receiver
});

// Slash command handler
app.command('/boo', slashCommandHandler);

// Interactive component handlers
app.view('preset_selection_modal', interactiveHandler.handlePresetSelection);
app.view('preview_modal', interactiveHandler.handlePreviewAction);
app.action('select_preset', interactiveHandler.handlePresetSelect);
app.action('approve_edit', interactiveHandler.handleApprove);
app.action('retry_edit', interactiveHandler.handleRetry);
app.action('cancel_edit', interactiveHandler.handleCancel);
app.action('approve_edit_message', interactiveHandler.handleApproveMessage);
app.action('retry_edit_message', interactiveHandler.handleRetryMessage);

// File upload event handler for image reference feature
app.event('file_shared', async ({ event, client, context }) => {
  try {
    // Get file info to check if it's an image
    const fileInfo = await client.files.info({
      file: event.file_id
    });
    
    const file = fileInfo.file;
    
    // Check if it's an image file
    if (file.mimetype && file.mimetype.startsWith('image/')) {
      // Store recent image uploads for potential use with /boo commands
      // Using a simple in-memory cache with user ID and timestamp
      const recentImages = global.recentImages || (global.recentImages = new Map());
      const userId = event.user_id;
      const imageData = {
        fileId: file.id,
        url: file.url_private,
        timestamp: Date.now(),
        filename: file.name,
        mimetype: file.mimetype
      };
      
      recentImages.set(userId, imageData);
      
      // Clean up old entries (older than 10 minutes)
      const tenMinutesAgo = Date.now() - (10 * 60 * 1000);
      for (const [key, value] of recentImages.entries()) {
        if (value.timestamp < tenMinutesAgo) {
          recentImages.delete(key);
        }
      }
      
      // Send helpful message about using the image with /boo
      await client.chat.postEphemeral({
        channel: event.channel_id,
        user: userId,
        text: `📎 *Image detected!* I can use this image as a reference.\n\nTry: \`/boo add this hat\` to apply the style from your uploaded image to your profile photo! ✨`,
        blocks: [
          {
            type: 'section',
            text: {
              type: 'mrkdwn',
              text: `📎 *Image detected!* I can use this image as a reference.\n\nTry: \`/boo add this hat\` to apply the style from your uploaded image to your profile photo! ✨`
            }
          }
        ]
      });
    }
  } catch (error) {
    console.error('Error handling file_shared event:', error.message);
  }
});

// Error handler
app.error((error) => {
  console.error('App error:', error);
});

(async () => {
  try {
    console.log('🚀 Starting ProfileMagic...');
    if (!isProduction) {
      console.log(`🌍 Environment: ${process.env.NODE_ENV}`);
      console.log(`🔌 Railway PORT: ${process.env.PORT}`);
      console.log(`📡 BASE_URL: ${process.env.BASE_URL}`);
    }
    
    // Start Railway-compatible file server FIRST (critical for health checks)
    console.log('📁 Starting Railway-compatible file server...');
    console.log(`🔧 PORT from env: ${process.env.PORT}`);
    try {
      const filePort = await fileServer.startFileServer();
      console.log(`✅ File server running on port ${filePort}`);
      console.log(`🔗 Health check: ${process.env.BASE_URL || `http://localhost:${filePort}`}/health`);
      
    } catch (fileServerError) {
      console.error('❌ File server failed to start:', fileServerError.message);
      console.error('Full error:', fileServerError);
      throw fileServerError;
    }
    
    // Start Slack app in Socket Mode (no HTTP port needed)
    console.log('⚡ Starting Slack app...');
    await app.start();
    console.log('⚡️ ProfileMagic is running!');
    
  } catch (error) {
    console.error('❌ Failed to start app:', error.message);
    console.error('Full error:', error);
    process.exit(1);
  }
})();