require('dotenv').config();
const { App } = require('@slack/bolt');
const slashCommandHandler = require('./handlers/slashCommand');
const interactiveHandler = require('./handlers/interactive');
const fileHost = require('./services/fileHost');

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

const app = new App({
  token: process.env.SLACK_BOT_TOKEN,
  signingSecret: process.env.SLACK_SIGNING_SECRET,
  socketMode: true,
  appToken: process.env.SLACK_APP_TOKEN,
  // Socket mode uses WebSocket, no HTTP server needed
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
    
    // Start file hosting server
    if (!isProduction) console.log('📁 Starting file hosting server...');
    const filePort = await fileHost.startFileServer();
    if (!isProduction) console.log(`✅ File server running on port ${filePort}`);
    
    // Start Slack app in Socket Mode (no port needed)
    if (!isProduction) console.log('⚡ Starting Slack app...');
    await app.start();
    console.log('⚡️ ProfileMagic is running!');
    if (!isProduction) console.log(`🔗 Health check: ${process.env.BASE_URL || `http://localhost:${filePort}`}/health`);
    
  } catch (error) {
    console.error('❌ Failed to start app:', error.message);
    console.error('Full error:', error);
    process.exit(1);
  }
})();