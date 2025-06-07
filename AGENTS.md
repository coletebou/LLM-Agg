# Root Instructions for Codex

## Repository Layout
- Project is a simple website that aggregates responses from multiple LLM providers.

## LLM-Agg Website Overview
The site queries OpenAI, xAI (Grok), and Google Gemini APIs and displays their answers side by side. Key files:

- `index.html` – Main webpage.
- `style.css` – Page styles.
- `app.js` – Handles requests, manages history, and renders results.
- `markdownWorker.js` – Web worker used to sanitize and render Markdown safely.
- `settings.json` – Contains placeholder model names. **Never commit real credentials.**
- `pricing.json` – Optional pricing data to estimate token cost per provider.
- `README.md` – Setup instructions with available models.

## Guidelines
- Keep code simple and readable. Use standard HTML/CSS/JS with no frameworks or build tools.
- No automated tests or build scripts exist. After changes, open `index.html` in your browser to test.
- Provide concise commit messages summarizing your changes.

## Development Notes
- Keep `settings.json` committed only with placeholder keys. Real credentials must remain local and are ignored via `.gitignore`.
- Document new providers or models in the README.
- Keep model lists in README sorted alphabetically.
