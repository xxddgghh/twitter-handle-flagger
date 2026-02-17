/**
 * Handle Transparency Dashboard
 * Search and view community reports on Twitter/X handles
 */

(function() {
  'use strict';

  // ===== Configuration =====
  const CONFIG = {
    githubRepo: 'xxddgghh/twitter-handle-flagger',
    handlesUrl: 'https://raw.githubusercontent.com/xxddgghh/twitter-handle-flagger/main/data/handles.json',
    issuesApiUrl: 'https://api.github.com/search/issues',
    cacheExpiry: 5 * 60 * 1000,
    maxRecentSearches: 5,
    issuesPerPage: 10
  };

  // ===== State =====
  let handlesDatabase = null;
  let currentHandle = null;
  let currentPage = 1;
  let totalIssues = 0;
  let allIssues = [];

  // ===== DOM Elements =====
  const elements = {
    // Theme
    themeToggle: document.getElementById('themeToggle'),
    // Hero
    heroSection: document.getElementById('heroSection'),
    searchInput: document.getElementById('searchInput'),
    searchClear: document.getElementById('searchClear'),
    searchDropdown: document.getElementById('searchDropdown'),
    recentSearches: document.getElementById('recentSearches'),
    recentTags: document.getElementById('recentTags'),
    totalHandles: document.getElementById('totalHandles'),
    totalCategories: document.getElementById('totalCategories'),
    // Results
    resultsSection: document.getElementById('resultsSection'),
    backBtn: document.getElementById('backBtn'),
    miniSearchInput: document.getElementById('miniSearchInput'),
    loadingState: document.getElementById('loadingState'),
    // Profile
    profileSection: document.getElementById('profileSection'),
    profileAvatar: document.getElementById('profileAvatar'),
    profileHandle: document.getElementById('profileHandle'),
    profileLink: document.getElementById('profileLink'),
    profileStatus: document.getElementById('profileStatus'),
    reportCount: document.getElementById('reportCount'),
    firstFlagged: document.getElementById('firstFlagged'),
    lastReport: document.getElementById('lastReport'),
    // Not Found
    notFoundSection: document.getElementById('notFoundSection'),
    notFoundHandle: document.getElementById('notFoundHandle'),
    reportBtn: document.getElementById('reportBtn'),
    // Reports
    reportsSection: document.getElementById('reportsSection'),
    reportsCount: document.getElementById('reportsCount'),
    reportsList: document.getElementById('reportsList'),
    reportsPagination: document.getElementById('reportsPagination'),
    loadMoreBtn: document.getElementById('loadMoreBtn')
  };

  // ===== Theme Management =====
  function initTheme() {
    const savedTheme = localStorage.getItem('theme');
    const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
    document.documentElement.setAttribute('data-theme', savedTheme || (prefersDark ? 'dark' : 'light'));
  }

  function toggleTheme() {
    const current = document.documentElement.getAttribute('data-theme');
    const next = current === 'dark' ? 'light' : 'dark';
    document.documentElement.setAttribute('data-theme', next);
    localStorage.setItem('theme', next);
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
      localStorage.setItem(key, JSON.stringify({ data, timestamp: Date.now() }));
    } catch (e) {
      console.warn('Cache failed:', e);
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
    localStorage.setItem('recentSearches', JSON.stringify(recent.slice(0, CONFIG.maxRecentSearches)));
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
    const cached = getCachedData('handlesDatabase');
    if (cached) {
      handlesDatabase = cached;
      updateHeroStats();
      return cached;
    }
    
    try {
      const response = await fetch(CONFIG.handlesUrl);
      if (!response.ok) throw new Error('Failed to fetch');
      const data = await response.json();
      handlesDatabase = data;
      setCachedData('handlesDatabase', data);
      updateHeroStats();
      return data;
    } catch (error) {
      console.error('Error fetching handles:', error);
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

  // ===== Search =====
  function filterHandles(query) {
    if (!handlesDatabase || !query) return [];
    
    const normalizedQuery = query.toLowerCase().replace('@', '');
    const matches = [];
    
    for (const [handle, info] of Object.entries(handlesDatabase.handles)) {
      if (handle.includes(normalizedQuery)) {
        matches.push({ handle, info });
      }
    }
    
    matches.sort((a, b) => {
      if (a.handle === normalizedQuery) return -1;
      if (b.handle === normalizedQuery) return 1;
      return a.handle.indexOf(normalizedQuery) - b.handle.indexOf(normalizedQuery);
    });
    
    return matches;
  }

  function showDropdown(handles) {
    if (!handles || handles.length === 0) {
      elements.searchDropdown.classList.remove('visible');
      return;
    }
    
    elements.searchDropdown.innerHTML = handles.slice(0, 8).map(({ handle, info }) => {
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
    
    elements.searchDropdown.querySelectorAll('.dropdown-item').forEach(item => {
      item.addEventListener('click', () => {
        elements.searchInput.value = item.dataset.handle;
        elements.searchDropdown.classList.remove('visible');
        searchHandle(item.dataset.handle);
      });
    });
  }

  async function searchHandle(handle) {
    if (!handle) return;
    
    const normalizedHandle = handle.toLowerCase().replace('@', '');
    currentHandle = normalizedHandle;
    currentPage = 1;
    allIssues = [];
    
    // Update URL
    history.pushState(null, '', `?handle=${normalizedHandle}`);
    
    // Switch to results view
    showResultsView();
    showState('loading');
    
    // Ensure database is loaded
    if (!handlesDatabase) {
      await fetchHandlesDatabase();
    }
    
    // Check if handle exists in database
    const handleInfo = handlesDatabase?.handles[normalizedHandle];
    
    // Fetch issues
    const issuesData = await fetchIssuesForHandle(normalizedHandle);
    totalIssues = issuesData.total_count || 0;
    allIssues = issuesData.items || [];
    
    if (handleInfo) {
      addRecentSearch(normalizedHandle);
      renderProfile(normalizedHandle, handleInfo);
      renderReports(allIssues);
      showState('found');
    } else if (allIssues.length > 0) {
      addRecentSearch(normalizedHandle);
      renderPendingProfile(normalizedHandle, issuesData);
      renderReports(allIssues);
      showState('found');
    } else {
      renderNotFound(normalizedHandle);
      showState('notFound');
    }
  }

  // ===== View Management =====
  function showHeroView() {
    elements.heroSection.classList.remove('hidden');
    elements.resultsSection.classList.add('hidden');
    history.pushState(null, '', window.location.pathname);
  }

  function showResultsView() {
    elements.heroSection.classList.add('hidden');
    elements.resultsSection.classList.remove('hidden');
  }

  function showState(state) {
    elements.loadingState.classList.add('hidden');
    elements.profileSection.classList.add('hidden');
    elements.notFoundSection.classList.add('hidden');
    elements.reportsSection.classList.add('hidden');
    
    switch (state) {
      case 'loading':
        elements.loadingState.classList.remove('hidden');
        break;
      case 'found':
        elements.profileSection.classList.remove('hidden');
        elements.reportsSection.classList.remove('hidden');
        break;
      case 'notFound':
        elements.notFoundSection.classList.remove('hidden');
        break;
    }
  }

  function updateHeroStats() {
    if (!handlesDatabase) return;
    elements.totalHandles.textContent = Object.keys(handlesDatabase.handles).length;
    elements.totalCategories.textContent = Object.keys(handlesDatabase.categories).length;
  }

  // ===== Rendering =====
  function renderProfile(handle, info) {
    const category = handlesDatabase?.categories[info.category];
    
    // Avatar
    elements.profileAvatar.src = `https://unavatar.io/twitter/${handle}`;
    elements.profileAvatar.onerror = () => {
      elements.profileAvatar.src = 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="%23536471"><circle cx="12" cy="8" r="4"/><path d="M12 14c-6 0-8 3-8 6v2h16v-2c0-3-2-6-8-6z"/></svg>';
    };
    
    // Handle info
    elements.profileHandle.textContent = `@${handle}`;
    elements.profileLink.href = `https://x.com/${handle}`;
    
    // Status badge
    if (category) {
      elements.profileStatus.innerHTML = `
        <div class="status-badge" style="background: ${category.bgColor}; border: 2px solid ${category.borderColor};">
          <span class="status-badge-dot" style="background: ${category.color};"></span>
          <div>
            <div class="status-badge-label" style="color: ${category.color};">${category.label}</div>
            <div class="status-badge-description">${category.description || ''}</div>
          </div>
        </div>
      `;
    }
    
    // Stats
    elements.reportCount.textContent = info.reportCount || 1;
    elements.firstFlagged.textContent = info.addedAt ? formatDate(info.addedAt) : '-';
    elements.lastReport.textContent = '-';
  }

  function renderPendingProfile(handle, issuesData) {
    elements.profileAvatar.src = `https://unavatar.io/twitter/${handle}`;
    elements.profileAvatar.onerror = () => {
      elements.profileAvatar.src = 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="%23536471"><circle cx="12" cy="8" r="4"/><path d="M12 14c-6 0-8 3-8 6v2h16v-2c0-3-2-6-8-6z"/></svg>';
    };
    
    elements.profileHandle.textContent = `@${handle}`;
    elements.profileLink.href = `https://x.com/${handle}`;
    
    elements.profileStatus.innerHTML = `
      <div class="status-badge" style="background: rgba(255, 173, 31, 0.15); border: 2px solid #ffad1f;">
        <span class="status-badge-dot" style="background: #ffad1f;"></span>
        <div>
          <div class="status-badge-label" style="color: #ffad1f;">Pending Review</div>
          <div class="status-badge-description">Reports submitted, awaiting threshold for confirmation</div>
        </div>
      </div>
    `;
    
    elements.reportCount.textContent = issuesData.total_count || 0;
    elements.firstFlagged.textContent = '-';
    elements.lastReport.textContent = issuesData.items.length > 0 ? formatDate(issuesData.items[0].created_at) : '-';
  }

  function renderNotFound(handle) {
    elements.notFoundHandle.textContent = `@${handle}`;
    elements.reportBtn.href = `https://github.com/${CONFIG.githubRepo}/issues/new?title=${encodeURIComponent(`[REPORT] @${handle} - category`)}&body=${encodeURIComponent(`## Report for @${handle}\n\n**Category:** (paid_promoter, propaganda, anti_india, pro_bharat)\n\n**Evidence:**\n\n`)}`;
  }

  function renderReports(issues) {
    elements.reportsCount.textContent = `${totalIssues} report${totalIssues !== 1 ? 's' : ''}`;
    
    if (!issues || issues.length === 0) {
      elements.reportsList.innerHTML = `
        <div class="report-card">
          <p style="text-align: center; color: var(--text-secondary); padding: 20px;">
            No detailed reports available yet.
          </p>
        </div>
      `;
      elements.reportsPagination.classList.add('hidden');
      return;
    }
    
    elements.reportsList.innerHTML = issues.map(issue => renderReportCard(issue)).join('');
    
    // Update last report date
    if (issues.length > 0) {
      elements.lastReport.textContent = formatDate(issues[0].created_at);
    }
    
    // Pagination
    if (totalIssues > currentPage * CONFIG.issuesPerPage) {
      elements.reportsPagination.classList.remove('hidden');
    } else {
      elements.reportsPagination.classList.add('hidden');
    }
  }

  function renderReportCard(issue) {
    // Extract category
    const categoryLabel = issue.labels.find(l => 
      ['paid_promoter', 'propaganda', 'anti_india', 'pro_bharat', 'pending', 'verified'].includes(l.name)
    );
    const category = categoryLabel ? handlesDatabase?.categories[categoryLabel.name] : null;
    
    // Parse issue body for structured data
    const parsed = parseIssueBody(issue.body || '');
    
    return `
      <div class="report-card">
        <div class="report-header">
          <div class="report-meta">
            <img src="https://github.com/${issue.user.login}.png?size=72" alt="${issue.user.login}" class="reporter-avatar">
            <div class="reporter-info">
              <span class="reporter-name">${issue.user.login}</span>
              <span class="report-date">${formatDate(issue.created_at)}</span>
            </div>
          </div>
          ${category ? `
            <span class="report-category" style="background: ${category.bgColor}; color: ${category.color}; border: 1px solid ${category.borderColor};">
              ${category.label}
            </span>
          ` : categoryLabel ? `
            <span class="report-category" style="background: rgba(255, 173, 31, 0.15); color: #ffad1f; border: 1px solid #ffad1f;">
              ${categoryLabel.name}
            </span>
          ` : ''}
        </div>
        
        <div class="report-content">
          ${parsed.evidence ? `
            <div class="report-evidence">${escapeHtml(parsed.evidence)}</div>
          ` : ''}
          
          ${parsed.tweetText || parsed.tweetUrl ? `
            <div class="report-tweet-preview">
              <div class="tweet-label">Reported Tweet</div>
              ${parsed.tweetText ? `<div class="tweet-text">"${escapeHtml(parsed.tweetText)}"</div>` : ''}
              ${parsed.tweetUrl ? `
                <a href="${parsed.tweetUrl}" target="_blank" rel="noopener" class="tweet-link">
                  View original tweet →
                </a>
              ` : ''}
            </div>
          ` : ''}
        </div>
        
        <div class="report-footer">
          <a href="${issue.html_url}" target="_blank" rel="noopener" class="report-link">
            View full report on GitHub →
          </a>
        </div>
      </div>
    `;
  }

  function parseIssueBody(body) {
    const result = {
      evidence: '',
      tweetText: '',
      tweetUrl: '',
      grokAnalysis: ''
    };
    
    // Extract evidence/notes
    const evidenceMatch = body.match(/###?\s*(?:Evidence|Reporter's Notes|Notes)[\s\S]*?\n([\s\S]*?)(?=\n##|$)/i);
    if (evidenceMatch) {
      result.evidence = evidenceMatch[1].trim().slice(0, 300);
      if (evidenceMatch[1].trim().length > 300) result.evidence += '...';
    }
    
    // Extract tweet text
    const tweetTextMatch = body.match(/###?\s*Tweet Content[\s\S]*?>\s*([\s\S]*?)(?=\n##|\n###|$)/i);
    if (tweetTextMatch) {
      result.tweetText = tweetTextMatch[1].trim().slice(0, 200);
      if (tweetTextMatch[1].trim().length > 200) result.tweetText += '...';
    }
    
    // Extract tweet URL
    const tweetUrlMatch = body.match(/\*\*Tweet URL:\*\*\s*(https:\/\/(?:twitter\.com|x\.com)\/[^\s\n]+)/i);
    if (tweetUrlMatch) {
      result.tweetUrl = tweetUrlMatch[1];
    }
    
    // Extract Grok analysis
    const grokMatch = body.match(/###?\s*(?:Grok's (?:Opinion|Analysis))[\s\S]*?\n([\s\S]*?)(?=\n##|$)/i);
    if (grokMatch) {
      result.grokAnalysis = grokMatch[1].trim().slice(0, 200);
    }
    
    // Fallback: use first meaningful text
    if (!result.evidence && !result.tweetText) {
      const fallback = body.replace(/#+\s*[^\n]+\n/g, '').trim();
      result.evidence = fallback.slice(0, 200);
      if (fallback.length > 200) result.evidence += '...';
    }
    
    return result;
  }

  // ===== Utilities =====
  function formatDate(dateString) {
    const date = new Date(dateString);
    const now = new Date();
    const diffMs = now - date;
    const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
    
    if (diffDays === 0) return 'Today';
    if (diffDays === 1) return 'Yesterday';
    if (diffDays < 7) return `${diffDays}d ago`;
    if (diffDays < 30) return `${Math.floor(diffDays / 7)}w ago`;
    if (diffDays < 365) return `${Math.floor(diffDays / 30)}mo ago`;
    
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
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
    const handleSearch = debounce((query) => {
      elements.searchClear.classList.toggle('visible', query.length > 0);
      if (query.length > 0) {
        showDropdown(filterHandles(query));
      } else {
        elements.searchDropdown.classList.remove('visible');
      }
    }, 150);
    
    elements.searchInput.addEventListener('input', (e) => handleSearch(e.target.value.trim()));
    
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
    });
    
    // Close dropdown on outside click
    document.addEventListener('click', (e) => {
      if (!e.target.closest('.search-container')) {
        elements.searchDropdown.classList.remove('visible');
      }
    });
    
    // Back button
    elements.backBtn.addEventListener('click', showHeroView);
    
    // Mini search
    elements.miniSearchInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        const query = e.target.value.trim();
        if (query) {
          searchHandle(query);
          e.target.value = '';
        }
      }
    });
    
    // Load more
    elements.loadMoreBtn.addEventListener('click', async () => {
      if (!currentHandle) return;
      
      currentPage++;
      elements.loadMoreBtn.textContent = 'Loading...';
      elements.loadMoreBtn.disabled = true;
      
      const issuesData = await fetchIssuesForHandle(currentHandle, currentPage);
      
      if (issuesData.items && issuesData.items.length > 0) {
        allIssues = [...allIssues, ...issuesData.items];
        const newHtml = issuesData.items.map(issue => renderReportCard(issue)).join('');
        elements.reportsList.insertAdjacentHTML('beforeend', newHtml);
      }
      
      elements.loadMoreBtn.innerHTML = 'Load more reports <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="6 9 12 15 18 9"></polyline></svg>';
      elements.loadMoreBtn.disabled = false;
      
      if (totalIssues <= currentPage * CONFIG.issuesPerPage) {
        elements.reportsPagination.classList.add('hidden');
      }
    });
  }

  // ===== Initialization =====
  async function init() {
    initTheme();
    setupEventListeners();
    await fetchHandlesDatabase();
    renderRecentSearches();
    
    // Check for handle in URL
    const urlParams = new URLSearchParams(window.location.search);
    const handleParam = urlParams.get('handle');
    
    if (handleParam) {
      elements.searchInput.value = handleParam;
      elements.searchClear.classList.add('visible');
      searchHandle(handleParam);
    }
  }

  // Start
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
