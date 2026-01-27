// Background Service Worker

const API_URL = 'http://localhost:3000/api/extension';

// 1. Setup Polling
// We attempt to use chrome.alarms, but fallback to setTimeout if API is missing (e.g., permission glitch)
try {
    if (chrome.alarms) {
        chrome.alarms.create('pollTasks', { periodInMinutes: 0.1 });
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
        setTimeout(pollLoop, 6000); // 6 seconds
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
    const patterns = task.platform === 'twitter'
        ? ['*://x.com/*', '*://twitter.com/*']
        : ['*://linkedin.com/*'];

    const tabs = await chrome.tabs.query({ url: patterns });

    let activeTab;
    if (tabs.length === 0) {
        console.log("No active tab found. Creating one for:", task.platform);
        const url = task.platform === 'twitter' ? 'https://x.com/home' : 'https://linkedin.com';
        activeTab = await chrome.tabs.create({ url, active: false, pinned: true });

        // Wait for tab to load before sending message
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
    }

    // Send message to Content Script
    chrome.tabs.sendMessage(activeTab.id, {
        action: task.type,
        config: task.config,
        taskId: task.taskId
    }, (response) => {
        if (chrome.runtime.lastError) {
            console.error("Msg Error:", chrome.runtime.lastError);
        }
    });
}

// Listen for results coming back from Content Script
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.type === 'TASK_RESULT') {
        // Send result back to Brain
        reportResult(request.taskId, request.data);
    }
});

async function reportResult(taskId, resultData) {
    try {
        await fetch(`${API_URL}/result`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ taskId, result: resultData })
        });
        console.log("Result reported for", taskId);
    } catch (e) {
        console.error("Failed to report result", e);
    }
}
