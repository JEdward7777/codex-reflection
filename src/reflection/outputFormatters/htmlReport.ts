
import * as fs from 'fs';
import * as path from 'path';
import zlib from 'zlib';
import { promisify } from 'util';
import { OpenAI } from 'openai';
import type { Config } from '../gradeReflectLoop';
import { Verse } from '../reflectionUtils';
import * as reflectionUtils from '../reflectionUtils';
import { computeVerseGrade } from '../gradeReflectLoop';
import { z } from 'zod';
import { zodResponseFormat } from "openai/helpers/zod";
import process from 'process';
import console from 'console';
import { Buffer } from 'buffer';
import { ApiKeys } from '../reflectionTypes';
import { getFirstWorkspaceFolder } from '../workerUtils';

import base64Font from '../../../fonts/NotoSans-Regular.ttf';
//const base64Font = '';

const deflateAsync = promisify(zlib.deflateRaw);


// Define the schema for the response using Zod
const TranslationResponseSchema = z.object({
    updated_content: z.string(),
});

// Function to translate verse report
export async function translateVerseReport(
    client: OpenAI | null,
    rawReport: string,
    config: Config,
    toLanguage: string | null = null
): Promise<string> {
    let sawIncreaseInParenthesis = true;
    let loopCount = 0;
    let result = rawReport;

    if (!client) {
        return result;
    }

    while (sawIncreaseInParenthesis) {
        process.stdout.write('.');

        if (!toLanguage) {
            toLanguage = config['report language'] ?? 'English';
        }

        const systemMessage = `You are a translator working in a Conservative Christian context. Your task is to add translations into ${toLanguage} after any text that is not in ${toLanguage}. Only add translations into ${toLanguage}, and do not change anything else. Do not translate into any language other than ${toLanguage}.`;

        const userMessageArray: string[] = [
            `Please review the following content. Wherever you find text in a language other than ${toLanguage}, add a translation into ${toLanguage} in parentheses **immediately after the non-${toLanguage} text**, only if a ${toLanguage} translation is not already present. `,
            `Make sure to also translate any short quotes in the summary that are not in ${toLanguage}. `,
            `Only add translations into ${toLanguage}. Do not add or include translations into any other language. `,
            "\n\n**content**:\n```\n",
            result,
            "\n```\n",
        ];

        const userMessage = userMessageArray.join("");

        const completion = await reflectionUtils.useModel({
            client,
            model: config.model ?? 'gpt-4o-mini',
            messages: [
                { role: "system", content: systemMessage },
                { role: "user", content: userMessage },
            ],
            temperature: config.temperature ?? 1.2,
            top_p: config.top_p ?? 0.9,
            response_format: zodResponseFormat(TranslationResponseSchema, "translation_response"),
        });

        if (!completion.choices[0].message.content) {
            throw new Error("No response from OpenAI for translation");
        }

        const content = JSON.parse(completion.choices[0].message.content);
        const parsedResponse = TranslationResponseSchema.parse(content);
        result = parsedResponse.updated_content;

        const oldNumParentheses = rawReport.split('(').length - 1;
        const newNumParentheses = result.split('(').length - 1;

        if (newNumParentheses > oldNumParentheses) {
            rawReport = result;
            sawIncreaseInParenthesis = true;
            loopCount += 1;
        } else {
            sawIncreaseInParenthesis = false;
        }

        if (loopCount > 7) {
            console.log(`Stopping adding translations after ${loopCount} loops.`);
            break;
        }
    }

    console.log();
    return result;
}


// Define the schema for the response using Zod
const SummaryResponseSchema = z.object({
    updated_report: z.string(),
});

export async function summarizeVerseReport(
    client: OpenAI,
    rawReport: string,
    config: Config,
    justSummarize: boolean = false,
    noLabel: boolean = false,
    outputInMarkdown: boolean = true,
    toLanguage: string | null = null
): Promise<string> {
    const systemMessage = "You are translation consultant, who is compiling correction for review from a Conservative Christian perspective.";

    if (!toLanguage) {
        toLanguage = config['report language'] ?? 'English';
    }

    const userMessageArray: (string | null)[] = [];

    if (!justSummarize) {
        userMessageArray.push(
            "The following report was generated for a translated verse of the Bible.\n",
            `Please modify the report so that it is easier to review by the translators who speak ${toLanguage}.\n`,
            `Provide a reference translation in ${toLanguage} for every string which is in another language. Add it in parenthesis after the content being translated.\n`,
            `Combine the multiple reviewed into a single review in ${toLanguage} combining the essence of the individual reviews.\n`,
            "Don't add any new content to the report, except for translations and summerizations. Make sure not to change any of the **Source** or **Translation** text.\n"
        );
    } else {
        userMessageArray.push("The following report was generated for a translated verse of the Bible.\n");
        if (!noLabel) {
            userMessageArray.push("Copy through the Source and Translation sections without modification.\n");
        }
        userMessageArray.push(
            `Combine the multiple reviewed into a single review in ${toLanguage} combining the essence of the individual reviews.\n`,
            "Don't add any new content to the report, except for the summerization.\n"
        );
    }

    if (noLabel) {
        userMessageArray.push("Don't put a heading on the summarized report.\n");
    }

    if (outputInMarkdown) {
        userMessageArray.push("Output in Markdown.\n");
    }

    userMessageArray.push(
        "\n\n**raw report**:\n",
        "```\n",
        rawReport,
        "\n```\n"
    );

    const userMessage = userMessageArray.join("");

    const completion = await reflectionUtils.useModel({
        client,
        model: config.model ?? 'gpt-4o-mini',
        messages: [
            { role: "system", content: systemMessage },
            { role: "user", content: userMessage },
        ],
        temperature: config.temperature ?? 1.2,
        top_p: config.top_p ?? 0.9,
        response_format: zodResponseFormat(SummaryResponseSchema, "summary_response"),
    });

    //Throw an exception if content is null.
    if (completion.choices[0].message.content === null) {
        throw new Error("Content is null");
    }

    const content = JSON.parse(completion.choices[0].message.content);
    const parsedResponse = SummaryResponseSchema.parse(content);
    const result = parsedResponse.updated_report;

    return result;
}


const TranslateResponseSchema = z.object({
    literal_translation: z.string(),
});

// Function to get literal translation
export async function getLiteralTranslation(
    client: OpenAI | null,
    config: Config,
    text: string,
    fromLanguage: string | null,
    toLanguage: string | null
): Promise<string> {
    if (fromLanguage === toLanguage){ return text; }

    if (!toLanguage){ throw new Error("to_language is required"); }
    if (!client){ throw new Error("client is required"); }

    const systemMessage = "You are a translation consultant, drafting literal translations for a Conservative Christian perspective.";
    const userMessageArray: (string | null)[] = ["Translate the following text "];

    if (fromLanguage) {
        userMessageArray.push("from ", fromLanguage, " ");
    }

    userMessageArray.push("into ", toLanguage, "\n");
    userMessageArray.push(JSON.stringify({ text }, null, 0));

    const userMessage = userMessageArray.join("");

    const completion = await reflectionUtils.useModel({
        client,
        model: config.model ?? 'gpt-4o-mini',
        messages: [
            { role: "system", content: systemMessage },
            { role: "user", content: userMessage },
        ],
        temperature: config.temperature ?? 1.2,
        top_p: config.top_p ?? 0.9,
        response_format: zodResponseFormat(TranslateResponseSchema, "translate_response"),
    });

    if (completion.choices[0].message.content === null) {
        throw new Error("Content is null");
    }

    const content = JSON.parse(completion.choices[0].message.content);
    const parsedResponse = TranslateResponseSchema.parse(content);
    const literalTranslation = parsedResponse.literal_translation;

    return literalTranslation;
}


export function getSortedVerses(
    translationData: Verse[],
    referenceKey: string[],
    sortOnFirst: boolean = false
): [Verse[], (verse: Verse) => number] {
    const fakeConfigForGradeReflectLoop: Config = {
        reference_key: referenceKey,
        grades_per_reflection_loop: Infinity,
    };

    const getGrade = (verse: Verse): number => {
        if (sortOnFirst) {
            const reflectionLoops = verse.reflection_loops || [];
            if (reflectionLoops.length > 0) {
                const firstLoop = reflectionLoops[0];
                const grades = firstLoop.grades || [];
                if (grades.length > 0) {
                    const grade = grades.reduce((sum: number, g: any) => sum + g.grade, 0) / grades.length;
                    return grade;
                }
            }
        } else {
            const grade = computeVerseGrade(verse, fakeConfigForGradeReflectLoop);
            if (grade !== null) {
                return grade;
            }
        }
        return Infinity;
    };

    const sortedVerses = [...translationData].sort((a, b) => getGrade(a) - getGrade(b));

    return [sortedVerses, getGrade];
}

export interface VerseData {
    vref: string;
    href: string; // href for anchor
    source: string;
    source_translated?: string;
    translation: string;
    translation_translated?: string;
    suggested_translation?: string;
    suggested_translation_translated?: string;
    review: string;
    grade: number;
}


async function run(originalContent: Verse[], thisConfig: Config,
    apiKeys: ApiKeys): Promise<void> {

    // Strip content by start_line and end_line
    if (thisConfig.end_line) {
        originalContent = originalContent.slice(0, thisConfig.end_line - 1);
    }
    if (thisConfig.start_line) {
        originalContent = originalContent.slice(thisConfig.start_line - 1);
    }

    if (!thisConfig?.html_reports?.cacheFolder) {
        throw new Error("cacheFolder is required");
    }

    // Get keys
    const translationKey: string[] = thisConfig.translation_key || ['fresh_translation', 'text'];
    const referenceKey: string[] = thisConfig.reference_key || ['vref'];
    const sourceKey: string[] = thisConfig.source_key || ['source'];

    const reportFirstIteration: boolean = thisConfig.reports?.report_first_iteration ?? true;
    const reportLanguage: string = thisConfig.reports?.['report language'] || 'English';
    let targetLanguage: string | null = thisConfig.markdown_format?.outputs?.target_language || null;
    if (targetLanguage === null) {
        targetLanguage = thisConfig.reports?.target_language || 'English';
    }
    const sourceLanguage: string | null = thisConfig.reports?.source_language || null;

    // Split into books if requested
    let bookToVerses: { [key: string]: Verse[]; } = {};
    if (thisConfig.split_by_book !== false) {
        bookToVerses = originalContent.reduce((acc: { [key: string]: Verse[]; }, verse: Verse) => {
            const vref: string = reflectionUtils.lookUpKey(verse, referenceKey) as string;
            const book = reflectionUtils.splitRef2(vref)[0];
            acc[book] = acc[book] || [];
            acc[book].push(verse);
            return acc;
        }, {});
    } else {
        bookToVerses = { '': originalContent };
    }

    // Prepare output folder
    const relativeOutputFolder: string = thisConfig?.html_reports?.output_folder;
    if (!relativeOutputFolder) {
        throw new Error('No output folder specified');
    }

    const outputFolder = path.join(await getFirstWorkspaceFolder(), relativeOutputFolder);
    fs.mkdirSync(outputFolder, { recursive: true });

    const numSdToReport: number = thisConfig.pdf_reports?.num_sd_to_report || 2;
    const percentageSorted: number | null = thisConfig.pdf_reports?.percentage_sorted || null;


    const apiKeyValue = reflectionUtils.lookUpKey(apiKeys, thisConfig.api_key);
    if (typeof apiKeyValue !== 'string' || apiKeyValue.length === 0) {
        throw new Error('Api key must be a string of length > 0');
    }


    const llmUrl = reflectionUtils.getLlmUrl(apiKeys, thisConfig);
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

    if (!client) {
        throw new Error("API key not found");
    }

    // Verse data extraction functions
    const rGetRef = (verse: Verse): string => reflectionUtils.lookUpKey(verse, referenceKey) as string;
    const rGetSource = (verse: Verse): string => reflectionUtils.lookUpKey(verse, sourceKey) as string;
    const [, rGetGrade] = getSortedVerses([], referenceKey, reportFirstIteration);

    const rGetHref = (verse: Verse): string => {
        const ref = rGetRef(verse);
        return ref.replace(/[^a-zA-Z0-9]/g, '_');
    };

    const rGetTranslation = (verse: Verse): string => {
        let translation = reflectionUtils.lookUpKey(verse, translationKey) as string;
        if (reportFirstIteration) {
            const reflectionLoop = verse.reflection_loops || [];
            if (reflectionLoop.length > 0) {
                const gradedVerse = reflectionLoop[0].graded_verse || '';
                if (gradedVerse && gradedVerse !== translation) {
                    translation = gradedVerse;
                }
            }
        }
        return translation;
    };

    const rGetGrades = (verse: Verse): Array<{ grade: number; comment: string; }> => {
        const translation = rGetTranslation(verse);
        const reflectionLoops = verse.reflection_loops || [];
        if (!reflectionLoops.length){ return []; }
        for (let i = reflectionLoops.length - 1; i >= 0; i--) {
            if (reflectionLoops[i].graded_verse === translation) {
                return reflectionLoops[i].grades || [];
            }
        }
        return reflectionLoops[reflectionLoops.length - 1].grades || [];
    };



    const rGetLabel = async (label: string): Promise<string> => {
        if (reportLanguage === 'English'){ return label; }
        return await rGetLabelWrapped(label, reportLanguage);
    };

    const labelsCache = path.join(await getFirstWorkspaceFolder(), `${thisConfig.html_reports.cacheFolder}/labels`);
    const rGetLabelWrapped = reflectionUtils.cacheDecorator(labelsCache, client !== null)(
        async (label: string, toLanguage: string): Promise<string> => {
            if (toLanguage === 'English'){ return label; }

            const systemMessage = 'You are a translation consultant, creating labels in a target language';
            const userMessageArray = [
                `Translate the following label into ${toLanguage} preserving the markdown formatting:`,
                `\n${JSON.stringify({ label }, null, 0)}`
            ];
            const userMessage = userMessageArray.join('');

            if (!client){ return label; }

            const LabelResponseSchema = z.object({
                translated_label: z.string()
            });
            const completion = await reflectionUtils.useModel({
                client,
                model: thisConfig.model || 'gpt-4o-mini',
                messages: [
                    { role: 'system', content: systemMessage },
                    { role: 'user', content: userMessage }
                ],
                temperature: thisConfig.temperature || 1.2,
                top_p: thisConfig.top_p || 0.9,
                response_format: zodResponseFormat(LabelResponseSchema, "LabelResponse")
            });

            const result = LabelResponseSchema.safeParse(JSON.parse(completion.choices[0].message.content as string));
            if (!result.success) {
                throw new Error(`Error parsing response: ${result.error}`);
            }
            let translatedLabel: string = result.data.translated_label;

            // Handle markdown formatting
            if (!label.includes('*') && translatedLabel.includes('*')) {
                translatedLabel = translatedLabel.replace(/\*/g, '');
            }
            if (label.startsWith('**') && !translatedLabel.startsWith('**')) {
                translatedLabel = `**${translatedLabel}`;
            }
            if (label.startsWith('### ') && !translatedLabel.startsWith('### ')) {
                translatedLabel = `### ${translatedLabel}`;
            }
            if (label.endsWith('**') && !translatedLabel.endsWith('**')) {
                translatedLabel = `${translatedLabel}**`;
            }
            if (label.endsWith('**:') && !translatedLabel.endsWith('**:')) {
                translatedLabel = `${translatedLabel}**:`;
            }

            return translatedLabel;
        }
    );

    const rGetLiteralTranslation = async (text: string, fromLanguage: string | null = null, toLanguage: string | null = null): Promise<string> => {
        if (!client){ return text; }
        toLanguage = (toLanguage || thisConfig.reports?.['report language'] || 'English') as string;
        if (thisConfig.html_reports?.hide_source_language_in_back_translations) {
            fromLanguage = null;
        }
        return rGetLiteralTranslationWrapped(text, fromLanguage, toLanguage);
    };


    const literalTranslationCache = path.join(await getFirstWorkspaceFolder(), `${thisConfig.html_reports.cacheFolder}/literal_translation`);
    const rGetLiteralTranslationWrapped = reflectionUtils.cacheDecorator(literalTranslationCache, client !== null)(
        async (text: string, fromLanguage: string | null, toLanguage: string): Promise<string> => {
            return await getLiteralTranslation(client, thisConfig, text, fromLanguage, toLanguage);
        }
    );

    const summarizationCache = path.join(await getFirstWorkspaceFolder(), `${thisConfig.html_reports.cacheFolder}/summarization`);
    const rRunSummary = reflectionUtils.cacheDecorator(summarizationCache, client !== null)(
        async (rawReport: string, toLanguage: string): Promise<string> => {
            return await summarizeVerseReport(client, rawReport, thisConfig.reports || {}, true, true, false, toLanguage);
        }
    );

    const parenthesisTranslationCache = path.join(await getFirstWorkspaceFolder(), `${thisConfig.html_reports.cacheFolder}/parenthesis_translation`);
    const rAddParenthesisTranslation = reflectionUtils.cacheDecorator(parenthesisTranslationCache, client !== null)(
        async (text: string, toLanguage: string): Promise<string> => {
            if (text) {
                return await translateVerseReport(client, text, thisConfig.reports || {}, toLanguage);
            }
            return text;
        }
    );

    const rGetTranslationTranslated = async (verse: Verse): Promise<string | null> => {
        if (targetLanguage !== reportLanguage && rGetTranslation(verse)) {
            return rGetLiteralTranslation(rGetTranslation(verse), targetLanguage, reportLanguage);
        }
        return null;
    };

    const rGetSourceTranslated = async (verse: Verse): Promise<string | null> => {
        if (sourceLanguage !== reportLanguage && rGetSource(verse)) {
            return rGetLiteralTranslation(rGetSource(verse), sourceLanguage, reportLanguage);
        }
        return null;
    };

    const rGetSuggestedTranslationTranslated = async (verse: Verse): Promise<string | null> => {
        if (rGetSuggestedTranslation === null) {
            return null;
        }
        if (targetLanguage !== reportLanguage) {
            const suggested = rGetSuggestedTranslation(verse);
            if (suggested) {
                return rGetLiteralTranslation(suggested, targetLanguage, reportLanguage);
            }
        }
        return null;
    };

    const rGetReview = async (verse: Verse): Promise<string> => {
        const grades = rGetGrades(verse);
        const rawReportArray: string[] = [];
        const reviewLabel = await rGetLabel('Review');
        const gradeLabel = await rGetLabel('Grade');
        for (let i = 0; i < grades.length; i++) {
            const grade = grades[i];
            rawReportArray.push(`**${reviewLabel} ${i + 1}** `);
            rawReportArray.push(`_(${gradeLabel} ${grade.grade})_: ${grade.comment}\n\n`);
        }
        const rawReport = rawReportArray.join('');
        const summarizedReport = await rRunSummary(rawReport, reportLanguage);
        return rAddParenthesisTranslation(summarizedReport, reportLanguage);
    };

    let hashedSuggestedTranslation: { [key: string]: Verse; } | null = null;
    if (thisConfig.reports?.suggested_translation) {
        let suggestedTranslationFilename = thisConfig.reports.suggested_translation;
        if (!suggestedTranslationFilename.endsWith('.jsonl')) {
            suggestedTranslationFilename += '.jsonl';
        }
        const suggestedTranslation = await reflectionUtils.loadJsonl(path.join('output', suggestedTranslationFilename)) as Verse[];
        hashedSuggestedTranslation = Object.fromEntries(suggestedTranslation.map(x => [
            reflectionUtils.lookUpKey(x, referenceKey) as string, x
        ]));
    }

    const rGetSuggestedTranslation = (verse: Verse): string | null => {
        if (hashedSuggestedTranslation) {
            return hashedSuggestedTranslation[rGetRef(verse)]?.fresh_translation?.text || null;
        }
        if (reportFirstIteration) {
            const lastTranslation = reflectionUtils.lookUpKey(verse, translationKey) as string;
            if (lastTranslation && lastTranslation !== rGetTranslation(verse)) {
                return lastTranslation;
            }
        }
        return null;
    };


    // Loop through books
    for (const [book, verses] of Object.entries(bookToVerses)) {
        const reportData: VerseData[] = [];
        let htmlName = book || "report";
        const htmlPrefix = thisConfig.html_reports?.output_prefix || '';
        if (htmlPrefix) {
            htmlName = `${htmlPrefix}${htmlName}`;
        }
        const outputFilename = path.join(outputFolder, `${htmlName}.html`);
        const title = thisConfig.html_reports?.title?.replace('{book}', book) || await rGetLabel(`Reflection ${book} Report`);

        const startTime = Date.now();
        for (let verseI = 0; verseI < verses.length; verseI++) {
            const verse = verses[verseI];
            const currentTime = Date.now();
            const elapsedTime = (currentTime - startTime) / 1000;
            const estimatedTotalTime = (verses.length / (verseI + 1)) * elapsedTime;
            const estimatedEndTime = startTime / 1000 + estimatedTotalTime;
            console.log(
                `Processing verse ${verseI + 1} of ${verses.length} - ${elapsedTime.toFixed(2)} seconds elapsed - ` +
                `estimated ${(estimatedEndTime - currentTime / 1000).toFixed(2)} seconds left, ` +
                `estimated end time ${new Date(estimatedEndTime * 1000).toLocaleString()}`
            );

            const vref = rGetRef(verse);
            const href = rGetHref(verse);
            const grade = rGetGrade(verse);
            const source = rGetSource(verse);
            const translation = rGetTranslation(verse);
            const suggestedTranslation = rGetSuggestedTranslation(verse);
            const review = await rGetReview(verse);

            const verseData: VerseData = {
                vref,
                href,
                grade,
                source,
                translation,
                suggested_translation: suggestedTranslation ?? undefined,
                review
            };
            const sourceTranslated = await rGetSourceTranslated(verse);
            if (sourceTranslated) {
                verseData.source_translated = sourceTranslated;
            }
            const translationTranslated = await rGetTranslationTranslated(verse);
            if (translationTranslated) {
                verseData.translation_translated = translationTranslated;
            }
            const suggestedTranslationTranslated = await rGetSuggestedTranslationTranslated(verse);
            if (suggestedTranslationTranslated) {
                verseData.suggested_translation_translated = suggestedTranslationTranslated;
            }
            reportData.push(verseData);
        }

        const labels = {
            heatMap: await rGetLabel("Heat Map"),
            lowGradeVerses: await rGetLabel("Lower Scoring Verses"),
            allVerses: await rGetLabel("All Verses"),
            top: await rGetLabel("Top"),
            tableOfContents: await rGetLabel("Table of Contents"),
            generatedOn: await rGetLabel("Generated on"),
            totalScore: await rGetLabel("Total Score"),
            downloadJsonl: await rGetLabel("Download JSONL"),
            gradeHeatMap: await rGetLabel("Grade Heat Map"),
            settings: await rGetLabel("Settings"),
            heatMapSettings: await rGetLabel("Heat Map Settings"),
            colorMode: await rGetLabel("Color Mode"),
            useFade: await rGetLabel("Use fade instead of spectrum"),
            lowGradeColor: await rGetLabel("Low Grade Color"),
            highGradeColor: await rGetLabel("High Grade Color"),
            lowGrade: await rGetLabel("Low Grade"),
            auto: await rGetLabel("Auto"),
            highGrade: await rGetLabel("High Grade"),
            presets: await rGetLabel("Presets"),
            redGreen: await rGetLabel("Red-Green"),
            neutral: await rGetLabel("Neutral"),
            diverging: await rGetLabel("Diverging"),
            monochrome: await rGetLabel("Monochrome"),
            theBlues: await rGetLabel("The Blues"),
            rainbow: await rGetLabel("Rainbow"),
            closeSettings: await rGetLabel("Close Settings"),
            grade: await rGetLabel("Grade"),
            source: await rGetLabel("Source"),
            translation: await rGetLabel("Translation"),
            suggestedTranslation: await rGetLabel("Suggested Translation"),
            review: await rGetLabel("Review"),
            goTo: await rGetLabel("Go to"),
        };

        // Read and encode font
        // Removed runtime fs.readFileSync loading of font, replaced by static import above

        const jsonString = JSON.stringify(reportData, null, 0);
        const compressedData = await deflateAsync(Buffer.from(jsonString, 'utf-8'), { level: 9 });
        const base64Data = compressedData.toString('base64');
        const generatedDate = new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });

        const htmlContent = `
<!DOCTYPE html>
<html>
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">
    <title>${title}</title>
    <style>
        @font-face {
            font-family: 'NotoSans';
            src: url(data:font/truetype;charset=utf-8;base64,${base64Font}) format('truetype');
            font-weight: normal;
            font-style: normal;
        }
        body {
            font-family: 'NotoSans', sans-serif;
            background-color: #f4f4f9;
            color: #333;
            margin: 0;
            padding: 60px 20px 20px 20px;
            line-height: 1.6;
            font-size: 16px;
        }
        .container {
            max-width: 900px;
            margin: 0 auto;
            background: #fff;
            padding: 20px 40px;
            border-radius: 8px;
            box-shadow: 0 2px 10px rgba(0,0,0,0.1);
        }
        
        /* Sticky Navigation Bar */
        .nav-bar {
            position: fixed;
            top: 0;
            left: 0;
            right: 0;
            height: 40px;
            background: rgba(255, 255, 255, 0.95);
            backdrop-filter: blur(10px);
            border-bottom: 1px solid #e0e0e0;
            display: flex;
            align-items: center;
            justify-content: space-between;
            padding: 0 20px;
            z-index: 1000;
            box-shadow: 0 2px 4px rgba(0,0,0,0.1);
        }
        
        .nav-links {
            display: flex;
            gap: 20px;
            align-items: center;
        }
        
        .nav-link {
            color: #0056b3;
            text-decoration: none;
            font-weight: 500;
            font-size: 14px;
            padding: 8px 12px;
            border-radius: 4px;
            transition: background-color 0.2s ease;
        }
        
        .nav-link:hover {
            background-color: rgba(0, 86, 179, 0.1);
        }
        
        .hamburger {
            display: flex;
            flex-direction: column;
            cursor: pointer;
            padding: 4px;
            gap: 3px;
        }
        
        .hamburger span {
            width: 20px;
            height: 2px;
            background-color: #333;
            transition: all 0.3s ease;
        }
        
        .hamburger.active span:nth-child(1) {
            transform: rotate(45deg) translate(5px, 5px);
        }
        
        .hamburger.active span:nth-child(2) {
            opacity: 0;
        }
        
        .hamburger.active span:nth-child(3) {
            transform: rotate(-45deg) translate(7px, -6px);
        }
        
        /* Sidebar */
        .sidebar-overlay {
            position: fixed;
            top: 0;
            left: 0;
            right: 0;
            bottom: 0;
            background: rgba(0, 0, 0, 0.5);
            z-index: 1500;
            opacity: 0;
            visibility: hidden;
            transition: opacity 0.3s ease, visibility 0.3s ease;
        }
        
        .sidebar-overlay.active {
            opacity: 1;
            visibility: visible;
        }
        
        .sidebar {
            position: fixed;
            top: 0;
            left: -320px;
            width: 320px;
            height: 100vh;
            background: #fff;
            z-index: 1600;
            transition: left 0.3s ease;
            overflow-y: auto;
            box-shadow: 2px 0 10px rgba(0,0,0,0.1);
        }
        
        .sidebar.active {
            left: 0;
        }
        
        .sidebar-header {
            padding: 20px;
            border-bottom: 1px solid #e0e0e0;
            background: #f8f9fa;
        }
        
        .sidebar-header h3 {
            margin: 0;
            color: #333;
            font-size: 18px;
        }
        
        .sidebar-content {
            padding: 20px;
        }
        
        .sidebar-section {
            margin-bottom: 20px;
        }
        
        .sidebar-section h4 {
            margin: 0 0 10px 0;
            color: #0056b3;
            font-size: 16px;
            border-bottom: 1px solid #e0e0e0;
            padding-bottom: 5px;
        }
        
        .sidebar-link {
            display: block;
            color: #333;
            text-decoration: none;
            padding: 8px 12px;
            border-radius: 4px;
            margin-bottom: 2px;
            transition: background-color 0.2s ease;
        }
        
        .sidebar-link:hover {
            background-color: #f0f0f0;
        }
        
        .sidebar-link.chapter {
            padding-left: 24px;
            font-size: 14px;
            color: #666;
        }
        
        @media (max-width: 600px) {
            body {
                font-size: 20px;
                padding-top: 90px;
                padding-left: 15px;
                padding-right: 15px;
                width: 100vw;
                max-width: 100vw;
                overflow-x: hidden;
            }
            
            .container {
                padding: 15px 20px;
                max-width: 100vw !important;
                width: 100vw !important;
                margin: 0 !important;
                box-sizing: border-box;
            }
            
            .nav-links {
                gap: 10px;
            }
            
            .nav-link {
                font-size: 24px !important;
                padding: 12px 14px;
            }
            
            .nav-link .text {
                display: none;
            }
            
            .nav-link .icon {
                display: inline;
                font-size: 30px !important;
            }
            
            .sidebar {
                width: 85vw;
                left: -85vw;
            }
            
            .sidebar-header {
                padding: 30px;
            }
            
            .sidebar-header h3 {
                font-size: 30px !important;
                margin: 0;
            }
            
            .sidebar-section {
                margin-bottom: 30px;
            }
            
            .sidebar-section h4 {
                font-size: 26px !important;
                margin: 0 0 20px 0;
                padding-bottom: 10px;
            }
            
            .sidebar-link {
                font-size: 24px !important;
                padding: 18px 25px;
                margin-bottom: 8px;
            }
            
            .sidebar-link.chapter {
                font-size: 22px !important;
                padding: 16px 20px 16px 50px;
            }
            
            .hamburger {
                padding: 16px;
            }
            
            .hamburger span {
                width: 32px;
                height: 5px;
                gap: 5px;
            }
            
            .nav-bar {
                height: 90px;
                padding: 0 15px;
                width: 100%;
                box-sizing: border-box;
            }
            
            h1 {
                font-size: 2.4em;
            }
            
            h2 {
                font-size: 1.8em;
            }
            
            .verse {
                padding: 25px;
                margin-bottom: 25px;
                font-size: 1.1em;
            }
            
            .vref {
                font-size: 1.5em;
            }
            
            .grade {
                font-size: 1em;
            }
            
            .label {
                font-size: 1.2em;
                margin-top: 15px;
            }
            
            #download-jsonl {
                font-size: 1.2em;
                padding: 15px 30px;
            }
            
            /* Keep heat map text small as requested */
            .heat-map-label {
                font-size: 0.85em;
            }
            
            .heat-map-square {
                font-size: 9px;
                width: 20px;
                height: 20px;
            }
            
            /* Ensure full width usage */
            #heat-map-content {
                padding: 10px;
            }
            
            /* Settings panel adjustments */
            #settings-panel.expanded {
                padding: 20px 15px;
            }
            
            .setting-row {
                margin-bottom: 20px;
            }
            
            .setting-row label {
                font-size: 1.05em;
            }
        }
        
        @media (min-width: 601px) {
            .nav-link .icon {
                display: none;
            }
        }
        h1, h2 {
            color: #444;
            border-bottom: 2px solid #eee;
            padding-bottom: 10px;
            margin-bottom: 20px;
        }
        h1 {
            text-align: center;
            font-size: 2.5em;
        }
        h2 {
            font-size: 1.8em;
        }
        .verse {
            border: 1px solid #e0e0e0;
            background-color: #fafafa;
            border-radius: 8px;
            padding: 20px;
            margin-bottom: 20px;
            box-shadow: 0 1px 4px rgba(0,0,0,0.05);
        }
        .vref {
            font-weight: bold;
            font-size: 1.4em;
            color: #0056b3;
        }
        .grade {
            font-style: italic;
            color: #555;
            font-size: 0.9em;
        }
        .label {
            font-weight: bold;
            color: #333;
            margin-top: 10px;
            display: block;
        }
        #heat-map-content {
            display: grid;
            grid-template-columns: auto 1fr;
            gap: 5px;
            margin-bottom: 20px;
            background: #fdfdfd;
            padding: 15px;
            border-radius: 8px;
            border: 1px solid #eee;
        }
        .heat-map-row {
            display: contents;
        }
        .heat-map-label {
            font-weight: bold;
            text-align: right;
            padding-right: 10px;
            align-self: center;
        }
        .heat-map-verses {
            display: flex;
            flex-wrap: wrap;
            gap: 3px;
        }
        .heat-map-square {
            width: 24px;
            height: 24px;
            display: flex;
            align-items: center;
            justify-content: center;
            color: black;
            text-decoration: none;
            font-size: 11px;
            border-radius: 4px;
            transition: transform 0.1s ease-in-out, background-color 0.3s ease;
        }
        .heat-map-square:hover {
            transform: scale(1.2);
            z-index: 10;
        }
        #download-jsonl {
            display: block;
            margin: 20px auto;
            padding: 10px 20px;
            background-color: #007bff;
            color: white;
            border: none;
            border-radius: 5px;
            cursor: pointer;
            font-size: 1em;
        }
        #download-jsonl:hover {
            background-color: #0056b3;
        }
        .heat-map-header {
            display: flex;
            justify-content: space-between;
            align-items: center;
            margin-bottom: 10px;
        }
        .heat-map-header h2 {
            margin: 0;
        }
        #settings-container {
            display: inline-block;
        }
        #settings-toggle {
            background: #eee;
            border: 1px solid #ccc;
            border-radius: 5px;
            padding: 2px 8px;
            cursor: pointer;
            font-size: 1.5em;
            line-height: 1;
            transition: background-color 0.2s ease;
        }
        #settings-toggle:hover {
            background-color: #ddd;
        }
        #settings-panel {
            border: 1px solid #ccc;
            border-radius: 8px;
            padding: 0 20px;
            margin-top: 10px;
            margin-bottom: 0;
            background: #f9f9f9;
            box-shadow: 0 2px 5px rgba(0,0,0,0.1);
            max-height: 0;
            overflow: hidden;
            opacity: 0;
            transition: max-height 0.3s ease, opacity 0.3s ease, padding 0.3s ease, margin 0.3s ease;
        }
        #settings-panel.expanded {
            max-height: 1000px;
            opacity: 1;
            padding: 20px;
            margin-bottom: 20px;
        }
        .setting-row {
            display: grid;
            grid-template-columns: auto 1fr;
            align-items: center;
            gap: 10px;
            margin-bottom: 15px;
        }
        .setting-row.color-row {
            grid-template-columns: auto auto auto auto;
        }
        .setting-row label {
            font-weight: bold;
            white-space: nowrap;
        }
        @media (max-width: 600px) {
            .setting-row {
                grid-template-columns: 1fr;
                gap: 5px;
            }
            .setting-row.color-row {
                grid-template-columns: 1fr 1fr;
                gap: 10px;
            }
            .setting-row.color-row > label:first-child,
            .setting-row.color-row > label:nth-child(3) {
                grid-column: 1 / -1;
            }
            #settings-panel {
                padding: 15px;
            }
            .container {
                padding: 10px 20px;
            }
        }
        #presets button {
            background-color: #e0e0e0;
            border: 1px solid #ccc;
            border-radius: 4px;
            padding: 5px 10px;
            cursor: pointer;
            margin-right: 5px;
        }
        #presets button:hover {
            background-color: #d0d0d0;
        }
        #legend {
            margin-bottom: 10px;
            padding: 10px;
            border: 1px solid #eee;
            border-radius: 5px;
        }
    </style>
</head>
<body>
    <!-- Sticky Navigation Bar -->
    <nav class="nav-bar">
        <div class="hamburger" id="hamburger">
            <span></span>
            <span></span>
            <span></span>
        </div>
        <div class="nav-links">
            <a href="#heat-map" class="nav-link">
                <span class="icon">🗺️</span>
                <span class="text">${labels.heatMap}</span>
            </a>
            <a href="#low-grade-verses" class="nav-link">
                <span class="icon">⚠️</span>
                <span class="text">${labels.lowGradeVerses}</span>
            </a>
            <a href="#all-verses" class="nav-link">
                <span class="icon">📖</span>
                <span class="text">${labels.allVerses}</span>
            </a>
            <a href="#top" class="nav-link">
                <span class="icon">⬆️</span>
                <span class="text">${labels.top}</span>
            </a>
        </div>
    </nav>

    <!-- Sidebar Overlay -->
    <div class="sidebar-overlay" id="sidebar-overlay"></div>
    
    <!-- Sidebar -->
    <div class="sidebar" id="sidebar">
        <div class="sidebar-header">
            <h3>${labels.tableOfContents}</h3>
        </div>
        <div class="sidebar-content" id="sidebar-content">
            <!-- Content will be populated by JavaScript -->
        </div>
    </div>

    <div class="container" id="top">
        <h1>${title}</h1>
        <p>${labels.generatedOn}: ${generatedDate}</p>
        <p>${labels.totalScore}: <span id="total-score"></span></p>
        <button id="download-jsonl">${labels.downloadJsonl}</button>
        
        <div class="heat-map-header">
            <h2 id="heat-map">${labels.gradeHeatMap}</h2>
            <div id="settings-container">
                <button id="settings-toggle" title="${labels.settings}">...</button>
            </div>
        </div>
        <div id="settings-panel">
            <h3>${labels.heatMapSettings}</h3>
            <div class="setting-row">
                <label for="color-mode-fade">${labels.colorMode}:</label>
                <label><input type="checkbox" id="color-mode-fade"> ${labels.useFade}</label>
            </div>
            <div class="setting-row color-row">
                <label for="low-color">${labels.lowGradeColor}:</label>
                <input type="color" id="low-color">
                <label for="high-color">${labels.highGradeColor}:</label>
                <input type="color" id="high-color">
            </div>
            <div class="setting-row">
                <label for="low-grade-slider">${labels.lowGrade}:</label>
                <input type="range" id="low-grade-slider" min="0" max="100" step="1">
                <span id="low-grade-value"></span>
                <label><input type="checkbox" id="low-grade-auto"> ${labels.auto}</label>
            </div>
            <div class="setting-row">
                <label for="high-grade-slider">${labels.highGrade}:</label>
                <input type="range" id="high-grade-slider" min="0" max="100" step="1">
                <span id="high-grade-value"></span>
                <label><input type="checkbox" id="high-grade-auto"> ${labels.auto}</label>
            </div>
            <div class="setting-row">
                <label>${labels.presets}:</label>
                <div id="presets">
                    <button data-preset="1">${labels.redGreen}</button>
                    <button data-preset="2">${labels.neutral}</button>
                    <button data-preset="3">${labels.diverging}</button>
                    <button data-preset="4">${labels.monochrome}</button>
                    <button data-preset="5">${labels.theBlues}</button>
                    <button data-preset="6">${labels.rainbow}</button>
                </div>
            </div>
            <button id="collapse-settings">${labels.closeSettings}</button>
        </div>
        <div id="legend"></div>
        <div id="heat-map-content"></div>

        <h2 id="low-grade-verses">${labels.lowGradeVerses}</h2>
        <div id="low-grade-content"></div>

        <h2 id="all-verses">${labels.allVerses}</h2>
        <div id="all-verses-content"></div>
    </div>

    <script>
        const base64Data = '${base64Data}';
        const compressedData = Uint8Array.from(atob(base64Data), c => c.charCodeAt(0));
        
        async function decompressData(data) {
            const ds = new DecompressionStream('deflate-raw');
            const writer = ds.writable.getWriter();
            writer.write(data);
            writer.close();
            
            const reader = ds.readable.getReader();
            let jsonString = '';
            while (true) {
                const { value, done } = await reader.read();
                if (done) break;
                jsonString += new TextDecoder().decode(value);
            }
            return JSON.parse(jsonString);
        }

        decompressData(compressedData).then(reportData => {
            const num_sd_to_report = ${numSdToReport};
            const percentage_sorted = ${percentageSorted ?? 'null'};

            const totalScoreElement = document.getElementById('total-score');
            const grades = reportData.map(v => v.grade);
            const averageGrade = grades.length > 0 ? grades.reduce((sum, grade) => sum + grade, 0) / grades.length : 0;
            totalScoreElement.textContent = averageGrade.toFixed(1);

            const lowGradeContent = document.getElementById('low-grade-content');
            const allVersesContent = document.getElementById('all-verses-content');
            const heatMapContent = document.getElementById('heat-map-content');
            const legendContent = document.getElementById('legend');
            const sidebarContent = document.getElementById('sidebar-content');
            
            // Navigation functionality
            const hamburger = document.getElementById('hamburger');
            const sidebar = document.getElementById('sidebar');
            const sidebarOverlay = document.getElementById('sidebar-overlay');
            
            function toggleSidebar() {
                hamburger.classList.toggle('active');
                sidebar.classList.toggle('active');
                sidebarOverlay.classList.toggle('active');
                document.body.style.overflow = sidebar.classList.contains('active') ? 'hidden' : '';
            }
            
            function closeSidebar() {
                hamburger.classList.remove('active');
                sidebar.classList.remove('active');
                sidebarOverlay.classList.remove('active');
                document.body.style.overflow = '';
            }
            
            hamburger.addEventListener('click', toggleSidebar);
            sidebarOverlay.addEventListener('click', closeSidebar);
            
            // Close sidebar on ESC key
            document.addEventListener('keydown', (e) => {
                if (e.key === 'Escape' && sidebar.classList.contains('active')) {
                    closeSidebar();
                }
            });

            // --- Settings ---
            const settingsPanel = document.getElementById('settings-panel');
            const settingsToggleBtn = document.getElementById('settings-toggle');
            const collapseSettingsBtn = document.getElementById('collapse-settings');
            const colorModeFadeCheck = document.getElementById('color-mode-fade');
            const lowColorPicker = document.getElementById('low-color');
            const highColorPicker = document.getElementById('high-color');
            const lowGradeSlider = document.getElementById('low-grade-slider');
            const highGradeSlider = document.getElementById('high-grade-slider');
            const lowGradeValue = document.getElementById('low-grade-value');
            const highGradeValue = document.getElementById('high-grade-value');
            const lowGradeAutoCheck = document.getElementById('low-grade-auto');
            const highGradeAutoCheck = document.getElementById('high-grade-auto');
            const presetsContainer = document.getElementById('presets');

            let settings = {
                colorMode: 'spectrum', // 'spectrum' or 'fade'
                lowColor: '#ff0000',
                highColor: '#00ff00',
                lowGrade: 0,
                highGrade: 100,
                autoLowGrade: true,
                autoHighGrade: true,
            };

            function saveSettings() {
                try {
                    localStorage.setItem('reportSettings', JSON.stringify(settings));
                } catch (e) {
                    console.error("Could not save settings to localStorage", e);
                }
            }

            function loadSettings() {
                try {
                    const savedSettings = localStorage.getItem('reportSettings');
                    if (savedSettings) {
                        const loadedSettings = JSON.parse(savedSettings);
                        Object.assign(settings, loadedSettings);
                    }
                } catch (e) {
                    console.error("Could not load settings from localStorage", e);
                }
            }

            function hexToRgb(hex) {
                var result = /^#?([a-f\\d]{2})([a-f\\d]{2})([a-f\\d]{2})$/i.exec(hex);
                return result ? {
                    r: parseInt(result[1], 16),
                    g: parseInt(result[2], 16),
                    b: parseInt(result[3], 16)
                } : null;
            }

            function hexToHsl(hex) {
                const rgb = hexToRgb(hex);
                if (!rgb) return { h: 0, s: 0, l: 0 };
                let r = rgb.r / 255, g = rgb.g / 255, b = rgb.b / 255;
                const max = Math.max(r, g, b), min = Math.min(r, g, b);
                let h, s, l = (max + min) / 2;
                if (max === min) {
                    h = s = 0; // achromatic
                } else {
                    const d = max - min;
                    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
                    switch (max) {
                        case r: h = (g - b) / d + (g < b ? 6 : 0); break;
                        case g: h = (b - r) / d + 2; break;
                        case b: h = (r - g) / d + 4; break;
                    }
                    h /= 6;
                }
                return { h: h * 360, s: s, l: l };
            }

            function gradeToColor(grade, minGrade, maxGrade) {
                const low = settings.autoLowGrade ? minGrade : settings.lowGrade;
                const high = settings.autoHighGrade ? maxGrade : settings.highGrade;

                if (high <= low) return { backgroundColor: '#ccc', textColor: 'black' };

                const normalized = (grade - low) / (high - low);
                const clampedNormalized = Math.max(0, Math.min(1, normalized));

                let backgroundColor;
                if (settings.colorMode === 'fade') {
                    const lowRGB = hexToRgb(settings.lowColor);
                    const highRGB = hexToRgb(settings.highColor);
                    if (!lowRGB || !highRGB) return { backgroundColor: '#ccc', textColor: 'black' };
                    const r = Math.round(lowRGB.r + (highRGB.r - lowRGB.r) * clampedNormalized);
                    const g = Math.round(lowRGB.g + (highRGB.g - lowRGB.g) * clampedNormalized);
                    const b = Math.round(lowRGB.b + (highRGB.b - lowRGB.b) * clampedNormalized);
                    backgroundColor = \`rgb(\${r}, \${g}, \${b})\`;
                    
                    // For RGB, we can calculate luminance directly
                    const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
                    const textColor = luminance > 0.5 ? 'black' : 'white';
                    return { backgroundColor, textColor };
                } else { // spectrum
                    const lowHsl = hexToHsl(settings.lowColor);
                    const highHsl = hexToHsl(settings.highColor);
                    let hueDiff = highHsl.h - lowHsl.h;
                    const hue = lowHsl.h + hueDiff * clampedNormalized;
                    backgroundColor = \`hsl(\${hue}, 80%, 60%)\`;
                    
                    // For HSL with 60% lightness, we can determine text color more simply
                    const textColor = 'black'; // 60% lightness is generally light enough for black text
                    return { backgroundColor, textColor };
                }
            }

            function updateHeatMapAndLegend() {
                const allGrades = reportData.map(v => v.grade);
                const minGrade = Math.min(...allGrades);
                const maxGrade = Math.max(...allGrades);
                document.querySelectorAll('.heat-map-square').forEach(square => {
                    const vref = square.getAttribute('data-vref');
                    const verse = reportData.find(v => v.vref === vref);
                    if (verse) {
                        const colors = gradeToColor(verse.grade, minGrade, maxGrade);
                        square.style.backgroundColor = colors.backgroundColor;
                        square.style.color = colors.textColor;
                    }
                });

                // Update Legend
                const legendMin = settings.autoLowGrade ? Math.floor(minGrade) : settings.lowGrade;
                const legendMax = settings.autoHighGrade ? Math.ceil(maxGrade) : settings.highGrade;

                let gradient;
                if (settings.colorMode === 'fade') {
                    gradient = \`linear-gradient(to right, \${settings.lowColor}, \${settings.highColor})\`;
                } else {
                    const lowHsl = hexToHsl(settings.lowColor);
                    const highHsl = hexToHsl(settings.highColor);
                    let hueDiff = highHsl.h - lowHsl.h;
                    const stops = [];
                    for (let i = 0; i <= 10; i++) {
                        const normalized = i / 10;
                        const hue = lowHsl.h + hueDiff * normalized;
                        stops.push(\`hsl(\${hue}, 80%, 60%)\`);
                    }
                    gradient = \`linear-gradient(to right, \${stops.join(', ')})\`;
                }

                legendContent.innerHTML = \`
                    <div style="display: flex; align-items: center; gap: 10px;">
                        <span>\${legendMin.toFixed(0)}</span>
                        <div style="flex-grow: 1; height: 20px; background: \${gradient}; border-radius: 5px;"></div>
                        <span>\${legendMax.toFixed(0)}</span>
                    </div>
                \`;
            }
            
            function updateControlsFromSettings() {
                colorModeFadeCheck.checked = settings.colorMode === 'fade';
                lowColorPicker.value = settings.lowColor;
                highColorPicker.value = settings.highColor;
                lowGradeSlider.value = settings.lowGrade;
                highGradeSlider.value = settings.highGrade;
                lowGradeValue.textContent = settings.lowGrade;
                highGradeValue.textContent = settings.highGrade;
                lowGradeAutoCheck.checked = settings.autoLowGrade;
                highGradeAutoCheck.checked = settings.autoHighGrade;
                lowGradeSlider.disabled = settings.autoLowGrade;
                highGradeSlider.disabled = settings.autoHighGrade;
            }

            function applyPreset(presetId) {
                switch(String(presetId)) {
                    case '1': // Red-Green (Red=bad, Green=good)
                        settings.colorMode = 'spectrum';
                        settings.lowColor = '#ff0000';
                        settings.highColor = '#00ff00';
                        break;
                    case '2': // Neutral sequential
                        settings.colorMode = 'fade';
                        settings.lowColor = '#FDE725';
                        settings.highColor = '#440154';
                        break;
                    case '3': // Traditional diverging
                        settings.colorMode = 'fade';
                        settings.lowColor = '#2166AC';
                        settings.highColor = '#B2182B';
                        break;
                    case '4': // Monochrome
                        settings.colorMode = 'fade';
                        settings.lowColor = '#F7FBFF';
                        settings.highColor = '#08306B';
                        break;
                    case '5': // The Blues
                        settings.colorMode = 'fade';
                        settings.lowColor = '#ADD8E6';
                        settings.highColor = '#00008B';
                        break;
                    case '6': // Rainbow (Violet=worst, Red=best)
                        settings.colorMode = 'spectrum';
                        settings.lowColor = '#ee82ee'; // Violet
                        settings.highColor = '#ff0000'; // Red
                        break;
                }
                updateControlsFromSettings();
                updateHeatMapAndLegend();
                saveSettings();
            }

            function setupEventListeners() {
                settingsToggleBtn.addEventListener('click', () => {
                    const isExpanded = settingsPanel.classList.contains('expanded');
                    if (isExpanded) {
                        settingsPanel.classList.remove('expanded');
                        settingsToggleBtn.textContent = '...';
                        settingsToggleBtn.title = \`${labels.settings}\`;
                    } else {
                        settingsPanel.classList.add('expanded');
                        settingsToggleBtn.innerHTML = '&times;';
                        settingsToggleBtn.title = \`${labels.closeSettings}\`;
                    }
                });
                collapseSettingsBtn.addEventListener('click', () => {
                    settingsPanel.classList.remove('expanded');
                    settingsToggleBtn.textContent = '...';
                    settingsToggleBtn.title = \`${labels.settings}\`;
                });

                const update = () => {
                    settings.colorMode = colorModeFadeCheck.checked ? 'fade' : 'spectrum';
                    settings.lowColor = lowColorPicker.value;
                    settings.highColor = highColorPicker.value;
                    settings.lowGrade = parseInt(lowGradeSlider.value, 10);
                    settings.highGrade = parseInt(highGradeSlider.value, 10);
                    settings.autoLowGrade = lowGradeAutoCheck.checked;
                    settings.autoHighGrade = highGradeAutoCheck.checked;
                    updateControlsFromSettings();
                    updateHeatMapAndLegend();
                    saveSettings();
                };

                [colorModeFadeCheck, lowGradeAutoCheck, highGradeAutoCheck].forEach(el => el.addEventListener('change', update));
                [lowColorPicker, highColorPicker].forEach(el => el.addEventListener('input', update));
                [lowGradeSlider, highGradeSlider].forEach(el => el.addEventListener('input', (e) => {
                    if (e.target.id === 'low-grade-slider') lowGradeValue.textContent = e.target.value;
                    if (e.target.id === 'high-grade-slider') highGradeValue.textContent = e.target.value;
                    update();
                }));
                
                presetsContainer.addEventListener('click', (e) => {
                    if (e.target.tagName === 'BUTTON') {
                        applyPreset(e.target.dataset.preset);
                    }
                });
            }

            function splitRef(reference) {
                const lastSpaceIndex = reference.lastIndexOf(' ');
                if (lastSpaceIndex === -1) return [reference, null, null];
                const bookSplit = reference.substring(0, lastSpaceIndex);
                const chapterVerseStr = reference.substring(lastSpaceIndex + 1);
                if (!chapterVerseStr.includes(':')) return [bookSplit, parseInt(chapterVerseStr), null];
                const [chapterNum, verseNum] = chapterVerseStr.split(':');
                if (verseNum.includes('-')) {
                    const [startVerse, endVerse] = verseNum.split('-').map(Number);
                    return [bookSplit, parseInt(chapterNum), startVerse, endVerse];
                }
                return [bookSplit, parseInt(chapterNum), parseInt(verseNum), parseInt(verseNum)];
            }

            function renderVerse(verse, isPoor) {
                const verseDiv = document.createElement('div');
                verseDiv.className = 'verse';
                if (!isPoor) {
                    verseDiv.id = verse.href;
                }

                let vref_html = isPoor ? \`<a href="#\${verse.href}">\${verse.vref}</a>\` : verse.vref;

                verseDiv.innerHTML = \`
                    <div class="vref">\${vref_html} <span class="grade">(${labels.grade}: \${verse.grade.toFixed(1)})</span></div>
                    <div><span class="label">${labels.source}:</span> <div>\${verse.source}</div></div>
                    \${verse.source_translated ? \`<div>(\${verse.source_translated})</div>\` : ''}
                    <div><span class="label">${labels.translation}:</span> <div>\${verse.translation}</div></div>
                    \${verse.translation_translated ? \`<div>(\${verse.translation_translated})</div>\` : ''}
                    \${verse.suggested_translation ? \`<div><span class="label">${labels.suggestedTranslation}:</span><div>\${verse.suggested_translation}</div>\${verse.suggested_translation_translated ? \`<div>(\${verse.suggested_translation_translated})</div>\` : ''}</div>\` : ''}
                    <div><span class="label">${labels.review}:</span> <div>\${verse.review}</div></div>
                \`;
                return verseDiv;
            }

            // --- Main Execution ---
            
            // 1. Load settings from cookie
            loadSettings();

            // 2. Initial render of static content
            const bookChapterVerses = {};
            reportData.forEach(verse => {
                const [book, chapter] = splitRef(verse.vref);
                if (!bookChapterVerses[book]) bookChapterVerses[book] = {};
                if (!bookChapterVerses[book][chapter]) bookChapterVerses[book][chapter] = [];
                bookChapterVerses[book][chapter].push(verse);
            });

            Object.keys(bookChapterVerses).sort().forEach(book => {
                Object.keys(bookChapterVerses[book]).sort((a, b) => a - b).forEach(chapter => {
                    const chapterVerses = bookChapterVerses[book][chapter];
                    chapterVerses.sort((a, b) => splitRef(a.vref)[2] - splitRef(b.vref)[2]);

                    const row = document.createElement('div');
                    row.className = 'heat-map-row';
                    const label = document.createElement('div');
                    label.className = 'heat-map-label';
                    label.textContent = \`\${book} \${chapter}\`;
                    row.appendChild(label);

                    const versesContainer = document.createElement('div');
                    versesContainer.className = 'heat-map-verses';
                    chapterVerses.forEach(verse => {
                        const square = document.createElement('a');
                        square.className = 'heat-map-square';
                        square.href = \`#\${verse.href}\`;
                        square.setAttribute('data-vref', verse.vref);
                        square.textContent = splitRef(verse.vref)[2];
                        versesContainer.appendChild(square);
                    });
                    row.appendChild(versesContainer);
                    heatMapContent.appendChild(row);
                });
            });

            let lowGradeVerses = [];
            if (percentage_sorted !== null) {
                const sortedByGrade = [...reportData].sort((a, b) => a.grade - b.grade);
                const count = Math.floor(percentage_sorted * reportData.length / 100);
                lowGradeVerses = sortedByGrade.slice(0, count);
            } else {
                const grades = reportData.map(v => v.grade);
                if (grades.length > 1) {
                    const mean = grades.reduce((a, b) => a + b, 0) / grades.length;
                    const stdDev = Math.sqrt(grades.map(x => Math.pow(x - mean, 2)).reduce((a, b) => a + b, 0) / (grades.length -1) );
                    const gradeCutOff = mean - num_sd_to_report * stdDev;
                    lowGradeVerses = reportData.filter(v => v.grade <= gradeCutOff);
                    lowGradeVerses.sort((a, b) => a.grade - b.grade);
                }
            }

            lowGradeVerses.forEach(verse => lowGradeContent.appendChild(renderVerse(verse, true)));
            reportData.forEach(verse => allVersesContent.appendChild(renderVerse(verse, false)));

            // 3. Populate sidebar with table of contents
            const sidebarSections = [
                { title: "${labels.heatMap}", href: '#heat-map' },
                { title: "${labels.lowGradeVerses}", href: '#low-grade-verses', count: lowGradeVerses.length },
                { title: "${labels.allVerses}", href: '#all-verses' }
            ];

            sidebarSections.forEach(section => {
                const sectionDiv = document.createElement('div');
                sectionDiv.className = 'sidebar-section';
                
                const heading = document.createElement('h4');
                heading.innerHTML = section.title + (section.count ? \` (\${section.count})\` : '');
                sectionDiv.appendChild(heading);
                
                const link = document.createElement('a');
                link.href = section.href;
                link.className = 'sidebar-link';
                link.textContent = \`${labels.goTo} \${section.title}\`;
                sectionDiv.appendChild(link);
                
                // Add chapter links for All Verses section
                if (section.title === "${labels.allVerses}" ) {
                    Object.keys(bookChapterVerses).sort().forEach(book => {
                        Object.keys(bookChapterVerses[book]).sort((a, b) => a - b).forEach(chapter => {
                            const chapterLink = document.createElement('a');
                            chapterLink.href = \`#\${bookChapterVerses[book][chapter][0].href}\`;
                            chapterLink.className = 'sidebar-link chapter';
                            chapterLink.textContent = \`\${book} \${chapter}\`;
                            sectionDiv.appendChild(chapterLink);
                        });
                    });
                }
                
                sidebarContent.appendChild(sectionDiv);
            });

            // 4. Add smooth scrolling for all navigation links
            document.addEventListener('click', (e) => {
                if (e.target.matches('a[href^="#"]')) {
                    e.preventDefault();
                    const target = document.querySelector(e.target.getAttribute('href'));
                    if (target) {
                        target.scrollIntoView({
                            behavior: 'smooth',
                            block: 'start'
                        });
                        // Close sidebar if open
                        if (sidebar.classList.contains('active')) {
                            closeSidebar();
                        }
                    }
                }
            });

            // 5. Set up UI controls and dynamic content
            updateControlsFromSettings();
            updateHeatMapAndLegend();
            setupEventListeners();

            // 4. Download button
            document.getElementById('download-jsonl').addEventListener('click', () => {
                let jsonlContent = '';
                reportData.forEach(item => {
                    const itemForJsonl = {...item, grade: item.grade.toFixed(1)};
                    jsonlContent += JSON.stringify(itemForJsonl) + '\\n';
                });
                const blob = new Blob([jsonlContent], { type: 'application/jsonl' });
                const url = URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.href = url;
                a.download = \`\${htmlName}.jsonl\`;
                document.body.appendChild(a);
                a.click();
                document.body.removeChild(a);
                URL.revokeObjectURL(url);
            });
        });
    </script>
</body>
</html>
`;

        const folderPath = path.dirname(outputFilename);
        await fs.promises.mkdir(folderPath, { recursive: true });
        await fs.promises.writeFile(outputFilename, htmlContent, { encoding: 'utf-8' });
    }
}

export { run };
