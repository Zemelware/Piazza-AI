(function () {
  const extensionApi = typeof browser !== "undefined" ? browser : chrome;
  const templates = window.PiazzaAITemplates;
  let aiPanel = null;
  let aiBackdrop = null;
  let isSearching = false;
  let favouriteModels = [];
  let selectedModelOverride = null;

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

  function getStoredMaxSearchResults() {
    const result = extensionApi.storage.local.get(["maxSearchResults"]);
    if (result && typeof result.then === "function") {
      return result;
    }
    return new Promise((resolve) => extensionApi.storage.local.get(["maxSearchResults"], resolve));
  }

  function getStoredPanelWidth() {
    const result = extensionApi.storage.local.get(["panelWidth"]);
    if (result && typeof result.then === "function") {
      return result;
    }
    return new Promise((resolve) => extensionApi.storage.local.get(["panelWidth"], resolve));
  }

  function getStoredFavouriteModels() {
    const result = extensionApi.storage.local.get(["favouriteModels"]);
    if (result && typeof result.then === "function") {
      return result;
    }
    return new Promise((resolve) => extensionApi.storage.local.get(["favouriteModels"], resolve));
  }

  async function loadAndPopulateModelSelector() {
    const stored = await getStoredFavouriteModels();
    favouriteModels = stored.favouriteModels || [];
    
    const modelSelector = document.getElementById("piazza-ai-model-select");
    const modelSelectorWrapper = document.getElementById("piazza-ai-model-selector-wrapper");
    
    if (!modelSelector || !modelSelectorWrapper) return;
    
    if (favouriteModels.length === 0) {
      modelSelectorWrapper.classList.remove("visible");
      return;
    }
    
    modelSelectorWrapper.classList.add("visible");
    
    // Populate options
    modelSelector.innerHTML = '<option value="">Default model</option>' +
      favouriteModels
        .map((fav) => {
          const displayName = fav.modelName;
          const value = `${fav.providerId}:${fav.modelId}`;
          const escapedValue = escapeHtml(value);
          const escapedDisplayName = escapeHtml(displayName);
          return `<option value="${escapedValue}">${escapedDisplayName}</option>`;
        })
        .join("");
    
    // Add event listener
    modelSelector.addEventListener("change", () => {
      selectedModelOverride = modelSelector.value || null;
    });
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

    // Initialize Resizer
    initResizer();
    
    // Load and populate model selector
    loadAndPopulateModelSelector();

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

  function initResizer() {
    const handle = document.getElementById("piazza-ai-resize-handle");
    let isResizing = false;
    let startX, startWidth;

    // Load persisted width
    getStoredPanelWidth().then((result) => {
      if (result && result.panelWidth) {
        const width = result.panelWidth;
        aiPanel.style.width = `${width}px`;
        if (!aiPanel.classList.contains("open")) {
          aiPanel.style.right = `-${width + 20}px`;
        }
      }
    });

    handle.addEventListener("mousedown", (e) => {
      isResizing = true;
      startX = e.clientX;
      startWidth = parseInt(document.defaultView.getComputedStyle(aiPanel).width, 10);
      handle.classList.add("resizing");
      document.body.style.cursor = "ew-resize";
      document.body.style.userSelect = "none";

      // Disable transition during resize for smoothness
      aiPanel.style.transition = "none";
    });

    document.addEventListener("mousemove", (e) => {
      if (!isResizing) return;
      const width = startWidth + (startX - e.clientX);
      if (width > 320 && width < window.innerWidth * 0.9) {
        aiPanel.style.width = `${width}px`;
      }
    });

    document.addEventListener("mouseup", () => {
      if (isResizing) {
        isResizing = false;
        handle.classList.remove("resizing");
        document.body.style.cursor = "";
        document.body.style.userSelect = "";

        // Re-enable transition
        aiPanel.style.transition = "";

        // Persist width
        const finalWidth = parseInt(aiPanel.style.width, 10);
        extensionApi.storage.local.set({ panelWidth: finalWidth });
      }
    });
  }

  function openAiPanel() {
    aiPanel.classList.add("open");
    aiPanel.style.right = "0";
    aiBackdrop.classList.add("visible");
    document.getElementById("piazza-ai-fab").style.display = "none";

    // Focus input after animation
    setTimeout(() => {
      document.getElementById("piazza-ai-search-input").focus();
    }, 100);
  }

  function closeAiPanel() {
    aiPanel.classList.remove("open");
    const width = parseInt(aiPanel.style.width, 10) || 460;
    aiPanel.style.right = `-${width + 20}px`;
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

    const stored = await getStoredMaxSearchResults();
    const parsedMaxSearchResults = Number(stored.maxSearchResults);
    const maxSearchResults = parsedMaxSearchResults > 0 ? parsedMaxSearchResults : undefined;

    setSearching(true);
    showLoading();

    const payload = { query, nid, maxSearchResults };
    
    // Add model override if selected
    if (selectedModelOverride && selectedModelOverride.includes(":")) {
      const [providerId, modelId] = selectedModelOverride.split(":");
      if (providerId && modelId) {
        payload.modelOverride = { providerId, modelId };
      }
    }

    sendExtensionMessage({
      type: "AI_SEARCH",
      payload: payload,
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
