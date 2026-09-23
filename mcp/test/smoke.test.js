// End-to-end tests: run the real MCP server over stdio against a mock Piazza.
// Write tools are never called.
import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { startMockPiazza } from "./mock-piazza.js";
import { findBrowser } from "../src/auth.js";

const SERVER = fileURLToPath(new URL("../src/index.js", import.meta.url));
const READ_TOOLS = [
  "get_class_info",
  "get_feed",
  "get_folder_posts",
  "get_post",
  "list_classes",
  "list_folders",
  "login",
  "search_posts",
];

async function connect(mock, env = {}) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "piazza-mcp-test-"));
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [SERVER],
    env: { PATH: process.env.PATH, PIAZZA_BASE_URL: mock.url, PIAZZA_MCP_HOME: home, ...env },
    stderr: "ignore",
  });
  const client = new Client({ name: "test", version: "1.0.0" });
  await client.connect(transport);
  const call = async (name, args = {}) => {
    const result = await client.callTool({ name, arguments: args });
    return { text: result.content[0].text, isError: !!result.isError };
  };
  return { client, call, home };
}

describe("with password login", () => {
  let mock, session;
  before(async () => {
    mock = await startMockPiazza();
    session = await connect(mock, { PIAZZA_EMAIL: "student@example.edu", PIAZZA_PASSWORD: "right-password" });
  });
  after(async () => {
    await session.client.close();
    mock.close();
    assert.deepEqual(mock.writes, [], "no write methods should ever be called");
  });

  test("read tools are marked read-only, write tools are not", async () => {
    const { tools } = await session.client.listTools();
    const readTools = tools.filter((t) => t.annotations?.readOnlyHint === true);
    const writeTools = tools.filter((t) => t.annotations?.readOnlyHint === false);
    assert.deepEqual(readTools.map((t) => t.name).sort(), READ_TOOLS);
    assert.deepEqual(writeTools.map((t) => t.name).sort(), ["add_followup", "create_post"]);
    assert.equal(tools.length, READ_TOOLS.length + 2);
    for (const t of writeTools) {
      assert.equal(t.annotations.destructiveHint, false);
      assert.equal(t.annotations.openWorldHint, true);
    }
  });

  test("tool schemas use a single type per property", async () => {
    const { tools } = await session.client.listTools();
    for (const t of tools) {
      for (const [name, prop] of Object.entries(t.inputSchema.properties || {})) {
        assert.ok(!Array.isArray(prop.type), `${t.name}.${name} has type ${JSON.stringify(prop.type)}`);
      }
    }
  });

  test("login saves the session with private permissions", async () => {
    const { text } = await session.call("login");
    assert.match(text, /Logged in to Piazza as Test Student/);
    const file = path.join(session.home, "session.json");
    assert.equal(fs.statSync(file).mode & 0o777, 0o600);
  });

  test("list_classes", async () => {
    const active = await session.call("list_classes");
    assert.match(active.text, /CS 101: Intro to Programming \(Fall 2025\).*id: cs101nid/);
    assert.doesNotMatch(active.text, /CS 200/);
    const all = await session.call("list_classes", { include_inactive: true });
    assert.match(all.text, /CS 200.*inactive/);
  });

  test("class resolution by course number and default to the only active class", async () => {
    const byNumber = await session.call("list_folders", { class_id: "cs101" });
    assert.match(byNumber.text, /- hw1\n- hw2\n- logistics\n- exam/);
    const implicit = await session.call("list_folders");
    assert.equal(implicit.text, byNumber.text);
    const bad = await session.call("list_folders", { class_id: "MATH 9" });
    assert.ok(bad.isError);
    assert.match(bad.text, /No class matches/);
  });

  test("search_posts", async () => {
    const { text } = await session.call("search_posts", { query: "hw1" });
    assert.match(text, /\*\*@12\*\* Late policy\? \(instructor answer · folders: logistics · updated 2025-09-10\)/);
    assert.match(text, /\*\*@13\*\* HW1 & recursion \(unanswered · 2 unresolved follow-ups/);
    const inFolder = await session.call("search_posts", { query: "hw1", folder: "HW1" });
    assert.doesNotMatch(inFolder.text, /\*\*@12\*\*/);
    assert.match(inFolder.text, /@13/);
  });

  test("get_post formats answers, follow-ups and links", async () => {
    const { text } = await session.call("get_post", { post: "@12" });
    assert.match(text, /^# @12: Late policy\?/);
    assert.match(text, new RegExp(`URL: ${mock.url}/class/cs101nid\\?cid=12`));
    assert.match(text, /Can we submit \*\*hw1\*\* late\? Formula: \$x_1 \+ y_2\$/);
    assert.match(text, /## Instructor answer \(updated 2025-09-10\)\n\nYes, \*\*2 days\*\* with 10% off\./);
    assert.match(text, /## Student answer \(endorsed by an instructor/);
    assert.match(text, new RegExp(`\\[welcome post\\]\\(${mock.url}/class/cs101nid\\?cid=1\\)`));
    assert.match(text, /### Follow-up 1 \(2025-09-10, unresolved\)\n\nDoes this apply to exams\?/);
    assert.match(text, /- \*\*Reply\*\* \(2025-09-10\): No, exams have no late days\./);

    const missing = await session.call("get_post", { post: "999" });
    assert.ok(missing.isError);
    assert.match(missing.text, /Content not found/);
  });

  test("get_feed filters", async () => {
    const all = await session.call("get_feed");
    assert.match(all.text, /\*\*@12\*\*[\s\S]*\*\*@13\*\*[\s\S]*\*\*@1\*\*/);
    const unanswered = await session.call("get_feed", { filter: "unanswered" });
    assert.match(unanswered.text, /@13/);
    assert.doesNotMatch(unanswered.text, /\*\*@12\*\*|\*\*@1\*\*/);
    const pinned = await session.call("get_feed", { filter: "pinned" });
    assert.match(pinned.text, /\*\*@1\*\* Welcome! \(note · pinned/);
    const unread = await session.call("get_feed", { filter: "unread" });
    assert.match(unread.text, /@13/);
  });

  test("get_folder_posts", async () => {
    const { text } = await session.call("get_folder_posts", { folder: "logistics" });
    assert.match(text, /\(2 total\)[\s\S]*\*\*@12\*\*[\s\S]*\*\*@1\*\*/);
  });

  test("get_class_info", async () => {
    const { text } = await session.call("get_class_info");
    assert.match(text, /# CS 101: Intro to Programming \(Fall 2025\)/);
    assert.match(text, /## Description\n\nLearn to \*\*program\*\*\./);
    assert.match(text, /- Prof Ada \(professor\) · ada@example\.edu/);
    assert.match(text, /\*\*Grading\*\*\nHW 50%, exams 50%/);
    assert.doesNotMatch(text, /Office hours|Syllabus\n/);
    assert.match(text, new RegExp(`\\[Syllabus PDF\\]\\(${mock.url}/class_profile/get_resource/cs101nid/abc\\)`));
    assert.match(text, /\[Textbook\]\(https:\/\/example\.com\/book\)/);
  });
});

describe("session handling", () => {
  let mock;
  before(async () => {
    mock = await startMockPiazza();
  });
  after(() => {
    mock.close();
    assert.deepEqual(mock.writes, []);
  });

  test("wrong password gives a clear error", async () => {
    const { client, call } = await connect(mock, { PIAZZA_EMAIL: "a@b.edu", PIAZZA_PASSWORD: "nope" });
    const { text, isError } = await call("list_classes");
    assert.ok(isError);
    assert.match(text, /Email or password incorrect/);
    await client.close();
  });

  test("expired saved session triggers a fresh login", async () => {
    const { client, call, home } = await connect(mock, {
      PIAZZA_EMAIL: "student@example.edu",
      PIAZZA_PASSWORD: "right-password",
    });
    fs.writeFileSync(
      path.join(home, "session.json"),
      JSON.stringify({ cookies: [{ name: "piazza_session", value: "expired", expires: -1 }] })
    );
    const { text, isError } = await call("list_classes");
    assert.ok(!isError, text);
    assert.match(text, /CS 101/);
    assert.match(fs.readFileSync(path.join(home, "session.json"), "utf8"), /valid-session/);
    await client.close();
  });

  const browser = process.env.PIAZZA_TEST_BROWSER || findBrowser();
  test("browser login captures the session", { skip: !browser && "no Chrome/Chromium found" }, async () => {
    const { client, call, home } = await connect(mock, {
      PIAZZA_BROWSER_PATH: browser,
      PIAZZA_BROWSER_HEADLESS: "1",
      HOME: os.tmpdir(),
    });
    const { text, isError } = await call("login");
    assert.ok(!isError, text);
    assert.match(text, /Logged in to Piazza as Test Student/);
    assert.match(fs.readFileSync(path.join(home, "session.json"), "utf8"), /valid-session/);
    await client.close();
  });

  test("slow browser login returns a retry message, then finishes in the background", { skip: !browser && "no Chrome/Chromium found" }, async () => {
    const { client, call } = await connect(mock, {
      PIAZZA_BROWSER_PATH: browser,
      PIAZZA_BROWSER_HEADLESS: "1",
      PIAZZA_LOGIN_WAIT_MS: "200",
      HOME: os.tmpdir(),
    });
    const first = await call("list_classes");
    assert.ok(first.isError);
    assert.match(first.text, /Finish logging in there, then try again/);
    await new Promise((resolve) => setTimeout(resolve, 4000));
    const second = await call("list_classes");
    assert.ok(!second.isError, second.text);
    assert.match(second.text, /CS 101/);
    await client.close();
  });
});
