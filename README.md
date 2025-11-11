# RSS Scheduler Server

24/7 server that monitors GitLab for scheduled RSS posts and publishes them automatically.

## 🚀 Features

- **Always Running**: 24/7 monitoring even when users close their browsers
- **Automatic Publishing**: Publishes posts when scheduled time arrives
- **GitLab Integration**: Uses GitLab API for storage and publishing
- **Free Hosting**: Deploys to free tiers on Koyeb/Cyclic

## 📦 Deployment

### Koyeb (Recommended - Free Forever)
1. Go to [koyeb.com](https://koyeb.com)
2. Sign up with GitHub
3. Create new App → Connect GitHub repository
4. Deploy - runs 24/7 for free

### Cyclic (Alternative)
1. Go to [cyclic.sh](https://cyclic.sh)
2. Connect GitHub repository
3. Deploy - no configuration needed

## 🔧 How It Works

1. **User schedules posts** via the web interface
2. **Posts are saved** to GitLab `posts.json` file
3. **This server checks every 15 seconds** for posts to publish
4. **When publication time arrives**, posts are automatically published to the target RSS feed
5. **Status updates** - posts are marked as "published" in the backup file

## 📡 API Endpoints

- `GET /` - Server status
- `GET /health` - Health check with system info

## 🔐 Configuration

The server monitors this GitLab repository:
- Repository: `SerialDesignationN/xml-maker`
- File: `posts.json`
- Branch: `main`

## 🛠️ Development

```bash
# Install dependencies
npm install

# Start server
npm start

# Development
npm run dev
