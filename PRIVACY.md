# Privacy Policy for Piazza AI Search

**Last Updated: January 5, 2026**

Piazza AI Search ("the Extension") is committed to protecting your privacy. This Privacy Policy explains how the Extension handles data.

## 1. Data Collection and Usage

The Extension does not collect, store, or transmit any personal information to its developers or any third-party servers owned by the developers.

- **Piazza Data:** The Extension accesses your Piazza posts, search results, and class information solely to provide AI-generated answers. This data is fetched directly from Piazza using your existing browser session.
- **AI Processing:** When you perform a search, your query and relevant Piazza post content are sent to the AI provider you have configured (e.g., OpenAI, Google Gemini, or xAI). This data is used only to generate a response for your specific query.

## 2. Data Storage

All configuration data is stored locally on your device:

- **API Keys:** Your AI provider API keys are stored in your browser's local storage (`chrome.storage.local`). They are never sent to the Extension developers.
- **Settings:** Your preferences, such as preferred models and search limits, are stored locally.

## 3. Authentication and Cookies

The Extension requires the `cookies` permission to interact with the Piazza API on your behalf. It uses your existing `session_id` cookie from `piazza.com` to authenticate requests. The Extension **never** sees, stores, or transmits your Piazza username or password.

## 4. Third-Party Services

The Extension facilitates communication between your browser, Piazza, and your chosen AI provider. Your use of these services is governed by their respective privacy policies:

- [Piazza Privacy Policy](https://piazza.com/legal/privacy)
- [OpenAI Privacy Policy](https://openai.com/policies/privacy-policy)
- [Google Privacy Policy](https://policies.google.com/privacy)
- [xAI Privacy Policy](https://x.ai/legal/privacy-policy)

## 5. Security

The Extension is designed to be self-contained. There is no backend server, which minimizes the risk of data breaches. API keys are stored locally and are only used to make direct requests to the AI providers' official endpoints.

## 6. Changes to This Policy

We may update this Privacy Policy from time to time. Any changes will be reflected in the "Last Updated" date at the top of this page.

---

_Note: This extension is not affiliated with or endorsed by Piazza Technologies, Inc._
