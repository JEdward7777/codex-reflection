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
    console.log("debounce: 🧪 Starting addLogMessage test - Phase 1: 500 messages at 25ms, Phase 2: 20 messages at 500ms");

    if (!reflectionLogsWebviewProvider) {
        vscode.window.showErrorMessage("Logs webview provider not available for testing");
        console.error("debounce: ❌ reflectionLogsWebviewProvider is null - cannot run test");
        return;
    }

    // Clear any existing logs first
    reflectionLogsWebviewProvider.clearLogMessages();
    console.log("debounce: 🧹 Cleared existing logs");

    let messageCount = 0;
    const phase1Messages = 1000;
    const phase2Messages = 20;
    const totalMessages = phase1Messages + phase2Messages;
    const fastIntervalMs = 7;
    const slowIntervalMs = 500;

    console.log(`debounce: 📊 Test parameters:`);
    console.log(`debounce:    - Phase 1: ${phase1Messages} messages at ${fastIntervalMs}ms intervals`);
    console.log(`debounce:    - Phase 2: ${phase2Messages} messages at ${slowIntervalMs}ms intervals`);
    console.log("debounce: 🚀 Starting Phase 1 - Fast message flood...");

    const startTime = Date.now();
    let phase1EndTime: number;

    const sendFastMessage = () => {
        messageCount++;
        const timestamp = new Date().toISOString();
        const logData = {
            message: `FAST message ${messageCount} - Testing rapid debouncing behavior`,
            level: messageCount % 4 === 0 ? 'ERROR' : messageCount % 3 === 0 ? 'PROGRESS' : messageCount % 2 === 0 ? 'DEBUG' : 'INFO',
            timestamp: timestamp
        };

        // Log to console at the same time we send to addLogMessage
        console.log(`debounce: 📤 [FAST ${messageCount}/${phase1Messages}] Sending: "${logData.message}" (${logData.level}) at ${timestamp}`);

        // Send to the addLogMessage function
        reflectionLogsWebviewProvider.addLogMessage(logData);

        if (messageCount < phase1Messages) {
            setTimeout(sendFastMessage, fastIntervalMs);
        } else {
            phase1EndTime = Date.now();
            const phase1Time = phase1EndTime - startTime;
            const expectedPhase1Time = phase1Messages * fastIntervalMs;

            console.log("debounce: ✅ Phase 1 completed!");
            console.log(`debounce: 📈 Phase 1 Statistics:`);
            console.log(`debounce:    - Fast messages sent: ${phase1Messages}`);
            console.log(`debounce:    - Fast interval: ${fastIntervalMs}ms`);
            console.log(`debounce:    - Expected Phase 1 time: ${expectedPhase1Time}ms`);
            console.log(`debounce:    - Actual Phase 1 time: ${phase1Time}ms`);
            console.log(`debounce:    - Phase 1 time difference: ${phase1Time - expectedPhase1Time}ms`);

            // Wait a moment for debouncing to settle, then start Phase 2
            setTimeout(() => {
                console.log("debounce: 🐌 Starting Phase 2 - Slow message flood...");
                sendSlowMessage();
            }, 1000); // 1 second pause between phases
        }
    };

    const sendSlowMessage = () => {
        messageCount++;
        const timestamp = new Date().toISOString();
        const logData = {
            message: `SLOW message ${messageCount - phase1Messages} - Testing slow debouncing behavior`,
            level: messageCount % 4 === 0 ? 'ERROR' : messageCount % 3 === 0 ? 'PROGRESS' : messageCount % 2 === 0 ? 'DEBUG' : 'INFO',
            timestamp: timestamp
        };

        // Log to console at the same time we send to addLogMessage
        console.log(`debounce: 📤 [SLOW ${messageCount - phase1Messages}/${phase2Messages}] Sending: "${logData.message}" (${logData.level}) at ${timestamp}`);

        // Send to the addLogMessage function
        reflectionLogsWebviewProvider.addLogMessage(logData);

        if (messageCount < totalMessages) {
            setTimeout(sendSlowMessage, slowIntervalMs);
        } else {
            const endTime = Date.now();
            const totalTime = endTime - startTime;
            const phase2Time = endTime - phase1EndTime - 1000; // Subtract the 1 second pause
            const expectedPhase2Time = phase2Messages * slowIntervalMs;

            console.log("debounce: ✅ Phase 2 completed!");
            console.log(`debounce: 📈 Phase 2 Statistics:`);
            console.log(`debounce:    - Slow messages sent: ${phase2Messages}`);
            console.log(`debounce:    - Slow interval: ${slowIntervalMs}ms`);
            console.log(`debounce:    - Expected Phase 2 time: ${expectedPhase2Time}ms`);
            console.log(`debounce:    - Actual Phase 2 time: ${phase2Time}ms`);
            console.log(`debounce:    - Phase 2 time difference: ${phase2Time - expectedPhase2Time}ms`);

            console.log("debounce: 🏁 COMPLETE TEST SUMMARY:");
            console.log(`debounce:    - Total messages sent: ${totalMessages}`);
            console.log(`debounce:    - Total test time: ${totalTime}ms`);

            // Check final state
            setTimeout(() => {
                const finalLogs = reflectionLogsWebviewProvider.getLogMessages();
                console.log(`debounce: 📋 Final log count in provider: ${finalLogs.length}`);
                console.log(`debounce: 🔄 Expected max logs (due to limit): ${Math.min(totalMessages, 100)}`);

                if (finalLogs.length > 0) {
                    console.log(`debounce: 📝 First log: "${finalLogs[0].message}"`);
                    console.log(`debounce: 📝 Last log: "${finalLogs[finalLogs.length - 1].message}"`);

                    // Count how many fast vs slow messages remain
                    const fastMessages = finalLogs.filter((log: { message: string; level: string; timestamp: string; }) => log.message.includes('FAST')).length;
                    const slowMessages = finalLogs.filter((log: { message: string; level: string; timestamp: string; }) => log.message.includes('SLOW')).length;
                    console.log(`debounce: 📊 Remaining messages: ${fastMessages} FAST, ${slowMessages} SLOW`);
                }

                vscode.window.showInformationMessage(
                    `addLogMessage test completed! Sent ${totalMessages} messages (${phase1Messages} fast + ${phase2Messages} slow). Check console and logs panel for results.`
                );
            }, 200); // Wait a bit for any final debounced updates
        }
    };

    // Start Phase 1
    sendFastMessage();
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
