import TurndownService from "turndown";
import { BASE_URL } from "./config.js";

const turndown = new TurndownService({ headingStyle: "atx", codeBlockStyle: "fenced", bulletListMarker: "-" });
// Output goes to an LLM, not a markdown renderer: don't backslash-escape
// characters, which would mangle LaTeX ($x_1$) and code.
turndown.escape = (text) => text;

export function decodeEntities(text) {
  if (!text) return "";
  return String(text)
    .replace(/&nbsp;/g, " ")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&#(\d+);?/g, (_, dec) => String.fromCodePoint(Number(dec)))
    .replace(/&#x([0-9a-f]+);?/gi, (_, hex) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&amp;/g, "&");
}

function absolutizeUrls(html) {
  return html.replace(/\b(src|href)=(["'])\/(?!\/)/gi, `$1=$2${BASE_URL}/`);
}

/** Convert Piazza post content (HTML, `<md>` markdown, or plain text) to markdown. */
export function toMarkdown(content) {
  if (!content) return "";
  const text = String(content).trim();
  // Posts written in Piazza's markdown editor are wrapped in <md>...</md>.
  const md = text.match(/^<md>([\s\S]*)<\/md>$/i);
  if (md) return decodeEntities(md[1]).trim();
  if (!/<[a-z][\s\S]*>/i.test(text)) return decodeEntities(text);
  return turndown.turndown(absolutizeUrls(text)).trim();
}

/** One-line plain-text preview. */
export function snippet(content, maxLength = 160) {
  const text = decodeEntities(String(content || "").replace(/<[^>]+>/g, " "))
    .replace(/\s+/g, " ")
    .trim();
  return text.length > maxLength ? `${text.slice(0, maxLength).trimEnd()}…` : text;
}

export function formatDate(value, { time = false } = {}) {
  if (!value) return "";
  const date = typeof value === "number" ? new Date(value < 1e12 ? value * 1000 : value) : new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  const iso = date.toISOString();
  return time ? `${iso.slice(0, 16).replace("T", " ")} UTC` : iso.slice(0, 10);
}

export function postUrl(nid, post) {
  return `${BASE_URL}/class/${nid}?cid=${post.nr ?? post.id}`;
}

const latest = (item) => (Array.isArray(item?.history) ? item.history[0] : undefined);

// ---------------------------------------------------------------------------
// Feed / search results
// ---------------------------------------------------------------------------

export function answerStatus(item) {
  if (item.type === "note") return "note";
  if (item.type === "poll") return "poll";
  if (item.has_i && item.has_s) return "instructor + student answers";
  if (item.has_i) return "instructor answer";
  if (item.has_s) return "student answer";
  if (item.no_answer === 0) return "answered";
  return "unanswered";
}

export function isUnanswered(item) {
  if (item.type !== "question") return false;
  if (item.has_i || item.has_s) return false;
  return item.no_answer !== 0;
}

export function isPinned(item) {
  return item.pin === 1 || item.pin === true;
}

export function formatSummary(item) {
  const ref = item.nr !== undefined ? `@${item.nr}` : item.id;
  const subject = decodeEntities(item.subject || latest(item)?.subject || "(no subject)");
  const details = [answerStatus(item)];
  if (isPinned(item)) details.push("pinned");
  if (item.no_answer_followup > 0) {
    details.push(`${item.no_answer_followup} unresolved follow-up${item.no_answer_followup === 1 ? "" : "s"}`);
  }
  if (item.folders?.length) details.push(`folders: ${item.folders.join(", ")}`);
  const date = formatDate(item.modified || item.updated || item.created);
  if (date) details.push(`updated ${date}`);

  const preview = snippet(item.content_snipet ?? item.content_snippet ?? item.snippet ?? latest(item)?.content);
  return `- **${ref}** ${subject} (${details.join(" · ")})${preview ? `\n  ${preview}` : ""}`;
}

export function formatSummaries(items, heading, footer = "") {
  if (!items.length) return `${heading}\n\nNo posts found.${footer ? `\n\n${footer}` : ""}`;
  return [
    heading,
    "",
    items.map(formatSummary).join("\n"),
    "",
    footer || 'Read posts with piazza_read_posts (e.g. posts: ["@12", "@15"]).',
  ].join("\n");
}

// ---------------------------------------------------------------------------
// Full post
// ---------------------------------------------------------------------------

// Character caps per section. "concise" is for skimming several posts;
// "full" still caps pathological posts so one call can't flood the context.
const LIMITS = {
  concise: { body: 700, answer: 900, followup: 250, reply: 0 },
  full: { body: 6000, answer: 6000, followup: 1500, reply: 800 },
};

function truncate(text, max) {
  if (text.length <= max) return text;
  return `${text.slice(0, max).trimEnd()} […truncated]`;
}

function isInstructorEndorsed(child) {
  return (
    Array.isArray(child.tag_endorse) &&
    child.tag_endorse.some((e) => e?.role === "instructor" || e?.role === "professor" || e?.role === "ta")
  );
}

function childText(child) {
  // Answers keep their text in history; follow-ups and replies keep it in subject.
  return toMarkdown(latest(child)?.content || child.subject || "");
}

/**
 * Format a post for the model. The post is wrapped in <piazza_post> tags so
 * class-member-written text is clearly delimited from instructions.
 * @param {"concise"|"full"} detail
 */
export function formatPost(post, network, { detail = "full" } = {}) {
  const limit = LIMITS[detail];
  const head = latest(post) || {};
  const subject = decodeEntities(head.subject || "(no subject)");
  const url = postUrl(network.id, post);
  const lines = [`<piazza_post number="${post.nr ?? ""}" url="${url}">`, `# @${post.nr ?? "?"}: ${subject}`, ""];

  const meta = [];
  if (post.type) meta.push(post.type);
  if (post.folders?.length) meta.push(`folders: ${post.folders.join(", ")}`);
  if (post.created) meta.push(`posted ${formatDate(post.created)}`);
  if (head.created && formatDate(head.created) !== formatDate(post.created)) meta.push(`edited ${formatDate(head.created)}`);
  if (post.status === "private") meta.push("private");
  if (post.unique_views) meta.push(`${post.unique_views} views`);
  if (post.tag_good?.length) meta.push(`marked good by ${post.tag_good.length}`);
  if (meta.length) lines.push(meta.join(" · "), "");
  lines.push(truncate(toMarkdown(head.content), limit.body) || "(no content)");

  const children = post.children || [];

  for (const [type, label] of [
    ["i_answer", "Instructor answer"],
    ["s_answer", "Student answer"],
  ]) {
    const answer = children.find((c) => c.type === type);
    const text = answer && childText(answer);
    if (!text) continue;
    const notes = [];
    if (type === "s_answer" && isInstructorEndorsed(answer)) notes.push("endorsed by an instructor");
    const updated = latest(answer)?.created || answer.created;
    if (updated) notes.push(`updated ${formatDate(updated)}`);
    lines.push("", `## ${label}${notes.length ? ` (${notes.join(", ")})` : ""}`, "", truncate(text, limit.answer));
  }
  if (post.type === "question" && !children.some((c) => c.type === "i_answer" || c.type === "s_answer")) {
    lines.push("", "_No answers yet._");
  }

  const followups = children.filter((c) => c.type === "followup");
  if (followups.length) {
    lines.push("", `## Follow-up discussion (${followups.length})`);
    if (!limit.reply) lines.push("");
    followups.forEach((followup, i) => {
      const state = followup.no_answer === 1 ? "unresolved" : "resolved";
      const replies = (followup.children || []).map(childText).filter(Boolean);
      const header = `${i + 1}. (${formatDate(followup.created)}, ${state})`;
      if (!limit.reply) {
        const count = replies.length ? ` [${replies.length} repl${replies.length === 1 ? "y" : "ies"}]` : "";
        lines.push(`${header} ${truncate(childText(followup).replace(/\s+/g, " "), limit.followup)}${count}`);
        return;
      }
      lines.push("", `${header} ${truncate(childText(followup), limit.followup).replace(/\n+/g, "\n   ")}`);
      (followup.children || []).forEach((reply) => {
        const text = childText(reply);
        if (text) {
          lines.push(`   - Reply (${formatDate(reply.created)}): ${truncate(text, limit.reply).replace(/\n+/g, "\n     ")}`);
        }
      });
    });
    if (!limit.reply) lines.push("", '_Follow-ups shortened. Use detail: "full" to read them and their replies._');
  }

  // Stop post text from faking the end of the <piazza_post> block.
  const body = lines.slice(1).join("\n").replace(/<(\/?piazza_post)/gi, "‹$1");
  return `${lines[0]}\n${body}\n</piazza_post>`;
}
