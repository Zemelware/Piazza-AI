import { getAllProviders, getProvider, DEFAULT_PROVIDER } from "./providers.js";

const extensionApi = typeof browser !== "undefined" ? browser : chrome;

const DEFAULT_SETTINGS = {
  provider: DEFAULT_PROVIDER,
  model: "",
  apiKeys: {}, // Store keys per provider: { xai: "...", google: "..." }
  maxSearchResults: 10,
  includeFollowups: false,
  favouriteModels: [], // Array of { providerId, modelId, providerName, modelName }
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
  favouriteModelBtn: document.getElementById("favouriteModelBtn"),
  favouriteModelsSection: document.getElementById("favouriteModelsSection"),
  favouriteModelsList: document.getElementById("favouriteModelsList"),
};

// Keep track of current keys in memory to handle switching
let currentApiKeys = {};
let currentProvider = DEFAULT_PROVIDER;
let favouriteModels = [];

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
 * Check if the current model is favourited.
 */
function isCurrentModelFavourited() {
  const providerId = elements.provider.value;
  const modelId =
    elements.model.value === CUSTOM_MODEL_VALUE
      ? elements.customModel.value.trim()
      : elements.model.value;

  return favouriteModels.some(
    (fav) => fav.providerId === providerId && fav.modelId === modelId
  );
}

/**
 * Update the favourite button state based on current selection.
 */
function updateFavouriteButtonState() {
  const isFavourited = isCurrentModelFavourited();
  elements.favouriteModelBtn.classList.toggle("active", isFavourited);
  elements.favouriteModelBtn.title = isFavourited
    ? "Remove from favourites"
    : "Add to favourites";
}

/**
 * Toggle favourite status for the current model.
 */
function toggleFavouriteModel() {
  const providerId = elements.provider.value;
  const modelId =
    elements.model.value === CUSTOM_MODEL_VALUE
      ? elements.customModel.value.trim()
      : elements.model.value;

  if (!modelId) {
    setStatus("Please select a model first.");
    return;
  }

  const provider = getProvider(providerId);
  const existingIndex = favouriteModels.findIndex(
    (fav) => fav.providerId === providerId && fav.modelId === modelId
  );

  if (existingIndex >= 0) {
    // Remove from favourites
    favouriteModels.splice(existingIndex, 1);
  } else {
    // Add to favourites
    const modelInfo =
      elements.model.value === CUSTOM_MODEL_VALUE
        ? { id: modelId, name: modelId }
        : provider.models.find((m) => m.id === modelId) || {
            id: modelId,
            name: modelId,
          };

    favouriteModels.push({
      providerId: providerId,
      modelId: modelId,
      providerName: provider.name,
      modelName: modelInfo.name,
    });
  }

  updateFavouriteButtonState();
  renderFavouriteModels();
  saveFavouriteModels();
}

/**
 * Render the list of favourite models.
 */
function renderFavouriteModels() {
  if (favouriteModels.length === 0) {
    elements.favouriteModelsSection.classList.add("hidden");
    return;
  }

  elements.favouriteModelsSection.classList.remove("hidden");
  elements.favouriteModelsList.innerHTML = favouriteModels
    .map(
      (fav, index) => `
      <div class="favourite-model-item">
        <div class="favourite-model-info">
          <div class="favourite-model-name">${escapeHtml(fav.modelName)}</div>
          <div class="favourite-model-provider">${escapeHtml(fav.providerName)}</div>
        </div>
        <button type="button" class="favourite-model-remove" data-index="${index}" title="Remove from favourites">
          <svg viewBox="0 0 24 24" fill="none">
            <path d="M18 6L6 18M6 6l12 12" stroke-linecap="round" stroke-linejoin="round"/>
          </svg>
        </button>
      </div>
    `
    )
    .join("");

  // Add event listeners to remove buttons
  elements.favouriteModelsList.querySelectorAll(".favourite-model-remove").forEach((btn) => {
    btn.addEventListener("click", () => {
      const index = parseInt(btn.dataset.index);
      favouriteModels.splice(index, 1);
      renderFavouriteModels();
      updateFavouriteButtonState();
      saveFavouriteModels();
    });
  });
}

/**
 * Save favourite models to storage.
 */
async function saveFavouriteModels() {
  await extensionApi.storage.local.set({ favouriteModels });
}

/**
 * Escape HTML to prevent XSS.
 */
function escapeHtml(text) {
  const div = document.createElement("div");
  div.textContent = text;
  return div.innerHTML;
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
  favouriteModels = settings.favouriteModels || [];

  populateProviders();
  elements.provider.value = settings.provider;
  updateModelOptions(settings.provider, settings.model);
  elements.maxSearchResults.value = settings.maxSearchResults;
  elements.includeFollowups.checked = settings.includeFollowups;
  
  renderFavouriteModels();
  updateFavouriteButtonState();
}

// Handle provider change
elements.provider.addEventListener("change", () => {
  // Save current key to memory before switching
  currentApiKeys[currentProvider] = elements.apiKey.value.trim();

  currentProvider = elements.provider.value;
  updateModelOptions(currentProvider);
  updateFavouriteButtonState();
});

elements.model.addEventListener("change", () => {
  const isCustom = elements.model.value === CUSTOM_MODEL_VALUE;
  setCustomModelVisibility(isCustom);
  updateFavouriteButtonState();
});

elements.customModel.addEventListener("input", () => {
  updateFavouriteButtonState();
});

elements.favouriteModelBtn.addEventListener("click", (e) => {
  e.preventDefault();
  toggleFavouriteModel();
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
    favouriteModels: favouriteModels,
  };

  await extensionApi.storage.local.set(settings);
  setStatus("Saved.");
});

loadSettings().catch(() => {
  setStatus("Unable to load settings.");
});
