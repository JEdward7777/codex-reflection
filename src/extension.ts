// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
import * as vscode from 'vscode';


import { startReflectionWorker, stopReflectionWorker, quickTest, setReflectionTreeProvider, setReflectionLogsWebviewProvider } from "./reflection/reflection";
import { ReflectionTreeProvider } from "./reflection/reflectionTreeProvider";
import { ReflectionWebviewProvider, openReportInWebview } from "./reflection/reflectionWebviewProvider";
import { ReflectionLogsWebviewProvider } from "./reflection/reflectionLogsWebviewProvider";
import { ReflectionSettingsWebviewProvider } from "./reflection/reflectionSettingsWebviewProvider";


// This method is called when your extension is activated
// Your extension is activated the very first time the command is executed
export function activate(context: vscode.ExtensionContext) {

	// Use the console to output diagnostic information (console.log) and errors (console.error)
	// This line of code will only be executed once when your extension is activated
	console.log('Congratulations, your extension "codex-reflection" is now active!');

	// The command has been defined in the package.json file
	// Now provide the implementation of the command with registerCommand
	// The commandId parameter must match the command field in package.json
	context.subscriptions.push( vscode.commands.registerCommand('codex-reflection.helloWorld', () => {
		// The code you place here will be executed every time your command is executed
		// Display a message box to the user
		vscode.window.showInformationMessage('Hello World from codex-reflection!');
	}));

	//Register the command codex-reflection.reflect.
	try {
		context.subscriptions.push(
			vscode.commands.registerCommand("codex-reflection.reflect", startReflectionWorker)
		);
	} catch (error) {
		console.error("Error during refection extension activation:", error);
	}

	// //Register the quick test command codex-reflection.quick-test.
	// try {
	// 	context.subscriptions.push(
	// 		vscode.commands.registerCommand("codex-reflection.quick-test", quickTest)
	// 	);
	// } catch (error) {
	// 	console.error("Error during quick test extension activation:", error);
	// }

	// Register reflection panel
	try {
		// Register the webview provider for HTML reports
		context.subscriptions.push(ReflectionWebviewProvider.register(context));

		// Register the logs webview provider
		const logsWebviewProvider = new ReflectionLogsWebviewProvider(context.extensionUri);
		context.subscriptions.push(
			vscode.window.registerWebviewViewProvider(
				ReflectionLogsWebviewProvider.viewType,
				logsWebviewProvider
			)
		);

		// Register the settings webview provider
		const settingsWebviewProvider = new ReflectionSettingsWebviewProvider(context.extensionUri);
		context.subscriptions.push(
			vscode.window.registerWebviewViewProvider(
				ReflectionSettingsWebviewProvider.viewType,
				settingsWebviewProvider
			)
		);

		const reflectionTreeProvider = new ReflectionTreeProvider(context);
		vscode.window.createTreeView('codex-reflection-panel', {
			treeDataProvider: reflectionTreeProvider,
			showCollapseAll: true
		});

		// Connect the tree provider to the reflection module for status updates
		setReflectionTreeProvider(reflectionTreeProvider);

		// Connect the logs webview provider to the reflection module for log messages
		setReflectionLogsWebviewProvider(logsWebviewProvider);

		// Set context to show the reflection panel
		vscode.commands.executeCommand('setContext', 'codex-reflection.showReflectionPanel', true);

		// Register reflection commands
		context.subscriptions.push(
			vscode.commands.registerCommand('codex-reflection.startReflection', async () => {
				reflectionTreeProvider.setReflectionRunning(true);
				reflectionTreeProvider.addStatusMessage('Starting reflection process...');
				try {
					startReflectionWorker();
					reflectionTreeProvider.addStatusMessage('Reflection worker started successfully');
				} catch (error) {
					reflectionTreeProvider.addStatusMessage(`Error starting reflection: ${error}`);
					reflectionTreeProvider.setReflectionRunning(false);
				}
			}),

			vscode.commands.registerCommand('codex-reflection.stopReflection', async () => {
				try {
					stopReflectionWorker();
					vscode.window.showInformationMessage('Reflection process stopped');
				} catch (error) {
					vscode.window.showErrorMessage(`Error stopping reflection: ${error}`);
					reflectionTreeProvider.addStatusMessage(`Error stopping reflection: ${error}`);
				}
			}),

			vscode.commands.registerCommand('codex-reflection.refresh', () => {
				reflectionTreeProvider.refresh();
			}),

			vscode.commands.registerCommand('codex-reflection.openReport', async (item) => {
				if (item && item.reportPath) {
					await openReportInWebview(item.reportPath);
				}
			}),

			vscode.commands.registerCommand('codex-reflection.openReportInBrowser', async (item) => {
				if (item && item.reportPath) {
					const uri = vscode.Uri.file(item.reportPath);
					await vscode.env.openExternal(uri);
				}
			}),

			vscode.commands.registerCommand('codex-reflection.exportReport', async (item) => {
				if (item && item.reportPath) {
					const saveUri = await vscode.window.showSaveDialog({
						defaultUri: vscode.Uri.file(item.reportPath),
						filters: {
							'HTML Files': ['html']
						}
					});
					if (saveUri) {
						await vscode.workspace.fs.copy(vscode.Uri.file(item.reportPath), saveUri);
						vscode.window.showInformationMessage(`Report exported to ${saveUri.fsPath}`);
					}
				}
			}),

			vscode.commands.registerCommand('codex-reflection.openSettings', async () => {
				await vscode.commands.executeCommand('codex-reflection.settingsView.focus');
			})
		);
	} catch (error) {
		console.error("Error during reflection panel activation:", error);
	}

}

// This method is called when your extension is deactivated
export function deactivate() {}
