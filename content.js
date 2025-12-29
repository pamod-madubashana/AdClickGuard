// Ad Click Guard Content Script
(function() {
  'use strict';

  // Import ad detection functions
  // The ad detection functions are now in adDetection.js and loaded via manifest.json

  // Prevent conflicts with other libraries by using a more isolated approach
  const originalQuerySelector = document.querySelector;
  const originalQuerySelectorAll = document.querySelectorAll;

  // Initialize immediately without waiting for full page load to add overlays as fast as possible
  if (document.readyState === 'loading') {
    // DOM still loading, initialize as early as possible
    document.addEventListener('DOMContentLoaded', initialize);
  } else {
    // DOM already loaded, initialize immediately
    initialize();
  }

  // Configuration
  const CONFIG = {
    highlightColor: '#FFD700', // Gold color for highlights
    adOverlayColor: 'rgba(255, 0, 0, 0.25)', // Red with low opacity for ad overlays
    filterListUrl: 'https://easylist-downloads.adblockplus.org/easyprivacy+easylist.txt'
  };

  // State variables
  let isEnabled = false; // Default to false
  let isInitialized = false; // Track if configuration has been loaded
  let observer = null;
  let cosmeticSelectors = [];
  let adElements = new Map(); // Track ad elements and their overlays
  let filterListLoaded = false;
  let filterLoadPromise = null;
  let detectionInProgress = false; // Prevent duplicate detection runs
  let detectionTimeout = null; // For debouncing
  let periodicDetectionInterval = null; // For periodic detection



  function initialize() {
    // Load configuration and start immediately without waiting for full page load
    loadConfiguration().then(() => {
      console.log('Content script initialized, current enabled state:', isEnabled);
      isInitialized = true; // Mark as initialized
      
      // Listen for messages from popup
      chrome.runtime.onMessage.addListener(handleMessage);
      
      // Start the extension if enabled
      if (isEnabled) {
        startAdGuard();
      } else {
        // Make sure everything is stopped if not enabled
        stopAdGuard();
      }
    });
  }

  function loadConfiguration() {
    // Content scripts can't directly access chrome.storage, so we need to get the state from background
    return new Promise((resolve) => {
      // Check if chrome.runtime is available before making calls
      if (typeof chrome === 'undefined' || !chrome.runtime || !chrome.runtime.sendMessage) {
        console.log('Chrome runtime not available, defaulting to disabled');
        isEnabled = false;
        resolve();
        return;
      }
      
      // Request current state from extension with retry logic
      let attempts = 0;
      const maxAttempts = 3;
      
      function requestState() {
        attempts++;
        chrome.runtime.sendMessage({action: 'getStatus'}, (response) => {
          if (chrome.runtime.lastError) {
            console.log(`Attempt ${attempts}: Error getting state from extension:`, chrome.runtime.lastError.message);
            if (attempts < maxAttempts) {
              // Retry after a short delay
              setTimeout(requestState, 300);
            } else {
              // If all attempts failed, default to disabled
              console.log('All attempts failed, defaulting to disabled');
              isEnabled = false;
              resolve();
            }
          } else if (response && response.enabled !== undefined) {
            isEnabled = response.enabled;
            console.log('Received state from extension:', isEnabled);
            // Load filter list if extension is enabled
            if (isEnabled && !filterListLoaded) {
              loadFilterList().then(() => {
                resolve();
              });
            } else {
              resolve();
            }
          } else {
            // Default to disabled
            isEnabled = false;
            resolve();
          }
        });
      }
      
      requestState();
    });
  }
  
  function loadFilterList() {
    if (filterLoadPromise) {
      return filterLoadPromise;
    }
    
    filterLoadPromise = fetch(CONFIG.filterListUrl)
      .then(response => response.text())
      .then(text => {
        // Use the parseCosmeticFilters function from adDetection.js with current hostname
        cosmeticSelectors = window.adDetection.parseCosmeticFilters(text, window.location.hostname);
        filterListLoaded = true;
        console.log('Filter list loaded with', cosmeticSelectors.length, 'cosmetic selectors');
        return cosmeticSelectors;
      })
      .catch(error => {
        console.error('Failed to load filter list:', error);
        // Fallback to some common ad selectors if loading fails
        cosmeticSelectors = [
          '.adsbygoogle',
          '.ad-container',
          '.advertisement',
          '.ad-placement',
          '.google-ads',
          '.adsense',
          '.doubleclick',
          '.ad-slot',
          '.ad-banner',
          '.ad-box',
          '.ad-unit',
          '.pub_300x250',
          '.pub_300x250m',
          '.pub_728x90',
          '.text-ad',
          '.text-ad-links',
          '.text-ads',
          '.text-adv',
          '[id*="ad" i]',
          '[class*="ad" i]',
          '[id*="advertisement" i]',
          '[class*="advertisement" i]',
          '[id*="banner" i]',
          '[class*="banner" i]',
          '[data-ad-client]',
          '[data-google-ads]',
          '[data-ad-slot]',
          '[data-ad-format]',
          '.afs_ads',
          '.adsbygoogle',
          '.google_ads',
          '.googlesyndication'
        ];
        filterListLoaded = true;
        return cosmeticSelectors;
      });
    
    return filterLoadPromise;
  }
  


  function handleMessage(request, sender, sendResponse) {
    if (request.action === 'toggleExtension') {
      console.log('Content script received toggle request, enabled:', request.enabled);
      const wasEnabled = isEnabled;
      isEnabled = request.enabled;
      
      if (isEnabled) {
        console.log('Enabling Ad Guard');
        // Only start if already initialized, otherwise wait for initialization
        if (isInitialized) {
          startAdGuard();
        } else {
          // If not initialized yet, load configuration first, then start
          loadConfiguration().then(() => {
            isInitialized = true;
            startAdGuard();
          });
        }
      } else {
        console.log('Disabling Ad Guard, removing all overlays and highlights');
        stopAdGuard();
      }
      
      // Send response back to confirm
      try {
        sendResponse({status: 'received', enabled: isEnabled});
      } catch (e) {
        console.debug('Could not send response:', e);
      }
    }
    return true; // Required for async sendResponse
  }

  function startAdGuard() {
    console.log('startAdGuard called, isInitialized:', isInitialized);
    
    // Run immediate high-confidence detection for Google Publisher Tags and other known ad elements
    detectHighConfidenceAds();
    
    // Detect and overlay ad elements
    detectAndOverlayAds();
    
    // Run a more comprehensive scan immediately
    setTimeout(() => {
      detectHighConfidenceAds();
      detectAndOverlayAds();
    }, 100);
    
    // Run another scan to catch ads that might have loaded
    setTimeout(() => {
      detectHighConfidenceAds();
      detectAndOverlayAds();
    }, 300);
    
    // Run another scan for late-loading ads
    setTimeout(() => {
      detectHighConfidenceAds();
    }, 800);
    
    // Set up MutationObserver to handle dynamic content
    setupMutationObserver();
    
    // Run additional scans periodically
    if (periodicDetectionInterval) {
      clearInterval(periodicDetectionInterval);
    }
    periodicDetectionInterval = setInterval(() => {
      if (isEnabled) {
        detectHighConfidenceAds();
        detectAndOverlayAds();
        // Also run Google-specific detection
        detectGoogleAds();
      }
    }, 3000); // Every 3 seconds - more frequent for Google ads
    
    // Run an initial scan for ads that might be already present
    setTimeout(() => {
      detectHighConfidenceAds();
      detectAndOverlayAds();
    }, 1500);
    
    // Final comprehensive scan
    setTimeout(() => {
      detectHighConfidenceAds();
      detectAndOverlayAds();
    }, 3000);
  }

  function stopAdGuard() {
    console.log('stopAdGuard called');
    // Remove all highlights
    removeHighlights();
    
    // Remove all ad overlays
    removeAdOverlays();
    
    // Disconnect observer
    if (observer) {
      observer.disconnect();
      observer = null;
    }
    
    // Clear periodic detection interval
    if (periodicDetectionInterval) {
      clearInterval(periodicDetectionInterval);
      periodicDetectionInterval = null;
    }
    
    // Reset initialization flag
    isInitialized = false;
  }

  function processPageElements() {
    console.log('processPageElements called, isInitialized:', isInitialized, 'isEnabled:', isEnabled);
    if (!isInitialized || !isEnabled) return;
      
    // Removed old ad detection methods - only using EasyList-based detection now
  }
  
  function detectAndOverlayAds() {
    if (!isInitialized || !isEnabled || !filterListLoaded || detectionInProgress) return;
    
    // Set detection in progress flag
    detectionInProgress = true;
    
    // Use the detectAndOverlayAds function from adDetection.js
    window.adDetection.detectAndOverlayAds(cosmeticSelectors, adElements, CONFIG, isAdElement, hasParentAdOverlay, addAdOverlay, calculateAdConfidence, isElementLikelyAd);
    
    // Additional comprehensive scan to catch any missed ads
    setTimeout(() => {
      // Run a second pass to catch ads that might have been missed
      // This is especially important for dynamically loaded content
      detectHighConfidenceAds();
    }, 300);
    
    // Reset the flag after a short delay
    setTimeout(() => {
      detectionInProgress = false;
    }, 100);
  }
  
  function detectGoogleAds() {
    // Use the detectGoogleAds function from adDetection.js
    window.adDetection.detectGoogleAds(adElements, CONFIG, isAdElement, hasParentAdOverlay, addAdOverlay, isGoogleAdElement);
  }
  
  function detectHighConfidenceAds() {
    // Use the detectHighConfidenceAds function from adDetection.js
    window.adDetection.detectHighConfidenceAds(adElements, CONFIG, isAdElement, hasParentAdOverlay, addAdOverlay, isElementLikelyAd, calculateAdConfidence);
  }
  
  // Calculate confidence score for an element being an ad
  function calculateAdConfidence(element) {
    // Use the calculateAdConfidence function from adDetection.js
    return window.adDetection.calculateAdConfidence(element, cosmeticSelectors);
  }
  

  
  // Function to specifically check for Google AdSense elements
  function isGoogleAdElement(element) {
    // Use the isGoogleAdElement function from adDetection.js
    return window.adDetection.isGoogleAdElement(element);
  }
  
  // Main function to determine if an element is likely an ad with confidence scoring
  function isElementLikelyAd(element) {
    // Use the isElementLikelyAd function from adDetection.js
    return window.adDetection.isElementLikelyAd(element);
  }
    
  // Function to check if an element is likely content rather than an ad
  function isElementLikelyContent(element) {
    // Use the isElementLikelyContent function from adDetection.js
    return window.adDetection.isElementLikelyContent(element);
  }
    
  // Function to check if an element is already marked as an ad
  function isAdElement(element) {
    return adElements.has(element);
  }
    
  // Function to check if any parent element already has an overlay
  function hasParentAdOverlay(element) {
    let parent = element.parentElement;
    while (parent) {
      if (isAdElement(parent)) {
        return true;
      }
      parent = parent.parentElement;
    }
    return false;
  }
    
  function addAdOverlay(element) {
    if (!element || element.nodeType !== Node.ELEMENT_NODE) return;
    
    // Additional check to avoid overlaying essential elements
    const tagName = element.tagName.toLowerCase();
    const className = element.className.toLowerCase();
    const id = element.id ? element.id.toLowerCase() : '';
    
    // Don't overlay essential page elements
    const essentialElements = ['body', 'html', 'head', 'header', 'footer', 'nav', 'main', 'article', 'section', 'aside'];
    if (essentialElements.includes(tagName) ||
        element === document.body || 
        element === document.documentElement) {
      console.debug('Skipping overlay for essential element:', element);
      return;
    }
    
    // Additional check for elements that are likely page containers based on attributes
    if ((tagName === 'div' && 
         (className.includes('container') || className.includes('wrapper') || 
          className.includes('layout') || className.includes('page') || className.includes('site')) &&
         !className.includes('ad') && !className.includes('advertisement') && !className.includes('banner')) ||
        ((id.includes('container') || id.includes('wrapper') || id.includes('layout') || id.includes('main') || id.includes('content')) &&
         !id.includes('ad') && !id.includes('advertisement') && !id.includes('banner'))) {
      console.debug('Skipping overlay for likely page container element:', element);
      return;
    }
    
    // Don't overlay elements that are clearly content
    const contentElements = ['h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'p', 'span', 'div', 'a', 'img', 'ul', 'ol', 'li'];
    if (contentElements.includes(tagName) && 
        (className.includes('title') || className.includes('header') || className.includes('footer') || 
         className.includes('nav') || className.includes('menu') || className.includes('brand') ||
         className.includes('content') || className.includes('text') || className.includes('post') ||
         className.includes('article') || className.includes('page') || className.includes('site')) &&
        !className.includes('ad') && !className.includes('advertisement')) {
      console.debug('Skipping overlay for content element:', element);
      return;
    }
    
    // Don't overlay if parent element already has an overlay
    if (hasParentAdOverlay(element)) {
      console.debug('Parent element already has overlay, skipping child:', element);
      return;
    }
    
    // Get element metrics for size validation
    const rect = element.getBoundingClientRect();
    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;
        
    // Get computed style to determine positioning type
    const computedStyle = window.getComputedStyle(element);
    const elementPosition = computedStyle.position;
        
    // Size safety rules: Do NOT overlay elements that are too large
    if (rect.width > viewportWidth * 0.9 ||  // More than 90% of viewport width
        rect.height > viewportHeight * 0.6 || // More than 60% of viewport height
        (rect.width > viewportWidth * 0.95 && rect.top <= 1 && rect.left <= 1) || // Positioned at top-left like a container
        (rect.width < 2 || rect.height < 2)) { // Zero or near-zero dimensions
      console.debug('Skipping overlay: element too large, positioned like container, or has near-zero dimensions:', element, 'Rect:', rect);
      return;
    }
        
    // Don't overlay elements that are too large or positioned like page containers (likely not ads)
    // If element is nearly the full viewport size and positioned at top-left, it's likely a page container, not an ad
    if ((rect.width > viewportWidth * 0.9 && rect.height > viewportHeight * 0.9)) {
      console.debug('Skipping overlay for element that covers most of viewport:', element, 'Rect:', rect);
      return;
    }
        
    // Check if element already has an associated overlay (duplicate prevention)
    if (isAdElement(element)) {
      console.debug('Element already has overlay, skipping duplicate:', element);
      return;
    }
        
    // For sticky elements, wait 5 seconds to ensure they are fully loaded before adding overlay
    if (elementPosition === 'sticky') {
      console.debug('Detected sticky element, waiting 5 seconds to ensure it is fully loaded:', element);
          
      // Wait 5 seconds before creating overlay for sticky elements
      const stickyTimeout = setTimeout(() => {
        // Check if element still exists in the DOM before creating overlay
        if (document.contains(element) && !isAdElement(element)) {
          console.debug('Sticky element still exists after 5 seconds, creating overlay');
          
          // Re-check all conditions without recursion by creating a new function
          // that skips the sticky check to avoid infinite loop
          createOverlayForSticky(element);
        } else {
          console.debug('Sticky element no longer exists or already has overlay, skipping');
        }
      }, 5000); // 5 seconds delay
      
      // Store the timeout reference on the element so we can clear it if needed
      element._stickyTimeout = stickyTimeout;
          
      return; // Don't add overlay immediately, wait for the delay
    }
          
    // Mark element as being processed to prevent race conditions
    // This ensures that if multiple detection functions run simultaneously,
    // only one will proceed to create an overlay
    adElements.set(element, true);
    
    try {
      // Create overlay element
      const overlay = document.createElement('div');
      overlay.className = 'ad-click-guard-overlay';
      overlay.setAttribute('data-ad-element', true);
      
      // Store reference to the original element on the overlay
      overlay._adElement = element;
      
      // Position the overlay absolutely over the ad element
      updateOverlayPosition(overlay, element);
      
      // Add overlay to document body
      if (document.body) {
        document.body.appendChild(overlay);
      } else {
        // If body isn't ready yet, try to append to documentElement
        document.documentElement.appendChild(overlay);
      }
      
      // Update the mapping to use the actual overlay element
      adElements.set(element, overlay);
      
      // Add resize and scroll listeners to keep overlay positioned correctly
      setupOverlayListeners(element, overlay);
      
      // Log successful overlay addition
      console.log('✅ Successfully added ad overlay for element:', element, 'Tag:', element.tagName, 'Class:', element.className, 'ID:', element.id);
      
      // Log element attributes for debugging
      if (element.src) console.debug('  Element src:', element.src);
      if (element.attributes) {
        for (let attr of element.attributes) {
          if (attr.name.includes('ad') || attr.name.includes('google') || attr.value.includes('google') || attr.value.includes('ad')) {
            console.debug('  Ad-related attribute:', attr.name, '=', attr.value);
          }
        }
      }
      
      // Additional logging to help identify which elements are being covered
      console.debug('  Element position:', element.getBoundingClientRect());
      console.debug('  Element dimensions:', element.offsetWidth, 'x', element.offsetHeight);
      console.debug('  Element text content length:', element.textContent ? element.textContent.trim().length : 0);
      
      // Special handling for elements that might be hidden initially (like Google ads)
      // Set up a MutationObserver to watch for style changes that make the element visible
      const elementObserver = new MutationObserver(() => {
        // Update overlay position when element becomes visible
        // Use requestAnimationFrame to avoid layout thrashing
        if (window.requestAnimationFrame) {
          window.requestAnimationFrame(() => {
            updateOverlayPosition(overlay, element);
            
            // If element is now visible but overlay wasn't properly positioned, fix it
            const rect = element.getBoundingClientRect();
            if (rect.width > 0 && rect.height > 0) {
              overlay.style.display = 'block';
              overlay.style.visibility = 'visible';
            }
          });
        } else {
          // Fallback for older browsers
          setTimeout(() => {
            updateOverlayPosition(overlay, element);
            
            // If element is now visible but overlay wasn't properly positioned, fix it
            const rect = element.getBoundingClientRect();
            if (rect.width > 0 && rect.height > 0) {
              overlay.style.display = 'block';
              overlay.style.visibility = 'visible';
            }
          }, 0);
        }
      });
      
      elementObserver.observe(element, {
        attributes: true,
        attributeFilter: ['style', 'class', 'width', 'height', 'display', 'visibility', 'opacity', 'position']
      });
      
      // Store the observer reference so we can disconnect it later
      overlay._elementObserver = elementObserver;
      
      // Also check periodically if the element becomes visible
      const visibilityInterval = setInterval(() => {
        const rect = element.getBoundingClientRect();
        if (rect.width > 0 && rect.height > 0 && element.offsetParent !== null) {
          // Element is visible, update position and make sure overlay is visible
          updateOverlayPosition(overlay, element);
          overlay.style.display = 'block';
          overlay.style.visibility = 'visible';
          clearInterval(visibilityInterval); // Stop checking once visible
        }
      }, 500); // Check every 500ms
      
      // Store the interval reference so we can clear it later
      overlay._visibilityInterval = visibilityInterval;
    } catch (e) {
      // If there was an error, clean up by removing the element from the map
      adElements.delete(element);
      console.error('❌ Error adding ad overlay:', e, 'Element:', element);
    }
  }
  
  function updateOverlayPosition(overlay, element) {
    if (!overlay || !element) return;
    
    try {
      // Get computed style to determine positioning type
      const computedStyle = window.getComputedStyle(element);
      const elementPosition = computedStyle.position;
      
      // Get element position relative to viewport
      const rect = element.getBoundingClientRect();
      
      // Determine positioning strategy based on element's CSS position
      if (elementPosition === 'fixed') {
        // For fixed elements, use fixed positioning for the overlay
        overlay.style.position = 'fixed';
        overlay.style.top = rect.top + 'px';
        overlay.style.left = rect.left + 'px';
        console.debug('Overlay positioned fixed for element with position: fixed');
      } else if (elementPosition === 'sticky') {
        // For sticky elements, we need to determine if it's currently acting as fixed or not
        // Sticky elements behave differently based on scroll position
        // Use fixed positioning to match the sticky element's current behavior
        overlay.style.position = 'fixed';
        overlay.style.top = rect.top + 'px';
        overlay.style.left = rect.left + 'px';
        console.debug('Overlay positioned fixed for element with position: sticky');
      } else {
        // For static, relative, or absolute elements, use absolute positioning with scroll offsets
        const scrollTop = window.pageYOffset || document.documentElement.scrollTop;
        const scrollLeft = window.pageXOffset || document.documentElement.scrollLeft;
        
        overlay.style.position = 'absolute';
        overlay.style.top = (rect.top + scrollTop) + 'px';
        overlay.style.left = (rect.left + scrollLeft) + 'px';
      }
      
      // Set dimensions
      overlay.style.width = rect.width + 'px';
      overlay.style.height = rect.height + 'px';
      overlay.style.zIndex = '2147483647'; // Maximum z-index
      overlay.style.pointerEvents = 'auto';
      overlay.style.cursor = 'not-allowed';
      overlay.style.backgroundColor = CONFIG.adOverlayColor;
      
      // Ensure the overlay has the correct border box sizing
      overlay.style.boxSizing = 'border-box';
      
      // Add border for visibility
      overlay.style.border = '2px solid red';
      
      // Ensure overlay is visible even if parent has overflow hidden
      overlay.style.margin = '0';
      overlay.style.padding = '0';
      
      // Make sure the overlay is properly displayed
      overlay.style.display = 'block';
      
      // Additional check to ensure overlay is visible
      overlay.style.visibility = 'visible';
      overlay.style.opacity = '1';
      
      // Handle elements that might have zero dimensions (like hidden ads)
      if (rect.width === 0 || rect.height === 0) {
        // If the element has no visible dimensions, try to get dimensions from parent or use fallback
        if (element.offsetWidth > 0 && element.offsetHeight > 0) {
          overlay.style.width = element.offsetWidth + 'px';
          overlay.style.height = element.offsetHeight + 'px';
        } else {
          // Fallback: if still zero, try to get from computed styles
          if (parseFloat(computedStyle.width) > 0 && parseFloat(computedStyle.height) > 0) {
            overlay.style.width = computedStyle.width;
            overlay.style.height = computedStyle.height;
          }
        }
      }
    } catch (e) {
      console.debug('Error updating overlay position:', e);
    }
  }
  
  function setupOverlayListeners(element, overlay) {
    // Store the listeners on the overlay so we can remove them later
    overlay._scrollListener = () => updateOverlayPosition(overlay, element);
    overlay._resizeListener = () => updateOverlayPosition(overlay, element);
    
    // Add event listeners
    window.addEventListener('scroll', overlay._scrollListener, { passive: true });
    window.addEventListener('resize', overlay._resizeListener);
    
    // Also watch for element mutations that might change its position
    const elementObserver = new MutationObserver(() => {
      // Use requestAnimationFrame to avoid layout thrashing
      if (window.requestAnimationFrame) {
        window.requestAnimationFrame(() => {
          updateOverlayPosition(overlay, element);
        });
      } else {
        // Fallback for older browsers
        setTimeout(() => updateOverlayPosition(overlay, element), 0);
      }
    });
    
    elementObserver.observe(element, {
      attributes: true,
      attributeFilter: ['style', 'class', 'position'],
      childList: true,
      subtree: true
    });
    
    // Store the observer reference
    overlay._elementObserver = elementObserver;
  }
  
  function createOverlayForSticky(element) {
    if (!element || element.nodeType !== Node.ELEMENT_NODE) return;
    
    // Additional check to avoid overlaying essential elements
    const tagName = element.tagName.toLowerCase();
    const className = element.className.toLowerCase();
    const id = element.id ? element.id.toLowerCase() : '';
    
    // Don't overlay essential page elements
    const essentialElements = ['body', 'html', 'head', 'header', 'footer', 'nav', 'main', 'article', 'section', 'aside'];
    if (essentialElements.includes(tagName) ||
        element === document.body || 
        element === document.documentElement) {
      console.debug('Skipping overlay for essential element:', element);
      return;
    }
    
    // Additional check for elements that are likely page containers based on attributes
    if ((tagName === 'div' && 
         (className.includes('container') || className.includes('wrapper') || 
          className.includes('layout') || className.includes('page') || className.includes('site')) &&
         !className.includes('ad') && !className.includes('advertisement') && !className.includes('banner')) ||
        ((id.includes('container') || id.includes('wrapper') || id.includes('layout') || id.includes('main') || id.includes('content')) &&
         !id.includes('ad') && !id.includes('advertisement') && !id.includes('banner'))) {
      console.debug('Skipping overlay for likely page container element:', element);
      return;
    }
    
    // Don't overlay if parent element already has an overlay
    if (hasParentAdOverlay(element)) {
      console.debug('Parent element already has overlay, skipping child:', element);
      return;
    }
    
    // Get element metrics for size validation
    const rect = element.getBoundingClientRect();
    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;
    
    // Size safety rules: Do NOT overlay elements that are too large
    if (rect.width > viewportWidth * 0.9 ||  // More than 90% of viewport width
        rect.height > viewportHeight * 0.6 || // More than 60% of viewport height
        (rect.width > viewportWidth * 0.95 && rect.top <= 1 && rect.left <= 1) || // Positioned at top-left like a container
        (rect.width < 2 || rect.height < 2)) { // Zero or near-zero dimensions
      console.debug('Skipping overlay: element too large, positioned like container, or has near-zero dimensions:', element, 'Rect:', rect);
      return;
    }
    
    // Don't overlay elements that are too large or positioned like page containers (likely not ads)
    // If element is nearly the full viewport size and positioned at top-left, it's likely a page container, not an ad
    if ((rect.width > viewportWidth * 0.9 && rect.height > viewportHeight * 0.9)) {
      console.debug('Skipping overlay for element that covers most of viewport:', element, 'Rect:', rect);
      return;
    }
    
    // Check if element already has an associated overlay (duplicate prevention)
    if (isAdElement(element)) {
      console.debug('Element already has overlay, skipping duplicate:', element);
      return;
    }
    
    // Check if element still exists before proceeding
    if (!document.contains(element)) {
      console.debug('Element no longer exists in DOM, skipping overlay creation');
      adElements.delete(element);
      return;
    }
    
    // Mark element as being processed to prevent race conditions
    // This ensures that if multiple detection functions run simultaneously,
    // only one will proceed to create an overlay
    adElements.set(element, true);
    
    try {
      // Create overlay element
      const overlay = document.createElement('div');
      overlay.className = 'ad-click-guard-overlay';
      overlay.setAttribute('data-ad-element', true);
      
      // Store reference to the original element on the overlay
      overlay._adElement = element;
      
      // Position the overlay absolutely over the ad element
      updateOverlayPosition(overlay, element);
      
      // Add overlay to document body
      if (document.body) {
        document.body.appendChild(overlay);
      } else {
        // If body isn't ready yet, try to append to documentElement
        document.documentElement.appendChild(overlay);
      }
      
      // Update the mapping to use the actual overlay element
      adElements.set(element, overlay);
      
      // Add resize and scroll listeners to keep overlay positioned correctly
      setupOverlayListeners(element, overlay);
      
      // Log successful overlay addition
      console.log('✅ Successfully added ad overlay for element:', element, 'Tag:', element.tagName, 'Class:', element.className, 'ID:', element.id);
      
      // Log element attributes for debugging
      if (element.src) console.debug('  Element src:', element.src);
      if (element.attributes) {
        for (let attr of element.attributes) {
          if (attr.name.includes('ad') || attr.name.includes('google') || attr.value.includes('google') || attr.value.includes('ad')) {
            console.debug('  Ad-related attribute:', attr.name, '=', attr.value);
          }
        }
      }
      
      // Additional logging to help identify which elements are being covered
      console.debug('  Element position:', element.getBoundingClientRect());
      console.debug('  Element dimensions:', element.offsetWidth, 'x', element.offsetHeight);
      console.debug('  Element text content length:', element.textContent ? element.textContent.trim().length : 0);
      
      // Set up a MutationObserver to watch for when the element is removed from DOM
      const removalObserver = new MutationObserver(() => {
        // Check if the element is still in the DOM
        if (!document.contains(element)) {
          // Element has been removed, clean up the overlay
          console.debug('Ad element removed from DOM, cleaning up overlay:', element);
          
          // Remove event listeners
          if (overlay._scrollListener) {
            window.removeEventListener('scroll', overlay._scrollListener);
          }
          if (overlay._resizeListener) {
            window.removeEventListener('resize', overlay._resizeListener);
          }
          if (overlay._elementObserver) {
            overlay._elementObserver.disconnect();
          }
          
          // Clear intervals
          if (overlay._visibilityInterval) {
            clearInterval(overlay._visibilityInterval);
          }
          
          // Remove overlay from DOM
          if (overlay.parentNode) {
            overlay.parentNode.removeChild(overlay);
          }
          
          // Remove from the map
          adElements.delete(element);
          
          // Disconnect this observer
          removalObserver.disconnect();
        }
      });
      
      // Start observing for element removal
      if (document.body) {
        removalObserver.observe(document.body, {
          childList: true,
          subtree: true
        });
      }
      
      // Store the removal observer reference so we can disconnect it later
      overlay._removalObserver = removalObserver;
      
      // Special handling for elements that might be hidden initially (like Google ads)
      // Set up a MutationObserver to watch for style changes that make the element visible
      const elementObserver = new MutationObserver(() => {
        // Update overlay position when element becomes visible
        // Use requestAnimationFrame to avoid layout thrashing
        if (window.requestAnimationFrame) {
          window.requestAnimationFrame(() => {
            updateOverlayPosition(overlay, element);
            
            // If element is now visible but overlay wasn't properly positioned, fix it
            const rect = element.getBoundingClientRect();
            if (rect.width > 0 && rect.height > 0) {
              overlay.style.display = 'block';
              overlay.style.visibility = 'visible';
            }
          });
        } else {
          // Fallback for older browsers
          setTimeout(() => {
            updateOverlayPosition(overlay, element);
            
            // If element is now visible but overlay wasn't properly positioned, fix it
            const rect = element.getBoundingClientRect();
            if (rect.width > 0 && rect.height > 0) {
              overlay.style.display = 'block';
              overlay.style.visibility = 'visible';
            }
          }, 0);
        }
      });
      
      elementObserver.observe(element, {
        attributes: true,
        attributeFilter: ['style', 'class', 'width', 'height', 'display', 'visibility', 'opacity', 'position']
      });
      
      // Store the observer reference so we can disconnect it later
      overlay._elementObserver = elementObserver;
      
      // Also check periodically if the element becomes visible
      const visibilityInterval = setInterval(() => {
        const rect = element.getBoundingClientRect();
        if (rect.width > 0 && rect.height > 0 && element.offsetParent !== null) {
          // Element is visible, update position and make sure overlay is visible
          updateOverlayPosition(overlay, element);
          overlay.style.display = 'block';
          overlay.style.visibility = 'visible';
          clearInterval(visibilityInterval); // Stop checking once visible
        }
      }, 500); // Check every 500ms
      
      // Store the interval reference so we can clear it later
      overlay._visibilityInterval = visibilityInterval;
    } catch (e) {
      // If there was an error, clean up by removing the element from the map
      adElements.delete(element);
      console.error('❌ Error adding ad overlay:', e, 'Element:', element);
    }
  }
  
  function removeAdOverlays() {
    // Remove all overlays
    adElements.forEach((overlay, element) => {
      // Remove event listeners
      if (overlay._scrollListener) {
        window.removeEventListener('scroll', overlay._scrollListener);
      }
      if (overlay._resizeListener) {
        window.removeEventListener('resize', overlay._resizeListener);
      }
      if (overlay._elementObserver) {
        overlay._elementObserver.disconnect();
      }
      
      // Clear visibility interval if it exists
      if (overlay._visibilityInterval) {
        clearInterval(overlay._visibilityInterval);
      }
      
      // Clear sticky element timeout if it exists
      if (overlay._stickyTimeout) {
        clearTimeout(overlay._stickyTimeout);
      }
      
      // Remove overlay from DOM
      if (overlay.parentNode) {
        overlay.parentNode.removeChild(overlay);
      }
    });
    
    // Clear the map
    adElements.clear();
  }

  function removeOverlays() {
    // No-op since we're not using overlays anymore
  }

  function removeHighlights() {
    // No-op since we removed highlight functionality
  }

  function setupMutationObserver() {
    if (observer) {
      observer.disconnect();
    }
    
    try {
      observer = new MutationObserver((mutations) => {
        if (!isEnabled) return;
        
        let adsDetected = false;
        
        try {
          mutations.forEach((mutation) => {
            // Process new nodes added to the DOM
            if (mutation.type === 'childList') {
              mutation.addedNodes.forEach((node) => {
                if (node.nodeType === Node.ELEMENT_NODE) {
                  // Process the new element
                  processNewElement(node);
                  
                  // Check for ad elements in the new node
                  if (isEnabled && filterListLoaded) {
                    checkNewNodeForAds(node);
                    adsDetected = true;
                  }
                  
                  // Process all descendants of the new element
                  try {
                    const walker = document.createTreeWalker(
                      node,
                      NodeFilter.SHOW_ELEMENT,
                      null,
                      false
                    );
                    
                    let currentNode;
                    while (currentNode = walker.nextNode()) {
                      processNewElement(currentNode);
                      
                      // Check each descendant for ads
                      if (isEnabled && filterListLoaded) {
                        checkElementForAds(currentNode);
                        adsDetected = true;
                      }
                    }
                  } catch (e) {
                    console.debug('Error traversing tree walker:', e);
                  }
                }
              });
            }
            // Process attribute changes (e.g. class changes that might make an element an ad)
            else if (mutation.type === 'attributes') {
              if (mutation.target.nodeType === Node.ELEMENT_NODE) {
                processNewElement(mutation.target);
                          
                // Check if the attribute change made this an ad element
                if (isEnabled && filterListLoaded) {
                  checkElementForAds(mutation.target);
                  adsDetected = true;
                            
                  // Specifically check for Google Publisher Tags and other ad elements that might be added via attribute changes
                  const target = mutation.target;
                  const elementId = target.id || '';
                            
                  // Check for Google Publisher Tags
                  if (elementId.includes('gpt-ad') || elementId.includes('google_ads') || 
                      elementId.includes('div-gpt-ad') || elementId.includes('gpt_unit')) {
                    if (!isAdElement(target) && !hasParentAdOverlay(target)) {
                      addAdOverlay(target);
                    }
                  }
                            
                  // Check for elements with data-google-query-id (high confidence Google ads)
                  if (target.hasAttribute('data-google-query-id') && !isAdElement(target) && !hasParentAdOverlay(target)) {
                    addAdOverlay(target);
                  }
                            
                  // Check for Google ad attributes
                  if ((target.hasAttribute('data-ad-client') ||
                      target.hasAttribute('data-google-av-ad') ||
                      target.hasAttribute('data-google-av-element') ||
                      target.hasAttribute('data-ad-slot') ||
                      target.hasAttribute('data-ad-format')) && !isAdElement(target) && !hasParentAdOverlay(target)) {
                    addAdOverlay(target);
                  }
                            
                  // Check for GoogleActiveViewElement class
                  if (target.classList && target.classList.contains('GoogleActiveViewElement') && !isAdElement(target) && !hasParentAdOverlay(target)) {
                    addAdOverlay(target);
                  }
                }
              }
            }
          });
        } catch (e) {
          console.debug('Error processing mutations:', e);
        }
        
        // If ads were detected, run high-confidence detection to catch any missed ads
        if (adsDetected) {
          // Only schedule detection if not already in progress
          if (!detectionInProgress) {
            setTimeout(() => {
              detectHighConfidenceAds();
            }, 100); // Small delay to allow elements to be fully rendered
          }
        }
        
        // Re-process the entire page periodically to catch any missed elements
        // Only schedule if not already scheduled
        if (!detectionTimeout) {
          detectionTimeout = setTimeout(() => {
            if (isEnabled && !detectionInProgress) {
              detectHighConfidenceAds(); // Run high-confidence detection only
            }
            detectionTimeout = null; // Reset timeout flag
          }, 500); // Increased delay to reduce overlap
        }
        
        // Run EasyList-based detection less frequently and only if not in progress
        if (!detectionInProgress) {
          setTimeout(() => {
            if (isEnabled && !detectionInProgress) {
              detectAndOverlayAds();
            }
          }, 600); // Reduced frequency
        }
        
        // Additional check for Google AdSense ads that might have loaded
        if (!detectionInProgress) {
          setTimeout(() => {
            if (isEnabled && !detectionInProgress) {
              detectHighConfidenceAds();
              // Run additional Google AdSense specific detection
              detectGoogleAds();
            }
          }, 1000); // Reduced frequency
        }
      });
      
      observer.observe(document.body, {
        childList: true,
        subtree: true,
        attributes: true,
        attributeFilter: ['class', 'id', 'style', 'data-ad-client', 'data-google-ads', 'data-ad-slot', 'data-ad-format', 'src', 'data-src', 'data-google-av-ad', 'data-google-av-element', 'data-google-query-id', 'data-ad-status', 'width', 'height', 'display', 'visibility', 'opacity']
      });
    } catch (e) {
      console.debug('Error setting up MutationObserver:', e);
    }
  }
  
  function checkNewNodeForAds(node) {
    try {
      // Check the node itself and its descendants for ad elements
      checkElementForAds(node);
      
      // Use querySelectorAll to find elements matching EasyList selectors
      // but validate with confidence scoring
      for (const selector of cosmeticSelectors) {
        try {
          const matchingElements = node.querySelectorAll ? node.querySelectorAll(selector) : [];
          matchingElements.forEach(element => {
            if (element && element.nodeType === Node.ELEMENT_NODE && !isAdElement(element) && !hasParentAdOverlay(element)) {
              // For EasyList matches, apply less strict validation
              const confidenceScore = calculateAdConfidence(element);
              if (isElementLikelyAd(element) || confidenceScore >= 2) {
                addAdOverlay(element);
              }
            }
          });
        } catch (e) {
          // Skip invalid selectors
          console.debug(`Skipping cosmetic selector during mutation: ${selector}`, e);
        }
      }
      
      // Check for Google Publisher Tags elements
      const gptElements = node.querySelectorAll ? node.querySelectorAll('[id*="gpt-ad" i], [id*="google_ads" i], [id*="div-gpt-ad" i], [id*="gpt_unit" i]') : [];
      gptElements.forEach(element => {
        if (element && element.nodeType === Node.ELEMENT_NODE && !isAdElement(element) && !hasParentAdOverlay(element)) {
          // These are Google Publisher Tags which are ads - verify with confidence scoring
          if (isElementLikelyAd(element)) {
            addAdOverlay(element);
          }
        }
      });
      
      // Also check for high-confidence signals in the new node
      const allNewElements = node.querySelectorAll ? node.querySelectorAll('*') : [node];
      allNewElements.forEach(element => {
        if (element && element.nodeType === Node.ELEMENT_NODE && !isAdElement(element) && !hasParentAdOverlay(element)) {
          // Apply more stringent check for all elements
          if (isElementLikelyAd(element)) {
            addAdOverlay(element);
          }
          // Additional check for Google AdSense specific elements
          else if (isGoogleAdElement(element)) {
            addAdOverlay(element);
          }
        }
      });
      
      // Specifically check for iframe-based ads that may have been added
      const iframeElements = node.querySelectorAll ? node.querySelectorAll('iframe') : [];
      iframeElements.forEach(element => {
        if (element && element.nodeType === Node.ELEMENT_NODE && !isAdElement(element) && !hasParentAdOverlay(element)) {
          // Check if iframe has ad-related src
          if (element.src && (
            element.src.includes('googlesyndication') || 
            element.src.includes('doubleclick') ||
            element.src.includes('googleadservices') ||
            element.src.includes('googletagservices') ||
            element.src.includes('pagead') ||
            element.src.includes('tpc.goog')
          )) {
            // These are definitely ads, add them directly
            addAdOverlay(element);
          }
        }
      });
      
      // Check for image elements that may be ads
      const imgElements = node.querySelectorAll ? node.querySelectorAll('img') : [];
      imgElements.forEach(element => {
        if (element && element.nodeType === Node.ELEMENT_NODE && !isAdElement(element) && !hasParentAdOverlay(element)) {
          // Check if img has ad-related src
          if (element.src && (
            element.src.includes('googlesyndication') || 
            element.src.includes('doubleclick') ||
            element.src.includes('googleadservices') ||
            element.src.includes('googletagservices') ||
            element.src.includes('pagead') ||
            element.src.includes('tpc.goog')
          )) {
            // These are definitely ads, add them directly
            addAdOverlay(element);
          }
        }
      });
      
      // Enhanced check: look for any new elements that might be ads
      const allElementsNew = node.querySelectorAll ? node.querySelectorAll('*') : [node];
      allElementsNew.forEach(element => {
        if (element && element.nodeType === Node.ELEMENT_NODE && !isAdElement(element) && !hasParentAdOverlay(element)) {
          // Check for elements with ad-related attributes
          if (element.classList && (
            element.classList.contains('adsbygoogle') ||
            element.classList.contains('google-ads') ||
            element.classList.contains('advertisement') ||
            element.classList.contains('GoogleActiveViewElement')
          )) {
            addAdOverlay(element);
          }
          
          // Check for elements with ad-related data attributes
          if (element.hasAttribute('data-ad-client') || 
              element.hasAttribute('data-google-av-ad') || 
              element.hasAttribute('data-google-av-element') ||
              element.hasAttribute('data-ad-slot') ||
              element.hasAttribute('data-ad-format')) {
            if (isElementLikelyAd(element)) {
              addAdOverlay(element);
            }
          }
          
          // Check for standard ad sizes
          const rect = element.getBoundingClientRect();
          const width = rect.width;
          const height = rect.height;
          
          const standardAdSizes = [
            [300, 250], [728, 90], [160, 600], [336, 280], [300, 600],
            [468, 60], [234, 60], [120, 600], [120, 240], [180, 150],
            [320, 50], [970, 250], [970, 90], [300, 50], [320, 100]
          ];
          
          const hasStandardAdSize = standardAdSizes.some(([w, h]) => 
            (Math.abs(width - w) <= 5 && Math.abs(height - h) <= 5) ||
            (Math.abs(width - h) <= 5 && Math.abs(height - w) <= 5) // Check for rotated ads
          );
          
          if (hasStandardAdSize) {
            // If it has standard ad size, check for ad-related content
            const iframeChildren = element.querySelectorAll ? element.querySelectorAll('iframe, img') : [];
            const hasAdRelatedContent = Array.from(iframeChildren).some(child => {
              const src = child.src || '';
              return src.includes('googlesyndication') || src.includes('doubleclick') || 
                     src.includes('googleadservices') || src.includes('googletagservices') ||
                     src.includes('pagead') || src.includes('tpc.goog');
            });
            
            if (hasAdRelatedContent && isElementLikelyAd(element)) {
              addAdOverlay(element);
            }
          }
        }
      });
    } catch (e) {
      console.debug('Error in checkNewNodeForAds:', e);
    }
  }
  
  function checkElementForAds(element) {
    if (!element || element.nodeType !== Node.ELEMENT_NODE || !isEnabled || !filterListLoaded) {
      return;
    }
    
    // Additional check to prevent interference with page scripts
    try {
      // Check for high-confidence ad indicators first
      const className = element.className.toLowerCase();
      const tagName = element.tagName.toLowerCase();
      
      // Direct checks for known ad elements
      if ((className.includes('googleactiveviewelement') || className.includes('adsbygoogle') || 
          className.includes('googlesyndication') || className.includes('doubleclick')) &&
          !isAdElement(element)) {
        addAdOverlay(element);
        return; // Exit early if we found a high-confidence ad
      }
      
      // Check for iframe with ad-related src
      if (element.tagName === 'IFRAME' && element.src && (
          element.src.includes('googlesyndication') ||
          element.src.includes('doubleclick') ||
          element.src.includes('googleadservices') ||
          element.src.includes('googletagservices') ||
          element.src.includes('pagead') ||
          element.src.includes('tpc.goog')) &&
          !isAdElement(element)) {
        addAdOverlay(element);
        return; // Exit early
      }
      
      // Check for Google ad attributes
      if ((element.hasAttribute('data-ad-client') ||
          element.hasAttribute('data-google-av-ad') ||
          element.hasAttribute('data-google-av-element') ||
          element.hasAttribute('data-ad-slot') ||
          element.hasAttribute('data-ad-format') ||
          element.hasAttribute('data-google-query-id')) &&
          !isAdElement(element)) {
        addAdOverlay(element);
        return; // Exit early
      }
      
      // Use confidence-based validation for other elements
      if (!isAdElement(element) && !hasParentAdOverlay(element) && isElementLikelyAd(element)) {
        addAdOverlay(element);
      } else if (!isAdElement(element)) {
        // Log for debugging - element didn't pass confidence check
        console.debug('Element failed confidence check in checkElementForAds:', element, 'Score:', calculateAdConfidence(element));
      }
    } catch (e) {
      // Silently ignore errors to prevent conflicts with other scripts
      console.debug('Error checking element for ads:', e);
    }
  }

  function processNewElement(element) {
    // Removed old functionality - only using EasyList-based detection
    // Skip essential page elements
    if (element.tagName === 'BODY' || element.tagName === 'HTML') {
      return;
    }
  }



  // Handle page visibility changes
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden && isInitialized && isEnabled) {
      // Re-scan the page when tab becomes visible again
      if (detectionTimeout) {
        clearTimeout(detectionTimeout);
      }
      detectionTimeout = setTimeout(() => {
        detectHighConfidenceAds(); // Run high-confidence detection first
        detectAndOverlayAds(); // Then run EasyList-based detection
      }, 100);
    }
  });


})();