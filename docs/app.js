/**
 * Handle Transparency Dashboard
 * Search and view community reports on Twitter/X handles
 */

(function() {
  'use strict';

  // ===== Configuration =====
  const CONFIG = {
    // GitHub repository info
    githubRepo: 'xxddgghh/twitter-handle-flagger',
    
    // API URLs
    handlesUrl: 'https://raw.githubusercontent.com/xxddgghh/twitter-handle-flagger/main/data/handles.json',
    issuesApiUrl: 'https://api.github.com/search/issues',
    
    // Cache settings
    cacheExpiry: 5 * 60 * 1000, // 5 minutes
    maxRecentSearches: 5,
    
    // Pagination
    issuesPerPage: 10
  };

  // ===== State =====
  let handlesDatabase = null;
  let currentHandle = null;
  let currentPage = 1;
  let totalIssues = 0;

  // ===== DOM Elements =====
  const elements = {
    themeToggle: document.getElementById('themeToggle'),
    searchInput: document.getElementById('searchInput'),
    searchClear: document.getElementById('searchClear'),
    searchDropdown: document.getElementById('searchDropdown'),
    recentSearches: document.getElementById('recentSearches'),
    recentTags: document.getElementById('recentTags'),
    resultsSection: document.getElementById('resultsSection'),
    emptyState: document.getElementById('emptyState'),
    loadingState: document.getElementById('loadingState'),
    profileCard: document.getElementById('profileCard'),
    notFoundState: document.getElementById('notFoundState'),
    feedbackSection: document.getElementById('feedbackSection'),
    reportsList: document.getElementById('reportsList'),
    reportsPagination: document.getElementById('reportsPagination'),
    loadMoreBtn: document.getElementById('loadMoreBtn'),
    // Stats
    totalHandles: document.getElementById('totalHandles'),
    totalCategories: document.getElementById('totalCategories'),
    totalReports: document.getElementById('totalReports'),
    // Profile elements
    profileAvatar: document.getElementById('profileAvatar'),
    profileHandle: document.getElementById('profileHandle'),
    profileLink: document.getElementById('profileLink'),
    profileBadges: document.getElementById('profileBadges'),
    reportCount: document.getElementById('reportCount'),
    firstFlagged: document.getElementById('firstFlagged'),
    lastReport: document.getElementById('lastReport'),
    // Not found
    notFoundHandle: document.getElementById('notFoundHandle'),
    reportBtn: document.getElementById('reportBtn')
  };

  // ===== Theme Management =====
  function initTheme() {
    const savedTheme = localStorage.getItem('theme');
    const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
    const theme = savedTheme || (prefersDark ? 'dark' : 'light');
    document.documentElement.setAttribute('data-theme', theme);
  }

  function toggleTheme() {
    const currentTheme = document.documentElement.getAttribute('data-theme');
    const newTheme = currentTheme === 'dark' ? 'light' : 'dark';
    document.documentElement.setAttribute('data-theme', newTheme);
    localStorage.setItem('theme', newTheme);
  }

  // ===== Cache Management =====
  function getCachedData(key) {
    try {
      const cached = localStorage.getItem(key);
      if (!cached) return null;
      
      const { data, timestamp } = JSON.parse(cached);
      if (Date.now() - timestamp > CONFIG.cacheExpiry) {
        localStorage.removeItem(key);
        return null;
      }
      return data;
    } catch (e) {
      return null;
    }
  }

  function setCachedData(key, data) {
    try {
      localStorage.setItem(key, JSON.stringify({
        data,
        timestamp: Date.now()
      }));
    } catch (e) {
      // localStorage full or disabled
      console.warn('Failed to cache data:', e);
    }
  }

  // ===== Recent Searches =====
  function getRecentSearches() {
    try {
      return JSON.parse(localStorage.getItem('recentSearches')) || [];
    } catch (e) {
      return [];
    }
  }

  function addRecentSearch(handle) {
    const recent = getRecentSearches().filter(h => h !== handle);
    recent.unshift(handle);
    const trimmed = recent.slice(0, CONFIG.maxRecentSearches);
    localStorage.setItem('recentSearches', JSON.stringify(trimmed));
    renderRecentSearches();
  }

  function removeRecentSearch(handle) {
    const recent = getRecentSearches().filter(h => h !== handle);
    localStorage.setItem('recentSearches', JSON.stringify(recent));
    renderRecentSearches();
  }

  function renderRecentSearches() {
    const recent = getRecentSearches();
    
    if (recent.length === 0) {
      elements.recentSearches.classList.remove('visible');
      return;
    }
    
    elements.recentSearches.classList.add('visible');
    elements.recentTags.innerHTML = recent.map(handle => `
      <div class="recent-tag" data-handle="${handle}">
        <span>@${handle}</span>
        <span class="recent-tag-remove" data-handle="${handle}">×</span>
      </div>
    `).join('');
    
    // Add click handlers
    elements.recentTags.querySelectorAll('.recent-tag').forEach(tag => {
      tag.addEventListener('click', (e) => {
        if (e.target.classList.contains('recent-tag-remove')) {
          e.stopPropagation();
          removeRecentSearch(tag.dataset.handle);
        } else {
          elements.searchInput.value = tag.dataset.handle;
          searchHandle(tag.dataset.handle);
        }
      });
    });
  }

  // ===== Data Fetching =====
  async function fetchHandlesDatabase() {
    // Check cache first
    const cached = getCachedData('handlesDatabase');
    if (cached) {
      handlesDatabase = cached;
      updateOverviewStats();
      return cached;
    }
    
    try {
      const response = await fetch(CONFIG.handlesUrl);
      if (!response.ok) throw new Error('Failed to fetch handles database');
      
      const data = await response.json();
      handlesDatabase = data;
      setCachedData('handlesDatabase', data);
      updateOverviewStats();
      return data;
    } catch (error) {
      console.error('Error fetching handles database:', error);
      return null;
    }
  }

  async function fetchIssuesForHandle(handle, page = 1) {
    const cacheKey = `issues_${handle}_${page}`;
    const cached = getCachedData(cacheKey);
    if (cached) return cached;
    
    try {
      const query = encodeURIComponent(`repo:${CONFIG.githubRepo} @${handle} in:title is:issue`);
      const url = `${CONFIG.issuesApiUrl}?q=${query}&per_page=${CONFIG.issuesPerPage}&page=${page}&sort=created&order=desc`;
      
      const response = await fetch(url);
      if (!response.ok) {
        if (response.status === 403) {
          console.warn('GitHub API rate limit reached');
          return { items: [], total_count: 0, rate_limited: true };
        }
        throw new Error('Failed to fetch issues');
      }
      
      const data = await response.json();
      setCachedData(cacheKey, data);
      return data;
    } catch (error) {
      console.error('Error fetching issues:', error);
      return { items: [], total_count: 0 };
    }
  }

  // ===== Search Functionality =====
  function showDropdown(handles) {
    if (!handles || handles.length === 0) {
      elements.searchDropdown.classList.remove('visible');
      return;
    }
    
    elements.searchDropdown.innerHTML = handles.slice(0, 10).map(({ handle, info }) => {
      const category = handlesDatabase?.categories[info.category];
      return `
        <div class="dropdown-item" data-handle="${handle}">
          <span class="dropdown-handle">@${handle}</span>
          ${category ? `
            <span class="dropdown-badge" style="background: ${category.bgColor}; color: ${category.color}; border: 1px solid ${category.borderColor};">
              ${category.label}
            </span>
          ` : ''}
        </div>
      `;
    }).join('');
    
    elements.searchDropdown.classList.add('visible');
    
    // Add click handlers
    elements.searchDropdown.querySelectorAll('.dropdown-item').forEach(item => {
      item.addEventListener('click', () => {
        const handle = item.dataset.handle;
        elements.searchInput.value = handle;
        elements.searchDropdown.classList.remove('visible');
        searchHandle(handle);
      });
    });
  }

  function filterHandles(query) {
    if (!handlesDatabase || !query) return [];
    
    const normalizedQuery = query.toLowerCase().replace('@', '');
    const matches = [];
    
    for (const [handle, info] of Object.entries(handlesDatabase.handles)) {
      if (handle.includes(normalizedQuery)) {
        matches.push({ handle, info });
      }
    }
    
    // Sort by relevance (exact match first, then by position)
    matches.sort((a, b) => {
      if (a.handle === normalizedQuery) return -1;
      if (b.handle === normalizedQuery) return 1;
      return a.handle.indexOf(normalizedQuery) - b.handle.indexOf(normalizedQuery);
    });
    
    return matches;
  }

  async function searchHandle(handle) {
    if (!handle) return;
    
    const normalizedHandle = handle.toLowerCase().replace('@', '');
    currentHandle = normalizedHandle;
    currentPage = 1;
    
    // Update URL
    history.pushState(null, '', `?handle=${normalizedHandle}`);
    
    // Show loading state
    showState('loading');
    
    // Ensure database is loaded
    if (!handlesDatabase) {
      await fetchHandlesDatabase();
    }
    
    // Check if handle exists in database
    const handleInfo = handlesDatabase?.handles[normalizedHandle];
    
    // Fetch issues regardless of whether handle is in database
    const issuesData = await fetchIssuesForHandle(normalizedHandle);
    totalIssues = issuesData.total_count || 0;
    
    if (handleInfo) {
      // Handle is flagged - show profile card
      addRecentSearch(normalizedHandle);
      renderProfileCard(normalizedHandle, handleInfo);
      renderReports(issuesData.items);
      showState('found');
    } else if (issuesData.items.length > 0) {
      // Handle has reports but not yet in database (pending)
      addRecentSearch(normalizedHandle);
      renderPendingProfile(normalizedHandle, issuesData);
      renderReports(issuesData.items);
      showState('found');
    } else {
      // Handle not found
      renderNotFound(normalizedHandle);
      showState('notFound');
    }
  }

  // ===== Rendering =====
  function showState(state) {
    elements.emptyState.classList.add('hidden');
    elements.loadingState.classList.add('hidden');
    elements.profileCard.classList.add('hidden');
    elements.notFoundState.classList.add('hidden');
    elements.feedbackSection.classList.add('hidden');
    
    switch (state) {
      case 'empty':
        elements.emptyState.classList.remove('hidden');
        break;
      case 'loading':
        elements.loadingState.classList.remove('hidden');
        break;
      case 'found':
        elements.profileCard.classList.remove('hidden');
        elements.feedbackSection.classList.remove('hidden');
        break;
      case 'notFound':
        elements.notFoundState.classList.remove('hidden');
        break;
    }
  }

  function updateOverviewStats() {
    if (!handlesDatabase) return;
    
    const handleCount = Object.keys(handlesDatabase.handles).length;
    const categoryCount = Object.keys(handlesDatabase.categories).length;
    const totalReportCount = Object.values(handlesDatabase.handles)
      .reduce((sum, h) => sum + (h.reportCount || 1), 0);
    
    elements.totalHandles.textContent = handleCount;
    elements.totalCategories.textContent = categoryCount;
    elements.totalReports.textContent = totalReportCount;
  }

  function renderProfileCard(handle, info) {
    const category = handlesDatabase?.categories[info.category];
    
    // Avatar (use Twitter's CDN)
    elements.profileAvatar.src = `https://unavatar.io/twitter/${handle}`;
    elements.profileAvatar.onerror = () => {
      elements.profileAvatar.src = 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="%23536471"><circle cx="12" cy="8" r="4"/><path d="M12 14c-6 0-8 3-8 6v2h16v-2c0-3-2-6-8-6z"/></svg>';
    };
    
    // Handle and link
    elements.profileHandle.textContent = `@${handle}`;
    elements.profileLink.href = `https://x.com/${handle}`;
    
    // Badges
    if (category) {
      elements.profileBadges.innerHTML = `
        <span class="badge" style="background: ${category.bgColor}; color: ${category.color}; border: 1px solid ${category.borderColor};">
          <span class="badge-dot" style="background: ${category.color};"></span>
          ${category.label}
        </span>
      `;
    } else {
      elements.profileBadges.innerHTML = '';
    }
    
    // Stats
    elements.reportCount.textContent = info.reportCount || 1;
    elements.firstFlagged.textContent = info.addedAt ? formatDate(info.addedAt) : '-';
    elements.lastReport.textContent = '-'; // Will be updated from issues
  }

  function renderPendingProfile(handle, issuesData) {
    // Avatar
    elements.profileAvatar.src = `https://unavatar.io/twitter/${handle}`;
    elements.profileAvatar.onerror = () => {
      elements.profileAvatar.src = 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="%23536471"><circle cx="12" cy="8" r="4"/><path d="M12 14c-6 0-8 3-8 6v2h16v-2c0-3-2-6-8-6z"/></svg>';
    };
    
    // Handle and link
    elements.profileHandle.textContent = `@${handle}`;
    elements.profileLink.href = `https://x.com/${handle}`;
    
    // Pending badge
    elements.profileBadges.innerHTML = `
      <span class="badge" style="background: rgba(255, 173, 31, 0.15); color: #ffad1f; border: 1px solid #ffad1f;">
        <span class="badge-dot" style="background: #ffad1f;"></span>
        Pending Review
      </span>
    `;
    
    // Stats
    elements.reportCount.textContent = issuesData.total_count || 0;
    elements.firstFlagged.textContent = '-';
    if (issuesData.items.length > 0) {
      elements.lastReport.textContent = formatDate(issuesData.items[0].created_at);
    }
  }

  function renderNotFound(handle) {
    elements.notFoundHandle.textContent = `@${handle}`;
    elements.reportBtn.href = `https://github.com/${CONFIG.githubRepo}/issues/new?title=${encodeURIComponent(`[REPORT] @${handle} - category`)}&body=${encodeURIComponent(`## Report for @${handle}\n\n**Category:** (choose: paid_promoter, propaganda, anti_india, pro_bharat)\n\n**Evidence:**\n\n`)}`;
  }

  function renderReports(issues) {
    if (!issues || issues.length === 0) {
      elements.reportsList.innerHTML = `
        <div class="report-card">
          <p style="text-align: center; color: var(--text-secondary);">No detailed reports found. Check GitHub for more information.</p>
        </div>
      `;
      elements.reportsPagination.classList.add('hidden');
      return;
    }
    
    elements.reportsList.innerHTML = issues.map(issue => {
      // Extract category from labels or title
      const categoryLabel = issue.labels.find(l => 
        ['paid_promoter', 'propaganda', 'anti_india', 'pro_bharat', 'pending'].includes(l.name)
      );
      
      // Extract snippet from body
      let snippet = issue.body || '';
      // Try to get the "Evidence/Notes" section
      const evidenceMatch = snippet.match(/### Evidence.*?\n([\s\S]*?)(?=\n##|$)/i);
      if (evidenceMatch) {
        snippet = evidenceMatch[1].trim();
      }
      snippet = snippet.slice(0, 200) + (snippet.length > 200 ? '...' : '');
      
      const category = categoryLabel ? handlesDatabase?.categories[categoryLabel.name] : null;
      
      return `
        <div class="report-card">
          <div class="report-header">
            <div class="report-meta">
              <img src="https://github.com/${issue.user.login}.png?size=48" alt="${issue.user.login}" class="reporter-avatar">
              <span class="reporter-name">${issue.user.login}</span>
              <span class="report-date">${formatDate(issue.created_at)}</span>
            </div>
            ${category ? `
              <span class="report-category" style="background: ${category.bgColor}; color: ${category.color};">
                ${category.label}
              </span>
            ` : categoryLabel ? `
              <span class="report-category" style="background: rgba(255, 173, 31, 0.15); color: #ffad1f;">
                ${categoryLabel.name}
              </span>
            ` : ''}
          </div>
          ${snippet ? `
            <div class="report-content">
              <blockquote>${escapeHtml(snippet)}</blockquote>
            </div>
          ` : ''}
          <div class="report-footer">
            <a href="${issue.html_url}" target="_blank" rel="noopener" class="report-link">
              View full report →
            </a>
          </div>
        </div>
      `;
    }).join('');
    
    // Update last report date
    if (issues.length > 0) {
      elements.lastReport.textContent = formatDate(issues[0].created_at);
    }
    
    // Show/hide pagination
    if (totalIssues > currentPage * CONFIG.issuesPerPage) {
      elements.reportsPagination.classList.remove('hidden');
    } else {
      elements.reportsPagination.classList.add('hidden');
    }
  }

  // ===== Utility Functions =====
  function formatDate(dateString) {
    const date = new Date(dateString);
    const now = new Date();
    const diffMs = now - date;
    const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
    
    if (diffDays === 0) return 'Today';
    if (diffDays === 1) return 'Yesterday';
    if (diffDays < 7) return `${diffDays} days ago`;
    if (diffDays < 30) return `${Math.floor(diffDays / 7)} weeks ago`;
    if (diffDays < 365) return `${Math.floor(diffDays / 30)} months ago`;
    
    return date.toLocaleDateString('en-US', { 
      year: 'numeric', 
      month: 'short', 
      day: 'numeric' 
    });
  }

  function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }

  function debounce(fn, delay) {
    let timeoutId;
    return (...args) => {
      clearTimeout(timeoutId);
      timeoutId = setTimeout(() => fn(...args), delay);
    };
  }

  // ===== Event Handlers =====
  function setupEventListeners() {
    // Theme toggle
    elements.themeToggle.addEventListener('click', toggleTheme);
    
    // Search input
    elements.searchInput.addEventListener('input', debounce((e) => {
      const query = e.target.value.trim();
      
      // Show/hide clear button
      elements.searchClear.classList.toggle('visible', query.length > 0);
      
      // Show dropdown with matches
      if (query.length > 0) {
        const matches = filterHandles(query);
        showDropdown(matches);
      } else {
        elements.searchDropdown.classList.remove('visible');
      }
    }, 150));
    
    // Search on Enter
    elements.searchInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        const query = elements.searchInput.value.trim();
        if (query) {
          elements.searchDropdown.classList.remove('visible');
          searchHandle(query);
        }
      } else if (e.key === 'Escape') {
        elements.searchDropdown.classList.remove('visible');
      }
    });
    
    // Clear search
    elements.searchClear.addEventListener('click', () => {
      elements.searchInput.value = '';
      elements.searchClear.classList.remove('visible');
      elements.searchDropdown.classList.remove('visible');
      showState('empty');
      history.pushState(null, '', window.location.pathname);
    });
    
    // Close dropdown on outside click
    document.addEventListener('click', (e) => {
      if (!e.target.closest('.search-container')) {
        elements.searchDropdown.classList.remove('visible');
      }
    });
    
    // Load more reports
    elements.loadMoreBtn.addEventListener('click', async () => {
      if (!currentHandle) return;
      
      currentPage++;
      elements.loadMoreBtn.textContent = 'Loading...';
      elements.loadMoreBtn.disabled = true;
      
      const issuesData = await fetchIssuesForHandle(currentHandle, currentPage);
      
      if (issuesData.items.length > 0) {
        // Append new reports
        const newReportsHtml = issuesData.items.map(issue => {
          // Same rendering logic as renderReports
          const categoryLabel = issue.labels.find(l => 
            ['paid_promoter', 'propaganda', 'anti_india', 'pro_bharat', 'pending'].includes(l.name)
          );
          let snippet = issue.body || '';
          const evidenceMatch = snippet.match(/### Evidence.*?\n([\s\S]*?)(?=\n##|$)/i);
          if (evidenceMatch) snippet = evidenceMatch[1].trim();
          snippet = snippet.slice(0, 200) + (snippet.length > 200 ? '...' : '');
          
          const category = categoryLabel ? handlesDatabase?.categories[categoryLabel.name] : null;
          
          return `
            <div class="report-card">
              <div class="report-header">
                <div class="report-meta">
                  <img src="https://github.com/${issue.user.login}.png?size=48" alt="${issue.user.login}" class="reporter-avatar">
                  <span class="reporter-name">${issue.user.login}</span>
                  <span class="report-date">${formatDate(issue.created_at)}</span>
                </div>
                ${category ? `
                  <span class="report-category" style="background: ${category.bgColor}; color: ${category.color};">
                    ${category.label}
                  </span>
                ` : ''}
              </div>
              ${snippet ? `
                <div class="report-content">
                  <blockquote>${escapeHtml(snippet)}</blockquote>
                </div>
              ` : ''}
              <div class="report-footer">
                <a href="${issue.html_url}" target="_blank" rel="noopener" class="report-link">
                  View full report →
                </a>
              </div>
            </div>
          `;
        }).join('');
        
        elements.reportsList.insertAdjacentHTML('beforeend', newReportsHtml);
      }
      
      // Update button
      elements.loadMoreBtn.textContent = 'Load more reports';
      elements.loadMoreBtn.disabled = false;
      
      // Hide if no more
      if (totalIssues <= currentPage * CONFIG.issuesPerPage) {
        elements.reportsPagination.classList.add('hidden');
      }
    });
  }

  // ===== Initialization =====
  async function init() {
    // Initialize theme
    initTheme();
    
    // Setup event listeners
    setupEventListeners();
    
    // Load handles database
    await fetchHandlesDatabase();
    
    // Render recent searches
    renderRecentSearches();
    
    // Check for handle in URL
    const urlParams = new URLSearchParams(window.location.search);
    const handleParam = urlParams.get('handle');
    
    if (handleParam) {
      elements.searchInput.value = handleParam;
      elements.searchClear.classList.add('visible');
      searchHandle(handleParam);
    } else {
      showState('empty');
    }
  }

  // Start the app
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
