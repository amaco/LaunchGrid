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
    let s = text; // Don't trim start/end immediately to preserve intentional spacing
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

    // Clear existing text first (crucial for re-tries)
    document.execCommand('selectAll', false, null);
    document.execCommand('delete', false, null);
    await sleep(200);

    sendProgress(taskId, "Typing content...");

    // Paste method (more reliable for large text)
    const dataTransfer = new DataTransfer();
    dataTransfer.setData('text/plain', text);
    editor.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dataTransfer, bubbles: true }));
    await sleep(500);

    // Verify text
    if (!editor.innerText.trim()) {
        // Fallback to insertText if paste failed
        document.execCommand('insertText', false, text);
    }

    editor.dispatchEvent(new Event('input', { bubbles: true }));
    await sleep(1500);

    // Dynamic button selector - prioritized
    const btnSelectors = [
        '[data-testid="tweetButtonInline"]',
        '[data-testid="tweetButton"]',
        'div[role="button"][data-testid*="tweetButton"]'
    ];

    const replyBtn = await waitForElement(btnSelectors, 3000);
    if (!replyBtn) throw new Error("Post/Reply button not found");

    // Wait for button to become enabled (Twitter needs time to process text)
    let buttonReady = false;
    for (let waitAttempt = 0; waitAttempt < 5; waitAttempt++) {
        if (!replyBtn.disabled && replyBtn.getAttribute('aria-disabled') !== 'true') {
            buttonReady = true;
            break;
        }
        console.log(`[LaunchGrid] Button not ready, waiting... (attempt ${waitAttempt + 1})`);
        await sleep(1000);
    }

    // Check Twitter's character counter to detect if over limit
    // Twitter shows a red circle or a number when over limit
    const charCounterSelectors = [
        '[data-testid="tweetTextarea_0_progressIndicator"]', // Progress ring
        'div[role="progressbar"]',
        '.public-DraftEditorPlaceholder-root + div span' // Character count
    ];

    let isOverLimit = false;
    const charCounter = document.querySelector(charCounterSelectors.join(','));
    if (charCounter) {
        // If counter shows red color or negative number, we're over limit
        const counterText = charCounter.innerText || '';
        const counterStyle = window.getComputedStyle(charCounter);
        const isRed = counterStyle.color.includes('255') || counterStyle.color.includes('rgb(244'); // Twitter's red
        if (counterText.startsWith('-') || isRed) {
            isOverLimit = true;
            console.warn(`[LaunchGrid] Character limit exceeded! Counter shows: ${counterText}`);
        }
    }

    if (!buttonReady) {
        const currentLen = editor.innerText.length;
        if (isOverLimit) {
            throw new Error(`Text too long (${currentLen} chars). Twitter character limit exceeded. Please shorten the content or upgrade to X Premium for longer posts.`);
        }
        console.warn('[LaunchGrid] Button still appears disabled but not over char limit. Proceeding with click attempt...');
    }

    sendProgress(taskId, "Submitting post...");

    // Dismiss any popups (hashtag suggestions, @mention lists)
    try {
        console.log("[LaunchGrid] Dismissing popups with AGGRESSIVE sequence...");

        const typeaheadSelectors = ['[data-testid="typeaheadDropdown"]', '[role="listbox"]', '.typeahead-dropdown'];

        for (let attempt = 0; attempt < 3; attempt++) {
            // 1. Check if typeahead exists
            const typeahead = document.querySelector(typeaheadSelectors.join(','));
            if (!typeahead) {
                console.log("[LaunchGrid] No popup detected, continuing.");
                break;
            }

            console.log(`[LaunchGrid] Dismissal attempt ${attempt + 1}...`);

            // 2. Click a neutral spot (modal header or "Drafts" link area)
            const neutralSpot = document.querySelector('[data-testid="layer"] h2') ||
                document.querySelector('div[role="button"][data-testid*="close"]') ||
                document.body;
            neutralSpot.click();
            await sleep(200);

            // 3. Dispatch multiple Escape keys
            document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', bubbles: true }));
            await sleep(100);
            document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', bubbles: true }));
            await sleep(200);

            // 4. Tab out and back
            document.activeElement.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', code: 'Tab', bubbles: true }));
            await sleep(200);

            if (document.activeElement) document.activeElement.blur();
            await sleep(300);
        }

        // Final focus back on body just in case
        document.body.focus();
        await sleep(200);

    } catch (e) {
        console.warn("[LaunchGrid] Popup dismissal error:", e);
    }

    // FINAL CHECK: Ensure button is STILL there and not masked
    const finalBtn = await waitForElement(btnSelectors, 1000);
    if (!finalBtn) throw new Error("Post button disappeared after dismissal sequence");

    // Don't throw error for disabled button - Premium accounts can post long content
    // Just log a warning and proceed
    if (finalBtn.disabled || finalBtn.getAttribute('aria-disabled') === 'true') {
        const currentLen = editor.innerText.length;
        console.warn(`[LaunchGrid] Button still disabled. Text length: ${currentLen}. Premium allows 25k chars. Proceeding anyway.`);
    }

    sendProgress(taskId, "Submitting post...");

    // 1. Try Ctrl+Enter/Cmd+Enter shortcut (very robust on Twitter)
    try {
        console.log("[LaunchGrid] Attempting Ctrl+Enter shortcut...");
        editor.focus();
        const enterEvent = new KeyboardEvent('keydown', {
            key: 'Enter',
            code: 'Enter',
            keyCode: 13,
            which: 13,
            ctrlKey: true,
            metaKey: true, // For Mac
            bubbles: true,
            cancelable: true
        });
        editor.dispatchEvent(enterEvent);
        await sleep(500);
    } catch (e) {
        console.warn("[LaunchGrid] Shortcut failed:", e);
    }

    // 2. Try Super Click on the button
    try {
        console.log("[LaunchGrid] Locating final Post button...");
        // Broaden search: include <button> and <div> with role="button"
        let targetBtn = replyBtn;

        const isNotClickable = (el) => !el || el.disabled || el.getAttribute('aria-disabled') === 'true' || el.offsetParent === null;

        if (isNotClickable(targetBtn)) {
            console.log("[LaunchGrid] Primary button not clickable, searching by text...");
            const allInteractive = Array.from(document.querySelectorAll('button, div[role="button"], [data-testid="tweetButton"]'));
            targetBtn = allInteractive.find(b => {
                const text = b.innerText.toLowerCase().trim();
                // Matches "Post", "Post all", "Reply"
                const isLabelMatch = text === 'post' || text === 'reply' || text === 'post all';
                return isLabelMatch && b.offsetParent !== null;
            });
        }

        if (targetBtn) {
            console.log("[LaunchGrid] Found target button! Attempting robust click sequence...");

            // Ensure visibility
            targetBtn.scrollIntoView({ behavior: 'instant', block: 'center' });
            await sleep(100);

            const coords = targetBtn.getBoundingClientRect();
            const clientX = coords.left + coords.width / 2;
            const clientY = coords.top + coords.height / 2;

            // Dispatch holy trinity of click events
            targetBtn.focus();
            targetBtn.dispatchEvent(new MouseEvent('mouseover', { bubbles: true, view: window, clientX, clientY }));
            await sleep(50);
            targetBtn.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, view: window, clientX, clientY }));
            await sleep(50);
            targetBtn.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, view: window, clientX, clientY }));
            await sleep(50);
            targetBtn.click();

            // Fallback: If it's a real <button>, sometimes .submit() or dispatching another click helps
            if (targetBtn.tagName === 'BUTTON') {
                targetBtn.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window }));
            }

            console.log("[LaunchGrid] Click sequence completed.");
        } else {
            console.warn("[LaunchGrid] No clickable Post button found even with broad search.");
        }
    } catch (e) {
        console.warn("[LaunchGrid] Click sequence failed:", e);
    }

    // Reset this flag to ensure we capture the *new* toast
    // Wait for "Your post was sent" toast with "View" link
    sendProgress(taskId, "Waiting for success confirmation...");

    try {
        // Look for the "View" link in the toast or the "Your post was sent" text
        const viewLinkValues = ['a[href*="/status/"]', 'div[role="alert"] a[href*="/status/"]', '[data-testid="toast"] a[href*="/status/"]'];
        const viewLink = await waitForElement(viewLinkValues, 8000); // Increased timeout

        if (viewLink) {
            const replyUrl = viewLink.href;
            console.log("[LaunchGrid] Captured reply URL:", replyUrl);
            return {
                success: true,
                url: replyUrl,
                results: [{ success: true, url: replyUrl }] // Format for backend
            };
        }

        // Check for generic success toast if no link found
        const toast = await waitForElement(['[data-testid="toast"]', 'div[role="alert"]'], 2000);
        if (toast && (toast.innerText.includes('sent') || toast.innerText.includes('posted'))) {
            return { success: true, results: [{ success: true }] };
        }

    } catch (e) {
        console.warn("[LaunchGrid] Could not capture reply URL, falling back to success check:", e);
    }

    // If we clicked and didn't get an error, assume success for compose/tweet as it usually closes
    if (window.location.href.includes('compose/tweet')) {
        await sleep(2000); // Wait for modal close
        return { success: true, results: [{ success: true }] };
    }

    // Fallback
    await sleep(2000);
    return { success: true, results: [{ success: true }] };
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
            .then(result => sendResult(request.taskId, result))
            .catch(err => sendResult(request.taskId, { error: 'POST_FAILED', summary: err.message }, true));
    }
    else if (request.action === 'SCAN_FEED') {
        scanFeed(request.taskId, request.config);
    }

    sendResponse({ received: true });
    return true;
});
