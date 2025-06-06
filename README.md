# LLM Aggregator Chrome Extension

This folder holds a lightweight Chrome extension that queries multiple language model providers and shows their answers side by side. It relies only on standard HTML, CSS and JavaScript.

## Setup
1. Create a `secrets.js` file containing your API keys.
   It should export constants `OPENAI_API_KEY`, `GROK_API_KEY` and `GEMINI_API_KEY`.
   Example:
   ```js
   export const OPENAI_API_KEY = 'sk-...';
   export const GROK_API_KEY = '...';
   export const GEMINI_API_KEY = '...';
   ```
   Keep this file local and never commit real keys. The extension falls back to
   placeholder keys if the file is missing, allowing the UI to load even without
   real credentials.
2. Edit `settings.json` with your preferred model names.
3. Optionally adjust token prices in `pricing.json` (values are dollars per **million** tokens).
4. In Chrome, open `chrome://extensions` and enable **Developer mode**.
5. Click **Load unpacked** and choose this `LLM-Agg-Extension` folder.

## Project Files
- `manifest.json` – Declares extension permissions and points to `popup.html`.
- `popup.html` – The popup's HTML structure.
- `popup.css` – Styles for the popup window.
- `popup.js` – Fetches answers from each provider and maintains conversation history.
- `markdownWorker.js` – Web worker that sanitizes and renders Markdown.
- `secrets.js` – **Untracked file** where you place your API keys.
- `settings.json` – Preferred model names. This file contains no secrets.
- `pricing.json` – Token price data used to estimate request cost.

## Usage
Open the extension popup, enter a question and press **Ask**. Responses from OpenAI, Grok and Gemini will appear in separate columns. A summary line shows which model responded, token counts and the estimated cost. Follow-up prompts keep a conversation going by resending the previous messages.
The popup also shows the title and timestamp of the most recent pull request to this repository so you can confirm you're running the latest code.

## Available Models

### OpenAI API
https://platform.openai.com/docs/pricing

o4-mini-2025-04-16
gpt-4.1-2025-04-14
gpt-4.1-mini-2025-04-14
gpt-4.1-nano-2025-04-14
gpt-4.5-preview-2025-02-27
gpt-4o-2024-08-06
gpt-4o-audio-preview-2024-12-17
gpt-4o-mini-2024-07-18
gpt-4o-mini-audio-preview-2024-12-17
gpt-4o-mini-realtime-preview-2024-12-17
gpt-4o-mini-search-preview-2025-03-11
gpt-4o-realtime-preview-2024-12-17
gpt-4o-search-preview-2025-03-11
o1-2024-12-17
o1-mini-2024-09-12
o1-pro-2025-03-19
o3-2025-04-16
o3-mini-2025-01-31
chatgpt-4o-latest
gpt-4-turbo-2024-04-09
gpt-4-0613
gpt-4-32k
gpt-3.5-turbo-0125
gpt-3.5-turbo-instruct
gpt-3.5-turbo-16k-0613
codex-mini-latest
computer-use-preview-2025-03-11
gpt-image-1
davinci-002
babbage-002

---

### xAI (Grok) API
https://docs.x.ai/docs/models

grok-3-latest
grok-3-fast-latest
grok-3-mini-latest
grok-3-mini-fast-latest
grok-2-vision-latest
grok-2-image-latest
grok-2-latest

---

### Google AI Studio (Gemini) API
https://ai.google.dev/gemini-api/docs/models

gemini-2.5-flash-preview-05-20
gemini-2.5-pro-preview-05-20
gemini-2.0-flash
gemini-2.0-flash-lite
gemini-2.0-pro
gemini-1.5-pro-002
gemini-1.5-flash-002
gemini-1.0-pro-001
text-embedding-004
aqa

## Contributing

Development guidelines are in [AGENTS.md](AGENTS.md). Keep real API keys out of
version control and update `pricing.json` or `manifest.json` when adding new
providers or models.
