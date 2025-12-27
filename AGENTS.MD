## Project

Chrome extension that adds AI features to Piazza.

Core feature: allow users to search posts for answers with AI instead of having to search and manually look through posts.

## Architecture

The extension is fully self-contained and does not require a hosted backend.

### Frontend & UI Injection

- **Vanilla JS, CSS, and HTML**: No frameworks used.
- **Content Script (`scripts/content.js`)**: Injects an "AI Search" button directly into the Piazza interface (next to the element with ID `feed_search_bar`).
- **Popup (`pages/popup.html`)**: Provides a quick link to settings and displays the last search results. The search input is handled directly on the Piazza page via the content script.
- **Results Overlay**: Displays AI-generated answers and source links directly on the Piazza page.
- **Organization**: Files are organized into `scripts/`, `styles/`, and `pages/` directories.

### Logic & Integration

- **Modular Services**: Logic is separated into specialized modules:
  - `scripts/piazzaService.js`: Handles all Piazza API interactions (searching, fetching posts).
  - `scripts/llmService.js`: Manages the xAI (Grok) configuration and tool-calling logic.
  - `scripts/utils.js`: Utility functions for HTML stripping and text extraction.
- **Piazza Interaction**: Performed via direct fetch requests to Piazza's internal logic API. It leverages the user's existing browser session cookies (requires `cookies` permission).
- **AI Integration**: Uses the xAI OpenAI-compatible Chat Completions API (`/v1/chat/completions`) with **tool calling**. The LLM uses the `search_piazza` tool to dynamically search for relevant posts based on the user's query.
- **Storage**: User settings (API keys, preferred models, result counts) are stored locally using `chrome.storage.local`.

## Development Standards

- **Manifest V3**: Uses the latest Chrome extension standards.
- **Security**: API keys are stored locally and never sent to a third-party backend.
- **Permissions**: Requires `storage`, `cookies`, and `host_permissions` for `piazza.com` and `api.x.ai`.
