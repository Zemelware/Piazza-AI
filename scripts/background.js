import { searchPosts, getPost } from "./piazzaService.js";
import { generateAnswer } from "./llmService.js";

const extensionApi = typeof browser !== "undefined" ? browser : chrome;
const DEFAULT_TOPK = 10;

extensionApi.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.type === "AI_SEARCH") {
    handleAiSearch(request.payload)
      .then(sendResponse)
      .catch((error) => sendResponse({ error: error.message }));
    return true; // Keep channel open for async response
  }
});

async function handleAiSearch({ query, nid, topK }) {
  const settings = await extensionApi.storage.local.get([
    "apiKey",
    "model",
    "topK",
  ]);

  if (nid) {
    try {
      const result = extensionApi.storage.local.set({ lastNid: nid });
      if (result && typeof result.then === "function") {
        result.catch(() => {});
      }
    } catch (_) {}
  }

  const requestedTopK = Number(topK || settings.topK || DEFAULT_TOPK);
  const clampedTopK = Math.max(1, requestedTopK);
  settings.topK = clampedTopK;

  // Define the search callback for the LLM
  const searchCallback = async (keywords) => {
    const searchResults = await searchPosts(keywords, nid);
    // Don't include posts with no answers
    const answeredResults = searchResults.filter(
      (item) => item && item.no_answer === 0,
    );
    const limitedPostIds = answeredResults
      .map((item) => item.id)
      .filter(Boolean)
      .slice(0, clampedTopK);

    if (limitedPostIds.length === 0) {
      return { posts: [], sources: [] };
    }

    const posts = await Promise.all(limitedPostIds.map((id) => getPost(id, nid)));

    console.log("Posts:");
    console.log(posts);
    
    const sources = posts.map((post) => ({
      id: post.id,
      subject: post.history[0]?.subject || "Untitled",
      url: `https://piazza.com/class/${nid}?cid=${post.id}`,
    }));

    return { posts, sources };
  };

  // Generate AI answer using tool calling
  const result = await generateAnswer(query, settings, searchCallback);

  return result;
}
