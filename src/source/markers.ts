/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Red Hat. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
import * as vscode from 'vscode';
import { window, ThemeColor } from 'vscode';
import { ModelService } from '../model/modelService';
import { Incident } from '../server/fileIncidentUtil';

export const HINT = 'migration';

export class MarkerService {

    private diagnostics = vscode.languages.createDiagnosticCollection("cli");
    private unfixedHintDecorationType = window.createTextEditorDecorationType({
        backgroundColor: new ThemeColor('editor.stackFrameHighlightBackground')
    });

    constructor(
        private context: vscode.ExtensionContext, 
        private modelService: ModelService) {
            this.initMarkerSupport();
    }

    private initMarkerSupport(): void {
        const context = this.context;
        context.subscriptions.push(this.diagnostics);
        context.subscriptions.push(
            vscode.window.onDidChangeActiveTextEditor(editor => {
                this.refreshHints(editor.document, editor);
            })
        );
        context.subscriptions.push(
            vscode.workspace.onDidChangeTextDocument(e => this.refreshHints(e.document)));
        context.subscriptions.push(
            vscode.workspace.onDidOpenTextDocument(doc => this.refreshHints(doc)));
        context.subscriptions.push(
            vscode.workspace.onDidCloseTextDocument(doc => {
                this.diagnostics.delete(doc.uri);
            }
        ));
        this.refreshOpenEditors();
    }

    public refreshOpenEditors(file?: string): void {
        const activeEditor = vscode.window.activeTextEditor;
        if (activeEditor) {
            this.refreshHints(activeEditor.document, activeEditor);
        }
        if (!file) {
            vscode.window.visibleTextEditors.forEach(editor => {
                if (editor != activeEditor) {
                    this.refreshHints(editor.document, editor);
                }
            });
        }
        else {
            vscode.window.visibleTextEditors.filter(editor => editor.document.uri.fsPath === file).forEach(editor => {
                if (editor != activeEditor) {
                    this.refreshHints(editor.document, editor);
                }
            }); 
        }
    }

    // private refreshHints(doc: vscode.TextDocument, editor?: vscode.TextEditor): void {
    //     try {
    //         const diagnostics: vscode.Diagnostic[] = [];
    //         const decorations = [new vscode.Range(0, 0, 0, 0)];
    //         this.diagnostics.delete(doc.uri);
    //         this.modelService.getActiveHints().filter(issue => doc.uri.fsPath === issue.file).forEach(issue => {
    //             try {
    //                 const diagnostic = this.createDiagnostic(doc, issue);
    //                 if (diagnostic) {
    //                     diagnostics.push(diagnostic);
    //                     const lineNumber = issue.lineNumber-1;
    //                     const range = new vscode.Range(lineNumber, issue.column, lineNumber, issue.length+issue.column);
    //                     decorations.push(range);
    //                 }
    //             } 
    //             catch (e) {
    //                 console.log('Error creating incident diagnostic.');
    //                 console.log(e);                    
    //             }
    //         });
    //         try {
    //             if (diagnostics.length > 0) {
    //                 this.diagnostics.set(doc.uri, diagnostics);
    //             }
    //             if (editor) {
    //                 editor.setDecorations(this.unfixedHintDecorationType, decorations);
    //             }
    //         }
    //         catch (e) {
    //             console.log('Error setting incident diagnostic.');
    //             console.log(e);
    //         }
    //     }
    //     catch (e) {
    //         console.log(e);
    //     }
    // }

    private refreshHints(doc: vscode.TextDocument, editor?: vscode.TextEditor): void {
        try {
            const diagnostics: vscode.Diagnostic[] = [];
            const decorations: vscode.Range[] = [];
            this.diagnostics.delete(doc.uri);
    
            // Get the active configuration and its incident manager
            const config = this.modelService.getActiveConfigurationForFile(doc.uri.fsPath);
            if (!config || !config.incidentManager) {
                return;
            }
            const incidentManager = config.incidentManager;
    
            // Get incidents for this file
            const incidents = incidentManager.getIncidentsForFile(doc.uri.fsPath) || [];
    
            incidents.forEach(incident => {
                try {
                    const diagnostic = this.createDiagnostic(doc, incident);
                    if (diagnostic) {
                        diagnostics.push(diagnostic);
                        const lineNumber = incident.lineNumber - 1;
                        const range = new vscode.Range(lineNumber, incident.variables.column || 0, lineNumber, (incident.variables.column || 0) + (incident.variables.length || 1));
                        decorations.push(range);
                    }
                } catch (e) {
                    console.log('Error creating incident diagnostic.');
                    console.log(e);
                }
            });
    
            if (diagnostics.length > 0) {
                this.diagnostics.set(doc.uri, diagnostics);
            }
            if (editor) {
                editor.setDecorations(this.unfixedHintDecorationType, decorations);
            }
        } catch (e) {
            console.log(e);
        }
    }
    private createDiagnostic(doc: vscode.TextDocument, incident: Incident): vscode.Diagnostic | undefined {
        if (!incident.variables || incident.variables.complete) return undefined;
        if (incident.lineNumber === undefined) return undefined;
        
        if (incident.variables.complete) return undefined;
        const lineNumber = incident.lineNumber - 1;
        if (lineNumber < 0 || lineNumber >= doc.lineCount) {
            return undefined;
        }
        const lineOfText = doc.lineAt(lineNumber);
        if (lineOfText.isEmptyOrWhitespace) {
            return undefined;
        }
        try {
            const severity = this.convertSeverity(incident);
            const startColumn = incident.variables.column || 0;
            const length = incident.variables.length || (lineOfText.text.length - startColumn);
            const range = new vscode.Range(lineNumber, startColumn, lineNumber, startColumn + length);
            const message = incident.message || 'Unknown incident';
            const diagnostic = new vscode.Diagnostic(range, message, severity);
            diagnostic.code = `${HINT} :: ${incident.variables.id}`;
            return diagnostic;
        } catch (e) {
            console.log('Error creating diagnostic.');
            console.log(e);
            return undefined;
        }
    }
    private convertSeverity(incident: Incident): vscode.DiagnosticSeverity {
        // Map incident severity to vscode.DiagnosticSeverity
        switch (incident.severity) {
            case 1:
                return vscode.DiagnosticSeverity.Error;
            case 2:
                return vscode.DiagnosticSeverity.Warning;
            case 3:
                return vscode.DiagnosticSeverity.Information;
            default:
                return vscode.DiagnosticSeverity.Hint;
        }
    }
    
    
    // private createDiagnostic(doc: vscode.TextDocument, issue: IHint): vscode.Diagnostic | undefined {
    //     if (issue.complete) return undefined;
    //     const lineNumber = issue.lineNumber - 1;
    //     const lineOfText = doc.lineAt(lineNumber);
    //     if (lineOfText.isEmptyOrWhitespace) {
    //         return undefined;
    //     }
    //     try {
    //         const severity = this.convertSeverity(issue);
    //         const range = new vscode.Range(lineNumber, issue.column, lineNumber, issue.length+issue.column);
    //         const title = issue.hint ? issue.hint : 'unknown-incident-title';
    //         console.log(`range - ${range}`);
    //         console.log(range);
    //         console.log(`title - ${title}`);
    //         console.log(`severity ${severity}`);
            
                        
    //         const diagnostic = new vscode.Diagnostic(range, title, severity);
    //         diagnostic.code = `${HINT} :: ${issue.configuration.id} :: ${issue.id}`;
    //         return diagnostic;
    //     }
    //     catch (e) {
    //         console.log('Errir creating diagnostic.');            
    //         console.log(e);
    //         return undefined;
    //     }
    // }

    // private convertSeverity(hint: IHint): vscode.DiagnosticSeverity {
        
    //     let severity: vscode.DiagnosticSeverity = vscode.DiagnosticSeverity.Information;
    //     if (!hint.category || hint.category.includes('error') || hint.category.includes('mandatory')) {
    //         severity = vscode.DiagnosticSeverity.Error;
    //     }
    //     else if (hint.category.includes('potential')) {
    //         severity = vscode.DiagnosticSeverity.Warning;
    //     }
    //     // else if (hint.complete) {
    //     //     severity = vscode.DiagnosticSeverity.Hint;
    //     // }
    //     return severity;
    // }
}
