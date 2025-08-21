import * as vscode from 'vscode';

export class ReflectionLogsWebviewProvider implements vscode.WebviewViewProvider {
    public static readonly viewType = 'codex-reflection.logsView';

    private _view?: vscode.WebviewView;
    private logMessages: Array<{ message: string; level: string; timestamp: string; }> = [];
    private readonly maxLogMessages = 100; // Keep last 100 log messages to prevent webview crashes
    private updateWebviewTimeout: NodeJS.Timeout | null = null;
    private readonly updateWebviewDelay = 150; // debounce delay in ms

    constructor(
        private readonly _extensionUri: vscode.Uri,
    ) { }

    public addLogMessage(logData: { message: string; level: string; timestamp: string; }): void {
        this.logMessages.push(logData);
        // Keep only the last maxLogMessages
        if (this.logMessages.length > this.maxLogMessages) {
            this.logMessages = this.logMessages.slice(-this.maxLogMessages);
        }
        // If an update is not already scheduled, schedule one
        if (this.updateWebviewTimeout === null) {
            console.log("debounce: updateWebviewTimeout not scheduled");
            this.updateWebviewTimeout = setTimeout(() => {
                this.updateWebview();
                this.updateWebviewTimeout = null;
            }, this.updateWebviewDelay);
        } else {
            console.log("debounce: updateWebviewTimeout already scheduled");
        }
    }

    public clearLogMessages(): void {
        this.logMessages = [];
        this.updateWebview();
    }

    public getLogMessages(): Array<{ message: string; level: string; timestamp: string; }> {
        return [...this.logMessages]; // Return a copy
    }

    public dispose(): void {
        // Clean up any pending timeout to prevent memory leaks
        if (this.updateWebviewTimeout) {
            clearTimeout(this.updateWebviewTimeout);
            this.updateWebviewTimeout = null;
        }
    }

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
            message => {
                switch (message.command) {
                    case 'clearLogs':
                        this.clearLogMessages();
                        break;
                    case 'webviewReady':
                        // Webview is fully loaded and ready to receive logs
                        this.updateWebview();
                        break;
                }
            },
            undefined,
        );

        // Don't populate logs immediately - wait for webview to signal it's ready
    }

    public updateWebview() {
        if (this._view) {
            this._view.webview.postMessage({
                command: 'updateLogs',
                logs: this.logMessages
            });
        }
    }

    private _getHtmlForWebview(webview: vscode.Webview) {
        return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Reflection Logs</title>
    <style>
        body {
            font-family: var(--vscode-font-family);
            font-size: var(--vscode-font-size);
            color: var(--vscode-foreground);
            background-color: var(--vscode-editor-background);
            margin: 0;
            padding: 8px;
            height: 100vh;
            box-sizing: border-box;
            display: flex;
            flex-direction: column;
        }
        
        .header {
            display: flex;
            justify-content: space-between;
            align-items: center;
            margin-bottom: 8px;
            padding-bottom: 4px;
            border-bottom: 1px solid var(--vscode-panel-border);
        }
        
        .title {
            font-weight: bold;
            font-size: 12px;
            color: var(--vscode-foreground);
        }
        
        .clear-button {
            background: var(--vscode-button-background);
            color: var(--vscode-button-foreground);
            border: none;
            padding: 4px 8px;
            font-size: 11px;
            cursor: pointer;
            border-radius: 2px;
        }
        
        .clear-button:hover {
            background: var(--vscode-button-hoverBackground);
        }
        
        .logs-container {
            flex: 1;
            overflow-y: auto;
            font-family: var(--vscode-editor-font-family);
            font-size: 11px;
            line-height: 1.4;
        }
        
        .log-entry {
            margin-bottom: 2px;
            padding: 2px 4px;
            border-radius: 2px;
            white-space: pre-wrap;
            word-wrap: break-word;
        }
        
        .log-entry.INFO {
            color: var(--vscode-foreground);
        }
        
        .log-entry.DEBUG {
            color: var(--vscode-debugConsole-infoForeground);
        }
        
        .log-entry.PROGRESS {
            color: var(--vscode-terminal-ansiGreen);
            background-color: var(--vscode-terminal-ansiGreen)10;
        }
        
        .log-entry.ERROR {
            color: var(--vscode-errorForeground);
            background-color: var(--vscode-inputValidation-errorBackground);
        }
        
        .timestamp {
            color: var(--vscode-descriptionForeground);
            font-size: 10px;
            margin-right: 8px;
        }
        
        .level {
            font-weight: bold;
            margin-right: 8px;
            font-size: 10px;
        }
        
        .message {
            flex: 1;
        }
        
        .empty-state {
            text-align: center;
            color: var(--vscode-descriptionForeground);
            font-style: italic;
            margin-top: 20px;
        }
        
        /* Scrollbar styling */
        .logs-container::-webkit-scrollbar {
            width: 8px;
        }
        
        .logs-container::-webkit-scrollbar-track {
            background: var(--vscode-scrollbarSlider-background);
        }
        
        .logs-container::-webkit-scrollbar-thumb {
            background: var(--vscode-scrollbarSlider-background);
            border-radius: 4px;
        }
        
        .logs-container::-webkit-scrollbar-thumb:hover {
            background: var(--vscode-scrollbarSlider-hoverBackground);
        }
    </style>
</head>
<body>
    <div class="header">
        <div class="title">Reflection Logs</div>
        <button class="clear-button" onclick="clearLogs()">Clear</button>
    </div>
    <div class="logs-container" id="logsContainer">
        <div class="empty-state">No logs yet. Start a reflection to see activity.</div>
    </div>

    <script>
        const vscode = acquireVsCodeApi();
        
        function clearLogs() {
            vscode.postMessage({ command: 'clearLogs' });
        }
        
        function formatTimestamp(timestamp) {
            const date = new Date(timestamp);
            return date.toLocaleTimeString('en-US', { 
                hour12: false, 
                hour: '2-digit', 
                minute: '2-digit', 
                second: '2-digit' 
            });
        }
        
        function updateLogs(logs) {
            const container = document.getElementById('logsContainer');
            
            if (!logs || logs.length === 0) {
                container.innerHTML = '<div class="empty-state">No logs yet. Start a reflection to see activity.</div>';
                return;
            }
            
            container.innerHTML = '';
            
            logs.forEach(log => {
                const entry = document.createElement('div');
                entry.className = \`log-entry \${log.level}\`;
                
                const timestamp = document.createElement('span');
                timestamp.className = 'timestamp';
                timestamp.textContent = formatTimestamp(log.timestamp);
                
                const level = document.createElement('span');
                level.className = 'level';
                level.textContent = log.level;
                
                const message = document.createElement('span');
                message.className = 'message';
                message.textContent = log.message;
                
                entry.appendChild(timestamp);
                entry.appendChild(level);
                entry.appendChild(message);
                
                container.appendChild(entry);
            });
            
            // Auto-scroll to bottom for new messages
            container.scrollTop = container.scrollHeight;
        }
        
        // Signal that webview is ready to receive data
        window.addEventListener('load', () => {
            vscode.postMessage({ command: 'webviewReady' });
        });
        
        // Listen for messages from the extension
        window.addEventListener('message', event => {
            const message = event.data;
            switch (message.command) {
                case 'updateLogs':
                    updateLogs(message.logs);
                    break;
            }
        });
    </script>
</body>
</html>`;
    }
}
