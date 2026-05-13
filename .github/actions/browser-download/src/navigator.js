#!/usr/bin/env node

/**
 * Browser Navigator - Simulates a real browser to navigate complex pages
 * and extract direct download URLs.
 * 
 * Usage: node navigator.js <url> <output_mode> [options]
 * 
 * Output modes:
 *   --extract-links    Extract and print all detected direct download links
 *   --download         Download files directly via browser simulation
 *   --analyze          Analyze page structure and print findings
 */

const puppeteer = require('puppeteer');
const path = require('path');
const fs = require('fs');

// ============================================================
// CONFIGURATION
// ============================================================

const CONFIG = {
    // Browser settings
    browser: {
        headless: 'new',
        args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-dev-shm-usage',
            '--disable-web-security',
            '--disable-features=IsolateOrigins,site-per-process',
            '--disable-blink-features=AutomationControlled'
        ]
    },
    
    // User agent (realistic browser)
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    
    // Viewport
    viewport: { width: 1366, height: 768 },
    
    // Navigation timeout (ms)
    navigationTimeout: 60000,
    
    // Max wait time for downloads (ms)
    maxDownloadWait: 120000,
    
    // Download check interval (ms)
    downloadCheckInterval: 2000,
    
    // Keywords for detecting download links
    downloadKeywords: [
        'download', 'setup', 'driver', 'installer',
        '64bit', '64-bit', 'x64', 'x86',
        '.zip', '.exe', '.msi', '.tar.gz', '.rar', '.7z', '.dmg',
        'graphics', 'direct link', 'mirror', 'latest version',
        'stable', 'release'
    ],
    
    // File extensions that indicate a downloadable file
    downloadableExtensions: [
        '.zip', '.exe', '.msi', '.tar.gz', '.rar', '.7z',
        '.dmg', '.iso', '.apk', '.deb', '.rpm',
        '.mp4', '.mp3', '.m4a', '.pdf', '.docx', '.xlsx'
    ],
    
    // Content-Types that indicate a downloadable file
    downloadableContentTypes: [
        'application/zip',
        'application/x-zip-compressed',
        'application/x-msdownload',
        'application/x-msi',
        'application/octet-stream',
        'application/x-rar-compressed',
        'application/x-7z-compressed',
        'application/x-tar',
        'application/gzip',
        'video/mp4',
        'audio/mpeg'
    ]
};

// ============================================================
// UTILITY FUNCTIONS
// ============================================================

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

function isDownloadableUrl(url) {
    const lower = url.toLowerCase();
    return CONFIG.downloadableExtensions.some(ext => lower.endsWith(ext));
}

function isDownloadableContentType(contentType) {
    if (!contentType) return false;
    const lower = contentType.toLowerCase();
    return CONFIG.downloadableContentTypes.some(type => lower.includes(type));
}

function getFileNameFromUrl(url) {
    try {
        const urlObj = new URL(url);
        const pathname = urlObj.pathname;
        let filename = path.basename(pathname);
        // Decode URL-encoded characters
        filename = decodeURIComponent(filename);
        // Remove query parameters and fragments
        filename = filename.split('?')[0].split('#')[0];
        // Replace unsafe characters
        filename = filename.replace(/[<>:"|?*]/g, '_');
        return filename || 'downloaded_file';
    } catch {
        return 'downloaded_file';
    }
}

function getFileNameFromHeaders(headers) {
    const disposition = headers['content-disposition'] || '';
    const match = disposition.match(/filename[^;=\n]*=((['"]).*?\2|[^;\n]*)/);
    if (match && match[1]) {
        let filename = match[1].replace(/['"]/g, '');
        filename = decodeURIComponent(filename);
        return filename.replace(/[<>:"|?*]/g, '_');
    }
    return null;
}

// ============================================================
// PAGE ANALYSIS - Detect download links
// ============================================================

async function analyzePage(page) {
    console.log('[ANALYZE] Scanning page for download links...');
    
    const results = await page.evaluate((keywords, extensions) => {
        const findings = {
            directLinks: [],
            keywordLinks: [],
            allLinks: [],
            buttons: [],
            scripts: []
        };
        
        // Scan all anchor tags
        const allLinks = Array.from(document.querySelectorAll('a[href]'));
        allLinks.forEach(link => {
            const href = link.href;
            const text = (link.innerText || link.textContent || '').trim().substring(0, 100);
            const lowerHref = href.toLowerCase();
            const lowerText = text.toLowerCase();
            
            const linkInfo = { href, text };
            
            // Check if it's a direct downloadable link
            if (extensions.some(ext => lowerHref.endsWith(ext))) {
                findings.directLinks.push({ ...linkInfo, type: 'direct_extension' });
            }
            
            // Check if text or href contains download keywords
            const matchedKeywords = keywords.filter(kw => 
                lowerHref.includes(kw) || lowerText.includes(kw)
            );
            if (matchedKeywords.length > 0) {
                findings.keywordLinks.push({ ...linkInfo, matchedKeywords, type: 'keyword_match' });
            }
            
            findings.allLinks.push(linkInfo);
        });
        
        // Scan buttons with onclick/download handlers
        const buttons = Array.from(document.querySelectorAll('button, input[type="button"], input[type="submit"], [role="button"]'));
        buttons.forEach(btn => {
            const text = (btn.innerText || btn.textContent || btn.value || '').trim();
            const onclick = btn.getAttribute('onclick') || '';
            const dataUrl = btn.getAttribute('data-url') || btn.getAttribute('data-href') || '';
            
            if (text || onclick || dataUrl) {
                findings.buttons.push({ text, onclick, dataUrl });
            }
        });
        
        return findings;
    }, CONFIG.downloadKeywords, CONFIG.downloadableExtensions);
    
    // Prioritize: direct extension links first, then keyword matches
    const priorityLinks = [];
    
    // Level 1: Direct downloadable URLs
    results.directLinks.forEach(link => {
        priorityLinks.push({
            url: link.href,
            text: link.text,
            priority: 1,
            source: 'direct_extension'
        });
    });
    
    // Level 2: Keyword-matched links (sorted by number of matched keywords)
    results.keywordLinks
        .sort((a, b) => b.matchedKeywords.length - a.matchedKeywords.length)
        .forEach(link => {
            priorityLinks.push({
                url: link.href,
                text: link.text,
                priority: 2,
                source: `keyword_match: ${link.matchedKeywords.join(', ')}`
            });
        });
    
    // Level 3: All remaining links
    results.allLinks.forEach(link => {
        const alreadyAdded = priorityLinks.some(p => p.url === link.href);
        if (!alreadyAdded && link.href && !link.href.startsWith('javascript:') && !link.href.startsWith('mailto:')) {
            priorityLinks.push({
                url: link.href,
                text: link.text,
                priority: 3,
                source: 'page_link'
            });
        }
    });
    
    return {
        priorityLinks,
        totalLinks: results.allLinks.length,
        buttonsFound: results.buttons.length
    };
}

// ============================================================
// REDIRECT RESOLVER - Follow redirects to find final URL
// ============================================================

async function resolveRedirects(page, url) {
    console.log(`[REDIRECT] Resolving: ${url}`);
    
    try {
        const response = await page.goto(url, {
            waitUntil: 'networkidle2',
            timeout: CONFIG.navigationTimeout
        });
        
        if (response) {
            const finalUrl = response.url();
            const chain = response.request().redirectChain();
            const redirectCount = chain.length;
            
            if (redirectCount > 0) {
                console.log(`[REDIRECT] Followed ${redirectCount} redirect(s)`);
                console.log(`[REDIRECT] Final URL: ${finalUrl}`);
            }
            
            // Check if final URL is a direct download
            if (isDownloadableUrl(finalUrl)) {
                console.log(`[REDIRECT] Final URL appears to be a direct download link`);
                return { url: finalUrl, isDirect: true, redirects: redirectCount };
            }
            
            return { url: finalUrl, isDirect: false, redirects: redirectCount };
        }
    } catch (error) {
        console.error(`[REDIRECT] Failed to resolve: ${error.message}`);
    }
    
    return { url, isDirect: false, redirects: 0 };
}

// ============================================================
// ANTI-BOT HANDLING
// ============================================================

async function setupAntiBotEvasion(page) {
    console.log('[ANTI-BOT] Setting up evasion techniques...');
    
    // Override navigator properties to appear more human-like
    await page.evaluateOnNewDocument(() => {
        // Overwrite the `navigator.webdriver` property
        Object.defineProperty(navigator, 'webdriver', { get: () => false });
        
        // Overwrite the `navigator.plugins` property
        Object.defineProperty(navigator, 'plugins', {
            get: () => [1, 2, 3, 4, 5]
        });
        
        // Overwrite the `navigator.languages` property
        Object.defineProperty(navigator, 'languages', {
            get: () => ['en-US', 'en']
        });
        
        // Overwrite the `chrome` property
        window.chrome = { runtime: {} };
        
        // Overwrite the `permissions` property
        const originalQuery = window.navigator.permissions.query;
        window.navigator.permissions.query = (parameters) => (
            parameters.name === 'notifications' ?
                Promise.resolve({ state: Notification.permission }) :
                originalQuery(parameters)
        );
    });
    
    console.log('[ANTI-BOT] Evasion techniques applied');
}

// ============================================================
// DOWNLOAD HANDLER - Monitor and capture browser downloads
// ============================================================

async function waitForDownloads(page, downloadPath, alreadyDownloaded = []) {
    console.log('[DOWNLOAD] Waiting for downloads to complete...');
    
    let downloadedFiles = [...alreadyDownloaded];
    let waitTime = 0;
    
    while (waitTime < CONFIG.maxDownloadWait) {
        const files = fs.readdirSync(downloadPath)
            .filter(f => !f.endsWith('.crdownload'))
            .filter(f => !f.endsWith('.tmp'));
        
        const newFiles = files.filter(f => !downloadedFiles.includes(f));
        
        if (newFiles.length > 0) {
            downloadedFiles = files;
            console.log(`[DOWNLOAD] New files detected: ${newFiles.join(', ')}`);
        }
        
        const hasValidFile = files.some(f => {
            const ext = path.extname(f).toLowerCase();
            return ['.zip', '.exe', '.msi', '.rar', '.7z', '.dmg', '.iso', '.tar', '.gz', '.mp4', '.mp3'].includes(ext);
        });
        
        const noTempFiles = !files.some(f => f.endsWith('.crdownload'));
        
        if (hasValidFile && noTempFiles && files.length > 0) {
            console.log('[DOWNLOAD] Download completed successfully!');
            break;
        }
        
        await sleep(CONFIG.downloadCheckInterval);
        waitTime += CONFIG.downloadCheckInterval;
    }
    
    if (waitTime >= CONFIG.maxDownloadWait) {
        console.warn('[DOWNLOAD] Download timed out, but will proceed with any collected files.');
    }
    
    return downloadedFiles;
}

// ============================================================
// MAIN FUNCTIONS
// ============================================================

/**
 * Extract mode: Navigate to URL and extract all potential download links
 */
async function extractLinks(url) {
    console.log(`\n========================================`);
    console.log(`[NAVIGATOR] Extract Mode`);
    console.log(`[NAVIGATOR] Target URL: ${url}`);
    console.log(`========================================\n`);
    
    const browser = await puppeteer.launch(CONFIG.browser);
    
    try {
        const page = await browser.newPage();
        await setupAntiBotEvasion(page);
        await page.setUserAgent(CONFIG.userAgent);
        await page.setViewport(CONFIG.viewport);
        
        // Setup download behavior
        const client = await page.target().createCDPSession();
        await client.send('Page.setDownloadBehavior', {
            behavior: 'allow',
            downloadPath: '/tmp/browser_extract'
        });
        
        // Listen for download triggers via response headers
        const detectedDownloadUrls = new Set();
        page.on('response', (response) => {
            const headers = response.headers();
            const contentType = headers['content-type'] || '';
            const disposition = headers['content-disposition'] || '';
            
            if (isDownloadableContentType(contentType) || disposition.includes('attachment')) {
                detectedDownloadUrls.add(response.url());
                console.log(`[DETECT] Download response detected: ${response.url()}`);
                console.log(`[DETECT] Content-Type: ${contentType}, Disposition: ${disposition}`);
            }
        });
        
        // Navigate and resolve redirects
        const resolved = await resolveRedirects(page, url);
        
        // If the final URL is already a direct download, return it
        if (resolved.isDirect) {
            console.log(`[NAVIGATOR] Page redirected directly to downloadable file`);
            return {
                success: true,
                mode: 'direct_redirect',
                directUrls: [resolved.url],
                extractedLinks: [],
                detectedFromHeaders: Array.from(detectedDownloadUrls)
            };
        }
        
        // Analyze page for download links
        const analysis = await analyzePage(page);
        
        console.log(`\n[NAVIGATOR] Analysis complete:`);
        console.log(`  - Total links found: ${analysis.totalLinks}`);
        console.log(`  - High priority (direct): ${analysis.priorityLinks.filter(l => l.priority === 1).length}`);
        console.log(`  - Medium priority (keyword match): ${analysis.priorityLinks.filter(l => l.priority === 2).length}`);
        console.log(`  - Buttons found: ${analysis.buttonsFound}`);
        
        // Print top candidates
        console.log(`\n[NAVIGATOR] Top download candidates:`);
        analysis.priorityLinks
            .filter(l => l.priority <= 2)
            .slice(0, 10)
            .forEach((link, i) => {
                console.log(`  ${i + 1}. [P${link.priority}] ${link.url}`);
                console.log(`     Source: ${link.source}`);
                if (link.text) console.log(`     Text: ${link.text.substring(0, 80)}`);
            });
        
        return {
            success: true,
            mode: 'page_analysis',
            directUrls: analysis.priorityLinks
                .filter(l => l.priority === 1)
                .map(l => l.url),
            extractedLinks: analysis.priorityLinks
                .filter(l => l.priority === 2)
                .map(l => l.url),
            allLinks: analysis.priorityLinks.map(l => l.url),
            detectedFromHeaders: Array.from(detectedDownloadUrls)
        };
        
    } catch (error) {
        console.error(`[NAVIGATOR] Error: ${error.message}`);
        return {
            success: false,
            error: error.message,
            directUrls: [],
            extractedLinks: []
        };
    } finally {
        await browser.close();
        console.log('[NAVIGATOR] Browser closed.');
    }
}

/**
 * Download mode: Navigate to URL and download files directly via browser
 */
async function downloadViaBrowser(url, downloadPath) {
    console.log(`\n========================================`);
    console.log(`[NAVIGATOR] Download Mode`);
    console.log(`[NAVIGATOR] Target URL: ${url}`);
    console.log(`[NAVIGATOR] Download path: ${downloadPath}`);
    console.log(`========================================\n`);
    
    if (!fs.existsSync(downloadPath)) {
        fs.mkdirSync(downloadPath, { recursive: true });
    }
    
    const browser = await puppeteer.launch(CONFIG.browser);
    let downloadedFiles = [];
    
    try {
        const page = await browser.newPage();
        await setupAntiBotEvasion(page);
        
        // Setup download behavior
        const client = await page.target().createCDPSession();
        await client.send('Page.setDownloadBehavior', {
            behavior: 'allow',
            downloadPath: downloadPath
        });
        
        await page.setUserAgent(CONFIG.userAgent);
        await page.setViewport(CONFIG.viewport);
        
        // Track downloads via response headers
        page.on('response', (response) => {
            const headers = response.headers();
            const contentType = headers['content-type'] || '';
            const disposition = headers['content-disposition'] || '';
            
            if (isDownloadableContentType(contentType) || disposition.includes('attachment')) {
                console.log(`[DOWNLOAD] Response detected: ${response.url()}`);
            }
        });
        
        // Navigate to page
        console.log('[NAVIGATOR] Navigating to page...');
        await page.goto(url, {
            waitUntil: 'networkidle2',
            timeout: CONFIG.navigationTimeout
        });
        
        console.log('[NAVIGATOR] Page loaded successfully.');
        
        // Try to find and click download link
        const downloadSelector = await page.evaluate((keywords) => {
            const allLinks = Array.from(document.querySelectorAll('a[href]'));
            
            // First priority: links with downloadable extensions
            const directDownloads = allLinks.filter(link => {
                const href = link.href.toLowerCase();
                return ['.zip', '.exe', '.msi', '.tar.gz', '.rar', '.7z', '.dmg'].some(ext => href.endsWith(ext));
            });
            
            if (directDownloads.length > 0) {
                console.log('Found direct download link: ' + directDownloads[0].href);
                return directDownloads[0].href;
            }
            
            // Second priority: keyword matching
            const candidates = allLinks.filter(link => {
                const href = link.href.toLowerCase();
                const text = (link.innerText || link.textContent || '').toLowerCase();
                return keywords.some(kw => href.includes(kw) || text.includes(kw));
            });
            
            if (candidates.length > 0) {
                console.log('Found keyword-matched link: ' + candidates[0].href);
                return candidates[0].href;
            }
            
            return null;
        }, CONFIG.downloadKeywords);
        
        if (downloadSelector) {
            console.log(`[NAVIGATOR] Clicking download link: ${downloadSelector}`);
            await page.evaluate((linkHref) => {
                const link = document.querySelector(`a[href="${linkHref}"]`);
                if (link) link.click();
            }, downloadSelector);
        } else {
            console.log('[NAVIGATOR] No specific download link found. Waiting for potential auto-download...');
            
            // Print all links for debugging
            const allLinks = await page.evaluate(() =>
                Array.from(document.querySelectorAll('a[href]'))
                    .map(a => ({ href: a.href, text: (a.innerText || '').substring(0, 50) }))
            );
            console.log('[DEBUG] Page links:');
            allLinks.slice(0, 20).forEach(l => console.log(`  - ${l.text || '(no text)'} -> ${l.href}`));
            
            await sleep(10000);
        }
        
        // Wait for downloads
        downloadedFiles = await waitForDownloads(page, downloadPath);
        
    } catch (error) {
        console.error(`[NAVIGATOR] Error: ${error.message}`);
    } finally {
        await browser.close();
        console.log('[NAVIGATOR] Browser closed.');
    }
    
    // Return results
    const finalFiles = fs.readdirSync(downloadPath)
        .filter(f => !f.endsWith('.crdownload'))
        .filter(f => !f.endsWith('.tmp'));
    
    const fileDetails = finalFiles.map(f => {
        const filePath = path.join(downloadPath, f);
        const stats = fs.statSync(filePath);
        return {
            name: f,
            path: filePath,
            size: stats.size,
            sizeFormatted: `${(stats.size / 1024).toFixed(2)} KB`
        };
    });
    
    return {
        success: finalFiles.length > 0,
        files: fileDetails,
        count: finalFiles.length
    };
}

// ============================================================
// CLI ENTRY POINT
// ============================================================

async function main() {
    const args = process.argv.slice(2);
    
    if (args.length < 2) {
        console.error('Usage: node navigator.js <url> <mode> [download_path]');
        console.error('');
        console.error('Modes:');
        console.error('  --extract-links    Extract and print direct download links');
        console.error('  --download         Download files via browser simulation');
        console.error('');
        process.exit(1);
    }
    
    const url = args[0];
    const mode = args[1];
    const downloadPath = args[2] || './browser_downloads';
    
    let result;
    
    switch (mode) {
        case '--extract-links':
            result = await extractLinks(url);
            // Output as JSON for parsing by shell scripts
            console.log('\n__NAVIGATOR_RESULT__');
            console.log(JSON.stringify(result, null, 2));
            console.log('__END_NAVIGATOR_RESULT__');
            break;
            
        case '--download':
            result = await downloadViaBrowser(url, downloadPath);
            console.log('\n__NAVIGATOR_RESULT__');
            console.log(JSON.stringify(result, null, 2));
            console.log('__END_NAVIGATOR_RESULT__');
            break;
            
        default:
            console.error(`Unknown mode: ${mode}`);
            process.exit(1);
    }
    
    if (!result.success) {
        process.exit(1);
    }
}

// Run if called directly
if (require.main === module) {
    main().catch(err => {
        console.error('Fatal error:', err);
        process.exit(1);
    });
}

// Export for use as module
module.exports = { extractLinks, downloadViaBrowser, analyzePage, resolveRedirects, CONFIG };