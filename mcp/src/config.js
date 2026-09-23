import os from "node:os";
import path from "node:path";

// PIAZZA_BASE_URL exists only so tests can point the server at a mock Piazza.
export const BASE_URL = (process.env.PIAZZA_BASE_URL || "https://piazza.com").replace(/\/$/, "");

export const DATA_DIR = process.env.PIAZZA_MCP_HOME || path.join(os.homedir(), ".piazza-mcp");
export const SESSION_FILE = path.join(DATA_DIR, "session.json");
export const BROWSER_PROFILE_DIR = path.join(DATA_DIR, "browser-profile");

export const EMAIL = process.env.PIAZZA_EMAIL || "";
export const PASSWORD = process.env.PIAZZA_PASSWORD || "";
export const DEFAULT_CLASS = process.env.PIAZZA_CLASS_ID || "";
export const BROWSER_PATH = process.env.PIAZZA_BROWSER_PATH || "";
export const ALLOW_WRITE = /^(1|true|yes)$/i.test(process.env.PIAZZA_ALLOW_WRITE || "");

// How long a tool call waits for the user to finish logging in before returning
// a "finish logging in, then retry" message. The login itself keeps running.
export const LOGIN_WAIT_MS = Number(process.env.PIAZZA_LOGIN_WAIT_MS) || 45_000;
// How long the login window stays open before giving up.
export const LOGIN_TIMEOUT_MS = 10 * 60_000;

export function log(...args) {
  // stdout carries the MCP protocol, so all logging goes to stderr.
  console.error("[piazza-mcp]", ...args);
}
