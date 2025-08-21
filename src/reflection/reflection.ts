import * as vscode from "vscode";
import { WorkerMessage } from './reflectionTypes';
import * as path from 'path';
import { Worker } from 'worker_threads';


let reflectionWorker: Worker | null = null;
let reflectionTreeProvider: any = null; // Will be set by the extension
let reflectionLogsWebviewProvider: any = null; // Will be set by the extension

export function setReflectionTreeProvider(provider: any) {
    reflectionTreeProvider = provider;
}

export function setReflectionLogsWebviewProvider(provider: any) {
    reflectionLogsWebviewProvider = provider;
}

export async function quickTest() {
    console.log("debounce: 🧪 Starting addLogMessage test - sending 100 messages at 25ms intervals");

    if (!reflectionLogsWebviewProvider) {
        vscode.window.showErrorMessage("Logs webview provider not available for testing");
        console.error("debounce: ❌ reflectionLogsWebviewProvider is null - cannot run test");
        return;
    }

    // Clear any existing logs first
    reflectionLogsWebviewProvider.clearLogMessages();
    console.log("debounce: 🧹 Cleared existing logs");

    let messageCount = 0;
    const totalMessages = 100;
    const intervalMs = 7;

    console.log(`debounce: 📊 Test parameters: ${totalMessages} messages, ${intervalMs}ms intervals`);
    console.log("debounce: 🚀 Starting message flood...");

    const startTime = Date.now();

    const sendMessage = () => {
        messageCount++;
        const timestamp = new Date().toISOString();
        const logData = {
            message: `Test message ${messageCount} - Testing debouncing behavior`,
            level: messageCount % 4 === 0 ? 'ERROR' : messageCount % 3 === 0 ? 'PROGRESS' : messageCount % 2 === 0 ? 'DEBUG' : 'INFO',
            timestamp: timestamp
        };

        // Log to console at the same time we send to addLogMessage
        console.log(`debounce: 📤 [${messageCount}/${totalMessages}] Sending: "${logData.message}" (${logData.level}) at ${timestamp}`);

        // Send to the addLogMessage function
        reflectionLogsWebviewProvider.addLogMessage(logData);

        if (messageCount < totalMessages) {
            setTimeout(sendMessage, intervalMs);
        } else {
            const endTime = Date.now();
            const totalTime = endTime - startTime;
            const expectedTime = totalMessages * intervalMs;

            console.log("debounce: ✅ Test completed!");
            console.log(`debounce: 📈 Statistics:`);
            console.log(`debounce:    - Messages sent: ${totalMessages}`);
            console.log(`debounce:    - Interval: ${intervalMs}ms`);
            console.log(`debounce:    - Expected total time: ${expectedTime}ms`);
            console.log(`debounce:    - Actual total time: ${totalTime}ms`);
            console.log(`debounce:    - Time difference: ${totalTime - expectedTime}ms`);

            // Check final state
            setTimeout(() => {
                const finalLogs = reflectionLogsWebviewProvider.getLogMessages();
                console.log(`debounce: 📋 Final log count in provider: ${finalLogs.length}`);
                console.log(`debounce: 🔄 Expected max logs (due to limit): ${Math.min(totalMessages, 100)}`);

                if (finalLogs.length > 0) {
                    console.log(`debounce: 📝 First log: "${finalLogs[0].message}"`);
                    console.log(`debounce: 📝 Last log: "${finalLogs[finalLogs.length - 1].message}"`);
                }

                vscode.window.showInformationMessage(
                    `addLogMessage test completed! Sent ${totalMessages} messages. Check console and logs panel for results.`
                );
            }, 200); // Wait a bit for any final debounced updates
        }
    };

    // Start the test
    sendMessage();
}

export function startReflectionWorker() {
    //Test if it's already running.
    if (reflectionWorker === null) {
        reflectionWorker = new Worker(path.join(__dirname, "./reflectionWorker.js"));

        reflectionWorker.on('exit', (code) => {
            console.log(`Reflection worker exited with code ${code}`);
            reflectionWorker = null;
            // Notify UI that worker has stopped
            if (reflectionTreeProvider) {
                reflectionTreeProvider.setReflectionRunning(false);
                if (code === 0) {
                    reflectionTreeProvider.addStatusMessage('Reflection completed successfully');
                    reflectionTreeProvider.refresh(); // Refresh to show new reports
                } else {
                    reflectionTreeProvider.addStatusMessage(`Reflection exited with code ${code}`);
                }
            }
        });

        reflectionWorker.on('message', async (message: WorkerMessage) => {
            try {
                if (message.command === "getWorkspaceFolders") {
                    reflectionWorker?.postMessage({
                        command: "respond",
                        requestId: message.requestId,
                        content: vscode.workspace.workspaceFolders
                    });
                } else if (message.command === "getConfigurationOption") {
                    const configKey = message.content as string;
                    const configValue = vscode.workspace.getConfiguration().get(configKey);
                    reflectionWorker?.postMessage({
                        command: "respond",
                        requestId: message.requestId,
                        content: configValue
                    });
                } else if (message.command === "showError") {
                    const errorMessage = message.content as string;
                    vscode.window.showErrorMessage(errorMessage);
                    // Also add to status messages in UI
                    if (reflectionTreeProvider) {
                        reflectionTreeProvider.addStatusMessage(`Error: ${errorMessage}`);
                    }
                    reflectionWorker?.postMessage({
                        command: "respond",
                        requestId: message.requestId,
                        content: null,
                    });
                } else if (message.command === "showInformationMessage") {
                    const infoMessage = message.content as string;
                    vscode.window.showInformationMessage(infoMessage);
                    // Also add to status messages in UI
                    if (reflectionTreeProvider) {
                        reflectionTreeProvider.addStatusMessage(infoMessage);
                        // If this is the completion message, stop the running state
                        if (infoMessage.includes('finished')) {
                            reflectionTreeProvider.setReflectionRunning(false);
                            reflectionTreeProvider.refresh(); // Refresh to show new reports
                        }
                    }
                    reflectionWorker?.postMessage({
                        command: "respond",
                        requestId: message.requestId,
                        content: null,
                    });
                } else if (message.command === "logToPanel") {
                    const logData = message.content as { message: string; level: string; timestamp: string; };
                    // Forward log message to logs webview provider
                    if (reflectionLogsWebviewProvider) {
                        reflectionLogsWebviewProvider.addLogMessage(logData);
                    }
                    reflectionWorker?.postMessage({
                        command: "respond",
                        requestId: message.requestId,
                        content: null,
                    });
                }
            } catch (e) {
                if (message.requestId) {
                    reflectionWorker?.postMessage({
                        command: "respond",
                        requestId: message.requestId,
                        content: null,
                        error: e
                    });
                }
            }
        });
    } else {
        console.log("Reflection worker is already running.");
    }
}

export function isReflectionWorkerRunning(): boolean {
    return reflectionWorker !== null;
}
