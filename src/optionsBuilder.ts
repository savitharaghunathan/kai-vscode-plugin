import * as vscode from 'vscode';
import { ModelService } from './model/modelService';

const SOURCE = [
    'websphere',
    'jbpm',
    'soa',
    'seam',
    'eap7',
    'hibernate',
    'oraclejdk',
    'eap6',
    'rmi',
    'jrun',
    'glassfish',
    'java',
    'orion',
    'eap',
    'hibernate-search',
    'log4j',
    'soa-p',
    'rpc',
    'sonic',
    'weblogic',
    'drools',
    'java-ee',
    'javaee',
    'sonicesb',
    'jonas',
    'resin',
    'resteasy'
];

const TARGET = [
    'cloud-readiness',
    'jbpm',
    'drools',
    'fsw',
    'eap7',
    'hibernate',
    'java-ee',
    'eap6',
    'fuse',
    'openjdk',
    'eap',
    'camel',
    'linux',
    'hibernate-search',
    'resteasy'
];

TARGET.sort();
SOURCE.sort();

export class OptionsBuilder {

    static async build(modelService: ModelService): Promise<any> {

        const name = await vscode.window.showInputBox({
            prompt: 'Configuration name',
            validateInput: (value: string) => {
                if (value.trim().length === 0) {
                    return 'Configuration name required';
                }
                else if (modelService.model.exists(value)) {
                    return 'Configuration name already exists';
                }
            }
        });
        if (!name) return;

        const config = modelService.createConfigurationWithName(name);

        const input = await vscode.window.showWorkspaceFolderPick({
            placeHolder: 'input folder'
        });

        if (!input) return;
        config.options['input'] = input.uri.fsPath;

        const output = await vscode.window.showInputBox({
            prompt: 'output folder',
            placeHolder: 'output',
            validateInput: (value: string) => {
                if (value.trim().length === 0) {
                    return 'Output folder is required';
                }
            }
        });

        if (!output) return;
        config.options['output'] = output;

        const target = await vscode.window.showQuickPick(TARGET, {
            canPickMany: true,
            placeHolder: 'target (technology to migrate to. defaults to eap7)'
        });

        if (!target) return;
        config.options['target'] = target;

        const source = await vscode.window.showQuickPick(SOURCE, {
            canPickMany: true,
            placeHolder: 'source (technology to migrate from)'
        });

        if (!source) return;
        config.options['source'] = source;

        return config;
    }
}