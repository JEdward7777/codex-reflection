import * as vscode from "vscode";
import { WorkerMessage } from '@/reflection/reflectionTypes';
import * as path from 'path';
import { Worker } from 'worker_threads';
import { z } from "zod";
import { callLLM } from "@/utils/llmUtils";
import { ChatMessage } from "@types";
import { zodResponseFormat } from "openai/helpers/zod";


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
    const config = vscode.workspace.getConfiguration('codex-editor-extension');
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
