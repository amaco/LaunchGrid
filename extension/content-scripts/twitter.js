console.log("LaunchGrid Bridge: Content Script Loaded");

// Listen for commands from Background Worker
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    console.log("Command Received:", request);

    if (request.action === 'SCAN_FEED') {
        scanFeed(request.taskId, request.config || {});
    }
});

/**
 * Utility to wait for elements
 */
async function waitForElement(selector, timeout = 10000) {
    const start = Date.now();
    while (Date.now() - start < timeout) {
        if (document.querySelector(selector)) return true;
        await new Promise(r => setTimeout(r, 500));
    }
    return false;
}

/**
 * Auto-scroll to load more tweets, then scrape them
 */
async function autoScrollAndCollect(targetCount = 25, maxScrolls = 8) {
    const tweets = new Map();
    let scrollAttempts = 0;

    // Wait for initial load
    const contentFound = await waitForElement('article', 10000);
    if (!contentFound) {
        console.warn("[LaunchGrid] No articles found after 10s. Are you logged in?");
        return [];
    }

    let lastHeight = document.body.scrollHeight;

    while (tweets.size < targetCount && scrollAttempts < maxScrolls) {
        const articles = document.querySelectorAll('article');
        articles.forEach(article => {
            try {
                // Try multiple possible selectors as X shifts them often
                const textNode = article.querySelector('[data-testid="tweetText"]') ||
                    article.querySelector('div[dir="auto"]');
                const userNode = article.querySelector('[data-testid="User-Name"]');
                const timeNode = article.querySelector('time');

                if (textNode && userNode) {
                    const text = textNode.innerText;
                    if (!tweets.has(text) && text.length > 5) { // Basic quality check
                        tweets.set(text, {
                            text: text,
                            author: userNode.innerText.split('\n')[1] || userNode.innerText.split('\n')[0],
                            url: article.querySelector('a[href*="/status/"]')?.href || null,
                            time: timeNode ? timeNode.getAttribute('datetime') : new Date().toISOString()
                        });
                    }
                }
            } catch (e) {
                // Silently skip malformed entries
            }
        });

        console.log(`[LaunchGrid] Collected ${tweets.size}/${targetCount} tweets. Scroll ${scrollAttempts}/${maxScrolls}`);

        if (tweets.size >= targetCount) break;

        window.scrollTo(0, document.body.scrollHeight);
        await new Promise(resolve => setTimeout(resolve, 2000)); // Be gentler with X's rate limits

        const newHeight = document.body.scrollHeight;
        if (newHeight === lastHeight) {
            scrollAttempts++; // Only increment if we hit potential end of feed
        } else {
            lastHeight = newHeight;
            scrollAttempts++;
        }
    }

    window.scrollTo(0, 0);
    return Array.from(tweets.values());
}

async function scanFeed(taskId, config = {}) {
    // 1. Double check auth
    const sideNav = document.querySelector('[data-testid="SideNav_AccountSwitcher_Button"]');
    if (!sideNav) {
        // Wait 3s and try again (might just be slow)
        await new Promise(r => setTimeout(r, 3000));
        if (!document.querySelector('[data-testid="SideNav_AccountSwitcher_Button"]')) {
            chrome.runtime.sendMessage({
                type: 'TASK_RESULT',
                taskId: taskId,
                data: { error: "AUTH_REQUIRED", summary: "Please ensure you are logged into X.com" }
            });
            return;
        }
    }

    const targetCount = config.targetTweetCount || 20;
    console.log(`[LaunchGrid] Scanning feed for ${targetCount} items...`);

    // Helper to send progress
    const sendProgress = (msg) => {
        chrome.runtime.sendMessage({
            type: 'TASK_PROGRESS',
            taskId: taskId,
            progress: msg
        });
    };

    sendProgress("Checking for content...");
    const tweets = await autoScrollAndCollectWithProgress(targetCount, sendProgress);

    // 2. Redirect Fallback (Only if explicitly dry and we have keywords)
    if (tweets.length === 0 && !window.location.href.includes('/search') && config.keywords) {
        sendProgress("Feed appears empty. Retrying with direct search...");
        console.log("[LaunchGrid] Feed appears empty. Falling back to search...");
        const query = encodeURIComponent(config.keywords);
        window.location.href = `https://x.com/search?q=${query}&f=live`;
        return; // Background worker will re-trigger the task
    }

    // 3. Report Results
    sendProgress("Scan complete! Reporting results...");
    chrome.runtime.sendMessage({
        type: 'TASK_RESULT',
        taskId: taskId,
        data: {
            found_items: tweets.slice(0, 25),
            summary: `Scanned ${tweets.length} tweets from the feed.`
        }
    });
}

/**
 * Re-implementing autoScrollAndCollect but with progress reporting
 */
async function autoScrollAndCollectWithProgress(targetCount, sendProgress, maxScrolls = 25) {
    const tweets = new Map();
    let scrollAttempts = 0;
    let noNewContentCount = 0;

    const contentFound = await waitForElement('article', 10000);
    if (!contentFound) {
        sendProgress("No content found after 10s. Are you logged in?");
        return [];
    }

    let lastHeight = document.body.scrollHeight;

    while (tweets.size < targetCount && scrollAttempts < maxScrolls) {
        const articles = document.querySelectorAll('article');
        articles.forEach(article => {
            try {
                const textNode = article.querySelector('[data-testid="tweetText"]') ||
                    article.querySelector('div[dir="auto"]');
                const userNode = article.querySelector('[data-testid="User-Name"]');
                const timeNode = article.querySelector('time');

                if (textNode && userNode) {
                    const text = textNode.innerText;
                    if (!tweets.has(text) && text.length > 5) {
                        tweets.set(text, {
                            text: text,
                            author: userNode.innerText.split('\n')[1] || userNode.innerText.split('\n')[0],
                            url: article.querySelector('a[href*="/status/"]')?.href || null,
                            time: timeNode ? timeNode.getAttribute('datetime') : new Date().toISOString()
                        });
                    }
                }
            } catch (e) { }
        });

        sendProgress(`Collected ${tweets.size}/${targetCount} tweets...`);

        if (tweets.size >= targetCount) break;

        // More natural scroll: scroll down by viewport height
        window.scrollBy(0, window.innerHeight * 1.5);
        await new Promise(resolve => setTimeout(resolve, 2500));

        const newHeight = document.body.scrollHeight;
        if (newHeight === lastHeight) {
            noNewContentCount++;
            // If stuck, try wiggling up and down to trigger load events
            if (noNewContentCount >= 2) {
                window.scrollBy(0, -200);
                await new Promise(r => setTimeout(r, 500));
                window.scrollBy(0, 200);
                await new Promise(r => setTimeout(r, 1000));
            }
        } else {
            noNewContentCount = 0;
            lastHeight = newHeight;
        }
        scrollAttempts++;
    }

    window.scrollTo(0, 0);
    return Array.from(tweets.values());
}
