import { WorkerMessage } from "./reflectionTypes";
import { parentPort } from "node:worker_threads";
import { Uri } from "vscode";

let nextRequestId: number = 0;

//callbacks a map from a number to a resolve or reject function
//const callbackPairs : Map<number, [Function, Function]> = new Map();
const callbackPairs: Map<number, [(value: WorkerMessage) => void, (reason: any) => void]> = new Map();

function postMessageWithResponse(message: WorkerMessage): Promise<WorkerMessage> {
    const requestId: number = nextRequestId++;
    const p = new Promise<WorkerMessage>((resolve, reject) => callbackPairs.set(requestId, [resolve, reject]));

    const out_message: WorkerMessage = {
        ...message,
        requestId
    };

    parentPort?.postMessage(out_message);
    return p;
}


parentPort?.on("message", (message: WorkerMessage) => {
    if (message.command === "respond") {
        const callBackPair = callbackPairs.get(message.requestId!);
        if (callBackPair) {
            const [resolve, reject] = callBackPair;
            if (message.error) {
                reject(message);
            } else {
                resolve(message);
            }
            callbackPairs.delete(message.requestId!);
        }
    }
});

async function getWorkspaceFolders(): Promise<{ index: number, name: string, uri: Uri; }[] | undefined> {
    return (await postMessageWithResponse({
        command: "getWorkspaceFolders"
    })).content;
}

export async function getFirstWorkspaceFolder(): Promise<string> {
    const folders = await getWorkspaceFolders();
    const folder = folders && folders[0] ? folders[0].uri.path : '';
    return folder;
}

export async function getConfigurationOption(key: string): Promise<any> {
    const response = await postMessageWithResponse({
        command: "getConfigurationOption",
        content: key,
    });
    return response.content;
}

export async function postMessageAndShowError(message: string): Promise<void> {
    await postMessageWithResponse({
        command: "showError",
        content: message,
    });
}

export async function postMessageAndShowInfo(message: string): Promise<void> {
    await postMessageWithResponse({
        command: "showInformationMessage",
        content: message,
    });
}

export async function logToPanel(message: string, level: 'INFO' | 'DEBUG' | 'PROGRESS' | 'ERROR' = 'INFO'): Promise<void> {
    await postMessageWithResponse({
        command: "logToPanel",
        content: { message, level, timestamp: new Date().toISOString() },
    });
}
