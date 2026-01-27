console.log("LaunchGrid Bridge: Content Script Loaded");

// Listen for commands from Background Worker
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    console.log("Command Received:", request);

    if (request.action === 'SCAN_FEED') {
        scanFeed(request.taskId);
    }
});

function scanFeed(taskId, config = {}) {
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

    // 2. Perform Scan
    const tweets = [];
    const articles = document.querySelectorAll('article');

    articles.forEach(article => {
        try {
            const textNode = article.querySelector('[data-testid="tweetText"]');
            const userNode = article.querySelector('[data-testid="User-Name"]');
            const timeNode = article.querySelector('time');

            if (textNode && userNode) {
                tweets.push({
                    text: textNode.innerText,
                    author: userNode.innerText.split('\n')[1] || userNode.innerText.split('\n')[0], // Extract @handle
                    time: timeNode ? timeNode.getAttribute('datetime') : new Date().toISOString()
                });
            }
        } catch (e) {
            console.warn("Failed to parse tweet", e);
        }
    });

    // 3. Smart Search Fallback
    // If feed is dry (< 3 items) and we haven't tried searching yet
    if (tweets.length < 3 && !window.location.href.includes('/search') && config.keywords) {
        console.log("Feed is dry. Triggering smart search fallback...");
        const query = encodeURIComponent(config.keywords);
        window.location.href = `https://x.com/search?q=${query}&f=live`;
        return; // Background script will re-trigger the task once page loads
    }

    console.log(`Scanned ${tweets.length} tweets.`);

    // 4. Report Results
    chrome.runtime.sendMessage({
        type: 'TASK_RESULT',
        taskId: taskId,
        data: {
            found_items: tweets.slice(0, 15),
            summary: tweets.length > 0 ? `Successfully scanned ${tweets.length} tweets.` : "No relevant tweets found in feed."
        }
    });
}
