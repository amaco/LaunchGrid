/**
 * LaunchGrid Twitter/X Feed Scanner
 * 
 * Robust, resilient feed scanning with:
 * - Operation timeouts
 * - Progress heartbeats
 * - Graceful degradation
 * - End-of-feed detection
 * - Multiple selector fallbacks
 */

console.log("[LaunchGrid] Content Script Loaded - v2.2");

// ... (rest of configuration unchanged until performSingleReply)

/**
 * Core logic to post a single reply
 */
async function performSingleReply(taskId, tweetUrl, replyText) {
    sendProgress(taskId, "Navigating to tweet...", { url: tweetUrl });

    // Navigate if needed
    if (window.location.href.split('?')[0] !== tweetUrl.split('?')[0]) {
        window.location.href = tweetUrl;
        // Wait for navigation and reload
        await sleep(5000); // Increased wait time for full load
    }

    // Wait for page interaction to settle
    await sleep(2000);

    // Try to find editor
    sendProgress(taskId, "Locating reply box...");

    // Selectors for the reply input area
    const editorSelectors = [
        '[data-testid="tweetTextarea_0"]',
        'div[role="textbox"][contenteditable="true"]',
        '.public-DraftEditor-content'
    ];

    let editor = await waitForElement(editorSelectors, 5000);

    // FALLBACK: If inline editor not found, try clicking the "Reply" icon
    if (!editor) {
        sendProgress(taskId, "Inline editor not found, clicking Reply button...");
        const replyIconSelectors = [
            '[data-testid="reply"]',
            'button[aria-label*="Reply"]'
        ];
        const replyIcon = await waitForElement(replyIconSelectors, 3000);

        if (replyIcon) {
            replyIcon.click();
            await sleep(1000); // Wait for modal
            editor = await waitForElement(editorSelectors, 5000);
        }
    }

    if (!editor) {
        throw new Error('Could not find reply box. Are you logged in?');
    }

    // Focus and click
    editor.click();
    editor.focus();
    await sleep(500);

    // Type text
    sendProgress(taskId, "Typing reply...");

    // Method 1: execCommand (Legacy but reliable for rich text editors)
    document.execCommand('selectAll', false, null);
    document.execCommand('insertText', false, replyText);
    await sleep(500);

    // Method 2: Fallback direct input if empty
    if (!editor.innerText.trim()) {
        const dataTransfer = new DataTransfer();
        dataTransfer.setData('text/plain', replyText);
        editor.dispatchEvent(new ClipboardEvent('paste', {
            clipboardData: dataTransfer,
            bubbles: true,
            cancelable: true
        }));
    }

    // Ensure state updates
    editor.dispatchEvent(new Event('input', { bubbles: true }));
    editor.dispatchEvent(new Event('change', { bubbles: true }));

    await sleep(1500);

    // Find Reply button
    const buttonSelectors = [
        '[data-testid="tweetButtonInline"]',
        '[data-testid="tweetButton"]',
        'button[data-testid="tweetButton"]'
    ];

    const replyBtn = await waitForElement(buttonSelectors, 3000);

    if (!replyBtn) {
        throw new Error('Reply button not found');
    }

    // Wait a bit if disabled (sometimes takes a moment to validate text)
    if (replyBtn.disabled || replyBtn.getAttribute('aria-disabled') === 'true') {
        await sleep(2000);
    }

    if (replyBtn.disabled || replyBtn.getAttribute('aria-disabled') === 'true') {
        throw new Error('Reply button is disabled. Text might be invalid.');
    }

    sendProgress(taskId, "Clicking reply...");
    replyBtn.click();

    // Wait for success confirmation (toast or disappearance)
    await sleep(3000);

    return true;
}

// ============================================
// CONFIGURATION
// ============================================

const CONFIG = {
    // Timing
    MAX_OPERATION_TIMEOUT_MS: 120000,  // 2 minutes max for entire scan
    SCROLL_DELAY_MS: 2000,             // Time between scrolls
    ELEMENT_WAIT_TIMEOUT_MS: 15000,    // Wait for initial elements
    HEARTBEAT_INTERVAL_MS: 5000,       // Send progress every 5s

    // Limits
    MAX_SCROLL_ATTEMPTS: 30,           // Maximum scroll attempts
    NO_NEW_CONTENT_THRESHOLD: 4,       // Stop after X scrolls with no new content
    MIN_TWEET_LENGTH: 10,              // Minimum tweet text length
    DEFAULT_TARGET_COUNT: 25,          // Default tweets to collect

    // Selectors (multiple fallbacks as X changes often)
    SELECTORS: {
        article: 'article[data-testid="tweet"]',
        articleFallback: 'article',
        tweetText: [
            '[data-testid="tweetText"]',
            'div[lang]',
            'div[dir="auto"]'
        ],
        userName: [
            '[data-testid="User-Name"]',
            'div[data-testid="User-Name"]'
        ],
        time: 'time',
        statusLink: 'a[href*="/status/"]',
        authCheck: '[data-testid="SideNav_AccountSwitcher_Button"]',
        primaryColumn: '[data-testid="primaryColumn"]'
    }
};

// ============================================
// STATE MANAGEMENT
// ============================================

let currentTaskId = null;
let heartbeatInterval = null;
let operationAborted = false;
let scanStartTime = null;

// ============================================
// UTILITY FUNCTIONS
// ============================================

/**
 * Send progress to background worker
 */
function sendProgress(taskId, message, data = {}) {
    if (!taskId) return;

    chrome.runtime.sendMessage({
        type: 'TASK_PROGRESS',
        taskId: taskId,
        progress: message,
        data: {
            ...data,
            timestamp: new Date().toISOString(),
            elapsedMs: scanStartTime ? Date.now() - scanStartTime : 0
        }
    });
    console.log(`[LaunchGrid] Progress: ${message}`, data);
}

/**
 * Send final result to background worker
 */
function sendResult(taskId, data, isError = false) {
    // Stop heartbeat
    if (heartbeatInterval) {
        clearInterval(heartbeatInterval);
        heartbeatInterval = null;
    }

    chrome.runtime.sendMessage({
        type: 'TASK_RESULT',
        taskId: taskId,
        data: isError ? { error: data.error, summary: data.summary } : data
    });

    console.log(`[LaunchGrid] Result sent:`, isError ? 'ERROR' : 'SUCCESS', data);

    // Reset state
    currentTaskId = null;
    operationAborted = false;
    scanStartTime = null;
}

/**
 * Wait for element(s) to appear
 */
async function waitForElement(selectors, timeout = CONFIG.ELEMENT_WAIT_TIMEOUT_MS) {
    const selectorArray = Array.isArray(selectors) ? selectors : [selectors];
    const start = Date.now();

    while (Date.now() - start < timeout) {
        for (const selector of selectorArray) {
            const element = document.querySelector(selector);
            if (element) return element;
        }
        await sleep(500);
    }
    return null;
}

/**
 * Sleep helper
 */
function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Get text from element using multiple selector attempts
 */
function getTextFromSelectors(parent, selectors) {
    for (const selector of selectors) {
        const element = parent.querySelector(selector);
        if (element && element.innerText?.trim()) {
            return element.innerText.trim();
        }
    }
    return null;
}

/**
 * Check if user is logged in to X
 */
function isLoggedIn() {
    return !!document.querySelector(CONFIG.SELECTORS.authCheck);
}

/**
 * Smooth scroll that triggers lazy loading
 */
async function smoothScroll(distance) {
    const start = window.scrollY;
    const target = start + distance;
    const duration = 500;
    const startTime = Date.now();

    return new Promise(resolve => {
        function step() {
            const elapsed = Date.now() - startTime;
            const progress = Math.min(elapsed / duration, 1);

            // Ease out
            const easeOut = 1 - Math.pow(1 - progress, 3);
            window.scrollTo(0, start + (distance * easeOut));

            if (progress < 1) {
                requestAnimationFrame(step);
            } else {
                resolve();
            }
        }
        requestAnimationFrame(step);
    });
}

// ============================================
// TWEET EXTRACTION
// ============================================

/**
 * Extract tweet data from an article element
 */
function extractTweetData(article) {
    try {
        // Get tweet text
        const text = getTextFromSelectors(article, CONFIG.SELECTORS.tweetText);
        if (!text || text.length < CONFIG.MIN_TWEET_LENGTH) {
            return null;
        }

        // Get author
        const userNameEl = article.querySelector(CONFIG.SELECTORS.userName[0]) ||
            article.querySelector(CONFIG.SELECTORS.userName[1]);

        let author = 'Unknown';
        if (userNameEl) {
            const parts = userNameEl.innerText.split('\n').filter(p => p.trim());
            // Usually format is: DisplayName\n@handle or just @handle
            author = parts.find(p => p.startsWith('@')) || parts[0] || 'Unknown';
        }

        // Get timestamp
        const timeEl = article.querySelector(CONFIG.SELECTORS.time);
        const time = timeEl?.getAttribute('datetime') || new Date().toISOString();

        // Get tweet URL
        const linkEl = article.querySelector(CONFIG.SELECTORS.statusLink);
        const url = linkEl?.href || null;

        // Create unique ID from content hash
        const id = `tweet_${hashCode(text + author)}`;

        return {
            id,
            text,
            author,
            url,
            time,
            scrapedAt: new Date().toISOString()
        };
    } catch (e) {
        console.warn('[LaunchGrid] Failed to extract tweet:', e);
        return null;
    }
}

/**
 * Simple hash function for creating IDs
 */
function hashCode(str) {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
        const char = str.charCodeAt(i);
        hash = ((hash << 5) - hash) + char;
        hash = hash & hash;
    }
    return Math.abs(hash).toString(36);
}

// ============================================
// MAIN SCANNING LOGIC
// ============================================

/**
 * Collect tweets from currently visible articles
 */
function collectVisibleTweets(existingTweets) {
    const tweets = new Map(existingTweets);

    // Try specific selector first, then fallback
    let articles = document.querySelectorAll(CONFIG.SELECTORS.article);
    if (articles.length === 0) {
        articles = document.querySelectorAll(CONFIG.SELECTORS.articleFallback);
    }

    let newCount = 0;
    articles.forEach(article => {
        const tweet = extractTweetData(article);
        if (tweet && !tweets.has(tweet.id)) {
            tweets.set(tweet.id, tweet);
            newCount++;
        }
    });

    return { tweets, newCount };
}

/**
 * Main auto-scroll and collect function with progress reporting
 */
async function autoScrollAndCollect(taskId, targetCount, sendProgressFn) {
    const tweets = new Map();
    let scrollAttempts = 0;
    let noNewContentStreak = 0;
    let lastHeight = document.body.scrollHeight;

    // Wait for initial content
    sendProgressFn(taskId, "Waiting for feed content...");
    const initialContent = await waitForElement([
        CONFIG.SELECTORS.article,
        CONFIG.SELECTORS.articleFallback
    ]);

    if (!initialContent) {
        sendProgressFn(taskId, "No content found - check if you're on the feed page");
        return { tweets: [], endReason: 'NO_CONTENT_FOUND' };
    }

    sendProgressFn(taskId, "Feed content detected, starting scan...");

    while (
        tweets.size < targetCount &&
        scrollAttempts < CONFIG.MAX_SCROLL_ATTEMPTS &&
        !operationAborted
    ) {
        // Collect current visible tweets
        const { tweets: updatedTweets, newCount } = collectVisibleTweets(tweets);

        // Update our collection
        for (const [id, tweet] of updatedTweets) {
            tweets.set(id, tweet);
        }

        // Report progress
        sendProgressFn(
            taskId,
            `Scanning... ${tweets.size}/${targetCount} tweets collected`,
            { collected: tweets.size, target: targetCount, scrolls: scrollAttempts }
        );

        // Check if we've reached target
        if (tweets.size >= targetCount) {
            break;
        }

        // Track if we're getting new content
        if (newCount === 0) {
            noNewContentStreak++;
        } else {
            noNewContentStreak = 0;
        }

        // If no new content for several scrolls, we might be at end of feed
        if (noNewContentStreak >= CONFIG.NO_NEW_CONTENT_THRESHOLD) {
            sendProgressFn(taskId, `End of available content reached (${tweets.size} tweets found)`);
            break;
        }

        // Scroll down
        await smoothScroll(window.innerHeight * 1.2);
        await sleep(CONFIG.SCROLL_DELAY_MS);

        // Check if page height changed (new content loaded)
        const newHeight = document.body.scrollHeight;
        if (newHeight === lastHeight) {
            // Try wiggle scroll to trigger lazy loading
            window.scrollBy(0, -100);
            await sleep(300);
            window.scrollBy(0, 150);
            await sleep(500);
        }
        lastHeight = newHeight;

        scrollAttempts++;
    }

    // Scroll back to top
    window.scrollTo({ top: 0, behavior: 'smooth' });

    // Determine end reason
    let endReason = 'TARGET_REACHED';
    if (operationAborted) {
        endReason = 'ABORTED';
    } else if (noNewContentStreak >= CONFIG.NO_NEW_CONTENT_THRESHOLD) {
        endReason = 'END_OF_FEED';
    } else if (scrollAttempts >= CONFIG.MAX_SCROLL_ATTEMPTS) {
        endReason = 'MAX_SCROLLS_REACHED';
    }

    return {
        tweets: Array.from(tweets.values()),
        endReason,
        scrollAttempts,
        noNewContentStreak
    };
}

// ============================================
// MAIN SCAN ENTRY POINT
// ============================================

/**
 * Main scan function called from message listener
 */
async function scanFeed(taskId, config = {}) {
    // Prevent concurrent scans
    if (currentTaskId) {
        console.warn('[LaunchGrid] Scan already in progress, ignoring new request');
        return;
    }

    currentTaskId = taskId;
    scanStartTime = Date.now();
    operationAborted = false;

    // Set up operation timeout
    const timeoutId = setTimeout(() => {
        console.warn('[LaunchGrid] Operation timeout reached');
        operationAborted = true;
        sendResult(taskId, {
            error: 'TIMEOUT',
            summary: 'Scan timed out after 2 minutes. Please try again.'
        }, true);
    }, CONFIG.MAX_OPERATION_TIMEOUT_MS);

    // Set up heartbeat
    heartbeatInterval = setInterval(() => {
        if (currentTaskId) {
            sendProgress(currentTaskId, 'Still scanning...', {
                status: 'heartbeat',
                elapsedSeconds: Math.floor((Date.now() - scanStartTime) / 1000)
            });
        }
    }, CONFIG.HEARTBEAT_INTERVAL_MS);

    try {
        // 1. Check authentication
        sendProgress(taskId, "Checking X authentication...");

        // Give X a moment to fully render
        await sleep(1500);

        if (!isLoggedIn()) {
            // Wait a bit more and retry
            await sleep(2000);
            if (!isLoggedIn()) {
                clearTimeout(timeoutId);
                sendResult(taskId, {
                    error: 'AUTH_REQUIRED',
                    summary: 'Please log into X.com and try again. Make sure you can see your home feed.'
                }, true);
                return;
            }
        }

        sendProgress(taskId, "Authentication verified ✓");

        // 2. Check we're on a valid page
        const onFeedPage = window.location.hostname.includes('x.com') ||
            window.location.hostname.includes('twitter.com');

        if (!onFeedPage) {
            clearTimeout(timeoutId);
            sendResult(taskId, {
                error: 'WRONG_PAGE',
                summary: 'Please navigate to x.com and try again.'
            }, true);
            return;
        }

        // 3. Navigate to home if not already there
        const isHomeFeed = window.location.pathname === '/home' ||
            window.location.pathname === '/' ||
            window.location.pathname.startsWith('/home');

        if (!isHomeFeed) {
            sendProgress(taskId, "Navigating to home feed...");
            window.location.href = 'https://x.com/home';
            // Don't send result - background will re-trigger after navigation
            clearTimeout(timeoutId);
            if (heartbeatInterval) clearInterval(heartbeatInterval);
            return;
        }

        // 4. Start scanning
        const targetCount = config.targetTweetCount || CONFIG.DEFAULT_TARGET_COUNT;
        sendProgress(taskId, `Starting scan for ${targetCount} tweets...`);

        const result = await autoScrollAndCollect(taskId, targetCount, sendProgress);

        // 5. Clear timeout and send results
        clearTimeout(timeoutId);

        if (operationAborted) {
            // Already handled in timeout callback
            return;
        }

        const elapsedSeconds = Math.floor((Date.now() - scanStartTime) / 1000);

        if (result.tweets.length === 0) {
            sendResult(taskId, {
                error: 'NO_TWEETS_FOUND',
                summary: `No tweets found after scanning. The feed may be empty or X has changed their layout. Try refreshing the page.`,
                debug: {
                    endReason: result.endReason,
                    scrollAttempts: result.scrollAttempts,
                    elapsedSeconds
                }
            }, true);
        } else {
            sendResult(taskId, {
                found_items: result.tweets.slice(0, targetCount),
                summary: `Successfully scanned ${result.tweets.length} tweets in ${elapsedSeconds}s`,
                scan_info: {
                    total_found: result.tweets.length,
                    returned: Math.min(result.tweets.length, targetCount),
                    end_reason: result.endReason,
                    scroll_attempts: result.scrollAttempts,
                    duration_seconds: elapsedSeconds
                }
            });
        }

    } catch (error) {
        console.error('[LaunchGrid] Scan error:', error);
        clearTimeout(timeoutId);

        sendResult(taskId, {
            error: 'SCAN_ERROR',
            summary: `Scan failed: ${error.message}. Please refresh the page and try again.`,
            debug: { errorMessage: error.message, stack: error.stack }
        }, true);
    }
}

// ============================================
// MESSAGE LISTENER
// ============================================

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    console.log("[LaunchGrid] Message received:", request);

    if (request.action === 'SCAN_FEED') {
        // Acknowledge receipt immediately
        sendResponse({ received: true, status: 'starting' });

        // Start scan asynchronously
        scanFeed(request.taskId, request.config || {});

        // Return true to indicate we'll send async response via sendMessage
        return true;
    }

    if (request.action === 'POST_REPLY' || request.action === 'POST_EXTENSION') {
        sendResponse({ received: true, status: 'starting' });
        postReply(request.taskId, request.config || {});
        return true;
    }

    if (request.action === 'PING') {
        // Health check
        sendResponse({
            alive: true,
            scanning: !!currentTaskId,
            currentTask: currentTaskId
        });
        return true;
    }

    if (request.action === 'ABORT') {
        // Abort current scan
        if (currentTaskId) {
            operationAborted = true;
            sendResponse({ aborted: true, taskId: currentTaskId });
        } else {
            sendResponse({ aborted: false, reason: 'no_active_scan' });
        }
        return true;
    }

    // Unknown action
    sendResponse({ error: 'Unknown action', received: request.action });
    return false;
});

// ============================================
// INITIALIZATION
// ============================================

// Log that we're ready
console.log("[LaunchGrid] Content script initialized and ready");

// Clean up on page unload
window.addEventListener('beforeunload', () => {
    if (currentTaskId) {
        operationAborted = true;
        if (heartbeatInterval) {
            clearInterval(heartbeatInterval);
        }
    }
});

/**
 * Post a reply to a tweet
 */
/**
 * Post a reply to a tweet
 */
async function postReply(taskId, config) {
    // Prevent concurrent operations
    if (currentTaskId) {
        console.warn('[LaunchGrid] Operation already in progress');
        return;
    }

    currentTaskId = taskId;
    scanStartTime = Date.now();
    operationAborted = false;

    // Timeout safety (longer for batch operations)
    const timeoutDuration = (config.replies && config.replies.length > 1) ? 300000 : 60000;
    const timeoutId = setTimeout(() => {
        sendResult(taskId, { error: 'TIMEOUT', summary: 'Reply operation timed out.' }, true);
    }, timeoutDuration);

    try {
        const replies = config.replies || [config];
        const results = [];
        let successCount = 0;

        for (let i = 0; i < replies.length; i++) {
            if (operationAborted) break;

            const item = replies[i];
            const targetUrl = item.targetUrl || item.url;
            const replyText = item.replyText || item.reply || item.content; // Fallbacks

            if (!targetUrl || !replyText) {
                console.warn('Skipping item missing url or text:', item);
                results.push({ success: false, error: 'Missing URL or text' });
                continue;
            }

            if (replies.length > 1) {
                sendProgress(taskId, `Posting reply ${i + 1}/${replies.length}...`, { current: i + 1, total: replies.length });
            }

            try {
                await performSingleReply(taskId, targetUrl, replyText);
                results.push({ success: true, url: targetUrl });
                successCount++;

                // Random delay between posts to look natural
                if (i < replies.length - 1) {
                    const delay = 5000 + Math.random() * 3000;
                    sendProgress(taskId, `Waiting ${Math.floor(delay / 1000)}s before next reply...`);
                    await sleep(delay);
                }
            } catch (err) {
                console.error('Failed to post single reply:', err);
                results.push({ success: false, url: targetUrl, error: err.message });
            }
        }

        clearTimeout(timeoutId);

        if (successCount === 0 && replies.length > 0) {
            throw new Error('All reply attempts failed.');
        }

        sendResult(taskId, {
            success: true,
            summary: `Successfully posted ${successCount}/${replies.length} replies.`,
            results
        });

    } catch (error) {
        console.error('[LaunchGrid] Post error:', error);
        clearTimeout(timeoutId);
        sendResult(taskId, {
            error: 'POST_FAILED',
            summary: `Failed to post replies: ${error.message}`
        }, true);
    }
}

/**
 * Core logic to post a single reply
 */
async function performSingleReply(taskId, tweetUrl, replyText) {
    sendProgress(taskId, "Navigating to tweet...", { url: tweetUrl });

    // Navigate if needed
    if (window.location.href.split('?')[0] !== tweetUrl.split('?')[0]) {
        window.location.href = tweetUrl;
        // Wait for navigation and reload
        await sleep(3000);
    }

    // Wait for editor
    sendProgress(taskId, "Locating reply box...");

    // Selectors for the reply input area
    const editorSelectors = [
        '[data-testid="tweetTextarea_0"]',
        'div[role="textbox"][contenteditable="true"]'
    ];

    const editor = await waitForElement(editorSelectors);

    if (!editor) {
        throw new Error('Could not find reply box. Are you logged in?');
    }

    // Focus and click
    editor.click();
    editor.focus();
    await sleep(500);

    // Type text (simulation)
    sendProgress(taskId, "Typing reply...");

    // Clear existing text if any (rare but safe)
    document.execCommand('selectAll', false, null);
    document.execCommand('insertText', false, replyText);

    // Verify text was entered
    await sleep(1000);
    if (editor.innerText.trim() === '') {
        // Fallback: try different input method
        editor.innerText = replyText;
        editor.dispatchEvent(new Event('input', { bubbles: true }));
    }

    await sleep(1000);

    // Find Reply button
    const buttonSelectors = [
        '[data-testid="tweetButtonInline"]',
        '[data-testid="tweetButton"]'
    ];

    const replyBtn = await waitForElement(buttonSelectors, 5000);

    if (!replyBtn) {
        throw new Error('Reply button not found');
    }

    if (replyBtn.disabled || replyBtn.getAttribute('aria-disabled') === 'true') {
        throw new Error('Reply button is disabled. Text might be too long or invalid.');
    }

    sendProgress(taskId, "Clicking reply...");
    replyBtn.click();

    // Wait for success confirmation (toast or disappearance)
    await sleep(2000);

    // Additional wait to ensure post is processed
    return true;
}
