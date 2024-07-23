/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Red Hat. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
import { ExtensionContext, commands, window } from 'vscode';
import { IHint } from '../server/analyzerModel';
import { rhamtEvents } from '../events';
import { ModelService } from '../model/modelService';
import { FileNode } from '../tree/fileNode';
import * as vscode from 'vscode';
import * as os from 'os';
import * as path from 'path';
import { MyTaskProvider, Requests, addRequest, incrementTaskCounter } from './taskprovider';

interface FileState {
    inProgress: boolean;
    taskExecution?: vscode.TaskExecution;
    tempFileUri?: vscode.Uri;
    originalFilePath?: string;
}

export class KaiFixDetails {
    onEditorClosed = new rhamtEvents.TypedEvent<void>();
    public context: ExtensionContext;
    private kaiScheme = 'kaifixtext';
    private outputChannel: vscode.OutputChannel;
    private fileStateMap: Map<string, FileState> = new Map();
    private taskProvider: MyTaskProvider;
    private myWebViewProvider: MyWebViewProvider;
    private openedDiffEditor: vscode.TextEditor | undefined;

    constructor(context: ExtensionContext, modelService: ModelService) {
        this.context = context;
        this.outputChannel = vscode.window.createOutputChannel("Kai-Fix All");
        this.taskProvider = new MyTaskProvider(this.outputChannel, this);
        this.myWebViewProvider = new MyWebViewProvider(this);
        this.registerContentProvider();

        const watcher = vscode.workspace.createFileSystemWatcher('**/*', false, false, false);
        watcher.onDidChange(uri => {
            console.log(`File changed: ${uri.fsPath}`);
            vscode.window.showInformationMessage(`File changed: ${uri.fsPath}`);
        });
        context.subscriptions.push(watcher);

        this.context.subscriptions.push(commands.registerCommand('rhamt.Stop', async item => {
            const fileNode = item as FileNode;
            this.stopFileProcess(fileNode.file);
        }));

        context.subscriptions.push(
            vscode.window.registerWebviewViewProvider(
                MyWebViewProvider.viewType,
                this.myWebViewProvider
            )
        );

        this.context.subscriptions.push(commands.registerCommand('rhamt.acceptChanges', this.acceptChangesCommandHandler.bind(this)));
        this.context.subscriptions.push(commands.registerCommand('rhamt.rejectChanges', this.rejectChangesCommandHandler.bind(this)));

        this.context.subscriptions.push(commands.registerCommand('rhamt.Kai-Fix-Files', async item => {
            const fileNode = item as FileNode;
            const filePath = fileNode.file;

            if (this.fileStateMap.get(filePath)?.inProgress) {
                vscode.window.showInformationMessage(`Process already running for file: ${filePath}`);
                return;
            }

            const issueByFileMap = fileNode.getConfig()._results.model.issueByFile;
            const issueByFile = issueByFileMap.get(fileNode.file);
            const fs = require('fs').promises;
            this.outputChannel.show(true);
            const workspaceFolder = vscode.workspace.workspaceFolders[0].name;
            this.outputChannel.appendLine("Generating the fix: ");
            this.outputChannel.appendLine(`Appname Name: ${workspaceFolder}.`);
            this.outputChannel.appendLine(`Incidents: ${JSON.stringify(this.formatHintsToIncidents(issueByFile), null, 2)}`);
            const content = await fs.readFile(filePath, { encoding: 'utf8' });

            const incidents = issueByFile ? this.formatHintsToIncidents(issueByFile) : [];

            const postData = {
                file_name: filePath.replace(vscode.workspace.workspaceFolders[0].uri.path + "/", ""),
                file_contents: content,
                application_name: workspaceFolder,
                incidents: incidents,
                include_llm_results: "True"
            };

            const request: Requests = {
                id: incrementTaskCounter(),
                name: `KaiFixTask-${fileNode.file}`,
                type: 'kai',
                file: filePath,
                data: postData
            };

            addRequest(request);
            this.taskProvider.processQueue();
        }));
    }

    private updateFileState(filePath: string, state: Partial<FileState>) {
        const currentState = this.fileStateMap.get(filePath) || { inProgress: false };
        this.fileStateMap.set(filePath, { ...currentState, ...state });
    }

    private stopFileProcess(filePath: string) {
        const state = this.fileStateMap.get(filePath);
        if (state && state.taskExecution) {
            this.taskProvider.cancelTask(state.taskExecution.task.definition.id);
            this.updateFileState(filePath, { inProgress: false, taskExecution: undefined });
            vscode.window.showInformationMessage(`Process stopped for file: ${filePath}`);
        } else {
            vscode.window.showInformationMessage(`No process running for file: ${filePath}`);
        }
    }

    public handleTaskResult(filePath: string, result: any) {
        this.outputChannel.appendLine(`Result received for file ${filePath}: ${JSON.stringify(result)}`);
        this.updateFileState(filePath, { inProgress: false, taskExecution: undefined });

        if (result.error) {
            vscode.window.showErrorMessage(result.error);
            return;
        }

        const responseText = result.result;
        console.log(responseText);

        const updatedFile = this.extractUpdatedFile(responseText);
        const virtualDocumentUri = vscode.Uri.parse(`${this.kaiScheme}:${filePath}`);

        this.outputChannel.appendLine(`---- Updated File: ---- \n${updatedFile}`);

        const tempFileName = 'Kai-fix-All-' + this.getFileName(filePath);
        this.outputChannel.appendLine(`Temp Filename: ${tempFileName}.`);
        this.writeToTempFile(updatedFile, tempFileName).then((tempFileUri) => {
            this.updateFileState(filePath, { tempFileUri, originalFilePath: filePath });

            vscode.commands.executeCommand('vscode.diff', virtualDocumentUri, tempFileUri, `Current ⟷ KaiFix`, {
                preview: true,
            }).then(() => {
                const editor = vscode.window.activeTextEditor;
                if (editor) {
                    this.openedDiffEditor = editor;
                    this.watchDiffEditorClose();
                }
            });
        }).catch(error => {
            this.outputChannel.appendLine(`Error writing to temp file: ${error}`);
            vscode.window.showErrorMessage(`Error writing to temp file: ${error}`);
        });
    }

    private registerContentProvider() {
        const provider = new (class implements vscode.TextDocumentContentProvider {
            onDidChangeEmitter = new vscode.EventEmitter<vscode.Uri>();
            onDidChange = this.onDidChangeEmitter.event;
            provideTextDocumentContent(uri: vscode.Uri): Thenable<string> {
                const filePath = uri.path;
                const fileUri = vscode.Uri.file(filePath);
                return vscode.workspace.fs.readFile(fileUri).then(buffer => {
                    return buffer.toString();
                });
            }
        })();
        this.context.subscriptions.push(vscode.workspace.registerTextDocumentContentProvider(this.kaiScheme, provider));
    }

    private async writeToTempFile(content: string, kaifixFilename: string): Promise<vscode.Uri> {
        const tempFilePath = path.join(os.tmpdir(), kaifixFilename);
        const tempFileUri = vscode.Uri.file(tempFilePath);
        const encoder = new TextEncoder();
        const uint8Array = encoder.encode(content);
        await vscode.workspace.fs.writeFile(tempFileUri, uint8Array);
        return tempFileUri;
    }

    private extractUpdatedFile(jsonResponse: string): string {
        try {
            const responseObj = JSON.parse(jsonResponse);

            if ('updated_file' in responseObj) {
                const updatedFileContent = responseObj.updated_file;
                return updatedFileContent || 'No content available in updated_file.';
            } else {
                vscode.window.showInformationMessage('The "updated_file" property does not exist in the response object.');
                return 'The "updated_file" property does not exist in the response object.';
            }
        } catch (error) {
            vscode.window.showInformationMessage('Failed to parse jsonResponse:', error);
            return 'An error occurred while parsing the JSON response.';
        }
    }

    private getFileName(filePath: string): string {
        const segments = filePath.split('/');
        const fileName = segments.pop();
        return fileName || '';
    }

    private watchDiffEditorClose(): void {
        this.context.subscriptions.push(window.onDidChangeActiveTextEditor(this.handleActiveEditorChange.bind(this)));
        this.context.subscriptions.push(vscode.window.onDidChangeWindowState(windowState => {
            if (windowState.focused) {
                this.handleActiveEditorChange(vscode.window.activeTextEditor);
            }
        }));
    }

    private handleActiveEditorChange(editor?: vscode.TextEditor): void {
        let diffFocused = false;

        if (editor) {
            const activeDocumentUri = editor.document.uri;
            const fileState = Array.from(this.fileStateMap.values()).find(state =>
                activeDocumentUri.toString() === state.tempFileUri?.toString()
            );

            if (fileState) {
                diffFocused = true;
                this.openedDiffEditor = editor;
            }
        }

        this.myWebViewProvider.updateWebview(diffFocused);
    }

    private async saveSpecificFile(tempFileUri: vscode.Uri): Promise<boolean> {
        const editor = vscode.window.visibleTextEditors.find(editor => editor.document.uri.toString() === tempFileUri.toString());
        if (editor) {
            await vscode.commands.executeCommand('workbench.action.files.save');
            return true;
        }
        return false;
    }

    private async applyChangesAndDeleteTempFile(originalFilePath: string, tempFileUri: vscode.Uri): Promise<void> {
        try {
            const saved = await this.saveSpecificFile(tempFileUri);
            if (saved) {
                const tempFileContent = await vscode.workspace.fs.readFile(tempFileUri);
                await vscode.workspace.fs.writeFile(vscode.Uri.file(originalFilePath), tempFileContent);
                await vscode.workspace.fs.delete(tempFileUri);
                if (this.openedDiffEditor) {
                    await this.closeEditor(this.openedDiffEditor);
                }
                vscode.window.showInformationMessage('Changes applied successfully.');
            } else {
                vscode.window.showInformationMessage('Temp file was not open in an editor, or it was not dirty.');
            }
        } catch (error) {
            console.error('Failed to apply changes or delete temporary file:', error);
            vscode.window.showErrorMessage('Failed to apply changes to the original file.');
        }
    }

    private async closeEditor(editor: vscode.TextEditor): Promise<void> {
        await vscode.commands.executeCommand('workbench.action.closeActiveEditor');
    }

    private resetState(): void {
        this.openedDiffEditor = undefined;
    }

    public async rejectChangesCommandHandler(): Promise<void> {
        if (this.openedDiffEditor) {
            await vscode.workspace.fs.delete(this.openedDiffEditor.document.uri);
            await this.closeEditor(this.openedDiffEditor);
            this.resetState();
        }
    }

    public async acceptChangesCommandHandler(): Promise<void> {
        const fileState = Array.from(this.fileStateMap.values()).find(state =>
            this.openedDiffEditor?.document.uri.toString() === state.tempFileUri?.toString()
        );
        if (!fileState || !fileState.tempFileUri || !fileState.originalFilePath) {
            vscode.window.showErrorMessage("No changes to apply.");
            return;
        }
        await this.applyChangesAndDeleteTempFile(fileState.originalFilePath, fileState.tempFileUri);
        this.resetState();
    }

    public async handleMessage(message: any): Promise<void> {
        switch (message.command) {
            case 'acceptChanges':
                await this.acceptChangesCommandHandler();
                break;
            case 'rejectChanges':
                await this.rejectChangesCommandHandler();
                break;
        }
    }

    private formatHintsToIncidents(hints: IHint[]) {
        return hints.map(hint => ({
            violation_name: hint.ruleId,
            ruleset_name: hint.rulesetName,
            incident_variables: {
                file: hint.variables['file'] || '',
                kind: hint.variables['kind'] || '',
                name: hint.variables['name'] || '',
                package: hint.variables['package'] || '',
            },
            line_number: hint.lineNumber,
            analysis_message: hint.hint,
        }));
    }
}

export class MyWebViewProvider implements vscode.WebviewViewProvider {
    private nonce: string;
    private _view?: vscode.WebviewView;

    constructor(private readonly kaiFixDetails: KaiFixDetails) {
        this.kaiFixDetails = kaiFixDetails;
        this.nonce = getNonce();
    }
    public static readonly viewType = 'myWebView';

    public resolveWebviewView(
        webviewView: vscode.WebviewView,
        context: vscode.WebviewViewResolveContext,
        token: vscode.CancellationToken,
    ): void {
        this._view = webviewView;
        this._view.webview.options = { enableScripts: true };
        this._view.webview.html = this.getDefaultHtmlForWebview();

        this._view.webview.onDidReceiveMessage(async (message) => {
            await this.kaiFixDetails.handleMessage(message);
        }, undefined, this.kaiFixDetails.context.subscriptions);
    }

    public updateWebview(diffFocused: boolean): void {
        if (this._view) {
            this._view.webview.html = diffFocused
                ? this.getHtmlForWebview()
                : this.getDefaultHtmlForWebview();
        }
    }

    private getHtmlForWebview(): string {
        return `
        <!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${this.nonce}';">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Kai Fix Actions</title>
    <style>
        body {
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
            padding: 10px;
            display: flex;
            flex-direction: column;
            align-items: center;
        }
        .explanation {
            margin-bottom: 20px;
            text-align: center;
        }
        .button {
            padding: 9px 18px;
            margin: 6px 0;
            border: none;
            border-radius: 3px;
            font-size: 12px;
            cursor: pointer;
            outline: none;
            box-shadow: 0 2px 4px rgba(0,0,0,0.2);
            transition: all 0.3s ease;
            display: flex;
            align-items: center;
            justify-content: center;
            width: 55%;
            box-sizing: border-box;
        }
        #acceptButton {
            background-color: #4CAF50;
            color: white;
        }
        #acceptButton::before {
            content: '✔️';
            margin-right: 10px;
        }
        #rejectButton {
            background-color: #f44336;
            color: white;
        }
        #rejectButton::before {
            content: '❌';
            margin-right: 10px;
        }
        #acceptButton:hover, #rejectButton:hover {
            opacity: 0.85;
        }
        #acceptButton:active, #rejectButton:active {
            box-shadow: 0 1px 3px rgba(0,0,0,0.2);
            transform: translateY(2px);
        }
    </style>
</head>
<body>
    <div class="explanation">
        Clicking 'Accept' will save the proposed changes and replace the original file with these changes.
    </div>
    <button id="acceptButton" class="button">Accept Changes</button>
    <button id="rejectButton" class="button">Reject Changes</button>
    <script nonce="${this.nonce}">
    const vscode = acquireVsCodeApi();
    document.getElementById('acceptButton').addEventListener('click', () => {
        vscode.postMessage({ command: 'acceptChanges' });
    });
    document.getElementById('rejectButton').addEventListener('click', () => {
        vscode.postMessage({ command: 'rejectChanges' });
    });
    </script>
</body>
</html>
        `;
    }

    private getDefaultHtmlForWebview(): string {
        return `
        <!DOCTYPE html>
        <html lang="en">
        <head>
            <meta charset="UTF-8">
            <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${this.nonce}';">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <style>
                body, html {
                    height: 70%;
                    margin: 0;
                    display: flex;
                    justify-content: center;
                    align-items: center;
                    text-align: center;
                    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
                }
                .message {
                    font-size: 12px;
                }
            </style>
        </head>
        <body>
            <div class="message">No action required at this time</div>
        </body>
        </html>
    `;
    }
}

function getNonce() {
    let text = '';
    const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    for (let i = 0; i < 16; i++) {
        text += possible.charAt(Math.floor(Math.random() * possible.length));
    }
    return text;
}
