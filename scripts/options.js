import { getAllProviders, getProvider, DEFAULT_PROVIDER } from "./providers.js";

const extensionApi = typeof browser !== "undefined" ? browser : chrome;

const DEFAULT_SETTINGS = {
  provider: DEFAULT_PROVIDER,
  model: "",
  apiKeys: {}, // Store keys per provider: { xai: "...", google: "..." }
  maxSearchResults: 10,
  includeFollowups: false,
};

const CUSTOM_MODEL_VALUE = "__custom__";

const elements = {
  form: document.getElementById("options-form"),
  provider: document.getElementById("provider"),
  model: document.getElementById("model"),
  customModelRow: document.getElementById("customModelRow"),
  customModel: document.getElementById("customModel"),
  apiKey: document.getElementById("apiKey"),
  apiKeyLink: document.getElementById("apiKeyLink"),
  maxSearchResults: document.getElementById("maxSearchResults"),
  includeFollowups: document.getElementById("includeFollowups"),
  status: document.getElementById("status"),
};

// Keep track of current keys in memory to handle switching
let currentApiKeys = {};
let currentProvider = DEFAULT_PROVIDER;

function setStatus(message) {
  elements.status.textContent = message;
  if (!message) return;
  setTimeout(() => {
    elements.status.textContent = "";
  }, 2500);
}

function setCustomModelVisibility(visible) {
  elements.customModelRow.classList.toggle("hidden", !visible);
  elements.customModel.required = visible;
  if (!visible) {
    elements.customModel.value = "";
  }
}

/**
 * Populate the provider dropdown with available providers.
 */
function populateProviders() {
  const providers = getAllProviders();
  elements.provider.innerHTML = providers
    .map((p) => `<option value="${p.id}">${p.name}</option>`)
    .join("");
}

/**
 * Update the model dropdown based on the selected provider.
 * @param {string} providerId - The selected provider ID
 * @param {string} currentModel - The currently selected model (to preserve selection if valid)
 */
function updateModelOptions(providerId, currentModel = "") {
  const provider = getProvider(providerId);

  // Build model options
  const modelOptions = provider.models
    .map((m) => `<option value="${m.id}">${m.name}</option>`)
    .join("");
  elements.model.innerHTML = `${modelOptions}<option value="${CUSTOM_MODEL_VALUE}">Custom model...</option>`;

  // Restore selection if the model exists in the new provider's list
  const modelExists = provider.models.some((m) => m.id === currentModel);
  if (modelExists) {
    elements.model.value = currentModel;
    setCustomModelVisibility(false);
  } else if (currentModel) {
    elements.model.value = CUSTOM_MODEL_VALUE;
    elements.customModel.value = currentModel;
    setCustomModelVisibility(true);
  } else if (provider.models.length > 0) {
    // Default to the first model if no valid model is selected
    elements.model.value = provider.models[0].id;
    setCustomModelVisibility(false);
  } else {
    elements.model.value = CUSTOM_MODEL_VALUE;
    setCustomModelVisibility(true);
  }

  // Update API key placeholder and link
  elements.apiKey.placeholder = provider.apiKeyPlaceholder;
  elements.apiKeyLink.href = provider.apiKeyLink;

  // Load the key for this provider if it exists
  elements.apiKey.value = currentApiKeys[providerId] || "";
}

async function loadSettings() {
  const stored = await extensionApi.storage.local.get(Object.keys(DEFAULT_SETTINGS));
  const settings = { ...DEFAULT_SETTINGS, ...stored };

  currentApiKeys = settings.apiKeys || {};
  currentProvider = settings.provider;

  populateProviders();
  elements.provider.value = settings.provider;
  updateModelOptions(settings.provider, settings.model);
  elements.maxSearchResults.value = settings.maxSearchResults;
  elements.includeFollowups.checked = settings.includeFollowups;
}

// Handle provider change
elements.provider.addEventListener("change", () => {
  // Save current key to memory before switching
  currentApiKeys[currentProvider] = elements.apiKey.value.trim();

  currentProvider = elements.provider.value;
  updateModelOptions(currentProvider);
});

elements.model.addEventListener("change", () => {
  const isCustom = elements.model.value === CUSTOM_MODEL_VALUE;
  setCustomModelVisibility(isCustom);
});

elements.form.addEventListener("submit", async (event) => {
  event.preventDefault();

  // Update current provider's key in memory
  currentApiKeys[currentProvider] = elements.apiKey.value.trim();

  const selectedModel =
    elements.model.value === CUSTOM_MODEL_VALUE
      ? elements.customModel.value.trim()
      : elements.model.value;

  const settings = {
    provider: elements.provider.value,
    model: selectedModel,
    apiKeys: currentApiKeys,
    maxSearchResults: Number(elements.maxSearchResults.value || DEFAULT_SETTINGS.maxSearchResults),
    includeFollowups: elements.includeFollowups.checked,
  };

  await extensionApi.storage.local.set(settings);
  setStatus("Saved.");
});

loadSettings().catch(() => {
  setStatus("Unable to load settings.");
});
