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