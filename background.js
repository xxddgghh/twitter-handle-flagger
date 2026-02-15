// Twitter Handle Flagger - Background Service Worker
// Manages handle database fetching, caching, and reporting

// Configuration
const CONFIG = {
  // GitHub raw URL for the handles database
  databaseUrl: 'https://raw.githubusercontent.com/xxddgghh/twitter-handle-flagger/main/data/handles.json',
  // Fallback to local data
  localDatabasePath: 'data/handles.json',
  // GitHub API for creating issues
  githubApiUrl: 'https://api.github.com/repos/xxddgghh/twitter-handle-flagger/issues',
  // Sync interval in minutes
  syncInterval: 360, // 6 hours
  // Cache key
  cacheKey: 'handleDatabase'
};

// Initialize extension
chrome.runtime.onInstalled.addListener(async (details) => {
  console.log('Handle Flagger installed:', details.reason);
  
  // Set up sync alarm
  chrome.alarms.create('syncDatabase', { periodInMinutes: CONFIG.syncInterval });
  
  // Initial sync
  await syncDatabase();
  
  // Set up context menu
  setupContextMenu();
});

// Handle alarm for periodic sync
chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name === 'syncDatabase') {
    await syncDatabase();
  }
});

// Set up right-click context menu
function setupContextMenu() {
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({
      id: 'reportHandle',
      title: 'Report this handle...',
      contexts: ['link'],
      targetUrlPatterns: ['*://twitter.com/*', '*://x.com/*']
    });
  });
}

// Context menu click handler
chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId === 'reportHandle') {
    // Extract handle from URL
    const url = info.linkUrl;
    const handleMatch = url.match(/(?:twitter\.com|x\.com)\/(@?\w+)/i);
    
    if (handleMatch) {
      const handle = handleMatch[1].replace('@', '');
      // Open popup with handle pre-filled
      chrome.storage.local.set({ pendingReport: handle });
      chrome.action.openPopup();
    }
  }
});

// Sync database from GitHub
async function syncDatabase() {
  console.log('Syncing handle database...');
  
  try {
    // Try fetching from GitHub
    const response = await fetch(CONFIG.databaseUrl, {
      cache: 'no-cache',
      headers: {
        'Accept': 'application/json'
      }
    });
    
    if (response.ok) {
      const data = await response.json();
      await saveDatabase(data);
      console.log('Database synced from GitHub:', Object.keys(data.handles).length, 'handles');
      return data;
    }
  } catch (error) {
    console.warn('Failed to fetch from GitHub, using local/cached data:', error.message);
  }
  
  // Fallback to local data
  try {
    const localUrl = chrome.runtime.getURL(CONFIG.localDatabasePath);
    const response = await fetch(localUrl);
    const data = await response.json();
    await saveDatabase(data);
    console.log('Using local database:', Object.keys(data.handles).length, 'handles');
    return data;
  } catch (error) {
    console.error('Failed to load local database:', error);
  }
  
  return null;
}

// Save database to local storage
async function saveDatabase(data) {
  await chrome.storage.local.set({
    [CONFIG.cacheKey]: data,
    lastSync: Date.now()
  });
}

// Get database from cache
async function getDatabase() {
  const result = await chrome.storage.local.get([CONFIG.cacheKey, 'lastSync']);
  
  if (result[CONFIG.cacheKey]) {
    return result[CONFIG.cacheKey];
  }
  
  // If no cache, sync now
  return await syncDatabase();
}

// Lookup a handle
async function lookupHandle(handle) {
  const db = await getDatabase();
  if (!db) return null;
  
  const normalizedHandle = handle.toLowerCase().replace('@', '');
  const entry = db.handles[normalizedHandle];
  
  if (entry) {
    const category = db.categories[entry.category];
    return {
      handle: normalizedHandle,
      category: entry.category,
      categoryInfo: category,
      reportCount: entry.reportCount,
      addedAt: entry.addedAt
    };
  }
  
  return null;
}

// Lookup multiple handles at once
async function lookupHandles(handles) {
  const db = await getDatabase();
  if (!db) return {};
  
  const results = {};
  
  for (const handle of handles) {
    const normalizedHandle = handle.toLowerCase().replace('@', '');
    const entry = db.handles[normalizedHandle];
    
    if (entry) {
      const category = db.categories[entry.category];
      results[normalizedHandle] = {
        handle: normalizedHandle,
        category: entry.category,
        categoryInfo: category,
        reportCount: entry.reportCount,
        addedAt: entry.addedAt
      };
    }
  }
  
  return results;
}

// Get all categories
async function getCategories() {
  const db = await getDatabase();
  return db ? db.categories : {};
}

// Get settings
async function getSettings() {
  const result = await chrome.storage.sync.get({
    enabledCategories: null, // null means all enabled
    showBadges: true,
    showTooltips: true,
    highlightStyle: 'border' // 'border', 'background', or 'both'
  });
  return result;
}

// Save settings
async function saveSettings(settings) {
  await chrome.storage.sync.set(settings);
}

// Submit a report (creates GitHub issue)
async function submitReport(handle, category, evidence = '') {
  const db = await getDatabase();
  
  if (!db || !db.categories[category]) {
    throw new Error('Invalid category');
  }
  
  // For now, we'll open GitHub issue creation page
  // In production, you'd use GitHub OAuth for API access
  const title = encodeURIComponent(`[REPORT] @${handle} - ${category}`);
  const body = encodeURIComponent(
    `## Handle Report\n\n` +
    `**Handle:** @${handle}\n` +
    `**Category:** ${db.categories[category].label}\n\n` +
    `### Evidence/Notes\n${evidence || 'No additional notes provided.'}\n\n` +
    `---\n` +
    `*Submitted via Twitter Handle Flagger extension*`
  );
  
  const repoPath = db.githubRepo || 'your-username/twitter-handle-flagger';
  const issueUrl = `https://github.com/${repoPath}/issues/new?title=${title}&body=${body}&labels=report,${category}`;
  
  return issueUrl;
}

// Message listener
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  switch (request.action) {
    case 'lookupHandle':
      lookupHandle(request.handle)
        .then(result => sendResponse({ result }))
        .catch(error => sendResponse({ error: error.message }));
      return true;
      
    case 'lookupHandles':
      lookupHandles(request.handles)
        .then(results => sendResponse({ results }))
        .catch(error => sendResponse({ error: error.message }));
      return true;
      
    case 'getDatabase':
      getDatabase()
        .then(db => sendResponse({ database: db }))
        .catch(error => sendResponse({ error: error.message }));
      return true;
      
    case 'getCategories':
      getCategories()
        .then(categories => sendResponse({ categories }))
        .catch(error => sendResponse({ error: error.message }));
      return true;
      
    case 'syncDatabase':
      syncDatabase()
        .then(db => sendResponse({ success: true, database: db }))
        .catch(error => sendResponse({ error: error.message }));
      return true;
      
    case 'getSettings':
      getSettings()
        .then(settings => sendResponse({ settings }))
        .catch(error => sendResponse({ error: error.message }));
      return true;
      
    case 'saveSettings':
      saveSettings(request.settings)
        .then(() => sendResponse({ success: true }))
        .catch(error => sendResponse({ error: error.message }));
      return true;
      
    case 'submitReport':
      submitReport(request.handle, request.category, request.evidence)
        .then(url => sendResponse({ url }))
        .catch(error => sendResponse({ error: error.message }));
      return true;
  }
});
