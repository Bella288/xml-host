const https = require('https');
const http = require('http');

// Configuration
const BACKUP_REPO = 'SerialDesignationN/xml-maker';
const BACKUP_FILE_PATH = 'posts.json';
const BACKUP_API_KEY = 'glpat-OjgrIQOn_MKztvDOASwn1G86MQp1OmkzdnF0Cw.01.1209n0gt2';
const CHECK_INTERVAL = 15000; // 15 seconds
const PORT = process.env.PORT || 3000;

class RSSSchedulerServer {
    constructor() {
        this.startHttpServer();
        console.log('🚀 RSS Scheduler Server Started');
        console.log('⏰ Monitoring GitLab for scheduled posts every 15 seconds...');
        this.startMonitoring();
    }

    startHttpServer() {
        const server = http.createServer((req, res) => {
            if (req.url === '/health') {
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ 
                    status: 'ok', 
                    service: 'rss-scheduler',
                    timestamp: new Date().toISOString(),
                    memory: process.memoryUsage()
                }));
            } else {
                res.writeHead(200, { 'Content-Type': 'text/plain' });
                res.end('RSS Scheduler Server - Always Running\n\nThis server monitors GitLab every 15 seconds for scheduled RSS posts and publishes them automatically when their time arrives.\n\nHealth check: /health');
            }
        });

        server.listen(PORT, () => {
            console.log(`✅ Health check server running on port ${PORT}`);
        });
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
                // Convert post date with timezone offset to UTC for comparison
                const postDate = this.convertToUTCWithTimezone(post.date, post.timezone);
                
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

    convertToUTCWithTimezone(dateString, timezone) {
        // Create date in the specified timezone and convert to UTC
        const date = new Date(dateString);
        const options = {
            timeZone: timezone,
            year: 'numeric',
            month: '2-digit',
            day: '2-digit',
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit',
            hour12: false
        };
        
        const formatter = new Intl.DateTimeFormat('en-US', options);
        const parts = formatter.formatToParts(date);
        
        const year = parts.find(part => part.type === 'year').value;
        const month = parts.find(part => part.type === 'month').value;
        const day = parts.find(part => part.type === 'day').value;
        const hour = parts.find(part => part.type === 'hour').value;
        const minute = parts.find(part => part.type === 'minute').value;
        
        // Create ISO string in the specified timezone
        const localDate = new Date(`${year}-${month}-${day}T${hour}:${minute}:00`);
        const timezoneOffset = localDate.getTimezoneOffset() * 60000;
        const utcDate = new Date(localDate.getTime() - timezoneOffset);
        
        return utcDate;
    }

    getGMTOffset(timezone) {
        const date = new Date();
        const formatter = new Intl.DateTimeFormat('en-US', {
            timeZone: timezone,
            timeZoneName: 'shortOffset'
        });
        
        const parts = formatter.formatToParts(date);
        const offsetPart = parts.find(part => part.type === 'timeZoneName');
        
        if (offsetPart && offsetPart.value.startsWith('GMT')) {
            return offsetPart.value.replace('GMT', '');
        }
        
        // Fallback: calculate offset manually
        const dateInTimezone = new Date(date.toLocaleString('en-US', { timeZone: timezone }));
        const offsetMinutes = (date.getTime() - dateInTimezone.getTime()) / 60000;
        const offsetHours = Math.abs(Math.floor(offsetMinutes / 60));
        const offsetMinutesRemainder = Math.abs(offsetMinutes % 60);
        const sign = offsetMinutes >= 0 ? '+' : '-';
        
        return `${sign}${String(offsetHours).padStart(2, '0')}:${String(offsetMinutesRemainder).padStart(2, '0')}`;
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
            
            // Add GMT offset to post data before removing from backup
            const postWithGMTOffset = {
                ...post,
                gmtOffset: this.getGMTOffset(post.timezone),
                publishedAt: new Date().toISOString(),
                status: 'published'
            };
            
            // Remove from backup JSON after successful publication
            await this.removePostFromBackup(post.id, postWithGMTOffset);
            
            console.log(`✅ Published and removed from backup: "${post.title}"`);
            
        } catch (error) {
            console.error(`❌ Failed to publish "${post.title}":`, error.message);
            await this.updatePostStatus(post.id, 'error');
        }
    }

    async removePostFromBackup(postId, publishedPost) {
        try {
            const posts = await this.getScheduledPosts();
            // Remove the published post from the array
            const updatedPosts = posts.filter(post => post.id !== postId);
            
            // Save the published post to a separate archive (optional)
            await this.archivePublishedPost(publishedPost);
            
            // Save the updated list back to GitLab
            await this.updateBackupFile(updatedPosts);
            
            console.log(`🗑️ Removed post ${postId} from backup`);
        } catch (error) {
            console.error('❌ Error removing post from backup:', error.message);
        }
    }

    async archivePublishedPost(post) {
        // Optional: Save published posts to a separate archive file
        // This helps with tracking and recovery if needed
        try {
            const archiveFile = 'published-posts.json';
            let archivedPosts = [];
            
            try {
                const existingContent = await this.getGitLabFileContent(BACKUP_REPO, archiveFile, BACKUP_API_KEY);
                if (existingContent) {
                    archivedPosts = JSON.parse(existingContent);
                }
            } catch (error) {
                // Archive file doesn't exist yet, that's okay
            }
            
            archivedPosts.push(post);
            
            await this.updateGitLabFile(
                BACKUP_REPO,
                archiveFile,
                JSON.stringify(archivedPosts, null, 2),
                `Archive published post: ${post.title}`,
                BACKUP_API_KEY
            );
            
            console.log(`📁 Archived published post: "${post.title}"`);
        } catch (error) {
            console.error('❌ Error archiving published post:', error.message);
            // Don't fail the main publication if archiving fails
        }
    }

    async getGitLabFileContent(project, filePath, token) {
        return new Promise((resolve, reject) => {
            const options = {
                hostname: 'gitlab.com',
                port: 443,
                path: `/api/v4/projects/${encodeURIComponent(project)}/repository/files/${encodeURIComponent(filePath)}?ref=main`,
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
                        resolve(''); // File doesn't exist
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

    async updateGitLabFile(project, filePath, content, commitMessage, token) {
        return new Promise((resolve, reject) => {
            const postData = JSON.stringify({
                branch: 'main',
                content: Buffer.from(content).toString('base64'),
                commit_message: commitMessage,
                encoding: 'base64'
            });

            const options = {
                hostname: 'gitlab.com',
                port: 443,
                path: `/api/v4/projects/${encodeURIComponent(project)}/repository/files/${encodeURIComponent(filePath)}`,
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
                commit_message: `Update posts - ${new Date().toISOString()}`,
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

// Handle graceful shutdown
process.on('SIGTERM', () => {
    console.log('🛑 Shutting down gracefully...');
    process.exit(0);
});
