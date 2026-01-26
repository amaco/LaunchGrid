console.log("LaunchGrid Bridge: Content Script Loaded");

// Listen for commands from Background Worker
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    console.log("Command Received:", request);

    if (request.action === 'SCAN_FEED') {
        scanFeed(request.taskId);
    }
});

function scanFeed(taskId) {
    // Basic DOM Scraping for X.com
    // Note: Classes change often, so we rely on semantic tags like <article> where possible

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
                    author: userNode.innerText.split('\n')[0], // Extract handle/name
                    time: timeNode ? timeNode.getAttribute('datetime') : new Date().toISOString()
                });
            }
        } catch (e) {
            console.warn("Failed to parse tweet", e);
        }
    });

    console.log(`Scanned ${tweets.length} tweets.`);

    // Send data back to Extension Background
    chrome.runtime.sendMessage({
        type: 'TASK_RESULT',
        taskId: taskId,
        data: {
            found_items: tweets.slice(0, 10), // Limit to top 10
            summary: "Scanned via Browser Extension"
        }
    });
}
