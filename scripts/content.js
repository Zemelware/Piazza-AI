(function () {
  const extensionApi = typeof browser !== "undefined" ? browser : chrome;
  let aiSearchContainer = null;
  const assetPromises = {};

  const externalAssets = {
    marked: {
      type: "script",
      url: "https://cdn.jsdelivr.net/npm/marked@12.0.2/marked.min.js",
    },
    katex: {
      type: "script",
      url: "https://cdn.jsdelivr.net/npm/katex@0.16.11/dist/katex.min.js",
    },
    katexAutoRender: {
      type: "script",
      url: "https://cdn.jsdelivr.net/npm/katex@0.16.11/dist/contrib/auto-render.min.js",
    },
    katexStyles: {
      type: "style",
      url: "https://cdn.jsdelivr.net/npm/katex@0.16.11/dist/katex.min.css",
    },
  };

  function loadExternalAsset(key) {
    if (assetPromises[key]) return assetPromises[key];

    const asset = externalAssets[key];
    if (!asset) return Promise.reject(new Error(`Unknown asset: ${key}`));

    assetPromises[key] = new Promise((resolve, reject) => {
      let element;

      if (asset.type === "script") {
        element = document.createElement("script");
        element.src = asset.url;
        element.async = true;
      } else if (asset.type === "style") {
        element = document.createElement("link");
        element.rel = "stylesheet";
        element.href = asset.url;
      }

      if (!element) {
        reject(new Error(`Unsupported asset type: ${asset.type}`));
        return;
      }

      element.onload = () => resolve();
      element.onerror = () => reject(new Error(`Failed to load ${asset.url}`));

      (document.head || document.documentElement).appendChild(element);
    });

    return assetPromises[key];
  }

  async function ensureRenderersLoaded() {
    await Promise.all([
      loadExternalAsset("marked"),
      loadExternalAsset("katex"),
      loadExternalAsset("katexAutoRender"),
      loadExternalAsset("katexStyles"),
    ]);

    if (window.marked && !window.__piazzaAiMarkedInitialized) {
      window.marked.setOptions({
        gfm: true,
        breaks: true,
        mangle: false,
        headerIds: false,
      });
      window.__piazzaAiMarkedInitialized = true;
    }
  }

  async function renderMarkdownAnswer(answer) {
    try {
      await ensureRenderersLoaded();
      const html = window.marked ? window.marked.parse(answer) : answer;

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

  function injectAiSearch() {
    if (document.getElementById("piazza-ai-search-btn")) return;

    // Use the confirmed ID for the search bar container
    const searchBar = document.getElementById("feed_search_bar");
    if (!searchBar) return;

    const btn = document.createElement("button");
    btn.id = "piazza-ai-search-btn";
    btn.innerText = "AI Search";
    btn.className = "btn btn-primary btn-sm";
    btn.style.marginLeft = "10px";
    btn.style.verticalAlign = "middle";

    btn.onclick = (e) => {
      e.preventDefault();
      const input = searchBar.querySelector("input");
      const query = input ? input.value.trim() : "";

      if (query) {
        performAiSearch(query);
      } else {
        alert("Please enter a search query in the search bar first.");
      }
    };

    searchBar.appendChild(btn);
  }

  async function performAiSearch(query) {
    const nid = rememberCurrentNid();
    if (!nid) {
      alert("Could not determine class ID. Are you on a class page?");
      return;
    }

    const stored = await getStoredTopK();
    const parsedTopK = Number(stored.topK);
    const topK = parsedTopK > 0 ? parsedTopK : undefined;

    showResultsOverlay();
    setOverlayStatus("Searching Piazza and generating AI answer...");

    sendExtensionMessage({
      type: "AI_SEARCH",
      payload: { query, nid, topK },
    })
      .then(async (response) => {
        if (response && response.error) {
          setOverlayError(response.error);
        } else {
          await displayResults(response);
        }
      })
      .catch((error) => {
        setOverlayError(error && error.message ? error.message : String(error));
      });
  }

  function showResultsOverlay() {
    if (aiSearchContainer) aiSearchContainer.remove();

    aiSearchContainer = document.createElement("div");
    aiSearchContainer.id = "piazza-ai-results-overlay";
    aiSearchContainer.innerHTML = `
      <div class="piazza-ai-header">
        <h3>AI Search Results</h3>
        <button id="piazza-ai-close">&times;</button>
      </div>
      <div id="piazza-ai-content">
        <div class="piazza-ai-status"></div>
      </div>
    `;
    document.body.appendChild(aiSearchContainer);

    document.getElementById("piazza-ai-close").onclick = () => {
      aiSearchContainer.remove();
      aiSearchContainer = null;
    };
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

  async function displayResults(data) {
    const content = document.getElementById("piazza-ai-content");
    if (!content) return;

    if (!data || !data.answer) {
      setOverlayError("No response received from the background worker.");
      return;
    }

    const sources = Array.isArray(data.sources) ? data.sources : [];
    content.innerHTML = "";

    const answerElement = await renderMarkdownAnswer(String(data.answer));
    content.appendChild(answerElement);

    if (sources.length) {
      const sourcesContainer = document.createElement("div");
      sourcesContainer.className = "piazza-ai-sources";

      const heading = document.createElement("h4");
      heading.textContent = "Sources:";
      sourcesContainer.appendChild(heading);

      const list = document.createElement("ul");
      sources.forEach((source) => {
        const listItem = document.createElement("li");
        const link = document.createElement("a");
        link.href = source.url;
        link.target = "_blank";
        link.rel = "noopener noreferrer";
        link.textContent = source.subject;
        listItem.appendChild(link);
        list.appendChild(listItem);
      });

      sourcesContainer.appendChild(list);
      content.appendChild(sourcesContainer);
    }

    if (data.meta && data.meta.provider && data.meta.model) {
      const meta = document.createElement("div");
      meta.className = "piazza-ai-meta";
      meta.textContent = `Generated by ${data.meta.provider} (${data.meta.model})`;
      content.appendChild(meta);
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
