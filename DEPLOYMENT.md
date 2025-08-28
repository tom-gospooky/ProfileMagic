# Deployment Guide

## Quick Start

1. **Setup Environment**
   ```bash
   npm run setup  # Installs dependencies and copies .env.example to .env
   ```

2. **Configure Environment Variables**
   Edit `.env` with your actual values:
   - Slack bot token, signing secret, and app token
   - Google Gemini API key for image generation
   - Set `NODE_ENV=production` for production deployment

3. **Test Locally**
   ```bash
   npm run dev  # Uses mock image editing
   ```

4. **Deploy to Production**
   ```bash
   npm start  # Uses real API
   ```

## Platform-Specific Deployment

### Heroku

1. Create Heroku app:
   ```bash
   heroku create your-app-name
   ```

2. Set environment variables:
   ```bash
   heroku config:set SLACK_BOT_TOKEN=xoxb-your-token
   heroku config:set SLACK_SIGNING_SECRET=your-secret
   heroku config:set SLACK_APP_TOKEN=xapp-your-token
   heroku config:set GEMINI_API_KEY=your-gemini-api-key
   heroku config:set BASE_URL=https://your-app-name.herokuapp.com
   heroku config:set NODE_ENV=production
   ```

3. Deploy:
   ```bash
   git push heroku main
   ```

4. Update Slack app URLs to `https://your-app-name.herokuapp.com`

### Railway

1. Connect your GitHub repository
2. Set environment variables in Railway dashboard
3. Deploy automatically on push

### DigitalOcean App Platform

1. Create app from GitHub repository
2. Set environment variables in app settings
3. Deploy automatically

## Environment Variables Reference

| Variable | Required | Description |
|----------|----------|-------------|
| `SLACK_BOT_TOKEN` | Yes | Bot User OAuth Token from Slack app |
| `SLACK_SIGNING_SECRET` | Yes | Signing Secret from Slack app |
| `SLACK_APP_TOKEN` | Yes | App-Level Token (Socket Mode) |
| `GEMINI_API_KEY` | Yes* | Google Gemini API key for image generation |
| `BASE_URL` | Yes | Public URL of your deployed app |
| `PORT` | No | Server port (default: 3000) |
| `FILE_HOST_PORT` | No | File server port (default: 3001) |
| `NODE_ENV` | No | development/production |

*Not required in development mode (uses mock editing)

## Post-Deployment

1. **Update Slack App Configuration**
   - Go to your Slack app settings
   - Update all URLs to your production domain
   - Test the `/pfpedit` command

2. **Monitor Logs**
   - Check application logs for any errors
   - Monitor API usage and rate limits

3. **Test User Flow**
   - Test with different presets
   - Test custom prompts
   - Verify image uploads work correctly

## Troubleshooting

- **Modal not appearing**: Check Socket Mode is enabled and `SLACK_APP_TOKEN` is correct
- **Permission errors**: Verify bot scopes include required permissions
- **File hosting issues**: Ensure `BASE_URL` is set correctly for your deployment
- **API errors**: Check Gemini API credentials and quota limits

## Security Notes

- Never commit `.env` file to version control
- Use environment variables for all secrets
- Keep dependencies updated for security patches
- Monitor for unusual usage patterns