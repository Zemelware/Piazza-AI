import { extractPostContent, truncateContext } from "./utils.js";

const TOOL_ROUND_LIMIT = 4;
const TOOL_CALLS_PER_ROUND_LIMIT = 5;

const XAI_CONFIG = {
  name: "xAI (Grok)",
  baseUrl: "https://api.x.ai",
  defaultModel: "grok-4-1-fast-non-reasoning",
};

function normalizeBaseUrl(url) {
  if (!url) return "";
  return url.replace(/\/+$/, "");
}

function buildChatCompletionsUrl() {
  const normalized = normalizeBaseUrl(XAI_CONFIG.baseUrl);
  const apiBase = normalized.endsWith("/v1") ? normalized : `${normalized}/v1`;
  return `${apiBase}/chat/completions`;
}

export async function generateAnswer(query, settings, searchCallback) {
  console.log(`asking model with query ${query}`);

  const config = XAI_CONFIG;
  const model = settings.model || config.defaultModel;
  const apiKey = settings.apiKey;
  const chatCompletionsUrl = buildChatCompletionsUrl();
  const searchResultLimit = settings.topK;

  if (!apiKey) throw new Error(`Missing API key for ${config.name}`);

  const tools = [
    {
      type: "function",
      function: {
        name: "search_piazza",
        description: `Search Piazza posts for information using keywords.
        Returns up to ${searchResultLimit} answered posts per call.
        Piazza is a Q&A platform where students can ask questions about their classes and instructors/students can provide answers`.trim(),
        parameters: {
          type: "object",
          properties: {
            keywords: {
              type: "string",
              description: "The keywords to search for.",
            },
          },
          required: ["keywords"],
        },
      },
    },
  ];

  let messages = [
    {
      role: "system",
      content:
        `You are a Piazza AI assistant. The user will ask a question/query and you must use the search_piazza tool to find relevant posts to answer the user's question/query.
        You can call the tool multiple times with different keywords if needed, but you have a limit of ${TOOL_ROUND_LIMIT} tool-call rounds and at most ${TOOL_CALLS_PER_ROUND_LIMIT} tool calls per round.
        - Prioritize the most recent, up-to-date posts when forming your answer.
        - Prefer using posts with instructor answers or instructor-endorsed answers if possible.
        - If only posts with student answers are available, use those, but indicate in your answer that the information came from a student.
        Once you have enough information, provide a concise and helpful answer. If you cannot find the answer, explain what is missing.`.trim(),
    },
    { role: "user", content: `Query:\n${query}` },
  ];

  const allSources = new Map();

  // Tool calling loop (bounded to prevent infinite loops)
  for (let i = 0; i < TOOL_ROUND_LIMIT; i++) {
    const response = await fetch(chatCompletionsUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: model,
        messages: messages,
        tools: tools,
        tool_choice: "auto",
        temperature: 0.2,
      }),
    });

    const data = await response.json();
    if (data.error) throw new Error(data.error.message || "AI request failed");

    const message = data.choices[0].message;
    messages.push(message);
    console.log(messages);

    if (!message.tool_calls || message.tool_calls.length === 0) {
      break;
    }

    const toolCalls = message.tool_calls.slice(0, TOOL_CALLS_PER_ROUND_LIMIT);
    for (const toolCall of toolCalls) {
      if (toolCall.function.name === "search_piazza") {
        const args = JSON.parse(toolCall.function.arguments);
        const { posts, sources } = await searchCallback(args.keywords);

        sources.forEach((s) => allSources.set(s.id, s));

        const contextBlocks = posts
          .map((post) => extractPostContent(post))
          .filter(Boolean);

        let context = contextBlocks.join("\n");
        context = truncateContext(context, 18000);

        messages.push({
          role: "tool",
          tool_call_id: toolCall.id,
          name: "search_piazza",
          content: context || "No matching posts found.",
        });
      }
    }
  }

  const finalAnswer = messages[messages.length - 1].content;
  console.log(`final answer: ${finalAnswer}`);

  if (!finalAnswer) throw new Error("AI request returned no text output.");

  return {
    answer: finalAnswer,
    sources: Array.from(allSources.values()),
    meta: {
      provider: config.name,
      model: model,
    },
  };
}
