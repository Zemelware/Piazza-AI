(function () {
  const extensionApi = typeof browser !== "undefined" ? browser : chrome;
  let aiSearchContainer = null;

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

  function injectAiExperience() {
    if (document.getElementById("piazza-ai-entry")) return;

    const searchBar = document.getElementById("feed_search_bar");
    const target = searchBar ? searchBar.parentElement : null;
    if (!target) return;

    const entry = document.createElement("div");
    entry.id = "piazza-ai-entry";
    entry.innerHTML = `
      <div class="piazza-ai-entry-body">
        <div class="piazza-ai-entry-eyebrow">Natural language</div>
        <div class="piazza-ai-entry-title">AI search for this class</div>
        <p class="piazza-ai-entry-copy">Describe what you need and get summarized answers with links back to Piazza.</p>
        <div class="piazza-ai-entry-actions">
          <button id="piazza-ai-launch" class="piazza-ai-primary">Open AI search</button>
          <div class="piazza-ai-entry-chips">
            <button type="button" class="piazza-ai-chip-button" data-value="Summarize the latest announcements for this class.">Announcements</button>
            <button type="button" class="piazza-ai-chip-button" data-value="What are the most common unresolved questions right now?">Unresolved</button>
            <button type="button" class="piazza-ai-chip-button" data-value="Explain the key takeaways from the most recent lectures.">Lecture recap</button>
          </div>
        </div>
      </div>
      <div class="piazza-ai-entry-visual">
        <div class="piazza-ai-blob"></div>
        <div class="piazza-ai-stars">
          <span>✦</span><span>✧</span><span>✦</span>
        </div>
      </div>
    `;

    searchBar.insertAdjacentElement("afterend", entry);

    const launchButton = entry.querySelector("#piazza-ai-launch");
    if (launchButton) {
      launchButton.addEventListener("click", () => openAiOverlay());
    }

    entry.querySelectorAll(".piazza-ai-chip-button").forEach((chip) => {
      chip.addEventListener("click", () => openAiOverlay(chip.dataset.value || ""));
    });
  }

  function openAiOverlay(presetQuery = "") {
    renderResultsOverlay();

    const input = document.getElementById("piazza-ai-query");
    if (input) {
      if (presetQuery) {
        input.value = presetQuery;
      }
      input.focus();
    }
  }

  async function performAiSearch(query) {
    renderResultsOverlay();
    const textArea = document.getElementById("piazza-ai-query");
    if (textArea) {
      textArea.value = query;
    }

    const preparedQuery = (query || "").trim();
    if (!preparedQuery) {
      setOverlayError("Please enter a natural language question for AI search.");
      return;
    }

    const nid = rememberCurrentNid();
    if (!nid) {
      alert("Could not determine class ID. Are you on a class page?");
      return;
    }

    const stored = await getStoredTopK();
    const parsedTopK = Number(stored.topK);
    const topK = parsedTopK > 0 ? parsedTopK : undefined;

    setOverlayStatus("Searching Piazza and generating AI answer...");

    sendExtensionMessage({
      type: "AI_SEARCH",
      payload: { query: preparedQuery, nid, topK },
    })
      .then((response) => {
        if (response && response.error) {
          setOverlayError(response.error);
        } else {
          displayResults(response);
        }
      })
      .catch((error) => {
        setOverlayError(error && error.message ? error.message : String(error));
      });
  }

  function renderResultsOverlay() {
    if (aiSearchContainer) return;

    aiSearchContainer = document.createElement("div");
    aiSearchContainer.id = "piazza-ai-results-overlay";
    aiSearchContainer.innerHTML = `
      <div class="piazza-ai-close-wrap">
        <button id="piazza-ai-close" aria-label="Close AI search overlay">&times;</button>
      </div>
      <div class="piazza-ai-hero">
        <div class="piazza-ai-badge">AI-powered</div>
        <h3>Ask in natural language</h3>
        <p>Research Piazza posts, announcements, and answers without keywords. We will cite the most relevant threads.</p>
      </div>
      <form id="piazza-ai-form" class="piazza-ai-form">
        <label class="sr-only" for="piazza-ai-query">AI search input</label>
        <div class="piazza-ai-input-shell">
          <textarea id="piazza-ai-query" rows="3" placeholder="Ask in natural language: What did I miss in last week's lecture?"></textarea>
          <div class="piazza-ai-form-actions">
            <span class="piazza-ai-hint">Shift + Enter for a new line</span>
            <div class="piazza-ai-action-buttons">
              <button type="button" id="piazza-ai-clear" class="piazza-ai-btn ghost">Clear</button>
              <button type="submit" class="piazza-ai-btn primary">Search with AI</button>
            </div>
          </div>
        </div>
      </form>
      <div class="piazza-ai-chip-row">
        <button type="button" class="piazza-ai-chip" data-value="Summarize the most important threads this week and include links.">Weekly digest</button>
        <button type="button" class="piazza-ai-chip" data-value="List unresolved questions about the current assignment.">Unresolved questions</button>
        <button type="button" class="piazza-ai-chip" data-value="Give me study notes based on the latest Piazza discussions.">Study notes</button>
      </div>
      <div class="piazza-ai-header">
        <div>
          <div class="piazza-ai-eyebrow">AI search results</div>
          <h3>We will include citations back to Piazza</h3>
        </div>
      </div>
      <div id="piazza-ai-content">
        <div class="piazza-ai-status">Ask a question to see AI-powered answers.</div>
      </div>
    `;
    document.body.appendChild(aiSearchContainer);

    const closeBtn = document.getElementById("piazza-ai-close");
    if (closeBtn) {
      closeBtn.onclick = () => {
        aiSearchContainer.remove();
        aiSearchContainer = null;
      };
    }

    const form = document.getElementById("piazza-ai-form");
    const input = document.getElementById("piazza-ai-query");
    const clear = document.getElementById("piazza-ai-clear");

    if (form && input) {
      form.addEventListener("submit", (event) => {
        event.preventDefault();
        performAiSearch(input.value);
      });
    }

    if (clear && input) {
      clear.addEventListener("click", () => {
        input.value = "";
        setOverlayStatus("Ask a question to see AI-powered answers.");
        input.focus();
      });
    }

    aiSearchContainer.querySelectorAll(".piazza-ai-chip").forEach((chip) => {
      chip.addEventListener("click", () => {
        if (input) {
          input.value = chip.dataset.value || "";
          input.focus();
        }
      });
    });
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

  function displayResults(data) {
    const content = document.getElementById("piazza-ai-content");
    if (!content) return;

    if (!data || !data.answer) {
      setOverlayError("No response received from the background worker.");
      return;
    }

    const sources = Array.isArray(data.sources) ? data.sources : [];
    let sourcesHtml = sources
      .map(
        (s) => `
      <li><a href="${s.url}" target="_blank">${s.subject}</a></li>
    `
      )
      .join("");

    const meta =
      data.meta && data.meta.provider && data.meta.model
        ? `<div class="piazza-ai-meta">Generated by ${data.meta.provider} (${data.meta.model})</div>`
        : "";

    content.innerHTML = `
      <div class="piazza-ai-answer">${String(data.answer).replace(/\n/g, "<br>")}</div>
      ${
        sources.length
          ? `
      <div class="piazza-ai-sources">
        <h4>Sources:</h4>
        <ul>${sourcesHtml}</ul>
      </div>`
          : ""
      }
      ${meta}
    `;
  }

  // Watch for DOM changes to inject the AI search entry point
  const observer = new MutationObserver(() => {
    injectAiExperience();
  });

  observer.observe(document.body, { childList: true, subtree: true });
  injectAiExperience();
  rememberCurrentNid();
})();
