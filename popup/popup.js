// Popup script to handle the toggle functionality
document.addEventListener('DOMContentLoaded', () => {
  const toggleSwitch = document.getElementById('toggleSwitch');
  const statusText = document.getElementById('statusText');
  
  // Function to load and update the state
  function loadState() {
    // Get state from background service worker
    chrome.runtime.sendMessage({ action: 'getStatus' }, (response) => {
      if (chrome.runtime.lastError) {
        console.log('Error getting state from background:', chrome.runtime.lastError.message);
        // Default to false
        const isEnabled = false;
        if (toggleSwitch) toggleSwitch.checked = isEnabled;
        if (statusText) updateStatusText(isEnabled);
      } else if (response && response.enabled !== undefined) {
        const isEnabled = response.enabled;
        console.log('Loaded state from background:', isEnabled);
        if (toggleSwitch) toggleSwitch.checked = isEnabled;
        if (statusText) updateStatusText(isEnabled);
      }
    });
  }

  // Load the current state from storage
  loadState();

  // Toggle the extension state
  if (toggleSwitch) {
    toggleSwitch.addEventListener('change', (e) => {
      const isEnabled = e.target.checked;
      
      // Immediately update UI
      if (statusText) updateStatusText(isEnabled);
      
      // Send message to background service worker to update state
      chrome.runtime.sendMessage({
        action: 'toggleExtension',
        enabled: isEnabled
      }, (response) => {
        if (chrome.runtime.lastError) {
          console.log('Error sending toggle to background:', chrome.runtime.lastError.message);
        } else {
          console.log('Toggle state sent to background, response:', response);
          
          // Send message to content script to update its state
          chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
            if (tabs[0]) {
              chrome.tabs.sendMessage(tabs[0].id, {
                action: 'toggleExtension',
                enabled: isEnabled
              }, (contentResponse) => {
                // Handle potential error when tab is not available
                if (chrome.runtime.lastError) {
                  console.log('Could not send message to tab:', chrome.runtime.lastError.message);
                } else {
                  console.log('Message sent to content script, response:', contentResponse);
                }
              });
            }
          });
        }
      });
    });
  }

  function updateStatusText(isEnabled) {
    if (statusText) {
      statusText.textContent = isEnabled ? 'ENABLED' : 'DISABLED';
      statusText.className = isEnabled ? 'status-text enabled' : 'status-text disabled';
    }
  }
});