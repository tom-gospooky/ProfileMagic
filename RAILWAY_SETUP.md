# Quick Railway Deployment

## Step 1: Deploy to Railway

1. Go to [railway.app](https://railway.app)
2. Click "Deploy from GitHub repo"
3. Select your `ProfileMagic` repository
4. Railway will automatically deploy

## Step 2: Add Environment Variables

In your Railway dashboard, go to Variables tab and add:

```
SLACK_BOT_TOKEN=your-bot-token-from-.env-file
SLACK_USER_TOKEN=your-user-token-from-.env-file  
SLACK_SIGNING_SECRET=your-signing-secret-from-.env-file
SLACK_APP_TOKEN=your-app-token-from-.env-file
GEMINI_API_KEY=your-gemini-api-key-from-.env-file
API_KEY=your-gemini-api-key-from-.env-file
GEMINI_MODEL=gemini-2.5-flash-image-preview
NODE_ENV=production
```

**Important Notes:**
- ❌ **Don't set PORT** - Railway assigns this automatically
- ❌ **Don't set FILE_HOST_PORT** - Not needed on Railway
- ✅ **BASE_URL will be added in Step 4** after you get your domain

**Copy the actual values from your local `.env` file**

## Step 3: Get Your Domain

Railway will provide you a domain like `https://profilemagic-production.up.railway.app`

## Step 4: Add BASE_URL Variable

After deployment, add this variable in Railway:
```
BASE_URL=https://your-actual-railway-domain.up.railway.app
```

**Example:** `BASE_URL=https://profilemagic-production-abc123.up.railway.app`

⚠️ **Make sure to include `https://` in the BASE_URL!**

## Step 5: You're Done!

Your ProfileMagic bot is now live! Test it with `/boo` in your Slack workspace.

---

**Free Tier**: Railway gives you $5 credit monthly, which is plenty for a Slack bot that processes images occasionally.