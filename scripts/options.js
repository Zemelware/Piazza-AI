const extensionApi = typeof browser !== "undefined" ? browser : chrome;

const DEFAULT_SETTINGS = {
  model: "",
  apiKey: "",
  topK: 10,
};

const DEFAULT_MODEL = "grok-4-1-fast-non-reasoning";

const elements = {
  form: document.getElementById("options-form"),
  model: document.getElementById("model"),
  apiKey: document.getElementById("apiKey"),
  topK: document.getElementById("topK"),
  status: document.getElementById("status"),
};

function setStatus(message) {
  elements.status.textContent = message;
  if (!message) return;
  setTimeout(() => {
    elements.status.textContent = "";
  }, 2500);
}

async function loadSettings() {
  const stored = await extensionApi.storage.local.get(Object.keys(DEFAULT_SETTINGS));
  const settings = { ...DEFAULT_SETTINGS, ...stored };
  elements.model.value = settings.model;
  elements.apiKey.value = settings.apiKey;
  elements.topK.value = settings.topK;
  elements.model.placeholder = `Default: ${DEFAULT_MODEL}`;
}

elements.form.addEventListener("submit", async (event) => {
  event.preventDefault();
  const settings = {
    model: elements.model.value.trim(),
    apiKey: elements.apiKey.value.trim(),
    topK: Number(elements.topK.value || DEFAULT_SETTINGS.topK),
  };

  await extensionApi.storage.local.set(settings);
  await extensionApi.storage.local.remove(["provider", "baseUrl", "maxContextChars"]);
  setStatus("Saved.");
});

loadSettings().catch(() => {
  setStatus("Unable to load settings.");
});
