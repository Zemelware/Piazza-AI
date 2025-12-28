/**
 * Provider configurations for LLM services.
 *
 * Each provider can use either:
 * 1. OpenAI-compatible chat completions API (apiStyle: "openai-chat")
 * 2. OpenAI Responses API (apiStyle: "openai-responses")
 * 3. Custom API format with a custom adapter
 *
 * To add a new provider:
 * 1. Add a new entry to PROVIDERS with a unique key
 * 2. Specify name, baseUrl, apiStyle, and models array
 * 3. If using a custom API format, implement an adapter in llmService.js
 * 4. Add the provider's API domain to manifest.json host_permissions
 */

export const PROVIDERS = {
  google: {
    id: "google",
    name: "Google (Gemini)",
    // Gemini's OpenAI-compatible endpoint
    baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai",
    apiStyle: "openai-chat", // Uses OpenAI-compatible chat completions
    apiKeyPlaceholder: "Enter your Google AI API key",
    apiKeyLink: "https://aistudio.google.com/apikey",
    models: [
      { id: "gemini-3-pro-preview", name: "Gemini 3 Pro (Preview)" },
      { id: "gemini-3-flash-preview", name: "Gemini 3 Flash (Preview)" },
      { id: "gemini-2.5-pro", name: "Gemini 2.5 Pro" },
      { id: "gemini-2.5-flash", name: "Gemini 2.5 Flash" },
      { id: "gemini-2.5-flash-lite", name: "Gemini 2.5 Flash-Lite" },
    ],
  },
  xai: {
    id: "xai",
    name: "xAI (Grok)",
    baseUrl: "https://api.x.ai",
    apiStyle: "openai-chat", // Uses OpenAI-compatible chat completions
    apiKeyPlaceholder: "Enter your xAI API key",
    apiKeyLink: "https://console.x.ai/",
    models: [
      { id: "grok-4-1-fast-reasoning", name: "Grok 4.1 Fast (Reasoning)" },
      { id: "grok-4-1-fast-non-reasoning", name: "Grok 4.1 Fast (Non-Reasoning)" },
      { id: "grok-4-fast-reasoning", name: "Grok 4 Fast (Reasoning)" },
      { id: "grok-4-fast-non-reasoning", name: "Grok 4 Fast (Non-Reasoning)" },
      { id: "grok-code-fast-1", name: "Grok Code Fast 1" },
      { id: "grok-4", name: "Grok 4" },
    ],
  },
  openai: {
    id: "openai",
    name: "OpenAI (GPT)",
    baseUrl: "https://api.openai.com",
    apiStyle: "openai-responses", // Uses the new Responses API
    apiKeyPlaceholder: "Enter your OpenAI API key",
    apiKeyLink: "https://platform.openai.com/api-keys",
    models: [
      { id: "gpt-5.2", name: "GPT-5.2" },
      { id: "gpt-5.1", name: "GPT-5.1" },
      { id: "gpt-5", name: "GPT-5" },
      { id: "gpt-5-mini", name: "GPT-5 Mini" },
      { id: "gpt-5-nano", name: "GPT-5 Nano" },
      { id: "gpt-4.1", name: "GPT-4.1" },
      { id: "gpt-4.1-mini", name: "GPT-4.1 Mini" },
      { id: "gpt-4.1-nano", name: "GPT-4.1 Nano" },
    ],
  },
};

export const DEFAULT_PROVIDER = "google";

/**
 * Get a provider configuration by ID.
 * @param {string} providerId - The provider ID (e.g., "xai", "google", "openai")
 * @returns {object} The provider configuration
 */
export function getProvider(providerId) {
  return PROVIDERS[providerId] || PROVIDERS[DEFAULT_PROVIDER];
}

/**
 * Get all available providers as an array.
 * @returns {Array} Array of provider configurations
 */
export function getAllProviders() {
  return Object.values(PROVIDERS);
}
