## Project

Chrome extension that adds AI features to Piazza.

Core feature: allow users to search posts for answers with AI instead of having to search and manually look through posts.

## Architecture

The extension is fully self-contained and does not require a hosted backend.

### Frontend & UI Injection

- **Vanilla JS, CSS, and HTML**: No frameworks used.
- **Content Script (`scripts/content.js`)**: Injects a Floating Action Button (FAB) and a side panel directly into the Piazza interface. It handles the UI for the search panel, results, and resizing logic.
- **Popup (`pages/popup.html`)**: Provides a quick link to settings and displays the last search results.
- **Options (`pages/options.html`)**: Allows users to configure API keys, select providers/models, and manage favourite models.
- **Results Overlay**: Displays AI-generated answers with source links directly on the Piazza page.
- **Rendering**: Uses `marked.min.js` for Markdown and `katex.min.js` for LaTeX math rendering in AI responses.
- **Organization**: Files are organized into `scripts/`, `styles/`, `pages/`, and `lib/` (for third-party libraries).

### Logic & Integration

- **Modular Services**: Logic is separated into specialized modules:
  - `scripts/piazzaService.js`: Handles all Piazza API interactions (`network.search`, `content.get`).
  - `scripts/llmService.js`: Manages AI provider configurations and tool-calling logic.
  - `scripts/providers.js`: Defines supported AI providers (Google Gemini, OpenAI, xAI) and their models.
  - `scripts/utils.js`: Utility functions for HTML stripping, text extraction, and XML formatting for LLM context.
- **Background Script (`scripts/background.js`)**: Orchestrates the AI search flow. It receives requests from the content script, performs Piazza searches, fetches post content, and calls the LLM service.
- **Piazza Interaction**: Performed via direct fetch requests to Piazza's internal logic API. It leverages the user's existing browser session cookies (requires `cookies` permission).
- **AI Integration**: Supports multiple providers (Google, OpenAI, xAI) using OpenAI-compatible Chat Completions or Responses APIs. The LLM uses the `search_piazza` tool to dynamically search for relevant posts based on the user's query.
- **User Experience**: Includes a resizable side panel, keyboard shortcuts (Cmd/Ctrl + K), and a persistent FAB for quick access.
- **Storage**: User settings (API keys per provider, preferred models, favourite models, result counts) are stored locally using `chrome.storage.local`.

## MCP Server (`mcp/`)

A separate Node package (`piazza-mcp` on npm) that exposes Piazza to any MCP client over stdio. It runs locally on the user's machine; no hosting.

- `src/index.js`: Entry point; creates the `McpServer` and connects stdio.
- `src/tools.js`: Tool definitions. Read tools (`list_classes`, `get_class_info`, `list_folders`, `search_posts`, `get_feed`, `get_folder_posts`, `get_post`, `login`) are annotated `readOnlyHint: true`. Write tools (`create_post`, `add_followup`) are registered only when `PIAZZA_ALLOW_WRITE=true`, and each call must be approved by the user through an MCP elicitation prompt.
- `src/piazza.js`: Piazza client: session handling (re-login on expiry), class resolution, API wrappers.
- `src/auth.js`: Browser login by default (puppeteer-core drives the user's installed Chrome/Edge/Brave/Chromium and captures cookies once `user.status` succeeds), optional email/password login, session file at `~/.piazza-mcp/session.json` (mode 600).
- `src/api.js`: Raw JSON-RPC calls to `piazza.com/logic/api`. `src/format.js`: HTML/`<md>` content to markdown, post and feed formatting.
- Tests (`npm test`) run the real server against a mock Piazza (`test/mock-piazza.js`). Never test write tools against real Piazza.

## Development Standards

- **Manifest V3**: Uses the latest Chrome extension standards.
- **Security**: API keys are stored locally and never sent to a third-party backend.
- **Permissions**: Requires `storage`, `cookies`, and `host_permissions` for `piazza.com` and AI provider endpoints (`api.x.ai`, `generativelanguage.googleapis.com`, `api.openai.com`).
