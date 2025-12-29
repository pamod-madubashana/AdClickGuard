// Background service worker for Ad Click Guard

// Default state
let extensionEnabled = false;

// Initialize the extension state from storage
chrome.storage.sync.get({
  adGuardEnabled: false
}, (result) => {
  extensionEnabled = result.adGuardEnabled;
  console.log('Background service worker initialized, enabled:', extensionEnabled);
});

// Listen for messages from popup or content scripts
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'getStatus') {
    // Return current status
    sendResponse({ enabled: extensionEnabled });
    return true; // Keep message channel open for async response
  } 
  else if (request.action === 'toggleExtension') {
    // Update the extension state
    extensionEnabled = request.enabled;
    
    // Save to storage
    chrome.storage.sync.set({ 
      adGuardEnabled: extensionEnabled 
    }, () => {
      console.log('Extension state saved to storage:', extensionEnabled);
    });
    
    // Send response back
    sendResponse({ status: 'success', enabled: extensionEnabled });
    return true; // Keep message channel open for async response
  }
  else if (request.action === 'getState') {
    // Alternative method to get state
    sendResponse({ enabled: extensionEnabled });
    return true; // Keep message channel open for async response
  }
});

// Update state when storage changes (sync across all contexts)
chrome.storage.onChanged.addListener((changes, namespace) => {
  if (namespace === 'sync' && changes.adGuardEnabled) {
    extensionEnabled = changes.adGuardEnabled.newValue;
    console.log('Extension state updated from storage change:', extensionEnabled);
  }
});