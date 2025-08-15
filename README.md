# Codex Reflection

Codex Reflection is a VSCodium extension that adds AI-powered quality review to the existing Codex Editor translation environment. It uses multiple grading passes from an LLM to assess translations, summarize suggested improvements, and iteratively apply them until the grade reaches 90 in the generated suggestion or a maximum of 10 rounds is reached.

## Overview

The reflection process works by:
1. Running multiple grading passes on translation content to get more stable scores than single evaluations
2. Summarizing corrections from different grading passes
3. Self-executing those corrections on the original translation
4. Running new rounds of grading in an iterative improvement cycle
5. Stopping the iterations once the suggested translation reaches a grade of 90 or hitting 10 rounds and suggesting the best-graded result

The plugin emphasizes **quality checking** and grading of existing translations, with AI-suggested alternative translations available as a secondary feature leaving the translator as the primary decision maker and driver of the translation process.

## Features

- **Multi-pass LLM Grading**: Uses multiple evaluation rounds for more stable and reliable quality scores
- **Iterative Improvement**: Automatically self applies generated corrections to produce a suggested translation iterateing up to 10 times
- **Integration with Codex Editor**: Seamlessly works with existing `.codex` files and comments in the codex translation project
- **Configurable Range**: Allows limiting the reflection scope to a specific verse ranges to control cost and focus
- **Customizable Objectives**: Adjust translation goals and grading criteria
- **HTML Report Generation**: Creates detailed reports with heatmaps highlighting low-scoring sections
- **Real-time Logging**: Monitor the reflection process with live output logs
- **Multiple Viewing Options**: View reports in VSCodium webview or external browser
- **Export Functionality**: Save and share portable HTML reports

## Requirements

- **VSCodium** (not targeting VSCode marketplace - uses Open VSX Registry)
- **Codex Editor Extension**: This plugin is designed to work with translation projects managed by [Codex Editor](https://docs.codexeditor.app/docs)
- **OpenAI API Key**: Required for LLM grading functionality

## Installation

Install from the Open VSX Registry in [Codex Translation Editor](https://codexeditor.app/):

1. Open [Codex Translation Editor](https://codexeditor.app/)
2. Go to Extensions (Ctrl+Shift+X)
3. Search for "codex-reflection"
4. Click Install

## Configuration

Before using Codex Reflection, configure these settings for Codex Reflection:

### Required Settings

- **`codex-reflection.openAIKey`**: Your OpenAI API key for LLM access
  - This is separate from any Codex Editor API key to allow independent cost tracking

### Optional Settings

- **`codex-reflection.firstVerseRef`**: Starting verse reference (e.g., "MAT 1:1")
  - Leave blank to start from the beginning
  - Use this to limit reflection scope and control costs
  - If a reference is entered but fails to match, the process will terminate with a complaint.

- **`codex-reflection.lastVerseRef`**: Ending verse reference (e.g., "MAT 2:1")  
  - Leave blank to continue to the end
  - Recommended for initial testing to avoid unexpected costs

- **`codex-reflection.translationObjective`**: Customize the grading criteria and translation purpose
  - Default objective is optimized for literal translations
  - Modify to match your specific translation goals and target audience

## Usage

1. **Open a Translation Project**: Use Codex Editor to open or create a translation project

2. **Configure Settings**: Set your OpenAI API key and optionally define verse ranges and translation objectives

3. **Open Reflection Panel**: Click the mirror icon in the Activity Bar (alongside Explorer, Run and Debug, etc.)

4. **Start Reflection**: Click the play button next to "Start Reflection"

5. **Monitor Progress**: Watch the "Reflection Logs" section for real-time process updates

6. **Review Reports**: Once complete, reports appear in the "Reports" section (one per book)

### Report Actions

Each report provides three viewing options:
- **Export Report**: Save the HTML report file
- **Open in Browser**: View in your default web browser  
- **Open in Webview**: View within Codex Editor's integrated webview

## How It Works

The reflection process operates on translation content by:

1. **Initial Grading**: Multiple LLM passes evaluate the current translation quality referencing any verse comments.
2. **Correction Summary**: Aggregates and summarizes suggested improvements
3. **Self-Correction**: Applies corrections to create an improved version
4. **Re-evaluation**: Grades the improved version
5. **Iteration**: Repeats steps 2-4 up to 10 times or until the grade reaches 90
6. **Report Generation**: Creates an HTML report with heatmap visualization with the suggested corrections and suggested translations.

## File Formats

- Works with **`.codex`** files (Codex Editor translation target files)
- Processes **`.source`** files (Codex Editor translation source references)
- Generates **`.html`** reports (viewable in browser or webview)

## Cost Considerations

Since this plugin makes multiple LLM API calls per verse, costs can accumulate quickly. We recommend:

- Start with small verse ranges using `firstVerseRef` and `lastVerseRef`
- Monitor your OpenAI API usage
- Test with a few chapters before processing entire books
- Use a separate API key to track reflection costs independent of the general Codex Editor Ai functionality.

## Known Issues

- Currently supports OpenAI models only
- Processing large ranges can be time-intensive and costly

## Support

For Codex Editor documentation and general translation workflow guidance, visit: https://docs.codexeditor.app/docs

## License


    MIT License

    Copyright (c) 2025 Missions Mutual  
    Author: Joshua Lansford

    Permission is hereby granted, free of charge, to any person obtaining a copy
    of this software and associated documentation files (the "Software"), to deal
    in the Software without restriction, including without limitation the rights
    to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
    copies of the Software, and to permit persons to whom the Software is
    furnished to do so, subject to the following conditions:

    The above copyright notice and this permission notice shall be included in all
    copies or substantial portions of the Software.

    THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
    IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
    FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
    AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
    LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
    OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
    SOFTWARE.