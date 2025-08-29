# OAuth Setup for ProfileMagic

ProfileMagic now requires individual user authorization to update profile photos. This is because Slack's `users.setPhoto` API method requires user tokens, not bot tokens.

## Required Environment Variables

Add these new variables to your `.env` file:

```env
SLACK_CLIENT_ID=your_slack_app_client_id
SLACK_CLIENT_SECRET=your_slack_app_client_secret
```

You can find these values in your Slack app configuration under **Basic Information**.

## Slack App Configuration

### 1. Add User Scopes

1. Go to your Slack app at https://api.slack.com/apps
2. Navigate to **OAuth & Permissions** in the sidebar
3. Scroll down to **User Token Scopes** (not Bot Token Scopes)
4. Add these scopes:
   - `users.profile:read` - To read current profile photos
   - `users.profile:write` - To update profile photos

### 2. Add Redirect URL

1. Still in **OAuth & Permissions**
2. Scroll up to **Redirect URLs**
3. Add your app's OAuth callback URL:
   ```
   https://your-app-url.com/auth/slack/callback
   ```
   Replace `your-app-url.com` with your actual Railway/deployment URL.

### 3. Reinstall the App

After adding the user scopes:
1. Click **Reinstall to Workspace** button
2. You'll see the new permission requests for user scopes
3. Authorize the app

## How It Works

### First-time User Flow

1. User runs `/boo` command
2. App checks if user is authorized (has user token)
3. If not authorized, shows authorization button
4. User clicks button → redirected to Slack OAuth
5. User authorizes → redirected back with success message
6. User can now use `/boo` command normally

### User Token Storage

- User tokens are stored in `data/user_tokens.json`
- Each user's token is stored per team (format: `teamId:userId`)
- Tokens are encrypted and only used for profile updates

### Security

- User tokens are only requested with minimal scopes needed
- Tokens are stored securely and not logged
- Each user authorizes individually (no shared tokens)

## Troubleshooting

### "Authorization Required" Error

This means the user hasn't authorized the app yet. They need to:
1. Click the authorization button
2. Complete the OAuth flow
3. Try the command again

### "Missing SLACK_CLIENT_ID" Error

You need to add the environment variables to your `.env` file.

### OAuth Callback 404 Error

Make sure you've added the correct redirect URL in your Slack app settings and that your server is running.

## Testing

To test the OAuth flow:
1. Use `/boo` command as a new user
2. You should see the authorization prompt
3. Complete the authorization
4. Try `/boo` again - should work normally

## Migration from Old Version

Existing installations will prompt users to authorize when they first use `/boo` after the update. No data migration is needed.