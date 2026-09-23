# Piazza MCP Server

An [MCP](https://modelcontextprotocol.io) server that lets any MCP-compatible AI client (Claude Desktop, Claude Code, Cursor, VS Code, Codex, and others) search and read your Piazza classes.

It runs on your own computer, so there's nothing to host. You log in to Piazza once in a browser window, and your session is saved on your machine only.

## Setup

Requires [Node.js](https://nodejs.org) 18.17 or newer.

Add this to your MCP client's config file (for Claude Desktop, go to **Settings → Developer → Edit Config**):

```json
{
  "mcpServers": {
    "piazza": {
      "command": "npx",
      "args": ["-y", "piazza-mcp"]
    }
  }
}
```

Restart the client. The first time you ask about Piazza, a browser window opens: log in the way you normally do (password or school SSO). The window closes by itself when you're done. If the session expires later, the window opens again.

The login uses Chrome, Edge, Brave or Chromium, whichever is installed.

## Tools

| Tool | What it does |
|---|---|
| `list_classes` | Your classes and their IDs |
| `get_class_info` | Course info: description, staff, office hours, syllabus, resources |
| `list_folders` | A class's folders (hw1, exam, logistics…) |
| `search_posts` | Keyword search, optionally within a folder |
| `get_feed` | Recent posts, filtered by `unread`, `following`, `unanswered` or `pinned` |
| `get_folder_posts` | All posts in a folder |
| `get_post` | A full post with its answers and follow-up discussion |
| `login` | Check the login, or log in again (e.g. to switch accounts) |
| `create_post` | Post a new question or note |
| `add_followup` | Add a follow-up to an existing post |

The read tools are marked with `readOnlyHint`, so clients can auto-approve them.

Most tools take an optional `class_id`, which can be a class ID or a course number like `"CS 101"`. If you have only one active class, it's used automatically.

### Posting

Before anything is published, the server shows you the exact post in a confirmation prompt, and it's posted only if you check the box and accept. This works through MCP [elicitation](https://modelcontextprotocol.io/specification/latest/client/elicitation), so it applies even if you've set the tool to "always allow". In clients that don't support elicitation, these tools refuse to post. They're also marked as non-read-only tools, so clients will ask for permission before running them.

## Configuration

All settings are optional environment variables, set under `"env"` in the config:

```json
{
  "mcpServers": {
    "piazza": {
      "command": "npx",
      "args": ["-y", "piazza-mcp"],
      "env": { "PIAZZA_CLASS_ID": "CS 101" }
    }
  }
}
```

| Variable | Description |
|---|---|
| `PIAZZA_CLASS_ID` | Default class (ID or course number) when a tool call doesn't specify one |
| `PIAZZA_BROWSER_PATH` | Browser executable to use for login, if it isn't found automatically |
| `PIAZZA_EMAIL`, `PIAZZA_PASSWORD` | Log in with email and password instead of a browser (e.g. on a server). Doesn't work for school SSO accounts. |
| `PIAZZA_MCP_HOME` | Where the session is stored (default `~/.piazza-mcp`) |

## Privacy

Your Piazza session cookies are saved in `~/.piazza-mcp/session.json`, readable only by your user account. Requests go directly from your computer to piazza.com. Nothing is sent anywhere else. Delete that folder to log out.

This server uses Piazza's internal web API, which is unofficial and may change.

## Development

```sh
npm install
npm test   # runs the server against a local mock of Piazza
```

The browser login test uses your installed Chrome/Chromium in headless mode, or `PIAZZA_TEST_BROWSER` if set.
