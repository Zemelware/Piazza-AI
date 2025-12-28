(function () {
  const extensionApi = typeof browser !== "undefined" ? browser : chrome;
  const templates = window.PiazzaAITemplates;
  let aiPanel = null;
  let aiBackdrop = null;
  let isSearching = false;

  function ensureRenderersLoaded() {
    if (window.marked && !window.__piazzaAiMarkedInitialized) {
      window.marked.setOptions({
        gfm: true,
      });
      window.__piazzaAiMarkedInitialized = true;
    }
    return Promise.resolve();
  }

  async function renderMarkdownAnswer(answer) {
    try {
      await ensureRenderersLoaded();
      let html = window.marked ? window.marked.parse(answer) : answer;

      // Replace [source:N] citations with clickable links
      html = html.replace(/\[source:(\d+)\]/g, (match, number) => {
        return `<a href="#piazza-ai-source-${number}" class="piazza-ai-citation">${number}</a>`;
      });

      const wrapper = document.createElement("div");
      wrapper.className = "piazza-ai-answer";
      wrapper.innerHTML = html;

      if (window.renderMathInElement) {
        window.renderMathInElement(wrapper, {
          delimiters: [
            { left: "$$", right: "$$", display: true },
            { left: "$", right: "$", display: false },
            { left: "\\(", right: "\\)", display: false },
            { left: "\\[", right: "\\]", display: true },
          ],
          throwOnError: false,
        });
      }

      return wrapper;
    } catch (error) {
      console.error("Failed to render markdown:", error);
      const fallback = document.createElement("div");
      fallback.className = "piazza-ai-answer";
      fallback.innerHTML = String(answer).replace(/\n/g, "<br>");
      return fallback;
    }
  }

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

  function injectAiSearchFAB() {
    if (document.getElementById("piazza-ai-fab")) return;

    // Create backdrop
    aiBackdrop = document.createElement("div");
    aiBackdrop.id = "piazza-ai-backdrop";
    document.body.appendChild(aiBackdrop);

    // Create FAB (Floating Action Button)
    const fab = document.createElement("button");
    fab.id = "piazza-ai-fab";
    fab.innerHTML = templates.fab();
    fab.onclick = () => openAiPanel();
    document.body.appendChild(fab);

    // Create Panel
    aiPanel = document.createElement("div");
    aiPanel.id = "piazza-ai-panel";
    aiPanel.innerHTML = templates.panel(templates.emptyState());
    document.body.appendChild(aiPanel);

    // Event Listeners
    document.getElementById("piazza-ai-panel-close").onclick = closeAiPanel;
    aiBackdrop.onclick = closeAiPanel;

    document.getElementById("piazza-ai-search-form").onsubmit = (e) => {
      e.preventDefault();
      const input = document.getElementById("piazza-ai-search-input");
      const query = input.value.trim();
      if (query && !isSearching) {
        performAiSearch(query);
      }
    };

    // Keyboard shortcut: Cmd/Ctrl + K
    document.addEventListener("keydown", (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        if (aiPanel.classList.contains("open")) {
          closeAiPanel();
        } else {
          openAiPanel();
        }
      }
      // Escape to close
      if (e.key === "Escape" && aiPanel.classList.contains("open")) {
        closeAiPanel();
      }
    });
  }

  function openAiPanel() {
    aiPanel.classList.add("open");
    aiBackdrop.classList.add("visible");
    document.getElementById("piazza-ai-fab").style.display = "none";

    // Focus input after animation
    setTimeout(() => {
      document.getElementById("piazza-ai-search-input").focus();
    }, 100);
  }

  function closeAiPanel() {
    aiPanel.classList.remove("open");
    aiBackdrop.classList.remove("visible");
    document.getElementById("piazza-ai-fab").style.display = "flex";
  }

  function setSearching(searching) {
    isSearching = searching;
    const submitBtn = document.getElementById("piazza-ai-search-submit");
    const input = document.getElementById("piazza-ai-search-input");
    if (submitBtn) {
      submitBtn.disabled = searching;
      submitBtn.textContent = searching ? "Searching..." : "Search";
    }
    if (input) {
      input.disabled = searching;
    }
  }

  async function performAiSearch(query) {
    const nid = rememberCurrentNid();
    if (!nid) {
      showError("Could not determine class ID. Are you on a class page?");
      return;
    }

    const stored = await getStoredTopK();
    const parsedTopK = Number(stored.topK);
    const topK = parsedTopK > 0 ? parsedTopK : undefined;

    setSearching(true);
    showLoading();

    sendExtensionMessage({
      type: "AI_SEARCH",
      payload: { query, nid, topK },
    })
      .then(async (response) => {
        setSearching(false);
        if (response && response.error) {
          showError(response.error);
        } else {
          await displayResults(response);
        }
      })
      .catch((error) => {
        setSearching(false);
        showError(error && error.message ? error.message : String(error));
      });
  }

  function showLoading() {
    const body = document.getElementById("piazza-ai-panel-body");
    if (body) {
      body.innerHTML = templates.loading();
    }
  }

  function showError(error) {
    const body = document.getElementById("piazza-ai-panel-body");
    if (body) {
      body.innerHTML = templates.error(error);
    }
  }

  async function displayResults(data) {
    const body = document.getElementById("piazza-ai-panel-body");
    if (!body) return;

    if (!data || !data.answer) {
      showError("No response received from the background worker.");
      return;
    }

    const sources = Array.isArray(data.sources) ? data.sources : [];

    // Build results HTML
    const resultsContainer = document.createElement("div");
    resultsContainer.className = "piazza-ai-results";

    // Answer section
    const answerSection = document.createElement("div");
    answerSection.className = "piazza-ai-answer-section";
    answerSection.innerHTML = templates.answerLabel();

    const answerElement = await renderMarkdownAnswer(String(data.answer));
    answerSection.appendChild(answerElement);
    resultsContainer.appendChild(answerSection);

    // Sources section
    if (sources.length) {
      const sourcesSection = document.createElement("div");
      sourcesSection.className = "piazza-ai-sources-section";
      sourcesSection.innerHTML = templates.sources(sources, escapeHtml);
      resultsContainer.appendChild(sourcesSection);
    }

    // Meta section
    if (data.meta && data.meta.provider && data.meta.model) {
      const meta = document.createElement("div");
      meta.className = "piazza-ai-meta";
      meta.innerHTML = templates.meta(data.meta.provider, data.meta.model);
      resultsContainer.appendChild(meta);
    }

    body.innerHTML = "";
    body.appendChild(resultsContainer);
  }

  function escapeHtml(text) {
    const div = document.createElement("div");
    div.textContent = text;
    return div.innerHTML;
  }

  // Watch for DOM changes to inject the FAB
  const observer = new MutationObserver(() => {
    injectAiSearchFAB();
  });

  observer.observe(document.body, { childList: true, subtree: true });
  injectAiSearchFAB();
  rememberCurrentNid();
})();
