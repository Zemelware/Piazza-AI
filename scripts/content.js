(function () {
  const extensionApi = typeof browser !== "undefined" ? browser : chrome;
  let aiSearchContainer = null;
  let aiQueryInput = null;
  let aiActionButton = null;
  let isSearching = false;

  function getCurrentNid() {
    const parts = window.location.pathname.split("/");
    return parts.length > 2 ? parts[2] : null;
  }

  function rememberCurrentNid() {
    const nid = getCurrentNid();
    if (nid) {
      try {
        const result = extensionApi.storage.local.set({ lastNid: nid });
        if (result && typeof result.then === "function") {
          result.catch(() => {});
        }
      } catch (_) {}
    }
    return nid;
  }

  function getStoredTopK() {
    const result = extensionApi.storage.local.get(["topK"]);
    if (result && typeof result.then === "function") {
      return result;
    }
    return new Promise((resolve) => extensionApi.storage.local.get(["topK"], resolve));
  }

  function sendExtensionMessage(message) {
    const result = extensionApi.runtime.sendMessage(message);
    if (result && typeof result.then === "function") {
      return result;
    }
    return new Promise((resolve) => extensionApi.runtime.sendMessage(message, resolve));
  }

  function injectAiSearch() {
    if (document.getElementById("piazza-ai-launcher")) return;

    const searchBar = document.getElementById("feed_search_bar");
    if (!searchBar) return;

    const btn = document.createElement("button");
    btn.id = "piazza-ai-launcher";
    btn.type = "button";
    btn.innerHTML = `<span class="piazza-ai-launcher-glow"></span><span class="piazza-ai-launcher-label">AI Search</span>`;

    btn.onclick = (e) => {
      e.preventDefault();
      openAiExperience();
    };

    searchBar.appendChild(btn);
  }

  async function performAiSearch(manualQuery) {
    if (isSearching) return;

    ensureAiExperience();

    const querySource = manualQuery !== undefined ? manualQuery : aiQueryInput?.value;
    const query = querySource ? querySource.trim() : "";

    if (!query) {
      setInlineStatus("Tell AI what you need in natural language.", "warn");
      if (aiQueryInput) {
        aiQueryInput.focus();
      }
      return;
    }

    const nid = rememberCurrentNid();
    if (!nid) {
      setOverlayError("Could not determine class ID. Are you on a class page?");
      setInlineStatus("Unable to read class context", "error");
      return;
    }

    const stored = await getStoredTopK();
    const parsedTopK = Number(stored.topK);
    const topK = parsedTopK > 0 ? parsedTopK : undefined;

    setLoading(true);
    setInlineStatus("Searching Piazza with AI...", "info");
    setOverlayStatus("Searching Piazza and generating AI answer...");

    sendExtensionMessage({
      type: "AI_SEARCH",
      payload: { query, nid, topK },
    })
      .then((response) => {
        if (response && response.error) {
          setOverlayError(response.error);
          setInlineStatus("Something went wrong", "error");
        } else {
          displayResults(response, query);
          setInlineStatus("Answer ready", "success");
        }
      })
      .catch((error) => {
        setOverlayError(error && error.message ? error.message : String(error));
        setInlineStatus("We hit a snag", "error");
      })
      .finally(() => {
        setLoading(false);
      });
  }

  function openAiExperience() {
    ensureAiExperience();
    if (aiQueryInput) aiQueryInput.focus();
  }

  function ensureAiExperience() {
    if (aiSearchContainer && document.body.contains(aiSearchContainer)) return;

    aiSearchContainer = document.createElement("div");
    aiSearchContainer.id = "piazza-ai-experience";
    aiSearchContainer.innerHTML = `
      <div class="piazza-ai-overlay" role="dialog" aria-modal="true">
        <div class="piazza-ai-surface">
          <div class="piazza-ai-surface-header">
            <div class="piazza-ai-identity">
              <div class="piazza-ai-orb"></div>
              <div>
                <p class="piazza-ai-kicker">Natural language search</p>
                <h3>AI answers for this class</h3>
                <p class="piazza-ai-subtitle">Ask questions in your own words and we will comb Piazza posts for you.</p>
              </div>
            </div>
            <button id="piazza-ai-close" class="piazza-ai-icon-btn" aria-label="Close AI search">&times;</button>
          </div>
          <div class="piazza-ai-grid">
            <div class="piazza-ai-column piazza-ai-column--input">
              <div class="piazza-ai-suggestion-grid">
                ${["Summarize today's lecture in two bullets", "Find debugging tips for the current assignment", "What concepts are students most confused about?", "Show threads that explain the latest exam rubric"]
                  .map((prompt) => `<button class="piazza-ai-suggestion" data-query="${prompt}">${prompt}</button>`)
                  .join("")}
              </div>
              <div class="piazza-ai-input-card">
                <label for="piazza-ai-query">Ask Piazza AI</label>
                <div class="piazza-ai-input-shell">
                  <textarea id="piazza-ai-query" rows="3" placeholder="Ask a full question, like 'Find posts where instructors clarified recursion base cases.'"></textarea>
                </div>
                <div class="piazza-ai-input-footer">
                  <span class="piazza-ai-hint">Press Enter to search · Shift+Enter for a new line</span>
                  <div class="piazza-ai-actions">
                    <span id="piazza-ai-inline-status" class="piazza-ai-chip" data-tone="muted">Ready</span>
                    <button id="piazza-ai-search-btn" class="piazza-ai-cta">Search with AI</button>
                  </div>
                </div>
              </div>
            </div>
            <div class="piazza-ai-column piazza-ai-column--results">
              <div class="piazza-ai-results-header">
                <div>
                  <p class="piazza-ai-label">AI Response</p>
                  <h4 id="piazza-ai-results-title">Start with a question</h4>
                </div>
                <div class="piazza-ai-meta-pill">Curated from Piazza</div>
              </div>
              <div id="piazza-ai-content" class="piazza-ai-results-body">
                <div class="piazza-ai-status">Begin with a natural language question to see AI-powered answers and sources.</div>
              </div>
            </div>
          </div>
        </div>
      </div>
    `;

    document.body.appendChild(aiSearchContainer);

    aiQueryInput = aiSearchContainer.querySelector("#piazza-ai-query");
    aiActionButton = aiSearchContainer.querySelector("#piazza-ai-search-btn");

    aiSearchContainer.querySelector("#piazza-ai-close").onclick = closeAiExperience;

    if (aiActionButton) {
      aiActionButton.onclick = () => performAiSearch();
    }

    if (aiQueryInput) {
      aiQueryInput.addEventListener("keydown", (e) => {
        if (e.key === "Enter" && !e.shiftKey) {
          e.preventDefault();
          performAiSearch();
        }
      });
    }

    aiSearchContainer.querySelectorAll(".piazza-ai-suggestion").forEach((btn) => {
      btn.addEventListener("click", () => {
        const query = btn.getAttribute("data-query") || "";
        if (aiQueryInput) {
          aiQueryInput.value = query;
        }
        performAiSearch(query);
      });
    });
  }

  function closeAiExperience() {
    if (aiSearchContainer) {
      aiSearchContainer.remove();
    }
    aiSearchContainer = null;
    aiQueryInput = null;
    aiActionButton = null;
    isSearching = false;
  }

  function setInlineStatus(message, tone) {
    const badge = document.getElementById("piazza-ai-inline-status");
    if (badge) {
      badge.textContent = message;
      badge.setAttribute("data-tone", tone || "muted");
    }
  }

  function setOverlayStatus(status) {
    const content = document.getElementById("piazza-ai-content");
    if (content) {
      content.innerHTML = `<div class="piazza-ai-status">${status}</div>`;
    }
  }

  function setOverlayError(error) {
    const content = document.getElementById("piazza-ai-content");
    if (content) {
      content.innerHTML = `<div class="piazza-ai-error">Error: ${error}</div>`;
    }
  }

  function displayResults(data, query) {
    const content = document.getElementById("piazza-ai-content");
    const title = document.getElementById("piazza-ai-results-title");

    if (!content) return;

    if (title && query) {
      title.textContent = `Answering: ${query}`;
    }

    if (!data || !data.answer) {
      setOverlayError("No response received from the background worker.");
      return;
    }

    const sources = Array.isArray(data.sources) ? data.sources : [];
    const sourcesHtml = sources
      .map(
        (s) => `
        <li>
          <a href="${s.url}" target="_blank" rel="noopener noreferrer">
            <span class="piazza-ai-source-subject">${s.subject}</span>
            <span class="piazza-ai-source-url">${s.url}</span>
          </a>
        </li>
      `
      )
      .join("");

    const meta =
      data.meta && data.meta.provider && data.meta.model
        ? `<div class="piazza-ai-meta">Generated by ${data.meta.provider} (${data.meta.model})</div>`
        : "";

    content.innerHTML = `
      <div class="piazza-ai-answer-card">
        <div class="piazza-ai-answer">${String(data.answer).replace(/\\n/g, "<br>")}</div>
        ${
          sources.length
            ? `<div class="piazza-ai-sources">
                <div class="piazza-ai-label">Sources</div>
                <ul>${sourcesHtml}</ul>
              </div>`
            : ""
        }
        ${meta}
      </div>
    `;
  }

  function setLoading(state) {
    isSearching = state;
    if (aiActionButton) {
      aiActionButton.disabled = state;
      aiActionButton.classList.toggle("is-loading", state);
      aiActionButton.textContent = state ? "Working..." : "Search with AI";
    }
  }

  // Watch for DOM changes to inject the button
  const observer = new MutationObserver(() => {
    injectAiSearch();
  });

  observer.observe(document.body, { childList: true, subtree: true });
  injectAiSearch();
  rememberCurrentNid();
})();
