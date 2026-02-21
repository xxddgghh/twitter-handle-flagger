// Twitter Handle Flagger - Content Script
// Scans tweets and color-codes them based on handle categories

(function() {
  'use strict';

  // Check if extension context is valid
  function isExtensionValid() {
    try {
      return !!(chrome.runtime && chrome.runtime.id);
    } catch (e) {
      return false;
    }
  }

  // Safe message sender that handles invalidated context
  function safeSendMessage(message, callback) {
    if (!isExtensionValid()) {
      console.log('⚠️ Extension context invalidated - please refresh the page');
      if (callback) callback({ error: 'Extension context invalidated' });
      return;
    }
    
    try {
      chrome.runtime.sendMessage(message, (response) => {
        if (chrome.runtime.lastError) {
          console.log('Extension message error:', chrome.runtime.lastError.message);
          if (callback) callback({ error: chrome.runtime.lastError.message });
          return;
        }
        if (callback) callback(response);
      });
    } catch (e) {
      console.log('Extension error:', e.message);
      if (callback) callback({ error: e.message });
    }
  }

  // Track processed tweets to avoid re-processing
  let processedTweets = new WeakSet();
  
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

  // Detect if tweet is a retweet/quote tweet and extract all involved handles
  function detectTweetType(tweetElement) {
    const result = {
      type: 'original', // 'original', 'retweet', 'quote', 'reply'
      mainAuthor: null, // The account that posted/retweeted
      originalAuthor: null, // For retweets/quotes - the original content author
      quotedText: '', // For quote tweets - the added commentary
      isRetweet: false,
      isQuote: false,
      isReply: false
    };

    // Method 1: Check for social context (repost indicator at top)
    const socialContext = tweetElement.querySelector('[data-testid="socialContext"]');
    if (socialContext) {
      const contextText = socialContext.textContent.toLowerCase();
      console.log('🔍 Social context found:', contextText);
      
      if (contextText.includes('repost') || contextText.includes('retweet')) {
        result.type = 'retweet';
        result.isRetweet = true;
        
        // The retweeter's name is in the social context
        const retweeterLink = socialContext.querySelector('a[href^="/"]');
        if (retweeterLink) {
          const href = retweeterLink.getAttribute('href');
          result.mainAuthor = href.split('/')[1]?.split('?')[0]?.toLowerCase();
          console.log('🔄 Retweeter:', result.mainAuthor);
        }
      }
    }

    // Method 2: Check for "reposted" text anywhere in the tweet header area
    const headerArea = tweetElement.querySelector('div[data-testid="User-Name"]')?.closest('div[class]')?.parentElement;
    if (headerArea) {
      const allText = headerArea.textContent.toLowerCase();
      if ((allText.includes('reposted') || allText.includes('retweeted')) && !result.isRetweet) {
        result.type = 'retweet';
        result.isRetweet = true;
        console.log('🔄 Retweet detected via header text');
        
        // Try to find retweeter from links
        const links = headerArea.querySelectorAll('a[href^="/"]');
        links.forEach(link => {
          const href = link.getAttribute('href');
          if (href && !href.includes('/status/')) {
            const potentialHandle = href.split('/')[1]?.split('?')[0]?.toLowerCase();
            if (potentialHandle && !['home', 'explore', 'notifications', 'messages'].includes(potentialHandle)) {
              if (!result.mainAuthor) {
                result.mainAuthor = potentialHandle;
              }
            }
          }
        });
      }
    }

    // Method 3: Check for quote tweet (has nested tweet/card)
    const quotedTweet = tweetElement.querySelector('[data-testid="quoteTweet"]') ||
                        tweetElement.querySelector('article article') ||
                        tweetElement.querySelector('div[role="link"][tabindex="0"]:not([data-testid])');
    
    if (quotedTweet && quotedTweet.querySelector('a[href*="/status/"]')) {
      result.type = 'quote';
      result.isQuote = true;
      console.log('💬 Quote tweet detected');
      
      // Extract quoted tweet author
      const quotedLinks = quotedTweet.querySelectorAll('a[href^="/"]');
      quotedLinks.forEach(link => {
        const href = link.getAttribute('href');
        if (href && !href.includes('/status/') && !result.originalAuthor) {
          const potentialHandle = href.split('/')[1]?.split('?')[0]?.toLowerCase();
          if (potentialHandle && !['home', 'explore', 'notifications', 'messages', 'i'].includes(potentialHandle)) {
            result.originalAuthor = potentialHandle;
            console.log('💬 Quoted author:', result.originalAuthor);
          }
        }
      });
    }

    // Method 4: Check for reply indicator
    const replyIndicator = tweetElement.querySelector('div[id*="id__"]');
    if (replyIndicator) {
      const replyText = replyIndicator.textContent.toLowerCase();
      if (replyText.includes('replying to')) {
        result.isReply = true;
        console.log('↩️ Reply detected');
      }
    }

    // Get main tweet author (the one shown prominently in User-Name)
    const userNameEl = tweetElement.querySelector('[data-testid="User-Name"]');
    if (userNameEl) {
      const handleMatch = userNameEl.textContent.match(/@(\w+)/);
      if (handleMatch) {
        const authorHandle = handleMatch[1].toLowerCase();
        console.log('👤 Displayed author:', authorHandle);
        
        // For retweets, the displayed author is the original author
        if (result.isRetweet) {
          if (!result.originalAuthor) {
            result.originalAuthor = authorHandle;
          }
        } else if (!result.mainAuthor) {
          result.mainAuthor = authorHandle;
        }
        
        // For quote tweets, the displayed author is the quoter
        if (result.isQuote && !result.mainAuthor) {
          result.mainAuthor = authorHandle;
        }
      }
    }

    console.log('📊 Tweet type result:', result);
    return result;
  }

  // Extract profile info from tweet element (basic info from DOM)
  function extractProfileInfoFromTweet(tweetElement, handle) {
    const profile = {
      handle: handle || '',
      displayName: '',
      avatarUrl: '',
      isVerified: false,
      verifiedType: null, // 'blue', 'gold', 'gray', 'government'
      redFlags: []
    };

    // Get avatar URL
    const avatarImg = tweetElement.querySelector('[data-testid="Tweet-User-Avatar"] img');
    if (avatarImg) {
      profile.avatarUrl = avatarImg.src;
    }

    // Get display name and handle
    const userNameEl = tweetElement.querySelector('[data-testid="User-Name"]');
    if (userNameEl) {
      const displayName = userNameEl.querySelector('span')?.textContent || '';
      profile.displayName = displayName;
      
      // Extract handle if not provided
      if (!profile.handle) {
        const handleMatch = userNameEl.textContent.match(/@(\w+)/);
        if (handleMatch) {
          profile.handle = handleMatch[1].toLowerCase();
        }
      }

      // Check for verified badge
      const verifiedBadge = userNameEl.querySelector('svg[aria-label*="Verified"]');
      if (verifiedBadge) {
        profile.isVerified = true;
        const ariaLabel = verifiedBadge.getAttribute('aria-label') || '';
        if (ariaLabel.includes('government') || ariaLabel.includes('official')) {
          profile.verifiedType = 'government';
        } else if (ariaLabel.includes('business') || ariaLabel.includes('gold')) {
          profile.verifiedType = 'gold';
        } else {
          profile.verifiedType = 'blue';
        }
      }
    }

    return profile;
  }


  // Initialize
  async function init() {
    console.log('Xpose extension initialized');
    
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
    
    // Listen for database update notifications from background
    chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
      if (message.action === 'databaseUpdated') {
        console.log('📢 Database updated, refreshing...');
        // Clear cache and reload
        handleCache = {};
        categories = {};
        loadCategories().then(() => {
          rescanAllTweets();
        });
        sendResponse({ received: true });
      }
      return true;
    });
  }

  // Load categories from background
  async function loadCategories() {
    return new Promise((resolve) => {
      safeSendMessage({ action: 'getCategories' }, (response) => {
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
      safeSendMessage({ action: 'getSettings' }, (response) => {
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
        safeSendMessage({ 
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

  // Add category badge with link icon to tweet
  function addBadge(tweetElement, handleInfo) {
    // Check if badge already exists
    if (tweetElement.querySelector('.handle-flagger-badge-wrapper')) return;
    
    const { categoryInfo, handle, reportCount, addedAt } = handleInfo;
    
    // Create wrapper to hold badge and link icon
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
    
    // Create link icon (always visible, clickable) - links to Transparency Dashboard
    const dashboardUrl = `https://xpose.world/?handle=${handle}`;
    
    const linkIcon = document.createElement('a');
    linkIcon.className = 'handle-flagger-link-icon';
    linkIcon.href = dashboardUrl;
    linkIcon.target = '_blank';
    linkIcon.title = `View profile for @${handle}`;
    linkIcon.style.cssText = `
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: 18px;
      height: 18px;
      margin-left: 4px;
      color: ${categoryInfo.color};
      opacity: 0.7;
      transition: opacity 0.15s;
    `;
    linkIcon.innerHTML = `
      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
        <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/>
        <polyline points="15 3 21 3 21 9"/>
        <line x1="10" y1="14" x2="21" y2="3"/>
      </svg>
    `;
    
    // Hover effect
    linkIcon.addEventListener('mouseenter', () => linkIcon.style.opacity = '1');
    linkIcon.addEventListener('mouseleave', () => linkIcon.style.opacity = '0.7');
    
    wrapper.appendChild(badge);
    wrapper.appendChild(linkIcon);
    
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
  async function openReportDialog(handle, tweetElement = null) {
    // Store handle for popup
    chrome.storage.local.set({ pendingReport: handle });
    
    // Detect tweet type (retweet, quote, original)
    const tweetType = tweetElement ? detectTweetType(tweetElement) : {
      type: 'original',
      mainAuthor: handle,
      originalAuthor: null,
      isRetweet: false,
      isQuote: false
    };
    
    // Extract full tweet snapshot
    const snapshot = tweetElement ? extractTweetSnapshot(tweetElement) : {
      url: window.location.href,
      text: '',
      author: { handle: handle },
      timestamp: '',
      stats: {},
      media: []
    };
    
    // Extract profile info from tweet DOM
    let profileInfo = tweetElement ? extractProfileInfoFromTweet(tweetElement, handle) : {
      handle: handle,
      displayName: '',
      avatarUrl: '',
      isVerified: false,
      verifiedType: null,
      redFlags: []
    };
    
    const archiveUrl = getArchiveUrl(snapshot.url);
    
    // Determine if we need to show handle picker (for retweets/quotes)
    const hasMultipleHandles = tweetType.isRetweet || tweetType.isQuote;
    const involvedHandles = [];
    
    if (tweetType.mainAuthor) {
      involvedHandles.push({
        handle: tweetType.mainAuthor,
        role: tweetType.isRetweet ? 'Retweeted by' : (tweetType.isQuote ? 'Quoted by' : 'Author'),
        description: tweetType.isRetweet ? 'Amplified/shared this content' : (tweetType.isQuote ? 'Added commentary' : 'Original author')
      });
    }
    
    if (tweetType.originalAuthor && tweetType.originalAuthor !== tweetType.mainAuthor) {
      involvedHandles.push({
        handle: tweetType.originalAuthor,
        role: 'Original author',
        description: 'Created the original content'
      });
    }
    
    // Create inline report dialog
    const existingDialog = document.querySelector('.handle-flagger-dialog');
    if (existingDialog) existingDialog.remove();
    
    const dialog = document.createElement('div');
    dialog.className = 'handle-flagger-dialog';
    dialog.innerHTML = `
      <div class="dialog-content">
        <div class="dialog-header">
          <h3>🚩 Report Handle</h3>
          <button class="dialog-close">&times;</button>
        </div>
        <div class="dialog-body">
          <!-- Handle Selection Section -->
          <div class="handle-picker-section">
            <label class="section-label">Who to report? <span class="required">*</span></label>
            ${hasMultipleHandles && involvedHandles.length > 1 ? `
            <p class="picker-hint">🔄 ${tweetType.isRetweet ? 'Retweet' : 'Quote Tweet'} detected - multiple accounts involved:</p>
            ` : `
            <p class="picker-hint">Select the handle or add another if this is a retweet/quote:</p>
            `}
            <div class="handle-picker-options">
              ${involvedHandles.length > 0 ? involvedHandles.map((h, idx) => `
                <label class="handle-picker-option ${idx === 0 ? 'selected' : ''}">
                  <input type="radio" name="handle-pick" value="${h.handle}" ${idx === 0 ? 'checked' : ''}>
                  <div class="picker-option-content">
                    <div class="picker-handle">@${h.handle}</div>
                    <div class="picker-role">${h.role}</div>
                    <div class="picker-desc">${h.description}</div>
                  </div>
                  <span class="picker-check">✓</span>
                </label>
              `).join('') : `
                <label class="handle-picker-option selected">
                  <input type="radio" name="handle-pick" value="${handle}" checked>
                  <div class="picker-option-content">
                    <div class="picker-handle">@${handle}</div>
                    <div class="picker-role">Tweet Author</div>
                    <div class="picker-desc">The account that posted this tweet</div>
                  </div>
                  <span class="picker-check">✓</span>
                </label>
              `}
              
              <!-- Add Another Handle Option -->
              <label class="handle-picker-option add-handle-option">
                <input type="radio" name="handle-pick" value="__custom__">
                <div class="picker-option-content">
                  <div class="picker-handle">➕ Report different handle</div>
                  <div class="picker-role">For retweets, quotes, or mentions</div>
                  <div class="picker-desc">Click to enter a different handle</div>
                </div>
                <span class="picker-check">✓</span>
              </label>
            </div>
            
            <!-- Custom Handle Input (hidden by default) -->
            <div class="custom-handle-section" style="display: none; position: relative;">
              <label class="handle-label">Enter handle to report:</label>
              <div class="handle-input-wrapper">
                <span class="handle-at">@</span>
                <input type="text" class="custom-handle-input" placeholder="Type to search or enter new..." autocomplete="off">
              </div>
              <div class="handle-dropdown custom-dropdown"></div>
              <p class="handle-hint">💡 Type to search existing handles or enter any new handle</p>
            </div>
          </div>
          
          <!-- Profile Card Section -->
          <div class="profile-card-section">
            <label class="profile-label">👤 Profile Info</label>
            <div class="profile-card">
              <div class="profile-card-header">
                <div class="profile-avatar">
                  ${profileInfo.avatarUrl ? 
                    `<img src="${profileInfo.avatarUrl}" alt="Avatar" class="profile-avatar-img">` : 
                    `<div class="profile-avatar-placeholder">👤</div>`
                  }
                </div>
                <div class="profile-details">
                  <div class="profile-name-row">
                    <span class="profile-display-name">${profileInfo.displayName || handle}</span>
                    ${profileInfo.isVerified ? `<span class="profile-verified" title="${profileInfo.verifiedType || 'Verified'}">✓</span>` : ''}
                  </div>
                  <span class="profile-handle profile-handle-display">@${profileInfo.handle}</span>
                </div>
              </div>
              <div class="profile-actions">
                <a href="https://x.com/${profileInfo.handle}" target="_blank" class="view-profile-btn profile-link">
                  View Full Profile →
                </a>
              </div>
            </div>
          </div>
          
          <p>Select a category:</p>
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
          
          <div class="grok-section">
            <label class="grok-label">🤖 Grok's Opinion (Optional but recommended)</label>
            <p class="grok-instructions">Ask Grok: <em>"Is @${handle} a biased or propaganda account?"</em></p>
            <button class="ask-grok-btn" type="button">Ask Grok →</button>
            <textarea class="grok-response" placeholder="Paste Grok's response here..."></textarea>
          </div>
          
          <textarea class="evidence-input" placeholder="Your own observations (optional)..."></textarea>
          <button class="submit-report-btn">🚀 Submit Report via GitHub</button>
          <p class="report-note">📋 Profile info + Tweet snapshot + Grok's opinion will be included</p>
        </div>
      </div>
    `;
    
    document.body.appendChild(dialog);
    
    // Store profile info and tweet type
    dialog.profileInfo = profileInfo;
    dialog.tweetType = tweetType;
    dialog.involvedHandles = involvedHandles;
    
    // Handle picker event listeners
    const handlePicker = dialog.querySelectorAll('input[name="handle-pick"]');
    const customHandleSection = dialog.querySelector('.custom-handle-section');
    const customHandleInput = dialog.querySelector('.custom-handle-input');
    
    if (handlePicker.length > 0) {
      handlePicker.forEach(radio => {
        radio.addEventListener('change', (e) => {
          const selectedValue = e.target.value;
          
          // Update visual selection
          dialog.querySelectorAll('.handle-picker-option').forEach(opt => {
            opt.classList.remove('selected');
          });
          e.target.closest('.handle-picker-option').classList.add('selected');
          
          // Show/hide custom handle input
          if (selectedValue === '__custom__') {
            if (customHandleSection) {
              customHandleSection.style.display = 'block';
              customHandleInput?.focus();
            }
          } else {
            if (customHandleSection) {
              customHandleSection.style.display = 'none';
            }
            
            // Update profile display
            const profileHandleEl = dialog.querySelector('.profile-handle-display');
            const profileLinkEl = dialog.querySelector('.profile-link');
            if (profileHandleEl) profileHandleEl.textContent = '@' + selectedValue;
            if (profileLinkEl) profileLinkEl.href = 'https://x.com/' + selectedValue;
          }
        });
      });
    }
    
    // Custom handle input - with searchable dropdown of existing handles
    if (customHandleInput) {
      const customDropdown = dialog.querySelector('.custom-dropdown');
      
      // Show dropdown with filtered handles
      function showCustomDropdown(searchTerm) {
        if (!customDropdown || existingHandles.length === 0) return;
        
        const term = searchTerm.toLowerCase().replace('@', '');
        const filtered = existingHandles.filter(h => 
          h.handle.toLowerCase().includes(term)
        ).slice(0, 8);
        
        if (filtered.length === 0) {
          customDropdown.style.display = 'none';
          return;
        }
        
        customDropdown.innerHTML = filtered.map(h => `
          <div class="handle-dropdown-item" data-handle="${h.handle}">
            <span class="dropdown-handle">@${h.handle}</span>
            <span class="dropdown-category" style="color: ${categories[h.category]?.color || '#666'}; background: ${categories[h.category]?.bgColor || 'transparent'}; padding: 2px 6px; border-radius: 8px; font-size: 10px;">${h.label}</span>
          </div>
        `).join('');
        
        customDropdown.style.display = 'block';
        
        // Click handlers for dropdown items
        customDropdown.querySelectorAll('.handle-dropdown-item').forEach(item => {
          item.addEventListener('click', () => {
            customHandleInput.value = item.dataset.handle;
            customDropdown.style.display = 'none';
            
            // Update profile display
            const profileHandleEl = dialog.querySelector('.profile-handle-display');
            const profileLinkEl = dialog.querySelector('.profile-link');
            if (profileHandleEl) profileHandleEl.textContent = '@' + item.dataset.handle;
            if (profileLinkEl) profileLinkEl.href = 'https://x.com/' + item.dataset.handle;
          });
        });
      }
      
      // Input event - filter dropdown and update profile
      customHandleInput.addEventListener('input', (e) => {
        const customHandle = e.target.value.trim().replace('@', '');
        
        // Show dropdown with matches
        showCustomDropdown(customHandle);
        
        // Update profile display
        if (customHandle) {
          const profileHandleEl = dialog.querySelector('.profile-handle-display');
          const profileLinkEl = dialog.querySelector('.profile-link');
          if (profileHandleEl) profileHandleEl.textContent = '@' + customHandle;
          if (profileLinkEl) profileLinkEl.href = 'https://x.com/' + customHandle;
        }
      });
      
      // Focus event - show all handles
      customHandleInput.addEventListener('focus', () => {
        if (existingHandles.length > 0) {
          showCustomDropdown('');
        }
      });
      
      // Hide dropdown when clicking outside
      document.addEventListener('click', (e) => {
        if (!e.target.closest('.custom-handle-section') && customDropdown) {
          customDropdown.style.display = 'none';
        }
      });
    }
    
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
    
    // Load existing handles for autocomplete in custom input
    let existingHandles = [];
    safeSendMessage({ action: 'getDatabase' }, (response) => {
      if (response && response.database && response.database.handles) {
        existingHandles = Object.keys(response.database.handles).map(h => ({
          handle: h,
          category: response.database.handles[h].category,
          label: response.database.categories[response.database.handles[h].category]?.label || ''
        }));
      }
    });
    
    // Ask Grok button handler
    const askGrokBtn = dialog.querySelector('.ask-grok-btn');
    if (askGrokBtn) {
      askGrokBtn.addEventListener('click', () => {
        // Get current handle value from input
        const currentHandle = handleInput.value.trim().replace('@', '');
        const grokQuery = encodeURIComponent(`Is @${currentHandle} a biased, propaganda, or paid promoter account? Analyze their tweet patterns and provide your opinion.`);
        window.open(`https://x.com/i/grok?text=${grokQuery}`, '_blank');
      });
    }
    
    dialog.querySelector('.submit-report-btn').addEventListener('click', async () => {
      const selectedCategory = dialog.querySelector('input[name="category"]:checked');
      const additionalNotes = dialog.querySelector('.evidence-input').value;
      const grokResponse = dialog.querySelector('.grok-response').value;
      
      // Get reported handle - from picker, custom input, or fallback
      const handlePickerSelected = dialog.querySelector('input[name="handle-pick"]:checked');
      const customHandleInput = dialog.querySelector('.custom-handle-input');
      
      let reportedHandle = handle;
      
      if (handlePickerSelected) {
        if (handlePickerSelected.value === '__custom__') {
          // Custom handle selected - use the input value
          reportedHandle = customHandleInput?.value.trim().replace('@', '').toLowerCase() || '';
        } else {
          reportedHandle = handlePickerSelected.value.toLowerCase();
        }
      }
      
      if (!selectedCategory) {
        alert('Please select a category');
        return;
      }
      
      if (!reportedHandle) {
        alert('Please select or enter a handle to report');
        return;
      }
      
      // Get profile info and tweet type from dialog
      const finalProfileInfo = dialog.profileInfo || profileInfo;
      const finalTweetType = dialog.tweetType || tweetType;
      
      // Build evidence with profile link + tweet snapshot
      const evidenceLines = [
        `## 👤 Reported Account`,
        ``
      ];
      
      // Add profile picture if available
      if (finalProfileInfo.avatarUrl) {
        evidenceLines.push(`![Profile Picture](${finalProfileInfo.avatarUrl})`);
        evidenceLines.push(``);
      }
      
      // Basic profile info
      evidenceLines.push(`| Field | Value |`);
      evidenceLines.push(`|-------|-------|`);
      evidenceLines.push(`| **Handle** | [@${reportedHandle}](https://x.com/${reportedHandle}) |`);
      evidenceLines.push(`| **Display Name** | ${finalProfileInfo.displayName || 'N/A'} |`);
      evidenceLines.push(`| **Verified** | ${finalProfileInfo.isVerified ? `Yes ✓` : 'No'} |`);
      evidenceLines.push(`| **Profile Link** | https://x.com/${reportedHandle} |`);
      
      // Add retweet/quote context if applicable
      if (finalTweetType.isRetweet || finalTweetType.isQuote) {
        evidenceLines.push(``);
        evidenceLines.push(`### 🔄 Context: ${finalTweetType.isRetweet ? 'Retweet' : 'Quote Tweet'}`);
        evidenceLines.push(``);
        
        if (finalTweetType.mainAuthor) {
          const role = reportedHandle === finalTweetType.mainAuthor 
            ? '**⚠️ REPORTED**' 
            : '';
          evidenceLines.push(`- **${finalTweetType.isRetweet ? 'Retweeted' : 'Quoted'} by:** @${finalTweetType.mainAuthor} ${role}`);
        }
        
        if (finalTweetType.originalAuthor) {
          const role = reportedHandle === finalTweetType.originalAuthor 
            ? '**⚠️ REPORTED**' 
            : '';
          evidenceLines.push(`- **Original author:** @${finalTweetType.originalAuthor} ${role}`);
        }
        
        // Explain why the reported account was chosen
        if (reportedHandle === finalTweetType.mainAuthor && finalTweetType.isRetweet) {
          evidenceLines.push(``);
          evidenceLines.push(`> 📢 Reporter flagged the **amplifier/retweeter** for spreading this content.`);
        } else if (reportedHandle === finalTweetType.originalAuthor) {
          evidenceLines.push(``);
          evidenceLines.push(`> 📢 Reporter flagged the **original content creator**.`);
        } else if (reportedHandle === finalTweetType.mainAuthor && finalTweetType.isQuote) {
          evidenceLines.push(``);
          evidenceLines.push(`> 📢 Reporter flagged the **quote tweeter** for their commentary.`);
        }
      }
      
      evidenceLines.push(``);
      evidenceLines.push(`---`);
      evidenceLines.push(``);
      
      // Tweet snapshot section
      evidenceLines.push(`## 📸 Tweet Snapshot`);
      evidenceLines.push(``);
      evidenceLines.push(`**Tweet Author:** ${snapshot.author.displayName || ''} (@${snapshot.author.handle || handle})`);
      evidenceLines.push(`**Date:** ${snapshot.timestamp ? new Date(snapshot.timestamp).toLocaleString() : 'Unknown'}`);
      evidenceLines.push(`**Tweet URL:** ${snapshot.url}`);
      evidenceLines.push(`**Archive Link:** [Create Archive](${archiveUrl})`);
      evidenceLines.push(``);
      evidenceLines.push(`### Tweet Content`);
      evidenceLines.push(`> ${snapshot.text || 'No text content'}`);
      evidenceLines.push(``);
      
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
      
      // Add Grok's opinion if provided
      if (grokResponse && grokResponse.trim()) {
        evidenceLines.push(`---`);
        evidenceLines.push(``);
        evidenceLines.push(`## 🤖 Grok's Analysis`);
        evidenceLines.push(``);
        evidenceLines.push(grokResponse.trim());
        evidenceLines.push(``);
      }
      
      if (additionalNotes) {
        evidenceLines.push(`---`);
        evidenceLines.push(``);
        evidenceLines.push(`## 📝 Reporter's Notes`);
        evidenceLines.push(additionalNotes);
      }
      
      const evidence = evidenceLines.join('\n');
      
      safeSendMessage({
        action: 'submitReport',
        handle: reportedHandle,
        category: selectedCategory.value,
        evidence: evidence
      }, (response) => {
        if (response && response.url) {
          window.open(response.url, '_blank');
          dialog.remove();
        } else if (response && response.error) {
          alert('Error: ' + response.error);
        } else {
          alert('Could not submit report. Please refresh the page and try again.');
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
