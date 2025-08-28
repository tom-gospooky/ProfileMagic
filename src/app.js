require('dotenv').config();
const { App } = require('@slack/bolt');
const slashCommandHandler = require('./handlers/slashCommand');
const interactiveHandler = require('./handlers/interactive');
const fileHost = require('./services/fileHost');

const app = new App({
  token: process.env.SLACK_BOT_TOKEN,
  signingSecret: process.env.SLACK_SIGNING_SECRET,
  socketMode: true,
  appToken: process.env.SLACK_APP_TOKEN,
  port: process.env.PORT || 3000
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
    // Start file hosting server
    await fileHost.startFileServer();
    
    // Start Slack app
    await app.start();
    console.log('⚡️ Profile Magic Slack app is running!');
  } catch (error) {
    console.error('Failed to start app:', error);
    process.exit(1);
  }
})();