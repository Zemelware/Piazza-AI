import { BASE_URL } from "./config.js";

/** Piazza returned an error for a request (e.g. bad post ID). */
export class PiazzaError extends Error {}

/** The request was rejected because the session is missing or expired. */
export class AuthError extends Error {}

function nonce() {
  const time = Date.now().toString(36);
  const random = Math.floor(Math.random() * 1679616).toString(36);
  return time + random;
}

/**
 * Call a method on Piazza's internal JSON-RPC API
 * (the same endpoint the Piazza web app and the Chrome extension use).
 * @param {import("./cookies.js").CookieJar} jar
 * @param {string} method - e.g. "network.search", "content.get"
 * @param {object} params
 */
export async function rawRequest(jar, method, params = {}) {
  const response = await fetch(`${BASE_URL}/logic/api?method=${method}&aid=${nonce()}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "CSRF-Token": jar.get("session_id") || "",
      Cookie: jar.header(),
    },
    body: JSON.stringify({ method, params }),
    redirect: "manual",
  });
  jar.update(response);

  if (response.status === 401 || response.status === 403 || (response.status >= 300 && response.status < 400)) {
    throw new AuthError(`Piazza rejected the session (HTTP ${response.status}).`);
  }
  if (!response.ok) {
    throw new PiazzaError(`Piazza request ${method} failed (HTTP ${response.status}).`);
  }

  let data;
  try {
    data = await response.json();
  } catch {
    // Piazza serves an HTML page instead of JSON when the session is invalid.
    throw new AuthError("Piazza returned an unexpected response; the session may have expired.");
  }
  if (data.error) {
    const message = typeof data.error === "string" ? data.error : JSON.stringify(data.error);
    throw new PiazzaError(message);
  }
  return data.result;
}

/** Returns the user's status (profile + classes), or null if the session isn't logged in. */
export async function fetchUserStatus(jar) {
  try {
    const status = await rawRequest(jar, "user.status");
    return status && status.id ? status : null;
  } catch (error) {
    if (error instanceof AuthError || error instanceof PiazzaError) return null;
    throw error;
  }
}
