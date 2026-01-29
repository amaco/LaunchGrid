
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

    // Timeout safety
    const timeoutId = setTimeout(() => {
        sendResult(taskId, { error: 'TIMEOUT', summary: 'Reply operation timed out.' }, true);
    }, 60000); // 1 minute timeout for posting

    try {
        const { targetUrl, replyText, url } = config;
        const tweetUrl = targetUrl || url;

        if (!tweetUrl || !replyText) {
            throw new Error('Missing targetUrl or replyText');
        }

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

        // TODO: Verify post success via UI feedback if possible

        clearTimeout(timeoutId);
        sendResult(taskId, {
            success: true,
            summary: 'Reply posted successfully!',
            url: tweetUrl
        });

    } catch (error) {
        console.error('[LaunchGrid] Post error:', error);
        clearTimeout(timeoutId);
        sendResult(taskId, {
            error: 'POST_FAILED',
            summary: `Failed to post reply: ${error.message}`
        }, true);
    }
}
