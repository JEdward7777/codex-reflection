# Codex Reflection

Codex Reflection is a VSCodium extension that adds AI-powered quality review to the existing Codex Editor translation environment. It uses multiple grading passes from an LLM to assess translations, summarize suggested improvements, and iteratively apply them (up to 10 rounds) to produce higher-quality suggestions.

## Overview

The reflection process works by:
1. Running multiple grading passes on translation content to get more stable scores than single evaluations
2. Summarizing corrections from different grading passes
3. Self-executing those corrections on the original translation
4. Running new rounds of grading in an iterative improvement cycle
5. Limiting iterations to 10 rounds and selecting the best-graded result

The plugin emphasizes **quality checking** and grading of existing translations, with AI-suggested alternative translations available as a secondary feature. This approach addresses translator concerns about AI-assisted translation by focusing on review and assessment rather than replacement.

## Features

- **Multi-pass LLM Grading**: Uses multiple evaluation rounds for more stable and reliable quality scores
- **Iterative Improvement**: Automatically applies suggested corrections and re-evaluates up to 10 times
- **Integration with Codex Editor**: Seamlessly works with existing `.codex` translation projects
- **Configurable Range**: Process specific verse ranges to control scope and costs
- **Customizable Objectives**: Adjust translation goals and grading criteria
- **HTML Report Generation**: Creates detailed reports with heatmaps highlighting low-scoring sections
- **Multiple Viewing Options**: View reports in VSCodium webview or external browser
- **Real-time Logging**: Monitor the reflection process with live output logs
- **Export Functionality**: Save and share portable HTML reports

## Requirements

- **VSCodium** (not targeting VSCode marketplace - uses Open VSX Registry)
- **Codex Editor Extension**: While technically optional, this plugin is designed to work with translation projects managed by [Codex Editor](https://docs.codexeditor.app/docs)
- **OpenAI API Key**: Required for LLM grading functionality

## Installation

Install from the Open VSX Registry in VSCodium:

1. Open VSCodium
2. Go to Extensions (Ctrl+Shift+X)
3. Search for "codex-reflection"
4. Click Install

## Configuration

Before using Codex Reflection, configure these settings in VSCodium:

### Required Settings

- **`codex-reflection.openAIKey`**: Your OpenAI API key for LLM access
  - This is separate from any Codex Editor API key to allow independent cost tracking

### Optional Settings

- **`codex-reflection.firstVerseRef`**: Starting verse reference (e.g., "MAT 1:1")
  - Leave blank to start from the beginning
  - Use this to limit reflection scope and control costs

- **`codex-reflection.lastVerseRef`**: Ending verse reference (e.g., "MAT 2:1")  
  - Leave blank to continue to the end
  - Recommended for initial testing to avoid unexpected costs

- **`codex-reflection.translationObjective`**: Customize the grading criteria and translation purpose
  - Default objective is optimized for literal translations
  - Modify to match your specific translation goals and target audience

## Usage

1. **Open a Translation Project**: Use Codex Editor to open or create a `.codex` translation project

2. **Configure Settings**: Set your OpenAI API key and optionally define verse ranges and translation objectives

3. **Open Reflection Panel**: Click the mirror icon in the Activity Bar (alongside Explorer, Run and Debug, etc.)

4. **Start Reflection**: Click the play button (▶) next to "Start Reflection"

5. **Monitor Progress**: Watch the "Reflection Logs" section for real-time process updates

6. **Review Reports**: Once complete, reports appear in the "Reports" section (one per book)

### Report Actions

Each report provides three viewing options:
- **Export Report** (📤): Save the HTML report file
- **Open in Browser** (🌐): View in your default web browser  
- **Open in Webview** (🔍): View within VSCodium's integrated webview

## How It Works

The reflection process operates on translation content by:

1. **Initial Grading**: Multiple LLM passes evaluate the current translation quality
2. **Correction Summary**: Aggregates and summarizes suggested improvements
3. **Self-Correction**: Applies corrections to create an improved version
4. **Re-evaluation**: Grades the improved version
5. **Iteration**: Repeats steps 2-4 up to 10 times or until quality stabilizes
6. **Best Selection**: Chooses the highest-graded version from all iterations
7. **Report Generation**: Creates an HTML report with heatmap visualization

## File Formats

- Works with **`.codex`** files (Codex Editor translation projects)
- Processes **`.source`** files (source translation references)
- Generates **`.html`** reports (viewable in browser or webview)

## Cost Considerations

Since this plugin makes multiple LLM API calls per verse, costs can accumulate quickly. We recommend:

- Start with small verse ranges using `firstVerseRef` and `lastVerseRef`
- Monitor your OpenAI API usage
- Test with a few verses before processing entire books
- Use a separate API key to track reflection costs independently

## Known Issues

- Currently supports OpenAI models only
- Processing large ranges can be time-intensive and costly
- Reports are generated per book (not customizable ranges yet)

## Roadmap

- Support for additional LLM providers
- More report format options
- Advanced configuration options
- Performance optimizations

## Support

For Codex Editor documentation and general translation workflow guidance, visit: https://docs.codexeditor.app/docs

## License

[Add your license information here]

## Contributing

[Add contribution guidelines here]
