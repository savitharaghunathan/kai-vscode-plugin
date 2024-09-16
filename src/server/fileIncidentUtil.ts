import * as fs from 'fs';
import * as yaml from 'yaml';
import * as path from 'path';

interface Incident {
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

    constructor(private outputFilePath: string) {
        this.incidentsFilePath = path.join(path.dirname(outputFilePath), 'fileincidents.json');

        if (fs.existsSync(this.incidentsFilePath)) {
            // If incidents file exists, load from it
            this.loadFromIncidentsFile();
        } else {
            // Otherwise, parse from YAML and create the incidents file
            this.parseOutputYaml();
            this.saveIncidentsToFile();
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

    // Extracts the file path from the URI in the output.yaml
    private extractFilePath(uri: string): string {
        return path.normalize(uri.replace('file://', ''));
    }

    // Get incidents for a specific file
    public getIncidentsForFile(filePath: string): Incident[] | undefined {
        return this.fileIncidentsMap.get(path.normalize(filePath));
    }

    // Update the incidents for a specific file
    public updateIncidentsForFile(filePath: string, incidents: Incident[]) {
        this.fileIncidentsMap.set(path.normalize(filePath), incidents);
        this.saveIncidentsToFile(); // Save changes to file
    }

    // Log all incidents to the console (for debugging)
    public logAllIncidents() {
        for (const [filePath, incidents] of this.fileIncidentsMap.entries()) {
            console.log(`File: ${filePath}`);
            console.log(`Incidents: ${JSON.stringify(incidents, null, 2)}`);
        }
    }

    // Save the incidents map to the file
    public saveIncidentsToFile() {
        const serializedData = JSON.stringify(Array.from(this.fileIncidentsMap.entries()), null, 2);
        fs.writeFileSync(this.incidentsFilePath, serializedData, 'utf8');
    }

    // Load the incidents from the previously saved file
    private loadFromIncidentsFile() {
        const fileContent = fs.readFileSync(this.incidentsFilePath, 'utf8');
        const parsedMap = new Map<string, Incident[]>(JSON.parse(fileContent));
        this.fileIncidentsMap = parsedMap;
    }
}
