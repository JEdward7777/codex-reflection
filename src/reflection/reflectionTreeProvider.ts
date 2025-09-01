import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';

export interface ReflectionReport {
    name: string;
    path: string;
    lastModified: Date;
}

export class ReflectionTreeItem extends vscode.TreeItem {
    constructor(
        public readonly label: string,
        public readonly collapsibleState: vscode.TreeItemCollapsibleState,
        public readonly contextValue?: string,
        public readonly command?: vscode.Command,
        public readonly reportPath?: string
    ) {
        super(label, collapsibleState);
        this.tooltip = this.label;
        
        if (contextValue === 'report') {
            this.iconPath = new vscode.ThemeIcon('file-text');
        } else if (contextValue === 'status') {
            this.iconPath = new vscode.ThemeIcon('pulse');
        }
    }
}

export class ReflectionTreeProvider implements vscode.TreeDataProvider<ReflectionTreeItem> {
    private _onDidChangeTreeData: vscode.EventEmitter<ReflectionTreeItem | undefined | null | void> = new vscode.EventEmitter<ReflectionTreeItem | undefined | null | void>();
    readonly onDidChangeTreeData: vscode.Event<ReflectionTreeItem | undefined | null | void> = this._onDidChangeTreeData.event;

    private isReflectionRunning = false;
    private statusMessages: string[] = [];

    constructor(private context: vscode.ExtensionContext) {}

    refresh(): void {
        this._onDidChangeTreeData.fire();
    }

    setReflectionRunning(running: boolean): void {
        this.isReflectionRunning = running;
        this.refresh();
    }

    addStatusMessage(message: string): void {
        this.statusMessages.unshift(message);
        // Keep only the last 10 messages
        if (this.statusMessages.length > 10) {
            this.statusMessages = this.statusMessages.slice(0, 10);
        }
        this.refresh();
    }

    clearStatusMessages(): void {
        this.statusMessages = [];
        this.refresh();
    }


    getTreeItem(element: ReflectionTreeItem): vscode.TreeItem {
        return element;
    }

    async getChildren(element?: ReflectionTreeItem): Promise<ReflectionTreeItem[]> {
        if (!element) {
            // Root level items
            const items: ReflectionTreeItem[] = [];

            // Add start/stop reflection button
            if (this.isReflectionRunning) {
                const stopButton = new ReflectionTreeItem(
                    'Stop Reflection',
                    vscode.TreeItemCollapsibleState.None,
                    'stopButton',
                    {
                        command: 'codex-reflection.stopReflection',
                        title: 'Stop Reflection'
                    }
                );
                stopButton.iconPath = new vscode.ThemeIcon('stop');
                items.push(stopButton);
            } else {
                const startButton = new ReflectionTreeItem(
                    'Start Reflection',
                    vscode.TreeItemCollapsibleState.None,
                    'startButton',
                    {
                        command: 'codex-reflection.startReflection',
                        title: 'Start Reflection'
                    }
                );
                startButton.iconPath = new vscode.ThemeIcon('play');
                items.push(startButton);
            }

            // Add status section if there are messages or reflection is running
            if (this.statusMessages.length > 0 || this.isReflectionRunning) {
                const statusItem = new ReflectionTreeItem(
                    'Status',
                    vscode.TreeItemCollapsibleState.Expanded,
                    'statusSection'
                );
                statusItem.iconPath = new vscode.ThemeIcon('pulse');
                items.push(statusItem);
            }

            // Add settings section
            const settingsItem = new ReflectionTreeItem(
                'Settings',
                vscode.TreeItemCollapsibleState.None,
                'settingsButton',
                {
                    command: 'codex-reflection.openSettings',
                    title: 'Open Settings'
                }
            );
            settingsItem.iconPath = new vscode.ThemeIcon('settings-gear');
            items.push(settingsItem);

            // Add reports section
            const reportsItem = new ReflectionTreeItem(
                'Reports',
                vscode.TreeItemCollapsibleState.Expanded,
                'reportsSection'
            );
            reportsItem.iconPath = new vscode.ThemeIcon('files');
            items.push(reportsItem);

            return items;
        }

        if (element.contextValue === 'statusSection') {
            // Return status messages
            return this.statusMessages.map(message => {
                const item = new ReflectionTreeItem(
                    message,
                    vscode.TreeItemCollapsibleState.None,
                    'statusMessage'
                );
                item.iconPath = new vscode.ThemeIcon('info');
                return item;
            });
        }

        if (element.contextValue === 'reportsSection') {
            // Return available reports
            return this.getReportItems();
        }

        return [];
    }

    private async getReportItems(): Promise<ReflectionTreeItem[]> {
        const workspaceFolders = vscode.workspace.workspaceFolders;
        if (!workspaceFolders || workspaceFolders.length === 0) {
            return [];
        }

        const workspaceRoot = workspaceFolders[0].uri.fsPath;
        const reportsPath = path.join(workspaceRoot, 'files', 'reflection', 'html_reports');

        try {
            if (!fs.existsSync(reportsPath)) {
                return [new ReflectionTreeItem(
                    'No reports found',
                    vscode.TreeItemCollapsibleState.None,
                    'noReports'
                )];
            }

            const files = fs.readdirSync(reportsPath);
            const htmlFiles = files.filter(file => file.endsWith('.html'));

            if (htmlFiles.length === 0) {
                return [new ReflectionTreeItem(
                    'No reports found',
                    vscode.TreeItemCollapsibleState.None,
                    'noReports'
                )];
            }

            const reportItems: ReflectionTreeItem[] = [];

            for (const file of htmlFiles) {
                const filePath = path.join(reportsPath, file);
                const stats = fs.statSync(filePath);
                const reportName = path.basename(file, '.html');
                
                const item = new ReflectionTreeItem(
                    `${reportName} (${stats.mtime.toLocaleDateString()})`,
                    vscode.TreeItemCollapsibleState.None,
                    'report',
                    undefined,
                    filePath
                );

                reportItems.push(item);
            }

            return reportItems.sort((a, b) => a.label.localeCompare(b.label));
        } catch (error) {
            console.error('Error reading reports directory:', error);
            return [new ReflectionTreeItem(
                'Error reading reports',
                vscode.TreeItemCollapsibleState.None,
                'error'
            )];
        }
    }
}
