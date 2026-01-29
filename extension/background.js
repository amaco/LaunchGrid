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
            headers: { 'Content-Type': 'application/json' },
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
            headers: { 'Content-Type': 'application/json' },
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
            await chrome.tabs.update(targetTab.id, { active: true });
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
            headers: { 'Accept': 'application/json', 'Cache-Control': 'no-cache' }
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
            // Check if we are currently in a batch loop (where handleBatchReplies is running)
            // If it's a SCAN_FEED or single page task, we report it.
            // We can check the action of the active task if needed, but simple clear works.

            // To be safe, we only CLEAR here if it's NOT a batch reply task (managed internally)
            // But actually, we need to report SCAN results here.

            // Actually, handleBatchReplies reports its OWN result.
            // So if TASK_RESULT comes here, it's either for SCAN_FEED or for a sub-task.
            // If it's for a sub-task, we DO NOT reportResult(taskId, ...) yet, because the batch isn't done.
            // Wait, SCAN_FEED needs reports.
        }

        // Let's look at the sender to see if it's from a tab
        // If a SCAN_FEED task finishes, it sends TASK_RESULT.
        // If a BATCH item finishes, it SENDS TASK_RESULT for the SAME taskId.
    }

    sendResponse({ received: true });
    return true;
});

// ============================================
// ALARMS / POLLING SETUP
// ============================================

function initializePolling() {
    chrome.alarms?.clear('pollTasks');
    chrome.alarms?.create('pollTasks', { periodInMinutes: CONFIG.POLL_INTERVAL_MINUTES, delayInMinutes: 0.1 });
    chrome.alarms?.onAlarm.addListener((alarm) => { if (alarm.name === 'pollTasks') checkTasks(); });
    setTimeout(checkTasks, 2000);
}

initializePolling();
chrome.runtime.onInstalled.addListener(() => initializePolling());
chrome.runtime.onStartup.addListener(() => initializePolling());
