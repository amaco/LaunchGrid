/**
 * LaunchGrid Background Service Worker
 * 
 * Robust task polling and execution with:
 * - Reliable alarm-based polling
 * - Content script injection verification
 * - Timeout handling for extension tasks
 * - Retry logic with exponential backoff
 * - Proper error reporting
 */

console.log("[LaunchGrid] Background Service Worker Started - v2.0");

// ============================================
// CONFIGURATION
// ============================================

const CONFIG = {
    // API
    API_URL: 'http://localhost:3000/api/v1/extension',
    
    // Polling
    POLL_INTERVAL_MINUTES: 0.5,  // 30 seconds
    
    // Timeouts
    TASK_EXECUTION_TIMEOUT_MS: 150000,  // 2.5 minutes (gives content script time)
    TAB_LOAD_TIMEOUT_MS: 30000,         // 30 seconds for tab to load
    CONTENT_SCRIPT_READY_TIMEOUT_MS: 10000,  // 10 seconds for script to respond
    
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
        const response = await chrome.tabs.sendMessage(tabId, { action: 'PING' });
        if (response?.alive) {
            console.log(`[LaunchGrid] Content script already active on tab ${tabId}`);
            return true;
        }
    } catch (e) {
        // Content script not present, inject it
        console.log(`[LaunchGrid] Injecting content script on tab ${tabId}`);
    }
    
    try {
        await chrome.scripting.executeScript({
            target: { tabId },
            files: ['content-scripts/twitter.js']
        });
        
        // Wait a moment for script to initialize
        await sleep(1000);
        
        // Verify injection
        const response = await chrome.tabs.sendMessage(tabId, { action: 'PING' });
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
        } else {
            console.log(`[LaunchGrid] Progress reported: ${progress}`);
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
}

// ============================================
// TASK EXECUTION
// ============================================

/**
 * Execute a task received from the API
 */
async function executeTask(task) {
    // Validate task structure
    if (!task || !task.taskId) {
        console.error("[LaunchGrid] Invalid task received:", task);
        return;
    }
    
    // Prevent concurrent task execution
    if (activeTaskId) {
        console.warn(`[LaunchGrid] Task ${activeTaskId} still in progress, skipping ${task.taskId}`);
        return;
    }
    
    const taskId = task.taskId;
    const taskType = task.type;
    const platform = task.platform || 'twitter';
    
    console.log(`[LaunchGrid] Executing task: ${taskId}, Type: ${taskType}, Platform: ${platform}`);
    
    // Validate task type
    if (!taskType) {
        console.error("[LaunchGrid] Task type is missing!");
        await reportResult(taskId, {
            error: 'INVALID_TASK',
            summary: 'Task type is missing. This is a server-side issue.'
        });
        return;
    }
    
    activeTaskId = taskId;
    
    // Set up task timeout
    taskTimeoutId = setTimeout(async () => {
        console.warn(`[LaunchGrid] Task ${taskId} timed out after ${CONFIG.TASK_EXECUTION_TIMEOUT_MS}ms`);
        
        await reportResult(taskId, {
            error: 'EXTENSION_TIMEOUT',
            summary: 'Task execution timed out. The content script may have encountered an issue.'
        });
        
        clearActiveTask();
    }, CONFIG.TASK_EXECUTION_TIMEOUT_MS);
    
    // Report initial progress
    await reportProgress(taskId, "Extension processing task...");
    
    try {
        // Find or create appropriate tab
        const patterns = CONFIG.PLATFORM_URLS[platform] || CONFIG.PLATFORM_URLS.twitter;
        let tabs = await chrome.tabs.query({ url: patterns });
        
        let targetTab;
        
        if (tabs.length === 0) {
            await reportProgress(taskId, "Opening X.com...");
            
            // Use URL from config or default to home
            const url = task.config?.url || task.config?.targetUrl || 'https://x.com/home';
            
            targetTab = await chrome.tabs.create({ url, active: true });
            
            await reportProgress(taskId, "Waiting for page to load...");
            
            try {
                await waitForTabLoad(targetTab.id);
            } catch (e) {
                throw new Error('Page failed to load within timeout');
            }
            
            // Extra wait for X's JavaScript to initialize
            await sleep(3000);
        } else {
            // Use the first matching tab
            targetTab = tabs[0];
            
            // Activate the tab so user can see it
            await chrome.tabs.update(targetTab.id, { active: true });
            
            await reportProgress(taskId, "Using existing X.com tab...");
        }
        
        // Ensure content script is ready
        await reportProgress(taskId, "Preparing scanner...");
        
        const scriptReady = await ensureContentScriptInjected(targetTab.id);
        if (!scriptReady) {
            throw new Error('Content script failed to initialize. Please refresh the X.com tab and try again.');
        }
        
        await reportProgress(taskId, "Scanner ready, starting task...");
        
        // Send command to content script
        chrome.tabs.sendMessage(targetTab.id, {
            action: taskType,
            config: task.config || {},
            taskId: taskId
        }, (response) => {
            if (chrome.runtime.lastError) {
                console.error("[LaunchGrid] Message error:", chrome.runtime.lastError);
                
                // Only report error if this task is still active (not timed out)
                if (activeTaskId === taskId) {
                    reportProgress(taskId, `Communication error: ${chrome.runtime.lastError.message}. Try refreshing the page.`);
                    // Don't report final error yet - content script might still work
                }
            } else {
                console.log("[LaunchGrid] Command sent, response:", response);
            }
        });
        
    } catch (error) {
        console.error("[LaunchGrid] Task execution error:", error);
        
        await reportResult(taskId, {
            error: 'EXECUTION_ERROR',
            summary: error.message || 'Unknown error during task execution'
        });
        
        clearActiveTask();
    }
}

// ============================================
// TASK POLLING
// ============================================

/**
 * Check for pending tasks from the API
 */
async function checkTasks() {
    // Skip if a task is already in progress
    if (activeTaskId) {
        console.log(`[LaunchGrid] Task ${activeTaskId} in progress, skipping poll`);
        return;
    }
    
    try {
        const response = await fetch(`${CONFIG.API_URL}/tasks`, {
            method: 'GET',
            headers: {
                'Accept': 'application/json',
                'Cache-Control': 'no-cache'
            }
        });
        
        if (!response.ok) {
            if (response.status === 404) {
                // No tasks available
                return;
            }
            console.warn(`[LaunchGrid] API returned ${response.status}`);
            return;
        }
        
        const data = await response.json();
        
        if (data.task) {
            console.log("[LaunchGrid] Task received:", data.task);
            executeTask(data.task);
        }
    } catch (err) {
        // Only log occasionally to avoid spam
        if (Math.random() < 0.1) {
            console.log("[LaunchGrid] Poll error (server may be down):", err.message);
        }
    }
}

// ============================================
// MESSAGE HANDLING
// ============================================

/**
 * Handle messages from content scripts
 */
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    console.log("[LaunchGrid] Message from content script:", request.type, request.taskId);
    
    if (request.type === 'TASK_RESULT') {
        // Verify this is for the active task
        if (activeTaskId && request.taskId === activeTaskId) {
            reportResult(request.taskId, request.data);
            clearActiveTask();
        } else {
            console.warn(`[LaunchGrid] Received result for inactive task: ${request.taskId}`);
            // Report anyway in case state got out of sync
            reportResult(request.taskId, request.data);
        }
    } else if (request.type === 'TASK_PROGRESS') {
        reportProgress(request.taskId, request.progress, request.data);
    }
    
    // Send acknowledgment
    sendResponse({ received: true });
    return true;
});

// ============================================
// POLLING SETUP
// ============================================

/**
 * Initialize polling using alarms API
 */
function initializePolling() {
    try {
        if (chrome.alarms) {
            // Clear any existing alarm
            chrome.alarms.clear('pollTasks');
            
            // Create new alarm
            chrome.alarms.create('pollTasks', { 
                periodInMinutes: CONFIG.POLL_INTERVAL_MINUTES,
                delayInMinutes: 0.1  // Start almost immediately
            });
            
            chrome.alarms.onAlarm.addListener((alarm) => {
                if (alarm.name === 'pollTasks') {
                    checkTasks();
                }
            });
            
            console.log("[LaunchGrid] Polling initialized via Alarms API");
        } else {
            throw new Error("Alarms API not available");
        }
    } catch (e) {
        console.warn("[LaunchGrid] Alarms API failed, using fallback:", e.message);
        
        // Fallback to setInterval
        setInterval(checkTasks, CONFIG.POLL_INTERVAL_MINUTES * 60 * 1000);
    }
    
    // Also check immediately on startup
    setTimeout(checkTasks, 2000);
}

// ============================================
// INITIALIZATION
// ============================================

// Start polling
initializePolling();

// Handle extension installation/update
chrome.runtime.onInstalled.addListener((details) => {
    console.log("[LaunchGrid] Extension installed/updated:", details.reason);
    
    // Re-initialize polling
    initializePolling();
});

// Handle service worker wake-up
chrome.runtime.onStartup.addListener(() => {
    console.log("[LaunchGrid] Service worker started");
    initializePolling();
});

console.log("[LaunchGrid] Background worker initialized");
