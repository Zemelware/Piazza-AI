const extensionApi = typeof browser !== "undefined" ? browser : chrome;

const DEFAULT_SETTINGS = {
  model: "",
  apiKey: "",
  maxSearchResults: 10,
  lastNid: "",
};

const elements = {
  status: document.getElementById("status"),
  answerPanel: document.getElementById("answer"),
  answerText: document.getElementById("answer-text"),
  sourcesPanel: document.getElementById("sources"),
  sourcesList: document.getElementById("sources-list"),
  settingsBtn: document.getElementById("open-settings"),
};

function setStatus(message, isError = false) {
  elements.status.textContent = message;
  elements.status.style.color = isError ? "#9b1c1c" : "#6a4a00";
}

function clearResults() {
  elements.answerPanel.classList.add("hidden");
  elements.sourcesPanel.classList.add("hidden");
  elements.answerText.textContent = "";
  elements.sourcesList.textContent = "";
}

function renderSources(sources) {
  elements.sourcesList.textContent = "";
  sources.forEach((source) => {
    const link = document.createElement("a");
    link.href = source.url || "#";
    link.target = "_blank";
    link.rel = "noreferrer";
    link.textContent = `Post ${source.id}: ${source.subject}`;
    elements.sourcesList.appendChild(link);
  });
}

function sendExtensionMessage(message) {
  const result = extensionApi.runtime.sendMessage(message);
  if (result && typeof result.then === "function") {
    return result;
  }
  return new Promise((resolve) => extensionApi.runtime.sendMessage(message, resolve));
}

async function loadSettings() {
  const stored = await extensionApi.storage.local.get(Object.keys(DEFAULT_SETTINGS));
  const settings = { ...DEFAULT_SETTINGS, ...stored };
  return settings;
}

elements.settingsBtn.addEventListener("click", () => {
  const result = extensionApi.runtime.openOptionsPage();
  if (result && typeof result.then === "function") {
    result.catch(() => {});
  }
});
