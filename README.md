# ProfileMagic 🎨

A Slack bot that transforms profile pictures using AI. Users can edit their profile photos with natural language prompts like "add sunglasses", "make it cartoon style", or "add a hat".

> **⚠️ Important**: ProfileMagic now requires individual user authorization to update profile photos. See [OAUTH_SETUP.md](OAUTH_SETUP.md) for configuration details.

## Features

- **AI-Powered Editing**: Uses Google Gemini 2.5 Flash Image Preview for realistic photo transformations
- **Slack Integration**: Works seamlessly within Slack with `/boo` slash command
- **Interactive Experience**: Preview edits before applying to profile
- **Content Safety**: Built-in moderation with helpful user feedback
- **Real-time Processing**: Live image generation and display within Slack

## Available Presets

1. **New 'Do** - Upgraded hairstyle
2. **Cheese Please** - Friendlier, smiling expression  
3. **Cartoon Me** - Toon/comic transformation
4. **Teleport Me** - Background swap to fun location
5. **Specs Appeal** - Add funny glasses
6. **Spirit Animal** - Subtle animal companion overlay

## Setup Instructions

### 1. Environment Setup

```bash
# Clone or download this repository
cd ProfileMagic

# Install dependencies
npm install

# Copy environment template
cp .env.example .env
```

### 2. Configure Environment Variables

Edit `.env` file with your credentials:

```env
# Slack App Configuration
SLACK_BOT_TOKEN=xoxb-your-bot-token-here
SLACK_SIGNING_SECRET=your-signing-secret-here
SLACK_APP_TOKEN=xapp-your-app-token-here
SLACK_CLIENT_ID=your-slack-client-id
SLACK_CLIENT_SECRET=your-slack-client-secret

# Google Gemini API 
GEMINI_API_KEY=your-gemini-api-key
GEMINI_API_URL=https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent
GEMINI_MODEL=gemini-2.0-flash

# Server Configuration
PORT=3000
FILE_HOST_PORT=3001
BASE_URL=https://your-domain.com  # Or http://localhost:3001 for local dev
NODE_ENV=development
```

### 3. Slack App Setup

1. Go to [api.slack.com/apps](https://api.slack.com/apps) and create a new app
2. Use the `app-manifest.json` file to configure your app automatically:
   - Choose "From an app manifest" when creating
   - Paste the contents of `app-manifest.json`
   - Update the URLs to match your deployment domain

3. Install the app to your workspace
4. Copy the tokens to your `.env` file:
   - **Bot User OAuth Token** → `SLACK_BOT_TOKEN`
   - **User OAuth Token** → `SLACK_USER_TOKEN` ⚠️ **Required for photo updates**
   - **Signing Secret** → `SLACK_SIGNING_SECRET`
   - **App-Level Token** → `SLACK_APP_TOKEN` (enable Socket Mode first)

   ⚠️ **Important**: The `users.setPhoto` API requires a **user token**, not a bot token. This means:
   - Users must authorize the app with their personal account
   - The app can only update photos for users who have personally authorized it
   - This is a Slack API limitation, not an app limitation

5. Test the `/boo` command in Slack!

### 4. Google Gemini API Setup

1. Visit [Google AI Studio](https://aistudio.google.com/) or the [Gemini API console](https://ai.google.dev/)
2. Create an API key for the **Gemini 2.0 Flash** model (supports image generation and editing)
3. Add the API key to your `.env` file:
   ```env
   GEMINI_API_KEY=your-gemini-api-key
   ```
   The URL and model are pre-configured in the code.

### 5. Run the Application

```bash
# Development mode (uses mock image editing)
npm run dev

# Production mode (uses real API)
npm start
```

## Usage

1. Run `/boo your prompt` - e.g., `/boo add sunglasses`
2. Or run `/boo` alone to see preset options
3. Preview your edited image
4. Click "Set as Profile Picture" to update your Slack photo

## Technical Architecture

- **Framework**: Node.js with Slack Bolt SDK
- **Image Processing**: Google Gemini API (Gemini 2.5 Flash Image Preview model)
- **File Hosting**: Local static file server (temp files)
- **Storage**: No persistent storage (images discarded after use)

## Project Structure

```
src/
├── app.js                 # Main application entry point
├── handlers/
│   ├── slashCommand.js    # /pfpedit command handler
│   └── interactive.js     # Modal and button interactions
├── services/
│   ├── slack.js          # Slack API interactions
│   ├── image.js          # Image editing API calls
│   └── fileHost.js       # Temporary file hosting
└── utils/
    └── presets.js        # Preset definitions
```

## Security & Privacy

- **No Data Persistence**: Images are temporarily stored only for preview
- **Auto Cleanup**: Old temporary files are removed every 15 minutes
- **Workspace Access**: Available to all workspace members
- **No Usage Logging**: Minimal error logging only

## Deployment

### Local Development
```bash
npm run dev
```

### Production Deployment
1. Deploy to your preferred hosting platform (Heroku, AWS, etc.)
2. Set environment variables
3. Update Slack app URLs to your production domain
4. Run `npm start`

### Using ngrok for Development
```bash
# Install ngrok and expose local server
ngrok http 3000

# Update Slack app URLs with the ngrok URL
# Restart the app
npm run dev
```

## Troubleshooting

### Common Issues

1. **"Could not fetch profile photo"**
   - User needs to have a profile photo set in Slack
   - Check bot permissions include `users.profile:read`

2. **"Failed to update profile photo"**  
   - Check bot permissions include `users.profile:write`
   - Ensure image file is valid and under size limits

3. **Modal not appearing**
   - Verify `SLACK_SIGNING_SECRET` is correct
   - Check that Socket Mode is enabled with valid `SLACK_APP_TOKEN`

4. **Image editing fails**
   - In development mode, mock editing is used automatically
   - For production, verify `GEMINI_API_KEY` is valid
   - Check you have access to Gemini 2.0 Flash model with image capabilities

### Debug Mode

Set `NODE_ENV=development` to use mock image editing and see detailed logs.

## Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Test with a Slack workspace
5. Submit a pull request

## License

MIT License - see LICENSE file for details