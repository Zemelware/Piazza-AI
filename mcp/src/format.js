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

// Tags used to structure a post. Post text is written by class members, so any
// of these tags appearing in it are neutralized to stop it faking structure
// (e.g. a follow-up pretending to be an instructor answer).
const POST_TAGS = [
  "piazza_post",
  "subject",
  "question",
  "note",
  "body",
  "instructor_answer",
  "student_answer",
  "followup",
  "reply",
];
const TAG_PATTERN = new RegExp(`<(\\/?(?:${POST_TAGS.join("|")})\\b)`, "gi");

function neutralize(text) {
  return text.replace(TAG_PATTERN, "‹$1");
}

function attrs(values) {
  return Object.entries(values)
    .filter(([, v]) => v !== undefined && v !== null && v !== "")
    .map(([k, v]) => ` ${k}="${String(v).replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;")}"`)
    .join("");
}

function element(tag, attributes, text) {
  const inner = neutralize(text);
  return inner.includes("\n")
    ? `<${tag}${attrs(attributes)}>\n${inner}\n</${tag}>`
    : `<${tag}${attrs(attributes)}>${inner}</${tag}>`;
}

/**
 * Format a post for the model: XML elements for structure (so the parts of a
 * post can't be confused or spoofed), markdown for the text inside them.
 * @param {"concise"|"full"} detail
 */
export function formatPost(post, network, { detail = "full" } = {}) {
  const limit = LIMITS[detail];
  const head = latest(post) || {};
  const children = post.children || [];
  const answers = children.filter((c) => (c.type === "i_answer" || c.type === "s_answer") && childText(c));
  const followups = children.filter((c) => c.type === "followup");

  const edited = head.created && formatDate(head.created) !== formatDate(post.created) ? formatDate(head.created) : "";
  const parts = [
    `<piazza_post${attrs({
      number: post.nr,
      url: postUrl(network.id, post),
      type: post.type,
      folders: post.folders?.join(", "),
      posted: formatDate(post.created),
      edited,
      private: post.status === "private" ? "true" : "",
      views: post.unique_views,
      marked_good: post.tag_good?.length || "",
      answered: post.type === "question" ? String(answers.length > 0) : "",
      detail: detail === "concise" ? "concise" : "",
    })}>`,
    element("subject", {}, decodeEntities(head.subject || "(no subject)")),
  ];

  const bodyTag = post.type === "question" || post.type === "note" ? post.type : "body";
  parts.push(element(bodyTag, {}, truncate(toMarkdown(head.content), limit.body) || "(no content)"));

  for (const type of ["i_answer", "s_answer"]) {
    const answer = answers.find((c) => c.type === type);
    if (!answer) continue;
    parts.push(
      element(
        type === "i_answer" ? "instructor_answer" : "student_answer",
        {
          endorsed: type === "s_answer" && isInstructorEndorsed(answer) ? "instructor" : "",
          updated: formatDate(latest(answer)?.created || answer.created),
        },
        truncate(childText(answer), limit.answer)
      )
    );
  }

  for (const followup of followups) {
    const replies = (followup.children || []).filter((r) => childText(r));
    const followupAttrs = {
      date: formatDate(followup.created),
      status: followup.no_answer === 1 ? "unresolved" : "resolved",
    };
    if (!limit.reply) {
      // Concise: the follow-up text only, with a count of hidden replies.
      followupAttrs.replies = replies.length || "";
      parts.push(element("followup", followupAttrs, truncate(childText(followup).replace(/\s+/g, " "), limit.followup)));
      continue;
    }
    const inner = [
      neutralize(truncate(childText(followup), limit.followup)),
      ...replies.map((r) =>
        element("reply", { date: formatDate(r.created) }, truncate(childText(r), limit.reply))
      ),
    ];
    parts.push(`<followup${attrs(followupAttrs)}>\n${inner.join("\n")}\n</followup>`);
  }

  parts.push("</piazza_post>");
  return parts.join("\n");
}

export function formatPostError(ref, message) {
  return `<piazza_post${attrs({ number: String(ref).replace(/^[@#]/, ""), error: message })} />`;
}
