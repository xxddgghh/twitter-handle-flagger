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

  // Add category badge with tooltip to tweet
  function addBadge(tweetElement, handleInfo) {
    // Check if badge already exists
    if (tweetElement.querySelector('.handle-flagger-badge-wrapper')) return;
    
    const { categoryInfo, handle, reportCount, addedAt } = handleInfo;
    const addedDate = addedAt ? new Date(addedAt).toLocaleDateString() : 'Unknown';
    
    // Create wrapper to hold both badge and tooltip
    const wrapper = document.createElement('div');
    wrapper.className = 'handle-flagger-badge-wrapper';
    
    // Create badge
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
    `;
    badge.innerHTML = `
      <span style="width: 6px; height: 6px; background: ${categoryInfo.color}; border-radius: 50%;"></span>
      ${categoryInfo.label}
    `;
    
    // Create simple tooltip
    const tooltip = document.createElement('div');
    tooltip.className = 'handle-flagger-tooltip';
    
    // GitHub search URL for reports about this handle
    const githubReportsUrl = `https://github.com/xxddgghh/twitter-handle-flagger/issues?q=is%3Aissue+%40${handle}`;
    
    tooltip.innerHTML = `
      <div class="hf-tooltip-content">
        <a href="${githubReportsUrl}" target="_blank" style="color: ${categoryInfo.color};">Read more →</a>
      </div>
    `;
    
    wrapper.appendChild(badge);
    wrapper.appendChild(tooltip);
    
    // Find username element and append wrapper
    const userNameEl = tweetElement.querySelector('[data-testid="User-Name"]');
    if (userNameEl) {
      const firstLine = userNameEl.querySelector('div');
      if (firstLine && !firstLine.querySelector('.handle-flagger-badge-wrapper')) {
        firstLine.appendChild(wrapper);
      }
    }
  }

  // Tooltip is now part of addBadge - this function kept for compatibility
  function addTooltip(tweetElement, handleInfo) {
    // Tooltip is now added together with badge in addBadge()
    // This function is kept for backward compatibility but does nothing
  }

  // Add report button to tweet (top-right corner)
  function addReportButton(tweetElement, handle) {
    if (tweetElement.querySelector('.handle-flagger-report-btn-top')) return;
    
    const btn = document.createElement('button');
    btn.className = 'handle-flagger-report-btn-top';
    btn.title = 'Report this handle to community';
    btn.innerHTML = `
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z"></path>
        <line x1="4" y1="22" x2="4" y2="15"></line>
      </svg>
    `;
    
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      e.preventDefault();
      openReportDialog(handle, tweetElement);
    });
    
    // Find the "more options" (...) button area and place report button nearby
    const moreButton = tweetElement.querySelector('[data-testid="caret"]');
    if (moreButton) {
      const container = moreButton.closest('div');
      if (container && container.parentElement) {
        container.parentElement.insertBefore(btn, container);
      }
    } else {
      // Fallback: add to the header area
      const header = tweetElement.querySelector('[data-testid="User-Name"]');
      if (header) {
        const headerRow = header.closest('div[class]');
        if (headerRow) {
          headerRow.style.position = 'relative';
          btn.style.position = 'absolute';
          btn.style.right = '40px';
          btn.style.top = '0';
          headerRow.appendChild(btn);
        }
      }
    }
  }

  // Extract tweet URL from tweet element
  function extractTweetUrl(tweetElement) {
    // Look for the timestamp link which contains the tweet URL
    const timeLink = tweetElement.querySelector('a[href*="/status/"] time');
    if (timeLink) {
      const link = timeLink.closest('a');
      if (link) {
        return 'https://x.com' + link.getAttribute('href');
      }
    }
    // Fallback: try to find any status link
    const statusLink = tweetElement.querySelector('a[href*="/status/"]');
    if (statusLink) {
      const href = statusLink.getAttribute('href');
      if (href.includes('/status/')) {
        return 'https://x.com' + href;
      }
    }
    return window.location.href;
  }

  // Extract tweet text from tweet element
  function extractTweetText(tweetElement) {
    const tweetTextEl = tweetElement.querySelector('[data-testid="tweetText"]');
    if (tweetTextEl) {
      return tweetTextEl.textContent.slice(0, 500); // Increased limit
    }
    return '';
  }

  // Extract full tweet snapshot data
  function extractTweetSnapshot(tweetElement) {
    const snapshot = {
      url: extractTweetUrl(tweetElement),
      text: extractTweetText(tweetElement),
      author: {},
      timestamp: '',
      stats: {},
      media: []
    };

    // Extract author info
    const userNameEl = tweetElement.querySelector('[data-testid="User-Name"]');
    if (userNameEl) {
      const displayName = userNameEl.querySelector('span')?.textContent || '';
      const handleMatch = userNameEl.textContent.match(/@(\w+)/);
      snapshot.author = {
        displayName: displayName,
        handle: handleMatch ? handleMatch[1] : ''
      };
    }

    // Extract timestamp
    const timeEl = tweetElement.querySelector('time');
    if (timeEl) {
      snapshot.timestamp = timeEl.getAttribute('datetime') || timeEl.textContent;
    }

    // Extract engagement stats
    const statsGroup = tweetElement.querySelector('[role="group"]');
    if (statsGroup) {
      const buttons = statsGroup.querySelectorAll('button');
      const statLabels = ['replies', 'retweets', 'likes', 'views'];
      buttons.forEach((btn, idx) => {
        const value = btn.querySelector('span[data-testid]')?.textContent || 
                      btn.querySelector('span')?.textContent || '0';
        if (statLabels[idx] && value) {
          snapshot.stats[statLabels[idx]] = value;
        }
      });
    }

    // Extract media (images/videos)
    const mediaElements = tweetElement.querySelectorAll('[data-testid="tweetPhoto"] img, video');
    mediaElements.forEach(media => {
      if (media.tagName === 'IMG') {
        snapshot.media.push({ type: 'image', url: media.src });
      } else if (media.tagName === 'VIDEO') {
        snapshot.media.push({ type: 'video', poster: media.poster || '' });
      }
    });

    return snapshot;
  }

  // Generate archive.today URL
  function getArchiveUrl(tweetUrl) {
    return `https://archive.today/?run=1&url=${encodeURIComponent(tweetUrl)}`;
  }

  // Open report dialog
  function openReportDialog(handle, tweetElement = null) {
    // Store handle for popup
    chrome.storage.local.set({ pendingReport: handle });
    
    // Extract full tweet snapshot
    const snapshot = tweetElement ? extractTweetSnapshot(tweetElement) : {
      url: window.location.href,
      text: '',
      author: { handle: handle },
      timestamp: '',
      stats: {},
      media: []
    };
    
    const archiveUrl = getArchiveUrl(snapshot.url);
    
    // Create inline report dialog
    const existingDialog = document.querySelector('.handle-flagger-dialog');
    if (existingDialog) existingDialog.remove();
    
    const dialog = document.createElement('div');
    dialog.className = 'handle-flagger-dialog';
    dialog.innerHTML = `
      <div class="dialog-content">
        <div class="dialog-header">
          <h3>🚩 Report @${handle}</h3>
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
          
          <div class="proof-section">
            <label class="proof-label">📸 Tweet Snapshot (auto-captured)</label>
            <div class="snapshot-preview">
              <div class="snapshot-header">
                <strong>${snapshot.author.displayName || ''}</strong>
                <span class="snapshot-handle">@${snapshot.author.handle || handle}</span>
                ${snapshot.timestamp ? `<span class="snapshot-time">· ${new Date(snapshot.timestamp).toLocaleString()}</span>` : ''}
              </div>
              ${snapshot.text ? `
              <div class="snapshot-text">${snapshot.text}</div>
              ` : ''}
              ${snapshot.media.length > 0 ? `
              <div class="snapshot-media">
                📷 ${snapshot.media.length} media attachment(s)
              </div>
              ` : ''}
              ${Object.keys(snapshot.stats).length > 0 ? `
              <div class="snapshot-stats">
                ${snapshot.stats.replies ? `💬 ${snapshot.stats.replies}` : ''}
                ${snapshot.stats.retweets ? `🔁 ${snapshot.stats.retweets}` : ''}
                ${snapshot.stats.likes ? `❤️ ${snapshot.stats.likes}` : ''}
                ${snapshot.stats.views ? `👁️ ${snapshot.stats.views}` : ''}
              </div>
              ` : ''}
            </div>
            
            <div class="proof-links">
              <div class="proof-item">
                <span class="proof-icon">🔗</span>
                <input type="text" class="proof-url" value="${snapshot.url}" readonly>
                <button class="copy-btn" data-url="${snapshot.url}" title="Copy URL">📋</button>
              </div>
              <div class="proof-item archive-link">
                <span class="proof-icon">📦</span>
                <span>Archive snapshot:</span>
                <a href="${archiveUrl}" target="_blank" class="archive-btn">Create Archive →</a>
              </div>
            </div>
          </div>
          
          <textarea class="evidence-input" placeholder="Add additional notes or context (optional)..."></textarea>
          <button class="submit-report-btn">🚀 Submit Report via GitHub</button>
          <p class="report-note">📋 Full tweet snapshot will be included in the report</p>
        </div>
      </div>
    `;
    
    document.body.appendChild(dialog);
    
    // Event handlers
    dialog.querySelector('.dialog-close').addEventListener('click', () => dialog.remove());
    dialog.addEventListener('click', (e) => {
      if (e.target === dialog) dialog.remove();
    });
    
    // Copy button handler
    const copyBtn = dialog.querySelector('.copy-btn');
    if (copyBtn) {
      copyBtn.addEventListener('click', () => {
        navigator.clipboard.writeText(snapshot.url);
        copyBtn.textContent = '✅';
        setTimeout(() => copyBtn.textContent = '📋', 1500);
      });
    }
    
    dialog.querySelector('.submit-report-btn').addEventListener('click', async () => {
      const selectedCategory = dialog.querySelector('input[name="category"]:checked');
      const additionalNotes = dialog.querySelector('.evidence-input').value;
      
      if (!selectedCategory) {
        alert('Please select a category');
        return;
      }
      
      // Build comprehensive evidence with full snapshot
      const evidenceLines = [
        `## 📸 Tweet Snapshot`,
        ``,
        `**Author:** ${snapshot.author.displayName || ''} (@${snapshot.author.handle || handle})`,
        `**Date:** ${snapshot.timestamp ? new Date(snapshot.timestamp).toLocaleString() : 'Unknown'}`,
        `**Tweet URL:** ${snapshot.url}`,
        `**Archive Link:** [Create Archive](${archiveUrl})`,
        ``,
        `### Tweet Content`,
        `> ${snapshot.text || 'No text content'}`,
        ``
      ];
      
      if (Object.keys(snapshot.stats).length > 0) {
        evidenceLines.push(`### Engagement Stats`);
        evidenceLines.push(`| Replies | Retweets | Likes | Views |`);
        evidenceLines.push(`|---------|----------|-------|-------|`);
        evidenceLines.push(`| ${snapshot.stats.replies || '-'} | ${snapshot.stats.retweets || '-'} | ${snapshot.stats.likes || '-'} | ${snapshot.stats.views || '-'} |`);
        evidenceLines.push(``);
      }
      
      if (snapshot.media.length > 0) {
        evidenceLines.push(`### Media Attachments`);
        snapshot.media.forEach((m, i) => {
          if (m.type === 'image' && m.url) {
            evidenceLines.push(`![Image ${i + 1}](${m.url})`);
          } else if (m.type === 'video') {
            evidenceLines.push(`- Video attachment ${i + 1}`);
          }
        });
        evidenceLines.push(``);
      }
      
      if (additionalNotes) {
        evidenceLines.push(`### Reporter's Notes`);
        evidenceLines.push(additionalNotes);
      }
      
      const evidence = evidenceLines.join('\n');
      
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

  // Add report button to unflagged tweets (top-right corner)
  function addUnflaggedReportButton(tweetElement, handle) {
    if (tweetElement.querySelector('.handle-flagger-report-btn-top')) return;
    
    const btn = document.createElement('button');
    btn.className = 'handle-flagger-report-btn-top unflagged';
    btn.title = `Report @${handle}`;
    btn.innerHTML = `
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z"></path>
        <line x1="4" y1="22" x2="4" y2="15"></line>
      </svg>
    `;
    
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      e.preventDefault();
      openReportDialog(handle, tweetElement);
    });
    
    // Find the "more options" (...) button area and place report button nearby
    const moreButton = tweetElement.querySelector('[data-testid="caret"]');
    if (moreButton) {
      const container = moreButton.closest('div');
      if (container && container.parentElement) {
        container.parentElement.insertBefore(btn, container);
      }
    } else {
      // Fallback: add to the header area
      const header = tweetElement.querySelector('[data-testid="User-Name"]');
      if (header) {
        const headerRow = header.closest('div[class]');
        if (headerRow) {
          headerRow.style.position = 'relative';
          btn.style.position = 'absolute';
          btn.style.right = '40px';
          btn.style.top = '0';
          headerRow.appendChild(btn);
        }
      }
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
