/**
 * LaunchGrid Twitter/X Content Script
 * 
 * v2.5 - Stateless Page Worker
 * 
 * This script is now orchestrated by background.js for batch operations.
 * It focuses exclusively on the CURRENT PAGE, allowing background.js 
 * to handle navigations and loops without execution context loss.
 */

console.log("[LaunchGrid] Content Script Loaded - v2.5");

// ============================================
// CONFIGURATION
// ============================================

const CONFIG = {
    // Timing
    MAX_OPERATION_TIMEOUT_MS: 120000,
    SCROLL_DELAY_MS: 2000,
    ELEMENT_WAIT_TIMEOUT_MS: 15000,
    HEARTBEAT_INTERVAL_MS: 5000,

    // Limits
    MAX_SCROLL_ATTEMPTS: 30,
    NO_NEW_CONTENT_THRESHOLD: 4,
    MIN_TWEET_LENGTH: 10,
    DEFAULT_TARGET_COUNT: 25,

    // Selectors
    SELECTORS: {
        article: 'article[data-testid="tweet"]',
        articleFallback: 'article',
        tweetText: ['[data-testid="tweetText"]', 'div[lang]', 'div[dir="auto"]'],
        userName: ['[data-testid="User-Name"]', 'div[data-testid="User-Name"]'],
        time: 'time',
        statusLink: 'a[href*="/status/"]',
        authCheck: '[data-testid="SideNav_AccountSwitcher_Button"]',
        primaryColumn: '[data-testid="primaryColumn"]'
    }
};

// ============================================
// STATE
// ============================================

let currentTaskId = null;
let operationAborted = false;
let scanStartTime = null;
let heartbeatInterval = null;

// ============================================
// UTILITIES
// ============================================

function sleep(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }

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
}

function sendResult(taskId, data, isError = false) {
    if (heartbeatInterval) {
        clearInterval(heartbeatInterval);
        heartbeatInterval = null;
    }
    chrome.runtime.sendMessage({
        type: 'TASK_RESULT',
        taskId: taskId,
        data: isError ? { error: data.error, summary: data.summary } : data
    });
    currentTaskId = null;
}

function cleanReplyText(text) {
    if (!text || typeof text !== 'string') return text;
    let s = text.trim();
    for (let i = 0; i < 3; i++) {
        let changed = false;
        if (s.length >= 2) {
            const start = s.charAt(0);
            const end = s.charAt(s.length - 1);
            if ((start === '"' && end === '"') || (start === "'" && end === "'") || (start === '“' && end === '”')) {
                s = s.slice(1, -1);
                changed = true;
            }
        }
        if (!changed) break;
        s = s.trim();
    }
    s = s.replace(/^Reply by AI:\s*/i, '');
    return s;
}

async function waitForElement(selectors, timeout = CONFIG.ELEMENT_WAIT_TIMEOUT_MS) {
    const selectorArray = Array.isArray(selectors) ? selectors : [selectors];
    const start = Date.now();
    while (Date.now() - start < timeout) {
        for (const selector of selectorArray) {
            const el = document.querySelector(selector);
            if (el) return el;
        }
        await sleep(500);
    }
    return null;
}

function getTextFromSelectors(parent, selectors) {
    for (const selector of selectors) {
        const element = parent.querySelector(selector);
        if (element && element.innerText?.trim()) return element.innerText.trim();
    }
    return null;
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
// CORE ACTIONS - POSTING
// ============================================

async function performSingleReply(taskId, config) {
    const replyText = config.replyText || config.reply || config.content;
    const text = cleanReplyText(replyText);

    sendProgress(taskId, "Locating reply box...");

    const editorSelectors = [
        '[data-testid="tweetTextarea_0"]',
        'div[role="textbox"][contenteditable="true"]',
        '.public-DraftEditor-content'
    ];

    let editor = await waitForElement(editorSelectors, 8000);

    // Fallback: click reply icon
    if (!editor) {
        sendProgress(taskId, "Inline editor not found, clicking Reply icon...");
        const replyIcon = await waitForElement(['[data-testid="reply"]', 'button[aria-label*="Reply"]'], 3000);
        if (replyIcon) {
            replyIcon.click();
            await sleep(1000);
            editor = await waitForElement(editorSelectors, 5000);
        }
    }

    if (!editor) throw new Error("Could not find reply box. Page might still be loading or layout changed.");

    editor.click();
    editor.focus();
    await sleep(500);

    sendProgress(taskId, "Typing reply content...");
    document.execCommand('selectAll', false, null);
    document.execCommand('insertText', false, text);
    await sleep(500);

    // Fallback typing
    if (!editor.innerText.trim() || !editor.innerText.includes(text.substring(0, 3))) {
        const dataTransfer = new DataTransfer();
        dataTransfer.setData('text/plain', text);
        editor.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dataTransfer, bubbles: true }));
    }

    editor.dispatchEvent(new Event('input', { bubbles: true }));
    await sleep(1000);

    const replyBtn = await waitForElement(['[data-testid="tweetButtonInline"]', '[data-testid="tweetButton"]'], 3000);
    if (!replyBtn) throw new Error("Reply button not found");

    if (replyBtn.disabled || replyBtn.getAttribute('aria-disabled') === 'true') {
        await sleep(1500);
    }

    if (replyBtn.disabled || replyBtn.getAttribute('aria-disabled') === 'true') {
        throw new Error("Reply button is disabled. Text might be too long or invalid.");
    }

    sendProgress(taskId, "Submitting post...");
    replyBtn.click();

    await sleep(3000);
    return true;
}

// ============================================
// CORE ACTIONS - SCANNING
// ============================================

function extractTweetData(article) {
    try {
        const text = getTextFromSelectors(article, CONFIG.SELECTORS.tweetText);
        if (!text || text.length < CONFIG.MIN_TWEET_LENGTH) return null;

        const userNameEl = article.querySelector(CONFIG.SELECTORS.userName[0]) || article.querySelector(CONFIG.SELECTORS.userName[1]);
        let author = 'Unknown';
        if (userNameEl) {
            const parts = userNameEl.innerText.split('\n').filter(p => p.trim());
            author = parts.find(p => p.startsWith('@')) || parts[0] || 'Unknown';
        }

        const timeEl = article.querySelector(CONFIG.SELECTORS.time);
        const time = timeEl?.getAttribute('datetime') || new Date().toISOString();
        const linkEl = article.querySelector(CONFIG.SELECTORS.statusLink);
        const url = linkEl?.href || null;
        const id = `tweet_${hashCode(text + author)}`;

        return { id, text, author, url, time, scrapedAt: new Date().toISOString() };
    } catch (e) {
        return null;
    }
}

async function autoScrollAndCollect(taskId, targetCount) {
    const tweets = new Map();
    let scrollAttempts = 0;
    let noNewContentStreak = 0;
    let lastHeight = document.body.scrollHeight;

    while (tweets.size < targetCount && scrollAttempts < CONFIG.MAX_SCROLL_ATTEMPTS && !operationAborted) {
        let articles = document.querySelectorAll(CONFIG.SELECTORS.article);
        if (articles.length === 0) articles = document.querySelectorAll(CONFIG.SELECTORS.articleFallback);

        let newCount = 0;
        articles.forEach(article => {
            const tweet = extractTweetData(article);
            if (tweet && !tweets.has(tweet.id)) {
                tweets.set(tweet.id, tweet);
                newCount++;
            }
        });

        sendProgress(taskId, `Scanning... ${tweets.size}/${targetCount} tweets collected`, { collected: tweets.size });

        if (tweets.size >= targetCount) break;

        if (newCount === 0) noNewContentStreak++;
        else noNewContentStreak = 0;

        if (noNewContentStreak >= CONFIG.NO_NEW_CONTENT_THRESHOLD) break;

        window.scrollBy(0, window.innerHeight);
        await sleep(CONFIG.SCROLL_DELAY_MS);

        if (document.body.scrollHeight === lastHeight) {
            window.scrollBy(0, -100); await sleep(300); window.scrollBy(0, 150);
        }
        lastHeight = document.body.scrollHeight;
        scrollAttempts++;
    }

    return Array.from(tweets.values());
}

async function scanFeed(taskId, config) {
    const targetCount = config.targetTweetCount || CONFIG.DEFAULT_TARGET_COUNT;
    scanStartTime = Date.now();

    heartbeatInterval = setInterval(() => {
        sendProgress(taskId, 'Still scanning...', { status: 'heartbeat' });
    }, CONFIG.HEARTBEAT_INTERVAL_MS);

    try {
        const results = await autoScrollAndCollect(taskId, targetCount);
        sendResult(taskId, { found_items: results.slice(0, targetCount), summary: `Found ${results.length} tweets` });
    } catch (err) {
        sendResult(taskId, { error: 'SCAN_FAILED', summary: err.message }, true);
    } finally {
        if (heartbeatInterval) clearInterval(heartbeatInterval);
    }
}

// ============================================
// MESSAGE LISTENER
// ============================================

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    console.log("[LaunchGrid] Task received:", request.action);

    if (request.action === 'PING') {
        sendResponse({ alive: true });
        return;
    }

    // Direct action handlers
    if (request.action === 'POST_SINGLE_REPLY') {
        performSingleReply(request.taskId, request.config)
            .then(() => sendResult(request.taskId, { success: true }))
            .catch(err => sendResult(request.taskId, { error: 'POST_FAILED', summary: err.message }, true));
    }
    else if (request.action === 'SCAN_FEED') {
        scanFeed(request.taskId, request.config);
    }

    sendResponse({ received: true });
    return true;
});
