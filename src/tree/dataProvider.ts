/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Red Hat. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
import { TreeDataProvider, Disposable, EventEmitter, Event, TreeItem, commands, TreeView, ProviderResult, ExtensionContext, window } from 'vscode';
import { localize } from './localize';
import * as path from 'path';
import { ConfigurationNode, Grouping } from './configurationNode';
import { ITreeNode } from './abstractNode';
import { ModelService } from '../model/modelService';
import { ResultsNode } from './resultsNode';
import { RhamtConfiguration } from '../server/analyzerModel';
import { MarkerService } from '../source/markers';
import { getOpenEditors } from '../editor/configurationView';
import { KaiFixDetails } from '../kaiFix/kaiFix';
import { FileNode } from './fileNode';
import { FileIncidentManager } from '../server/fileIncidentUtil';

export class DataProvider implements TreeDataProvider<ITreeNode>, Disposable {

    _onDidChangeTreeDataEmitter: EventEmitter<ITreeNode> = new EventEmitter<ITreeNode>();
    _onNodeCreateEmitter: EventEmitter<ITreeNode> = new EventEmitter<ITreeNode>();
    private _disposables: Disposable[] = [];
    private children: ConfigurationNode[] = [];
    private view: TreeView<any>;

    constructor(private grouping: Grouping, private modelService: ModelService, public context: ExtensionContext,
        private markerService: MarkerService, private kaiFix: KaiFixDetails) {
        this._disposables.push(commands.registerCommand('rhamt.modelReload', async () => {
            try {
                await modelService.reload();
                this.refreshRoots();
                getOpenEditors().forEach(editor => editor.refresh());
            }
            catch (e) {
                console.log(e);
                window.showErrorMessage('Error reloading configuration data.');
            }
        }));
        commands.executeCommand('setContext', 'rhamtReady', true);
        this._disposables.push(commands.registerCommand('rhamt.refreshResults', item => {
            item.loadResults();
            this.refreshRoots();
            this.reveal(item, true);
        }));
    }

    public setView(view: TreeView<any>): void {
        this.view = view;
        // this.view.onDidExpandElement(node => {
        //     this.refresh(node.element);
        // });
    }

    public reveal(node: any, expand: boolean): void {
        this.view.reveal(node, {expand});
    }

    public dispose(): void {
        for (const disposable of this._disposables) {
            disposable.dispose();
        }
    }

    public getParent(element: ITreeNode): ProviderResult<ITreeNode> {
        if (element instanceof ResultsNode) {
            return element.root;
        } else if (element instanceof FileNode){
            console.log(`FileNode root type: ${element.root.constructor.name}`);
            console.log(`Child nodes of the root: ${element.root.getFileNodeMap}`);
            return element.root;
        }
        return undefined;
    }

    public get onDidChangeTreeData(): Event<ITreeNode> {
        return this._onDidChangeTreeDataEmitter.event;
    }

    public get onNodeCreate(): Event<ITreeNode> {
        return this._onNodeCreateEmitter.event;
    }

    public getTreeItem(node: ITreeNode): TreeItem {
        if (node instanceof TreeItem && !node.treeItem) {
            return node;
        }
        if (node.treeItem) {
            return node.treeItem;
        }
        return (node as any).createItem();
    }

    public async getChildren(node?: ITreeNode): Promise<any[]> {
        try {
            return this.doGetChildren(node);
        } catch (error) {
            const item = new TreeItem(localize('errorNode', 'Error: {0}', error));
            item.contextValue = 'rhamtextensionui.error';
            return Promise.resolve([item]);
        }
    }

    private async doGetChildren(node?: ITreeNode): Promise<ITreeNode[]> {
        let result: ITreeNode[];
        if (node) {
            result = await node.getChildren();
        } else {
            result = await this.populateRootNodes();
        }
        return result;
    }

    public getConfigurationNode(config: RhamtConfiguration): ConfigurationNode | undefined {
        return this.children.find(node => node.config.id === config.id);
    }

    public findConfigurationNode(id: string): ConfigurationNode | undefined {
        return this.children.find(node => node.config.id === id);
    }

    public async refresh(node?: ITreeNode): Promise<void> {
        this._onDidChangeTreeDataEmitter.fire(node);
    }

    public remove(config: RhamtConfiguration): void {
        let node = this.children.find(node => node.config.id === config.id);
        if (node) {
            const index = this.children.indexOf(node);
            if (index > -1) {
                this.children.splice(index, 1);
            }
        }
        this.refresh(undefined);
    }

    public refreshLabel(config: RhamtConfiguration): void {
        let node = this.children.find(node => node.config.id === config.id);
        if (node) {
            node.treeItem.refresh();
            this.refresh(node);
        }
    }

    public refreshConfig(config: RhamtConfiguration): void {
        let node = this.children.find(node => node.config.id === config.id);
        if (node) {
            this.refresh(node);
        }
    }

    public refreshRoots(): void {
        this.children.filter(c => c instanceof ConfigurationNode).forEach(node => {
            node.treeItem.refresh();
        });
        this.refresh(undefined);
    }
   
    public refreshNode(node: ITreeNode): void {
        this._onDidChangeTreeDataEmitter.fire(node);
    }

    public refreshAll(): void {
        this._onDidChangeTreeDataEmitter.fire(undefined); 
    }

    public removeFileNode(fileNode: FileNode): void {
        const parentNode = this.getParent(fileNode);

        if (parentNode && parentNode instanceof ConfigurationNode){
            const fileNodeMap = parentNode.getFileNodeMap();
            if (fileNodeMap.has(fileNode.file)) {
                fileNodeMap.delete(fileNode.file);
            }
            this.refresh(parentNode);
        } else {
            this.refreshAll();
        }
    }

   
    // public async populateRootNodes(): Promise<any[]> {
    //    // window.showInformationMessage(`-------populateRootNodes------------`);
    //     let nodes: any[];
    
    //     try {
    //         if (this.modelService.loaded) {
    //             for (let i = this.children.length; i--;) {
    //                 const config = this.modelService.model.configurations.find(item => item.id === this.children[i].config.id);
    //                 if (!config) {
    //                     this.children.splice(i, 1);
    //                 }
    //             }
    //             nodes = this.modelService.model.configurations.map(config => {
    //                 let node = this.children.find(node => node.config.id === config.id);
    //                 if (!node) {
    //                     node = new ConfigurationNode(
    //                         config,
    //                         this.grouping,
    //                         this.modelService,
    //                         this._onNodeCreateEmitter,
    //                         this,
    //                         this.markerService);
    //                     this.children.push(node);
    //                 }
    //                 return node;
    //             });
    
    //             window.showInformationMessage(`Configurations: ${this.modelService.model.configurations.length}`);
    
    //             // Wait for configurations to load their results
    //             await Promise.all(nodes.map(async node => {
    //                 if (node instanceof ConfigurationNode) {
    //                     await node.loadResults();
    //                 }
    //             }));
    
    //             const allfileNodeMap = new Map<string, FileNode>();
    //             for (const config of this.modelService.model.configurations) {
    //                 const configNode = this.getConfigurationNode(config);
    //                 if (configNode) {
    //                    //window.showInformationMessage(`For each configNode map size: ${configNode.getFileNodeMap().size}`);
    //                     for (const [key, value] of configNode.getFileNodeMap()) {
    //                         allfileNodeMap.set(key, value);
    //                     }
    //                 }
    //             }
    //             this.kaiFix.updateFileNodes(allfileNodeMap);
    //             window.showInformationMessage(`Total entries in combined fileNodeMap: ${allfileNodeMap.size}`);
    
    //         } else {
    //             const item = new TreeItem('Loading...');
    //             const base = [__dirname, '..', '..', '..', 'resources'];
    //             item.iconPath = {
    //                 light: path.join(...base, 'light', 'Loading.svg'),
    //                 dark: path.join(...base, 'dark', 'Loading.svg')
    //             };
    //             nodes = [item];
    //             (async () => setTimeout(async () => {
    //                 try {
    //                     await this.modelService.load();
    //                     if (this.modelService.model.configurations.length === 0) {
    //                         commands.executeCommand('rhamt.newConfiguration');
    //                     }
    //                     this.refresh();
    //                 }
    //                 catch (e) {
    //                     console.log('error while loading model service.');
    //                     console.log(e);
    //                     window.showErrorMessage(`Error reloading explorer data.`);
    //                 }
    //             }, 500))();
    //         }
    //     } catch (e) {
    //         console.log('dataProvider.populateRootNodes :: Error reloading explorer data.');
    //         console.log(e);
    //     }
    //     return nodes;
    // }
    
    public async populateRootNodes(): Promise<any[]> {
        let nodes: any[] = [];

        try {
            if (this.modelService.loaded) {
                const configurations = this.modelService.model.configurations || [];

                if (configurations.length === 0) {
                    // No configurations exist; prompt the user to create one
                    const createConfig = await window.showInformationMessage(
                        'No configurations found. Would you like to create a new configuration?',
                        'Yes',
                        'No'
                    );

                    if (createConfig === 'Yes') {
                        await commands.executeCommand('rhamt.newConfiguration');
                    }

                    // Return a node indicating no configurations are available
                    const noConfigItem = new TreeItem('No configurations available.');
                    nodes.push(noConfigItem);
                    return nodes;
                }

                // Process existing configurations
                nodes = configurations.map(config => {
                    if (!config.options || !config.options['output']) {
                        console.error(`Output directory is not defined for configuration: ${config.name}`);
                 
                        return null; // Skip this configuration
                    }

                    // Initialize the incident manager
                    const incidentManager = new FileIncidentManager(
                        path.join(config.options['output'], 'output.yaml'),
                        false
                    );
                    config.incidentManager = incidentManager;

                    // Create a new ConfigurationNode
                    const node = new ConfigurationNode(
                        config,
                        this.grouping,
                        this.modelService,
                        this._onNodeCreateEmitter,
                        this,
                        this.markerService
                    );
                    this.children.push(node);
                    node.setIncidentManager(config.incidentManager);
                    return node;
                }).filter(node => node !== null); // Filter out null nodes resulting from skipped configurations

                // Wait for configurations to load their results
                await Promise.all(nodes.map(async node => {
                    if (node instanceof ConfigurationNode) {
                        await node.loadResults();
                    }
                }));

                // Update the kaiFix object if necessary
                const allfileNodeMap = new Map<string, FileNode>();
                for (const config of configurations) {
                    const configNode = this.getConfigurationNode(config);
                    if (configNode) {
                        for (const [key, value] of configNode.getFileNodeMap()) {
                            allfileNodeMap.set(key, value);
                        }
                    }
                }
                this.kaiFix.updateFileNodes(allfileNodeMap);

            } else {
                // Handle the case when modelService is not loaded
                const item = new TreeItem('Loading...');
                const base = [__dirname, '..', '..', '..', 'resources'];
                item.iconPath = {
                    light: path.join(...base, 'light', 'Loading.svg'),
                    dark: path.join(...base, 'dark', 'Loading.svg')
                };
                nodes = [item];

                setTimeout(async () => {
                    try {
                        await this.modelService.load();
                        if (this.modelService.model.configurations.length === 0) {
                            const createConfig = await window.showInformationMessage(
                                'No configurations found after loading. Would you like to create a new configuration?',
                                'Yes',
                                'No'
                            );

                            if (createConfig === 'Yes') {
                                await commands.executeCommand('rhamt.newConfiguration');
                            }
                        }
                        this.refresh();
                    } catch (e) {
                        console.log('Error while loading model service.');
                        console.log(e);
                        window.showErrorMessage(`Error reloading explorer data.`);
                    }
                }, 500);
            }
        } catch (e) {
            console.log('DataProvider.populateRootNodes :: Error reloading explorer data.');
            console.log(e);
        }
        return nodes;
    }
    
}