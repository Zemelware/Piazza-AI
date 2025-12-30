export function decodeHtmlEntities(text) {
  if (!text) return "";
  return text
    .replace(/&nbsp;/g, " ")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);?/g, (match, dec) => String.fromCharCode(dec))
    .replace(/&#x([0-9a-f]+);?/gi, (match, hex) => String.fromCharCode(parseInt(hex, 16)));
}

export function stripHtml(html) {
  if (!html) return "";
  // Simple regex-based HTML stripping for service worker
  let text = html.replace(/<[^>]+>/g, " ");
  // Basic entity decoding
  return decodeHtmlEntities(text).replace(/\s+/g, " ").trim();
}

function escapeXml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function buildAttrs(attrs) {
  return Object.entries(attrs)
    .filter(([, value]) => value)
    .map(([key, value]) => ` ${key}="${escapeXml(value)}"`)
    .join("");
}

function getLatestHistory(history) {
  return history && history[0];
}

function getLatestHistoryText(history) {
  const latest = getLatestHistory(history);
  return latest ? stripHtml(latest.content) : "";
}

export function extractPostContent(post, sourceNumber, options = {}) {
  const parts = [];
  const latestPostHistory = getLatestHistory(post.history);
  const subject = decodeHtmlEntities(latestPostHistory?.subject);
  const postDate = post.created || latestPostHistory?.created;

  const attrs = { id: post.id, date: postDate, subject: subject };
  if (sourceNumber !== undefined) {
    attrs.source_number = sourceNumber;
  }
  parts.push(`<post${buildAttrs(attrs)}>`);

  const questionText = getLatestHistoryText(post.history);
  if (questionText) {
    parts.push(
      `  <question${buildAttrs({ date: latestPostHistory?.created })}>${escapeXml(
        questionText
      )}</question>`
    );
  }

  const answers = [];
  const followups = [];
  const responses = [];

  for (const child of post.children || []) {
    const lastUpdated = getLatestHistory(child.history)?.created || child.created;
    if (child.type === "i_answer" || child.type === "s_answer") {
      const answerType = child.type === "i_answer" ? "instructor" : "student";
      const isEndorsed =
        child.type === "s_answer" &&
        Array.isArray(child.tag_endorse) &&
        child.tag_endorse.some((endorser) => endorser?.role === "instructor");
      const answerText = getLatestHistoryText(child.history);
      if (answerText) {
        answers.push(
          `<answer${buildAttrs({
            type: answerType,
            date: lastUpdated,
            instructorEndorsed: isEndorsed ? "true" : "",
          })}>${escapeXml(answerText)}</answer>`
        );
      }
      continue;
    }

    if (child.type === "followup") {
      if (options.includeFollowups) {
        const followupText = getLatestHistoryText(child.history) || stripHtml(child.subject);
        if (followupText) {
          let followupXml = `    <followup${buildAttrs({
            date: lastUpdated,
          })}>\n      <content>${escapeXml(followupText)}</content>`;

          const replies = [];
          for (const replyChild of child.children || []) {
            if (replyChild.type === "feedback") {
              const replyText =
                getLatestHistoryText(replyChild.history) || stripHtml(replyChild.subject);
              if (replyText) {
                const replyDate =
                  getLatestHistory(replyChild.history)?.created || replyChild.created;
                replies.push(
                  `      <reply${buildAttrs({ date: replyDate })}>${escapeXml(replyText)}</reply>`
                );
              }
            }
          }

          if (replies.length > 0) {
            followupXml += "\n" + replies.join("\n");
          }
          followupXml += "\n    </followup>";
          followups.push(followupXml);
        }
      }
      continue;
    }

    const responseText = getLatestHistoryText(child.history) || stripHtml(child.subject);
    if (responseText) {
      responses.push(
        `<response${buildAttrs({
          type: child.type,
          date: lastUpdated,
        })}>${escapeXml(responseText)}</response>`
      );
    }
  }

  answers.forEach((answer) => parts.push(`  ${answer}`));

  if (followups.length > 0) {
    parts.push("  <followups>");
    followups.forEach((f) => parts.push(f));
    parts.push("  </followups>");
  }

  if (responses.length) {
    parts.push("  <responses>");
    responses.forEach((response) => parts.push(`    ${response}`));
    parts.push("  </responses>");
  }

  parts.push("</post>");

  return parts.join("\n").trim();
}

export function truncateContext(text, maxChars) {
  if (text.length <= maxChars) return text;
  return text.substring(0, maxChars - 3).trim() + "...";
}
