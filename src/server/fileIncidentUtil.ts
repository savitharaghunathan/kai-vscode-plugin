import * as fs from 'fs';
import * as yaml from 'yaml';
import * as path from 'path';

export interface Incident {
    kind: 'hint' | 'classification';
    uri: string;
    message: string;
    codeSnip?: string;
    lineNumber?: number;
    variables?: any;
    severity?: number;
}

export class FileIncidentManager {
    private fileIncidentsMap: Map<string, Incident[]> = new Map();
    private incidentsFilePath: string;
    outputFilePath: string;

    constructor(outputFilePath: string, fullAnalysis: boolean) {
        this.outputFilePath = outputFilePath;
        this.incidentsFilePath = path.join(path.dirname(outputFilePath), 'fileincidents.json');

        if (fullAnalysis) {
            this.parseOutputYaml();
            this.saveIncidentsToFile();
        } else {
            if (fs.existsSync(this.incidentsFilePath)) {
                this.loadFromIncidentsFile();
            } else {
                console.log(`Fully parsed incidents file not found`);
            }
        }
    }

    // Parses the output.yaml and populates the map
    public parseOutputYaml() {
        const yamlContent = fs.readFileSync(this.outputFilePath, 'utf8');
        const parsedData = yaml.parse(yamlContent);

        for (const ruleset of parsedData) {
            for (const key of ['violations', 'insights', 'unmatched', 'skipped']) {
                if (ruleset[key]) {
                    for (const incidentKey in ruleset[key]) {
                        const incidents = ruleset[key][incidentKey].incidents || [];
                        for (const incident of incidents) {
                            const filePath = this.extractFilePath(incident.uri);

                            // Set the 'kind' property on the incident
                            incident.kind = this.mapKeyToKind(key);

                            if (!this.fileIncidentsMap.has(filePath)) {
                                this.fileIncidentsMap.set(filePath, []);
                            }
                            this.fileIncidentsMap.get(filePath)?.push(incident);
                        }
                    }
                }
            }
        }
    }

    // Map the 'key' to 'kind' for incidents
    private mapKeyToKind(key: string): 'hint' | 'classification' {
        switch (key) {
            case 'violations':
                return 'hint';
            case 'skipped':
                return 'classification';
            default:
                return 'hint'; // Default to 'hint' if key is unknown
        }
    }

    // Extracts the file path from the URI in the output.yaml
    private extractFilePath(uri: string): string {
        return path.normalize(uri.replace('file://', ''));
    }

    // Get incidents for a specific file
    public getIncidentsForFile(filePath: string): Incident[] | undefined {
        return this.fileIncidentsMap.get(path.normalize(filePath));
    }

    // Update the incidents for a specific file
    public async updateFileIncidents(outputFilePathForSpecificFile: string, filePath: string) {
        const yamlContent = fs.readFileSync(outputFilePathForSpecificFile, 'utf8');
        const parsedData = yaml.parse(yamlContent);
        const newIncidents: Incident[] = [];

        // Parse the incidents for this specific file
        for (const ruleset of parsedData) {
            for (const key of ['violations']) {
                if (ruleset[key]) {
                    for (const incidentKey in ruleset[key]) {
                        const incidents = ruleset[key][incidentKey].incidents || [];
                        for (const incident of incidents) {
                            const incidentFilePath = this.extractFilePath(incident.uri);
                            if (path.normalize(incidentFilePath) === path.normalize(filePath)) {
                                // Set the 'kind' property on the incident
                                incident.kind = this.mapKeyToKind(key);

                                newIncidents.push(incident);
                            }
                        }
                    }
                }
            }
        }

        // Update the incidents for the specific file in the map
        this.fileIncidentsMap.set(path.normalize(filePath), newIncidents);
    }


    // Log all incidents to the console (for debugging)
    public logAllIncidents() {
        for (const [filePath, incidents] of this.fileIncidentsMap.entries()) {
            console.log(`File: ${filePath}`);
            console.log(`Incidents: ${JSON.stringify(incidents, null, 2)}`);
        }
    }

    public getIncidentsMap(): Map<string, Incident[]> {
        return this.fileIncidentsMap;
    }

    // Save the incidents map to the file
    private saveIncidentsToFile() {
        const serializedData = JSON.stringify(Array.from(this.fileIncidentsMap.entries()), null, 2);
        fs.writeFileSync(this.incidentsFilePath, serializedData, 'utf8');
    }

    // Load the incidents from the previously saved file
    private loadFromIncidentsFile() {
        const fileContent = fs.readFileSync(this.incidentsFilePath, 'utf8');
        const parsedEntries = JSON.parse(fileContent) as [string, Incident[]][];
        this.fileIncidentsMap = new Map(parsedEntries);
    }
}
