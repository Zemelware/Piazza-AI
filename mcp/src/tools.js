import { z } from "zod";
import { DEFAULT_CLASS } from "./config.js";
import {
  decodeEntities,
  formatDate,
  formatPost,
  formatSummaries,
  isPinned,
  isUnanswered,
  postUrl,
  toMarkdown,
} from "./format.js";
import { isActiveClass } from "./piazza.js";

const READ = { readOnlyHint: true, openWorldHint: true };
const WRITE = { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true };

const classIdParam = z
  .string()
  .optional()
  .describe(
    "Class network ID from list_classes, or a course number like \"CS 101\". " +
      "Optional if the user has only one active class or set a default class."
  );

// A plain string (not string|number) keeps the schema portable across clients.
const postParam = z.string().min(1).describe('Post number (e.g. "@123" or "123") or the post\'s internal ID.');

function normalizePostRef(post) {
  const ref = String(post).trim().replace(/^[@#]/, "");
  return /^\d+$/.test(ref) ? Number(ref) : ref;
}

function paginate(items, offset, limit) {
  return items.slice(offset, offset + limit);
}

function classLabel(network) {
  const title = [network.course_number, network.name].filter(Boolean).join(": ") || network.id;
  return network.term ? `${title} (${network.term})` : title;
}

/** Turn plain text into the simple HTML Piazza's editor produces. */
function textToHtml(text) {
  const escape = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  return text
    .trim()
    .split(/\n\s*\n/)
    .map((paragraph) => `<p>${escape(paragraph).replace(/\n/g, "<br />")}</p>`)
    .join("");
}

/** Render loosely-structured class info fields whose exact shape varies. */
function renderInfo(value) {
  if (value == null || value === "") return "";
  if (typeof value === "string") return toMarkdown(value);
  if (Array.isArray(value)) return value.map(renderInfo).filter(Boolean).join("\n\n");
  if (typeof value === "object") {
    const title = value.title || value.subject || value.name;
    const body = value.text ?? value.content ?? value.description ?? value.value;
    if (title || body !== undefined) {
      return [title && `**${decodeEntities(title)}**`, renderInfo(body)].filter(Boolean).join("\n");
    }
    const entries = Object.entries(value).filter(([, v]) => v != null && v !== "" && !(typeof v === "object" && !Object.keys(v).length));
    return entries.map(([key, v]) => `- ${key}: ${typeof v === "object" ? JSON.stringify(v) : v}`).join("\n");
  }
  return String(value);
}

export function registerTools(server, piazza) {
  const tool = (name, config, handler) =>
    server.registerTool(name, config, async (args, extra) => {
      try {
        return { content: [{ type: "text", text: await handler(args, extra) }] };
      } catch (error) {
        return { isError: true, content: [{ type: "text", text: error.message }] };
      }
    });

  // -------------------------------------------------------------------------
  // Account
  // -------------------------------------------------------------------------

  tool(
    "login",
    {
      title: "Log in to Piazza",
      description:
        "Check the Piazza login, or log in. If the user isn't logged in, this opens a browser window " +
        "where they log in to Piazza normally (including school SSO). Other tools log in automatically " +
        "when needed, so only call this if the user asks or to switch accounts (force: true).",
      inputSchema: {
        force: z.boolean().optional().describe("Log out and log in again, e.g. to switch accounts."),
      },
      annotations: READ,
    },
    async ({ force }) => {
      if (force) await piazza.login({ force: true });
      const status = await piazza.getStatus({ refresh: true });
      const active = (status.networks || []).filter(isActiveClass).length;
      const who = [status.name, status.email].filter(Boolean).join(" · ") || status.id;
      return `Logged in to Piazza as ${who}. ${active} active class${active === 1 ? "" : "es"}.`;
    }
  );

  // -------------------------------------------------------------------------
  // Classes
  // -------------------------------------------------------------------------

  tool(
    "list_classes",
    {
      title: "List Piazza classes",
      description:
        "List the user's Piazza classes with their IDs. Use the ID (or course number) as class_id in other " +
        "tools. Pick the class from context when it's clear; ask the user if it's ambiguous.",
      inputSchema: {
        include_inactive: z.boolean().optional().describe("Also list past/inactive classes."),
      },
      annotations: READ,
    },
    async ({ include_inactive }) => {
      const status = await piazza.getStatus();
      const classes = (status.networks || []).filter((c) => include_inactive || isActiveClass(c));
      if (!classes.length) return include_inactive ? "No Piazza classes found." : "No active Piazza classes found.";
      const lines = classes.map((c) => {
        const details = [`id: ${c.id}`];
        if (c.prof_hash && status.id in c.prof_hash) details.push("you're on course staff");
        if (!isActiveClass(c)) details.push("inactive");
        if (DEFAULT_CLASS && (c.id === DEFAULT_CLASS || c.course_number === DEFAULT_CLASS)) details.push("default");
        return `- **${classLabel(c)}** (${details.join(" · ")})`;
      });
      return `Piazza classes:\n\n${lines.join("\n")}`;
    }
  );

  tool(
    "get_class_info",
    {
      title: "Get class info",
      description:
        "Get a class's course information page: description, staff, office hours, general info, " +
        "syllabus and course resources (links and files). Use for logistics questions like " +
        "\"when are office hours?\" or \"who are the TAs?\".",
      inputSchema: { class_id: classIdParam },
      annotations: READ,
    },
    async ({ class_id }) => {
      const network = await piazza.resolveClass(class_id);
      const lines = [`# ${classLabel(network)}`];

      const meta = [];
      if (network.school) meta.push(`School: ${network.school}`);
      if (network.department) meta.push(`Department: ${network.department}`);
      if (network.start_date || network.end_date) {
        meta.push(`Dates: ${formatDate(network.start_date) || "?"} to ${formatDate(network.end_date) || "?"}`);
      }
      if (meta.length) lines.push("", meta.join(" · "));
      const courseUrl = piazza.courseUrl(network);
      if (courseUrl) lines.push(`Course page: ${courseUrl}`);

      let hasContent = false;
      const section = (title, body) => {
        if (!body) return;
        lines.push("", `## ${title}`, "", body);
        hasContent = true;
      };
      section("Description", renderInfo(network.course_description));
      section(
        "Staff",
        (network.profs || [])
          .map((p) => `- ${p.name || "Unknown"}${p.role ? ` (${p.role})` : ""}${p.email ? ` · ${p.email}` : ""}`)
          .join("\n")
      );
      section("Office hours", renderInfo(network.office_hours));
      section("General information", renderInfo(network.general_information));
      section("Syllabus", renderInfo(network.syllabus));

      const resources = await piazza.getResources(network);
      if (resources?.length) {
        const bySection = new Map();
        for (const r of resources) {
          const name = r.config?.section || "general";
          if (!bySection.has(name)) bySection.set(name, []);
          const title = decodeEntities(r.subject || "Untitled");
          const date = r.config?.date ? ` (${r.config.date})` : "";
          const content = String(r.content || "");
          const entry = /^(https?:)?\//.test(content)
            ? `- [${title}](${content.startsWith("/") ? new URL(content, courseUrl).href : content})${date}`
            : `- ${title}${date}${content ? `: ${toMarkdown(content)}` : ""}`;
          bySection.get(name).push(entry);
        }
        section(
          "Resources",
          [...bySection].map(([name, entries]) => `### ${name}\n${entries.join("\n")}`).join("\n\n")
        );
      }

      if (!hasContent) lines.push("", "This class has no course information filled in.");
      return lines.join("\n");
    }
  );

  tool(
    "list_folders",
    {
      title: "List folders",
      description:
        "List a class's folders (e.g. hw1, exam, logistics). Folder names often differ from what people " +
        "call things (\"assignment 1\" might be \"hw1\" or \"a1\"), so check them before using get_folder_posts.",
      inputSchema: { class_id: classIdParam },
      annotations: READ,
    },
    async ({ class_id }) => {
      const network = await piazza.resolveClass(class_id);
      const folders = network.folders || [];
      if (!folders.length) return `${classLabel(network)} has no folders.`;
      return `Folders in ${classLabel(network)}:\n\n${folders.map((f) => `- ${f}`).join("\n")}`;
    }
  );

  // -------------------------------------------------------------------------
  // Posts
  // -------------------------------------------------------------------------

  tool(
    "search_posts",
    {
      title: "Search posts",
      description:
        "Keyword search over a class's posts. Piazza search matches keywords, not meaning: use 1-3 " +
        "distinctive words (e.g. \"late policy\", \"recursion hw3\") and try synonyms if nothing comes back. " +
        "For everything about one assignment or topic, get_folder_posts is often better. " +
        "Results are summaries; read promising ones with get_post.",
      inputSchema: {
        query: z.string().min(1).describe("Search keywords."),
        class_id: classIdParam,
        folder: z.string().optional().describe("Only return posts in this folder."),
        limit: z.number().int().min(1).max(50).optional().describe("Max results (default 15)."),
      },
      annotations: READ,
    },
    async ({ query, class_id, folder, limit = 15 }) => {
      const network = await piazza.resolveClass(class_id);
      let results = await piazza.search(network.id, query);
      if (folder) {
        const wanted = folder.toLowerCase();
        results = results.filter((r) => (r.folders || []).some((f) => f.toLowerCase() === wanted));
      }
      return formatSummaries(
        results.slice(0, limit),
        `Search results for "${query}" in ${classLabel(network)}${folder ? `, folder ${folder}` : ""} ` +
          `(showing ${Math.min(limit, results.length)} of ${results.length}):`
      );
    }
  );

  tool(
    "get_post",
    {
      title: "Get post",
      description:
        "Read a full Piazza post: the question or note, the instructor and student answers, and the " +
        "follow-up discussion. Includes the post URL; cite it when answering from the post.",
      inputSchema: { post: postParam, class_id: classIdParam },
      annotations: READ,
    },
    async ({ post, class_id }) => {
      const network = await piazza.resolveClass(class_id);
      return formatPost(await piazza.getPost(network.id, normalizePostRef(post)), network);
    }
  );

  tool(
    "get_feed",
    {
      title: "Get class feed",
      description:
        "List a class's recent posts, most recently updated first. Filters: unread (new activity since " +
        "the user last read it), following, unanswered (questions with no answer), pinned (usually " +
        "important announcements and logistics).",
      inputSchema: {
        class_id: classIdParam,
        filter: z.enum(["all", "unread", "following", "unanswered", "pinned"]).optional().describe("Default: all."),
        limit: z.number().int().min(1).max(100).optional().describe("Max posts (default 20)."),
        offset: z.number().int().min(0).optional().describe("Skip this many posts, for paging."),
      },
      annotations: READ,
    },
    async ({ class_id, filter = "all", limit = 20, offset = 0 }) => {
      const network = await piazza.resolveClass(class_id);
      let items;
      if (filter === "unread") items = await piazza.filterFeed(network.id, { updated: 1 });
      else if (filter === "following") items = await piazza.filterFeed(network.id, { following: 1 });
      else if (filter === "all") items = await piazza.getFeed(network.id, { limit, offset });
      else {
        const feed = await piazza.getFeed(network.id, { limit: 500, offset: 0 });
        items = feed.filter(filter === "unanswered" ? isUnanswered : isPinned);
      }
      if (filter !== "all") items = paginate(items, offset, limit);
      const label = filter === "all" ? "Recent posts" : `${filter[0].toUpperCase()}${filter.slice(1)} posts`;
      return formatSummaries(items, `${label} in ${classLabel(network)}:`);
    }
  );

  tool(
    "get_folder_posts",
    {
      title: "Get folder posts",
      description:
        "List the posts in one folder (e.g. every post about hw3). Use list_folders first to get exact " +
        "folder names.",
      inputSchema: {
        folder: z.string().min(1).describe("Folder name, exactly as returned by list_folders."),
        class_id: classIdParam,
        limit: z.number().int().min(1).max(100).optional().describe("Max posts (default 30)."),
        offset: z.number().int().min(0).optional().describe("Skip this many posts, for paging."),
      },
      annotations: READ,
    },
    async ({ folder, class_id, limit = 30, offset = 0 }) => {
      const network = await piazza.resolveClass(class_id);
      const items = await piazza.filterFeed(network.id, { folder: 1, filter_folder: folder });
      return formatSummaries(
        paginate(items, offset, limit),
        `Posts in folder "${folder}" of ${classLabel(network)} (${items.length} total):`
      );
    }
  );

  // -------------------------------------------------------------------------
  // Write tools: every call needs the user's explicit approval through an MCP
  // elicitation prompt.
  // -------------------------------------------------------------------------

  async function confirmWithUser(message) {
    if (!server.server.getClientCapabilities()?.elicitation) {
      throw new Error(
        "Nothing was posted. Posting to Piazza requires the user to approve each post in a confirmation " +
          "prompt, and this MCP client doesn't support confirmation prompts (MCP elicitation)."
      );
    }
    const result = await server.server.elicitInput({
      message,
      requestedSchema: {
        type: "object",
        properties: {
          confirm: {
            type: "boolean",
            title: "Post this to Piazza",
            description: "Check this box and accept to publish. Your class will be able to see it.",
            default: false,
          },
        },
        required: ["confirm"],
      },
    });
    return result.action === "accept" && result.content?.confirm === true;
  }

  const anonymousParam = z
    .boolean()
    .optional()
    .describe("Post anonymously to classmates (instructors may still see the author). Default true; set false only if the user asks to post under their name.");

  tool(
    "create_post",
    {
      title: "Create post",
      description:
        "Publish a new question or note to a Piazza class. Only use this when the user explicitly asks " +
        "to post. The user must approve the exact post in a confirmation prompt before it is published. " +
        "Search first to avoid duplicating an existing post.",
      inputSchema: {
        class_id: classIdParam,
        type: z.enum(["question", "note"]).describe("question expects answers; note is an announcement/info post."),
        subject: z.string().min(1).max(200).describe("Post title."),
        content: z.string().min(1).describe("Post body as plain text. Blank lines separate paragraphs."),
        folders: z.array(z.string()).min(1).describe("Folders to file the post under (see list_folders)."),
        anonymous: anonymousParam,
      },
      annotations: WRITE,
    },
    async ({ class_id, type, subject, content, folders, anonymous = true }) => {
      const network = await piazza.resolveClass(class_id);

      // Map folder names to the class's real folders so the model can't invent any.
      const known = network.folders || [];
      const resolved = folders.map((f) => known.find((k) => k.toLowerCase() === f.toLowerCase().trim()));
      const unknown = folders.filter((_, i) => !resolved[i]);
      if (known.length && unknown.length) {
        throw new Error(`Unknown folder(s): ${unknown.join(", ")}. This class's folders are: ${known.join(", ")}`);
      }
      const finalFolders = known.length ? resolved : folders;

      const approved = await confirmWithUser(
        `Post a new ${type} to ${classLabel(network)}?\n\n` +
          `Subject: ${subject}\nFolders: ${finalFolders.join(", ")}\n` +
          `Posted as: ${anonymous ? "anonymous to classmates" : "you (your name is shown)"}\n\n${content}`
      );
      if (!approved) return "The user did not approve the post, so nothing was posted.";

      const created = await piazza.createPost(network.id, {
        type,
        subject,
        content: textToHtml(content),
        folders: finalFolders,
        anonymous,
      });
      return `Posted @${created?.nr ?? "?"} to ${classLabel(network)}: ${postUrl(network.id, created || {})}`;
    }
  );

  tool(
    "add_followup",
    {
      title: "Add follow-up",
      description:
        "Add a follow-up discussion comment to an existing Piazza post. Only use this when the user " +
        "explicitly asks. The user must approve the exact text in a confirmation prompt before it is published.",
      inputSchema: {
        post: postParam,
        content: z.string().min(1).describe("Follow-up text as plain text. Blank lines separate paragraphs."),
        class_id: classIdParam,
        anonymous: anonymousParam,
      },
      annotations: WRITE,
    },
    async ({ post, content, class_id, anonymous = true }) => {
      const network = await piazza.resolveClass(class_id);
      const target = await piazza.getPost(network.id, normalizePostRef(post));
      const subject = decodeEntities(target?.history?.[0]?.subject || "(no subject)");

      const approved = await confirmWithUser(
        `Add a follow-up to @${target.nr} "${subject}" in ${classLabel(network)}?\n\n` +
          `Posted as: ${anonymous ? "anonymous to classmates" : "you (your name is shown)"}\n\n${content}`
      );
      if (!approved) return "The user did not approve the follow-up, so nothing was posted.";

      await piazza.createFollowup(network.id, target.id, textToHtml(content), anonymous);
      return `Added a follow-up to @${target.nr}: ${postUrl(network.id, target)}`;
    }
  );
}
