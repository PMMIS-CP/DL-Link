const puppeteer = require('puppeteer');
const path = require('path');
const fs = require('fs');

const url = process.argv[2];
const downloadPath = process.argv[3] || './downloads';

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

(async () => {
    if (!fs.existsSync(downloadPath)) {
        fs.mkdirSync(downloadPath, { recursive: true });
    }

    console.log(`Target URL: ${url}`);
    console.log(`Download directory: ${downloadPath}`);

    const browser = await puppeteer.launch({
        headless: 'new',
        args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-dev-shm-usage',
            '--disable-web-security',
            '--disable-features=IsolateOrigins,site-per-process'
        ]
    });

    let downloadedFiles = [];

    try {
        const page = await browser.newPage();

        const client = await page.target().createCDPSession();
        await client.send('Page.setDownloadBehavior', {
            behavior: 'allow',
            downloadPath: downloadPath
        });

        await page.setUserAgent(
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
        );

        await page.setViewport({ width: 1366, height: 768 });

        page.on('response', async (response) => {
            const contentDisposition = response.headers()['content-disposition'] || '';
            const contentType = response.headers()['content-type'] || '';
            
            if (contentDisposition.includes('attachment') || contentType.includes('application/zip') || contentType.includes('application/octet-stream')) {
                console.log(`Download detected: ${response.url()}`);
            }
        });

        console.log('Navigating to page...');
        await page.goto(url, {
            waitUntil: 'networkidle2',
            timeout: 60000
        });

        console.log('Page loaded successfully.');

        const downloadSelector = await page.evaluate(() => {
            const keywords = ['download', 'setup', 'driver', '64bit', '.zip', 'graphics'];
            const allLinks = Array.from(document.querySelectorAll('a[href]'));
            
            const candidates = allLinks.filter(link => {
                const href = link.href.toLowerCase();
                const text = (link.innerText || link.textContent || '').toLowerCase();
                return keywords.some(kw => href.includes(kw) || text.includes(kw));
            });

            return candidates.length > 0 ? candidates[0].href : null;
        });

        if (downloadSelector) {
            console.log(`Found download link: ${downloadSelector}`);
            
            await page.evaluate((linkHref) => {
                const link = document.querySelector(`a[href="${linkHref}"]`);
                if (link) link.click();
            }, downloadSelector);
            
        } else {
            console.log('No specific download link found. Listing all links:');
            const allLinks = await page.evaluate(() =>
                Array.from(document.querySelectorAll('a[href]')).map(a => ({ href: a.href, text: a.innerText.substring(0, 50) }))
            );
            console.log(JSON.stringify(allLinks, null, 2));
            
            console.log('Trying fallback: waiting for potential auto-download...');
            await sleep(15000); 
        }

        console.log('Waiting for downloads to complete...');
        let waitTime = 0;
        const maxWaitTime = 120000;

        while (waitTime < maxWaitTime) {
            const files = fs.readdirSync(downloadPath).filter(f => !f.endsWith('.crdownload'));
            const newFiles = files.filter(f => !downloadedFiles.includes(f));
            
            if (newFiles.length > 0) {
                downloadedFiles = files;
                console.log(`New files detected: ${newFiles.join(', ')}`);
            }

            const hasValidFile = files.some(f => /\.(zip|exe|msi|tar\.gz|rar|7z|dmg)$/i.test(f));
            const noTempFiles = !files.some(f => f.endsWith('.crdownload'));

            if (hasValidFile && noTempFiles) {
                console.log('Download completed successfully!');
                break;
            }

            await sleep(2000);
            waitTime += 2000;
        }

        if (waitTime >= maxWaitTime) {
            console.warn('Download timed out, but will proceed with any collected files.');
        }

    } catch (error) {
        console.error('An error occurred during browser operation:', error.message);
        process.exit(1);
    } finally {
        await browser.close();
        console.log('Browser closed.');
    }

    const finalFiles = fs.readdirSync(downloadPath).filter(f => !f.endsWith('.crdownload'));
    if (finalFiles.length === 0) {
        console.error('No files were downloaded.');
        process.exit(1);
    } else {
        console.log('Downloaded files:');
        finalFiles.forEach(f => {
            const filePath = path.join(downloadPath, f);
            const stats = fs.statSync(filePath);
            console.log(`- ${f} (${(stats.size / 1024).toFixed(2)} KB)`);
        });
    }
})();
