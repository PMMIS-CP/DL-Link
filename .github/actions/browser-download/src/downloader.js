#!/usr/bin/env node

/**
 * Browser Link Extractor
 * 
 * Visits protected pages (anti-bot, JS-rendered, redirect chains),
 * extracts direct download links, and optionally downloads files
 * that the browser encounters during navigation.
 * 
 * Primary output: Direct download URLs for use with aria2/curl downloaders.
 * Secondary output: Any files downloaded during browser navigation.
 */

const puppeteer = require('puppeteer');
const path = require('path');
const fs = require('fs');

// ============================================================================
// Configuration & Argument Parsing
// ============================================================================

function parseArgs() {
    const args = process.argv.slice(2);
    const config = {
        url: null,
        downloadDir: './browser_downloads',
        viewportWidth: 1366,
        viewportHeight: 768,
        navigationTimeout: 60000,
        downloadWaitTimeout: 120000,
        userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        downloadKeywords: ['download', 'setup', 'driver', '64bit', '.zip', '.rar', '.exe', '.msi', '.tar.gz', '.7z', 'graphics', 'direct', 'link'],
        outputFormat: 'json'
    };

    for (let i = 0; i < args.length; i++) {
        switch (args[i]) {
            case '--url':
                config.url = args[++i];
                break;
            case '--download-dir':
                config.downloadDir = args[++i];
                break;
            case '--viewport-width':
                config.viewportWidth = parseInt(args[++i], 10);
                break;
            case '--viewport-height':
                config.viewportHeight = parseInt(args[++i], 10);
                break;
            case '--navigation-timeout':
                config.navigationTimeout = parseInt(args[++i], 10);
                break;
            case '--download-wait-timeout':
                config.downloadWaitTimeout = parseInt(args[++i], 10);
                break;
            case '--user-agent':
                config.userAgent = args[++i];
                break;
            case '--output-format':
                config.outputFormat = args[++i];
                break;
            case '--help':
                printHelp();
                process.exit(0);
        }
    }

    return config;
}

function printHelp() {
    console.log(`
Browser Link Extractor
======================

Visits web pages (including anti-bot/JS-rendered pages) and extracts
direct download URLs for use with dedicated downloaders like aria2c.

Usage: node downloader.js [options]

Options:
  --url <url>                    URL to visit (required)
  --download-dir <path>          Temp download directory (default: ./browser_downloads)
  --viewport-width <px>          Browser viewport width (default: 1366)
  --viewport-height <px>         Browser viewport height (default: 768)
  --navigation-timeout <ms>      Page load timeout (default: 60000)
  --download-wait-timeout <ms>   Max wait for auto-downloads (default: 120000)
  --user-agent <string>          Custom User-Agent string
  --output-format <json|text>    Output format (default: json)
  --help                         Show this help message

Output (JSON):
  {
    "extractedUrls": "url1 url2 url3",    // Space-separated direct URLs for aria2/curl
    "extractedLinks": [...],              // Array of {url, text, confidence}
    "downloadedFiles": [...],             // Files browser downloaded during visit
    "downloadedFileCount": 0,             // Number of files browser downloaded
    "pageTitle": "...",                   // Page title
    "finalUrl": "..."                     // Final URL after redirects
  }
`);
}

// ============================================================================
// Utility Functions
// ============================================================================

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

function ensureDirectory(dirPath) {
    if (!fs.existsSync(dirPath)) {
        fs.mkdirSync(dirPath, { recursive: true });
    }
}

function isTempFile(filename) {
    return filename.endsWith('.crdownload') || filename.endsWith('.part');
}

function isDownloadableFile(filename) {
    return /\.(zip|exe|msi|tar\.gz|rar|7z|dmg|iso|apk|deb|rpm|pkg)$/i.test(filename);
}

function formatFileSize(bytes) {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(2)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

// ============================================================================
// Browser Setup
// ============================================================================

async function launchBrowser() {
    console.error('[Browser] Launching headless browser...');

    const browser = await puppeteer.launch({
        headless: 'new',
        args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-dev-shm-usage',
            '--disable-web-security',
            '--disable-features=IsolateOrigins,site-per-process',
            '--disable-blink-features=AutomationControlled'
        ]
    });

    return browser;
}

async function setupPage(browser, config) {
    const page = await browser.newPage();

    // Set download behavior for any files browser encounters
    const client = await page.target().createCDPSession();
    await client.send('Page.setDownloadBehavior', {
        behavior: 'allow',
        downloadPath: config.downloadDir
    });

    await page.setUserAgent(config.userAgent);
    await page.setViewport({
        width: config.viewportWidth,
        height: config.viewportHeight
    });

    // Hide automation
    await page.evaluateOnNewDocument(() => {
        Object.defineProperty(navigator, 'webdriver', { get: () => false });
        window.chrome = { runtime: {} };
    });

    // Track any downloads browser triggers
    const trackedResponses = [];
    page.on('response', (response) => {
        const contentDisposition = response.headers()['content-disposition'] || '';
        const contentType = response.headers()['content-type'] || '';
        const url = response.url();

        if (
            contentDisposition.includes('attachment') ||
            contentType.includes('application/zip') ||
            contentType.includes('application/octet-stream') ||
            contentType.includes('application/x-msdownload') ||
            contentType.includes('application/x-compressed') ||
            contentType.includes('application/x-rar')
        ) {
            console.error(`[Browser] Download response detected: ${url}`);
            trackedResponses.push({
                url: url,
                contentType: contentType,
                contentDisposition: contentDisposition
            });
        }
    });

    return { page, client, trackedResponses };
}

// ============================================================================
// Link Extraction - Core Logic
// ============================================================================

async function extractAllLinks(page, keywords) {
    /**
     * Extracts ALL potentially downloadable links from the page.
     * Returns categorized links with confidence scores.
     */
    return await page.evaluate((kw) => {
        const allLinks = Array.from(document.querySelectorAll('a[href]'));
        const results = {
            highConfidence: [],
            mediumConfidence: [],
            lowConfidence: [],
            all: []
        };

        allLinks.forEach(link => {
            const href = link.href || '';
            const text = (link.innerText || link.textContent || '').toLowerCase().trim();
            const hrefLower = href.toLowerCase();

            // Skip non-download URLs
            if (!href || href.startsWith('javascript:') || href.startsWith('#') || href.startsWith('mailto:')) {
                return;
            }

            const linkInfo = {
                url: href,
                text: text.substring(0, 100),
                title: (link.title || '').substring(0, 100)
            };

            results.all.push(linkInfo);

            // Confidence scoring
            let score = 0;
            let reasons = [];

            // Check href patterns
            kw.forEach(keyword => {
                if (hrefLower.includes(keyword)) {
                    score += 3;
                    reasons.push(`href:${keyword}`);
                }
            });

            // Check text patterns
            kw.forEach(keyword => {
                if (text.includes(keyword)) {
                    score += 2;
                    reasons.push(`text:${keyword}`);
                }
            });

            // Check file extensions in URL
            if (/\.(zip|rar|7z|exe|msi|tar\.gz|iso|dmg|apk|deb|rpm)\b/i.test(hrefLower)) {
                score += 5;
                reasons.push('file-extension');
            }

            // Check for download attributes
            if (link.hasAttribute('download')) {
                score += 3;
                reasons.push('download-attr');
            }

            // Check parent context
            const parentText = (link.parentElement?.innerText || '').toLowerCase();
            if (parentText.includes('download') || parentText.includes('setup')) {
                score += 1;
                reasons.push('parent-context');
            }

            linkInfo.score = score;
            linkInfo.reasons = reasons;

            if (score >= 5) {
                results.highConfidence.push(linkInfo);
            } else if (score >= 3) {
                results.mediumConfidence.push(linkInfo);
            } else if (score > 0) {
                results.lowConfidence.push(linkInfo);
            }
        });

        return results;
    }, keywords);
}

async function detectRedirectChains(page) {
    /**
     * Detects if page uses meta refresh or JavaScript redirects
     * that might lead to the actual download page.
     */
    return await page.evaluate(() => {
        const redirects = [];

        // Check meta refresh
        const metaRefresh = document.querySelector('meta[http-equiv="refresh"]');
        if (metaRefresh) {
            redirects.push({
                type: 'meta-refresh',
                content: metaRefresh.getAttribute('content') || ''
            });
        }

        // Check for common redirect patterns in scripts
        const scripts = Array.from(document.querySelectorAll('script'));
        scripts.forEach(script => {
            const content = script.textContent || '';
            if (content.includes('window.location') || content.includes('document.location')) {
                redirects.push({ type: 'js-redirect', detected: true });
            }
        });

        // Check iframes that might contain downloads
        const iframes = Array.from(document.querySelectorAll('iframe')).map(iframe => ({
            type: 'iframe',
            src: iframe.src || ''
        })).filter(f => f.src);

        return { redirects, iframes };
    });
}

async function interceptNetworkRequests(page) {
    /**
     * Monitors network requests to catch download URLs that
     * might be triggered via XHR/Fetch or hidden redirects.
     */
    const interceptedUrls = [];

    await page.setRequestInterception(true);

    page.on('request', (request) => {
        const url = request.url().toLowerCase();
        if (
            url.includes('download') ||
            url.includes('file') ||
            url.includes('get') ||
            url.includes('direct') ||
            /\.(zip|rar|7z|exe|msi|tar\.gz|iso|dmg|apk)(\?|$)/i.test(url)
        ) {
            interceptedUrls.push({
                url: request.url(),
                method: request.method(),
                resourceType: request.resourceType(),
                headers: request.headers()
            });
        }
        request.continue();
    });

    return interceptedUrls;
}

// ============================================================================
// File Monitoring
// ============================================================================

async function waitForBrowserDownloads(config) {
    /**
     * Waits for any files the browser automatically downloads
     * during page navigation (secondary output).
     */
    const { downloadDir, downloadWaitTimeout } = config;
    let waitTime = 0;
    const pollInterval = 2000;
    let stableCount = 0;

    while (waitTime < downloadWaitTimeout) {
        const currentFiles = fs.readdirSync(downloadDir)
            .filter(f => !isTempFile(f) && !f.startsWith('.'));

        const hasDownloadable = currentFiles.some(f => isDownloadableFile(f));
        const noTempFiles = !currentFiles.some(f => isTempFile(f));

        if (hasDownloadable && noTempFiles && currentFiles.length > 0) {
            stableCount++;
            if (stableCount >= 3) {
                // Files stable for 3 checks
                return currentFiles;
            }
        } else {
            stableCount = 0;
        }

        await sleep(pollInterval);
        waitTime += pollInterval;
    }

    // Return whatever we have
    return fs.readdirSync(downloadDir)
        .filter(f => !isTempFile(f) && !f.startsWith('.'));
}

// ============================================================================
// Main Extraction Orchestrator
// ============================================================================

async function extractLinks(config) {
    if (!config.url) {
        console.error('ERROR: No URL provided. Use --url <url>');
        process.exit(1);
    }

    ensureDirectory(config.downloadDir);

    const result = {
        extractedUrls: '',
        extractedLinks: [],
        downloadedFiles: [],
        downloadedFileCount: 0,
        pageTitle: '',
        finalUrl: '',
        error: null
    };

    let browser = null;

    try {
        console.error('='.repeat(60));
        console.error('Browser Link Extractor');
        console.error('='.repeat(60));
        console.error(`Target URL:    ${config.url}`);
        console.error(`Temp dir:      ${config.downloadDir}`);
        console.error('='.repeat(60));
        console.error('');

        // Launch
        browser = await launchBrowser();
        const { page } = await setupPage(browser, config);

        // Setup network interception
        const interceptedUrls = await interceptNetworkRequests(page);

        // Navigate
        console.error(`[Navigate] Loading: ${config.url}`);
        await page.goto(config.url, {
            waitUntil: 'networkidle2',
            timeout: config.navigationTimeout
        });

        // Get final URL (after redirects)
        result.finalUrl = page.url();
        result.pageTitle = await page.title();
        console.error(`[Navigate] Final URL: ${result.finalUrl}`);
        console.error(`[Navigate] Title: ${result.pageTitle}`);

        // Detect redirect chains
        const redirectInfo = await detectRedirectChains(page);
        if (redirectInfo.redirects.length > 0) {
            console.error(`[Detect] Found ${redirectInfo.redirects.length} redirect patterns`);
        }
        if (redirectInfo.iframes.length > 0) {
            console.error(`[Detect] Found ${redirectInfo.iframes.length} iframes`);
        }

        // Wait a bit for any dynamic content
        await sleep(3000);

        // Extract all download links
        console.error('[Extract] Scanning page for download links...');
        const extractedLinks = await extractAllLinks(page, config.downloadKeywords);

        console.error(`[Extract] High confidence: ${extractedLinks.highConfidence.length}`);
        console.error(`[Extract] Medium confidence: ${extractedLinks.mediumConfidence.length}`);
        console.error(`[Extract] Low confidence: ${extractedLinks.lowConfidence.length}`);

        // Build prioritized URL list
        const priorityUrls = [
            ...extractedLinks.highConfidence.map(l => l.url),
            ...extractedLinks.mediumConfidence.map(l => l.url),
            ...extractedLinks.lowConfidence.map(l => l.url),
            ...interceptedUrls.map(r => r.url)
        ];

        // Remove duplicates preserving order
        const uniqueUrls = [...new Set(priorityUrls)];

        // Try clicking high-confidence links to trigger downloads
        if (extractedLinks.highConfidence.length > 0) {
            const topLink = extractedLinks.highConfidence[0];
            console.error(`[Action] Clicking: ${topLink.url}`);
            try {
                await page.evaluate((linkUrl) => {
                    const link = document.querySelector(`a[href="${linkUrl}"]`);
                    if (link) {
                        link.click();
                        return true;
                    }
                    // Try case-insensitive
                    const allLinks = Array.from(document.querySelectorAll('a[href]'));
                    const match = allLinks.find(a =>
                        a.href.toLowerCase() === linkUrl.toLowerCase()
                    );
                    if (match) {
                        match.click();
                        return true;
                    }
                    return false;
                }, topLink.url);
                console.error('[Action] Click successful');
            } catch (e) {
                console.error(`[Action] Click failed: ${e.message}`);
            }
        }

        // Add intercepted URLs
        interceptedUrls.forEach(r => {
            if (!uniqueUrls.includes(r.url)) {
                uniqueUrls.push(r.url);
            }
        });

        // Wait for any browser-triggered downloads
        console.error('[Wait] Checking for browser downloads...');
        const browserFiles = await waitForBrowserDownloads(config);

        if (browserFiles.length > 0) {
            result.downloadedFiles = browserFiles.map(f => {
                const filePath = path.join(config.downloadDir, f);
                const stats = fs.statSync(filePath);
                return {
                    name: f,
                    path: filePath,
                    size: stats.size,
                    sizeFormatted: formatFileSize(stats.size)
                };
            });
            result.downloadedFileCount = result.downloadedFiles.length;
            console.error(`[Browser] Downloaded ${result.downloadedFileCount} files directly`);
        }

        // Build extracted URLs output (space-separated for compatibility with download-aria2)
        result.extractedUrls = uniqueUrls.join(' ');
        result.extractedLinks = [
            ...extractedLinks.highConfidence,
            ...extractedLinks.mediumConfidence,
            ...extractedLinks.lowConfidence
        ];

        // Summary
        console.error('');
        console.error('='.repeat(60));
        console.error('EXTRACTION SUMMARY');
        console.error('='.repeat(60));
        console.error(`Extracted URLs:     ${uniqueUrls.length}`);
        console.error(`Browser downloads:  ${result.downloadedFileCount}`);
        console.error(`Final URL:          ${result.finalUrl}`);
        console.error('='.repeat(60));

        if (uniqueUrls.length > 0) {
            console.error('');
            console.error('Extracted URLs (for aria2/curl):');
            uniqueUrls.forEach((url, i) => {
                console.error(`  ${i + 1}. ${url}`);
            });
        }

        return result;

    } catch (error) {
        console.error(`\n[ERROR] ${error.message}`);
        result.error = error.message;
        return result;
    } finally {
        if (browser) {
            await browser.close();
            console.error('\n[Browser] Closed');
        }
    }
}

// ============================================================================
// Output Formatting
// ============================================================================

function outputResult(result, format) {
    if (format === 'json') {
        // Output only JSON to stdout (rest goes to stderr)
        console.log(JSON.stringify(result, null, 2));
    } else {
        // Plain text output
        if (result.extractedUrls) {
            console.log(result.extractedUrls);
        }
    }
}

// ============================================================================
// Entry Point
// ============================================================================

if (require.main === module) {
    const config = parseArgs();

    extractLinks(config)
        .then((result) => {
            outputResult(result, config.outputFormat);
            if (result.error) {
                process.exit(1);
            }
            process.exit(0);
        })
        .catch((error) => {
            console.error('Unhandled error:', error);
            // Still output JSON with error
            console.log(JSON.stringify({
                extractedUrls: '',
                extractedLinks: [],
                downloadedFiles: [],
                downloadedFileCount: 0,
                error: error.message
            }));
            process.exit(1);
        });
}

module.exports = { extractLinks, parseArgs };