import { AbstractNode, ITreeNode } from './abstractNode';
import { HintItem } from './hintItem';
import { Hint, RhamtConfiguration } from '../model/model';
import { ModelService } from '../model/modelService';
import { RhamtTreeDataProvider } from './rhamtTreeDataProvider';

export class HintNode extends AbstractNode {

    private hint: Hint;

    constructor(
        hint: Hint,
        config: RhamtConfiguration,
        modelService: ModelService,
        dataProvider: RhamtTreeDataProvider) {
        super(config, modelService, dataProvider);
        this.hint = hint;
        this.treeItem = this.createItem();
    }

    getChildren(): Promise<ITreeNode[]> {
        return Promise.resolve([]);
    }

    delete(): Promise<void> {
        return Promise.resolve();
    }

    createItem(): HintItem {
        const item = new HintItem(this.hint);
        return item;
    }
}