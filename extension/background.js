/**
 * LaunchGrid Background Service Worker
 * 
 * Robust task polling and execution with:
 * - Reliable alarm-based polling
 * - Content script injection verification
 * - Timeout handling for extension tasks
 * - Retry logic with exponential backoff
 * - Proper error reporting
 * - PERSISTENT BATCHING for social posting
 */

console.log("[LaunchGrid] Background Service Worker Started - v2.5");

// ============================================
// CONFIGURATION
// ============================================

const CONFIG = {
    // API
    API_URL: 'http://localhost:3000/api/v1/extension',
    API_KEY: 'ext_secure_88a92b3c7d',

    // Polling
    POLL_INTERVAL_MINUTES: 0.5,  // 30 seconds

    // Timeouts
    TASK_EXECUTION_TIMEOUT_MS: 300000,  // 5 minutes (increased for batch)
    TAB_LOAD_TIMEOUT_MS: 30000,         // 30 seconds for tab to load
    CONTENT_SCRIPT_READY_TIMEOUT_MS: 15000,  // 15 seconds for script to respond

    // Retry
    MAX_RETRIES: 3,
    RETRY_DELAY_MS: 2000,

    // Platform URLs
    PLATFORM_URLS: {
        twitter: ['*://x.com/*', '*://twitter.com/*'],
        linkedin: ['*://linkedin.com/*']
    }
};

// ============================================
// STATE
// ============================================

let activeTaskId = null;
let activeTaskType = null;
let taskTimeoutId = null;
let currentBatchPromise = null; // For resolving sub-tasks

// ============================================
// UTILITY FUNCTIONS
// ============================================

/**
 * Sleep helper
 */
function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Inject content script if not already present
 */
async function ensureContentScriptInjected(tabId) {
    try {
        // Try to ping the content script
        const response = await chrome.tabs.sendMessage(tabId, { action: 'PING' }).catch(() => null);
        if (response?.alive) {
            console.log(`[LaunchGrid] Content script already active on tab ${tabId}`);
            return true;
        }
    } catch (e) {
        // Content script not present, inject it
    }

    try {
        await chrome.scripting.executeScript({
            target: { tabId },
            files: ['content-scripts/twitter.js']
        });

        // Wait a moment for script to initialize
        await sleep(1000);

        // Verify injection
        const response = await chrome.tabs.sendMessage(tabId, { action: 'PING' }).catch(() => null);
        return response?.alive === true;
    } catch (e) {
        console.error(`[LaunchGrid] Failed to inject content script:`, e);
        return false;
    }
}

/**
 * Wait for tab to fully load
 */
async function waitForTabLoad(tabId, timeout = CONFIG.TAB_LOAD_TIMEOUT_MS) {
    return new Promise((resolve, reject) => {
        const startTime = Date.now();

        const checkStatus = async () => {
            if (Date.now() - startTime > timeout) {
                reject(new Error('Tab load timeout'));
                return;
            }

            try {
                const tab = await chrome.tabs.get(tabId);
                if (tab.status === 'complete') {
                    resolve(tab);
                } else {
                    setTimeout(checkStatus, 500);
                }
            } catch (e) {
                reject(e);
            }
        };

        checkStatus();
    });
}

// ============================================
// API COMMUNICATION
// ============================================

/**
 * Report progress to API
 */
async function reportProgress(taskId, progress, data = {}) {
    if (!taskId) return;

    try {
        const response = await fetch(`${CONFIG.API_URL}/tasks`, {
            method: 'PATCH',
            headers: {
                'Content-Type': 'application/json',
                'X-API-Key': CONFIG.API_KEY
            },
            body: JSON.stringify({
                taskId,
                progress,
                data: {
                    ...data,
                    timestamp: new Date().toISOString()
                }
            })
        });

        if (!response.ok) {
            console.warn(`[LaunchGrid] Failed to report progress:`, await response.text());
        }
    } catch (e) {
        console.warn("[LaunchGrid] Failed to report progress:", e);
    }
}

/**
 * Report final result to API
 */
async function reportResult(taskId, resultData, retryCount = 0) {
    if (!taskId) return;

    try {
        const response = await fetch(`${CONFIG.API_URL}/tasks`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-API-Key': CONFIG.API_KEY
            },
            body: JSON.stringify({
                taskId,
                result: {
                    success: !resultData.error,
                    data: resultData
                }
            })
        });

        if (!response.ok) {
            throw new Error(`API returned ${response.status}: ${await response.text()}`);
        }

        console.log(`[LaunchGrid] Result reported for task ${taskId}:`, resultData.error ? 'FAILED' : 'SUCCESS');
    } catch (e) {
        console.error("[LaunchGrid] Failed to report result:", e);

        // Retry with exponential backoff
        if (retryCount < CONFIG.MAX_RETRIES) {
            const delay = CONFIG.RETRY_DELAY_MS * Math.pow(2, retryCount);
            console.log(`[LaunchGrid] Retrying result report in ${delay}ms...`);
            await sleep(delay);
            return reportResult(taskId, resultData, retryCount + 1);
        }
    }
}

/**
 * Clear active task state
 */
function clearActiveTask() {
    if (taskTimeoutId) {
        clearTimeout(taskTimeoutId);
        taskTimeoutId = null;
    }
    activeTaskId = null;
    currentBatchPromise = null;
}

// ============================================
// BATCH EXECUTION ENGINE
// ============================================

/**
 * Orchestrate a batch of replies across multiple URLs
 */
async function handleBatchReplies(taskId, config) {
    const replies = config.replies || [config];
    const results = [];
    let successCount = 0;

    console.log(`[LaunchGrid] Starting batch of ${replies.length} replies...`);

    for (let i = 0; i < replies.length; i++) {
        const item = replies[i];
        const targetUrl = item.targetUrl || item.url;
        const replyText = item.replyText || item.reply || item.content;

        if (!targetUrl || !replyText) {
            results.push({ success: false, error: 'Missing URL or text' });
            continue;
        }

        await reportProgress(taskId, `Advancing to tweet ${i + 1}/${replies.length}...`, { current: i + 1, total: replies.length });

        try {
            // 1. Find matching tab or create one
            let tabs = await chrome.tabs.query({ url: CONFIG.PLATFORM_URLS.twitter });
            let targetTab = tabs[0];

            if (!targetTab) {
                targetTab = await chrome.tabs.create({ url: targetUrl, active: true });
            } else {
                await chrome.tabs.update(targetTab.id, { url: targetUrl, active: true });
            }

            // 2. Wait for load
            await waitForTabLoad(targetTab.id);
            await sleep(2000); // Settle time

            // 3. Inject and Ping
            const ready = await ensureContentScriptInjected(targetTab.id);
            if (!ready) throw new Error("Could not initialize page script");

            // 4. Execute single reply and WAIT for result message
            await reportProgress(taskId, `Posting reply ${i + 1}/${replies.length}...`);

            const postResult = await new Promise((resolve, reject) => {
                // Set a timeout for this specific post
                const subTimeout = setTimeout(() => {
                    chrome.runtime.onMessage.removeListener(listener);
                    reject(new Error("Timeout waiting for post confirmation"));
                }, 45000);

                const listener = (request, sender) => {
                    if (request.type === 'TASK_RESULT' && request.taskId === taskId && sender.tab?.id === targetTab.id) {
                        clearTimeout(subTimeout);
                        chrome.runtime.onMessage.removeListener(listener);
                        resolve(request.data);
                    }
                };
                chrome.runtime.onMessage.addListener(listener);

                // Send the command
                chrome.tabs.sendMessage(targetTab.id, {
                    action: 'POST_SINGLE_REPLY',
                    taskId: taskId,
                    config: { targetUrl, replyText }
                }).catch(err => {
                    chrome.runtime.onMessage.removeListener(listener);
                    clearTimeout(subTimeout);
                    reject(err);
                });
            });

            if (postResult.error) {
                throw new Error(postResult.summary || postResult.error);
            }

            results.push({ success: true, url: targetUrl });
            successCount++;

            // Natural delay between tweets
            if (i < replies.length - 1) {
                const delay = 3000 + Math.random() * 2000;
                await reportProgress(taskId, `Waiting ${Math.floor(delay / 1000)}s before next...`);
                await sleep(delay);
            }

        } catch (err) {
            console.error(`[LaunchGrid] Sub-task failed:`, err);
            results.push({ success: false, url: targetUrl, error: err.message });
            await reportProgress(taskId, `Failed tweet ${i + 1}: ${err.message}`);
        }
    }

    // Final Report
    await reportResult(taskId, {
        success: successCount > 0,
        summary: `Successfully posted ${successCount}/${replies.length} replies.`,
        results
    });

    clearActiveTask();
}

// ============================================
// TASK EXECUTION
// ============================================

/**
 * Execute a task received from the API
 */
async function executeTask(task) {
    if (!task || !task.taskId) return;
    if (activeTaskId) return;

    const { taskId, type: taskType, platform = 'twitter', config = {} } = task;
    console.log(`[LaunchGrid] Executing task: ${taskId} (${taskType})`);

    activeTaskId = taskId;
    activeTaskType = taskType;

    // Global Timeout
    taskTimeoutId = setTimeout(async () => {
        if (activeTaskId === taskId) {
            await reportResult(taskId, { error: 'TIMEOUT', summary: 'The task timed out in the background.' });
            clearActiveTask();
        }
    }, CONFIG.TASK_EXECUTION_TIMEOUT_MS);

    // SPECIAL CASE: Batch Replies
    if (taskType === 'POST_REPLY' || taskType === 'POST_EXTENSION') {
        handleBatchReplies(taskId, config);
        return; // handleBatchReplies manages its own completion/reporting
    }

    // STANDARD CASE: Single page tasks (SCAN_FEED, etc)
    try {
        const patterns = CONFIG.PLATFORM_URLS[platform] || CONFIG.PLATFORM_URLS.twitter;
        let tabs = await chrome.tabs.query({ url: patterns });
        let targetTab = tabs[0];

        if (!targetTab) {
            const url = config.url || config.targetUrl || 'https://x.com/home';
            targetTab = await chrome.tabs.create({ url, active: true });
            await waitForTabLoad(targetTab.id);
            await sleep(3000);
        } else {
            // RELOAD/REDIRECT LOGIC for SCAN_FEED
            // User requested explicit refresh to ensure we start from top
            if (taskType === 'SCAN_FEED') {
                const feedUrl = config.url || config.targetUrl || 'https://x.com/home';

                if (!targetTab.url.includes('/home')) {
                    console.log(`[LaunchGrid] Redirecting tab ${targetTab.id} to ${feedUrl}...`);
                    await chrome.tabs.update(targetTab.id, { url: feedUrl, active: true });
                } else {
                    console.log(`[LaunchGrid] Refreshing tab ${targetTab.id} to reset scroll/feed...`);
                    await chrome.tabs.update(targetTab.id, { active: true });
                    await chrome.tabs.reload(targetTab.id);
                }

                await waitForTabLoad(targetTab.id);
                await sleep(3000); // Wait for feed to render
            } else {
                // For other tasks, just focus the existing tab
                await chrome.tabs.update(targetTab.id, { active: true });
            }
        }

        const scriptReady = await ensureContentScriptInjected(targetTab.id);
        if (!scriptReady) throw new Error('Content script failed to initialize');

        chrome.tabs.sendMessage(targetTab.id, {
            action: taskType,
            config: config,
            taskId: taskId
        });

    } catch (error) {
        await reportResult(taskId, { error: 'EXECUTION_ERROR', summary: error.message });
        clearActiveTask();
    }
}

// ============================================
// TASK POLLING
// ============================================

async function checkTasks() {
    if (activeTaskId) return;
    try {
        const response = await fetch(`${CONFIG.API_URL}/tasks`, {
            method: 'GET',
            headers: {
                'X-API-Key': CONFIG.API_KEY,
                'Content-Type': 'application/json'
            }
        });
        if (response.ok) {
            const data = await response.json();
            if (data.task) executeTask(data.task);
        }
    } catch (err) { }
}

// ============================================
// MESSAGE HANDLING
// ============================================

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    // Only handle progress here. Results for BATCH items are handled inside the loop.
    // However, non-batch results should still be handled here to close the loop.

    if (request.type === 'TASK_PROGRESS') {
        reportProgress(request.taskId, request.progress, request.data);
    }
    else if (request.type === 'TASK_RESULT') {
        // If it's a batch task, the internal listener in handleBatchReplies will catch it.
        // If it's a standard task (like SCAN_FEED), we report and clear here.
        if (activeTaskId && request.taskId === activeTaskId) {

            // Only handle if it's NOT a batch type (which handle their own flows)
            // Batch types: POST_REPLY, POST_EXTENSION
            const isBatchType = activeTaskType === 'POST_REPLY' || activeTaskType === 'POST_EXTENSION';

            if (!isBatchType) {
                // This is a single-step task (SCAN_FEED, etc.)
                // Report the result immediately
                console.log(`[LaunchGrid] Handling result for single-task ${activeTaskId}`);
                // twitter.js sends { data: ... }, while batch handles might use { result: { data: ... } }
                const resultData = request.data || request.result?.data || {};
                reportResult(activeTaskId, resultData);
                clearActiveTask();
            }
        }
    }

    sendResponse({ received: true });
    return true;
});

// ============================================
// ENGAGEMENT WORKER ("The Daisy Chain")
// ============================================

const EngagementWorker = {
    async init() {
        // Always create/overwrite the alarm to ensure we have the latest interval
        chrome.alarms.create('engagement_poll', { periodInMinutes: 0.5 }); // 30 seconds
    },

    isProcessing: false,

    async poll() {
        if (this.isProcessing) {
            console.log('[Engagement] Batch in progress. Skipping poll.');
            return;
        }

        try {
            console.log('[Engagement] Polling for jobs...');
            const response = await fetch(`${CONFIG.API_URL}/jobs/poll`, {
                headers: { 'X-API-Key': CONFIG.API_KEY }
            });
            const data = await response.json();

            if (data.success && data.data?.jobs?.length > 0) {
                console.log(`[Engagement] Found ${data.data.jobs.length} jobs.`);
                this.processBatch(data.data.jobs); // Managed by lock
            }
        } catch (err) {
            console.error('[Engagement] Poll failed:', err);
        }
    },

    async processBatch(jobs) {
        if (this.isProcessing) return;
        this.isProcessing = true;

        console.log('[Engagement] Starting Daisy Chain...');
        let tabId = null;

        try {
            // 1. Create single background tab
            const tab = await chrome.tabs.create({ url: 'about:blank', active: false });
            tabId = tab.id;

            // 2. Iterate jobs
            for (const job of jobs) {
                try {
                    await this.performCheck(job, tabId);

                    // Random delay between checks to be human-like
                    const delay = 5000 + Math.random() * 5000;
                    await sleep(delay);
                } catch (err) {
                    console.error(`[Engagement] Failed job ${job.id}:`, err);
                }
            }
        } catch (err) {
            console.error('[Engagement] Batch complete with errors.');
        } finally {
            // 3. Cleanup
            if (tabId) {
                chrome.tabs.remove(tabId).catch(() => { });
            }
            console.log('[Engagement] Batch complete. Tab closed.');
            this.isProcessing = false;
        }
    },

    async performCheck(job, tabId) {
        console.log(`[Engagement] Checking ${job.targetUrl}...`);

        // Navigate
        await chrome.tabs.update(tabId, { url: job.targetUrl });
        await waitForTabLoad(tabId);
        await sleep(3000); // Wait for dynamic content

        // Scrape
        const metrics = await chrome.scripting.executeScript({
            target: { tabId },
            func: () => {
                // Heuristic scraping for X/Twitter
                const getText = (selector) => {
                    const el = document.querySelector(selector);
                    return el ? el.innerText : null;
                };

                const parseMetric = (text) => {
                    if (!text) return 0;
                    const clean = text.replace(/,/g, '').toUpperCase();
                    let val = parseFloat(clean);
                    if (clean.includes('K')) val *= 1000;
                    if (clean.includes('M')) val *= 1000000;
                    return Math.floor(val);
                };

                // Try to find metric group
                // X structure changes often, looking for aria-labels or specific test IDs
                // Views: [href*="/analytics"] or aria-label="X Views"

                // Generic attempt to find the main tweet's metrics bar
                const viewsEl = document.querySelector('a[href*="/analytics"]');
                const views = viewsEl ? parseMetric(viewsEl.innerText) : 0;

                // Likes: [data-testid="like"]
                const likeEl = document.querySelector('[data-testid="like"]');
                const likes = likeEl ? parseMetric(likeEl.innerText) : 0;

                // Replies: [data-testid="reply"]
                const replyEl = document.querySelector('[data-testid="reply"]');
                const replies = replyEl ? parseMetric(replyEl.innerText) : 0;

                // Retweets: [data-testid="retweet"]
                const rtEl = document.querySelector('[data-testid="retweet"]');
                const retweets = rtEl ? parseMetric(rtEl.innerText) : 0;

                return { views, likes, replies, retweets };
            }
        });

        const result = metrics[0].result;
        console.log(`[Engagement] scraped:`, result);

        // Report
        if (result) {
            await fetch(`${CONFIG.API_URL}/jobs/${job.id}/result`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'X-API-Key': CONFIG.API_KEY
                },
                body: JSON.stringify({ metrics: result })
            });
        }
    }
};

// ============================================
// EVENT LISTENERS
// ============================================

chrome.runtime.onInstalled.addListener(() => {
    console.log("[LaunchGrid] Extension Installed");
    chrome.alarms.create('poll_task', { periodInMinutes: CONFIG.POLL_INTERVAL_MINUTES });
    EngagementWorker.init();
});

chrome.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name === 'poll_task') {
        checkTasks();
    } else if (alarm.name === 'engagement_poll') {
        EngagementWorker.poll();
    }
});

// Startup check
chrome.runtime.onStartup.addListener(() => {
    checkTasks();
    EngagementWorker.poll();
});
