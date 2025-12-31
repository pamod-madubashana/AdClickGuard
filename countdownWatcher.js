/**
 * Pure Dynamic Countdown Detection Module
 * Detects countdown timers based purely on numeric value decreases over time.
 * Uses MutationObserver to watch for text changes and applies focus effect only to confirmed dynamic countdowns.
 */
class CountdownWatcher {
  constructor(options = {}) {
    // Configuration
    this.options = {
      minimumDuration: 1,  // seconds - allow any reasonable countdown
      maximumDuration: 120,  // seconds - allow any reasonable countdown
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
    
    // Additional state for trigger-based detection
    this.isDetecting = false;
    this.detectionTimeout = null;
    this.buttonObserver = null;
    
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
    
    // Set up event listeners for 'Continue' button clicks
    this.setupButtonListeners();
  }

  /**
   * Check if the extension is enabled
   */
  isExtensionEnabled() {
    // Use the enabled option first
    if (this.options.enabled === false) {
      return false;
    }
    
    // Check for global extension state from content script
    if (typeof window.extensionEnabled !== 'undefined') {
      return window.extensionEnabled === true;
    }
    
    // Check if we're in a real extension context
    if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.id) {
      // In a real extension context, we should get the state from content script
      // This will be set by the content script when it receives the state from background
      if (typeof window.safeUrlExtensionEnabled !== 'undefined') {
        return window.safeUrlExtensionEnabled === true;
      }
      // Default to enabled if no state is set
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
   * Set up event listeners for 'Continue' or equivalent buttons
   */
  setupButtonListeners() {
    // Look for buttons that might trigger countdowns
    const buttonSelectors = [
      'button',
      '[role="button"]',
      '.continue-btn',
      '[class*="continue" i]',
      '[class*="Continue" i]',
      '[id*="continue" i]',
      '[id*="Continue" i]',
      '[class*="next" i]',
      '[id*="next" i]',
      '[class*="Next" i]',
      '[id*="Next" i]',
      '[class*="start" i]',
      '[id*="start" i]',
      '[class*="Start" i]',
      '[id*="Start" i]'
    ];
    
    // Add event listeners to existing buttons
    buttonSelectors.forEach(selector => {
      const buttons = document.querySelectorAll(selector);
      buttons.forEach(button => {
        this.addButtonListener(button);
      });
    });
    
    // Set up a MutationObserver to catch dynamically added buttons
    this.buttonObserver = new MutationObserver((mutations) => {
      mutations.forEach((mutation) => {
        if (mutation.type === 'childList') {
          mutation.addedNodes.forEach((node) => {
            if (node.nodeType === Node.ELEMENT_NODE) {
              // Check the added node itself
              if (this.isButtonElement(node)) {
                this.addButtonListener(node);
              }
              // Check child nodes
              const walker = document.createTreeWalker(
                node,
                NodeFilter.SHOW_ELEMENT,
                {
                  acceptNode: (node) => {
                    if (this.isButtonElement(node)) {
                      return NodeFilter.FILTER_ACCEPT;
                    }
                    return NodeFilter.FILTER_SKIP;
                  }
                }
              );
              
              let currentNode;
              while (currentNode = walker.nextNode()) {
                this.addButtonListener(currentNode);
              }
            }
          });
        }
      });
    });
    
    this.buttonObserver.observe(document.body, {
      childList: true,
      subtree: true
    });
  }
  
  /**
   * Check if an element is a button element
   */
  isButtonElement(element) {
    if (!element || element.nodeType !== Node.ELEMENT_NODE) return false;
    
    const tagName = element.tagName.toLowerCase();
    const className = element.className.toLowerCase();
    const id = (element.id || '').toLowerCase();
    const textContent = (element.textContent || '').toLowerCase();
    
    // Check tag name
    if (tagName === 'button' || tagName === 'input' && element.type === 'button') {
      return true;
    }
    
    // Check for button roles
    if (element.getAttribute('role') === 'button') {
      return true;
    }
    
    // Check for continue-like text content
    const continueKeywords = ['continue', 'next', 'start', 'proceed', 'go', 'skip'];
    if (continueKeywords.some(keyword => textContent.includes(keyword))) {
      return true;
    }
    
    // Check for continue-like class names or IDs
    const continuePatterns = ['continue', 'next', 'start', 'proceed'];
    return continuePatterns.some(pattern => 
      className.includes(pattern.toLowerCase()) || 
      id.includes(pattern.toLowerCase())
    );
  }
  
  /**
   * Add click listener to a button
   */
  addButtonListener(button) {
    // Skip if already has listener
    if (button.countdownWatcherListenerAdded) return;
    
    const clickHandler = () => {
      this.startCountdownDetection();
    };
    
    button.addEventListener('click', clickHandler);
    button.countdownWatcherListenerAdded = true;
    
    // Store the handler for potential cleanup
    button.countdownWatcherClickHandler = clickHandler;
  }
  
  /**
   * Start countdown detection after button click
   */
  startCountdownDetection() {
    console.log('CountdownWatcher: Starting countdown detection after button click');
    
    // If already detecting, don't start again
    if (this.isDetecting) {
      console.log('CountdownWatcher: Already detecting, skipping duplicate start');
      return;
    }
    
    this.isDetecting = true;
    
    // Start observing for dynamic content changes
    this.startObserving();
    
    // Scan the current DOM for potential countdown elements
    this.scanForInitialCountdowns();
    
    // Set up timeout to stop detection after 5 seconds if no countdown is found
    this.detectionTimeout = setTimeout(() => {
      console.log('CountdownWatcher: 5 second timeout reached, stopping detection');
      this.stopCountdownDetection();
    }, 5000); // 5 seconds
  }
  
  /**
   * Stop countdown detection
   */
  stopCountdownDetection() {
    console.log('CountdownWatcher: Stopping countdown detection');
    
    this.isDetecting = false;
    
    // Clear the timeout if it exists
    if (this.detectionTimeout) {
      clearTimeout(this.detectionTimeout);
      this.detectionTimeout = null;
    }
    
    // Disconnect the observer
    if (this.countdownObserver) {
      this.countdownObserver.disconnect();
      this.countdownObserver = null;
    }
    
    // Clear all active monitoring intervals
    for (const [element] of this.elementTracker) {
      if (element.countdownMonitorInterval) {
        clearInterval(element.countdownMonitorInterval);
        element.countdownMonitorInterval = null;
      }
    }
    
    // Clear all debounce timers
    for (const timer of this.debounceTimers.values()) {
      clearTimeout(timer);
    }
    this.debounceTimers.clear();
    
    // Reset element tracking
    this.elementTracker.clear();
    
    // Reset state
    this.hasScrolledToCountdown = false;
    this.detectedCountdownElement = null;
  }
  
  /**
   * Scan the current DOM for potential countdown elements
   */
  scanForInitialCountdowns() {
    console.log('CountdownWatcher: Scanning for initial countdown elements');
    
    // Look for elements that might contain countdown text
    const potentialElements = document.querySelectorAll('div, span, p, h1, h2, h3, h4, h5, h6, li, td, th, a, button, input');
    
    potentialElements.forEach(element => {
      if (this.extensionElements.has(element)) return; // Skip extension-added elements
      
      const textContent = this.getTextContent(element);
      if (textContent.trim()) {
        const numericValue = this.extractNumericValue(textContent);
        
        if (numericValue !== null && numericValue >= 1 && numericValue <= 120) {
          console.log('CountdownWatcher: Found potential countdown element:', element, 'with text:', textContent, 'and value:', numericValue);
          
          // Add to tracking so we can monitor for changes
          if (!this.elementTracker.has(element)) {
            this.elementTracker.set(element, {
              lastValue: numericValue,
              lastCheckTime: Date.now(),
              consecutiveDecreases: 0
            });
            
            console.log('CountdownWatcher: Started tracking initial element with value', numericValue);
            
            // If this is the first countdown element found, apply focus effect immediately
            if (!this.hasScrolledToCountdown && !this.detectedCountdownElement) {
              console.log('CountdownWatcher: First countdown detected, applying immediate focus effect for', numericValue, 'seconds');
              
              // Apply the focus effect immediately with the current value as duration
              this.detectedCountdownElement = element;
              this.scrollToCountdown(element);
              this.applyFocusEffect(element, numericValue);
              
              // Continue monitoring this specific element
              this.continueMonitoring(element, numericValue);
              
              // Stop the general detection since we found a countdown
              this.stopCountdownDetection();
            }
          }
        }
      }
    });
  }

  /**
   * Start observing the DOM for changes that might contain countdowns
   */
  startObserving() {
    // Reset state to handle SPA navigation
    this.resetState();
    
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
      attributes: true,  // Watch for attribute changes
      attributeFilter: ['style', 'class', 'aria-label', 'data-countdown', 'data-timer', 'title', 'value']  // Watch attributes that might contain countdown info
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
    
    // Stop processing mutations if the observer has been disconnected after countdown confirmation
    if (!this.countdownObserver) {
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
      // Check attribute changes (like aria-label, data attributes, etc. that might contain countdown info)
      else if (mutation.type === 'attributes') {
        const element = mutation.target;
        if (element && element.nodeType === Node.ELEMENT_NODE && 
            !this.extensionElements.has(element)) {
          // Check for changes in specific attributes that might contain countdown text
          const attributeName = mutation.attributeName;
          if (['aria-label', 'title', 'data-countdown', 'data-timer', 'value'].includes(attributeName)) {
            const attributeValue = element.getAttribute(attributeName);
            if (attributeValue && attributeValue.trim()) {
              this.processTextChanged(element, attributeValue);
            }
          } else {
            // For style/class changes, check if element visibility changed
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
    
    // Check if this text contains a countdown number and we haven't applied focus yet
    const numericValue = this.extractNumericValue(text);
    if (numericValue !== null && numericValue >= 1 && numericValue <= 120 && 
        !this.hasScrolledToCountdown && !this.detectedCountdownElement && 
        !this.elementTracker.has(element)) {
      console.log('CountdownWatcher: Detected countdown in text change:', text, 'value:', numericValue);
      
      // Apply focus effect immediately if this looks like a countdown
      this.detectedCountdownElement = element;
      this.scrollToCountdown(element);
      this.applyFocusEffect(element, numericValue);
      
      // Continue monitoring this specific element
      this.continueMonitoring(element, numericValue);
      
      // Stop the general detection since we found a countdown
      this.stopCountdownDetection();
      
      // Add to tracking so we can monitor for changes
      this.elementTracker.set(element, {
        lastValue: numericValue,
        lastCheckTime: Date.now(),
        consecutiveDecreases: 0
      });
      
      return; // Exit early since we've handled this as a confirmed countdown
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
      
    // We no longer filter by duration range during initial detection
    // Instead, we track all numeric values and validate behavior after observing changes
    // This ensures we don't miss countdowns that start with values outside our expected range
    // but still exhibit valid countdown behavior
      
    // Check if the value is within reasonable countdown range (1-120 seconds)
    if (currentValue < 1 || currentValue > 120) {
      console.log('CountdownWatcher: Value', currentValue, 'outside reasonable countdown range [1, 120], ignoring element:', element);
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
        if (tracker.consecutiveDecreases >= 2) {
          // Apply duration filtering only after confirming valid countdown behavior
          if (currentValue >= this.options.minimumDuration && currentValue <= this.options.maximumDuration) {
            console.log('CountdownWatcher: Valid dynamic countdown confirmed after', tracker.consecutiveDecreases, 'decreases', element, currentText);
                    
            // If we haven't applied the focus effect yet, do it now
            if (!this.hasScrolledToCountdown && !this.detectedCountdownElement) {
              this.detectedCountdownElement = element;
              this.scrollToCountdown(element);
              this.applyFocusEffect(element, currentValue);
              this.continueMonitoring(element, currentValue);
                      
              // Stop the general detection since we confirmed a countdown
              this.stopCountdownDetection();
            }
          } else {
            console.log('CountdownWatcher: Countdown confirmed but outside duration range [', this.options.minimumDuration, ',', this.options.maximumDuration, '], ignoring:', currentValue);
            // Remove from tracking since it's not in our desired range
            this.elementTracker.delete(element);
          }
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
      
    // Only start active monitoring if we haven't confirmed a countdown yet
    if (!this.hasScrolledToCountdown && this.countdownObserver) {
      // Start active monitoring for this element to catch changes
      this.startActiveMonitoring(element);
    }
  }
    
  /**
   * Continue monitoring a confirmed countdown until it reaches zero
   */
  continueMonitoring(element, countdownDuration) {
    // Check if the element still exists in the DOM
    if (!document.contains(element)) {
      console.log('CountdownWatcher: Element removed from DOM, stopping monitoring', element);
      if (element && element.classList) {
        element.classList.remove('countdown-focus-effect');
      }
      this.removeOverlayEffect(element);
      
      return;
    }
    
    // Set up a timeout to stop monitoring when the countdown duration completes
    setTimeout(() => {
      // Check if element still exists before removing effects
      if (document.contains(element)) {
        console.log('CountdownWatcher: Countdown duration completed, removing effect', element);
        this.removeOverlayEffect(element);
      }
    }, countdownDuration * 1000); // Convert seconds to milliseconds
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
   * Extract countdown duration with priority order:
   * 1. data-duration attribute
   * 2. initial textContent number
   * 3. fallback to max_watch_window_seconds
   */
  extractCountdownDuration(element) {
    // First, check for data-duration attribute
    if (element && element.dataset && element.dataset.duration) {
      const duration = parseInt(element.dataset.duration, 10);
      if (!isNaN(duration) && duration > 0) {
        console.log('CountdownWatcher: Using data-duration attribute:', duration);
        return duration;
      }
    }
    
    // Second, try to extract from the initial text content
    const textContent = this.getTextContent(element);
    const initialNumericValue = this.extractNumericValue(textContent);
    if (initialNumericValue !== null && initialNumericValue > 0) {
      console.log('CountdownWatcher: Using initial text content value:', initialNumericValue);
      return initialNumericValue;
    }
    
    // Third, fallback to max watch window seconds
    console.log('CountdownWatcher: Using fallback max duration:', this.options.maximumDuration);
    return this.options.maximumDuration;
  }

  /**
   * Handle a confirmed countdown element
   */
  handleConfirmedCountdown(element) {
    // Store the confirmed countdown element
    this.detectedCountdownElement = element;
    
    // Extract the current countdown value from the element
    const currentText = this.getTextContent(element);
    const currentValue = this.extractNumericValue(currentText);
    
    // If we can't extract the current value, use fallback
    const countdownDuration = currentValue !== null ? currentValue : 10; // fallback to 10 seconds
    
    console.log('CountdownWatcher: Countdown confirmed with duration:', countdownDuration, 'seconds');
    
    // Scroll to the countdown if needed
    this.scrollToCountdown(element);
    
    // Apply visual focus effect with duration equal to remaining countdown time
    this.applyFocusEffect(element, countdownDuration);
    
    // Disconnect the observer since we've confirmed a countdown
    this.disconnectObserver();
    
    // Stop the general countdown detection
    this.stopCountdownDetection();
    
    // Continue monitoring the specific countdown element until it completes
    this.continueMonitoring(element, countdownDuration);
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
  applyFocusEffect(element, countdownDuration = null) {
    if (!element) return;

    // Add temporary CSS if not already present
    this.addFocusEffectStyles();
    
    // Create an overlay element for enhanced visibility only if one doesn't already exist
    if (!element.countdownOverlay) {
      this.createOverlayEffect(element);
    }

    // Determine the duration for the effect
    // According to requirements: effect duration must be exactly equal to remaining countdown seconds
    const effectDuration = countdownDuration !== null ? countdownDuration : 10; // fallback to 10 seconds
    
    // Set up a timeout to remove the effect when the countdown completes
    if (this.focusEffectTimeout) {
      clearTimeout(this.focusEffectTimeout);
    }
    
    this.focusEffectTimeout = setTimeout(() => {
      this.removeFocusEffect(element);
    }, effectDuration * 1000); // Convert seconds to milliseconds

    console.log('CountdownWatcher: Applied focus effect to countdown element for', effectDuration, 'seconds', element);
  }
  
  /**
   * Create an overlay element for enhanced visibility
   */
  createOverlayEffect(element) {
    // Remove any existing overlay for this element
    this.removeOverlayEffect(element);
    
    // Don't create overlay for essential page elements
    if (element === document.body || element === document.documentElement ||
        element.tagName === 'BODY' || element.tagName === 'HTML') {
      return;
    }
    
    const overlay = document.createElement('div');
    overlay.className = 'countdown-focus-overlay';
    
    // Function to update overlay position
    const updatePosition = () => {
      if (!document.contains(overlay) || !document.contains(element)) return;
      
      const rect = element.getBoundingClientRect();
      
      // Skip if the element is too large (like a full viewport element)
      const viewportWidth = window.innerWidth;
      const viewportHeight = window.innerHeight;
      if (rect.width > viewportWidth * 0.9 && rect.height > viewportHeight * 0.9) {
        // Don't apply overlay to elements that cover most of the viewport
        overlay.style.display = 'none';
        return;
      }
      
      const scrollTop = window.pageYOffset || document.documentElement.scrollTop;
      const scrollLeft = window.pageXOffset || document.documentElement.scrollLeft;
      
      overlay.style.top = (rect.top + scrollTop - 10) + 'px';
      overlay.style.left = (rect.left + scrollLeft - 10) + 'px';
      overlay.style.width = (rect.width + 20) + 'px';
      overlay.style.height = (rect.height + 20) + 'px';
      overlay.style.display = 'block'; // Make sure it's visible
    };
    
    // Position the overlay around the element
    updatePosition();
    
    overlay.style.position = 'absolute';
    overlay.style.border = '3px solid #4ade80';
    overlay.style.borderRadius = '12px';
    overlay.style.pointerEvents = 'none';
    overlay.style.zIndex = '9999';
    overlay.style.boxSizing = 'border-box';
    overlay.style.animation = 'countdown-overlay-pulse 1s infinite alternate';
    overlay.style.boxShadow = '0 0 20px rgba(74, 222, 128, 0.7)';
    overlay.style.backgroundColor = 'rgba(74, 222, 128, 0.1)';
    
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
        animation: countdown-pulse 0.8s infinite alternate, countdown-glow 1.2s infinite alternate;
        transform-origin: center;
        transition: all 0.3s ease;
        z-index: 9999 !important;
        border-radius: 8px !important;
      }
      
      .countdown-focus-effect::after {
        content: '';
        position: absolute;
        top: 50%;
        left: 50%;
        width: calc(100% + 20px);
        height: calc(100% + 20px);
        transform: translate(-50%, -50%);
        border: 3px solid #4ade80;
        border-radius: 12px;
        box-sizing: border-box;
        pointer-events: none;
        z-index: -1;
        animation: countdown-circle-pulse 1s infinite alternate;
      }
      
      @keyframes countdown-pulse {
        0% { 
          transform: scale(1);
          filter: drop-shadow(0 0 5px rgba(74, 222, 128, 0.5));
        }
        100% { 
          transform: scale(1.03);
          filter: drop-shadow(0 0 15px rgba(74, 222, 128, 0.8));
        }
      }
      
      @keyframes countdown-glow {
        0% { 
          box-shadow: 0 0 10px rgba(74, 222, 128, 0.5), 0 0 20px rgba(74, 222, 128, 0.3); 
          outline: 2px solid rgba(74, 222, 128, 0.5);
        }
        100% { 
          box-shadow: 0 0 25px rgba(74, 222, 128, 0.8), 0 0 35px rgba(74, 222, 128, 0.6);
          outline: 2px solid rgba(74, 222, 128, 0.8);
        }
      }
      
      @keyframes countdown-circle-pulse {
        0% {
          width: calc(100% + 20px);
          height: calc(100% + 20px);
          opacity: 0.6;
          border-color: rgba(74, 222, 128, 0.6);
        }
        100% {
          width: calc(100% + 30px);
          height: calc(100% + 30px);
          opacity: 0.3;
          border-color: rgba(74, 222, 128, 0.3);
        }
      }
      
      @keyframes countdown-overlay-pulse {
        0% {
          transform: scale(1);
          opacity: 0.8;
        }
        100% {
          transform: scale(1.05);
          opacity: 0.6;
        }
      }
    `;
    
    document.head.appendChild(style);
  }
  
  /**
   * Remove focus effect from element
   */
  removeFocusEffect(element) {
    if (!element) return;
    
    // Remove overlay effect
    this.removeOverlayEffect(element);
    
    console.log('CountdownWatcher: Removed focus effect from countdown element', element);
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
    this.disconnectObserver();
    
    // Disconnect button observer
    if (this.buttonObserver) {
      this.buttonObserver.disconnect();
      this.buttonObserver = null;
    }
    
    if (this.focusEffectTimeout) {
      clearTimeout(this.focusEffectTimeout);
      this.focusEffectTimeout = null;
    }
    
    // Clear detection timeout if it exists
    if (this.detectionTimeout) {
      clearTimeout(this.detectionTimeout);
      this.detectionTimeout = null;
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
   * Disconnect only the MutationObserver
   */
  disconnectObserver() {
    if (this.countdownObserver) {
      this.countdownObserver.disconnect();
      this.countdownObserver = null;
      console.log('CountdownWatcher: MutationObserver disconnected after countdown confirmation');
    }
    
    // Clear all active monitoring intervals that may still be running
    for (const [element] of this.elementTracker) {
      if (element.countdownMonitorInterval) {
        clearInterval(element.countdownMonitorInterval);
        element.countdownMonitorInterval = null;
      }
    }
  }
  
  /**
   * Update the enabled state of the countdown watcher
   */
  setEnabled(enabled) {
    this.options.enabled = enabled;
    
    if (!enabled) {
      // If disabling, disconnect all observers and clear all tracking
      if (this.countdownObserver) {
        this.countdownObserver.disconnect();
        console.log('CountdownWatcher: Disabled, disconnected observer');
      }
      
      // Disconnect button observer
      if (this.buttonObserver) {
        this.buttonObserver.disconnect();
        console.log('CountdownWatcher: Disabled, disconnected button observer');
      }
      
      // Clear detection timeout if it exists
      if (this.detectionTimeout) {
        clearTimeout(this.detectionTimeout);
        this.detectionTimeout = null;
      }
      
      // Remove all focus effects before clearing tracker
      for (const [element] of this.elementTracker) {
        if (element && element.classList) {
          element.classList.remove('countdown-focus-effect');
        }
        this.removeOverlayEffect(element);
      }
      
      // Clear all active monitoring intervals
      for (const [element] of this.elementTracker) {
        if (element.countdownMonitorInterval) {
          clearInterval(element.countdownMonitorInterval);
          element.countdownMonitorInterval = null;
        }
      }
      
      // Clear all tracking
      this.elementTracker.clear();
      
      // Clear all debounce timers
      for (const timer of this.debounceTimers.values()) {
        clearTimeout(timer);
      }
      this.debounceTimers.clear();
      
      // Clear the focus effect timeout
      if (this.focusEffectTimeout) {
        clearTimeout(this.focusEffectTimeout);
        this.focusEffectTimeout = null;
      }
      
      // Reset state
      this.hasScrolledToCountdown = false;
      this.detectedCountdownElement = null;
      this.isDetecting = false;
    } else {
      // If enabling, set up button listeners again
      if (this.isExtensionEnabled()) {
        this.setupButtonListeners();
      }
    }
  }
  
  /**
   * Reset the watcher state (for re-initialization)
   */
  reset() {
    this.disconnect();
    this.resetState();
    this.extensionElements = new WeakSet();
  }
  
  /**
   * Reset just the state variables
   */
  resetState() {
    this.hasScrolledToCountdown = false;
    this.detectedCountdownElement = null;
    this.isDetecting = false;
    this.detectionTimeout = null;
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