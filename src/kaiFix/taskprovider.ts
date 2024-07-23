import * as vscode from 'vscode';
import fetch from 'node-fetch';

export interface Requests {
    id: number;
    name: string;
    type: 'kai' | 'kantra';
    file: string; 
    data: any;
}

let taskcounter = 0;
let requests: Requests[] = [];
const fileStateMap: Map<string, { inProgress: boolean, taskExecution?: vscode.TaskExecution }> = new Map(); 

export const runningTasks = new Map<number, { taskExecution: vscode.TaskExecution, workerType: 'kai' | 'kantra' }>();

export function getTaskCounter() {
    return taskcounter;
}

export function incrementTaskCounter() {
    return ++taskcounter;
}

export function getRequests() {
    return requests;
}

export function addRequest(request: Requests) {
    requests.push(request);
    console.log(`Task added to queue: ${JSON.stringify(request)}`);
}

export function removeRequestById(id: number) {
    requests = requests.filter(request => request.id !== id);
}

export class ProcessController {
    private maxKaiWorkers: number;
    private maxKantraWorkers: number;
    private activeKaiTasks: Set<number>;
    private activeKantraTasks: Set<number>;
    private outputChannel: vscode.OutputChannel;
    private kaiFixDetails: any;

    constructor(maxKaiWorkers: number, maxKantraWorkers: number, outputChannel: vscode.OutputChannel, kaiFixDetails: any) {
        this.maxKaiWorkers = maxKaiWorkers;
        this.maxKantraWorkers = maxKantraWorkers;
        this.activeKaiTasks = new Set();
        this.activeKantraTasks = new Set();
        this.outputChannel = outputChannel;
        this.kaiFixDetails = kaiFixDetails;
        this.pollQueue();
    }

    private async pollQueue() {
        while (true) {
            await this.processQueue();
            await this.sleep(1000); 
        }
    }

    private sleep(ms: number) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    async processQueue() {
        for (const task of requests) {
            if (task.type === "kai" && this.activeKaiTasks.size < this.maxKaiWorkers) {
                if (this.isFileInProgress(task.file)) continue; // Skip if file is already in progress
                this.activeKaiTasks.add(task.id);
                this.updateFileState(task.file, { inProgress: true, taskExecution: undefined });
                this.startTask(task);
                requests = requests.filter(req => req.id !== task.id);
            } else if (task.type === "kantra" && this.activeKantraTasks.size < this.maxKantraWorkers) {
                if (this.isFileInProgress(task.file)) continue; // Skip if file is already in progress
                this.activeKantraTasks.add(task.id);
                this.updateFileState(task.file, { inProgress: true, taskExecution: undefined });
                this.startTask(task);
                requests = requests.filter(req => req.id !== task.id);
            }
        }
    }

    private isFileInProgress(filePath: string): boolean {
        return fileStateMap.get(filePath)?.inProgress || false;
    }

    private updateFileState(filePath: string, state: { inProgress: boolean, taskExecution?: vscode.TaskExecution }) {
        const currentState = fileStateMap.get(filePath) || {};
        fileStateMap.set(filePath, { ...currentState, ...state });
    }

    async startTask(request: Requests) {
        this.outputChannel.appendLine(`Starting task: ${JSON.stringify(request)}`);
        const task = new vscode.Task(
            { type: 'mytask', task: request.name, requestType: request.type },
            vscode.TaskScope.Workspace,
            request.name,
            'myTaskProvider',
            new vscode.CustomExecution(async (): Promise<vscode.Pseudoterminal> => {
                return new SimplePseudoterminal(request, this.outputChannel, this);
            })
        );

        const execution = await vscode.tasks.executeTask(task);
        runningTasks.set(request.id, { taskExecution: execution, workerType: request.type });
        this.updateFileState(request.file, { inProgress: true, taskExecution: execution }); // Track task execution
    }

    async completeTask(request: Requests, result: any) {
        if (request.type === "kai") {
            this.activeKaiTasks.delete(request.id);
        } else if (request.type === "kantra") {
            this.activeKantraTasks.delete(request.id);
        }
        runningTasks.delete(request.id);
        this.updateFileState(request.file, { inProgress: false, taskExecution: undefined }); // Update file state
        this.outputChannel.appendLine(`Completed task: ${JSON.stringify(request)}`);
        this.kaiFixDetails.handleTaskResult(request.file, result); // Send result back to KaiFixDetails
        this.processQueue(); // Check for next task in the queue
    }

    async cancelTask(id: number) {
        this.outputChannel.appendLine(`Cancelling task with id - ${id}`);
        const exeProcess = runningTasks.get(id);
        if (exeProcess) {
            exeProcess.taskExecution.terminate();
            runningTasks.delete(id);
            this.outputChannel.appendLine(`Task ${id} cancelled.`);

            if (exeProcess.workerType === 'kai') {
                this.activeKaiTasks.delete(id);
            } else if (exeProcess.workerType === 'kantra') {
                this.activeKantraTasks.delete(id);
            }

            // Update file state
            const file = [...fileStateMap.entries()].find(([, state]) => state.taskExecution === exeProcess.taskExecution)?.[0];
            if (file) {
                this.updateFileState(file, { inProgress: false, taskExecution: undefined });
            }
        } else {
            requests = requests.filter(task => task.id !== id);
            this.outputChannel.appendLine(`Task ${id} removed from queue.`);
        }
        this.processQueue(); // Check for available tasks after cancellation
    }
}

class SimplePseudoterminal implements vscode.Pseudoterminal {
    private readonly writeEmitter = new vscode.EventEmitter<string>();
    private readonly closeEmitter = new vscode.EventEmitter<void>();
    private readonly request: Requests;
    private outputChannel: vscode.OutputChannel;
    private controller: ProcessController;

    onDidWrite: vscode.Event<string> = this.writeEmitter.event;
    onDidClose?: vscode.Event<void> = this.closeEmitter.event;

    constructor(request: Requests, outputChannel: vscode.OutputChannel, controller: ProcessController) {
        this.request = request;
        this.outputChannel = outputChannel;
        this.controller = controller;
    }

    open(initialDimensions: vscode.TerminalDimensions | undefined): void {
        this.runTask();
    }

    close(): void {}

    private async runTask(): Promise<void> {
        if (!runningTasks.has(this.request.id)) {
            this.closeEmitter.fire();
            return;
        }

        let result: any;
        if (this.request.type === 'kai') {
            result = await this.callKaiBackend();
        } else if (this.request.type === 'kantra') {
            result = await this.runKantraBinary();
        }

        if (runningTasks.has(this.request.id)) {
            this.closeEmitter.fire();
            this.controller.completeTask(this.request, result);
        }
    }

    private async callKaiBackend(): Promise<any> {
        this.outputChannel.appendLine(`Calling Kai backend for task ${this.request.name}`);
        
        const postData = this.request.data;

        const url = 'http://0.0.0.0:8080/get_incident_solutions_for_file';
        const headers = {
            'Content-Type': 'application/json',
        };

        try {
            const response = await fetch(url, {
                method: 'POST',
                headers: headers,
                body: JSON.stringify(postData),
            });

            if (!response.ok) {
                this.outputChannel.appendLine(`Error: ${response.statusText}`);
                return { error: `HTTP error! status: ${response.status}` };
            }

            const responseText = await response.text();
            this.outputChannel.appendLine(`Kai backend processed for task ${this.request.name}`);
            return { result: responseText }; // Replace with actual result
        } catch (error) {
            this.outputChannel.appendLine(`Error making POST request: ${error}`);
            return { error: `Failed to perform the operation. ${error}` };
        }
    }

    private async runKantraBinary(): Promise<any> {
        this.outputChannel.appendLine(`Running Kantra task for task ${this.request.name}`);
        // Simulate an async task that runs the binary and gets a result
        return new Promise<any>((resolve) => {
            setTimeout(() => {
                if (!runningTasks.has(this.request.id)) {
                    resolve({});
                    return;
                }
                this.outputChannel.appendLine(`hi from kantra`);
                resolve({ result: "Kantra binary result" }); // Replace with actual result
            }, 120000); // Simulate task duration of 2 minutes
        });
    }
}

export class MyTaskProvider implements vscode.TaskProvider {
    private processController: ProcessController;

    constructor(outputChannel: vscode.OutputChannel, kaiFixDetails: any) {
        this.processController = new ProcessController(2, 2, outputChannel, kaiFixDetails); // Initialize with 2 kai and 2 kantra workers
    }

    provideTasks(token: vscode.CancellationToken): vscode.ProviderResult<vscode.Task[]> {
        return [];
    }

    resolveTask(task: vscode.Task, token: vscode.CancellationToken): vscode.ProviderResult<vscode.Task> {
        return undefined;
    }

    cancelTask(id: number) {
        this.processController.cancelTask(id);
    }
    processQueue() {
        this.processController.processQueue();
    }
}
