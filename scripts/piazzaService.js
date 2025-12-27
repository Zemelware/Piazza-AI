const extensionApi = typeof browser !== "undefined" ? browser : chrome;

async function getCsrfToken() {
  const cookie = await extensionApi.cookies.get({
    url: "https://piazza.com",
    name: "session_id",
  });
  return cookie ? cookie.value : null;
}

function generateNonce() {
  const time = Date.now().toString(36);
  const random = Math.floor(Math.random() * 1679616).toString(36);
  return time + random;
}

async function piazzaRequest(method, params, nid) {
  const csrfToken = await getCsrfToken();
  if (!csrfToken) {
    throw new Error("Not logged in to Piazza. Please log in and reload the page.");
  }
  const aid = generateNonce();
  const endpoint = `https://piazza.com/logic/api?method=${method}&aid=${aid}`;

  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "CSRF-Token": csrfToken || "",
    },
    credentials: "include",
    body: JSON.stringify({
      method: method,
      params: { nid, ...params },
    }),
  });

  const data = await response.json();
  if (data.error) throw new Error(data.error);
  return data.result;
}

/**
 * Search for posts in a Piazza network.
 * @param {string} query - The search query.
 * @param {string} nid - The network ID.
 * @returns {Promise<Array>} - A list of post metadata from search results.
 */
export async function searchPosts(query, nid) {
  const result = await piazzaRequest("network.search", { query }, nid);
  const feedItems = Array.isArray(result) ? result : [];
  return feedItems;
}

/**
 * Get the full content of a Piazza post.
 * @param {string} cid - The content ID (post ID).
 * @param {string} nid - The network ID.
 * @returns {Promise<Object>} - The post content.
 */
export async function getPost(cid, nid) {
  return await piazzaRequest("content.get", { cid }, nid);
}
