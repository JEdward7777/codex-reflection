import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';

export class ReflectionWebviewProvider implements vscode.CustomTextEditorProvider {
    public static register(context: vscode.ExtensionContext): vscode.Disposable {
        const provider = new ReflectionWebviewProvider(context);
        const providerRegistration = vscode.window.registerCustomEditorProvider(
            ReflectionWebviewProvider.viewType,
            provider
        );
        return providerRegistration;
    }

    private static readonly viewType = 'codex.reflectionReportViewer';

    constructor(private readonly context: vscode.ExtensionContext) {}

    public async resolveCustomTextEditor(
        document: vscode.TextDocument,
        webviewPanel: vscode.WebviewPanel,
        _token: vscode.CancellationToken
    ): Promise<void> {
        // Setup initial content for the webview
        webviewPanel.webview.options = {
            enableScripts: true,
        };

        // Set the HTML content
        webviewPanel.webview.html = this.getHtmlForWebview(webviewPanel.webview, document);

        // Update the content when the document changes
        const changeDocumentSubscription = vscode.workspace.onDidChangeTextDocument(e => {
            if (e.document.uri.toString() === document.uri.toString()) {
                webviewPanel.webview.html = this.getHtmlForWebview(webviewPanel.webview, document);
            }
        });

        // Make sure we get rid of the listener when our editor is closed
        webviewPanel.onDidDispose(() => {
            changeDocumentSubscription.dispose();
        });
    }

    private getHtmlForWebview(webview: vscode.Webview, document: vscode.TextDocument): string {
        // Read the HTML content from the document
        const htmlContent = document.getText();
        
        // If the content is empty or not HTML, show a placeholder
        if (!htmlContent.trim() || !htmlContent.includes('<html')) {
            return `
                <!DOCTYPE html>
                <html lang="en">
                <head>
                    <meta charset="UTF-8">
                    <meta name="viewport" content="width=device-width, initial-scale=1.0">
                    <title>Reflection Report</title>
                    <style>
                        body {
                            font-family: Arial, sans-serif;
                            padding: 20px;
                            text-align: center;
                            background-color: #f5f5f5;
                        }
                        .error {
                            color: #d32f2f;
                            background-color: #ffebee;
                            border: 1px solid #f44336;
                            padding: 10px;
                            border-radius: 4px;
                            margin: 20px 0;
                        }
                    </style>
                </head>
                <body>
                    <h1>Reflection Report Viewer</h1>
                    <div class="error">
                        <p>Unable to display report content.</p>
                        <p>The file may be empty or not contain valid HTML content.</p>
                    </div>
                </body>
                </html>
            `;
        }

        // Since the HTML reports are self-contained, just return the content as-is
        return htmlContent;
    }
}

// Standalone function to open HTML reports in webview
export async function openReportInWebview(reportPath: string): Promise<void> {
    try {
        // Check if file exists
        if (!fs.existsSync(reportPath)) {
            vscode.window.showErrorMessage(`Report file not found: ${reportPath}`);
            return;
        }

        const uri = vscode.Uri.file(reportPath);
        const fileName = path.basename(reportPath, '.html');
        
        // Open the HTML file with our custom editor
        await vscode.commands.executeCommand(
            'vscode.openWith',
            uri,
            'codex.reflectionReportViewer',
            {
                viewColumn: vscode.ViewColumn.One,
                preview: false
            }
        );
        
    } catch (error) {
        console.error('Error opening report in webview:', error);
        vscode.window.showErrorMessage(`Failed to open report: ${error}`);
    }
}
