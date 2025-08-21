
import * as fsPromises from 'fs/promises';
import OpenAI from 'openai';
import path from 'path';




export type Grade = { [key: string]: any; };
export type Verse = { [key: string]: any; };

//https://gist.github.com/keesey/e09d0af833476385b9ee13b6d26a2b84
export function levenshtein(a: string, b: string) {
    const an = a.length;
    const bn = b.length;
    if (an === 0) {
        return bn;
    }
    if (bn === 0) {
        return an;
    }
    const matrix = new Array<number[]>(bn + 1);
    for (let i = 0; i <= bn; ++i) {
        const row = (matrix[i] = new Array<number>(an + 1));
        row[0] = i;
    }
    const firstRow = matrix[0];
    for (let j = 1; j <= an; ++j) {
        firstRow![j] = j;
    }
    for (let i = 1; i <= bn; ++i) {
        for (let j = 1; j <= an; ++j) {
            if (b.charAt(i - 1) === a.charAt(j - 1)) {
                matrix[i]![j] = matrix[i - 1]![j - 1]!;
            } else {
                matrix[i]![j] =
                    Math.min(
                        matrix[i - 1]![j - 1]!, // substitution
                        matrix[i]![j - 1]!, // insertion
                        matrix[i - 1]![j]! // deletion
                    ) + 1;
            }
        }
    }
    return matrix[bn]![an]!;
}

/**
 * Look up a key in a nested dictionary or array.
 * @param data - The dictionary or array to look up in
 * @param keys - The list of keys to look up
 * @param defaultValue - Value to return if the key doesn't exist (default: null)
 * @param noneIsValid - Whether null is a valid return value (default: true)
 * @returns The value at the key path, or defaultValue if it doesn't exist
 */
export function lookUpKey(
    data: unknown,
    keys: (string | number)[],
    defaultValue: unknown = null,
    noneIsValid: boolean = true
): unknown {
    let current = data;

    for (const key of keys) {
        if (Array.isArray(current)) {
            if (typeof key !== 'number' || key < 0 || key >= current.length) {
                return defaultValue;
            }
            current = current[key];
        } else if (typeof current === 'object' && current !== null && key in current) {
            current = (current as Record<string | number, unknown>)[key];
        } else {
            return defaultValue;
        }
    }

    if (current === null && !noneIsValid) {
        return defaultValue;
    }

    return current;
}


/**
 * Set a key in a nested dictionary.
 * @param data - The dictionary to set in
 * @param keys - The list of keys to set
 * @param value - The value to set
 */
export function setKey(data: Record<string, unknown>, keys: string[], value: unknown): void {
    let current = data;

    for (const key of keys.slice(0, -1)) {
        if (!(key in current)) {
            current[key] = {};
        }
        current = current[key] as Record<string, unknown>;
    }

    current[keys[keys.length - 1]] = value;
}

/**
 * Load a file with one JSON object per line.
 * @param file - Path to the input file
 * @param defaultValue - Value to return if file is not found (default: null)
 * @returns Array of parsed JSON objects or defaultValue if file is not found
 * @throws FileNotFoundError if file is not found and no default is provided
 */
export async function loadJsonl(file: string, defaultValue: unknown = null): Promise<unknown[]> {
    try {
        const content = await fsPromises.readFile(file, { encoding: 'utf-8' });
        return content.split('\n').filter(line => line.trim()).map(line => JSON.parse(line));
    } catch (error) {
        if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
            if (defaultValue === null) {
                throw error;
            }
            return defaultValue as unknown[];
        }
        throw error;
    }
}

/**
 * Save a file with one JSON object per line.
 * @param filename - Path to the output file
 * @param data - Array of JSON-serializable objects to save
 */
export async function saveJsonl(filename: string, data: unknown[]): Promise<void> {
    const dirname = path.dirname(filename);

    // Create directory if it doesn't exist
    await fsPromises.mkdir(dirname, { recursive: true });

    const tempFilename = `${filename}~`;

    // Write JSON objects line by line to temporary file
    const content = data.map(line => JSON.stringify(line)).join('\n');
    await fsPromises.writeFile(tempFilename, content, { encoding: 'utf-8' });

    // Replace the original file with the temporary file
    await fsPromises.rename(tempFilename, filename);
}

export function splitRef(reference: string): [string, number | null, number | string | null] {
    /**
     * Splits a reference into book, chapter, and verse.
     */
    if (!reference.includes(' ')) {
        return [reference, null, null];
    }

    const lastSpaceIndex = reference.lastIndexOf(' ');
    const bookSplit = reference.slice(0, lastSpaceIndex);
    const chapterVerseStr = reference.slice(lastSpaceIndex + 1);

    if (!chapterVerseStr.includes(':')) {
        return [bookSplit, parseInt(chapterVerseStr, 10), null];
    }

    const [chapterNum, verseNum] = chapterVerseStr.split(':');
    if (verseNum.includes('-')) {
        return [bookSplit, parseInt(chapterNum, 10), verseNum];
    }

    return [bookSplit, parseInt(chapterNum, 10), parseInt(verseNum, 10)];
}

export function splitRef2(reference: string): [string, number | null, number | null, number | null] {
    /**
     * Split a reference string into book, chapter, start verse, and end verse.
     * If the verse contains a range (e.g., "1-2"), return start and end verses as numbers.
     * Otherwise, return the verse as both start and end.
     */
    const [book, chapter, verse] = splitRef(reference);

    if (typeof verse === 'string' && verse.includes('-')) {
        const [startVerse, endVerse] = verse.split('-').map((x) => parseInt(x, 10));
        return [book, chapter, startVerse, endVerse];
    }

    if (typeof verse === 'string') {
        return [book, chapter, null, null];
    }

    return [book, chapter, verse, verse];
}

export function normalizeRanges(
    content: Verse[],
    referenceKey: string[],
    translationKey: string[],
    sourceKey: string[]
): Verse[] {
    /**
     * Normalize a list of verses such that if there are any ranges (<range> in the source or translation)
     * it will combine the previous verse with the current one (if there is one) into a single verse
     * with a combined reference and source and translation.
     *
     * The idea is that if there are any ranges in the source or translation, this function will
     * combine the previous verse with the current one into a single verse with a combined reference
     * and source and translation. If there are not any ranges, then the result is the same as the input.
     *
     * This function assumes that the input verses are sorted in the correct order.
     *
     * @param content The list of verses to normalize.
     * @param referenceKey The key to look for the reference in the verse objects.
     * @param translationKey The key to look for the translation in the verse objects.
     * @param sourceKey The key to look for the source in the verse objects.
     * @returns A list of verses with any ranges combined into a single verse.
     */
    const normalized: Verse[] = [];

    for (const thisVerse of content) {
        const thisTranslation = (lookUpKey(thisVerse, translationKey, '') as string).trim();
        const thisSource = (lookUpKey(thisVerse, sourceKey, '') as string).trim();

        if ((thisTranslation === '<range>' || thisSource === '<range>') && normalized.length > 0) {
            const lastVerse = normalized.pop()!;

            // Combine the reference
            const lastReference = lookUpKey(lastVerse, referenceKey) as string;
            const thisReference = lookUpKey(thisVerse, referenceKey) as string;
            const [lastBook, lastChapter, lastStartVerse] = splitRef2(lastReference);
            const [thisBook, thisChapter, , thisEndVerse] = splitRef2(thisReference);

            if (lastBook !== thisBook) {
                throw new Error('Ranges across books not supported.');
            }
            if (lastChapter !== thisChapter) {
                throw new Error('Ranges across chapters not supported.');
            }

            const reference = `${lastBook} ${lastChapter}:${lastStartVerse}-${thisEndVerse}`;

            // Combine the source
            const lastSource = lookUpKey(lastVerse, sourceKey, '') as string;
            const source = thisSource === '<range>' ? lastSource : `${lastSource}\n${thisSource}`.trim();

            // Combine the translation
            const lastTranslation = lookUpKey(lastVerse, translationKey, '') as string;
            const translation =
                thisTranslation === '<range>' ? lastTranslation : `${lastTranslation}\n${thisTranslation}`.trim();

            // Create the new structure
            const combinedVerse: Verse = {};
            setKey(combinedVerse, referenceKey, reference);
            if (source) {
                setKey(combinedVerse, sourceKey, source);
            }
            if (translation) {
                setKey(combinedVerse, translationKey, translation);
            }

            // Add it to the result
            normalized.push(combinedVerse);
        } else {
            normalized.push(thisVerse);
        }
    }

    return normalized;
}

export function getOverriddenReferences(
    translation: Verse[],
    referenceKey: string[],
    overrideKey: string[] | null
): Record<string, string> {
    /**
     * Find references that have been overridden
     */
    const overriddenReferences: Record<string, string> = {};
    if (overrideKey) {
        let lastReference: string | null = null;
        for (const verse of translation) {
            const reference = lookUpKey(verse, referenceKey) as string;
            if (lastReference) {
                const isOverride = lookUpKey(verse, overrideKey);
                if (isOverride) {
                    overriddenReferences[lastReference] = reference;
                }
            }
            lastReference = reference;
        }
    }

    // If you have a verse range with more than two verses, update the pointers
    // on the base verse to point to the end instead of being a linked list.
    const updatedReferences: Record<string, string> = {};
    for (const [key, value] of Object.entries(overriddenReferences)) {
        let currentValue = value;
        while (currentValue in overriddenReferences) {
            currentValue = overriddenReferences[currentValue];
        }
        updatedReferences[key] = currentValue;
    }

    return updatedReferences;
}


export interface Message {
    role: 'system' | 'user' | 'assistant';
    content: string;
    //[key: string]: any; // Adjust based on actual message structure
}


interface UseModelOptions {
    client: OpenAI;
    model: string;
    messages: Message[];
    temperature: number;
    top_p: number;
    response_format: any;
    n?: number; // Optional, defaults to 1
}

export async function useModel(options: UseModelOptions): Promise<OpenAI.Chat.Completions.ChatCompletion> {
    /**
     * This calls ChatGPT but wraps it in a try/catch to auto rehandle exceptions.
     */
    const { client, model, messages, temperature, top_p, response_format, n = 1 } = options;
    /**
     * This calls ChatGPT but wraps it in a try/catch to auto rehandle exceptions.
     */
    let finished = false;
    while (!finished) {
        try {
            const completion = await client.chat.completions.create({
                model,
                messages,
                temperature,
                top_p,
                response_format,
                n
            }, {
                timeout: 120000, // 120 seconds in milliseconds
            });

            finished = true;
            return completion;
        } catch (error) {
            console.error(`Error calling the model in useModel: ${error}`);
            console.log('Retrying...');
            await new Promise((resolve) => setTimeout(resolve, 5000)); // Wait 5 seconds
        }
    }

    // This line should never be reached due to the while loop, but TypeScript requires a return
    throw new Error('Unexpected exit from retry loop');
}

/**
 * Load a file with one JSON object at the root.
 * If the file does not exist, return the default value instead.
 * @param file - Path to the JSON file
 * @param defaultValue - Value to return if file does not exist (optional)
 * @returns Parsed JSON object or default value
 * @throws FileNotFoundError if file does not exist and no default is provided
 */
export async function loadJson<T>(file: string, defaultValue: T | null = null): Promise<T> {
    try {
        const data = await fsPromises.readFile(file, 'utf-8');
        return JSON.parse(data) as T;
    } catch (error) {
        if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
            if (defaultValue === null) {
                throw error;
            }
            return defaultValue;
        }
        throw error;
    }
}
/**
 * Save a file with one JSON object at the root.
 * @param filename - Path to save the JSON file
 * @param data - Data to serialize as JSON
 * @param indent - Number of spaces for JSON indentation (default: 4)
 */
export async function saveJson<T>(filename: string, data: T, indent: number = 4): Promise<void> {
    const dir = path.dirname(filename);
    try {
        await fsPromises.mkdir(dir, { recursive: true });
    } catch (error: unknown) {
        if (error instanceof Error && 'code' in error && (error as any).code !== 'EEXIST'){ throw error; }
    }

    const tempFilename = `${filename}~`;
    await fsPromises.writeFile(tempFilename, JSON.stringify(data, null, indent), { encoding: 'utf-8' });
    await fsPromises.rename(tempFilename, filename);
}


// Global in-memory cache to store loaded disk caches
const memoryCache: { [key: string]: { [key: string]: any; }; } = {};

export function cacheDecorator(cacheKey: string, enabled: boolean) {
    return function <T extends (...args: any[]) => any>(func: T): T {
        async function wrapper(this: any, ...args: Parameters<T>): Promise<Awaited<ReturnType<T>>> {
            if (enabled) {
                // Create a unique key from function arguments
                const argKey = JSON.stringify([args, {}]); // Simplified key generation, no kwargs in TS

                // Check if cache is already loaded in memory
                if (!(cacheKey in memoryCache)) {
                    // Load cache from JSON file only if not in memory
                    const cacheFile = `${cacheKey}.json`;
                    memoryCache[cacheKey] = await loadJson(cacheFile, {});
                }

                const cache = memoryCache[cacheKey];

                // Check if result is in cache
                if (argKey in cache) {
                    return cache[argKey];
                }

                // Call the function and cache the result
                const result = await func.apply(this, args);

                // Handle sync functions
                cache[argKey] = result;
                const cacheFile = `${cacheKey}.json`;
                await saveJson(cacheFile, cache);
                return result;
            } else {
                return await func.apply(this, args);
            }
        }

        // Preserve original function's metadata
        Object.defineProperty(wrapper, 'name', { value: func.name });
        Object.defineProperty(wrapper, 'length', { value: func.length });

        return wrapper as T;
    };
}



export function getLlmUrl(apiKeys: Record<string, any>, config: Record<string, any>): string | null {
    /**
     * Return the url for the llm given the config and apiKeys.
     */
    if (!('api_key' in config)) {
        return null;
    }

    const apiKey: string[] = config['api_key'];
    if (!apiKey || apiKey.length === 0) {
        return null;
    }

    // Create new key by taking all elements except the last and adding 'url'
    const urlKey = [...apiKey.slice(0, -1), 'url'];

    const value = lookUpKey(apiKeys, urlKey);
    if (typeof value === 'string') {
        return value;
    }
    return null;
}