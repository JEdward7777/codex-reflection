import * as vscode from 'vscode';

export class ReflectionSettingsWebviewProvider implements vscode.WebviewViewProvider {
    public static readonly viewType = 'codex-reflection.settingsView';

    private _view?: vscode.WebviewView;

    constructor(
        private readonly _extensionUri: vscode.Uri,
    ) { }

    public resolveWebviewView(
        webviewView: vscode.WebviewView,
        context: vscode.WebviewViewResolveContext,
        _token: vscode.CancellationToken,
    ) {
        this._view = webviewView;

        webviewView.webview.options = {
            enableScripts: true,
            localResourceRoots: [
                this._extensionUri
            ]
        };

        webviewView.webview.html = this._getHtmlForWebview(webviewView.webview);

        // Handle messages from the webview
        webviewView.webview.onDidReceiveMessage(
            async message => {
                switch (message.command) {
                    case 'getSettings':
                        await this._sendCurrentSettings();
                        break;
                    case 'saveSetting':
                        await this._saveSetting(message.key, message.value);
                        break;
                    case 'webviewReady':
                        // Webview is ready, send current settings
                        await this._sendCurrentSettings();
                        break;
                }
            },
            undefined,
        );
    }

    private async _sendCurrentSettings() {
        if (!this._view) return;

        const settings = {
            openAIKey: await this._getConfigurationOption('codex-reflection.openAIKey'),
            firstVerseRef: await this._getConfigurationOption('codex-reflection.firstVerseRef'),
            lastVerseRef: await this._getConfigurationOption('codex-reflection.lastVerseRef'),
            translationObjective: await this._getConfigurationOption('codex-reflection.translationObjective')
        };

        this._view.webview.postMessage({
            command: 'updateSettings',
            settings: settings
        });
    }

    private async _getConfigurationOption(key: string): Promise<any> {
        return vscode.workspace.getConfiguration().get(key);
    }

    private async _saveSetting(key: string, value: any) {
        try {
            // Check if the setting is already the correct value to avoid unnecessary saves
            const currentValue = await this._getConfigurationOption(key);
            if (currentValue !== value) {
                // Only update if the value has actually changed
                await vscode.workspace.getConfiguration().update(key, value, vscode.ConfigurationTarget.Workspace);
            }

            // Send confirmation back to webview (whether we saved or not)
            if (this._view) {
                this._view.webview.postMessage({
                    command: 'settingSaved',
                    key: key,
                    success: true
                });
            }
        } catch (error) {
            console.error('Error saving setting:', error);
            if (this._view) {
                this._view.webview.postMessage({
                    command: 'settingSaved',
                    key: key,
                    success: false,
                    error: error
                });
            }
        }
    }

    private _getHtmlForWebview(webview: vscode.Webview) {
        return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Reflection Settings</title>
    <style>
        body {
            font-family: var(--vscode-font-family);
            font-size: var(--vscode-font-size);
            color: var(--vscode-foreground);
            background-color: var(--vscode-editor-background);
            margin: 0;
            padding: 12px;
            height: 100vh;
            box-sizing: border-box;
            display: flex;
            flex-direction: column;
            position: relative;
        }

        .header {
            font-weight: bold;
            font-size: 13px;
            color: var(--vscode-foreground);
            margin-bottom: 12px;
            padding-bottom: 6px;
            border-bottom: 1px solid var(--vscode-panel-border);
        }

        .settings-content {
            flex: 1;
            overflow-y: auto;
            padding-bottom: 80px; /* Space for fixed save button */
        }

        .setting-group {
            margin-bottom: 16px;
        }

        .setting-label {
            display: block;
            font-weight: 600;
            margin-bottom: 4px;
            color: var(--vscode-foreground);
            font-size: 12px;
        }

        .setting-input {
            width: 100%;
            padding: 6px 8px;
            border: 1px solid var(--vscode-input-border);
            background-color: var(--vscode-input-background);
            color: var(--vscode-input-foreground);
            border-radius: 3px;
            font-family: var(--vscode-editor-font-family);
            font-size: 12px;
            box-sizing: border-box;
        }

        .setting-input:focus {
            outline: 1px solid var(--vscode-focusBorder);
            border-color: var(--vscode-focusBorder);
        }

        .setting-textarea {
            width: 100%;
            min-height: 80px;
            padding: 6px 8px;
            border: 1px solid var(--vscode-input-border);
            background-color: var(--vscode-input-background);
            color: var(--vscode-input-foreground);
            border-radius: 3px;
            font-family: var(--vscode-editor-font-family);
            font-size: 12px;
            resize: vertical;
            box-sizing: border-box;
        }

        .setting-textarea:focus {
            outline: 1px solid var(--vscode-focusBorder);
            border-color: var(--vscode-focusBorder);
        }

        .save-section {
            position: fixed;
            bottom: 0;
            left: 0;
            right: 0;
            background: var(--vscode-editor-background);
            border-top: 1px solid var(--vscode-panel-border);
            padding: 12px;
            box-sizing: border-box;
        }

        .save-button {
            background: var(--vscode-button-background);
            color: var(--vscode-button-foreground);
            border: none;
            padding: 8px 16px;
            font-size: 12px;
            cursor: pointer;
            border-radius: 3px;
            width: 100%;
        }

        .save-button:hover {
            background: var(--vscode-button-hoverBackground);
        }

        .save-button:disabled {
            opacity: 0.6;
            cursor: not-allowed;
        }

        .unsaved-indicator {
            color: var(--vscode-notificationsWarningIcon-foreground);
            font-size: 11px;
            margin-bottom: 8px;
            font-style: italic;
        }

        .setting-input.unsaved {
            border-color: var(--vscode-notificationsWarningIcon-foreground);
            background-color: var(--vscode-inputValidation-warningBackground);
        }

        .setting-textarea.unsaved {
            border-color: var(--vscode-notificationsWarningIcon-foreground);
            background-color: var(--vscode-inputValidation-warningBackground);
        }

        .status-message {
            margin-top: 8px;
            padding: 4px 8px;
            border-radius: 3px;
            font-size: 11px;
        }

        .status-success {
            background-color: var(--vscode-notificationsInfoIcon-foreground);
            color: var(--vscode-editor-background);
            opacity: 0.2;
        }

        .status-error {
            background-color: var(--vscode-notificationsErrorIcon-foreground);
            color: var(--vscode-editor-background);
            opacity: 0.2;
        }

        .loading {
            opacity: 0.6;
            pointer-events: none;
        }
    </style>
</head>
<body>
    <div class="header">Reflection Settings</div>

    <div class="settings-content">
        <div id="settingsContainer" class="loading">
            <div class="setting-group">
                <label class="setting-label" for="openAIKey">OpenAI API Key</label>
                <input type="password" id="openAIKey" class="setting-input" placeholder="Enter your OpenAI API key">
            </div>

            <div class="setting-group">
                <label class="setting-label" for="firstVerseRef">First Verse Reference</label>
                <input type="text" id="firstVerseRef" class="setting-input" placeholder="e.g., GEN 1:1">
            </div>

            <div class="setting-group">
                <label class="setting-label" for="lastVerseRef">Last Verse Reference</label>
                <input type="text" id="lastVerseRef" class="setting-input" placeholder="e.g., REV 22:21">
            </div>

            <div class="setting-group">
                <label class="setting-label" for="translationObjective">Translation Objective</label>
                <textarea id="translationObjective" class="setting-textarea" placeholder="Describe the translation objective..."></textarea>
            </div>
        </div>
    </div>

    <div class="save-section">
        <div id="unsavedIndicator" class="unsaved-indicator" style="display: none;">
            You have unsaved changes
        </div>
        <button id="saveButton" class="save-button">Save Settings</button>
        <div id="statusMessage"></div>
    </div>

    <script>
        const vscode = acquireVsCodeApi();
        let currentSettings = {};

        // DOM elements
        const openAIKeyInput = document.getElementById('openAIKey');
        const firstVerseRefInput = document.getElementById('firstVerseRef');
        const lastVerseRefInput = document.getElementById('lastVerseRef');
        const translationObjectiveTextarea = document.getElementById('translationObjective');
        const saveButton = document.getElementById('saveButton');
        const statusMessage = document.getElementById('statusMessage');
        const settingsContainer = document.getElementById('settingsContainer');
        const unsavedIndicator = document.getElementById('unsavedIndicator');

        let autoSaveTimeout = null;
        const AUTO_SAVE_DELAY = 1000; // 1 second delay

        // Event listeners
        saveButton.addEventListener('click', saveAllSettings);

        // Input change tracking and auto-save
        [openAIKeyInput, firstVerseRefInput, lastVerseRefInput, translationObjectiveTextarea].forEach(input => {
            input.addEventListener('input', () => {
                updateSaveButton();
                scheduleAutoSave();
            });
            input.addEventListener('blur', () => {
                // Auto-save when user leaves the field
                clearTimeout(autoSaveTimeout);
                autoSave();
            });
        });

        function updateSaveButton() {
            const hasChanges = checkForChanges();
            saveButton.disabled = !hasChanges;
            saveButton.textContent = hasChanges ? 'Save Settings' : 'Settings Saved';

            // Show/hide unsaved indicator
            if (hasChanges) {
                unsavedIndicator.style.display = 'block';
                // Add unsaved class to changed inputs
                updateUnsavedIndicators();
            } else {
                unsavedIndicator.style.display = 'none';
                // Remove unsaved class from all inputs
                [openAIKeyInput, firstVerseRefInput, lastVerseRefInput, translationObjectiveTextarea].forEach(input => {
                    input.classList.remove('unsaved');
                });
            }
        }

        function updateUnsavedIndicators() {
            const currentValues = {
                openAIKey: openAIKeyInput.value,
                firstVerseRef: firstVerseRefInput.value,
                lastVerseRef: lastVerseRefInput.value,
                translationObjective: translationObjectiveTextarea.value
            };

            openAIKeyInput.classList.toggle('unsaved', currentValues.openAIKey !== currentSettings.openAIKey);
            firstVerseRefInput.classList.toggle('unsaved', currentValues.firstVerseRef !== currentSettings.firstVerseRef);
            lastVerseRefInput.classList.toggle('unsaved', currentValues.lastVerseRef !== currentSettings.lastVerseRef);
            translationObjectiveTextarea.classList.toggle('unsaved', currentValues.translationObjective !== currentSettings.translationObjective);
        }

        function scheduleAutoSave() {
            clearTimeout(autoSaveTimeout);
            autoSaveTimeout = setTimeout(() => {
                autoSave();
            }, AUTO_SAVE_DELAY);
        }

        async function autoSave() {
            if (!checkForChanges()) return;

            try {
                await saveAllSettings(false); // isManualSave = false
            } catch (error) {
                // Auto-save failed, user will see error in status
                console.error('Auto-save failed:', error);
            }
        }

        function checkForChanges() {
            const currentValues = {
                openAIKey: openAIKeyInput.value,
                firstVerseRef: firstVerseRefInput.value,
                lastVerseRef: lastVerseRefInput.value,
                translationObjective: translationObjectiveTextarea.value
            };

            return JSON.stringify(currentValues) !== JSON.stringify(currentSettings);
        }

        async function saveAllSettings(isManualSave = true) {
            const settings = {
                'codex-reflection.openAIKey': openAIKeyInput.value,
                'codex-reflection.firstVerseRef': firstVerseRefInput.value,
                'codex-reflection.lastVerseRef': lastVerseRefInput.value,
                'codex-reflection.translationObjective': translationObjectiveTextarea.value
            };

            if (isManualSave) {
                saveButton.disabled = true;
                saveButton.textContent = 'Saving...';
                statusMessage.textContent = '';
                statusMessage.className = '';
            }

            try {
                // Save each setting
                for (const [key, value] of Object.entries(settings)) {
                    await saveSetting(key, value);
                }

                if (isManualSave) {
                    showStatus('Settings saved successfully!', 'success');
                    saveButton.textContent = 'Settings Saved';
                }
                currentSettings = {
                    openAIKey: openAIKeyInput.value,
                    firstVerseRef: firstVerseRefInput.value,
                    lastVerseRef: lastVerseRefInput.value,
                    translationObjective: translationObjectiveTextarea.value
                };
                updateSaveButton(); // This will hide the unsaved indicator
            } catch (error) {
                if (isManualSave) {
                    showStatus('Error saving settings: ' + error.message, 'error');
                    saveButton.disabled = false;
                    saveButton.textContent = 'Save Settings';
                } else {
                    console.error('Auto-save failed:', error);
                }
            }
        }

        async function saveSetting(key, value) {
            return new Promise((resolve, reject) => {
                const timeout = setTimeout(() => {
                    reject(new Error('Timeout saving setting'));
                }, 5000);

                const messageHandler = (event) => {
                    const message = event.data;
                    if (message.command === 'settingSaved' && message.key === key) {
                        window.removeEventListener('message', messageHandler);
                        clearTimeout(timeout);
                        if (message.success) {
                            resolve();
                        } else {
                            reject(new Error(message.error || 'Unknown error'));
                        }
                    }
                };

                window.addEventListener('message', messageHandler);
                vscode.postMessage({ command: 'saveSetting', key, value });
            });
        }

        function showStatus(message, type) {
            statusMessage.textContent = message;
            statusMessage.className = 'status-message status-' + type;
            setTimeout(() => {
                statusMessage.textContent = '';
                statusMessage.className = '';
            }, 3000);
        }

        // Update form with current settings
        function updateSettings(settings) {
            currentSettings = {
                openAIKey: settings.openAIKey || '',
                firstVerseRef: settings.firstVerseRef || '',
                lastVerseRef: settings.lastVerseRef || '',
                translationObjective: settings.translationObjective || ''
            };
            openAIKeyInput.value = currentSettings.openAIKey;
            firstVerseRefInput.value = currentSettings.firstVerseRef;
            lastVerseRefInput.value = currentSettings.lastVerseRef;
            translationObjectiveTextarea.value = currentSettings.translationObjective;
            settingsContainer.classList.remove('loading');
            updateSaveButton();
        }

        // Signal that webview is ready
        window.addEventListener('load', () => {
            vscode.postMessage({ command: 'webviewReady' });
        });

        // Listen for messages from extension
        window.addEventListener('message', event => {
            const message = event.data;
            switch (message.command) {
                case 'updateSettings':
                    updateSettings(message.settings);
                    break;
            }
        });
    </script>
</body>
</html>`;
    }
}