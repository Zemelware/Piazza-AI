export function stripHtml(html) {
  if (!html) return "";
  // Simple regex-based HTML stripping for service worker
  let text = html.replace(/<[^>]+>/g, " ");
  // Basic entity decoding
  text = text
    .replace(/&nbsp;/g, " ")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
  return text.replace(/\s+/g, " ").trim();
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
  return history && history[0]
}

function getLatestHistoryText(history) {
  const latest = getLatestHistory(history);
  return latest ? stripHtml(latest.content) : "";
}

export function extractPostContent(post) {
  const parts = [];
  const latestPostHistory = getLatestHistory(post.history);
  const subject = latestPostHistory?.subject;
  const postDate = post.created || latestPostHistory?.created;

  parts.push(`<post${buildAttrs({ id: post.id, date: postDate, subject: subject })}>`);

  const questionText = getLatestHistoryText(post.history);
  if (questionText) {
    parts.push(
      `  <question${buildAttrs({ date: latestPostHistory?.created })}>${escapeXml(
        questionText
      )}</question>`
    );
  }

  const answers = [];
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

    // Code below adds follow-ups to post content (but it doesn't add replies to follow-ups)
    // if (child.type === "followup") {
    //   const followupText = getLatestHistoryText(child.history) || stripHtml(child.subject);
    //   if (followupText) {
    //     followups.push(
    //       `<followup${buildAttrs({
    //         date: lastUpdated,
    //       })}>${escapeXml(followupText)}</followup>`,
    //     );
    //   }
    //   continue;
    // }

    const responseText = getLatestHistoryText(child.history);
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
