require('dotenv').config();
const { App, SocketModeReceiver } = require('@slack/bolt');
const slashCommandHandler = require('./handlers/slashCommand');
const interactiveHandler = require('./handlers/interactive');
const extendedCommandHandler = require('./handlers/extendedCommand');
const fileServer = require('./services/fileServer');

// Validate required environment variables
const requiredEnvVars = [
  'SLACK_BOT_TOKEN',
  'SLACK_SIGNING_SECRET', 
  'SLACK_APP_TOKEN',
  'SLACK_CLIENT_ID',
  'SLACK_CLIENT_SECRET',
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

// Slash command handlers
app.command('/boo', slashCommandHandler);
app.command('/boo-ext', extendedCommandHandler.handleExtendedSlashCommand);

// Interactive component handlers
app.view('preset_selection_modal', interactiveHandler.handlePresetSelection);
app.view('preview_modal', interactiveHandler.handlePreviewAction);
app.view('reference_image_modal', interactiveHandler.handleReferenceImageSubmission);
app.view('boo_ext_modal', extendedCommandHandler.handleExtendedModalSubmission);
app.view('file_selection_modal', interactiveHandler.handleFileSelectionModal);
app.view('profile_only_modal', interactiveHandler.handleProfileOnlyModal);
app.view('share_to_channel_modal', interactiveHandler.handleShareToChannelSubmission);
app.action('select_preset', interactiveHandler.handlePresetSelect);
app.action('approve_edit', interactiveHandler.handleApprove);
app.action('retry_edit', interactiveHandler.handleRetry);
app.action('cancel_edit', interactiveHandler.handleCancel);
app.action('approve_edit_message', interactiveHandler.handleApproveMessage);
app.action('retry_edit_message', interactiveHandler.handleRetryMessage);
app.action('use_reference_image', interactiveHandler.handleReferenceImageModal);
app.action('approve_ext_edit', interactiveHandler.handleApproveExtended);
app.action('retry_ext_edit', interactiveHandler.handleRetryExtended);
app.action('open_extended_modal', interactiveHandler.handleOpenExtendedModal);
app.action('show_upload_guide', interactiveHandler.handleUploadGuide);
app.action('use_profile_reference', interactiveHandler.handleProfileReferenceToggle);
app.action('send_to_channel', interactiveHandler.handleSendToChannel);
app.action('open_share_modal', interactiveHandler.handleOpenShareModal);
app.action('open_advanced_modal', interactiveHandler.handleOpenAdvancedModal);
app.action('retry_same', interactiveHandler.handleRetrySame);
app.action('retry_direct', interactiveHandler.handleRetryDirect);

// Message shortcut handlers
app.shortcut('banana', interactiveHandler.handleMessageShortcut);
app.shortcut('banana_global', interactiveHandler.handleGlobalShortcut);

// Remove intrusive file_shared event handler - using modal approach instead

// Error handler
app.error((error) => {
  const msg = String(error?.message || error || '');
  if (/Unhandled event 'server explicit disconnect'/.test(msg)) {
    // Transient Socket Mode disconnect; log as warn to reduce error noise
    return console.warn('SocketMode transient disconnect:', msg);
  }
  console.error('App error:', error);
});

(async () => {
  try {
console.log('🚀 Starting Boo...');
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
console.log('⚡️ Boo is running!');
    
  } catch (error) {
    console.error('❌ Failed to start app:', error.message);
    console.error('Full error:', error);
    process.exit(1);
  }
})();
