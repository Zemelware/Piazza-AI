/**
 * HTML templates and SVG icons for the AI Search panel.
 * Separating these from the main content script improves maintainability.
 */

const PiazzaAITemplates = {
  // SVG Icons
  icons: {
    sparkle: `<svg viewBox="0 0 24 24"><path d="M12 0L14.59 9.41L24 12L14.59 14.59L12 24L9.41 14.59L0 12L9.41 9.41L12 0Z"/></svg>`,

    close: `<svg viewBox="0 0 24 24" fill="none"><path d="M18 6L6 18M6 6l12 12" stroke-linecap="round" stroke-linejoin="round"/></svg>`,

    search: `<svg viewBox="0 0 24 24" fill="none"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35" stroke-linecap="round" stroke-linejoin="round"/></svg>`,

    lightbulb: `<svg viewBox="0 0 24 24" fill="none"><path d="M9 21h6M12 3a6 6 0 0 0-6 6c0 2.22 1.21 4.16 3 5.19V17a1 1 0 0 0 1 1h4a1 1 0 0 0 1-1v-2.81c1.79-1.03 3-2.97 3-5.19a6 6 0 0 0-6-6z" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>`,

    link: `<svg viewBox="0 0 24 24" fill="none"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" stroke-linecap="round" stroke-linejoin="round"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" stroke-linecap="round" stroke-linejoin="round"/></svg>`,

    arrow: `<svg viewBox="0 0 24 24" fill="none"><path d="M5 12h14M12 5l7 7-7 7" stroke-linecap="round" stroke-linejoin="round"/></svg>`,

    alert: `<svg viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="10"/><path d="M12 8v4M12 16h.01" stroke-linecap="round" stroke-linejoin="round"/></svg>`,

    bot: `<svg viewBox="0 0 24 24"><path d="M12 2a2 2 0 0 1 2 2c0 .74-.4 1.39-1 1.73V7h1a7 7 0 0 1 7 7h1a1 1 0 0 1 1 1v3a1 1 0 0 1-1 1h-1v1a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-1H2a1 1 0 0 1-1-1v-3a1 1 0 0 1 1-1h1a7 7 0 0 1 7-7h1V5.73c-.6-.34-1-.99-1-1.73a2 2 0 0 1 2-2M7.5 13A2.5 2.5 0 0 0 5 15.5 2.5 2.5 0 0 0 7.5 18a2.5 2.5 0 0 0 2.5-2.5A2.5 2.5 0 0 0 7.5 13m9 0a2.5 2.5 0 0 0-2.5 2.5 2.5 2.5 0 0 0 2.5 2.5 2.5 2.5 0 0 0 2.5-2.5 2.5 2.5 0 0 0-2.5-2.5z"/></svg>`,
  },

  // Floating Action Button
  fab() {
    return `
      ${this.icons.sparkle}
      <span class="fab-tooltip">AI Search</span>
    `;
  },

  // Main Panel
  panel(emptyStateHTML) {
    return `
      <div id="piazza-ai-resize-handle"></div>
      <div class="piazza-ai-panel-header">
        <div class="piazza-ai-panel-header-top">
          <div class="piazza-ai-panel-title">
            ${this.icons.sparkle}
            <h2>AI Search</h2>
          </div>
          <button id="piazza-ai-panel-close">${this.icons.close}</button>
        </div>
        <form class="piazza-ai-search-form" id="piazza-ai-search-form">
          <div class="piazza-ai-search-input-wrapper">
            ${this.icons.search}
            <input 
              type="text" 
              id="piazza-ai-search-input" 
              placeholder="Ask anything about this class..."
              autocomplete="off"
            />
          </div>
          <button type="submit" id="piazza-ai-search-submit">Search</button>
        </form>
        <div class="piazza-ai-kbd-hint">
          <span>Press</span>
          <span class="piazza-ai-kbd">⌘</span>
          <span class="piazza-ai-kbd">K</span>
          <span>to open</span>
        </div>
      </div>
      <div class="piazza-ai-panel-body" id="piazza-ai-panel-body">
        ${emptyStateHTML}
      </div>
    `;
  },

  // Empty State
  emptyState() {
    return `
      <div class="piazza-ai-empty-state">
        ${this.icons.lightbulb}
        <h3>Ask a Question</h3>
        <p>Use natural language to search through posts in this class. Ask questions like "How do I calculate the standard deviation?" or "What are the exam policies?"</p>
      </div>
    `;
  },

  // Loading State
  loading() {
    return `
      <div class="piazza-ai-loading">
        <div class="piazza-ai-loading-spinner"></div>
        <div class="piazza-ai-loading-text">Searching Piazza posts...</div>
        <div class="piazza-ai-loading-subtext">AI is analyzing relevant content</div>
      </div>
    `;
  },

  // Error State
  error(message) {
    return `
      <div class="piazza-ai-error-state">
        ${this.icons.alert}
        <div class="piazza-ai-error-content">
          <h4>Something went wrong</h4>
          <p>${message}</p>
        </div>
      </div>
    `;
  },

  // Answer Section Label
  answerLabel() {
    return `
      <div class="piazza-ai-answer-label">
        ${this.icons.bot}
        <span>AI Answer</span>
      </div>
    `;
  },

  // Sources Section
  sources(sources, escapeHtml) {
    const sourceItems = sources
      .map(
        (source, idx) => `
          <a href="${
            source.url
          }" target="_blank" rel="noopener noreferrer" class="piazza-ai-source-item" id="piazza-ai-source-${
          idx + 1
        }">
            <span class="piazza-ai-source-number">${idx + 1}</span>
            <span class="piazza-ai-source-title">${escapeHtml(source.subject)}</span>
            <svg class="piazza-ai-source-arrow" viewBox="0 0 24 24" fill="none">
              <path d="M5 12h14M12 5l7 7-7 7" stroke-linecap="round" stroke-linejoin="round"/>
            </svg>
          </a>
        `
      )
      .join("");

    return `
      <div class="piazza-ai-sources-label">
        ${this.icons.link}
        <span>Search Results (${sources.length})</span>
      </div>
      <div class="piazza-ai-source-list">
        ${sourceItems}
      </div>
    `;
  },

  // Meta Provider Info
  meta(provider, model) {
    return `
      <div class="piazza-ai-meta-provider">
        ${this.icons.bot}
        <span>Generated by ${model}</span>
      </div>
    `;
  },
};

// Make available globally for content script
window.PiazzaAITemplates = PiazzaAITemplates;
