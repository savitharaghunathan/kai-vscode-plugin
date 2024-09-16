/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Red Hat. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
import { ConfigurationItem } from './configurationItem';
import { EventEmitter, TreeItemCollapsibleState, Uri, workspace } from 'vscode';
import { AbstractNode, ITreeNode } from './abstractNode';
import { ClassificationNode } from './classificationNode';
import { DataProvider } from './dataProvider';
import * as path from 'path';
import { HintNode } from './hintNode';
import { RhamtConfiguration, ChangeType, IClassification, IHint, ReportHolder, IIssue, IssueContainer, IIssueType } from '../server/analyzerModel';
import { ModelService } from '../model/modelService';
import { FileNode } from './fileNode';
import { FolderNode } from './folderNode';
import { HintsNode } from './hintsNode';
import { ClassificationsNode } from './classificationsNode';
import { SortUtil } from './sortUtil';
import { ResultsNode } from './resultsNode';
import { MarkerService } from '../source/markers';
import { FileIncidentManager, Incident } from '../server/fileIncidentUtil';


export interface Grouping {
    groupByFile: boolean;
    groupBySeverity: boolean;
}

export class ConfigurationNode extends AbstractNode<ConfigurationItem> implements ReportHolder {
    public fileNodeMap = new Map<string, FileNode>(); 
    private grouping: Grouping;
    private classifications: IClassification[] = [];
    private hints: IHint[] = [];
    private issueFiles = new Map<string, IIssue[]>();
    private issueNodes = new Map<IIssue, ITreeNode>();
    private resourceNodes = new Map<string, ITreeNode>();
    private childNodes = new Map<string, ITreeNode>();
    private incidentManager: FileIncidentManager;

    public setIncidentManager(manager: FileIncidentManager): void {
        this.incidentManager = manager;
    }
    
    public getIncidentManager(): FileIncidentManager {
        return this.incidentManager;
    }

    results = [];

    constructor(
        config: RhamtConfiguration,
        grouping: Grouping,
        modelService: ModelService,
        onNodeCreateEmitter: EventEmitter<ITreeNode>,
        dataProvider: DataProvider,
        public markerService: MarkerService) {
        super(config, modelService, onNodeCreateEmitter, dataProvider);
        this.grouping = grouping;
        this.listen();
    }
    public getFileNodeMap(): Map<string, FileNode> {
        return this.fileNodeMap;
    }
    createItem(): ConfigurationItem {
        console.log('ConfigurationNode :: createItem()');
        this.treeItem = new ConfigurationItem(this.config);
        this.loadResults();
        return this.treeItem;
    }

    delete(): Promise<void> {
        return Promise.resolve();
    }

    getLabel(): string {
        return this.config.name;
    }

    public getChildren(): Promise<any> {
        return Promise.resolve(this.results);
    }

    public hasMoreChildren(): boolean {
        return this.results.length > 0;
    }

    private async listen(): Promise<void> {
        this.config.onChanged.on(change => {
            if (change.type === ChangeType.MODIFIED &&
                change.name === 'name') {
                this.refresh(this);
            }
        });
    }

    // public async loadResults(): Promise<void> {
    //     if (this.config.results) {
    //         this.computeIssues();
    //         this.results = [
    //             new ResultsNode(
    //                 this.config,
    //                 this.modelService,
    //                 this.onNodeCreateEmitter,
    //                 this.dataProvider,
    //                 this)
    //         ];
    //     }
    // }
    public async loadResults(): Promise<void> {
        if (this.incidentManager) {
            this.computeIssues();
            this.results = [
                new ResultsNode(
                    this.config,
                    this.modelService,
                    this.onNodeCreateEmitter,
                    this.dataProvider,
                    this
                )
            ];
        }
    }
    

    private clearModel(): void {
        this.classifications = [];
        this.hints = [];
        this.issueFiles.clear();
        this.issueNodes.clear();
        this.resourceNodes.clear();
        this.childNodes.clear();
        this.fileNodeMap.clear(); 
    }

    // private computeIssues(): void {
    //     this.clearModel();
    //     if (this.config.results) {
    //         this.config.results.model.classifications.forEach(classification => {
    //             const root = workspace.getWorkspaceFolder(Uri.file(classification.file));
    //             if (!root) return;
    //             this.classifications.push(classification);
    //             this.initIssue(classification, this.createClassificationNode(classification));
    //         });
    //         this.config.results.model.hints.forEach(hint => {
    //             this.hints.push(hint);
    //             this.initIssue(hint, this.createHintNode(hint));
    //         });
    //     }
    // }

    private convertIncidentToIssue(incident: Incident, configuration: RhamtConfiguration): IIssue {

        let issueType: IIssueType;
        if (incident.kind === 'hint') {
            issueType = IIssueType.Hint;
        } else if (incident.kind === 'classification') {
            issueType = IIssueType.Classification;
        } else {
            issueType = IIssueType.Hint; 
        }
    

        const id = incident.variables?.id || this.generateUniqueId();

        const severity = incident.severity !== undefined ? incident.severity.toString() : '0';
    
        const commonIssue: Partial<IIssue> = {
            id: id,
            type: issueType,
            title: incident.message,
            quickfixes: incident.variables?.quickfixes || [],
            file: incident.uri,
            severity: severity,
            ruleId: incident.variables?.ruleId || '',
            ruleSetDiscription: incident.variables?.ruleSetDescription || '',
            violationDiscription: incident.variables?.violationDescription || '',
            rulesetName: incident.variables?.rulesetName || '',
            effort: incident.variables?.effort || '',
            links: incident.variables?.links || [],
            report: '', // Provide the report path if available
            category: incident.variables?.category || '',
            configuration: configuration,
            dom: null, // Set as needed
            complete: incident.variables?.complete || false,
            origin: incident.variables?.origin || '',
        };
    
        if (issueType === IIssueType.Hint) {
            // Create an IHint object
            const hintIssue: IHint = {
                ...commonIssue,
                lineNumber: incident.lineNumber || 0,
                column: incident.variables?.column || 0,
                length: incident.variables?.length || 0,
                sourceSnippet: incident.codeSnip || '',
                hint: incident.message || '',
                variables: incident.variables || {},
            } as IHint;
            return hintIssue;
        } else if (issueType === IIssueType.Classification) {
            // Create an IClassification object
            const classificationIssue: IClassification = {
                ...commonIssue,
                description: incident.message || '',
            } as IClassification;
            return classificationIssue;
        } else {
            return commonIssue as IIssue;
        }
    }
    
    
    // Helper function to generate a unique ID if none is provided
    private generateUniqueId(): string {
        return '_' + Math.random().toString(36).substr(2, 9);
    }
    
    private computeIssues(): void {
        this.clearModel();
        const incidentsMap = this.incidentManager.getIncidentsMap();
    
        incidentsMap.forEach((incidents, file) => {
            incidents.forEach(incident => {
                const issue = this.convertIncidentToIssue(incident, this.config); 
                const node = this.createIncidentNode(issue);
                this.initIssue(issue, node);
            });
        });
    }
    private createIncidentNode(issue: IIssue): ITreeNode {
        if (issue.type === IIssueType.Hint) {
            const hintIssue = issue as IHint;
            return new HintNode(
                hintIssue,
                this.config,
                this.modelService,
                this.onNodeCreateEmitter,
                this.dataProvider,
                this
            );
        } else if (issue.type === IIssueType.Classification) {
            const classificationIssue = issue as IClassification;
            return new ClassificationNode(
                classificationIssue,
                this.config,
                this.modelService,
                this.onNodeCreateEmitter,
                this.dataProvider,
                this
            );
        }
        return null;
    }
    

    private initIssue(issue: IIssue, node: ITreeNode): void {
        let nodes = this.issueFiles.get(issue.file);
        if (!nodes) {
            nodes = [];
            this.issueFiles.set(issue.file, nodes);
        }
        nodes.push(issue);
        this.issueNodes.set(issue, node);
        this.buildResourceNodes(issue.file);
    }

    private buildResourceNodes(file: string): void {
        const root = workspace.workspaceFolders[0]; 

        if (!this.childNodes.has(root.uri.fsPath)) {
            const folder = new FolderNode(
                this.config,
                root.uri.fsPath,
                this.modelService,
                this.onNodeCreateEmitter,
                this.dataProvider,
                this);
            this.childNodes.set(root.uri.fsPath, folder);
            this.resourceNodes.set(root.uri.fsPath, folder);
        }
        
        
        if (!this.resourceNodes.has(file)) {
            const fileNode = new FileNode(
                this.config,
                file,
                this.modelService,
                this.onNodeCreateEmitter,
                this.dataProvider,
                this);
            this.resourceNodes.set(file, fileNode);
            this.fileNodeMap.set(file, fileNode);
            const getParent = location => path.resolve(location, '..');
            let parent = getParent(file);

            while (parent) {
                if (this.resourceNodes.has(parent)) {
                    break;
                }
                this.resourceNodes.set(parent, new FolderNode(
                    this.config,
                    parent,
                    this.modelService,
                    this.onNodeCreateEmitter,
                    this.dataProvider,
                    this));
                parent = getParent(parent);
            }
        }
    }

    getChildNodes(node: ITreeNode): ITreeNode[] {
        let children = [];
        if (node instanceof ResultsNode) {
            if (this.grouping.groupByFile) {
                const children = Array.from(this.childNodes.values());
                return children.sort(SortUtil.sort);
            }
            return Array.from(this.issueNodes.values());
        }
        if (node instanceof FileNode) {
            const issues = this.issueFiles.get((node as FileNode).file);
            if (issues) {
                issues.forEach(issue => children.push(this.issueNodes.get(issue)));
            }
        }
        else if (node instanceof HintsNode) {
            const file = (node as HintsNode).file;
            children = this.hints.filter(issue => {
                    return issue.file === file;
                })
                .map(hint => {
                    return this.issueNodes.get(hint);
                });
        }
        else if (node instanceof ClassificationsNode) {
            const file = (node as ClassificationsNode).file;
            children = this.classifications.filter(issue => issue.file === file)
                .map(classification => this.issueNodes.get(classification));
        }
        else {
            // console.log('FolderNode:');
            // console.log((node as FolderNode).folder);
            const segments = this.getChildSegments((node as FolderNode).folder);
            segments.forEach(segment => {
                const resource = this.resourceNodes.get(segment);                
                children.push(resource);
            });
        }
        return children;
    }

    private getChildSegments(segment: string): string[] {
        const children = [];
        this.resourceNodes.forEach((value, key) => {
            if (key !== segment && key.includes(segment)) {
                if (path.resolve(key, '..') === segment) {
                    children.push(key);
                }
            }
        });
        return children;
    }

    refresh(node?: ITreeNode): void {
        this.treeItem.refresh();
        super.refresh(node);
    }

    createClassificationNode(classification: IClassification): ITreeNode {
        const node: ITreeNode = new ClassificationNode(
            classification,
            this.config,
            this.modelService,
            this.onNodeCreateEmitter,
            this.dataProvider,
            this);
        return node;
    }

    createHintNode(hint: IHint): ITreeNode {
        const node: ITreeNode = new HintNode(
            hint,
            this.config,
            this.modelService,
            this.onNodeCreateEmitter,
            this.dataProvider,
            this);
        return node;
    }

    getReport(): string {
        return this.config.getReport();
    }

    private doDeleteIssue(node: any): void {
        const issue = (node as IssueContainer).getIssue();
        if (node instanceof HintNode) {
            const index = this.hints.indexOf(issue as IHint);
            if (index > -1) {
                this.hints.splice(index, 1);
            }
        }
        else {
            const index = this.classifications.indexOf(issue as IClassification);
            if (index > -1) {
                this.classifications.splice(index, 1);
            }
        }
    }

    deleteIssue(node: any): void {
        const issue = (node as IssueContainer).getIssue();
        this.config.deleteIssue(issue);        
        this.issueNodes.delete(issue);
        this.doDeleteIssue(node);
        const file = issue.file;
        const nodes = this.issueFiles.get(file);
        if (nodes) {
            const index = nodes.indexOf(issue);
            if (index > -1) {
                nodes.splice(index, 1);
            }
            if (nodes.length === 0) {
                this.resourceNodes.delete(file);
                let parentToRefresh = undefined;
                const getParentFolderPath = location => path.resolve(location, '..');
                let parentFolderPath = getParentFolderPath(file);
                while (parentFolderPath) {
                    const parentFolder = this.resourceNodes.get(parentFolderPath) as any;
                    if (!parentFolder) break;
                    const children = this.getChildSegments(parentFolderPath);
                    if (children.length > 0) {
                        parentToRefresh = parentFolder;
                        break;
                    }
                    this.resourceNodes.delete(parentFolderPath);
                    const root = workspace.getWorkspaceFolder(Uri.file(parentFolderPath));
                    if (parentFolderPath === root.uri.fsPath && this.childNodes.has(parentFolderPath)) {
                        this.childNodes.delete(parentFolderPath);
                        parentToRefresh = parentFolder.parentNode;
                        break;
                    }
                    parentFolderPath = getParentFolderPath(parentFolderPath);
                }
                if (parentToRefresh) {
                    parentToRefresh.refresh(parentToRefresh);
                }
            }
            else {
                node.parentNode.refresh(node.parentNode);
            }
        }
    }

    setComplete(node: any, complete: boolean): void {
        const container = node as IssueContainer;
        container.setComplete(complete);
    }


    expanded(): void {
        this.treeItem.collapsibleState = TreeItemCollapsibleState.Expanded;
    }

    setBusyAnalyzing(busyAnalyzing: boolean): void {
        const currentlyBusyAnalyzing = this.treeItem.busyAnalyzing;
        this.treeItem.setBusyAnalyzing(busyAnalyzing);
        if (!busyAnalyzing && currentlyBusyAnalyzing) {
            this.refresh();
        }
    }
}
