/**
 * Pure Dynamic Countdown Detection Module
 * Detects countdown timers based purely on numeric value decreases over time.
 * Uses MutationObserver to watch for text changes and applies focus effect only to confirmed dynamic countdowns.
 */
class CountdownWatcher {
  constructor(options = {}) {
    // Configuration
    this.options = {
      minimumDuration: 15,  // seconds
      maximumDuration: 60,  // seconds
      scrollBehavior: 'smooth',
      focusEffectDuration: 10000, // milliseconds
      validationDelay: 1000, // milliseconds to wait between numeric checks
      debounceTime: 300,     // milliseconds to debounce rapid changes
      enabled: true,         // Whether the countdown watcher is enabled
      ...options
    };

    // State management
    this.hasScrolledToCountdown = false;
    this.detectedCountdownElement = null;
    this.countdownObserver = null;
    this.focusEffectTimeout = null;
    this.extensionElements = new WeakSet(); // Track elements added by the extension
    
    // Track elements with numeric values over time
    this.elementTracker = new Map(); // Store element -> { lastValue, lastCheckTime, consecutiveDecreases }
    this.debounceTimers = new Map(); // Track debounce timers per element
    
    // Initialize
    this.init();
  }

  init() {
    console.log('CountdownWatcher: Initializing with pure dynamic detection...');
    
    // Check if extension is enabled before proceeding
    if (!this.isExtensionEnabled()) {
      console.log('CountdownWatcher: Extension is disabled, stopping initialization');
      return;
    }
    
    // Start observing for dynamic content changes immediately
    this.startObserving();
    // NO INITIAL SCANNING - only detect elements that change dynamically
  }

  /**
   * Check if the extension is enabled
   */
  isExtensionEnabled() {
    // Use the enabled option first
    if (this.options.enabled === false) {
      return false;
    }
    
    // Check for global extension state
    if (typeof window.extensionEnabled !== 'undefined') {
      return window.extensionEnabled === true;
    }
    
    // Check if we're in a real extension context
    if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.id) {
      // In a real extension, we would communicate with background script
      // to get the actual enabled state
      // For this standalone module, we'll default to enabled
      // but in a real extension context, this would check the actual state
      return true;
    }
    
    // For test environments, we can use a specific test flag
    if (typeof window.countdownWatcherTestMode !== 'undefined') {
      // If in test mode, use the test flag to determine enabled state
      return window.countdownWatcherTestEnabled !== false;
    }
    
    // Default to enabled for standalone usage
    return true;
  }

  /**
   * Start observing the DOM for changes that might contain countdowns
   */
  startObserving() {
    if (this.countdownObserver) {
      this.countdownObserver.disconnect();
    }

    this.countdownObserver = new MutationObserver((mutations) => {
      this.handleMutations(mutations);
    });

    this.countdownObserver.observe(document.body, {
      childList: true,
      subtree: true,
      characterData: true,
      attributes: true,  // Watch for attribute changes (like style changes)
      attributeFilter: ['style', 'class']  // Only watch style and class attributes
    });

    console.log('CountdownWatcher: MutationObserver started with pure dynamic detection');
  }
  


  /**
   * Handle DOM mutations to detect potential countdowns
   */
  handleMutations(mutations) {
    // Check if extension is enabled
    if (!this.isExtensionEnabled()) {
      return;
    }
    
    // Continue monitoring for dynamic countdowns even after one is detected
    // Only stop processing if we've already applied the focus effect
    if (this.hasScrolledToCountdown && this.detectedCountdownElement) {
      return;
    }

    for (const mutation of mutations) {
      // Check added nodes
      if (mutation.type === 'childList') {
        for (const node of Array.from(mutation.addedNodes)) {
          if (node.nodeType === Node.ELEMENT_NODE && !this.extensionElements.has(node)) {
            this.processNewElement(node);
          }
        }
      }
      // Check text changes - THIS IS THE KEY FOR DETECTING REAL COUNTDOWNS
      else if (mutation.type === 'characterData') {
        if (mutation.target && !this.extensionElements.has(mutation.target.parentElement)) {
          const element = mutation.target.parentElement || document.body;
          
          // Skip script and style elements
          if (element.tagName === 'SCRIPT' || element.tagName === 'STYLE') {
            continue;
          }
          
          // When text changes, check if it contains numbers and track changes over time
          const newText = mutation.target.textContent;
          this.processTextChanged(element, newText);
        }
      }
      // Check attribute changes (like style changes that make elements visible)
      else if (mutation.type === 'attributes') {
        const element = mutation.target;
        if (element && element.nodeType === Node.ELEMENT_NODE && 
            !this.extensionElements.has(element)) {
          // Element attributes changed, check if it's now visible and has text content
          // This handles cases where display changes from 'none' to 'block'
          if (this.isElementVisible(element)) {
            const textContent = this.getTextContent(element);
            if (textContent.trim()) {
              this.processTextChanged(element, textContent);
            }
          }
          // Also check if element was previously invisible but now might have content
          // This handles cases where content was added while element was hidden
          else {
            // Check if the element has text content even when not visible
            // If it becomes visible later, it will be processed
            const textContent = this.getTextContent(element);
            if (textContent.trim()) {
              // Store this content to process when element becomes visible
              // We'll process it again when visibility changes
            }
          }
        }
      }
    }
  }
  
  /**
   * Process newly added elements to check for potential countdowns
   */
  processNewElement(element) {
    // Skip script and style elements as they don't contain visible countdowns
    if (element.tagName === 'SCRIPT' || element.tagName === 'STYLE') {
      return;
    }
    
    // Check if the element is visible before processing
    if (this.isElementVisible(element)) {
      // Check if the element itself has text content
      const directTextContent = this.getDirectTextContent(element);
      if (directTextContent.trim()) {
        this.processTextChanged(element, directTextContent);
      }
      
      // Also check for text nodes within the element
      const walker = document.createTreeWalker(
        element,
        NodeFilter.SHOW_TEXT,
        {
          acceptNode: (node) => {
            if (node.nodeType === Node.TEXT_NODE && node.textContent.trim()) {
              return NodeFilter.FILTER_ACCEPT;
            }
            return NodeFilter.FILTER_SKIP;
          }
        }
      );
      
      let node;
      while (node = walker.nextNode()) {
        const parentElement = node.parentElement;
        if (parentElement && !this.extensionElements.has(parentElement) && 
            parentElement.tagName !== 'SCRIPT' && parentElement.tagName !== 'STYLE') {
          this.processTextChanged(parentElement, node.textContent);
        }
      }
    }
  }
  
  /**
   * Check if an element is visible
   */
  isElementVisible(element) {
    if (!element) return false;
    
    // Check if element is visible in the DOM
    const style = window.getComputedStyle(element);
    if (style.display === 'none' || style.visibility === 'hidden') {
      return false;
    }
    
    // Check if element has dimensions
    const rect = element.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  }
  
  /**
   * Extract only direct text content from an element (not from children)
   */
  getDirectTextContent(element) {
    if (!element || element.nodeType !== Node.ELEMENT_NODE) {
      return '';
    }
    
    let text = '';
    for (let i = 0; i < element.childNodes.length; i++) {
      const child = element.childNodes[i];
      if (child.nodeType === Node.TEXT_NODE) {
        text += child.textContent;
      }
    }
    
    return text.trim();
  }
  
  /**
   * Process text changes to detect numeric decreases
   */
  processTextChanged(element, text) {
    if (!element || !text) return;
    
    // Check if extension is enabled
    if (!this.isExtensionEnabled()) {
      return;
    }
    
    // Skip script and style elements
    if (element.tagName === 'SCRIPT' || element.tagName === 'STYLE') {
      return;
    }
    
    // Debounce rapid changes for the same element
    if (this.debounceTimers.has(element)) {
      clearTimeout(this.debounceTimers.get(element));
    }
    
    const debounceTimer = setTimeout(() => {
      this.debounceTimers.delete(element);
      this.checkForNumericChange(element, text);
    }, this.options.debounceTime);
    
    this.debounceTimers.set(element, debounceTimer);
  }
  
  /**
   * Check if an element's numeric value has decreased
   */
  checkForNumericChange(element, currentText) {
    // Check if extension is enabled
    if (!this.isExtensionEnabled()) {
      return;
    }
    
    const currentValue = this.extractNumericValue(currentText);
    
    console.log('CountdownWatcher: Processing text change for element:', element, 'text:', currentText, 'extracted value:', currentValue);
    
    if (currentValue === null) {
      // If element no longer has a valid numeric value, this indicates the countdown has completed
      if (this.elementTracker.has(element)) {
        console.log('CountdownWatcher: Countdown completed (no numeric value), removing effect', element);
        
        // Remove the focus effect and overlay since countdown has completed
        if (element && element.classList) {
          element.classList.remove('countdown-focus-effect');
        }
        this.removeOverlayEffect(element);
        
        this.elementTracker.delete(element);
      }
      return;
    }
    
    // Validate that the current value is within our expected range before considering it a countdown
    if (currentValue < this.options.minimumDuration || currentValue > this.options.maximumDuration) {
      // If value is outside our range, remove from tracking
      if (this.elementTracker.has(element)) {
        console.log('CountdownWatcher: Removing element from tracking - value', currentValue, 'outside range [', this.options.minimumDuration, ',', this.options.maximumDuration, ']');
        this.elementTracker.delete(element);
      }
      return;
    }
    
    // Check if we're already tracking this element
    if (this.elementTracker.has(element)) {
      const tracker = this.elementTracker.get(element);
      
      console.log('CountdownWatcher: Element was tracked with value', tracker.lastValue, 'now', currentValue);
      
      // If the value has decreased, increment the consecutive decrease counter
      if (currentValue < tracker.lastValue) {
        tracker.lastValue = currentValue;
        tracker.lastCheckTime = Date.now();
        tracker.consecutiveDecreases = (tracker.consecutiveDecreases || 0) + 1;
        
        console.log('CountdownWatcher: Numeric value decreased to', currentValue, 'element:', element, 'consecutive decreases:', tracker.consecutiveDecreases);
        
        // If we've seen at least 2 consecutive decreases, confirm as valid dynamic countdown
        if (tracker.consecutiveDecreases >= 2 && !this.hasScrolledToCountdown) {
          console.log('CountdownWatcher: Valid dynamic countdown confirmed after', tracker.consecutiveDecreases, 'decreases', element, currentText);
          this.handleConfirmedCountdown(element);
          
          // Continue monitoring until countdown reaches zero
          this.continueMonitoring(element, currentValue);
        }
      } else if (currentValue > tracker.lastValue) {
        // Value increased, reset the counter
        console.log('CountdownWatcher: Value increased from', tracker.lastValue, 'to', currentValue, ', resetting counter');
        tracker.lastValue = currentValue;
        tracker.lastCheckTime = Date.now();
        tracker.consecutiveDecreases = 0;
      } else {
        // Value stayed the same, keep the counter as is
        console.log('CountdownWatcher: Value remained the same at', currentValue, ', counter unchanged:', tracker.consecutiveDecreases);
        tracker.lastValue = currentValue;
        tracker.lastCheckTime = Date.now();
      }
    } else {
      // First time seeing this element with valid countdown value, add to tracker
      this.elementTracker.set(element, {
        lastValue: currentValue,
        lastCheckTime: Date.now(),
        consecutiveDecreases: 0
      });
      
      console.log('CountdownWatcher: Started tracking element with numeric value', currentValue, element);
    }
      
    // Start active monitoring for this element to catch changes
    this.startActiveMonitoring(element);
  }
    
  /**
   * Continue monitoring a confirmed countdown until it reaches zero
   */
  continueMonitoring(element, currentValue) {
    // If the countdown has reached zero, stop monitoring and remove the effect
    if (currentValue <= 0) {
      console.log('CountdownWatcher: Countdown reached zero, stopping monitoring', element);
      if (this.elementTracker.has(element)) {
        this.elementTracker.delete(element);
      }
      
      // Remove the focus effect and overlay
      if (element && element.classList) {
        element.classList.remove('countdown-focus-effect');
      }
      this.removeOverlayEffect(element);
      
      return;
    }
    
    // Check if the element still exists in the DOM
    if (!document.contains(element)) {
      console.log('CountdownWatcher: Element removed from DOM, stopping monitoring', element);
      if (this.elementTracker.has(element)) {
        this.elementTracker.delete(element);
      }
      
      // Remove the focus effect and overlay
      if (element && element.classList) {
        element.classList.remove('countdown-focus-effect');
      }
      this.removeOverlayEffect(element);
      
      return;
    }
    
    // Continue monitoring with a timeout
    setTimeout(() => {
      if (this.elementTracker.has(element)) {
        // Re-check the element's text content
        const currentText = this.getTextContent(element);
        console.log('CountdownWatcher: Re-checking element text:', currentText, 'for element:', element);
        
        // Check if the text has changed to a non-countdown format (like 'Redirecting now!')
        const newValue = this.extractNumericValue(currentText);
        if (newValue === null && currentValue > 0) {
          // Countdown has likely completed but changed to non-numeric text
          console.log('CountdownWatcher: Countdown completed (non-numeric text detected), removing effect', element);
          if (element && element.classList) {
            element.classList.remove('countdown-focus-effect');
          }
          this.removeOverlayEffect(element);
          
          // Remove from tracking
          this.elementTracker.delete(element);
          return;
        }
        
        this.checkForNumericChange(element, currentText);
      }
    }, this.options.validationDelay);
  }
  
  /**
   * Extract numeric value from text content
   */
  extractNumericValue(text) {
    if (!text) return null;
    
    // Match various countdown formats: MM:SS, SS, or text with numbers
    const patterns = [
      /(?:^|\s)(\d{1,2}):([0-5]\d)/,  // MM:SS format
      /(?:^|\s)(\d{1,2})(?=\s|$)/,    // Standalone numbers
      /wait\s+(\d{1,2})\s+seconds?/i,  // Text with seconds
      /in\s+(\d{1,2})\s+seconds?/i,    // Text with seconds (e.g., 'Redirecting in 30 seconds')
      /timer:\s*(\d{1,2})/i,           // Timer labels
      /(\d{1,2})\s*(?:seconds?|secs?|s)\s+remaining/i  // Remaining time
    ];
    
    for (const pattern of patterns) {
      const matches = text.match(pattern);
      if (matches && matches[1]) {
        let num = parseInt(matches[1], 10);
        
        // Handle MM:SS format
        if (matches[2] !== undefined) {
          const minutes = parseInt(matches[1], 10);
          const seconds = parseInt(matches[2], 10);
          num = minutes * 60 + seconds;  // Convert to total seconds
        }
        
        // For initial tracking, accept any reasonable number
        // We'll validate the range during the consecutive decrease check
        if (num >= 1 && num <= 300) { // Accept reasonable countdown values (1-300 seconds)
          return num;
        }
      }
    }
    
    return null;
  }
  
  /**
   * Extract text content from an element
   */
  getTextContent(element) {
    if (!element) return '';
    
    if (element.nodeType === Node.TEXT_NODE) {
      return element.textContent.trim();
    }
    
    if (element.nodeType === Node.ELEMENT_NODE) {
      return element.textContent || element.innerText || '';
    }
    
    return '';
  }

  /**
   * Handle a confirmed countdown element
   */
  handleConfirmedCountdown(element) {
    // Store the confirmed countdown element
    this.detectedCountdownElement = element;
    
    // Scroll to the countdown if needed
    this.scrollToCountdown(element);
    
    // Apply visual focus effect
    this.applyFocusEffect(element);
  }

  /**
   * Scroll to the countdown element if it's not already visible
   */
  scrollToCountdown(element) {
    if (this.hasScrolledToCountdown) {
      console.log('CountdownWatcher: Already scrolled to a countdown, skipping');
      return;
    }

    // Check if element is already in viewport
    const rect = element.getBoundingClientRect();
    const isInViewport = (
      rect.top >= 0 &&
      rect.left >= 0 &&
      rect.bottom <= (window.innerHeight || document.documentElement.clientHeight) &&
      rect.right <= (window.innerWidth || document.documentElement.clientWidth)
    );

    if (isInViewport) {
      console.log('CountdownWatcher: Countdown element already visible in viewport');
      this.hasScrolledToCountdown = true;
      return;
    }

    // Scroll to element
    element.scrollIntoView({
      behavior: this.options.scrollBehavior,
      block: 'center',
      inline: 'center'
    });

    this.hasScrolledToCountdown = true;
    console.log('CountdownWatcher: Scrolled to countdown element', element);
  }

  /**
   * Apply a temporary visual focus effect to the countdown element
   */
  applyFocusEffect(element) {
    if (!element) return;

    // Add CSS class for focus effect
    element.classList.add('countdown-focus-effect');
    
    // Add temporary CSS if not already present
    this.addFocusEffectStyles();
    
    // Create an overlay element for enhanced visibility
    this.createOverlayEffect(element);

    console.log('CountdownWatcher: Applied focus effect to countdown element', element);
  }
  
  /**
   * Create an overlay element for enhanced visibility
   */
  createOverlayEffect(element) {
    // Remove any existing overlay for this element
    this.removeOverlayEffect(element);
    
    const overlay = document.createElement('div');
    overlay.className = 'countdown-focus-overlay';
    
    // Function to update overlay position
    const updatePosition = () => {
      if (!document.contains(overlay) || !document.contains(element)) return;
      
      const rect = element.getBoundingClientRect();
      const scrollTop = window.pageYOffset || document.documentElement.scrollTop;
      const scrollLeft = window.pageXOffset || document.documentElement.scrollLeft;
      
      overlay.style.top = (rect.top + scrollTop - 10) + 'px';
      overlay.style.left = (rect.left + scrollLeft - 10) + 'px';
      overlay.style.width = (rect.width + 20) + 'px';
      overlay.style.height = (rect.height + 20) + 'px';
    };
    
    // Position the overlay around the element
    updatePosition();
    
    overlay.style.position = 'absolute';
    overlay.style.border = '3px solid #ff6b6b';
    overlay.style.borderRadius = '50%';
    overlay.style.pointerEvents = 'none';
    overlay.style.zIndex = '9999';
    overlay.style.boxSizing = 'border-box';
    overlay.style.animation = 'countdown-overlay-pulse 1s infinite alternate';
    overlay.style.boxShadow = '0 0 20px rgba(255, 107, 107, 0.7)';
    
    // Mark this element as added by the extension to avoid observing it
    this.markAsExtensionElement(overlay);
    
    document.body.appendChild(overlay);
    
    // Store reference to the overlay
    element.countdownOverlay = overlay;
    
    // Set up position update interval
    const positionInterval = setInterval(() => {
      if (!document.contains(overlay) || !document.contains(element)) {
        clearInterval(positionInterval);
        return;
      }
      updatePosition();
    }, 100); // Update position every 100ms
    
    // Store interval reference to clear later
    overlay.positionInterval = positionInterval;
  }
  
  /**
   * Remove the overlay effect
   */
  removeOverlayEffect(element) {
    if (element.countdownOverlay && document.contains(element.countdownOverlay)) {
      // Clear the position update interval
      if (element.countdownOverlay.positionInterval) {
        clearInterval(element.countdownOverlay.positionInterval);
      }
      document.body.removeChild(element.countdownOverlay);
      element.countdownOverlay = null;
    }
  }

  /**
   * Add CSS styles for the focus effect
   */
  addFocusEffectStyles() {
    if (document.getElementById('countdown-focus-styles')) {
      return; // Styles already added
    }

    const style = document.createElement('style');
    style.id = 'countdown-focus-styles';
    style.textContent = `
      .countdown-focus-effect {
        position: relative;
        animation: countdown-pulse 1s infinite alternate, countdown-glow 1.5s infinite alternate;
        transform-origin: center;
        transition: all 0.3s ease;
        z-index: 9999 !important;
      }
      
      .countdown-focus-effect::after {
        content: '';
        position: absolute;
        top: 50%;
        left: 50%;
        width: calc(100% + 20px);
        height: calc(100% + 20px);
        transform: translate(-50%, -50%);
        border: 3px solid #ff6b6b;
        border-radius: 50%;
        box-sizing: border-box;
        pointer-events: none;
        z-index: -1;
        animation: countdown-circle-pulse 1s infinite alternate;
      }
      
      @keyframes countdown-pulse {
        from { transform: scale(1); }
        to { transform: scale(1.05); }
      }
      
      @keyframes countdown-glow {
        from { 
          box-shadow: 0 0 10px rgba(255, 107, 107, 0.5), 0 0 20px rgba(255, 107, 107, 0.3); 
          outline: 2px solid rgba(255, 107, 107, 0.5);
        }
        to { 
          box-shadow: 0 0 30px rgba(255, 107, 107, 0.8), 0 0 40px rgba(255, 107, 107, 0.6);
          outline: 2px solid rgba(255, 107, 107, 0.8);
        }
      }
      
      @keyframes countdown-circle-pulse {
        0% {
          width: calc(100% + 20px);
          height: calc(100% + 20px);
          opacity: 0.7;
        }
        100% {
          width: calc(100% + 40px);
          height: calc(100% + 40px);
          opacity: 0.3;
        }
      }
      
      @keyframes countdown-overlay-pulse {
        0% {
          transform: scale(1);
          opacity: 0.7;
        }
        100% {
          transform: scale(1.1);
          opacity: 0.4;
        }
      }
    `;
    
    document.head.appendChild(style);
  }
  
  /**
   * Start active monitoring for an element to catch changes
   */
  startActiveMonitoring(element) {
    // Set up an interval to periodically check the element's text content
    // This is a backup to the MutationObserver to ensure we catch changes
    if (element.countdownMonitorInterval) {
      clearInterval(element.countdownMonitorInterval);
    }
    
    element.countdownMonitorInterval = setInterval(() => {
      if (!document.contains(element)) {
        // Element is no longer in DOM, stop monitoring
        if (element.countdownMonitorInterval) {
          clearInterval(element.countdownMonitorInterval);
          element.countdownMonitorInterval = null;
        }
        return;
      }
      
      const currentText = this.getTextContent(element);
      if (currentText.trim()) {
        this.checkForNumericChange(element, currentText);
      }
    }, 500); // Check every 500ms
  }
  
  /**
   * Mark an element as being added by the extension to avoid observing it
   */
  markAsExtensionElement(element) {
    this.extensionElements.add(element);
  }

  /**
   * Disconnect the observer and clean up
   */
  disconnect() {
    if (this.countdownObserver) {
      this.countdownObserver.disconnect();
      console.log('CountdownWatcher: MutationObserver disconnected');
    }
    
    if (this.focusEffectTimeout) {
      clearTimeout(this.focusEffectTimeout);
      this.focusEffectTimeout = null;
    }
    
    // Clear all debounce timers
    for (const timer of this.debounceTimers.values()) {
      clearTimeout(timer);
    }
    this.debounceTimers.clear();
    
    // Clear all active monitoring intervals and remove effects
    for (const [element] of this.elementTracker) {
      if (element.countdownMonitorInterval) {
        clearInterval(element.countdownMonitorInterval);
        element.countdownMonitorInterval = null;
      }
      // Remove focus effects from tracked elements
      if (element && element.classList) {
        element.classList.remove('countdown-focus-effect');
      }
      this.removeOverlayEffect(element);
    }
    
    // Clear element tracker
    this.elementTracker.clear();
  }
  
  /**
   * Update the enabled state of the countdown watcher
   */
  setEnabled(enabled) {
    this.options.enabled = enabled;
    
    if (!enabled) {
      // If disabling, disconnect the observer and clear all tracking
      if (this.countdownObserver) {
        this.countdownObserver.disconnect();
        console.log('CountdownWatcher: Disabled, disconnected observer');
      }
      
      // Remove all focus effects before clearing tracker
      for (const [element] of this.elementTracker) {
        if (element && element.classList) {
          element.classList.remove('countdown-focus-effect');
        }
        this.removeOverlayEffect(element);
      }
      
      // Clear all tracking
      this.elementTracker.clear();
      
      // Clear all debounce timers
      for (const timer of this.debounceTimers.values()) {
        clearTimeout(timer);
      }
      this.debounceTimers.clear();
      
      // Reset state
      this.hasScrolledToCountdown = false;
      this.detectedCountdownElement = null;
    } else {
      // If enabling, start observing again
      if (this.isExtensionEnabled()) {
        this.startObserving();
      }
    }
  }
  
  /**
   * Reset the watcher state (for re-initialization)
   */
  reset() {
    this.disconnect();
    this.hasScrolledToCountdown = false;
    this.detectedCountdownElement = null;
    this.extensionElements = new WeakSet();
  }

  /**
   * Get the current state of the watcher
   */
  getState() {
    return {
      hasScrolledToCountdown: this.hasScrolledToCountdown,
      detectedCountdownElement: this.detectedCountdownElement,
      isObserving: !!this.countdownObserver
    };
  }
}

// Export for module systems or attach to global scope
if (typeof module !== 'undefined' && module.exports) {
  module.exports = CountdownWatcher;
} else if (typeof window !== 'undefined') {
  window.CountdownWatcher = CountdownWatcher;
}

console.log('CountdownWatcher module loaded');