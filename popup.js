// Twitter Handle Flagger - Popup Script

document.addEventListener('DOMContentLoaded', () => {
  // Initialize
  loadStats();
  loadCategories();
  loadSettings();
  
  // Tab switching
  const tabs = document.querySelectorAll('.tab');
  const tabContents = document.querySelectorAll('.tab-content');
  
  tabs.forEach(tab => {
    tab.addEventListener('click', () => {
      const targetId = tab.dataset.tab;
      
      tabs.forEach(t => t.classList.remove('active'));
      tabContents.forEach(c => c.classList.remove('active'));
      
      tab.classList.add('active');
      document.getElementById(targetId).classList.add('active');
    });
  });
  
  // Sync button
  document.getElementById('syncNow').addEventListener('click', syncDatabase);
  
  // Settings toggles
  document.getElementById('toggleBadges').addEventListener('click', function() {
    this.classList.toggle('active');
    saveSettings();
  });
  
  // Segment control for highlight style
  document.querySelectorAll('.segment-btn').forEach(btn => {
    btn.addEventListener('click', function() {
      document.querySelectorAll('.segment-btn').forEach(b => b.classList.remove('active'));
      this.classList.add('active');
      saveSettings();
    });
  });
});

// Load stats
async function loadStats() {
  chrome.runtime.sendMessage({ action: 'getDatabase' }, (response) => {
    if (response && response.database) {
      const db = response.database;
      document.getElementById('totalHandles').textContent = Object.keys(db.handles).length;
      document.getElementById('totalCategories').textContent = Object.keys(db.categories).length;
    }
  });
  
  // Get last sync time
  chrome.storage.local.get(['lastSync'], (result) => {
    if (result.lastSync) {
      const diff = Date.now() - result.lastSync;
      const hours = Math.floor(diff / (1000 * 60 * 60));
      const mins = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
      
      if (hours > 0) {
        document.getElementById('lastSync').textContent = `${hours}h ago`;
      } else if (mins > 0) {
        document.getElementById('lastSync').textContent = `${mins}m ago`;
      } else {
        document.getElementById('lastSync').textContent = 'Just now';
      }
    }
  });
}

// Load categories
async function loadCategories() {
  chrome.runtime.sendMessage({ action: 'getDatabase' }, (response) => {
    if (response && response.database) {
      const db = response.database;
      const categoryList = document.getElementById('categoryList');
      
      // Get enabled categories from settings
      chrome.runtime.sendMessage({ action: 'getSettings' }, (settingsResponse) => {
        const settings = settingsResponse?.settings || {};
        const enabledCategories = settings.enabledCategories; // null means all enabled
        
        categoryList.innerHTML = '';
        
        // Count handles per category (handles can be in multiple categories)
        const categoryCounts = {};
        Object.values(db.handles).forEach(handle => {
          if (handle.categories) {
            // New multi-category structure
            Object.keys(handle.categories).forEach(catId => {
              categoryCounts[catId] = (categoryCounts[catId] || 0) + 1;
            });
          } else if (handle.category) {
            // Legacy single-category structure (fallback)
            categoryCounts[handle.category] = (categoryCounts[handle.category] || 0) + 1;
          }
        });
        
        Object.entries(db.categories).forEach(([id, cat]) => {
          const count = categoryCounts[id] || 0;
          const isEnabled = !enabledCategories || enabledCategories.includes(id);
          
          // Category list item
          const item = document.createElement('div');
          item.className = 'category-item';
          item.innerHTML = `
            <div class="category-color" style="background: ${cat.color}"></div>
            <div class="category-info">
              <div class="category-name">${cat.label}</div>
              <div class="category-count">${count} handles</div>
            </div>
            <div class="category-toggle ${isEnabled ? 'active' : ''}" data-category="${id}"></div>
          `;
          
          item.querySelector('.category-toggle').addEventListener('click', function(e) {
            e.stopPropagation();
            this.classList.toggle('active');
            saveCategorySettings();
          });
          
          categoryList.appendChild(item);
        });
      });
    }
  });
}

// Save category toggle settings
async function saveCategorySettings() {
  const toggles = document.querySelectorAll('.category-toggle[data-category]');
  const enabledCategories = [];
  
  toggles.forEach(toggle => {
    if (toggle.classList.contains('active')) {
      enabledCategories.push(toggle.dataset.category);
    }
  });
  
  // If all are enabled, set to null (means show all)
  chrome.runtime.sendMessage({ action: 'getDatabase' }, (response) => {
    if (response && response.database) {
      const allCategories = Object.keys(response.database.categories);
      const toSave = enabledCategories.length === allCategories.length ? null : enabledCategories;
      
      chrome.runtime.sendMessage({
        action: 'saveSettings',
        settings: { enabledCategories: toSave }
      });
    }
  });
}

// Load settings
async function loadSettings() {
  chrome.runtime.sendMessage({ action: 'getSettings' }, (response) => {
    if (response && response.settings) {
      const settings = response.settings;
      
      if (settings.showBadges === false) {
        document.getElementById('toggleBadges').classList.remove('active');
      }
      
      if (settings.highlightStyle) {
        // Update segment control
        document.querySelectorAll('.segment-btn').forEach(btn => {
          btn.classList.remove('active');
          if (btn.dataset.value === settings.highlightStyle) {
            btn.classList.add('active');
          }
        });
      }
    }
  });
}

// Save settings
async function saveSettings() {
  const activeSegment = document.querySelector('.segment-btn.active');
  const settings = {
    showBadges: document.getElementById('toggleBadges').classList.contains('active'),
    highlightStyle: activeSegment ? activeSegment.dataset.value : 'background'
  };
  
  chrome.runtime.sendMessage({
    action: 'saveSettings',
    settings: settings
  }, () => {
    showNotification('Settings saved', 'success');
  });
}

// Sync database
async function syncDatabase() {
  const btn = document.getElementById('syncNow');
  btn.disabled = true;
  btn.textContent = '⏳ Syncing...';
  
  chrome.runtime.sendMessage({ action: 'syncDatabase' }, (response) => {
    if (response && response.success) {
      showNotification('Database synced successfully', 'success');
      loadStats();
      loadCategories();
    } else {
      showNotification('Sync failed: ' + (response?.error || 'Unknown error'), 'error');
    }
    
    btn.disabled = false;
    btn.textContent = '🔄 Sync Database Now';
  });
}

// Show notification
function showNotification(message, type = 'info') {
  const notification = document.getElementById('notification');
  notification.textContent = message;
  notification.className = `notification ${type} show`;
  
  setTimeout(() => {
    notification.classList.remove('show');
  }, 3000);
}
