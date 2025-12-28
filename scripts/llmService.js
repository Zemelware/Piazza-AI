import { extractPostContent, truncateContext } from "./utils.js";
import { getProvider, DEFAULT_PROVIDER } from "./providers.js";

const TOOL_ROUND_LIMIT = 4;
const TOOL_CALLS_PER_ROUND_LIMIT = 5;

/**
 * Normalize a base URL by removing trailing slashes.
 * @param {string} url - The URL to normalize
 * @returns {string} The normalized URL
 */
function normalizeBaseUrl(url) {
  if (!url) return "";
  return url.replace(/\/+$/, "");
}

// ============================================================================
// API Adapters - Handle different API formats
// ============================================================================

/**
 * Adapter for OpenAI-compatible Chat Completions API.
 */
const openaiChatAdapter = {
  buildUrl(provider) {
    const normalized = normalizeBaseUrl(provider.baseUrl);
    if (normalized.endsWith("/openai")) {
      return `${normalized}/chat/completions`;
    }
    const apiBase = normalized.endsWith("/v1") ? normalized : `${normalized}/v1`;
    return `${apiBase}/chat/completions`;
  },

  buildTools(searchResultLimit) {
    return [
      {
        type: "function",
        function: {
          name: "search_piazza",
          description: buildToolDescription(searchResultLimit),
          parameters: {
            type: "object",
            properties: {
              keywords: {
                type: "string",
                description: "The keywords or advanced search query to search for.",
              },
            },
            required: ["keywords"],
          },
        },
      },
    ];
  },

  buildInitialRequest(model, systemPrompt, query, tools) {
    return {
      model,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: `Query:\n${query}` },
      ],
      tools,
      tool_choice: "auto",
      temperature: 0.2,
    };
  },

  parseResponse(data) {
    if (data.error) {
      const msg =
        data.error.message || (typeof data.error === "string" ? data.error : "AI request failed");
      throw new Error(msg);
    }
    const message = data.choices[0].message;
    return {
      content: message.content,
      toolCalls: message.tool_calls || [],
      rawMessage: message,
    };
  },

  buildToolResult(toolCallId, toolName, content) {
    return {
      role: "tool",
      tool_call_id: toolCallId,
      name: toolName,
      content,
    };
  },

  appendAssistantMessage(request, rawMessage) {
    request.messages.push(rawMessage);
  },

  appendToolResult(request, toolResult) {
    request.messages.push(toolResult);
  },

  extractToolCallInfo(toolCall) {
    return {
      id: toolCall.id,
      name: toolCall.function.name,
      arguments: JSON.parse(toolCall.function.arguments),
    };
  },
};

/**
 * Adapter for OpenAI Responses API.
 */
const openaiResponsesAdapter = {
  buildUrl(provider) {
    const normalized = normalizeBaseUrl(provider.baseUrl);
    const apiBase = normalized.endsWith("/v1") ? normalized : `${normalized}/v1`;
    return `${apiBase}/responses`;
  },

  buildTools(searchResultLimit) {
    // Responses API uses internally-tagged function format
    return [
      {
        type: "function",
        name: "search_piazza",
        description: buildToolDescription(searchResultLimit),
        parameters: {
          type: "object",
          properties: {
            keywords: {
              type: "string",
              description: "The keywords or advanced search query to search for.",
            },
          },
          required: ["keywords"],
        },
      },
    ];
  },

  buildInitialRequest(model, systemPrompt, query, tools) {
    return {
      model,
      instructions: systemPrompt,
      input: `Query:\n${query}`,
      tools,
      tool_choice: "auto",
      temperature: 0.2,
      store: false, // Don't store responses
      // Track conversation state internally
      _inputItems: [],
      _previousResponseId: null,
    };
  },

  parseResponse(data) {
    if (data.error) {
      const msg =
        data.error.message || (typeof data.error === "string" ? data.error : "AI request failed");
      throw new Error(msg);
    }

    // Extract text content and tool calls from output items
    let content = null;
    const toolCalls = [];

    for (const item of data.output || []) {
      if (item.type === "message" && item.role === "assistant") {
        // Extract text from message content
        for (const part of item.content || []) {
          if (part.type === "output_text") {
            content = part.text;
          }
        }
      } else if (item.type === "function_call") {
        toolCalls.push(item);
      }
    }

    return {
      content,
      toolCalls,
      rawMessage: data,
      responseId: data.id,
    };
  },

  buildToolResult(toolCallId, toolName, content) {
    return {
      type: "function_call_output",
      call_id: toolCallId,
      output: content,
    };
  },

  appendAssistantMessage(request, rawMessage) {
    // For Responses API, we use previous_response_id to chain responses
    request._previousResponseId = rawMessage.id;
  },

  appendToolResult(request, toolResult) {
    request._inputItems.push(toolResult);
  },

  extractToolCallInfo(toolCall) {
    return {
      id: toolCall.call_id || toolCall.id,
      name: toolCall.name,
      arguments:
        typeof toolCall.arguments === "string"
          ? JSON.parse(toolCall.arguments)
          : toolCall.arguments,
    };
  },

  // Prepare the request body for the next API call
  prepareRequestBody(request) {
    const body = {
      model: request.model,
      temperature: request.temperature,
      tools: request.tools,
      tool_choice: request.tool_choice,
      store: request.store,
    };

    if (request._previousResponseId) {
      // Use previous response for context
      body.previous_response_id = request._previousResponseId;
      // Add any tool outputs as input items
      if (request._inputItems.length > 0) {
        body.input = request._inputItems;
        request._inputItems = []; // Clear after using
      }
    } else {
      // First request
      body.instructions = request.instructions;
      body.input = request.input;
    }

    return body;
  },
};

// Map API styles to their adapters
const adapters = {
  "openai-chat": openaiChatAdapter,
  "openai-responses": openaiResponsesAdapter,
};

/**
 * Get the adapter for a provider's API style.
 * @param {string} apiStyle - The API style identifier
 * @returns {object} The adapter object
 */
function getAdapter(apiStyle) {
  const adapter = adapters[apiStyle];
  if (!adapter) {
    throw new Error(`Unknown API style: ${apiStyle}. Falling back to openai-chat.`);
  }
  return adapter;
}

// ============================================================================
// Shared utilities
// ============================================================================

/**
 * Build the tool description for search_piazza.
 */
function buildToolDescription(searchResultLimit) {
  return `Search Piazza posts for information using keywords.
Returns up to ${searchResultLimit} answered posts per call.
Piazza is a Q&A platform where students can ask questions about their classes and instructors/students can provide answers.
Supports advanced search operators:
- Use spaces for AND (e.g., "office hours" matches both).
- Use | for OR (e.g., "office | hours" matches either).
- Use - for NOT (e.g., "office -hours" matches office but not hours).
- Use quotes for exact phrases (e.g., "office hours").
- Use parentheses () to group and chain operators (e.g., "(exam | quiz) date").
- Important: DO NOT use any other syntax when forming search queries.`.trim();
}

/**
 * Build the system prompt for the AI assistant.
 */
function buildSystemPrompt() {
  return `You are a Piazza AI assistant. The user will ask a question/query and you must use the search_piazza tool to find relevant posts to answer the user's question/query. Note, the user's query pertains to a specific class on Piazza.
You can call the tool multiple times with different keywords if needed, but you have a limit of ${TOOL_ROUND_LIMIT} tool-call rounds and at most ${TOOL_CALLS_PER_ROUND_LIMIT} tool calls per round.
- Prioritize the most recent, up-to-date posts when forming your answer.
- Prefer using posts with instructor answers or instructor-endorsed answers if possible.
- If only posts with student answers are available, use those, but indicate in your answer that the information came from a student.
- If you need to use math in your response, use LaTeX syntax.
  - Use $...$ for inline math (e.g., $E=mc^2$).
  - Use $$...$$ for block math on its own line.
  - Do not use other delimiters like \\( \\) or \\[ \\].
- You may also use markdown formatting.
- Cite every source you use in your answer using in-text citations with the format [source:N], where N is the source_number attribute from the <post> tags (e.g., [source:1], [source:2]). You may cite multiple sources together like [source:1][source:3].
Once you have enough information, provide a concise and helpful answer. If you cannot find the answer, explain what is missing.`.trim();
}

// ============================================================================
// Main export
// ============================================================================

/**
 * Helper to perform an AI request and handle common errors.
 */
async function performAiRequest(apiUrl, apiKey, requestBody, adapter, model, providerName) {
  let response;
  try {
    response = await fetch(apiUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify(requestBody),
    });
  } catch (e) {
    throw new Error(
      `Network error: Could not connect to ${providerName} API. Please check your internet connection and provider settings.`
    );
  }

  let data;
  try {
    data = await response.json();
  } catch (e) {
    if (!response.ok) {
      throw new Error(`AI request failed with status ${response.status}: ${response.statusText}`);
    }
    throw new Error(`Failed to parse AI response: ${response.status} ${response.statusText}`);
  }

  if (!response.ok) {
    // Try to find a descriptive error message in the response body
    const errorMsg =
      data.error?.message ||
      data.message ||
      (typeof data.error === "string" ? data.error : null) ||
      JSON.stringify(data);
    throw new Error(errorMsg);
  }

  return adapter.parseResponse(data);
}

export async function generateAnswer(query, settings, searchCallback) {
  console.log(`asking model with query ${query}`);

  const providerId = settings.provider || DEFAULT_PROVIDER;
  const provider = getProvider(providerId);
  const model =
    settings.model || (provider.models && provider.models.length > 0 ? provider.models[0].id : "");
  const apiKeys = settings.apiKeys || {};
  const apiKey = apiKeys[providerId];
  const searchResultLimit = settings.topK;
  const apiStyle = provider.apiStyle || "openai-chat";
  const adapter = getAdapter(apiStyle);

  if (!apiKey) throw new Error(`Missing API key for ${provider.name}`);
  if (!model) throw new Error(`No model selected for ${provider.name}`);
  const apiUrl = adapter.buildUrl(provider);
  const tools = adapter.buildTools(searchResultLimit);
  const systemPrompt = buildSystemPrompt();
  const request = adapter.buildInitialRequest(model, systemPrompt, query, tools);

  const allSources = new Map();

  // Tool calling loop (bounded to prevent infinite loops)
  for (let i = 0; i < TOOL_ROUND_LIMIT; i++) {
    // Prepare request body (some adapters need special handling)
    const requestBody = adapter.prepareRequestBody
      ? adapter.prepareRequestBody(request)
      : {
          model: request.model,
          messages: request.messages,
          tools: request.tools,
          tool_choice: request.tool_choice,
          temperature: request.temperature,
        };

    const parsed = await performAiRequest(
      apiUrl,
      apiKey,
      requestBody,
      adapter,
      model,
      provider.name
    );

    // Store assistant response for context
    adapter.appendAssistantMessage(request, parsed.rawMessage);

    // If no tool calls, we're done
    if (!parsed.toolCalls || parsed.toolCalls.length === 0) {
      break;
    }

    // Process tool calls
    const toolCalls = parsed.toolCalls.slice(0, TOOL_CALLS_PER_ROUND_LIMIT);
    for (const toolCall of toolCalls) {
      const { id, name, arguments: args } = adapter.extractToolCallInfo(toolCall);

      if (name === "search_piazza") {
        const { posts, sources } = await searchCallback(args.keywords);

        sources.forEach((s) => {
          if (!allSources.has(s.id)) {
            allSources.set(s.id, s);
          }
        });

        const sourceIds = Array.from(allSources.keys());
        const contextBlocks = posts
          .map((post) => {
            const sourceIndex = sourceIds.indexOf(post.id);
            const sourceNumber = sourceIndex !== -1 ? sourceIndex + 1 : undefined;
            return extractPostContent(post, sourceNumber);
          })
          .filter(Boolean);

        let context = contextBlocks.join("\n");
        context = truncateContext(context, 18000);

        const toolResult = adapter.buildToolResult(
          id,
          "search_piazza",
          context || "No matching posts found."
        );
        adapter.appendToolResult(request, toolResult);
      }
    }
  }

  // Get final answer - need to make one more call if we processed tool results
  // For chat completions, the answer is in the last message
  // For responses API, we may need to get it from the last response
  let finalAnswer;

  if (apiStyle === "openai-responses" && request._inputItems.length > 0) {
    // Need one more call to get the final answer after tool results
    const finalRequestBody = adapter.prepareRequestBody(request);
    const finalParsed = await performAiRequest(
      apiUrl,
      apiKey,
      finalRequestBody,
      adapter,
      model,
      provider.name
    );
    finalAnswer = finalParsed.content;
  } else if (apiStyle === "openai-chat") {
    finalAnswer = request.messages[request.messages.length - 1].content;
  } else {
    // For responses API when there were no tool calls
    finalAnswer = request._lastContent;
  }

  console.log(`final answer: ${finalAnswer}`);

  if (!finalAnswer) throw new Error("AI request returned no text output.");

  return {
    answer: finalAnswer,
    sources: Array.from(allSources.values()),
    meta: {
      provider: provider.name,
      model: model,
    },
  };
}
