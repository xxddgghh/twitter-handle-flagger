/**
 * Handle Transparency Dashboard
 */
(function() {
  'use strict';

  const CONFIG = {
    githubRepo: 'xxddgghh/twitter-handle-flagger',
    handlesUrl: 'https://raw.githubusercontent.com/xxddgghh/twitter-handle-flagger/main/data/handles.json',
    issuesApiUrl: 'https://api.github.com/search/issues',
    cacheExpiry: 5 * 60 * 1000,
    maxRecent: 5,
    perPage: 10,
    topCount: 10
  };

  let db = null;
  let currentHandle = null;
  let currentPage = 1;
  let totalIssues = 0;
  let profilesShown = CONFIG.topCount;

  // DOM
  const $ = id => document.getElementById(id);
  const el = {
    themeToggle: $('themeToggle'),
    landingPage: $('landingPage'),
    resultsPage: $('resultsPage'),
    searchInput: $('searchInput'),
    searchClear: $('searchClear'),
    searchDropdown: $('searchDropdown'),
    recentSearches: $('recentSearches'),
    recentTags: $('recentTags'),
    categoriesAccordion: $('categoriesAccordion'),
    profilesList: $('profilesList'),
    viewAllBtn: $('viewAllBtn'),
    totalHandles: $('totalHandles'),
    totalCategories: $('totalCategories'),
    backBtn: $('backBtn'),
    miniSearch: $('miniSearch'),
    loading: $('loading'),
    profileCard: $('profileCard'),
    profileAvatar: $('profileAvatar'),
    profileHandle: $('profileHandle'),
    profileLink: $('profileLink'),
    profileBadge: $('profileBadge'),
    reportCount: $('reportCount'),
    uniqueReporters: $('uniqueReporters'),
    firstFlagged: $('firstFlagged'),
    lastReport: $('lastReport'),
    profileSummary: $('profileSummary'),
    summaryText: $('summaryText'),
    grokSection: $('grokSection'),
    grokCount: $('grokCount'),
    grokList: $('grokList'),
    notFound: $('notFound'),
    notFoundHandle: $('notFoundHandle'),
    reportBtn: $('reportBtn'),
    reportsSection: $('reportsSection'),
    reportsCount: $('reportsCount'),
    reportsList: $('reportsList'),
    loadMoreBtn: $('loadMoreBtn')
  };

  // Theme
  function initTheme() {
    const saved = localStorage.getItem('theme');
    const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
    document.documentElement.setAttribute('data-theme', saved || (prefersDark ? 'dark' : 'light'));
  }

  function toggleTheme() {
    const current = document.documentElement.getAttribute('data-theme');
    const next = current === 'dark' ? 'light' : 'dark';
    document.documentElement.setAttribute('data-theme', next);
    localStorage.setItem('theme', next);
  }

  // Cache
  function getCache(key) {
    try {
      const c = localStorage.getItem(key);
      if (!c) return null;
      const { data, ts } = JSON.parse(c);
      if (Date.now() - ts > CONFIG.cacheExpiry) {
        localStorage.removeItem(key);
        return null;
      }
      return data;
    } catch { return null; }
  }

  function setCache(key, data) {
    try {
      localStorage.setItem(key, JSON.stringify({ data, ts: Date.now() }));
    } catch {}
  }

  // Recent
  function getRecent() {
    try { return JSON.parse(localStorage.getItem('recent')) || []; } catch { return []; }
  }

  function addRecent(h) {
    const r = getRecent().filter(x => x !== h);
    r.unshift(h);
    localStorage.setItem('recent', JSON.stringify(r.slice(0, CONFIG.maxRecent)));
    renderRecent();
  }

  function removeRecent(h) {
    localStorage.setItem('recent', JSON.stringify(getRecent().filter(x => x !== h)));
    renderRecent();
  }

  function renderRecent() {
    const r = getRecent();
    if (!r.length) {
      el.recentSearches.classList.add('hidden');
      return;
    }
    el.recentSearches.classList.remove('hidden');
    el.recentTags.innerHTML = r.map(h => `
      <div class="recent-tag" data-h="${h}">
        <span>@${h}</span>
        <span class="recent-tag-x" data-h="${h}">×</span>
      </div>
    `).join('');

    el.recentTags.querySelectorAll('.recent-tag').forEach(t => {
      t.addEventListener('click', e => {
        if (e.target.classList.contains('recent-tag-x')) {
          e.stopPropagation();
          removeRecent(t.dataset.h);
        } else {
          el.searchInput.value = t.dataset.h;
          search(t.dataset.h);
        }
      });
    });
  }

  // Fetch
  async function fetchDB() {
    const cached = getCache('db');
    if (cached) {
      db = cached;
      renderBrowse();
      return;
    }
    try {
      const res = await fetch(CONFIG.handlesUrl);
      if (!res.ok) throw new Error();
      db = await res.json();
      setCache('db', db);
      renderBrowse();
    } catch {
      el.categoriesAccordion.innerHTML = '<div class="loading-text">Failed to load</div>';
      el.profilesList.innerHTML = '<div class="loading-text">Failed to load</div>';
    }
  }

  async function fetchIssues(handle, page = 1) {
    const key = `issues_${handle}_${page}_v2`; // v2 to invalidate old cache
    const cached = getCache(key);
    if (cached) return cached;
    try {
      // Search for handle in title - format is "[REPORT] @handle - category"
      const q = encodeURIComponent(`repo:${CONFIG.githubRepo} "@${handle}" in:title is:issue`);
      const res = await fetch(`${CONFIG.issuesApiUrl}?q=${q}&per_page=${CONFIG.perPage}&page=${page}&sort=created&order=desc`);
      if (!res.ok) return { items: [], total_count: 0 };
      const data = await res.json();
      
      // Client-side filter to ensure only exact handle matches
      // Title format: "[REPORT] @handle - category"
      const handleLower = handle.toLowerCase();
      const pattern = new RegExp(`\\[report\\]\\s*@${handleLower}\\s*-`, 'i');
      
      const filtered = data.items.filter(issue => {
        return pattern.test(issue.title);
      });
      
      const result = { 
        items: filtered, 
        total_count: filtered.length 
      };
      setCache(key, result);
      return result;
    } catch {
      return { items: [], total_count: 0 };
    }
  }

  // Render Browse
  function renderBrowse() {
    if (!db) return;
    renderCategories();
    renderProfiles();
    el.totalHandles.textContent = Object.keys(db.handles).length;
    el.totalCategories.textContent = Object.keys(db.categories).length;
  }

  function renderCategories() {
    const grouped = {};
    for (const [h, info] of Object.entries(db.handles)) {
      if (!grouped[info.category]) grouped[info.category] = [];
      grouped[info.category].push({ handle: h, ...info });
    }
    for (const cat of Object.keys(grouped)) {
      grouped[cat].sort((a, b) => (b.reportCount || 1) - (a.reportCount || 1));
    }

    let html = '';
    for (const [catId, catInfo] of Object.entries(db.categories)) {
      const handles = grouped[catId] || [];
      if (!handles.length) continue;
      html += `
        <div class="accordion-item" data-cat="${catId}">
          <div class="accordion-header">
            <div class="accordion-left">
              <span class="cat-dot" style="background:${catInfo.color}"></span>
              <span class="cat-name">${catInfo.label}</span>
              <span class="cat-count">${handles.length}</span>
            </div>
            <svg class="accordion-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <polyline points="6 9 12 15 18 9"></polyline>
            </svg>
          </div>
          <div class="accordion-body">
            ${handles.slice(0, 8).map(h => `
              <div class="acc-handle" data-h="${h.handle}">
                <img class="acc-avatar" src="https://unavatar.io/twitter/${h.handle}" onerror="this.src='data:image/svg+xml,<svg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 24 24%22 fill=%22%23657786%22><circle cx=%2212%22 cy=%228%22 r=%224%22/><path d=%22M12 14c-6 0-8 3-8 6v2h16v-2c0-3-2-6-8-6z%22/></svg>'">
                <span class="acc-name">@${h.handle}</span>
                <span class="acc-reports">${h.reportCount || 1}</span>
              </div>
            `).join('')}
          </div>
        </div>
      `;
    }

    el.categoriesAccordion.innerHTML = html || '<div class="loading-text">No categories</div>';

    // Accordion toggle
    el.categoriesAccordion.querySelectorAll('.accordion-header').forEach(hdr => {
      hdr.addEventListener('click', () => {
        hdr.closest('.accordion-item').classList.toggle('open');
      });
    });

    // Handle click
    el.categoriesAccordion.querySelectorAll('.acc-handle').forEach(item => {
      item.addEventListener('click', () => search(item.dataset.h));
    });
  }

  function renderProfiles() {
    const sorted = Object.entries(db.handles)
      .map(([h, info]) => ({ handle: h, ...info }))
      .sort((a, b) => (b.reportCount || 1) - (a.reportCount || 1));

    const toShow = sorted.slice(0, profilesShown);
    if (!toShow.length) {
      el.profilesList.innerHTML = '<div class="loading-text">No profiles yet</div>';
      el.viewAllBtn.classList.add('hidden');
      return;
    }

    el.profilesList.innerHTML = toShow.map((p, i) => {
      const cat = db.categories[p.category];
      const rank = i + 1;
      return `
        <div class="profile-item" data-h="${p.handle}">
          <span class="rank ${rank <= 3 ? 'gold' : ''}">${rank}</span>
          <img class="pi-avatar" src="https://unavatar.io/twitter/${p.handle}" onerror="this.src='data:image/svg+xml,<svg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 24 24%22 fill=%22%23657786%22><circle cx=%2212%22 cy=%228%22 r=%224%22/><path d=%22M12 14c-6 0-8 3-8 6v2h16v-2c0-3-2-6-8-6z%22/></svg>'">
          <div class="pi-info">
            <div class="pi-handle">@${p.handle}</div>
            ${cat ? `<div class="pi-badge" style="background:${cat.bgColor};color:${cat.color};border:1px solid ${cat.borderColor}">
              <span class="pi-badge-dot" style="background:${cat.color}"></span>${cat.label}
            </div>` : ''}
          </div>
          <div class="pi-stats">
            <div class="pi-count">${p.reportCount || 1}</div>
            <div class="pi-label">reports</div>
          </div>
        </div>
      `;
    }).join('');

    el.profilesList.querySelectorAll('.profile-item').forEach(item => {
      item.addEventListener('click', () => search(item.dataset.h));
    });

    el.viewAllBtn.classList.toggle('hidden', sorted.length <= profilesShown);
  }

  // Search
  function filterHandles(q) {
    if (!db || !q) return [];
    const norm = q.toLowerCase().replace('@', '');
    return Object.entries(db.handles)
      .filter(([h]) => h.includes(norm))
      .map(([h, info]) => ({ handle: h, info }))
      .sort((a, b) => {
        if (a.handle === norm) return -1;
        if (b.handle === norm) return 1;
        return a.handle.indexOf(norm) - b.handle.indexOf(norm);
      });
  }

  function showDropdown(handles) {
    if (!handles.length) {
      el.searchDropdown.classList.add('hidden');
      return;
    }
    el.searchDropdown.innerHTML = handles.slice(0, 8).map(({ handle, info }) => {
      const cat = db?.categories[info.category];
      return `
        <div class="dropdown-item" data-h="${handle}">
          <span class="dropdown-handle">@${handle}</span>
          ${cat ? `<span class="dropdown-badge" style="background:${cat.bgColor};color:${cat.color};border:1px solid ${cat.borderColor}">${cat.label}</span>` : ''}
        </div>
      `;
    }).join('');
    el.searchDropdown.classList.remove('hidden');

    el.searchDropdown.querySelectorAll('.dropdown-item').forEach(item => {
      item.addEventListener('click', () => {
        el.searchInput.value = item.dataset.h;
        el.searchDropdown.classList.add('hidden');
        search(item.dataset.h);
      });
    });
  }

  async function search(handle) {
    if (!handle) return;
    const h = handle.toLowerCase().replace('@', '');
    currentHandle = h;
    currentPage = 1;

    history.pushState(null, '', `?handle=${h}`);
    showResults();
    showState('loading');

    if (!db) await fetchDB();

    const info = db?.handles[h];
    const issues = await fetchIssues(h);
    totalIssues = issues.total_count || 0;

    if (info) {
      addRecent(h);
      renderProfile(h, info, issues.items);
      renderReports(issues.items);
      showState('found');
    } else if (issues.items.length) {
      addRecent(h);
      renderPendingProfile(h, issues);
      renderReports(issues.items);
      showState('found');
    } else {
      renderNotFound(h);
      showState('notfound');
    }
  }

  // Views
  function showLanding() {
    el.landingPage.classList.remove('hidden');
    el.resultsPage.classList.add('hidden');
    history.pushState(null, '', location.pathname);
  }

  function showResults() {
    el.landingPage.classList.add('hidden');
    el.resultsPage.classList.remove('hidden');
  }

  function showState(state) {
    el.loading.classList.add('hidden');
    el.profileCard.classList.add('hidden');
    el.notFound.classList.add('hidden');
    el.reportsSection.classList.add('hidden');
    el.grokSection.classList.add('hidden');

    if (state === 'loading') el.loading.classList.remove('hidden');
    if (state === 'found') {
      el.profileCard.classList.remove('hidden');
      el.reportsSection.classList.remove('hidden');
      // grokSection visibility is handled by renderGrokOpinions
    }
    if (state === 'notfound') el.notFound.classList.remove('hidden');
  }

  // Render
  function renderProfile(h, info, issues = []) {
    const cat = db?.categories[info.category];
    el.profileAvatar.src = `https://unavatar.io/twitter/${h}`;
    el.profileAvatar.onerror = () => { el.profileAvatar.src = 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="%23657786"><circle cx="12" cy="8" r="4"/><path d="M12 14c-6 0-8 3-8 6v2h16v-2c0-3-2-6-8-6z"/></svg>'; };
    el.profileHandle.textContent = `@${h}`;
    el.profileLink.href = `https://x.com/${h}`;

    if (cat) {
      el.profileBadge.innerHTML = `
        <div class="badge-large" style="background:${cat.bgColor};border:2px solid ${cat.borderColor}">
          <span class="dot" style="background:${cat.color}"></span>
          <div>
            <div style="color:${cat.color}">${cat.label}</div>
            <div class="badge-desc">${cat.description || ''}</div>
          </div>
        </div>
      `;
      
      // Show summary if category has description
      if (cat.description) {
        el.summaryText.textContent = cat.description;
        el.profileSummary.classList.remove('hidden');
      } else {
        el.profileSummary.classList.add('hidden');
      }
    } else {
      el.profileBadge.innerHTML = '';
      el.profileSummary.classList.add('hidden');
    }

    // Count unique reporters from issues
    const uniqueUsers = new Set(issues.map(i => i.user?.login).filter(Boolean));
    el.uniqueReporters.textContent = uniqueUsers.size || '-';
    
    el.reportCount.textContent = info.reportCount || totalIssues || 1;
    el.firstFlagged.textContent = info.addedAt ? formatDate(info.addedAt) : '-';
    el.lastReport.textContent = issues.length ? formatDate(issues[0].created_at) : '-';
    
    // Extract and render Grok opinions
    renderGrokOpinions(issues);
  }

  function renderPendingProfile(h, issues) {
    el.profileAvatar.src = `https://unavatar.io/twitter/${h}`;
    el.profileAvatar.onerror = () => { el.profileAvatar.src = 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="%23657786"><circle cx="12" cy="8" r="4"/><path d="M12 14c-6 0-8 3-8 6v2h16v-2c0-3-2-6-8-6z"/></svg>'; };
    el.profileHandle.textContent = `@${h}`;
    el.profileLink.href = `https://x.com/${h}`;
    el.profileBadge.innerHTML = `
      <div class="badge-large" style="background:rgba(255,173,31,0.15);border:2px solid #ffad1f">
        <span class="dot" style="background:#ffad1f"></span>
        <div>
          <div style="color:#ffad1f">Pending Review</div>
          <div class="badge-desc">Reports submitted, awaiting confirmation</div>
        </div>
      </div>
    `;
    el.profileSummary.classList.add('hidden');
    
    // Count unique reporters
    const uniqueUsers = new Set(issues.items.map(i => i.user?.login).filter(Boolean));
    el.uniqueReporters.textContent = uniqueUsers.size || '-';
    
    el.reportCount.textContent = issues.total_count || 0;
    el.firstFlagged.textContent = '-';
    el.lastReport.textContent = issues.items.length ? formatDate(issues.items[0].created_at) : '-';
    
    // Extract and render Grok opinions
    renderGrokOpinions(issues.items);
  }
  
  function renderGrokOpinions(issues) {
    const grokOpinions = [];
    
    for (const issue of issues) {
      const body = issue.body || '';
      // Look for Grok's Opinion section in the report
      const grokMatch = body.match(/###?\s*Grok'?s?\s*Opinion[\s\S]*?\n([\s\S]*?)(?=\n##|$)/i);
      if (grokMatch && grokMatch[1].trim()) {
        grokOpinions.push({
          text: grokMatch[1].trim().slice(0, 500) + (grokMatch[1].trim().length > 500 ? '...' : ''),
          date: issue.created_at,
          reporter: issue.user?.login,
          url: issue.html_url
        });
      }
    }
    
    if (!grokOpinions.length) {
      el.grokSection.classList.add('hidden');
      return;
    }
    
    el.grokSection.classList.remove('hidden');
    el.grokCount.textContent = `(${grokOpinions.length})`;
    
    el.grokList.innerHTML = grokOpinions.slice(0, 5).map(g => `
      <div class="grok-card">
        <div class="grok-card-header">
          <span class="grok-label">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 15l-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z"/></svg>
            Grok AI
          </span>
          <span class="grok-date">${formatDate(g.date)}</span>
        </div>
        <div class="grok-text">${escapeHtml(g.text)}</div>
        <div class="grok-source">
          <a href="${g.url}" target="_blank">From report by ${g.reporter} →</a>
        </div>
      </div>
    `).join('');
  }

  function renderNotFound(h) {
    el.notFoundHandle.textContent = `@${h}`;
    el.reportBtn.href = `https://github.com/${CONFIG.githubRepo}/issues/new?title=${encodeURIComponent(`[REPORT] @${h} - category`)}&body=${encodeURIComponent(`## Report for @${h}\n\n**Category:**\n\n**Evidence:**\n\n`)}`;
  }

  function renderReports(issues) {
    el.reportsCount.textContent = `(${totalIssues})`;

    if (!issues.length) {
      el.reportsList.innerHTML = '<div class="loading-text">No detailed reports yet</div>';
      el.loadMoreBtn.classList.add('hidden');
      return;
    }

    el.reportsList.innerHTML = issues.map(issue => {
      const catLabel = issue.labels.find(l => ['paid_promoter', 'propaganda', 'anti_india', 'pro_bharat', 'brown_sepoy', 'hypocrite', 'pending'].includes(l.name));
      const cat = catLabel ? db?.categories[catLabel.name] : null;
      const parsed = parseBody(issue.body || '');

      return `
        <div class="report-card">
          <div class="report-top">
            <div class="reporter">
              <img src="https://github.com/${issue.user.login}.png?size=64" alt="">
              <div>
                <div class="reporter-name">${issue.user.login}</div>
                <div class="report-date">${formatDate(issue.created_at)}</div>
              </div>
            </div>
            <div class="report-tags">
              ${parsed.hasGrok ? `<span class="grok-tag">🤖 Grok</span>` : ''}
              ${cat ? `<span class="report-cat" style="background:${cat.bgColor};color:${cat.color};border:1px solid ${cat.borderColor}">${cat.label}</span>` : 
                      catLabel ? `<span class="report-cat" style="background:rgba(255,173,31,0.15);color:#ffad1f;border:1px solid #ffad1f">${catLabel.name}</span>` : ''}
            </div>
          </div>
          <div class="report-body">
            ${parsed.evidence ? `<div class="report-evidence">${escapeHtml(parsed.evidence)}</div>` : ''}
            ${parsed.tweetText || parsed.tweetUrl ? `
              <div class="report-tweet">
                <div class="report-tweet-label">Reported Tweet</div>
                ${parsed.tweetText ? `<div class="report-tweet-text">"${escapeHtml(parsed.tweetText)}"</div>` : ''}
                ${parsed.tweetUrl ? `<a href="${parsed.tweetUrl}" target="_blank">View tweet →</a>` : ''}
              </div>
            ` : ''}
          </div>
          <div class="report-footer">
            <a href="${issue.html_url}" target="_blank">View full report →</a>
          </div>
        </div>
      `;
    }).join('');

    if (issues.length) {
      el.lastReport.textContent = formatDate(issues[0].created_at);
    }

    el.loadMoreBtn.classList.toggle('hidden', totalIssues <= currentPage * CONFIG.perPage);
  }

  function parseBody(body) {
    const result = { evidence: '', tweetText: '', tweetUrl: '', hasGrok: false };

    const evMatch = body.match(/###?\s*(?:Evidence|Notes)[\s\S]*?\n([\s\S]*?)(?=\n##|$)/i);
    if (evMatch) result.evidence = evMatch[1].trim().slice(0, 250) + (evMatch[1].trim().length > 250 ? '...' : '');

    const txtMatch = body.match(/###?\s*Tweet Content[\s\S]*?>\s*([\s\S]*?)(?=\n##|$)/i);
    if (txtMatch) result.tweetText = txtMatch[1].trim().slice(0, 150) + (txtMatch[1].trim().length > 150 ? '...' : '');

    const urlMatch = body.match(/\*\*Tweet URL:\*\*\s*(https:\/\/(?:twitter\.com|x\.com)\/[^\s\n]+)/i);
    if (urlMatch) result.tweetUrl = urlMatch[1];
    
    // Check for Grok opinion
    const grokMatch = body.match(/###?\s*Grok'?s?\s*Opinion/i);
    result.hasGrok = !!grokMatch;

    if (!result.evidence && !result.tweetText) {
      const fb = body.replace(/#+[^\n]+\n/g, '').trim();
      result.evidence = fb.slice(0, 150) + (fb.length > 150 ? '...' : '');
    }

    return result;
  }

  // Utils
  function formatDate(str) {
    const d = new Date(str);
    const now = new Date();
    const days = Math.floor((now - d) / 86400000);
    if (days === 0) return 'Today';
    if (days === 1) return 'Yesterday';
    if (days < 7) return `${days}d ago`;
    if (days < 30) return `${Math.floor(days / 7)}w ago`;
    if (days < 365) return `${Math.floor(days / 30)}mo ago`;
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  }

  function escapeHtml(t) {
    const d = document.createElement('div');
    d.textContent = t;
    return d.innerHTML;
  }

  function debounce(fn, ms) {
    let t;
    return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
  }

  // Events
  function setupEvents() {
    el.themeToggle.addEventListener('click', toggleTheme);

    const handleInput = debounce(q => {
      el.searchClear.classList.toggle('hidden', !q);
      showDropdown(q ? filterHandles(q) : []);
    }, 150);

    el.searchInput.addEventListener('input', e => handleInput(e.target.value.trim()));

    el.searchInput.addEventListener('keydown', e => {
      if (e.key === 'Enter') {
        const q = el.searchInput.value.trim();
        if (q) {
          el.searchDropdown.classList.add('hidden');
          search(q);
        }
      } else if (e.key === 'Escape') {
        el.searchDropdown.classList.add('hidden');
      }
    });

    el.searchClear.addEventListener('click', () => {
      el.searchInput.value = '';
      el.searchClear.classList.add('hidden');
      el.searchDropdown.classList.add('hidden');
    });

    document.addEventListener('click', e => {
      if (!e.target.closest('.search-wrapper')) {
        el.searchDropdown.classList.add('hidden');
      }
    });

    el.backBtn.addEventListener('click', showLanding);

    el.miniSearch.addEventListener('keydown', e => {
      if (e.key === 'Enter') {
        const q = e.target.value.trim();
        if (q) {
          search(q);
          e.target.value = '';
        }
      }
    });

    el.viewAllBtn.addEventListener('click', () => {
      profilesShown += 10;
      renderProfiles();
    });

    el.loadMoreBtn.addEventListener('click', async () => {
      if (!currentHandle) return;
      currentPage++;
      el.loadMoreBtn.textContent = 'Loading...';
      el.loadMoreBtn.disabled = true;

      const issues = await fetchIssues(currentHandle, currentPage);
      if (issues.items.length) {
        el.reportsList.innerHTML += issues.items.map(issue => {
          const catLabel = issue.labels.find(l => ['paid_promoter', 'propaganda', 'anti_india', 'pro_bharat', 'brown_sepoy', 'hypocrite', 'pending'].includes(l.name));
          const cat = catLabel ? db?.categories[catLabel.name] : null;
          const parsed = parseBody(issue.body || '');
          return `
            <div class="report-card">
              <div class="report-top">
                <div class="reporter">
                  <img src="https://github.com/${issue.user.login}.png?size=64" alt="">
                  <div>
                    <div class="reporter-name">${issue.user.login}</div>
                    <div class="report-date">${formatDate(issue.created_at)}</div>
                  </div>
                </div>
                ${cat ? `<span class="report-cat" style="background:${cat.bgColor};color:${cat.color}">${cat.label}</span>` : ''}
              </div>
              <div class="report-body">
                ${parsed.evidence ? `<div class="report-evidence">${escapeHtml(parsed.evidence)}</div>` : ''}
              </div>
              <div class="report-footer">
                <a href="${issue.html_url}" target="_blank">View full report →</a>
              </div>
            </div>
          `;
        }).join('');
      }

      el.loadMoreBtn.textContent = 'Load more';
      el.loadMoreBtn.disabled = false;
      el.loadMoreBtn.classList.toggle('hidden', totalIssues <= currentPage * CONFIG.perPage);
    });
  }

  // Init
  async function init() {
    initTheme();
    setupEvents();
    await fetchDB();
    renderRecent();

    const params = new URLSearchParams(location.search);
    const h = params.get('handle');
    if (h) {
      el.searchInput.value = h;
      el.searchClear.classList.remove('hidden');
      search(h);
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
