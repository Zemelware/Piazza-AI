import { searchPosts, getPost } from "./piazzaService.js";
import { generateAnswer } from "./llmService.js";
import { decodeHtmlEntities } from "./utils.js";
import { getProvider } from "./providers.js";

const extensionApi = typeof browser !== "undefined" ? browser : chrome;
const DEFAULT_MAX_SEARCH_RESULTS = 10;

extensionApi.action.onClicked.addListener(() => {
  extensionApi.runtime.openOptionsPage();
});

extensionApi.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.type === "AI_SEARCH") {
    handleAiSearch(request.payload)
      .then(sendResponse)
      .catch((error) => sendResponse({ error: error.message }));
    return true; // Keep channel open for async response
  }

  if (request.type === "GET_MODEL_INFO") {
    const { providerId, modelId } = request.payload;
    const provider = getProvider(providerId);
    if (!provider) {
      sendResponse({ providerName: providerId, modelName: modelId });
      return;
    }
    const model = provider.models.find((m) => m.id === modelId);
    sendResponse({
      providerName: provider.name,
      modelName: model ? model.name : modelId,
    });
    return;
  }
});

async function handleAiSearch({ query, nid, maxSearchResults, modelOverride }) {
  const settings = await extensionApi.storage.local.get([
    "apiKeys",
    "model",
    "maxSearchResults",
    "provider",
    "includeFollowups",
  ]);

  if (nid) {
    try {
      const result = extensionApi.storage.local.set({ lastNid: nid });
      if (result && typeof result.then === "function") {
        result.catch(() => {});
      }
    } catch (_) {}
  }

  const requestedMaxSearchResults = Number(
    maxSearchResults || settings.maxSearchResults || DEFAULT_MAX_SEARCH_RESULTS
  );
  const clampedMaxSearchResults = Math.max(1, requestedMaxSearchResults);
  settings.maxSearchResults = clampedMaxSearchResults;

  // Default includeFollowups to false if not set
  if (settings.includeFollowups === undefined) {
    settings.includeFollowups = false;
  }

  // Apply model override if provided
  if (modelOverride && modelOverride.providerId && modelOverride.modelId) {
    settings.provider = modelOverride.providerId;
    settings.model = modelOverride.modelId;
  }

  // Define the search callback for the LLM
  const searchCallback = async (keywords) => {
    const searchResults = await searchPosts(keywords, nid);
    // If includeFollowups is enabled, we include posts even if they don't have a formal answer
    const filteredResults = searchResults.filter((item) => {
      if (!item) return false;
      if (settings.includeFollowups) return true;
      return item.no_answer === 0;
    });
    const limitedPostIds = filteredResults
      .map((item) => item.id)
      .filter(Boolean)
      .slice(0, clampedMaxSearchResults);

    if (limitedPostIds.length === 0) {
      return { posts: [], sources: [] };
    }

    const posts = await Promise.all(limitedPostIds.map((id) => getPost(id, nid)));

    console.log("Posts:");
    console.log(posts);

    const sources = posts.map((post) => ({
      id: post.id,
      subject: decodeHtmlEntities(post.history[0]?.subject || "Untitled"),
      url: `https://piazza.com/class/${nid}?cid=${post.id}`,
    }));

    return { posts, sources };
  };

  // Generate AI answer using tool calling
  const result = await generateAnswer(query, settings, searchCallback);

  return result;
}
