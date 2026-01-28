console.log("LaunchGrid Bridge: Content Script Loaded");

// Listen for commands from Background Worker
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    console.log("Command Received:", request);

    if (request.action === 'SCAN_FEED') {
        scanFeed(request.taskId, request.config || {});
    }
});

/**
 * Auto-scroll to load more tweets, then scrape them
 * @param {number} targetCount - How many tweets to try to collect
 * @param {number} maxScrolls - Maximum scroll attempts
 */
async function autoScrollAndCollect(targetCount = 25, maxScrolls = 5) {
    const tweets = new Map(); // Use Map to dedupe by text
    let scrollAttempts = 0;
    let lastHeight = document.body.scrollHeight;

    while (tweets.size < targetCount && scrollAttempts < maxScrolls) {
        // Scrape current articles
        const articles = document.querySelectorAll('article');
        articles.forEach(article => {
            try {
                const textNode = article.querySelector('[data-testid="tweetText"]');
                const userNode = article.querySelector('[data-testid="User-Name"]');
                const timeNode = article.querySelector('time');

                if (textNode && userNode) {
                    const text = textNode.innerText;
                    if (!tweets.has(text)) { // Dedupe
                        tweets.set(text, {
                            text: text,
                            author: userNode.innerText.split('\n')[1] || userNode.innerText.split('\n')[0],
                            time: timeNode ? timeNode.getAttribute('datetime') : new Date().toISOString()
                        });
                    }
                }
            } catch (e) {
                console.warn("Failed to parse tweet", e);
            }
        });

        console.log(`[LaunchGrid] Collected ${tweets.size} tweets, scroll attempt ${scrollAttempts + 1}/${maxScrolls}`);

        // Scroll down to load more
        window.scrollTo(0, document.body.scrollHeight);
        await new Promise(resolve => setTimeout(resolve, 1500)); // Wait for new tweets to load

        // Check if we actually scrolled (new content loaded)
        const newHeight = document.body.scrollHeight;
        if (newHeight === lastHeight) {
            console.log("[LaunchGrid] No new content loaded, stopping scroll");
            break;
        }
        lastHeight = newHeight;
        scrollAttempts++;
    }

    // Scroll back to top for good UX
    window.scrollTo(0, 0);

    return Array.from(tweets.values());
}

async function scanFeed(taskId, config = {}) {
    // 1. Check for login state
    const isLoggedOut = document.querySelector('[data-testid="loginButton"]') ||
        document.querySelector('a[href="/login"]') ||
        !document.querySelector('[data-testid="SideNav_AccountSwitcher_Button"]');

    if (isLoggedOut) {
        console.error("LaunchGrid: User is logged out.");
        chrome.runtime.sendMessage({
            type: 'TASK_RESULT',
            taskId: taskId,
            data: {
                error: "AUTH_REQUIRED",
                summary: "Please log in to X.com to allow scanning."
            }
        });
        return;
    }

    // 2. Auto-scroll and collect tweets
    const targetCount = config.targetTweetCount || 25;
    console.log(`[LaunchGrid] Starting scan, target: ${targetCount} tweets`);

    const tweets = await autoScrollAndCollect(targetCount, 5);

    // 3. Smart Search Fallback
    // If feed is dry (< 3 items) and we haven't tried searching yet
    if (tweets.length < 3 && !window.location.href.includes('/search') && config.keywords) {
        console.log("Feed is dry. Triggering smart search fallback...");
        const query = encodeURIComponent(config.keywords);
        window.location.href = `https://x.com/search?q=${query}&f=live`;
        return; // Background script will re-trigger the task once page loads
    }

    console.log(`[LaunchGrid] Scan complete. Found ${tweets.length} tweets.`);

    // 4. Report Results (cap at 20 for performance)
    chrome.runtime.sendMessage({
        type: 'TASK_RESULT',
        taskId: taskId,
        data: {
            found_items: tweets.slice(0, 20),
            summary: tweets.length > 0
                ? `Successfully scanned ${tweets.length} tweets (showing top 20).`
                : "No relevant tweets found in feed."
        }
    });
}
