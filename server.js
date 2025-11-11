const https = require('https');

// Configuration
const BACKUP_REPO = 'SerialDesignationN/xml-maker';
const BACKUP_FILE_PATH = 'posts.json';
const BACKUP_API_KEY = 'glpat-OjgrIQOn_MKztvDOASwn1G86MQp1OmkzdnF0Cw.01.1209n0gt2';
const CHECK_INTERVAL = 15000; // 15 seconds

class RSSSchedulerServer {
    constructor() {
        console.log('🚀 RSS Scheduler Server Started');
        console.log('⏰ Monitoring GitLab for scheduled posts every 15 seconds...');
        this.startMonitoring();
    }

    async startMonitoring() {
        // Run immediately, then every 15 seconds
        while (true) {
            try {
                await this.checkAndPublishPosts();
            } catch (error) {
                console.error('❌ Error in monitoring cycle:', error);
            }
            
            // Wait for the next check
            await new Promise(resolve => setTimeout(resolve, CHECK_INTERVAL));
        }
    }

    async checkAndPublishPosts() {
        const now = new Date();
        console.log(`🔍 Checking for posts to publish at ${now.toISOString()}...`);
        
        try {
            const posts = await this.getScheduledPosts();
            const scheduledPosts = posts.filter(post => post.status === 'scheduled');
            
            console.log(`📊 Found ${scheduledPosts.length} scheduled posts`);

            for (const post of scheduledPosts) {
                // Convert post date to UTC for comparison
                const postDate = new Date(post.date);
                
                if (postDate <= now) {
                    console.log(`🚀 Time to publish: "${post.title}"`);
                    await this.publishPost(post);
                } else {
                    const timeLeft = postDate - now;
                    const minutesLeft = Math.round(timeLeft / 60000);
                    console.log(`⏳ "${post.title}" publishes in ${minutesLeft} minutes`);
                }
            }
        } catch (error) {
            console.error('❌ Error checking posts:', error.message);
        }
    }

    async getScheduledPosts() {
        return new Promise((resolve, reject) => {
            const options = {
                hostname: 'gitlab.com',
                port: 443,
                path: `/api/v4/projects/${encodeURIComponent(BACKUP_REPO)}/repository/files/${encodeURIComponent(BACKUP_FILE_PATH)}?ref=main`,
                method: 'GET',
                headers: {
                    'PRIVATE-TOKEN': BACKUP_API_KEY
                },
                timeout: 10000
            };

            const req = https.request(options, (res) => {
                let data = '';

                res.on('data', (chunk) => {
                    data += chunk;
                });

                res.on('end', () => {
                    if (res.statusCode === 200) {
                        try {
                            const fileData = JSON.parse(data);
                            const content = Buffer.from(fileData.content, 'base64').toString('utf8');
                            const posts = JSON.parse(content);
                            resolve(posts);
                        } catch (error) {
                            reject(new Error('Failed to parse posts data: ' + error.message));
                        }
                    } else if (res.statusCode === 404) {
                        resolve([]); // No posts file yet
                    } else {
                        reject(new Error(`GitLab API error: ${res.statusCode}`));
                    }
                });
            });

            req.on('error', reject);
            req.on('timeout', () => {
                req.destroy();
                reject(new Error('Request timeout'));
            });

            req.end();
        });
    }

    async publishPost(post) {
        try {
            console.log(`📝 Starting publication: "${post.title}"`);

            // Parse the target GitLab URL
            const urlParts = this.parseGitLabUrl(post.gitlabUrl);
            if (!urlParts) {
                throw new Error('Invalid GitLab URL: ' + post.gitlabUrl);
            }

            // Get current RSS file content
            const currentContent = await this.getFileContent(urlParts, post.gitlabToken);
            
            // Create or update RSS
            const newContent = this.updateRssContent(currentContent, post);
            
            // Commit to GitLab
            await this.commitToGitLab(urlParts, post.gitlabToken, newContent, `Publish: ${post.title}`);
            
            // Mark as published
            await this.updatePostStatus(post.id, 'published');
            
            console.log(`✅ Published: "${post.title}"`);
            
        } catch (error) {
            console.error(`❌ Failed to publish "${post.title}":`, error.message);
            await this.updatePostStatus(post.id, 'error');
        }
    }

    parseGitLabUrl(url) {
        const match = url.match(/https?:\/\/[^\/]+\/([^\/]+\/[^\/]+)\/-\/blob\/([^\/]+)\/(.+)/);
        return match ? {
            project: match[1],
            branch: match[2],
            filePath: match[3]
        } : null;
    }

    async getFileContent(urlParts, token) {
        return new Promise((resolve, reject) => {
            const options = {
                hostname: 'gitlab.com',
                port: 443,
                path: `/api/v4/projects/${encodeURIComponent(urlParts.project)}/repository/files/${encodeURIComponent(urlParts.filePath)}?ref=${urlParts.branch}`,
                method: 'GET',
                headers: {
                    'PRIVATE-TOKEN': token
                },
                timeout: 10000
            };

            const req = https.request(options, (res) => {
                let data = '';

                res.on('data', (chunk) => {
                    data += chunk;
                });

                res.on('end', () => {
                    if (res.statusCode === 200) {
                        const fileData = JSON.parse(data);
                        resolve(Buffer.from(fileData.content, 'base64').toString('utf8'));
                    } else if (res.statusCode === 404) {
                        resolve(''); // New file
                    } else {
                        reject(new Error(`GitLab API error: ${res.statusCode}`));
                    }
                });
            });

            req.on('error', reject);
            req.on('timeout', () => {
                req.destroy();
                reject(new Error('Timeout'));
            });

            req.end();
        });
    }

    updateRssContent(existingContent, post) {
        if (!existingContent.trim()) {
            return `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
<channel>
    <title>${this.escapeXml(post.feedTitle)}</title>
    <description>${this.escapeXml(post.feedDescription)}</description>
    <link>${this.escapeXml(post.feedLink)}</link>
    <lastBuildDate>${new Date().toUTCString()}</lastBuildDate>
    <item>
        <title>${this.escapeXml(post.title)}</title>
        <description><![CDATA[${post.description}]]></description>
        <link>${this.escapeXml(post.link)}</link>
        <guid>${this.escapeXml(post.guid)}</guid>
        <pubDate>${new Date(post.date).toUTCString()}</pubDate>
    </item>
</channel>
</rss>`;
        }

        // Add to existing RSS
        const closingChannel = existingContent.indexOf('</channel>');
        if (closingChannel === -1) throw new Error('Invalid RSS format');

        const newItem = `
    <item>
        <title>${this.escapeXml(post.title)}</title>
        <description><![CDATA[${post.description}]]></description>
        <link>${this.escapeXml(post.link)}</link>
        <guid>${this.escapeXml(post.guid)}</guid>
        <pubDate>${new Date(post.date).toUTCString()}</pubDate>
    </item>`;

        return existingContent.slice(0, closingChannel) + newItem + existingContent.slice(closingChannel);
    }

    async commitToGitLab(urlParts, token, content, message) {
        return new Promise((resolve, reject) => {
            const postData = JSON.stringify({
                branch: urlParts.branch,
                content: Buffer.from(content).toString('base64'),
                commit_message: message,
                encoding: 'base64'
            });

            const options = {
                hostname: 'gitlab.com',
                port: 443,
                path: `/api/v4/projects/${encodeURIComponent(urlParts.project)}/repository/files/${encodeURIComponent(urlParts.filePath)}`,
                method: 'PUT',
                headers: {
                    'Content-Type': 'application/json',
                    'PRIVATE-TOKEN': token,
                    'Content-Length': Buffer.byteLength(postData)
                },
                timeout: 15000
            };

            const req = https.request(options, (res) => {
                let data = '';
                res.on('data', chunk => data += chunk);
                res.on('end', () => {
                    res.statusCode === 200 ? resolve(JSON.parse(data)) : reject(new Error(`Commit failed: ${res.statusCode}`));
                });
            });

            req.on('error', reject);
            req.on('timeout', () => {
                req.destroy();
                reject(new Error('Commit timeout'));
            });

            req.write(postData);
            req.end();
        });
    }

    async updatePostStatus(postId, status) {
        try {
            const posts = await this.getScheduledPosts();
            const postIndex = posts.findIndex(p => p.id === postId);
            
            if (postIndex !== -1) {
                posts[postIndex].status = status;
                await this.updateBackupFile(posts);
            }
        } catch (error) {
            console.error('Error updating post status:', error.message);
        }
    }

    async updateBackupFile(posts) {
        return new Promise((resolve, reject) => {
            const postData = JSON.stringify({
                branch: 'main',
                content: Buffer.from(JSON.stringify(posts, null, 2)).toString('base64'),
                commit_message: `Update post status - ${new Date().toISOString()}`,
                encoding: 'base64'
            });

            const options = {
                hostname: 'gitlab.com',
                port: 443,
                path: `/api/v4/projects/${encodeURIComponent(BACKUP_REPO)}/repository/files/${encodeURIComponent(BACKUP_FILE_PATH)}`,
                method: 'PUT',
                headers: {
                    'Content-Type': 'application/json',
                    'PRIVATE-TOKEN': BACKUP_API_KEY,
                    'Content-Length': Buffer.byteLength(postData)
                }
            };

            const req = https.request(options, (res) => {
                let data = '';
                res.on('data', chunk => data += chunk);
                res.on('end', () => {
                    res.statusCode === 200 ? resolve() : reject(new Error('Backup update failed'));
                });
            });

            req.on('error', reject);
            req.write(postData);
            req.end();
        });
    }

    escapeXml(unsafe) {
        return unsafe.replace(/[<>&'"]/g, c => ({
            '<': '&lt;', '>': '&gt;', '&': '&amp;',
            '\'': '&apos;', '"': '&quot;'
        }[c]));
    }
}

// Start the server
new RSSSchedulerServer();
