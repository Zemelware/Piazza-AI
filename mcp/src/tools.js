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
    "Class ID from piazza_list_classes, or a course number like \"CS 101\". " +
      "Optional if the user has only one active class or set a default class."
  );

// A plain string (not string|number) keeps the schema portable across clients.
const postParam = z.string().min(1).describe('Post number (e.g. "@123" or "123") or the post\'s internal ID.');

function normalizePostRef(post) {
  const ref = String(post).trim().replace(/^[@#]/, "");
  return /^\d+$/.test(ref) ? Number(ref) : ref;
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
    "piazza_login",
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
    "piazza_list_classes",
    {
      title: "List Piazza classes",
      description:
        "List the user's Piazza classes with their IDs and folder names. Use the ID or course number as " +
        "class_id in other tools. Pick the class from context when it's clear; ask the user if it's " +
        "ambiguous. Folder names tell you how the class organizes posts (e.g. hw1, exam, logistics).",
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
        const folders = c.folders?.length ? `\n  folders: ${c.folders.join(", ")}` : "";
        return `- **${classLabel(c)}** (${details.join(" · ")})${folders}`;
      });
      return `Piazza classes:\n\n${lines.join("\n")}`;
    }
  );

  tool(
    "piazza_get_class_info",
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

  // -------------------------------------------------------------------------
  // Posts
  // -------------------------------------------------------------------------

  tool(
    "piazza_find_posts",
    {
      title: "Find Piazza posts",
      description:
        "Find posts in a class. Returns one-line summaries (post number, title, answer status, folders, " +
        "snippet); read the ones that look relevant with piazza_read_posts.\n\n" +
        "Combine any of:\n" +
        "- query: keyword search. Piazza matches keywords, not meaning, so use 1-3 distinctive words " +
        "(\"late policy\", \"recursion\") and retry with synonyms if nothing matches.\n" +
        "- folder: only posts in this folder (folder names are listed by piazza_list_classes; " +
        "\"assignment 1\" might be \"hw1\"). Often better than a query for everything about one assignment.\n" +
        "- filter: unread (new activity since the user last looked), following, unanswered (questions " +
        "with no answer), pinned (usually important logistics).\n" +
        "With none of these, returns the most recently updated posts.",
      inputSchema: {
        class_id: classIdParam,
        query: z.string().optional().describe("Search keywords."),
        folder: z.string().optional().describe("Folder name."),
        filter: z.enum(["unread", "following", "unanswered", "pinned"]).optional(),
        limit: z.number().int().min(1).max(50).optional().describe("Max posts to return (default 20)."),
        offset: z.number().int().min(0).optional().describe("Skip this many matching posts, for paging."),
      },
      annotations: READ,
    },
    async ({ class_id, query, folder, filter, limit = 20, offset = 0 }) => {
      const network = await piazza.resolveClass(class_id);
      query = query?.trim();

      let folderName;
      if (folder) {
        const known = network.folders || [];
        folderName = known.find((f) => f.toLowerCase() === folder.trim().toLowerCase());
        if (!folderName && known.length) {
          throw new Error(`No folder named "${folder}" in ${classLabel(network)}. Its folders are: ${known.join(", ")}`);
        }
        folderName ??= folder.trim();
      }

      // Start from the narrowest server-side list, then apply the rest client-side.
      let items;
      if (query) items = await piazza.search(network.id, query);
      else if (folderName) items = await piazza.filterFeed(network.id, { folder: 1, filter_folder: folderName });
      else if (filter === "unread") items = await piazza.filterFeed(network.id, { updated: 1 });
      else if (filter === "following") items = await piazza.filterFeed(network.id, { following: 1 });
      // Plain "recent posts" only fetches one past this page, so the total is unknown.
      else items = await piazza.getFeed(network.id, { limit: filter ? 500 : offset + limit + 1, offset: 0 });
      const totalKnown = Boolean(query || folderName || filter);

      if (query && folderName) {
        items = items.filter((p) => (p.folders || []).includes(folderName));
      }
      if (filter === "unanswered") items = items.filter(isUnanswered);
      if (filter === "pinned") items = items.filter(isPinned);
      if ((filter === "unread" || filter === "following") && (query || folderName)) {
        const ids = new Set(
          (await piazza.filterFeed(network.id, filter === "unread" ? { updated: 1 } : { following: 1 })).map((p) => p.id)
        );
        items = items.filter((p) => ids.has(p.id));
      }

      const criteria = [
        query && `matching "${query}"`,
        folderName && `in folder ${folderName}`,
        filter,
      ].filter(Boolean);
      const page = items.slice(offset, offset + limit);
      const total = totalKnown ? ` of ${items.length}` : "";
      const range = page.length ? ` (showing ${offset + 1}-${offset + page.length}${total})` : "";
      const heading = `${criteria.length ? `Posts ${criteria.join(", ")}` : "Recent posts"} in ${classLabel(network)}${range}:`;
      const more =
        offset + limit < items.length ? `More results: call again with offset: ${offset + limit}. ` : "";
      return formatSummaries(page, heading, `${more}Read posts with piazza_read_posts (e.g. posts: ["@12", "@15"]).`);
    }
  );

  tool(
    "piazza_read_posts",
    {
      title: "Read Piazza posts",
      description:
        "Read one or more posts in full: the question or note, the instructor and student answers, and " +
        "the follow-up discussion. Pass every post you want in one call. Cite the post URL when " +
        "answering from a post. Instructor answers and instructor-endorsed student answers are the most " +
        "reliable; unendorsed student answers may be wrong.",
      inputSchema: {
        posts: z
          .array(z.string().min(1))
          .min(1)
          .max(10)
          .describe('Post numbers like "@12" or "12" (or internal post IDs). Up to 10.'),
        class_id: classIdParam,
        detail: z
          .enum(["concise", "full"])
          .optional()
          .describe(
            "full (default): everything, including follow-up replies. concise: shortened body and answers, " +
              "one line per follow-up; use it to skim many posts."
          ),
      },
      annotations: READ,
    },
    async ({ posts, class_id, detail = "full" }) => {
      const network = await piazza.resolveClass(class_id);
      const refs = [...new Set(posts.map((p) => p.trim()))];
      const results = await Promise.all(
        refs.map(async (ref) => {
          try {
            return formatPost(await piazza.getPost(network.id, normalizePostRef(ref)), network, { detail });
          } catch (error) {
            return `<piazza_post number="${ref.replace(/^[@#]/, "")}">\nCouldn't load post ${ref}: ${error.message}\n</piazza_post>`;
          }
        })
      );

      // Keep the whole response comfortably under client tool-output limits.
      const MAX_CHARS = 60_000;
      const out = [];
      let size = 0;
      for (const [i, text] of results.entries()) {
        if (size + text.length > MAX_CHARS && out.length) {
          out.push(
            `Output limit reached; not shown: ${refs.slice(i).join(", ")}. ` +
              'Request them in another call, or use detail: "concise".'
          );
          break;
        }
        out.push(text);
        size += text.length;
      }
      return out.join("\n\n");
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
    "piazza_create_post",
    {
      title: "Create post",
      description:
        "Publish a new question or note to a Piazza class. Only use this when the user explicitly asks " +
        "to post. The user must approve the exact post in a confirmation prompt before it is published. " +
        "Check piazza_find_posts first to avoid duplicating an existing post.",
      inputSchema: {
        class_id: classIdParam,
        type: z.enum(["question", "note"]).describe("question expects answers; note is an announcement/info post."),
        subject: z.string().min(1).max(200).describe("Post title."),
        content: z.string().min(1).describe("Post body as plain text. Blank lines separate paragraphs."),
        folders: z.array(z.string()).min(1).describe("Folders to file the post under, from piazza_list_classes."),
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
    "piazza_add_followup",
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
