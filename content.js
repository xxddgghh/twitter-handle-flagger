// Twitter Handle Flagger - Content Script
// Scans tweets and color-codes them based on handle categories

(function() {
  'use strict';

  // Track processed tweets to avoid re-processing
  const processedTweets = new WeakSet();
  
  // Cache for handle lookups
  let handleCache = {};
  let categories = {};
  let settings = {};

  // Flag icon SVG
  const FLAG_ICON = `
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
      <path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z"></path>
      <line x1="4" y1="22" x2="4" y2="15"></line>
    </svg>
  `;

  // Initialize
  async function init() {
    console.log('Twitter Handle Flagger initialized');
    
    // Load categories and settings
    await loadCategories();
    await loadSettings();
    
    // Initial scan
    scanTweets();
    
    // Set up mutation observer for dynamic content
    setupObserver();
    
    // Listen for settings changes
    chrome.storage.onChanged.addListener((changes, namespace) => {
      if (namespace === 'sync' && changes.enabledCategories) {
        loadSettings().then(() => rescanAllTweets());
      }
    });
  }

  // Load categories from background
  async function loadCategories() {
    return new Promise((resolve) => {
      chrome.runtime.sendMessage({ action: 'getCategories' }, (response) => {
        if (response && response.categories) {
          categories = response.categories;
        }
        resolve();
      });
    });
  }

  // Load settings from background
  async function loadSettings() {
    return new Promise((resolve) => {
      chrome.runtime.sendMessage({ action: 'getSettings' }, (response) => {
        if (response && response.settings) {
          settings = response.settings;
        }
        resolve();
      });
    });
  }

  // Extract handle from tweet element
  function extractHandle(tweetElement) {
    // Try multiple selectors for the handle
    const handleSelectors = [
      'a[href^="/"][role="link"] span:not([class])',
      '[data-testid="User-Name"] a[href^="/"]',
      'a[href^="/"][tabindex="-1"]'
    ];
    
    for (const selector of handleSelectors) {
      const element = tweetElement.querySelector(selector);
      if (element) {
        const href = element.closest('a')?.getAttribute('href');
        if (href && href.startsWith('/')) {
          const handle = href.split('/')[1]?.split('?')[0];
          if (handle && !['home', 'explore', 'notifications', 'messages', 'search', 'compose'].includes(handle)) {
            return handle.toLowerCase();
          }
        }
      }
    }
    
    // Alternative: look for @username pattern
    const userNameEl = tweetElement.querySelector('[data-testid="User-Name"]');
    if (userNameEl) {
      const text = userNameEl.textContent;
      const match = text.match(/@(\w+)/);
      if (match) {
        return match[1].toLowerCase();
      }
    }
    
    return null;
  }

  // Lookup handles in batch
  async function lookupHandles(handles) {
    // Filter out already cached handles
    const uncachedHandles = handles.filter(h => !(h in handleCache));
    
    if (uncachedHandles.length > 0) {
      return new Promise((resolve) => {
        chrome.runtime.sendMessage({ 
          action: 'lookupHandles', 
          handles: uncachedHandles 
        }, (response) => {
          if (response && response.results) {
            // Update cache
            Object.assign(handleCache, response.results);
            // Mark non-flagged handles as null in cache
            uncachedHandles.forEach(h => {
              if (!(h in handleCache)) {
                handleCache[h] = null;
              }
            });
          }
          resolve();
        });
      });
    }
  }

  // Apply styling to a tweet
  function styleTweet(tweetElement, handleInfo) {
    if (!handleInfo || !handleInfo.categoryInfo) return;
    
    const { categoryInfo, category, reportCount } = handleInfo;
    
    // Check if this category is enabled
    if (settings.enabledCategories && !settings.enabledCategories.includes(category)) {
      return;
    }
    
    // Add data attributes
    tweetElement.dataset.flaggedHandle = handleInfo.handle;
    tweetElement.dataset.flaggedCategory = category;
    
    // Apply styling based on settings
    const style = settings.highlightStyle || 'border';
    
    if (style === 'border' || style === 'both') {
      tweetElement.style.borderLeft = `4px solid ${categoryInfo.borderColor}`;
    }
    
    if (style === 'background' || style === 'both') {
      tweetElement.style.backgroundColor = categoryInfo.bgColor;
    }
    
    // Add badge if enabled
    if (settings.showBadges !== false) {
      addBadge(tweetElement, handleInfo);
    }
    
    // Add tooltip if enabled
    if (settings.showTooltips !== false) {
      addTooltip(tweetElement, handleInfo);
    }
    
    // Add report button
    addReportButton(tweetElement, handleInfo.handle);
  }

  // Add category badge to tweet
  function addBadge(tweetElement, handleInfo) {
    // Check if badge already exists
    if (tweetElement.querySelector('.handle-flagger-badge')) return;
    
    const { categoryInfo, reportCount } = handleInfo;
    
    const badge = document.createElement('div');
    badge.className = 'handle-flagger-badge';
    badge.style.cssText = `
      display: inline-flex;
      align-items: center;
      gap: 4px;
      padding: 2px 8px;
      background: ${categoryInfo.bgColor};
      border: 1px solid ${categoryInfo.borderColor};
      border-radius: 12px;
      font-size: 11px;
      font-weight: 600;
      color: ${categoryInfo.color};
      margin-left: 8px;
    `;
    badge.innerHTML = `
      <span style="width: 6px; height: 6px; background: ${categoryInfo.color}; border-radius: 50%;"></span>
      ${categoryInfo.label}
    `;
    
    // Find username element and append badge
    const userNameEl = tweetElement.querySelector('[data-testid="User-Name"]');
    if (userNameEl) {
      const firstLine = userNameEl.querySelector('div');
      if (firstLine && !firstLine.querySelector('.handle-flagger-badge')) {
        firstLine.appendChild(badge);
      }
    }
  }

  // Add tooltip to tweet
  function addTooltip(tweetElement, handleInfo) {
    if (tweetElement.querySelector('.handle-flagger-tooltip')) return;
    
    const { categoryInfo, handle, reportCount, addedAt } = handleInfo;
    
    const tooltip = document.createElement('div');
    tooltip.className = 'handle-flagger-tooltip';
    
    const addedDate = addedAt ? new Date(addedAt).toLocaleDateString() : 'Unknown';
    
    tooltip.innerHTML = `
      <div class="tooltip-header" style="color: ${categoryInfo.color}">
        ${categoryInfo.label}
      </div>
      <div class="tooltip-body">
        <p><strong>@${handle}</strong></p>
        <p>${categoryInfo.description}</p>
        <p class="tooltip-meta">
          ${reportCount} reports · Added ${addedDate}
        </p>
      </div>
    `;
    
    tweetElement.appendChild(tooltip);
    tweetElement.classList.add('has-flagger-tooltip');
  }

  // Add report button to tweet
  function addReportButton(tweetElement, handle) {
    if (tweetElement.querySelector('.handle-flagger-report-btn')) return;
    
    const btn = document.createElement('button');
    btn.className = 'handle-flagger-report-btn';
    btn.title = 'Report this handle';
    btn.innerHTML = FLAG_ICON;
    
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      e.preventDefault();
      openReportDialog(handle);
    });
    
    // Add to tweet actions area
    const actionsBar = tweetElement.querySelector('[role="group"]');
    if (actionsBar) {
      actionsBar.appendChild(btn);
    }
  }

  // Open report dialog
  function openReportDialog(handle) {
    // Store handle for popup
    chrome.storage.local.set({ pendingReport: handle });
    
    // Create inline report dialog
    const existingDialog = document.querySelector('.handle-flagger-dialog');
    if (existingDialog) existingDialog.remove();
    
    const dialog = document.createElement('div');
    dialog.className = 'handle-flagger-dialog';
    dialog.innerHTML = `
      <div class="dialog-content">
        <div class="dialog-header">
          <h3>Report @${handle}</h3>
          <button class="dialog-close">&times;</button>
        </div>
        <div class="dialog-body">
          <p>Select a category for this handle:</p>
          <div class="category-options">
            ${Object.entries(categories).map(([id, cat]) => `
              <label class="category-option" style="border-color: ${cat.borderColor}">
                <input type="radio" name="category" value="${id}">
                <span class="category-color" style="background: ${cat.color}"></span>
                <span class="category-label">${cat.label}</span>
              </label>
            `).join('')}
          </div>
          <textarea class="evidence-input" placeholder="Optional: Add evidence or notes..."></textarea>
          <button class="submit-report-btn">Submit Report via GitHub</button>
        </div>
      </div>
    `;
    
    document.body.appendChild(dialog);
    
    // Event handlers
    dialog.querySelector('.dialog-close').addEventListener('click', () => dialog.remove());
    dialog.addEventListener('click', (e) => {
      if (e.target === dialog) dialog.remove();
    });
    
    dialog.querySelector('.submit-report-btn').addEventListener('click', async () => {
      const selectedCategory = dialog.querySelector('input[name="category"]:checked');
      const evidence = dialog.querySelector('.evidence-input').value;
      
      if (!selectedCategory) {
        alert('Please select a category');
        return;
      }
      
      chrome.runtime.sendMessage({
        action: 'submitReport',
        handle: handle,
        category: selectedCategory.value,
        evidence: evidence
      }, (response) => {
        if (response && response.url) {
          window.open(response.url, '_blank');
          dialog.remove();
        } else if (response && response.error) {
          alert('Error: ' + response.error);
        }
      });
    });
  }

  // Scan all tweets on the page
  async function scanTweets() {
    const tweets = document.querySelectorAll('article[data-testid="tweet"]');
    const handles = [];
    const tweetMap = new Map();
    
    tweets.forEach(tweet => {
      if (processedTweets.has(tweet)) return;
      processedTweets.add(tweet);
      
      const handle = extractHandle(tweet);
      if (handle) {
        handles.push(handle);
        
        if (!tweetMap.has(handle)) {
          tweetMap.set(handle, []);
        }
        tweetMap.set(handle, [...tweetMap.get(handle), tweet]);
      }
      
      // Add report button to all tweets (even unflagged ones)
      if (handle) {
        addUnflaggedReportButton(tweet, handle);
      }
    });
    
    if (handles.length === 0) return;
    
    // Batch lookup
    await lookupHandles(handles);
    
    // Apply styling
    tweetMap.forEach((tweets, handle) => {
      const info = handleCache[handle];
      if (info) {
        tweets.forEach(tweet => styleTweet(tweet, info));
      }
    });
  }

  // Add report button to unflagged tweets
  function addUnflaggedReportButton(tweetElement, handle) {
    if (tweetElement.querySelector('.handle-flagger-report-btn')) return;
    
    const btn = document.createElement('button');
    btn.className = 'handle-flagger-report-btn unflagged';
    btn.title = `Report @${handle}`;
    btn.innerHTML = FLAG_ICON;
    
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      e.preventDefault();
      openReportDialog(handle);
    });
    
    const actionsBar = tweetElement.querySelector('[role="group"]');
    if (actionsBar) {
      actionsBar.appendChild(btn);
    }
  }

  // Rescan all tweets (when settings change)
  function rescanAllTweets() {
    // Clear processed set
    document.querySelectorAll('article[data-testid="tweet"]').forEach(tweet => {
      // Remove existing styling
      tweet.style.borderLeft = '';
      tweet.style.backgroundColor = '';
      tweet.querySelector('.handle-flagger-badge')?.remove();
      tweet.querySelector('.handle-flagger-tooltip')?.remove();
      tweet.classList.remove('has-flagger-tooltip');
      delete tweet.dataset.flaggedHandle;
      delete tweet.dataset.flaggedCategory;
    });
    
    // Re-process
    processedTweets = new WeakSet();
    handleCache = {};
    scanTweets();
  }

  // Set up mutation observer
  function setupObserver() {
    const observer = new MutationObserver((mutations) => {
      let shouldScan = false;
      
      for (const mutation of mutations) {
        if (mutation.addedNodes.length > 0) {
          shouldScan = true;
          break;
        }
      }
      
      if (shouldScan) {
        // Debounce scanning
        clearTimeout(setupObserver.timeout);
        setupObserver.timeout = setTimeout(scanTweets, 200);
      }
    });
    
    observer.observe(document.body, {
      childList: true,
      subtree: true
    });
  }

  // Wait for DOM ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
