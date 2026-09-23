import { BASE_URL, DEFAULT_CLASS, EMAIL, LOGIN_WAIT_MS, PASSWORD, log } from "./config.js";
import { AuthError, PiazzaError, fetchUserStatus, rawRequest } from "./api.js";
import { browserLogin, clearSession, loadSession, passwordLogin, saveSession } from "./auth.js";

/** Login is still in progress (the user hasn't finished in the browser yet). */
export class LoginPendingError extends Error {}

const STATUS_MAX_AGE_MS = 5 * 60_000;

export const isActiveClass = (network) => !network.status || network.status === "active";

export class PiazzaClient {
  jar = null;
  loginPromise = null;
  savedCookies = "";
  status = null;
  statusFetchedAt = 0;

  // -------------------------------------------------------------------------
  // Session management
  // -------------------------------------------------------------------------

  async ensureSession() {
    if (this.jar) return this.jar;
    this.jar = loadSession();
    if (this.jar) {
      this.savedCookies = this.jar.header();
      return this.jar;
    }
    return this.login();
  }

  /**
   * Start a login (or join the one already running) and wait up to
   * LOGIN_WAIT_MS for it. The login keeps running in the background if the
   * user needs longer, so the next tool call picks it up.
   */
  async login({ force = false } = {}) {
    if (force) this.resetSession();

    if (!this.loginPromise) {
      const attempt = EMAIL && PASSWORD ? passwordLogin(EMAIL, PASSWORD) : browserLogin();
      this.loginPromise = attempt
        .then((jar) => {
          this.jar = jar;
          this.status = null;
          this.persist(jar);
          return jar;
        })
        .finally(() => {
          this.loginPromise = null;
        });
      // Nobody may be waiting on this if the tool call below times out.
      this.loginPromise.catch((error) => log(`Login failed: ${error.message}`));
    }

    let timer;
    const timeout = new Promise((_, reject) => {
      timer = setTimeout(
        () =>
          reject(
            new LoginPendingError(
              "A browser window opened so you can log in to Piazza. Finish logging in there, then try again."
            )
          ),
        LOGIN_WAIT_MS
      );
    });
    try {
      return await Promise.race([this.loginPromise, timeout]);
    } finally {
      clearTimeout(timer);
    }
  }

  resetSession() {
    this.jar = null;
    this.status = null;
    this.savedCookies = "";
    clearSession();
  }

  persist(jar) {
    const cookies = jar.header();
    if (cookies !== this.savedCookies) {
      saveSession(jar);
      this.savedCookies = cookies;
    }
  }

  /** Call a Piazza API method, logging in again once if the session expired. */
  async request(method, params = {}) {
    const jar = await this.ensureSession();
    try {
      const result = await rawRequest(jar, method, params);
      this.persist(jar);
      return result;
    } catch (error) {
      if (!(error instanceof AuthError || error instanceof PiazzaError)) throw error;
      // A PiazzaError with a working session is a real error (e.g. bad post ID).
      if (error instanceof PiazzaError && (await fetchUserStatus(jar))) throw error;

      log("Piazza session expired; logging in again");
      this.resetSession();
      const fresh = await this.login();
      return rawRequest(fresh, method, params);
    }
  }

  // -------------------------------------------------------------------------
  // User & classes
  // -------------------------------------------------------------------------

  async getStatus({ refresh = false } = {}) {
    if (!refresh && this.status && Date.now() - this.statusFetchedAt < STATUS_MAX_AGE_MS) {
      return this.status;
    }
    let status = await this.request("user.status");
    if (!status?.id) {
      this.resetSession();
      await this.login();
      status = await this.request("user.status");
    }
    this.status = status;
    this.statusFetchedAt = Date.now();
    return status;
  }

  async getClasses() {
    return (await this.getStatus()).networks || [];
  }

  /**
   * Find a class by network ID or course number/name (e.g. "CS 101").
   * Falls back to PIAZZA_CLASS_ID, then to the user's only active class.
   */
  async resolveClass(classId) {
    const classes = await this.getClasses();
    const wanted = (classId || DEFAULT_CLASS || "").trim();
    const describe = (list) =>
      list.map((c) => `${c.course_number || c.name} (${c.term || "?"}): ${c.id}`).join("; ");

    if (wanted) {
      const byId = classes.find((c) => c.id === wanted);
      if (byId) return byId;

      const normalize = (value) => String(value || "").toLowerCase().replace(/[\s_-]/g, "");
      const matches = classes.filter((c) =>
        [c.course_number, c.name, c.short_number].some((v) => v && normalize(v) === normalize(wanted))
      );
      const activeMatches = matches.filter(isActiveClass);
      if (matches.length === 1) return matches[0];
      if (activeMatches.length === 1) return activeMatches[0];
      if (matches.length > 1) {
        throw new Error(`"${wanted}" matches several classes. Pass one of these IDs as class_id: ${describe(matches)}`);
      }
      throw new Error(`No class matches "${wanted}". Call list_classes to see your classes and their IDs.`);
    }

    const active = classes.filter(isActiveClass);
    if (active.length === 1) return active[0];
    if (active.length === 0) throw new Error("You don't have any active Piazza classes.");
    throw new Error(`Specify class_id. Your active classes are: ${describe(active)}`);
  }

  // -------------------------------------------------------------------------
  // Posts & feed
  // -------------------------------------------------------------------------

  async search(nid, query) {
    const result = await this.request("network.search", { nid, query });
    return Array.isArray(result) ? result : [];
  }

  /** @param {string|number} cid - Post ID or post number */
  async getPost(nid, cid) {
    return this.request("content.get", { nid, cid, student_view: null });
  }

  async getFeed(nid, { limit = 100, offset = 0 } = {}) {
    const result = await this.request("network.get_my_feed", { nid, limit, offset, sort: "updated" });
    return result?.feed || [];
  }

  /** @param {object} filter - one of {updated: 1}, {following: 1}, {folder: 1, filter_folder} */
  async filterFeed(nid, filter) {
    const result = await this.request("network.filter_feed", { nid, sort: "updated", ...filter });
    return result?.feed || [];
  }

  async createPost(nid, { type, subject, content, folders, anonymous }) {
    return this.request("content.create", {
      nid,
      type,
      subject,
      content,
      folders,
      anonymous: anonymous ? "yes" : "no",
      config: { bypass_email: 0, is_announcement: 0 },
    });
  }

  async createFollowup(nid, cid, content, anonymous) {
    return this.request("content.create", {
      nid,
      cid,
      type: "followup",
      // Piazza stores follow-up text in the subject field.
      subject: content,
      content: "",
      anonymous: anonymous ? "yes" : "no",
      config: { editor: "rte", ionly: false },
    });
  }

  // -------------------------------------------------------------------------
  // Course page resources (best effort: not part of the JSON API)
  // -------------------------------------------------------------------------

  courseUrl(network) {
    if (!network.school_ext || !network.term || !network.short_number) return null;
    const term = network.term.toLowerCase().replace(/\s+/g, "");
    return `${BASE_URL}/${network.school_ext}/${term}/${network.short_number}/home`;
  }

  async getResources(network) {
    const url = this.courseUrl(network);
    if (!url) return null;
    try {
      const jar = await this.ensureSession();
      const response = await fetch(url, { headers: { Cookie: jar.header() } });
      if (!response.ok) return null;
      const match = (await response.text()).match(/resource_data\s*=\s*(\[[\s\S]*?\]);\s*\n/);
      return match ? JSON.parse(match[1]) : null;
    } catch {
      return null;
    }
  }
}
