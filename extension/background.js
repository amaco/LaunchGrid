// Background Service Worker

const API_URL = 'http://localhost:3000/api/v1/extension';

// 1. Setup Polling
// We attempt to use chrome.alarms, but fallback to setTimeout if API is missing (e.g., permission glitch)
try {
    if (chrome.alarms) {
        chrome.alarms.create('pollTasks', { periodInMinutes: 0.5 }); // 30 seconds
        chrome.alarms.onAlarm.addListener((alarm) => {
            if (alarm.name === 'pollTasks') checkTasks();
        });
        console.log("Polling started via Alarms API");
    } else {
        throw new Error("Alarms API undefined");
    }
} catch (e) {
    console.warn("Alarms API failed, switching to fallback loop:", e);
    // Fallback Loop
    (function pollLoop() {
        checkTasks();
        setTimeout(pollLoop, 30000); // 30 seconds
    })();
}

async function checkTasks() {
    try {
        // Poll the dashboard for pending tasks
        const response = await fetch(`${API_URL}/tasks`);
        if (!response.ok) return; // No tasks or server down

        const data = await response.json();
        if (data.task) {
            console.log("Task Received:", data.task);
            executeTask(data.task);
        }
    } catch (err) {
        console.log("Polling Error:", err);
    }
}

async function executeTask(task) {
    console.log("[LaunchGrid] Executing task:", task.id, "Type:", task.type);

    // Immediate acknowledgement
    reportProgress(task.taskId, "Extension acknowledged task...");

    const patterns = task.platform === 'twitter'
        ? ['*://x.com/*', '*://twitter.com/*']
        : ['*://linkedin.com/*'];

    const tabs = await chrome.tabs.query({ url: patterns });

    let activeTab;
    if (tabs.length === 0) {
        reportProgress(task.taskId, "No X tab found, opening new one...");
        // Use URL from task config if available, fallback to home
        const url = task.config?.url || (task.platform === 'twitter' ? 'https://x.com/home' : 'https://linkedin.com');
        activeTab = await chrome.tabs.create({ url, active: true }); // Make it active so user sees it

        reportProgress(task.taskId, "Waiting for page to load...");
        // Wait for tab to load
        await new Promise(resolve => {
            const listener = (tabId, changeInfo) => {
                if (tabId === activeTab.id && changeInfo.status === 'complete') {
                    chrome.tabs.onUpdated.removeListener(listener);
                    resolve();
                }
            };
            chrome.tabs.onUpdated.addListener(listener);
        });
    } else {
        activeTab = tabs[0];
        reportProgress(task.taskId, "Found active X tab, sending command...");
    }

    // Send message to Content Script
    chrome.tabs.sendMessage(activeTab.id, {
        action: task.type,
        config: task.config,
        taskId: task.taskId
    }, (response) => {
        if (chrome.runtime.lastError) {
            console.error("Msg Error:", chrome.runtime.lastError);
            reportProgress(task.taskId, "Communication error: Please refresh your X.com tab!");
            // No longer auto-failing here. Let the user refresh or wait. 
            // Sometimes the script eventually picks up the command.
        } else {
            console.log("Command sent successfully to tab", activeTab.id);
        }
    });
}

// Listen for results or progress coming back from Content Script
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.type === 'TASK_RESULT') {
        reportResult(request.taskId, request.data);
    } else if (request.type === 'TASK_PROGRESS') {
        reportProgress(request.taskId, request.progress);
    }
});

async function reportProgress(taskId, progress) {
    try {
        await fetch(`${API_URL}/tasks`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ taskId, progress })
        });
        console.log("Progress reported for", taskId, ":", progress);
    } catch (e) {
        console.warn("Failed to report progress", e);
    }
}

async function reportResult(taskId, resultData) {
    try {
        await fetch(`${API_URL}/tasks`, {
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
        console.log("Result reported for", taskId);
    } catch (e) {
        console.error("Failed to report result", e);
    }
}
