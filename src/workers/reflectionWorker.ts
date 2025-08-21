import { parentPort } from "node:worker_threads";
import { Config, loadComments, runConfigLowestGradePriority, saveComments } from "../reflection/gradeReflectLoop";
import fs from 'fs';
import * as fsPromises from 'fs/promises';
import path from 'path';
import { WorkerMessage } from '../reflection/reflectionTypes';
import * as reflectionUtils from '../reflection/reflectionUtils';
import { getFirstWorkspaceFolder, getConfigurationOption, postMessageAndShowError, postMessageAndShowInfo } from "@/reflection/workerUtils";
import { run as runHtmlReport } from '../reflection/outputFormatters/htmlReport';

// Helper function to serialize arguments properly, especially Error objects
function serializeArg(arg: any): string {
    if (arg instanceof Error) {
        // Handle Error objects specially to include message and stack
        return `${arg.name}: ${arg.message}${arg.stack ? '\n' + arg.stack : ''}`;
    } else if (typeof arg === 'object' && arg !== null) {
        try {
            return JSON.stringify(arg, null, 2);
        } catch (e) {
            // Fallback for objects that can't be stringified
            return String(arg);
        }
    } else {
        return String(arg);
    }
}

// Intercept console.log to send messages to the panel
const originalConsoleLog = console.log;
console.log = (...args: any[]) => {
    const message = args.map(serializeArg).join(' ');

    // Send to panel
    if (parentPort) {
        parentPort.postMessage({
            command: "logToPanel",
            content: {
                message,
                level: "info",
                timestamp: new Date().toISOString()
            }
        });
    }

    // Still log to original console
    originalConsoleLog(...args);
};

// Also intercept console.error
const originalConsoleError = console.error;
console.error = (...args: any[]) => {
    const message = args.map(serializeArg).join(' ');

    // Send to panel
    if (parentPort) {
        parentPort.postMessage({
            command: "logToPanel",
            content: {
                message,
                level: "error",
                timestamp: new Date().toISOString()
            }
        });
    }

    // Still log to original console
    originalConsoleError(...args);
};



type TrackingModTimes = {
    observed_mod_time: Date;
    updated_mod_time: Date;
    reflected_mod_time: Date;
    reported_mod_time: Date;
};

// Define the expected JSON structure
interface JsonModTimes {
    [file: string]: {
        observed_mod_time: string | number;
        updated_mod_time: string | number;
        reflected_mod_time: string | number;
        reported_mod_time: string | number;
    };
}

interface IdToContent {
    [id: string]: string;
}

interface ReflectionContentItem extends Record<string, unknown> {
    reflectionLoops?: { [id: string]: string; }[];
}
interface ReflectionContent extends Array<ReflectionContentItem> { }



/**
 * Save a file with one JSON object at the root.
 * @param filename - Path to the output file
 * @param data - JSON-serializable data to save
 * @param indent - Number of spaces for JSON indentation (default: 4)
 */
async function saveJson(filename: string, data: unknown, indent: number = 4): Promise<void> {
    const dirname = path.dirname(filename);

    // Create directory if it doesn't exist
    await fsPromises.mkdir(dirname, { recursive: true });

    const tempFilename = `${filename}~`;

    // Write to temporary file
    await fsPromises.writeFile(tempFilename, JSON.stringify(data, null, indent), { encoding: 'utf-8' } as fs.WriteFileOptions);

    // Replace the original file with the temporary file
    await fsPromises.rename(tempFilename, filename);
}


const BOOK_ORDER = [
    "Genesis", "GEN",
    "Exodus", "EXO",
    "Leviticus", "LEV",
    "Numbers", "NUM",
    "Deuteronomy", "DEU",
    "Joshua", "JOS",
    "Judges", "JDG",
    "Ruth", "RUT",
    "1Samuel", "1SA", "1 Samuel",
    "2Samuel", "2SA", "2 Samuel",
    "1Kings", "1KI", "1 Kings",
    "2Kings", "2KI", "2 Kings",
    "1Chronicles", "1CH", "1 Chronicles",
    "2Chronicles", "2CH", "2 Chronicles",
    "Ezra", "EZR",
    "Nehemiah", "NEH",
    "Esther", "EST",
    "Job", "JOB",
    "Psalms", "PSA", "Psalm",
    "Proverbs", "PRO",
    "Ecclesiastes", "ECC",
    "SongofSolomon", "SNG", "Song of Solomon",
    "Isaiah", "ISA",
    "Jeremiah", "JER",
    "Lamentations", "LAM",
    "Ezekiel", "EZK",
    "Daniel", "DAN",
    "Hosea", "HOS",
    "Joel", "JOL",
    "Amos", "AMO",
    "Obadiah", "OBA",
    "Jonah", "JON",
    "Micah", "MIC",
    "Nahum", "NAM",
    "Habakkuk", "HAB",
    "Zephaniah", "ZEP",
    "Haggai", "HAG",
    "Zechariah", "ZEC",
    "Malachi", "MAL",
    "Matthew", "MAT",
    "Mark", "MRK",
    "Luke", "LUK",
    "John", "JHN",
    "Acts", "ACT",
    "Romans", "ROM",
    "1Corinthians", "1CO", "1 Corinthians",
    "2Corinthians", "2CO", "2 Corinthians",
    "Galatians", "GAL",
    "Ephesians", "EPH",
    "Philippians", "PHP",
    "Colossians", "COL",
    "1Thessalonians", "1TH", "1 Thessalonians",
    "2Thessalonians", "2TH", "2 Thessalonians",
    "1Timothy", "1TI", "1 Timothy",
    "2Timothy", "2TI", "2 Timothy",
    "Titus", "TIT",
    "Philemon", "PHM",
    "Hebrews", "HEB",
    "James", "JAS",
    "1Peter", "1PE", "1 Peter",
    "2Peter", "2PE", "2 Peter",
    "1John", "1JN", "1 John",
    "2John", "2JN", "2 John",
    "3John", "3JN", "3 John",
    "Jude", "JUD",
    "Revelation", "REV"
];

function compareReflectionContentItems(a: ReflectionContentItem, b: ReflectionContentItem): number {
    const a_vref = reflectionUtils.lookUpKey(a, REFERENCE_KEY, '');
    const b_vref = reflectionUtils.lookUpKey(b, REFERENCE_KEY, '');

    if (typeof a_vref !== 'string' || typeof b_vref !== 'string') {
        return (a_vref as any) - (b_vref as any);
    }

    const a_vref_match = a_vref.match(/(\w+)\s(\d+):(\d+)/);
    const b_vref_match = b_vref.match(/(\w+)\s(\d+):(\d+)/);

    if (a_vref_match && b_vref_match) {
        const a_book_name = a_vref_match[1];
        const b_book_name = b_vref_match[1];
        if (a_book_name !== b_book_name) {
            const a_book_index = BOOK_ORDER.indexOf(a_book_name);
            const b_book_index = BOOK_ORDER.indexOf(b_book_name);

            if (a_book_index === -1 || b_book_index === -1) {
                return a_vref.localeCompare(b_vref);
            } else {
                return a_book_index - b_book_index;
            }
        } else {
            return (parseInt(a_vref_match[2]) - parseInt(b_vref_match[2])) || (parseInt(a_vref_match[3]) - parseInt(b_vref_match[3]));
        }
    } else {
        return a_vref.localeCompare(b_vref);
    }
}

function sortReflectionContentItems(content_items: ReflectionContentItem[]): ReflectionContentItem[] {
    return content_items.sort(compareReflectionContentItems);
}


async function editVerse(selected_verse: ReflectionContentItem, old_text: string, new_text: string, translation_key: string[], translation_comment_key: string[]) {
    //if there is a grade collection for the current verse without the verse it was grading tagged
    //in with it go ahead and copy the translation in there.

    //is there a reflection loops section?
    if ('reflection_loops' in selected_verse) {
        const reflection_loops = selected_verse['reflection_loops'] as { [id: string]: string; }[];

        //are there any loops in it?
        if (reflection_loops && reflection_loops.length > 0) {

            const last_reflection_loop = reflection_loops[reflection_loops.length - 1];
            //does it have any grades in it yet?
            if ('grades' in last_reflection_loop) {

                const grades = last_reflection_loop['grades'];
                if (grades) {

                    //Is the graded_verse put in it yet?
                    if (!('graded_verse' in last_reflection_loop)) {
                        last_reflection_loop['graded_verse'] = old_text;

                        const comment = reflectionUtils.lookUpKey(selected_verse, translation_comment_key);
                        if (comment && typeof comment === 'string') {
                            last_reflection_loop['graded_verse_comment'] = comment;
                        }
                    }
                }
            }
        }
    }

    if ('reflection_is_finalized' in selected_verse && selected_verse['reflection_is_finalized']) {
        selected_verse['reflection_is_finalized'] = false;
    }

    reflectionUtils.setKey(selected_verse, translation_key, new_text);
    const currentComment = reflectionUtils.lookUpKey(selected_verse, translation_comment_key, '');
    if (currentComment !== '') {
        reflectionUtils.setKey(selected_verse, translation_comment_key, '');
    }
}




const REFERENCE_KEY = ["vref"];
const SOURCE_KEY = ["source"];
const TRANSLATION_KEY = ["fresh_translation", "text"];
const TRANSLATION_COMMENT_KEY = ["translation_notes"];


async function convertFilePathToRelative(fileDictionary: { [filePath: string]: any; }): Promise<{ [relativePath: string]: any; }> {
    const firstFolder = await getFirstWorkspaceFolder();

    const convertedDictionary: { [relativePath: string]: any; } = {};
    for (const [filePath, data] of Object.entries(fileDictionary)) {
        const relativePath = path.relative(firstFolder, filePath);
        convertedDictionary[relativePath] = data;
    }

    return convertedDictionary;
}

async function snarfCodexFiles(folder: string, extension: string): Promise<{ [filePath: string]: Date; }> {
    const workspaceFolder = await getFirstWorkspaceFolder();
    const dir = path.join(workspaceFolder, folder);

    const files = await fs.promises.readdir(dir);
    const codexFiles = await Promise.all(
        files
            .filter(file => file.endsWith(extension))
            .map(async file => {
                const filePath = path.join(dir, file);
                const stats = await fs.promises.stat(filePath);
                const modTime: Date = stats.mtime;
                return { [filePath]: modTime };
            })
    );

    const result: { [filePath: string]: Date; } = {};
    codexFiles.forEach(file => Object.assign(result, file));
    //console.log("worker: codex files with modification times: ", result);

    const relativeResult = await convertFilePathToRelative(result);
    return relativeResult;
}

async function snarfSingleCodexFile(filePathArg: string): Promise<{ [relativePath: string]: Date; }> {
    const workspaceFolder = await getFirstWorkspaceFolder();
    const filePath = path.join(workspaceFolder, filePathArg);
    if (!(await fs.promises.stat(filePath).catch(() => false))) {
        return {};
    }
    const stats = await fs.promises.stat(filePath);
    const modTime: Date = stats.mtime;
    const relativeResult = await convertFilePathToRelative({ [filePath]: modTime });
    return relativeResult;
}

async function listCodexFilesAndComments(): Promise<{ [filePath: string]: Date; }> {
    //Use snarfCodexFiles to get the source files from .project/sourceTexts
    //and the target files from files/target
    const sourceFiles = await snarfCodexFiles('.project/sourceTexts', '.source');
    const targetFiles = await snarfCodexFiles('files/target', '.codex');
    const commentFile = await snarfSingleCodexFile('.project/comments.json');
    // Combine the source and target files
    return { ...sourceFiles, ...targetFiles, ...commentFile };
}

async function getObservedModTimesFilePath(): Promise<string> {
    const folder = await getFirstWorkspaceFolder();
    return path.join(folder, '.project/reflection/observed_mod_times.json');
}

async function getObservedModTimes(): Promise<{ [file: string]: TrackingModTimes; }> {
    const filePath = await getObservedModTimesFilePath();
    try {
        const fileContent = await fs.promises.readFile(filePath);
        const json: JsonModTimes = JSON.parse(fileContent.toString());
        const result: { [file: string]: TrackingModTimes; } = {};
        for (const [filePath, modTimes] of Object.entries(json)) {
            result[filePath] = {
                observed_mod_time: new Date(modTimes.observed_mod_time),
                updated_mod_time: new Date(modTimes.updated_mod_time),
                reflected_mod_time: new Date(modTimes.reflected_mod_time),
                reported_mod_time: new Date(modTimes.reported_mod_time),
            };
        }
        return result;
    } catch (err) {
        return {};
    }
}

async function updateObservedModTimes(newModTimes: { [filePath: string]: Date; }): Promise<{ [file: string]: TrackingModTimes; }> {
    const observedModTimes = await getObservedModTimes();
    let changed = false;

    for (const [filePath, modTime] of Object.entries(newModTimes)) {
        if (!observedModTimes[filePath] || observedModTimes[filePath].observed_mod_time.getTime() < modTime.getTime()) {
            if (!observedModTimes[filePath]) {
                observedModTimes[filePath] = {
                    observed_mod_time: modTime,
                    updated_mod_time: new Date(0),
                    reflected_mod_time: new Date(0),
                    reported_mod_time: new Date(0),
                };
            } else {
                observedModTimes[filePath].observed_mod_time = modTime;
            }
            changed = true;
        }
    }

    if (changed) {
        await saveJson(await getObservedModTimesFilePath(), observedModTimes);
    }
    return observedModTimes;
}
async function updateUpdatedModTimes(trackingModTimes: { [file: string]: TrackingModTimes; }, filesToUpdate: { [file: string]: TrackingModTimes; }): Promise<void> {
    let changed = false;
    for (const [filePath, modTimes] of Object.entries(filesToUpdate)) {
        if (trackingModTimes[filePath].updated_mod_time.getTime() < modTimes.observed_mod_time.getTime()) {
            trackingModTimes[filePath].updated_mod_time = modTimes.observed_mod_time;
            changed = true;
        }
    }
    if (changed) {
        await saveJson(await getObservedModTimesFilePath(), trackingModTimes);
    }
}

async function getFilesToUpdate(trackingModTimes: { [filePath: string]: TrackingModTimes; }): Promise<{ [file: string]: TrackingModTimes; }> {
    return Object.entries(trackingModTimes)
        .filter(([filePath, modTimes]) => modTimes.observed_mod_time.getTime() > modTimes.updated_mod_time.getTime())
        .reduce((acc, [filePath, modTimes]) => {
            acc[filePath] = modTimes;
            return acc;
        }, {} as { [file: string]: TrackingModTimes; });
}

function notebookDataToIdToContent(noteBookData: any): IdToContent {
    const cells = noteBookData['cells'] ?? [];

    const result = cells.reduce((acc: IdToContent, cell: any) => {
        const id = cell['metadata']?.['id'] ?? '';
        const langId = cell['languageId'] ?? '';
        if (id && langId !== 'paratext') {
            const verse = cell['value'] ?? '';
            const verseWithoutHtml = verse.replace(/<[^>]*>/g, '');
            acc[id] = verseWithoutHtml;
        }
        return acc;
    }, {} as IdToContent);


    return result;
}

async function loadNotebookData(filePath: string): Promise<IdToContent> {
    //The file is a json file so go ahead and load it as such using fsPromises
    const absoluteFilePath = path.join(await getFirstWorkspaceFolder(), filePath);
    const fileContent = await fsPromises.readFile(absoluteFilePath);
    const fileData = JSON.parse(fileContent.toString());
    const verseData = notebookDataToIdToContent(fileData);
    return verseData;
}

function getReferencedLine(id: string, reflectionContent: ReflectionContent, makeIfMissing = false): ReflectionContentItem | undefined {
    for (const line of reflectionContent) {
        const line_id = reflectionUtils.lookUpKey(line, REFERENCE_KEY, '');
        if (line_id === id) {
            return line;
        }
    }
    if (makeIfMissing) {
        const result = {};
        reflectionUtils.setKey(result, REFERENCE_KEY, id);
        reflectionContent.push(result);
        return result;
    }
    return undefined;
}

async function getOldestTranslation(verse: reflectionUtils.Verse): Promise<string> {
    return (verse.reflection_loops?.[0]?.graded_verse) ?? await reflectionUtils.lookUpKey(verse, TRANSLATION_KEY, '');
}

async function updateReflectionContent(reflectionContent: ReflectionContent, id: string, new_text: string, is_source: boolean): Promise<boolean> {
    //If the update resulted in a change return true.


    if (new_text === '') {
        //If the new text is empty, ignore the issue.  Hopefully it is temporary.
        //I don't have a robust strategy for removing delted verses anyways.
        return false;
    }

    const line = getReferencedLine(id, reflectionContent, true);

    if (line === undefined) {
        //I have true set so it, will create the line if it doesn't exist,
        //but we do this so that the TypeScript compiler doesn't complain
        return false;
    }

    if (is_source) {
        //for source text, check if the key was changed, if so, update it and return true.  If not, return false
        const existingSource = reflectionUtils.lookUpKey(line, SOURCE_KEY, '');
        if (existingSource !== new_text) {
            reflectionUtils.setKey(line, SOURCE_KEY, new_text);
            return true;
        }
        return false;
    }

    //At this point we need to see if the existing text is the same.  If it is not we need to make the marks that the text has changed,
    //so the rest of the system can know it needs to be processed again.
    //const existingTranslation = reflectionUtils.lookUpKey(line, TRANSLATION_KEY, '');
    const existingTranslation = await getOldestTranslation(line);

    //first option, if the translation is the same, do nothing
    if (existingTranslation === new_text) {
        return false;
    }

    //third option, use editVerse which if the previous version has been graded already
    //then mark this as a change.
    if (existingTranslation !== new_text) {
        //We don't edit a verse in the way the StreamLit app would because it just is simpler to blow everything
        //away so that the reflection knows it has something new to work with and to start over
        //and the reporting reports against the oldest item in the list.
        //await editVerse(line, existingTranslation, new_text, TRANSLATION_KEY, TRANSLATION_COMMENT_KEY);
        await resetVerseTo(line, new_text);
        return true;
    }
    return false;
}

interface CodexCommentThread {
    deleted?: boolean;
    comments?: CodexComment[];
    cellId?: {
        cellId: string;
    };
}

interface CodexComment {
    deleted?: boolean;
    body?: string;
    author?: {
        name?: string;
    };
}

async function loadCommentsFromFile(filePath: string, config: Config): Promise<string[]> {
    const absoluteFilePath = path.join(await getFirstWorkspaceFolder(), filePath);
    const codexComments: CodexCommentThread[] = await reflectionUtils.loadJson(absoluteFilePath, []);

    const codexCommentsValueToIds: { [key: string]: string[]; } = {};
    const codexCommentsValueNIdsToName: { [key: string]: string; } = {};

    //Hash all the comments by content to list of cellIds.
    for (const thread of codexComments) {
        if (!thread.deleted) {
            const comments = thread.comments ?? [];
            for (const comment of comments) {
                if (!comment.deleted) {
                    const body = comment.body ?? '';
                    const id = thread?.cellId?.cellId ?? '';
                    if (!codexCommentsValueToIds[body]) {
                        codexCommentsValueToIds[body] = [];
                    }
                    if (!codexCommentsValueToIds[body].includes(id)) {
                        codexCommentsValueToIds[body].push(id);
                    }
                    codexCommentsValueNIdsToName[body + "&" + id] = comment?.author?.name ?? '<unknown>';
                }
            }
        }
    }

    //Also load the comments that we already know about using loadComments
    const currentComments = await loadComments(config);
    const currentCommentsValueToIds: { [key: string]: string[]; } = {};
    for (const comment of currentComments) {
        const body: string = comment.comment ?? '';
        for (const id of comment.ids) {
            if (!currentCommentsValueToIds[body]) {
                currentCommentsValueToIds[body] = [];
            }
            if (!currentCommentsValueToIds[body].includes(id)) {
                currentCommentsValueToIds[body].push(id);
            }
        }
    }

    //now to get things up to date, it is a mater of additions and removal of IDs from
    //comments.  When the last ID is removed the comment needs to be deleted.  So first do the additions
    //so that we can tell with the deletions which comments need to be deleted.
    const additions: { [key: string]: string[]; } = {};
    const removals: { [key: string]: string[]; } = {};


    const touchedIds: string[] = [];

    //check for additions
    for (const [body, ids] of Object.entries(codexCommentsValueToIds)) {
        for (const id of ids) {
            if (!currentCommentsValueToIds[body] || !currentCommentsValueToIds[body].includes(id)) {
                if (!additions[body]) {
                    additions[body] = [];
                }
                if (!additions[body].includes(id)) {
                    additions[body].push(id);
                }
                if (!touchedIds.includes(id)) {
                    touchedIds.push(id);
                }
            }
        }
    }
    //check for removals.
    for (const [body, ids] of Object.entries(currentCommentsValueToIds)) {
        for (const id of ids) {
            if (!codexCommentsValueToIds[body] || !codexCommentsValueToIds[body].includes(id)) {
                if (!removals[body]) {
                    removals[body] = [];
                }
                if (!removals[body].includes(id)) {
                    removals[body].push(id);
                }
                if (!touchedIds.includes(id)) {
                    touchedIds.push(id);
                }
            }
        }
    }



    //Ok, now make a pass through the comments by index (so we can delete things) and do additions and removals.
    for (let i = 0; i < currentComments.length; i++) {
        const ids_to_add = additions[currentComments[i].comment] ?? [];
        const ids_to_remove = removals[currentComments[i].comment] ?? [];
        for (const id of ids_to_add) {
            if (!currentComments[i].ids.includes(id)) {
                currentComments[i].ids.push(id);
            }
        }
        //having accomplished the addition of this comment, remove the entry from additions.
        delete additions[currentComments[i].comment];
        for (const id of ids_to_remove) {
            if (currentComments[i].ids.includes(id)) {
                currentComments[i].ids.splice(currentComments[i].ids.indexOf(id), 1);
            }
        }
        //now if the comment is empty, delete it.
        if (currentComments[i].ids.length === 0) {
            currentComments.splice(i, 1);
            i--;
        }
    }
    //now we need to add the remaining additions which were not accomplished by iterating the existing comments.
    for (const [body, ids] of Object.entries(additions)) {
        currentComments.push({ comment: body, ids, name: codexCommentsValueNIdsToName[body + "&" + ids[0]] ?? '<unknown>' });
    }

    //save the comments
    if (touchedIds.length > 0) await saveComments(currentComments, config);

    //Then we need to 
    return touchedIds;
}

async function updateReflectionContentFromFile(reflectionContent: ReflectionContent, filePath: string, config: Config): Promise<string[]> {
    const touchedIds: string[] = [];
    if (filePath.toLowerCase().endsWith('comments.json')) {
        const commentTouchedIds = await loadCommentsFromFile(filePath, config);
        touchedIds.push(...commentTouchedIds);
    } else {
        const verseData = await loadNotebookData(filePath);
        for (const [id, content] of Object.entries(verseData)) {
            const isSource = filePath.includes('sourceTexts');

            //tracking touched IDs are still needed for if the source is changed so that the verse can be reset
            //and regrown for that case.
            const somethingChanged = await updateReflectionContent(reflectionContent, id, content, isSource);
            if (somethingChanged && !touchedIds.includes(id)) {
                touchedIds.push(id);
            }
        }
    }
    return touchedIds;
}

async function resetVerseTo(verse: reflectionUtils.Verse, text: string): Promise<void> {
    verse.reflection_loops = [];
    if (verse.reflection_is_finalized) verse.reflection_is_finalized = false;
    if (verse.reflection_finalized_grade) verse.reflection_finalized_grade = null;
    if (verse.reflection_finalized_comment) verse.reflection_finalized_comment = null;
    if (verse.comment_mod_loop_count) verse.comment_mod_loop_count = 0;
    reflectionUtils.setKey(verse, TRANSLATION_KEY, text);
}

async function updateReflectionFiles(filesToUpdate: { [file: string]: TrackingModTimes; }, config: Config): Promise<{ [file: string]: TrackingModTimes; }> {
    const successfullyUpdatedFiles: { [file: string]: TrackingModTimes; } = {};

    const reflectionContent: ReflectionContent = (await reflectionUtils.loadJsonl(
        path.join(await getFirstWorkspaceFolder(), '.project/reflection/reflection.jsonl'),
        []
    )) as ReflectionContent;

    const touchedIds: string[] = [];

    for (const [filePath, modTimes] of Object.entries(filesToUpdate)) {
        try {
            const newTouchedIds = await updateReflectionContentFromFile(reflectionContent, filePath, config);
            touchedIds.push(...newTouchedIds);
            successfullyUpdatedFiles[filePath] = modTimes;
        } catch (e) {
            console.log(`worker: error loading file: ${filePath}`, e);
        }
    }

    //now if the config calls for it, nuke all the reflection loops on verses that have touchedIds.
    if (config.reset_reflection_loops_on_update && touchedIds.length > 0) {
        for (const verse of reflectionContent) {
            const vref = reflectionUtils.lookUpKey(verse, config.reference_key) as string;
            if (touchedIds.includes(vref)) {
                console.log(`worker: resetting reflection loops for ${vref}`);
                await resetVerseTo(verse, await getOldestTranslation(verse));
            }
        }
    }

    //save reflectionContent back out.
    if (Object.keys(successfullyUpdatedFiles).length > 0) {
        sortReflectionContentItems(reflectionContent);
        await reflectionUtils.saveJsonl(path.join(await getFirstWorkspaceFolder(), '.project/reflection/reflection.jsonl'), reflectionContent);
    }


    return successfullyUpdatedFiles;
}


async function updateReflectionFilesAndTimes(config: Config) {
    const trackingModTimes = await updateObservedModTimes(await listCodexFilesAndComments());
    const filesToUpdate = await getFilesToUpdate(trackingModTimes);
    const successfullyUpdatedFiles = await updateReflectionFiles(filesToUpdate, config);
    await updateUpdatedModTimes(trackingModTimes, successfullyUpdatedFiles);
}

async function loadConfig() {
    const configFile = path.join(await getFirstWorkspaceFolder(), '.project/reflection/reflectionConfig.json');
    try {
        const data = await fsPromises.readFile(configFile, 'utf-8');
        const config = JSON.parse(data) as Config;
        return config;
    } catch (error) {
        return {};
    }
}
async function loadApiKeys(): Promise<{ [key: string]: any; }> {
    const apiKeysFile = path.join(await getFirstWorkspaceFolder(), '.project/reflection/apiKeys.json');
    try {
        const data = await fsPromises.readFile(apiKeysFile, 'utf-8');
        return JSON.parse(data) as { [key: string]: any; };
    } catch (e) {
        return {}; // Return empty object if file doesn't exist or is invalid
    }
}

async function setGuiConfigs(apiKeys: { [key: string]: any; }, reflectionConfig: Config): Promise<[{ [key: string]: any; }, Config]> {
    const openAIKey = await getConfigurationOption('codex-reflection.openAIKey');
    if (openAIKey && typeof openAIKey === 'string' && openAIKey.length > 0) {
        if (typeof apiKeys.guiConfig !== 'object' || apiKeys.guiConfig === null) {
            apiKeys.guiConfig = {};
        }
        apiKeys.guiConfig.key = openAIKey;
    }
    const target_language = await getConfigurationOption('codex-project-manager.targetLanguage.refName');
    if (target_language && typeof target_language === 'string' && target_language.length > 0) {
        reflectionConfig.target_language = target_language;
    }
    const first_verse_ref = await getConfigurationOption('codex-reflection.firstVerseRef');
    if (first_verse_ref && typeof first_verse_ref === 'string' && first_verse_ref.length > 0) {
        reflectionConfig.first_verse_ref = first_verse_ref;
    }
    const last_verse_ref = await getConfigurationOption('codex-reflection.lastVerseRef');
    if (last_verse_ref && typeof last_verse_ref === 'string' && last_verse_ref.length > 0) {
        reflectionConfig.last_verse_ref = last_verse_ref;
    }
    const translation_objective = await getConfigurationOption('codex-reflection.translationObjective');
    if (translation_objective && typeof translation_objective === 'string' && translation_objective.length > 0) {
        reflectionConfig.translation_objective = translation_objective;
    }
    const main_chat_language = await getConfigurationOption('codex-editor-extension.main_chat_language');
    if (main_chat_language && typeof main_chat_language === 'string' && main_chat_language.length > 0) {
        if (!reflectionConfig.reports) {
            reflectionConfig.reports = {};
        }
        reflectionConfig.reports['report language'] = main_chat_language;
    }
    return [apiKeys, reflectionConfig];
}

async function setConfigDefaults(config: Config): Promise<Config> {
    return {
        ...config,
        reset_reflection_loops_on_update: config.reset_reflection_loops_on_update ?? true,
        api_key: config.api_key ?? ['guiConfig', 'key'],
        reflection_input: config.reflection_input ?? "./.project/reflection/reflection.jsonl",
        reflection_output: config.reflection_output ?? "./.project/reflection/reflection.jsonl",
        collected_comments_file: config.collected_comments_file ?? "./.project/reflection/comments.jsonl",
        model: config.model ?? "gpt-4.1-mini",
        reference_key: config.reference_key ?? REFERENCE_KEY,
        source_key: config.source_key ?? SOURCE_KEY,
        translation_key: config.translation_key ?? TRANSLATION_KEY,
        translation_comment_key: config.translation_comment_key ?? TRANSLATION_COMMENT_KEY,
        grades_per_reflection_loop: config.grades_per_reflection_loop ?? 6,
        average_grade_csv_log: config.average_grade_csv_log ?? "./.project/reflection/average_grades.csv",
        num_context_verses_before: config.num_context_verses_before ?? 10,
        num_context_verses_after: config.num_context_verses_after ?? 10,
        temperature: config.temperature ?? 1.2,
        top_p: config.top_p ?? 0.9,
        reflection_loops_per_verse: config.reflection_loops_per_verse ?? 10,
        translation_objective: config.translation_objective ?? "Purpose: This translation is designed to support Bible translation efforts by providing a clear, accurate, and accessible text in {target_language}. Here are key criteria to assess the translation quality of individual verses:\nLiteral Faithfulness: The translation should closely mirror the source language, preserving the structure and phrasing to the extent possible without compromising clarity.\nClarity and Simplicity: The language used should be straightforward and easy to understand, avoiding complex or archaic terms to ensure accessibility for a broad audience.\nConsistency in Terminology: Key terms and theological concepts should be translated uniformly throughout the text to maintain coherence and aid in comprehension.\nMinimal Interpretive Bias: The translation should avoid inserting interpretive or doctrinal biases, allowing readers to engage with the text without undue influence from the translator's perspective.\nSupport for Exegetical Work: The translation should serve as a reliable foundation for further study, teaching, and translation, providing a text that is both accurate and conducive to in-depth analysis.",
        target_language: config.target_language ?? "the target language",
        summarize_corrections: config.summarize_corrections ?? true,
        highest_grade_to_reflect: config.highest_grade_to_reflect ?? 90,
        reports: {
            ...config.reports,
            "report language": config.reports?.["report language"] ?? 'English',
        },
        html_reports: {
            ...config.html_reports,
            output_folder: config.html_reports?.output_folder ?? "./files/reflection/html_reports",
            cacheFolder: config.html_reports?.cacheFolder ?? "./.project/reflection/cache",
        }
    };

}


async function runProcess() {
    console.log("worker: Process run.");

    try {
        const config = await loadConfig();
        let apiKeys = await loadApiKeys();
        const { saveTimeout = 20 } = config;

        let reflectionConfig = config?.configs?.reflection ?? {};
        [apiKeys, reflectionConfig] = await setGuiConfigs(apiKeys, reflectionConfig);
        reflectionConfig = await setConfigDefaults(reflectionConfig);

        await updateReflectionFilesAndTimes(reflectionConfig);

        await runConfigLowestGradePriority(reflectionConfig, apiKeys, saveTimeout);

        // Load reflection content and call run from htmlReport
        const reflectionContent: reflectionUtils.Verse[] = await reflectionUtils.loadJsonl(
            path.join(path.join(await getFirstWorkspaceFolder(), reflectionConfig.reflection_output ?? "./.project/reflection/reflection.jsonl")),
            []
        ) as reflectionUtils.Verse[];

        await runHtmlReport(reflectionContent, reflectionConfig, apiKeys);
    } catch (e: any) {
        await postMessageAndShowError(`Error in reflection worker: ${e.message || e}`);
        console.error("Error in runProcess:", e);
    }
}

runProcess().then(async () => {
    console.log("worker: Reflection finished.");
    await postMessageAndShowInfo("Reflection finished");
    setTimeout(process.exit, 100);
}).catch(async (e) => {
    await postMessageAndShowError(`Reflection failed: ${e.message || e}`);
    setTimeout(() => process.exit(1), 100);
});
