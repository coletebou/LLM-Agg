# Root Instructions for Codex

## Repository Layout
- `LLM-Agg/` – Chrome extension that aggregates responses from multiple
  LLM providers. This is the primary directory for development.

## LLM-Agg-Extension Overview
The extension queries OpenAI, xAI (Grok), and Google Gemini APIs and displays
their answers side by side. Key files:

- `manifest.json` – Manifest V3 file declaring permissions and setting
  `popup.html` as the action popup.
- `popup.html` – Popup HTML.
- `popup.css` – Styles for the popup.
- `popup.js` – Handles requests, manages history, and renders results.
- `markdownWorker.js` – Web worker used to sanitize and render Markdown safely.
- `settings.json` – Contains placeholder API keys and default model names. **Never commit real credentials.**
- `pricing.json` – Optional pricing data to estimate token cost per provider.
- `README.md` – Setup and usage instructions with available models.

## Guidelines
- Keep code simple and readable. Use standard HTML/CSS/JS with no frameworks or build tools.
- Update `manifest.json` if you add new resources or permissions.
- No automated tests or build scripts exist. After changes, reload the
  unpacked extension in Chrome to test.
- Provide concise commit messages summarizing your changes.

## Development Notes
- Keep `settings.json` committed only with placeholder keys. Real credentials
  must remain local and are ignored via `.gitignore`.
- Document new providers in the README and update `manifest.json` with any
  required host permissions.
- Keep model lists in README sorted alphabetically.
