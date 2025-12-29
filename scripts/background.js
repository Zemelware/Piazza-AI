import { searchPosts, getPost } from "./piazzaService.js";
import { generateAnswer } from "./llmService.js";
import { decodeHtmlEntities } from "./utils.js";

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
});

async function handleAiSearch({ query, nid, maxSearchResults }) {
  const settings = await extensionApi.storage.local.get([
    "apiKeys",
    "model",
    "maxSearchResults",
    "provider",
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

  // Define the search callback for the LLM
  const searchCallback = async (keywords) => {
    const searchResults = await searchPosts(keywords, nid);
    // Don't include posts with no answers
    const answeredResults = searchResults.filter((item) => item && item.no_answer === 0);
    const limitedPostIds = answeredResults
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
