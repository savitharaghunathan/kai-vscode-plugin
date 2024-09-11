/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Red Hat. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
import { EventEmitter, TreeItem, window } from 'vscode';
import { AbstractNode, ITreeNode } from './abstractNode';
import { DataProvider } from './dataProvider';
import { IClassification, IHint, IIssue, RhamtConfiguration } from '../server/analyzerModel';
import { ModelService } from '../model/modelService';
import * as path from 'path';
import { ConfigurationNode } from './configurationNode';
import { FileItem } from './fileItem';
import { HintNode } from './hintNode';
import { HintsNode } from './hintsNode';
import { ClassificationsNode } from './classificationsNode';
import { ClassificationNode } from './classificationNode';

export class FileNode extends AbstractNode<FileItem> {
    private loading: boolean = false;
    private children = [];
    private issues = [];
    private configforKai: RhamtConfiguration;
    file: string;
    public inProgress: boolean = false;
    private static fileNodeMap: Map<string, FileNode> = new Map();

    constructor(
        config: RhamtConfiguration,
        file: string,
        modelService: ModelService,
        onNodeCreateEmitter: EventEmitter<ITreeNode>,
        dataProvider: DataProvider,
        root: ConfigurationNode) {
        super(config, modelService, onNodeCreateEmitter, dataProvider);
        this.file = file;
        this.root = root;
        this.configforKai = config;
        FileNode.fileNodeMap.set(file, this); 
    }

    createItem(): FileItem {
        this.treeItem = new FileItem(this.file);
        this.loading = false;
        this.refresh();
        return this.treeItem;
    }

    delete(): Promise<void> {
        return Promise.resolve();
    }

    getLabel(): string {
        console.log('File Node Label for: ' + this.file);
        console.log('File Node Label: ' + path.basename(this.file));
        return path.basename(this.file);
    }

    public getChildrenCount(): number {
        return this.issues.length;
    }

    public getConfig(): RhamtConfiguration {
        return this.configforKai;
    }

    public getChildren(): Promise<ITreeNode[]> {
        if (this.loading) {
            return Promise.resolve([]);
        }
        return Promise.resolve(this.children);
    }

    public hasMoreChildren(): boolean {
        return this.children.length > 0;
    }
    public setIssues(newIssues: any[]): void {
        this.issues = newIssues;
    }
    
    refresh(node?: ITreeNode<TreeItem>, type?: string): void {
        this.children = [];
        const ext = path.extname(this.file);

        if (this.inProgress && type) {
            switch (type) {
                case 'analyzing':
                   // this.treeItem.iconPath = new ThemeIcon('sync~spin', new ThemeColor('kaiFix.analyzing'));
                    this.treeItem.label = `Analyzing: ${path.basename(this.file)}`;
                    this.treeItem.tooltip = 'Analyzing Incidents';
                    window.showInformationMessage(`FileNode is getting signal of Analyzing`);
                    break;
                case 'fixing':
                 //   this.treeItem.iconPath = new ThemeIcon('loading~spin', new ThemeColor('kaiFix.fixing'));
                    this.treeItem.label = `Fixing: ${path.basename(this.file)}`;
                    this.treeItem.tooltip = 'Fixing Incidents';
                    window.showInformationMessage(`FileNode is getting signal of Fixing`);
                    break;
                default:
                //    this.treeItem.iconPath = new ThemeIcon('sync~spin');
                    this.treeItem.label = path.basename(this.file);
                    this.treeItem.tooltip = '';
                    break;
            }
        } else if (process.env.CHE_WORKSPACE_NAMESPACE) {
            this.treeItem.iconPath = ext === '.xml' ? 'fa fa-file-o medium-orange' :
                ext === '.java' ? 'fa fa-file-o medium-orange' :
                'fa fa-file';
            this.treeItem.label = path.basename(this.file);
            this.treeItem.tooltip = '';
        } else {
            // const icon = ext === '.xml' ? 'file_type_xml.svg' :
            //     ext === '.java' ? 'file_type_class.svg' :
            //     'default_file.svg';
            // const base = [__dirname, '..', '..', '..', 'resources'];
            // this.treeItem.iconPath = {
            //     light: path.join(...base, 'light', icon),
            //     dark: path.join(...base, 'dark', icon)
            // };
            this.treeItem.label = path.basename(this.file);
            this.treeItem.tooltip = '';
        }

        this.issues = this.root.getChildNodes(this);
        if (this.issues.find(issue => issue instanceof HintNode)) {
            this.children.push(new HintsNode(
                this.config,
                this.file,
                this.modelService,
                this.onNodeCreateEmitter,
                this.dataProvider,
                this.root));
        }
        if (this.issues.find(issue => issue instanceof ClassificationNode)) {
            this.children.push(new ClassificationsNode(
                this.config,
                this.file,
                this.modelService,
                this.onNodeCreateEmitter,
                this.dataProvider,
                this.root));
        }
        //this.computeIssuesForFile();
        this.dataProvider.refreshNode(this); // Ensure the tree view is refreshed
    }

    public setInProgress(inProgress: boolean, type?: string): void {
        this.inProgress = inProgress;
        //this.refresh(undefined, type);
    }

    public static getFileNodeByPath(filepath: string): FileNode | undefined {
        return FileNode.fileNodeMap.get(filepath);
    }


    private async computeIssuesForFile(): Promise<void> {
        this.clearModel();

        if (this.configforKai.results) {
            // Process classifications and hints for the specific file
            this.configforKai.results.model.classifications
                .filter(classification => classification.file === this.file)
                .forEach(classification => {
                    // this.issues.push(classification);
                    // this.initIssue(classification, this.createClassificationNode(classification));
                    console.log(`Adding classification for file: ${this.file}`);
                    const classificationNode = this.createClassificationNode(classification);
                    this.initIssue(classification, classificationNode);
                });

            this.configforKai.results.model.hints
                .filter(hint => hint.file === this.file)
                .forEach(hint => {
                    // this.issues.push(hint);
                    // this.initIssue(hint, this.createHintNode(hint));
                    console.log(`Adding hint for file: ${this.file}`);
                    const hintNode = this.createHintNode(hint);
                    this.initIssue(hint, hintNode);
                });

                console.log(`Total issues for file ${this.file}: ${this.issues.length}`);
            // Populate children nodes based on computed issues
            this.createChildrenNodes();
        }
    }

    private createChildrenNodes(): void {
        this.children = [];
        if (this.issues.some(issue => issue instanceof HintNode)) {
            console.log(`Adding HintsNode for file: ${this.file}`);
            this.children.push(new HintsNode(
                this.configforKai,
                this.file,
                this.modelService,
                this.onNodeCreateEmitter,
                this.dataProvider,
                this.root
            ));
        }
        if (this.issues.some(issue => issue instanceof ClassificationNode)) {
            console.log(`Adding ClassificationsNode for file: ${this.file}`);
            this.children.push(new ClassificationsNode(
                this.configforKai,
                this.file,
                this.modelService,
                this.onNodeCreateEmitter,
                this.dataProvider,
                this.root
            ));
        }
        console.log(`Total children nodes for file ${this.file}: ${this.children.length}`);
    }

    private initIssue(issue: IIssue, node: ITreeNode): void {
        this.issues.push(node);
    }

    public clearModel(): void {
        this.issues = [];
        this.children = [];
    }
       // Method to create a HintNode for a given hint
       private createHintNode(hint: IHint): HintNode {
        const node: HintNode = new HintNode(
            hint,
            this.configforKai,
            this.modelService,
            this.onNodeCreateEmitter,
            this.dataProvider,
            this.root
        );
        return node;
    }

    // Method to create a ClassificationNode for a given classification
    private createClassificationNode(classification: IClassification): ClassificationNode {
        const node: ClassificationNode = new ClassificationNode(
            classification,
            this.configforKai,
            this.modelService,
            this.onNodeCreateEmitter,
            this.dataProvider,
            this.root
        );
        return node;
    }
    refreshFile(): void {
        this.children = [];
        this.computeIssuesForFile();
        setTimeout(() => {
            this.dataProvider.refreshNode(this);  
        }, 0);
    }
}
