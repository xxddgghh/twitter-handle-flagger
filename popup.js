// Twitter Handle Flagger - Popup Script

document.addEventListener('DOMContentLoaded', () => {
  // Initialize
  loadStats();
  loadCategories();
  loadSettings();
  checkPendingReport();
  
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
  
  // Submit report button
  document.getElementById('submitReport').addEventListener('click', submitReport);
  
  // Sync button
  document.getElementById('syncNow').addEventListener('click', syncDatabase);
  
  // Settings toggles
  document.getElementById('toggleBadges').addEventListener('click', function() {
    this.classList.toggle('active');
    saveSettings();
  });
  
  document.getElementById('toggleTooltips').addEventListener('click', function() {
    this.classList.toggle('active');
    saveSettings();
  });
  
  document.getElementById('highlightStyle').addEventListener('change', saveSettings);
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
      const reportSelect = document.getElementById('reportCategory');
      
      // Get enabled categories from settings
      chrome.runtime.sendMessage({ action: 'getSettings' }, (settingsResponse) => {
        const settings = settingsResponse?.settings || {};
        const enabledCategories = settings.enabledCategories; // null means all enabled
        
        categoryList.innerHTML = '';
        reportSelect.innerHTML = '<option value="">Select category</option>';
        
        // Count handles per category
        const categoryCounts = {};
        Object.values(db.handles).forEach(handle => {
          categoryCounts[handle.category] = (categoryCounts[handle.category] || 0) + 1;
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
          
          // Report dropdown option
          const option = document.createElement('option');
          option.value = id;
          option.textContent = cat.label;
          reportSelect.appendChild(option);
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
      
      if (settings.showTooltips === false) {
        document.getElementById('toggleTooltips').classList.remove('active');
      }
      
      if (settings.highlightStyle) {
        document.getElementById('highlightStyle').value = settings.highlightStyle;
      }
    }
  });
}

// Save settings
async function saveSettings() {
  const settings = {
    showBadges: document.getElementById('toggleBadges').classList.contains('active'),
    showTooltips: document.getElementById('toggleTooltips').classList.contains('active'),
    highlightStyle: document.getElementById('highlightStyle').value
  };
  
  chrome.runtime.sendMessage({
    action: 'saveSettings',
    settings: settings
  }, () => {
    showNotification('Settings saved', 'success');
  });
}

// Check for pending report (from context menu)
function checkPendingReport() {
  chrome.storage.local.get(['pendingReport'], (result) => {
    if (result.pendingReport) {
      document.getElementById('reportHandle').value = '@' + result.pendingReport;
      
      // Switch to report tab
      document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
      document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
      document.querySelector('[data-tab="report"]').classList.add('active');
      document.getElementById('report').classList.add('active');
      
      // Clear pending
      chrome.storage.local.remove(['pendingReport']);
    }
  });
}

// Submit report
async function submitReport() {
  const handle = document.getElementById('reportHandle').value.replace('@', '').trim();
  const category = document.getElementById('reportCategory').value;
  const evidence = document.getElementById('reportEvidence').value.trim();
  
  if (!handle) {
    showNotification('Please enter a handle', 'error');
    return;
  }
  
  if (!category) {
    showNotification('Please select a category', 'error');
    return;
  }
  
  chrome.runtime.sendMessage({
    action: 'submitReport',
    handle: handle,
    category: category,
    evidence: evidence
  }, (response) => {
    if (response && response.url) {
      window.open(response.url, '_blank');
      showNotification('Opening GitHub to submit report...', 'success');
      
      // Clear form
      document.getElementById('reportHandle').value = '';
      document.getElementById('reportCategory').value = '';
      document.getElementById('reportEvidence').value = '';
    } else if (response && response.error) {
      showNotification('Error: ' + response.error, 'error');
    }
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
