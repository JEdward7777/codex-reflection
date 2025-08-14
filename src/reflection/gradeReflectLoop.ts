import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import * as reflectionUtils from './reflectionUtils';
import { OpenAI } from 'openai';
import { z } from 'zod';
import { getFirstWorkspaceFolder } from './workerUtils';
import { zodResponseFormat } from "openai/helpers/zod";
import { ApiKeys } from './reflectionTypes';

export type Config = { [key: string]: any; };
type ReflectionLoop = { [key: string]: any; };
type ReflectionResult = { [key: string]: any; };



interface ReflectionComment {
    comment: string;
    ids: string[];
    name: string;
}

async function constructCommentsPath(config: Config): Promise<string> {
    const collectedCommentsFile: string = config.collected_comments_file ?? path.join(
        'output', 'comments', path.basename(config.reflection_output)
    );

    const absoluteCommentsFile: string = path.join(await getFirstWorkspaceFolder(), collectedCommentsFile);

    return absoluteCommentsFile;
}

export async function loadComments(config: Config): Promise<ReflectionComment[]> {
    /**
     * Loads the comments.
    */
    const collectedCommentsFile: string = await constructCommentsPath(config);

    const collectedComments: ReflectionComment[] = await reflectionUtils.loadJsonl(collectedCommentsFile, []) as ReflectionComment[];

    return collectedComments;
}

export async function saveComments(comments: ReflectionComment[], config: Config): Promise<void> {
    /**
     * Save the comments.
    */
    const collectedCommentsFile: string = await constructCommentsPath(config);

    await reflectionUtils.saveJsonl(collectedCommentsFile, comments);
}

async function loadAndIndexComments(config: Config): Promise<Record<string, ReflectionComment[]>> {
    /**
     * Loads the comments and returns them indexed by
     * the verse they apply to.
     */

    const collectedComments: ReflectionComment[] = await loadComments(config);

    const indexedComments: Record<string, ReflectionComment[]> = {};
    for (const comment of collectedComments) {
        for (const vref of comment.ids) {
            if (!indexedComments[vref]) {
                indexedComments[vref] = [];
            }
            indexedComments[vref].push(comment);
        }
    }

    return indexedComments;
}

function verseIsFinalized(verse: reflectionUtils.Verse): boolean {
    /**
     * When running verses from lowest score to highest,
     * a verse is finalized if the version with the best grade it got
     * is brought to the front.
     */
    if (!verse.reflection_is_finalized) {
        return false;
    }

    return verse.reflection_is_finalized;
}

function computeGradeForReflectionLoop(reflectionLoop: ReflectionLoop, config: Config): number | null {
    /**
     * Compute the average grade of a reflection loop.
     */
    if (reflectionLoop.average_grade !== undefined) {
        return reflectionLoop.average_grade;
    }

    // If there is at least one grade, go ahead and average it.
    let gradeCount = 0;
    let gradeSum = 0;
    for (const grade of reflectionLoop.grades || []) {
        gradeCount += 1;
        gradeSum += grade.grade;
    }

    if (gradeCount > 0) {
        const averagedGrade = gradeSum / gradeCount;

        // If this is the correct count, we can stash it.
        if (gradeCount >= config.grades_per_reflection_loop) {
            reflectionLoop.average_grade = averagedGrade;
        }

        return averagedGrade;
    }

    return null;
}

export function computeVerseGrade(verse: reflectionUtils.Verse, config: Config): number | null {
    /**
     * Compute the average grade of a verse.
     */
    const vref = reflectionUtils.lookUpKey(verse, config.reference_key);

    if (vref === null || vref === undefined) {
        return null;
    }

    if (!verse.reflection_loops) {
        return null;
    }

    if (verse.reflection_loops.length === 0) {
        return null;
    }

    // If the verse has been finalized, return the finalized grade
    if (verseIsFinalized(verse)) {
        return verse.reflection_finalized_grade ?? null;
    }

    // Iterate backwards through the reflection_loops until we find one with a grade
    for (const reflectionLoop of verse.reflection_loops.slice().reverse()) {
        const loopGrade = computeGradeForReflectionLoop(reflectionLoop, config);
        if (loopGrade !== null && loopGrade !== undefined) {
            return loopGrade;
        }
    }

    return null;
}

function computeTranslationGrade(translation: reflectionUtils.Verse[], config: Config): number {
    /**
     * Compute the average grade of the translation.
     */
    let verseCount = 0;
    let verseSum = 0;

    for (const [verseLineNumber, verse] of translation.entries()) {
        if (config.start_line !== undefined && verseLineNumber < config.start_line - 1) {
            continue;
        }
        if (config.end_line !== undefined && verseLineNumber > config.end_line - 1) {
            break;
        }

        const verseGrade = computeVerseGrade(verse, config);
        if (verseGrade !== null && verseGrade !== undefined) {
            verseCount += 1;
            verseSum += verseGrade;
        }
    }

    if (verseCount === 0) {
        return 0;
    }

    return verseSum / verseCount;
}

interface SourceAndTranslation {
    reference: string;
    source: string | null;
    translation: string | null;
}
// Define Zod schema for AdaptationResponse
const AdaptationResponseSchema = z.object({
    planning_thoughts: z.string(),
    reference: z.string(),
    draft_translation_1: z.string(),
    draft_translation_2: z.string(),
    updated_translation: z.string(),
});

// TypeScript type inferred from Zod schema
type AdaptationResult = z.infer<typeof AdaptationResponseSchema>;

async function runAdaptationInference(
    selectedVerse: reflectionUtils.Verse,
    client: OpenAI,
    config: Config
): Promise<AdaptationResult> {
    /**
     * Run a single pass on the verse to adapt the translation outside of context,
     * so that we can switch modes without the context weighing us down.
     * Normal grading and reflection rounds will happen afterwards within context
     * of the source verse and surrounding context.
     */
    const systemMessage = `You are a conservative Bible Translator who is translating the Bible from a Christian perspective.`;

    const currentTranslation = reflectionUtils.lookUpKey(selectedVerse, config.translation_key) as string;
    const vref = reflectionUtils.lookUpKey(selectedVerse, config.reference_key) as string;

    const userMessageArray: string[] = [
        `The current translation of ${vref} is:\n\n\`\`\`\n${currentTranslation}\n\`\`\`\n\n`,
        config.adaptation_prompt?.replace('{vref}', vref) ?? '',
        '\n\n',
        'Run two draft translations before the final updated translation.\n',
        "Don't add any parenthetical comment to the translation.\n",
    ];

    if (config.dictionary) {
        if (config.dictionary_description) {
            userMessageArray.push(`\n${config.dictionary_description}\n`);
        }
        userMessageArray.push(JSON.stringify(config.dictionary, null, undefined) + '\n\n');
    }

    const userMessage = userMessageArray.join('');

    const completion = await reflectionUtils.useModel({
        client,
        model: config.adaption_model ?? config.model, // Handle typo in Python code
        messages: [
            { role: 'system', content: systemMessage },
            { role: 'user', content: userMessage },
        ],
        temperature: config.temperature,
        top_p: config.top_p,
        response_format: zodResponseFormat(AdaptationResponseSchema, "adaptation"),
        n: 1,
    });

    const result = AdaptationResponseSchema.parse(JSON.parse(completion.choices[0].message.content!));

    return result;
}

async function runAdaptationPass(verse: reflectionUtils.Verse, client: any, config: Config): Promise<boolean> {
    /**
     * Run the adaptation pass on the verse if there is no history in it.
     * If there is a history, don't touch the verse.
     */
    if (!config.adaptation_prompt) {
        return false;
    }

    if (verse.adapted) {
        return false;
    }

    const adaptationResult: AdaptationResult = await runAdaptationInference(verse, client, config);

    const referenceKey = config.reference_key;
    const translationKey = config.translation_key;
    const translationCommentKey = config.translation_comment_key ?? null;

    console.log(`Adapting verse ${reflectionUtils.lookUpKey(verse, referenceKey)}`);
    console.log(`old: ${reflectionUtils.lookUpKey(verse, translationKey)}`);
    console.log(`new: ${adaptationResult.updated_translation}\n`);

    // Ensure reflection_loops exists
    if (!verse.reflection_loops) {
        verse.reflection_loops = [];
    }
    const reflectionLoops: ReflectionLoop[] = verse.reflection_loops;

    // Ensure last_reflection_loop exists
    if (reflectionLoops.length === 0) {
        reflectionLoops.push({});
    }
    let lastReflectionLoop = reflectionLoops[reflectionLoops.length - 1];
    if (lastReflectionLoop.graded_verse) {
        lastReflectionLoop = {};
        reflectionLoops.push(lastReflectionLoop);
    }

    // Stash the adaptation result into the history
    if (translationCommentKey) {
        lastReflectionLoop.graded_verse_comment = reflectionUtils.lookUpKey(verse, translationCommentKey) as string | undefined;
    }
    lastReflectionLoop.graded_verse = reflectionUtils.lookUpKey(verse, translationKey) as string | undefined;
    lastReflectionLoop.is_adaptation = true;

    // Replace the translation
    reflectionUtils.setKey(verse, translationKey, adaptationResult.updated_translation);
    if (translationCommentKey) {
        reflectionUtils.setKey(verse, translationCommentKey, adaptationResult.planning_thoughts);
    }

    if (verse.human_reviewed) {
        verse.human_reviewed = false;
    }

    verse.adapted = true;

    return true;
}

function constructTranslationObjective(
    verse: reflectionUtils.Verse,
    config: Config,
    indexedComments: Record<string, ReflectionComment[]>
): string {
    /**
     * This returns the translation objective from the config, but also
     * adds in the comments which have been left for this verse.
     */
    const vref = reflectionUtils.lookUpKey(verse, config.reference_key) as string;
    const comments = (indexedComments[vref] || []).map((x) => x.comment);

    const translation_objective = config.translation_objective?.replace(/{target_language}/g, config.target_language) ?? '';

    const result = [translation_objective, ...comments].join('\n');

    return result;
}

async function buildCommonContext(
    selectedVerse: reflectionUtils.Verse,
    reflectionOutput: reflectionUtils.Verse[],
    config: Config,
    overriddenReferences: Record<string, string>,
    indexedComments: Record<string, ReflectionComment[]>,
    client: any // Adjust based on actual client type
): Promise<string> {
    /**
     * There are different LLM operations but they have common context. This builds it.
     */
    const numContextVersesBefore = config.num_context_verses_before;
    const numContextVersesAfter = config.num_context_verses_after;

    const selectedVerseIndex = reflectionOutput.indexOf(selectedVerse);

    const firstIncludedIndex = Math.max(selectedVerseIndex - numContextVersesBefore, 0);
    const lastIncludedIndex = Math.min(
        selectedVerseIndex + numContextVersesAfter,
        reflectionOutput.length - 1
    );

    const sourceAndTranslation: SourceAndTranslation[] = [];

    for (let index = firstIncludedIndex; index <= lastIncludedIndex; index++) {
        const verseReference = reflectionUtils.lookUpKey(reflectionOutput[index], config.reference_key) as string | null;
        if (verseReference && !(verseReference in overriddenReferences)) {
            // If this verse is used for context, ensure the adaptation pass has happened
            await runAdaptationPass(reflectionOutput[index], client, config);

            const translation = reflectionUtils.lookUpKey(reflectionOutput[index], config.translation_key) as string | null;
            const source = reflectionUtils.lookUpKey(reflectionOutput[index], config.source_key) as string | null;

            sourceAndTranslation.push({
                reference: verseReference,
                source,
                translation,
            });
        }
    }

    const selectedVerseVref = reflectionUtils.lookUpKey(selectedVerse, config.reference_key) as string | null;

    const sourceAndTranslationJson = JSON.stringify(sourceAndTranslation, null, 2);
    const userMessageArray = [
        'Translation Objective: ',
        await constructTranslationObjective(selectedVerse, config, indexedComments), // Assuming async
        '\n\n',
        `Source and target text of ${selectedVerseVref} and its surrounding context:\n`,
        sourceAndTranslationJson,
        '\n',
    ];

    const result = userMessageArray.join('');

    return result;
}

// Define Zod schema for GradeResponse
const GradeResponseSchema = z.object({
    comment: z.string(),
    grade: z.number().int().min(0).max(100),
});

// TypeScript type inferred from Zod schema
type GradeResponse = z.infer<typeof GradeResponseSchema>;

async function multiGradeVerse(
    selectedVerse: reflectionUtils.Verse,
    commonContext: string,
    client: OpenAI,
    config: Config,
    numGrades: number
): Promise<GradeResponse[]> {
    /**
     * Grade the translation of a verse.
     */
    const vref = reflectionUtils.lookUpKey(selectedVerse, config.reference_key) as string;

    const systemMessage = `You are a teacher grading a student's translation of the Bible from a conservative Christian viewpoint.`;

    const userMessageArray: string[] = [commonContext, '\n'];

    if (config.dictionary) {
        if (config.dictionary_description) {
            userMessageArray.push(`\n${config.dictionary_description}\n`);
        }
        userMessageArray.push(JSON.stringify(config.dictionary, null, undefined) + '\n\n');
    }

    userMessageArray.push(
        `Instructions: Review the student's work translating ${vref} from a conservative `,
        `Christian perspective and give it a grade comment and a grade from 0 to 100 where 0 is `,
        `failing and 100 is perfection.\n`
    );

    if (config.grading_prompt) {
        userMessageArray.push(`${config.grading_prompt.replace('{vref}', vref)}\n`);
    }

    const userMessage = userMessageArray.join('');

    const completion = await reflectionUtils.useModel({
        client,
        model: config.model,
        messages: [
            { role: 'system', content: systemMessage },
            { role: 'user', content: userMessage },
        ],
        temperature: config.temperature,
        top_p: config.top_p,
        response_format: zodResponseFormat(GradeResponseSchema, "grade_response"),
        n: numGrades,
    });

    const results: GradeResponse[] = [];
    for (let i = 0; i < numGrades; i++) {
        results.push(GradeResponseSchema.parse(JSON.parse(completion.choices[i].message.content!)));
    }

    return results;
}

const ITERATIONS_PASS_COMMENT_DEFAULT = 5;

function computeReflectionLoopsNeeded(verse: reflectionUtils.Verse, config: Config): number {
    /**
     * Compute the number of loops that are needed for a given verse.
     */
    // The default count is from reflection_loops_per_verse, but if the verse has had
    // comments touch it, then that gets recorded in comment_mod_loop_count and we want to
    // go past that amount by iterations_pass_comment
    return Math.max(
        (verse.comment_mod_loop_count ?? -ITERATIONS_PASS_COMMENT_DEFAULT) +
        (config.iterations_pass_comment ?? ITERATIONS_PASS_COMMENT_DEFAULT),
        config.reflection_loops_per_verse ?? 0
    );
}


function computeNumberUnansweredGrades(verse: reflectionUtils.Verse, config: Config): number {
    /**
     * Determine the number of grades that have not been answered by a reflection.
     */
    if (!verse.reflection_loops) {
        return 0;
    }

    if (verse.reflection_loops.length === 0) {
        return 0;
    }

    const lastReflectionLoop = verse.reflection_loops[verse.reflection_loops.length - 1];

    // If the current reflection loop has had reflection,
    // then we say we haven't graded yet unless it is the final loop.
    if (lastReflectionLoop.graded_verse) {
        if (computeReflectionLoopsNeeded(verse, config) > verse.reflection_loops.length) {
            return 0;
        }
    }

    return lastReflectionLoop.grades?.length ?? 0;
}

function verseNeedsFinalization(verse: reflectionUtils.Verse, config: Config): boolean {
    /**
     * A verse needs finalized if there has been the correct number
     * of loops and the last set of grades have been reflected on.
     */
    const reflectionLoops = verse.reflection_loops ?? [];
    if (reflectionLoops.length < Math.max(1, computeReflectionLoopsNeeded(verse, config))) {
        return false;
    }

    // Check if the last reflection loop has the required number of grades
    if (reflectionLoops[reflectionLoops.length - 1].grades.length < config.grades_per_reflection_loop) {
        return false;
    }

    return true;
}

function finalizeVerse(verse: reflectionUtils.Verse, config: Config): void {
    /**
     * When running verses from lowest score to highest,
     * a verse is finalized if the version with the best grade it got
     * is brought to the front.
     */
    if (!verse.reflection_loops) {
        return;
    }

    if (verseIsFinalized(verse)) {
        return;
    }

    if (!verseNeedsFinalization(verse, config)) {
        return;
    }

    // computeVerseGrade has a side effect of making all average grades cached
    computeVerseGrade(verse, config);

    const firstIndexConsidered = verse.comment_mod_loop_count ?? 0;

    let bestLoop: ReflectionLoop | null = null;
    let bestGrade: number | null = null;
    for (const reflectionLoop of verse.reflection_loops.slice(firstIndexConsidered)) {
        if (reflectionLoop.average_grade !== undefined) {
            if (bestLoop === null || (bestGrade !== null && bestGrade <= reflectionLoop.average_grade)) {
                bestLoop = reflectionLoop;
                bestGrade = reflectionLoop.average_grade;
            }
        }
    }

    if (bestLoop !== null) {
        // Ensure the last reflection loop has its verse marked
        const lastLoop = verse.reflection_loops[verse.reflection_loops.length - 1];
        if (!lastLoop.graded_verse) {
            lastLoop.graded_verse = reflectionUtils.lookUpKey(verse, config.translation_key) as string | undefined;
            if (config.translation_comment_key) {
                lastLoop.graded_verse_comment = reflectionUtils.lookUpKey(verse, config.translation_comment_key) as string | undefined;
            }
        }

        // Overwrite the official verse with the best-graded version
        reflectionUtils.setKey(verse, config.translation_key, bestLoop.graded_verse!);
        if (config.translation_comment_key) {
            reflectionUtils.setKey(verse, config.translation_comment_key, bestLoop.graded_verse_comment!);
        }

        // Mark as finalized
        verse.reflection_is_finalized = true;
        verse.reflection_finalized_grade = bestGrade!;
    }
}


// Define Zod schema for SummarizeResponse
const SummarizeResponseSchema = z.object({
    planning_thoughts: z.string(),
    summary: z.string(),
});

// TypeScript type inferred from Zod schema
type SummarizeResponse = z.infer<typeof SummarizeResponseSchema>;


async function summarizeCorrections(
    selectedVerse: reflectionUtils.Verse,
    client: OpenAI,
    config: Config
): Promise<SummarizeResponse> {
    /**
     * Summarize the corrections of a verse.
     */
    const vref = reflectionUtils.lookUpKey(selectedVerse, config.reference_key) as string;

    const systemMessage = `You are a teacher compiling a summary of corrections from a peer review of the Bible from a conservative Christian viewpoint.`;

    const userMessageArray: (string | number)[] = [];

    // Put the translation history in
    let hadHistory = false;
    const relevantLoops = selectedVerse.reflection_loops.slice(
        selectedVerse.comment_mod_loop_count ?? 0,
        -1
    );
    if (relevantLoops.length > 0) {
        userMessageArray.push('##Edit History:\n');
        relevantLoops.forEach((reflectionLoop: ReflectionLoop, i: number) => {
            hadHistory = true;
            userMessageArray.push(
                `${vref} version ${i + 1}:\n\`\`\`\n${reflectionLoop.graded_verse ?? ''}\n\`\`\`\n`
            );

            if (
                reflectionLoop.correction_summarization &&
                reflectionLoop.correction_summarization.summary
            ) {
                userMessageArray.push(
                    `Past Fix: ${i + 1}:\n\`\`\`\n${reflectionLoop.correction_summarization.summary}\n\`\`\`\n\n`
                );
            }
        });
    }

    // Show the current version of the verse
    userMessageArray.push(
        `Source: ${reflectionUtils.lookUpKey(selectedVerse, config.source_key) ?? ''}\n`,
        `Current Translation: ${reflectionUtils.lookUpKey(selectedVerse, config.translation_key) ?? ''}\n\n`
    );

    // Add the current correction requests under the persona of a peer review
    userMessageArray.push(`##Peer review comments for ${vref}:\n`);
    const selectedReflectionLoop = selectedVerse.reflection_loops[selectedVerse.reflection_loops.length - 1];
    selectedReflectionLoop.grades?.forEach((grade: reflectionUtils.Grade, i: number) => {
        userMessageArray.push(`Correction #${i + 1}:\n\`\`\`\n${grade.comment}\n\`\`\`\n\n`);
    });

    if (config.summarize_instructions) {
        userMessageArray.push(`${config.summarize_instructions}\n`);
    } else {
        userMessageArray.push(
            `Instructions: Review the peer review comments, prioritize and summarize the most important corrections.`,
            `Comments which request removing content are highest priority. `,
            `Comments which request fixing content are the second highest priority. `,
            `Comments which request adding new content are the lowest priority. `
        );
    }

    if (hadHistory) {
        userMessageArray.push(
            `Review the edit history to prevent repeating history, for example requesting adding `,
            `content which was intentionally removed.`
        );
    }

    const userMessage = userMessageArray.join('');

    const completion = await reflectionUtils.useModel({
        client,
        model: config.model,
        messages: [
            { role: 'system', content: systemMessage },
            { role: 'user', content: userMessage },
        ],
        temperature: config.temperature,
        top_p: config.top_p,
        response_format: zodResponseFormat(SummarizeResponseSchema, 'summarize'),
        n: 1,
    });

    const result = SummarizeResponseSchema.parse(JSON.parse(completion.choices[0].message.content!));

    return result;
}

// Define Zod schema for InterimReflectionResponse (used for LLM output)
const InterimReflectionResponseSchema = z.object({
    planning_thoughts: z.string(),
    reference: z.string(),
    updated_translation: z.string(),
});

// TypeScript type inferred from interim schema
type InterimReflectionResponse = z.infer<typeof InterimReflectionResponseSchema>;

// Define full ReflectionResponse type, extending InterimReflectionResponse
interface ReflectionResponse extends InterimReflectionResponse {
    correction_summarization?: {
        summary: string;
        [key: string]: any; // Adjust based on actual summarization structure
    };
}

async function performReflection(
    selectedVerse: reflectionUtils.Verse,
    commonContext: string,
    client: OpenAI,
    config: Config
): Promise<ReflectionResponse> {
    /**
     * Run the reflection step where the grade comments of a verse are utilized to revise a verse.
     */
    const vref = reflectionUtils.lookUpKey(selectedVerse, config.reference_key) as string;

    const systemMessage = `You are a gifted Bible student, who is implementing corrections from your teachers, on your Bible translation. Both you and your teachers operate from a Conservative Christian perspective.`;

    const userMessageArray: (string | number)[] = [commonContext, '\n\n'];

    userMessageArray.push(`The current verse is ${vref}\n`);

    if (config.dictionary) {
        if (config.dictionary_description) {
            userMessageArray.push(`\n${config.dictionary_description}\n`);
        }
        userMessageArray.push(JSON.stringify(config.dictionary, null, undefined) + '\n\n');
    }

    // Check if summarize_corrections is enabled
    let correctionSummarizationResult: SummarizeResponse | null = null;
    if (config.summarize_corrections) {
        correctionSummarizationResult = await summarizeCorrections(selectedVerse, client, config);
        userMessageArray.push(`Correction:\n\`\`\`\n${correctionSummarizationResult.summary}\n\`\`\`\n\n`);
    } else {
        const selectedReflectionLoop = selectedVerse.reflection_loops[selectedVerse.reflection_loops.length - 1];
        selectedReflectionLoop.grades.forEach((grade: reflectionUtils.Grade, i: number) => {
            userMessageArray.push(`Correction #${i + 1}:\n\`\`\`\n${grade.comment}\n\`\`\`\n\n`);
        });
    }

    userMessageArray.push(
        `Instructions: Attempt to satisfy all provided instructions for ${vref} to the best of your `,
        `ability. If the instructions are contradictory or mutually exclusive, use your own `,
        `logic to resolve the conflict while prioritizing consistency and alignment with the `,
        `overall goal. Output your planning_thoughts, the reference ${vref}, and the updated `,
        `translation for ${vref}.\n`
    );

    const userMessage = userMessageArray.join('');

    const completion = await reflectionUtils.useModel({
        client,
        model: config.reflection_model ?? config.model,
        messages: [
            { role: 'system', content: systemMessage },
            { role: 'user', content: userMessage },
        ],
        temperature: config.temperature,
        top_p: config.top_p,
        response_format: zodResponseFormat(InterimReflectionResponseSchema, 'reflection'),
        n: 1,
    });

    const result: ReflectionResponse = InterimReflectionResponseSchema.parse(JSON.parse(completion.choices[0].message.content!));

    if (correctionSummarizationResult) {
        result.correction_summarization = correctionSummarizationResult;
    }

    return result;
}

function findClosestReference(
    targetReference: string,
    translationInput: reflectionUtils.Verse[],
    referenceKey: string[]
): { reference: string; distance: number; } {
    const closestMatch = translationInput.reduce((closest: { reference: string; distance: number; }, verse) => {
        const reference = reflectionUtils.lookUpKey(verse, referenceKey) as string | undefined;
        if (!reference) return closest; // skip if reference is undefined

        const distance = reflectionUtils.levenshtein(targetReference.toLowerCase(), reference.toLowerCase());
        if (distance < closest.distance) {
            return { reference, distance };
        }
        return closest;
    }, { reference: '', distance: Infinity });

    return closestMatch;
}

function setFirstAndLastLine(translationInput: reflectionUtils.Verse[], config: Config) {
    if ('first_verse_ref' in config) {
        const targetReference = config.first_verse_ref;
        const targetIndex = translationInput.findIndex(verse => {
            const reference = reflectionUtils.lookUpKey(verse, config.reference_key) as string | undefined;
            return reference === targetReference;
        });
        if (targetIndex === -1) {
            const closestMatch = findClosestReference(targetReference, translationInput, config.reference_key);
            if (closestMatch.reference) {
                throw new Error(`The starting id ${targetReference} doesn't match any references. Did you mean ${closestMatch.reference}?`);
            }
            throw new Error(`The starting id ${targetReference} doesn't match any references.`);
        }
        config.start_line = targetIndex + 1;
    }

    if ('last_verse_ref' in config) {
        const targetReference = config.last_verse_ref;
        const targetIndex = translationInput.findIndex(verse => {
            const reference = reflectionUtils.lookUpKey(verse, config.reference_key) as string | undefined;
            return reference === targetReference;
        });
        if (targetIndex === -1) {
            const closestMatch = findClosestReference(targetReference, translationInput, config.reference_key);
            if (closestMatch.reference) {
                throw new Error(`The starting id ${targetReference} doesn't match any references. Did you mean ${closestMatch.reference}?`);
            }
            throw new Error(`The last id ${targetReference} doesn't match any references.`);
        }
        config.end_line = targetIndex + 1;
    }
}

export async function runConfigLowestGradePriority(
    config: Config,
    apiKeys: ApiKeys,
    saveTimeout: number
): Promise<void> {
    /**
     * Run the reflection loop but with the priority of which verse to process next
     * determined by the lowest average grade of the verses.
     */
    const apiKeyValue = reflectionUtils.lookUpKey(apiKeys, config.api_key);
    if (typeof apiKeyValue !== 'string' || apiKeyValue.length === 0) {
        throw new Error('"Open AIKey" for reflection must be set in user settings.');
    }

    const llmUrl = reflectionUtils.getLlmUrl(apiKeys, config);
    let client: any;

    if (llmUrl) {
        client = new OpenAI({
            apiKey: apiKeyValue,
            baseURL: llmUrl,
        });
    } else {
        client = new OpenAI({
            apiKey: apiKeyValue,
        });
    }

    const reflectionOutputFilename: string = path.join(await getFirstWorkspaceFolder(), config.reflection_output ?? "./.project/reflection/reflection.jsonl");
    const reflectionInputFilename: string = path.join(await getFirstWorkspaceFolder(), config.reflection_input ?? "./.project/reflection/reflection.jsonl");

    const translationInput: reflectionUtils.Verse[] = await reflectionUtils.loadJsonl(reflectionInputFilename) as reflectionUtils.Verse[];

    let outputDirty = false;

    const indexedComments = await loadAndIndexComments(config);

    setFirstAndLastLine(translationInput, config);

    if ('start_line' in config) {
        console.log('Focusing on and after start_line', config.start_line);
    }

    if ('end_line' in config) {
        console.log('Focusing on and before end_line', config.end_line);
    }

    console.log(`Using the model ${config.model}`);
    if ('reflection-model' in config) {
        console.log(`Using the model ${config['reflection-model']} for reflection.`);
    }

    let reflectionOutput: reflectionUtils.Verse[];
    if (fs.existsSync(reflectionOutputFilename)) {
        reflectionOutput = await reflectionUtils.loadJsonl(reflectionOutputFilename) as reflectionUtils.Verse[];
    } else {
        reflectionOutput = JSON.parse(JSON.stringify(translationInput)); // deep copy
    }

    let bestGradeFound = computeTranslationGrade(reflectionOutput, config);
    let iterationsWithoutImprovement = 0;
    const iterationsWithoutImprovementMax = config.iterations_without_improvement_max ?? Infinity;

    if (config.normalize_ranges ?? true) {
        const lengthBefore = reflectionOutput.length;
        reflectionOutput = reflectionUtils.normalizeRanges(
            reflectionOutput,
            config.reference_key,
            config.translation_key,
            config.source_key
        );
        const lengthAfter = reflectionOutput.length;
        if (lengthBefore !== lengthAfter) {
            await reflectionUtils.saveJsonl(reflectionOutputFilename, reflectionOutput);
        }
    }

    try {
        let lastSave = Date.now() / 1000;

        const referenceKey: string[] = config.reference_key;
        const translationKey: string[] = config.translation_key;
        const translationCommentKey: string[] | null = config.translation_comment_key ?? null;

        const overRiddenReferences = reflectionUtils.getOverriddenReferences(
            translationInput,
            referenceKey,
            config.override_key ?? null
        );

        let done = false;
        while (!done) {
            /*
             * Each loop iteration:
             * - Ensure all verses fully graded
             * - Find verse with lowest average grade
             * - Reflect on that verse to 'finalize' it or add grades
             */

            let actionDone = 'did nothing';

            let selectedVerse: reflectionUtils.Verse | null = null;

            // Loop through all verses for adaptations or grading
            for (let verseLineNumber = 0; verseLineNumber < reflectionOutput.length; verseLineNumber++) {
                const verse = reflectionOutput[verseLineNumber];

                if ('start_line' in config && verseLineNumber < config.start_line - 1) {
                    continue;
                }
                if ('end_line' in config && verseLineNumber > config.end_line - 1) {
                    break;
                }
                if (verse.ai_halted === true) {
                    continue;
                }

                const vref = reflectionUtils.lookUpKey(verse, referenceKey) as string;

                if (vref != null && !(vref in overRiddenReferences)) {
                    // Adaptation pass
                    if (await runAdaptationPass(verse, client, config)) {
                        outputDirty = true;
                        actionDone = `adapted verse ${vref}`;
                        break;
                    }

                    // Check if reflection skip is required due to comments modifying grades
                    const reflectionLoops: ReflectionLoop[] = verse.reflection_loops ?? [];
                    if (reflectionLoops.length > 0) {
                        const lastReflectionLoop = reflectionLoops[reflectionLoops.length - 1];
                        if (reflectionLoops.length <= (verse.comment_mod_loop_count ?? -1)) {
                            const gradedVerseInserted = 'graded_verse' in lastReflectionLoop;
                            if (!gradedVerseInserted || verseIsFinalized(verse)) {
                                if (!gradedVerseInserted) {
                                    if (translationCommentKey) {
                                        lastReflectionLoop['graded_verse_comment'] = reflectionUtils.lookUpKey(
                                            verse,
                                            translationCommentKey
                                        );
                                    }
                                    lastReflectionLoop['graded_verse'] = reflectionUtils.lookUpKey(verse, translationKey);
                                }

                                if (verse.reflection_is_finalized === true) {
                                    verse['reflection_is_finalized'] = false;
                                }

                                outputDirty = true;
                                if (!gradedVerseInserted) {
                                    actionDone = `Skipped reflection on loop ${reflectionLoops.length} for verse ${vref}`;
                                } else {
                                    actionDone = `Reverted finalization on loop ${reflectionLoops.length} for verse ${vref}`;
                                }
                                break; // move to save section
                            }
                        }
                    }

                    // Check if verse needs another grade
                    const unansweredGrades = computeNumberUnansweredGrades(verse, config);
                    if (unansweredGrades < config.grades_per_reflection_loop) {
                        selectedVerse = verse;

                        const commonContext = await buildCommonContext(
                            selectedVerse,
                            reflectionOutput,
                            config,
                            overRiddenReferences,
                            indexedComments,
                            client
                        );

                        let neededGrades = config.grades_per_reflection_loop - unansweredGrades;
                        if (!(config.grade_mode_enabled ?? true)) {
                            neededGrades = 1;
                        }

                        const newGrades = await multiGradeVerse(
                            selectedVerse,
                            commonContext,
                            client,
                            config,
                            neededGrades
                        );

                        if (!('reflection_loops' in selectedVerse)) {
                            selectedVerse['reflection_loops'] = [];
                        }
                        if (selectedVerse['reflection_loops'].length === 0) {
                            selectedVerse['reflection_loops'].push({});
                        }
                        if ('graded_verse' in selectedVerse['reflection_loops'][
                            selectedVerse['reflection_loops'].length - 1
                        ]) {
                            selectedVerse['reflection_loops'].push({});
                        }

                        const lastReflection = selectedVerse['reflection_loops'][
                            selectedVerse['reflection_loops'].length - 1
                        ];
                        if (!('grades' in lastReflection)) {
                            lastReflection['grades'] = [];
                        }
                        lastReflection['grades'].push(...newGrades);

                        if (verse.reflection_is_finalized === true) {
                            verse['reflection_is_finalized'] = false;
                        }
                        if (verse.human_reviewed === true) {
                            verse['human_reviewed'] = false;
                        }

                        outputDirty = true;

                        if (newGrades.length === 1) {
                            actionDone = `added grade number ${lastReflection.grades.length} on loop ${selectedVerse.reflection_loops.length
                                } of grade ${newGrades[0].grade} to verse ${reflectionUtils.lookUpKey(selectedVerse, referenceKey)}`;
                        } else {
                            const gradeList = newGrades.map((g) => g.grade);
                            actionDone = `added ${newGrades.length} up to grade number ${lastReflection.grades.length
                                } on loop ${selectedVerse.reflection_loops.length} of grades ${JSON.stringify(
                                    gradeList
                                )} to verse ${reflectionUtils.lookUpKey(selectedVerse, referenceKey)}`;
                        }

                        break;
                    }
                }
            }

            if (selectedVerse === null) {
                // All verses are fully graded, determine next action

                const averageGrade = computeTranslationGrade(reflectionOutput, config);

                if (config.manual_edit_mode === true) {
                    done = true;
                    actionDone = 'done because grading is complete and configuration is in manual_edit_mode.';
                } else {
                    iterationsWithoutImprovement++;
                    if (averageGrade > bestGradeFound) {
                        console.log(
                            `New best grade: ${averageGrade} after ${iterationsWithoutImprovement} iterations. Improvement of ${averageGrade - bestGradeFound}`
                        );
                        bestGradeFound = averageGrade;
                        iterationsWithoutImprovement = 0;
                    }

                    if (iterationsWithoutImprovement > iterationsWithoutImprovementMax) {
                        done = true;
                        actionDone = 'done because of iterations without improvement';
                    }
                }

                if (!done) {
                    let lowestGradeFound: number | null = null;
                    let lowestGradedVerse: reflectionUtils.Verse | null = null;

                    if (!('debug_force_vref' in config)) {
                        for (let verseLineNumber = 0; verseLineNumber < reflectionOutput.length; verseLineNumber++) {
                            const verse = reflectionOutput[verseLineNumber];

                            if ('start_line' in config && verseLineNumber < config.start_line - 1) {
                                continue;
                            }
                            if ('end_line' in config && verseLineNumber > config.end_line - 1) {
                                break;
                            }
                            if (verse.ai_halted === true) {
                                continue;
                            }
                            if (verse.grade_only === true) {
                                continue;
                            }

                            const vref = reflectionUtils.lookUpKey(verse, referenceKey) as string;
                            if (vref != null && !(vref in overRiddenReferences) && !verseIsFinalized(verse)) {
                                const verseGrade = computeVerseGrade(verse, config);
                                if (verseGrade != null) {
                                    if (lowestGradeFound === null || lowestGradeFound > verseGrade) {
                                        lowestGradeFound = verseGrade;
                                        lowestGradedVerse = verse;
                                    }
                                }
                            }
                        }
                    } else {
                        for (const verse of reflectionOutput) {
                            const vref = reflectionUtils.lookUpKey(verse, referenceKey);
                            if (vref === config.debug_force_vref) {
                                lowestGradedVerse = verse;
                                break;
                            }
                        }
                    }

                    if (
                        lowestGradeFound !== null &&
                        lowestGradeFound > (config.highest_grade_to_reflect ?? Infinity)
                    ) {
                        actionDone = `lowest unfinalized grade ${lowestGradeFound} is above highest grade to reflect ${config.highest_grade_to_reflect
                            }`;
                        done = true;
                    } else if (lowestGradedVerse != null) {
                        selectedVerse = lowestGradedVerse;

                        if (verseNeedsFinalization(selectedVerse, config)) {
                            finalizeVerse(selectedVerse, config);
                            actionDone = `finalized verse ${reflectionUtils.lookUpKey(selectedVerse, referenceKey)}`;
                            outputDirty = true;

                            console.log(`Finalizing ${reflectionUtils.lookUpKey(selectedVerse, referenceKey)}\n`);
                            console.log(`old: ${selectedVerse.reflection_loops[selectedVerse.reflection_loops.length - 1].graded_verse}`);
                            console.log(`new: ${reflectionUtils.lookUpKey(selectedVerse, translationKey)}\n`);
                            console.log(`old grade: ${selectedVerse.reflection_loops[selectedVerse.reflection_loops.length - 1].average_grade}`);
                            console.log(`new grade: ${computeVerseGrade(selectedVerse, config)}\n`);
                        } else {
                            const commonContext = await buildCommonContext(
                                selectedVerse,
                                reflectionOutput,
                                config,
                                overRiddenReferences,
                                indexedComments,
                                client
                            );

                            const reflectionResult: ReflectionResult = await performReflection(
                                selectedVerse,
                                commonContext,
                                client,
                                config
                            );

                            console.log(
                                `Working on verse ${reflectionUtils.lookUpKey(
                                    selectedVerse,
                                    referenceKey
                                )} which has grade ${computeVerseGrade(selectedVerse, config)}\n`
                            );

                            if (reflectionResult.correction_summarization) {
                                console.log(reflectionResult.correction_summarization.summary + '\n');
                            }

                            console.log(`source: ${reflectionUtils.lookUpKey(selectedVerse, config.source_key)}`);
                            console.log(`old: ${reflectionUtils.lookUpKey(selectedVerse, translationKey)}`);
                            console.log(`new: ${reflectionResult.updated_translation}\n`);

                            const lastReflectionLoop = selectedVerse.reflection_loops[selectedVerse.reflection_loops.length - 1];

                            if (translationCommentKey) {
                                lastReflectionLoop['graded_verse_comment'] = reflectionUtils.lookUpKey(
                                    selectedVerse,
                                    translationCommentKey
                                );
                            }
                            lastReflectionLoop['graded_verse'] = reflectionUtils.lookUpKey(selectedVerse, translationKey);

                            reflectionUtils.setKey(selectedVerse, translationKey, reflectionResult.updated_translation);

                            if (translationCommentKey) {
                                reflectionUtils.setKey(selectedVerse, translationCommentKey, reflectionResult.planning_thoughts);
                            }

                            outputDirty = true;
                            actionDone = `reflected on verse ${reflectionUtils.lookUpKey(selectedVerse, referenceKey)}`;

                            if (selectedVerse.human_reviewed === true) {
                                selectedVerse.human_reviewed = false;
                            }

                            if ('correction_summarization' in reflectionResult) {
                                lastReflectionLoop['correction_summarization'] = reflectionResult.correction_summarization;
                            }
                        }
                    } else {
                        actionDone = "Didn't find a verse to reflect on.  So done.";
                        done = true;
                    }
                }
            }

            // Save if needed
            if (outputDirty && Date.now() / 1000 - lastSave > saveTimeout) {
                await reflectionUtils.saveJsonl(
                    reflectionOutputFilename,
                    reflectionOutput,
                );
                lastSave = Date.now() / 1000;
                outputDirty = false;
            }

            // Output status
            const averageGrade = computeTranslationGrade(reflectionOutput, config);
            console.log(
                `${new Date().toISOString().replace('T', ' ').slice(0, 19)} - Average grade: ${averageGrade.toFixed(
                    2
                )} - ${actionDone} - Best grade: ${bestGradeFound.toFixed(
                    2
                )} - Iterations without improvement: ${iterationsWithoutImprovement}`
            );

            // Log to CSV if configured
            if ('average_grade_csv_log' in config) {
                const relativeAverageGradeCsvLog = config.average_grade_csv_log;
                const averageGradeCsvLog = path.join(
                    await getFirstWorkspaceFolder(),
                    relativeAverageGradeCsvLog
                );
                const logDir = path.dirname(averageGradeCsvLog);
                if (!fs.existsSync(logDir)) {
                    fs.mkdirSync(logDir, { recursive: true });
                }
                const isNewFile = !fs.existsSync(averageGradeCsvLog) || fs.statSync(averageGradeCsvLog).size === 0;
                const logStream = fs.createWriteStream(averageGradeCsvLog, { flags: 'a', encoding: 'utf-8' });
                if (isNewFile) {
                    logStream.write(
                        'time,average_grade,action_done,best_grade_found,iterations_without_improvement\n'
                    );
                }
                logStream.write(
                    `${new Date().toISOString().replace('T', ' ').slice(0, 19)},${averageGrade},${actionDone},${bestGradeFound},${iterationsWithoutImprovement}\n`
                );
                logStream.end();
            }

            // Flush stdout
            process.stdout.write('');
        }
    } finally {
        if (outputDirty) {
            await reflectionUtils.saveJsonl(
                reflectionOutputFilename,
                reflectionOutput
            );
        }
    }
}
