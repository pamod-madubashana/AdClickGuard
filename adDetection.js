// Ad Detection Functions
// Contains all EasyList-based ad detection logic and related functions

// New overlay system with position-aware logic, duplicate prevention, lifecycle cleanup, and performance control

// WeakMap to store overlay references keyed by anchor element
const overlayMap = new WeakMap();

// Set to track elements that are already covered to prevent duplicates
const coveredElements = new Set();

// Function to find the anchor element by walking up the DOM tree
function findAdAnchorElement(adMarker) {
  if (!adMarker || !adMarker.nodeType || adMarker.nodeType !== Node.ELEMENT_NODE) {
    return null;
  }
  
  // Essential elements that should never be anchors
  const essentialElements = ['body', 'html', 'head', 'header', 'footer', 'nav', 'main', 'article', 'section', 'aside'];
  
  // Check if the adMarker itself is a valid anchor
  if (isValidAnchorElement(adMarker)) {
    return adMarker;
  }
  
  // Walk up the DOM tree to find a suitable anchor
  let currentElement = adMarker.parentElement;
  
  while (currentElement && currentElement !== document.body && currentElement !== document.documentElement) {
    const tagName = currentElement.tagName.toLowerCase();
    
    // Skip essential page elements
    if (essentialElements.includes(tagName)) {
      currentElement = currentElement.parentElement;
      continue;
    }
    
    // Check if this element is a valid anchor
    if (isValidAnchorElement(currentElement)) {
      // Verify that it has a stable bounding box
      const rect = currentElement.getBoundingClientRect();
      if (rect.width > 1 && rect.height > 1) { // Valid size
        return currentElement;
      }
    }
    
    currentElement = currentElement.parentElement;
  }
  
  // If no valid anchor found by walking up, return the original marker as fallback
  return adMarker;
}

// Function to validate if an element is a suitable anchor
function isValidAnchorElement(element) {
  if (!element || !element.nodeType || element.nodeType !== Node.ELEMENT_NODE) {
    return false;
  }
  
  const tagName = element.tagName.toLowerCase();
  const className = element.className ? element.className.toLowerCase() : '';
  const id = element.id ? element.id.toLowerCase() : '';
  
  // Don't use essential page elements as anchors
  const essentialElements = ['body', 'html', 'head', 'header', 'footer', 'nav', 'main', 'article', 'section', 'aside'];
  if (essentialElements.includes(tagName)) {
    return false;
  }
  
  // Don't use common layout wrappers as anchors unless they clearly contain ads
  if (tagName === 'div') {
    const layoutIndicators = ['container', 'wrapper', 'layout', 'page', 'site', 'main', 'content', 'layout', 'site', 'page-wrapper', 'main-wrapper', 'content-wrapper'];
    const isLayoutWrapper = layoutIndicators.some(indicator => 
      className.includes(indicator) || id.includes(indicator)
    );
    
    // However, if it has clear ad indicators, it can be an anchor
    const adIndicators = ['ad', 'advertisement', 'banner', 'google', 'doubleclick', 'adsbygoogle', 'ad-container', 'ad-wrapper', 'google-ads', 'ad-placement', 'ad-unit', 'ad-box', 'ad-slot'];
    const hasAdIndicators = adIndicators.some(indicator => 
      className.includes(indicator) || id.includes(indicator)
    );
    
    if (isLayoutWrapper && !hasAdIndicators) {
      return false;
    }
  }
  
  // Element should have some content or children to be a valid anchor
  const rect = element.getBoundingClientRect();
  if (rect.width <= 1 || rect.height <= 1) {
    return false; // Too small to be a meaningful anchor
  }
  
  // Check if element is positioned in a way that suggests it's a container rather than a specific ad
  const computedStyle = window.getComputedStyle(element);
  const display = computedStyle.display;
  
  // If element is a flex/grid container that takes up most of the viewport, it's likely a layout container
  if ((display === 'flex' || display === 'grid') &&
      rect.width > window.innerWidth * 0.8 &&
      rect.height > window.innerHeight * 0.3) {
    return false;
  }
  
  // Check if the element is likely a wrapper around other elements
  // If it has many children or is significantly larger than its content, it might be a wrapper
  const childElements = Array.from(element.children);
  if (childElements.length > 10) {
    // If it has many children but is not specifically marked as an ad, it might be a container
    const adIndicators = ['ad', 'advertisement', 'banner', 'google', 'doubleclick', 'adsbygoogle'];
    const hasAdIndicators = adIndicators.some(indicator => 
      className.includes(indicator) || id.includes(indicator)
    );
    
    if (!hasAdIndicators) {
      return false;
    }
  }
  
  // If we reach here, it's a potentially valid anchor
  return true;
}

// Function to get element position type
function getElementPositionType(element) {
  if (!element || !element.nodeType || element.nodeType !== Node.ELEMENT_NODE) {
    return null;
  }
  
  const computedStyle = window.getComputedStyle(element);
  return computedStyle.position;
}

// Function to get element bounding box with appropriate coordinates based on position type
function getElementBoundingBox(element) {
  if (!element || !element.nodeType || element.nodeType !== Node.ELEMENT_NODE) {
    return null;
  }
  
  const rect = element.getBoundingClientRect();
  const positionType = getElementPositionType(element);
  
  // For fixed or sticky elements, use viewport-relative coordinates
  if (positionType === 'fixed' || positionType === 'sticky') {
    return {
      top: rect.top,
      left: rect.left,
      width: rect.width,
      height: rect.height,
      position: 'fixed'
    };
  } 
  
  // For absolute or relative elements, use document-relative coordinates
  const scrollTop = window.pageYOffset || document.documentElement.scrollTop;
  const scrollLeft = window.pageXOffset || document.documentElement.scrollLeft;
  
  return {
    top: rect.top + scrollTop,
    left: rect.left + scrollLeft,
    width: rect.width,
    height: rect.height,
    position: 'absolute'
  };
}

// Function to parse cosmetic filters from EasyList
function parseCosmeticFilters(filterText, currentHostname) {
  const lines = filterText.split('\n');
  const selectors = [];
  const domainSpecificSelectors = [];
  
  for (const line of lines) {
    const trimmedLine = line.trim();
    
    // Skip comments and empty lines
    if (!trimmedLine || trimmedLine.startsWith('!') || trimmedLine.startsWith('[Adblock')) {
      continue;
    }
    
    // Check for cosmetic filter patterns
    if (trimmedLine.includes('##') || trimmedLine.includes('#?#') || trimmedLine.includes('#@#')) {
      // Handle element hiding rules (##) and exceptions (#@#)
      if (trimmedLine.includes('##')) {
        const parts = trimmedLine.split('##');
        if (parts.length >= 2) {
          const domains = parts[0]; // Domains (empty means all domains)
          let selector = parts.slice(1).join('##'); // The selector part
          
          // Check if this is a domain-specific rule
          if (domains && domains.length > 0) {
            // Check if the rule applies to the current domain
            const domainList = domains.split(',');
            let shouldApply = false;
            
            for (const domain of domainList) {
              if (domain.startsWith('~')) {
                // Exception domain - rule does NOT apply to this domain
                const exceptionDomain = domain.substring(1);
                if (currentHostname && currentHostname.includes(exceptionDomain)) {
                  shouldApply = false;
                  break;
                }
              } else if (domain.startsWith('@@')) {
                // Exception rule
                shouldApply = false;
                break;
              } else {
                // Rule applies to this domain
                if (currentHostname && (currentHostname === domain || currentHostname.endsWith('.' + domain) || currentHostname.endsWith(domain + '.'))) {
                  shouldApply = true;
                }
              }
            }
            
            if (shouldApply) {
              domainSpecificSelectors.push(selector.trim());
            }
          } else {
            // Global selector (applies to all domains)
            selectors.push(selector.trim());
          }
        }
      }
      
      // Handle extended CSS selectors (#?#)
      if (trimmedLine.includes('#?#')) {
        const parts = trimmedLine.split('#?#');
        if (parts.length >= 2) {
          // Get the selector part after #?#
          const selector = parts.slice(1).join('#?#').trim();
          selectors.push(selector);
        }
      }
    }
  }
  
  // Combine global and domain-specific selectors
  return [...selectors, ...domainSpecificSelectors];
}

// Function to sanitize selectors that might not be supported
function sanitizeSelector(selector) {
  // Skip or sanitize unsupported selectors
  if (selector.includes(':-abp-') || 
      selector.includes(':has(') || 
      selector.includes(':matches-css(') || 
      selector.includes(':not(:has(') ||
      selector.includes(':contains(') ||
      selector.includes(':xpath(') ||
      selector.includes(':style(')) {
    return null; // Skip this selector
  }
  
  // Remove pseudo-elements and pseudo-classes that might cause issues
  try {
    // Basic validation by attempting to create a temporary element with the selector
    document.querySelector(selector);
    return selector;
  } catch (e) {
    // If selector is invalid, try to sanitize it
    let sanitized = selector;
    
    // Remove complex pseudo-selectors that might not be supported
    sanitized = sanitized.replace(/::?(before|after|first-line|first-letter|selection|placeholder|backdrop|cue|slotted|part|host|host-context)/g, '');
    
    // Remove complex attribute selectors with regex patterns
    sanitized = sanitized.replace(/\[.*?[\^$*~]?=\s*\/.*?\/.*?\]/g, '');
    
    try {
      document.querySelector(sanitized);
      return sanitized;
    } catch (e) {
      return null; // Cannot sanitize, skip this selector
    }
  }
}

// Main function to detect ads using EasyList selectors
function detectAndOverlayAds(cosmeticSelectors, adElements, CONFIG, isAdElement, hasParentAdOverlay, addAdOverlay, calculateAdConfidence, isElementLikelyAd) {
  if (!cosmeticSelectors || cosmeticSelectors.length === 0) {
    console.debug('🔍 Skipping ad detection - no selectors available');
    return;
  }
  
  console.log('🔍 Starting ad detection with', cosmeticSelectors.length, 'selectors');
  
  let totalChecked = 0;
  let totalMatched = 0;
  let selectorsApplied = 0;
  let selectorsSkipped = 0;
  
  try {
    // Process all cosmetic selectors but validate with confidence scoring
    for (const selector of cosmeticSelectors) {
      // Limit the number of selectors processed to prevent performance issues
      if (selectorsApplied >= 100) { // Reasonable limit to prevent infinite processing
        console.debug('⚠️ Reached selector processing limit, stopping to prevent performance issues');
        break;
      }
      
      const sanitizedSelector = sanitizeSelector(selector);
      
      if (!sanitizedSelector) {
        selectorsSkipped++;
        continue;
      }
      
      try {
        const elements = document.querySelectorAll ? document.querySelectorAll(sanitizedSelector) : [];
        console.debug('Checking selector:', sanitizedSelector, 'Found elements:', elements.length);
        
        // Limit elements processed per selector to prevent performance issues
        const elementsToProcess = Array.from(elements).slice(0, 20); // Limit to 20 elements per selector
        
        elementsToProcess.forEach(element => {
          totalChecked++;
          if (element && element.nodeType === Node.ELEMENT_NODE && !isAdElement(element) && !hasParentAdOverlay(element)) {
            // For EasyList matches, apply confidence scoring to avoid false positives
            const confidenceScore = calculateAdConfidence(element, cosmeticSelectors);
                      
            // Only treat as ad if it passes our validation threshold
            if (isElementLikelyAd(element) || confidenceScore >= 4) {
              totalMatched++; 
              console.log('🎯 Matched ad element with selector:', sanitizedSelector, 'Element:', element, 'Confidence:', confidenceScore);
              addAdOverlay(element);
            }
          }
        });
        selectorsApplied++;
      } catch (e) {
        // Skip invalid selectors
        console.debug(`Skipping cosmetic selector: ${sanitizedSelector}`, e);
        selectorsSkipped++;
      }
    }
  } catch (e) {
    console.error('❌ Error in main detection loop:', e);
  }
  
  console.log('📊 EasyList detection summary - Selectors applied:', selectorsApplied, 'Skipped:', selectorsSkipped, 'Elements checked:', totalChecked, 'Matched:', totalMatched);
}

// Function to specifically check for Google AdSense elements
function isGoogleAdElement(element) {
  if (!element || element.nodeType !== Node.ELEMENT_NODE) {
    return false;
  }
  
  const tagName = element.tagName.toLowerCase();
  const className = element.className.toLowerCase();
  const id = element.id ? element.id.toLowerCase() : '';
  
  // Check for Google AdSense specific patterns
  if (id.includes('google_ads_iframe_') || 
      id.includes('gpt-ad-') || 
      id.includes('div-gpt-ad') || 
      id.includes('gpt_unit_') ||
      className.includes('google_ads_iframe') ||
      element.hasAttribute('data-google-query-id') ||
      element.hasAttribute('data-ad-status') && element.getAttribute('data-ad-status') === 'filled') {
    return true;
  }
  
  // Check for iframe with Google ad sources
  if (tagName === 'iframe' && element.src) {
    const src = element.src.toLowerCase();
    if (src.includes('googlesyndication') ||
        src.includes('doubleclick') ||
        src.includes('googleadservices') ||
        src.includes('googletagservices') ||
        src.includes('pagead') ||
        src.includes('tpc.goog') ||
        src.includes('securepubads') ||
        (src.includes('googleusercontent.com') && src.includes('ad'))) {
      return true;
    }
  }
  
  // Check for Google ad attributes
  if (element.hasAttribute('data-ad-client') ||
      element.hasAttribute('data-google-av-ad') ||
      element.hasAttribute('data-google-av-element') ||
      element.hasAttribute('data-ad-slot') ||
      element.hasAttribute('data-ad-format')) {
    return true;
  }
  
  return false;
}

// Main function to determine if an element is likely an ad with confidence scoring
function isElementLikelyAd(element) {
  if (!element || element.nodeType !== Node.ELEMENT_NODE) {
    return false;
  }
  
  // First, check for high-confidence ad indicators that should always be treated as ads
  const tagName = element.tagName.toLowerCase();
  const className = element.className.toLowerCase();
  const id = element.id ? element.id.toLowerCase() : '';
  
  // Special case: if element has known high-confidence ad classes, it's definitely an ad
  if (className.includes('GoogleActiveViewElement') || className.includes('adsbygoogle') || 
      className.includes('googlesyndication') || className.includes('doubleclick')) {
    return true;
  }
  
  // Special case: if element is an iframe with known ad sources, it's definitely an ad
  if (element.tagName === 'IFRAME' && element.src && (
      element.src.includes('googlesyndication') ||
      element.src.includes('doubleclick') ||
      element.src.includes('googleadservices') ||
      element.src.includes('googletagservices') ||
      element.src.includes('pagead') ||
      element.src.includes('tpc.goog')
  )) {
    return true;
  }
  
  // Check for Google ad attributes - if present, likely an ad
  if (element.hasAttribute('data-ad-client') ||
      element.hasAttribute('data-google-av-ad') ||
      element.hasAttribute('data-google-av-element') ||
      element.hasAttribute('data-ad-slot') ||
      element.hasAttribute('data-ad-format') ||
      element.hasAttribute('data-google-query-id')) {
    return true;
  }
  
  // Check for specific ad-related IDs
  if (id.includes('gpt-ad') || id.includes('google_ads') || 
      id.includes('div-gpt-ad') || id.includes('gpt_unit')) {
    return true;
  }
  
  // Check for specific ad-related classes
  if (className.includes('google-ads') ||
      className.includes('advertisement') ||
      className.includes('ad-container') ||
      className.includes('ad-placement') ||
      className.includes('ad-unit') ||
      className.includes('ad-banner') ||
      className.includes('ad-box') ||
      className.includes('pub_300x250') ||
      className.includes('pub_300x250m') ||
      className.includes('pub_728x90') ||
      className.includes('text-ad') ||
      className.includes('text-ads') ||
      className.includes('afs_ads')) {
    // For these, verify with confidence scoring to avoid false positives
    const confidenceScore = calculateAdConfidence(element);
    return confidenceScore >= 4; // Lower threshold for known ad classes
  }
  
  // Don't mark essential page elements as ads
  const essentialElements = ['body', 'html', 'head', 'header', 'footer', 'nav', 'main', 'article', 'section', 'aside'];
  if (essentialElements.includes(tagName)) {
    return false;
  }
  
  // Don't mark common content elements as ads
  const contentElements = ['h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'p', 'span', 'div', 'a', 'img', 'ul', 'ol', 'li', 'article', 'section'];
  if (contentElements.includes(tagName) && 
      (className.includes('title') || className.includes('header') || className.includes('footer') || 
       className.includes('nav') || className.includes('menu') || className.includes('brand') ||
       className.includes('content') || className.includes('text') || className.includes('post') ||
       className.includes('article') || className.includes('page') || className.includes('site')) &&
      !className.includes('ad') && !className.includes('advertisement')) {
    return false;
  }
  
  // Additional check: if element is likely content based on text content
  if (isElementLikelyContent(element)) {
    return false;
  }
  
  // For all other elements, use confidence scoring
  const confidenceScore = calculateAdConfidence(element);
  
  // Log for debugging if element has high confidence score
  if (confidenceScore >= 4) {
    console.debug('🔍 Ad detection check - Element:', element, 'Score:', confidenceScore, 'Tag:', element.tagName, 'Class:', element.className, 'ID:', element.id);
  }
  
  // Use threshold of 4 for general ad detection
  return confidenceScore >= 4;
}

// Function to check if an element is likely content rather than an ad
function isElementLikelyContent(element) {
  if (!element) return false;
  
  const tagName = element.tagName.toLowerCase();
  const className = element.className.toLowerCase();
  const id = element.id ? element.id.toLowerCase() : '';
  
  // Check if element has content-related attributes or classes
  const contentIndicators = [
    'title', 'header', 'footer', 'nav', 'navigation', 'menu', 'brand', 'content', 'text', 
    'post', 'article', 'page', 'site', 'entry', 'headline', 'caption', 'description',
    'author', 'date', 'meta', 'comment', 'share', 'social', 'breadcrumb', 'search',
    'widget', 'sidebar', 'main', 'container', 'wrapper', 'section', 'article', 'aside',
    'hgroup', 'header', 'footer', 'time', 'summary', 'details',
    'blockquote', 'cite', 'figcaption', 'figure', 'main', 'mark', 'code',
    'pre', 'kbd', 'samp', 'var', 'data', 'address'
  ];
  
  // Additional content indicators that are more specific
  const specificContentIndicators = [
    'post-', 'article-', 'entry-', 'blog-', 'news-', 'content-', 'headline-',
    'author-', 'date-', 'time-', 'comment-', 'share-', 'social-', 'widget-',
    'sidebar-', 'main-', 'container-', 'wrapper-', 'section-', 'navigation-',
    'menu-', 'brand-', 'header-', 'footer-', 'title-', 'caption-', 'description-',
    'breadcrumb-', 'search-', 'related-', 'tag-', 'category-', 'archive-',
    'post-navigation', 'comments-area', 'author-box', 'post-meta', 'entry-header',
    'entry-content', 'entry-footer'
  ];
  
  // Check if element has content-related class names
  for (const indicator of contentIndicators) {
    if (className.includes(indicator) && 
        !className.includes('ad') && 
        !className.includes('advertisement') && 
        !className.includes('banner') && 
        !className.includes('sponsor')) {
      return true;
    }
  }
  
  // Check for more specific content indicators
  for (const indicator of specificContentIndicators) {
    if (className.includes(indicator) && 
        !className.includes('ad') && 
        !className.includes('advertisement') && 
        !className.includes('banner') && 
        !className.includes('sponsor')) {
      return true;
    }
  }
  
  // Check if element has content-related IDs
  for (const indicator of contentIndicators) {
    if (id.includes(indicator) && 
        !id.includes('ad') && 
        !id.includes('advertisement') && 
        !id.includes('banner') && 
        !id.includes('sponsor')) {
      return true;
    }
  }
  
  // Check for more specific content IDs
  for (const indicator of specificContentIndicators) {
    if (id.includes(indicator) && 
        !id.includes('ad') && 
        !id.includes('advertisement') && 
        !id.includes('banner') && 
        !id.includes('sponsor')) {
      return true;
    }
  }
  
  // Check if element contains significant text content that appears to be content
  const textContent = element.textContent ? element.textContent.trim() : '';
  if (textContent.length > 50) {  // If element has substantial text content
    // Check if the text content looks like actual content rather than ad text
    const contentKeywords = ['copyright', 'about', 'contact', 'privacy', 'terms', 'policy', 
                           'home', 'blog', 'news', 'article', 'post', 'category', 'tag',
                           'author', 'published', 'updated', 'comments', 'share', 'related',
                           'previous', 'next', 'archive', 'search', 'navigation', 'menu',
                           'subscribe', 'newsletter', 'rss', 'feed', 'permalink', 'edit',
                           'reply', 'like', 'dislike', 'view', 'views', 'read', 'reading',
                           'time', 'minutes', 'words', 'word', 'ago', 'by', 'written'];
    
    for (const keyword of contentKeywords) {
      if (textContent.toLowerCase().includes(keyword)) {
        return true;
      }
    }
  }
  
  // If element is an image with content-related alt text
  if (tagName === 'img') {
    const altText = element.alt || '';
    if (altText.toLowerCase().includes('logo') || 
        altText.toLowerCase().includes('avatar') || 
        altText.toLowerCase().includes('photo') ||
        altText.toLowerCase().includes('thumbnail') ||
        altText.toLowerCase().includes('featured') ||
        altText.toLowerCase().includes('author') ||
        altText.toLowerCase().includes('profile') ||
        altText.toLowerCase().includes('signature')) {
      return true;
    }
  }
  
  // Check if the element is a link that appears to be navigational content
  if (tagName === 'a') {
    const href = element.href || '';
    const linkText = element.textContent ? element.textContent.trim().toLowerCase() : '';
    
    // Common navigational link text
    const navLinkTexts = ['home', 'about', 'contact', 'privacy', 'terms', 'search',
                         'archive', 'category', 'tag', 'login', 'register', 'profile',
                         'settings', 'help', 'support', 'sitemap', 'rss', 'newsletter',
                         'previous', 'next', 'read more', 'continue reading'];
    
    for (const navText of navLinkTexts) {
      if (linkText.includes(navText)) {
        return true;
      }
    }
    
    // Check if it's an internal link (likely content)
    if (href && !href.includes('http') && !href.includes('www') && !href.includes('track') &&
        !href.includes('click') && !href.includes('redirect')) {
      return true;
    }
  }
  
  // Check if element is likely a comment or user-generated content area
  if (className.includes('comment') || className.includes('reply') || 
      className.includes('message') || className.includes('user')) {
    return true;
  }
  
  // Check for social sharing buttons
  if (className.includes('share') || className.includes('social') ||
      className.includes('facebook') || className.includes('twitter') ||
      className.includes('linkedin') || className.includes('pinterest')) {
    return true;
  }
  
  return false;
}

// Calculate confidence score for an element being an ad
function calculateAdConfidence(element, cosmeticSelectors = []) {
  let score = 0;
  
  // Check for Google ad attributes (high confidence)
  if (element.hasAttribute('data-ad-client') || element.hasAttribute('data-google-av-ad') || element.hasAttribute('data-google-av-element')) {
    score += 6; // google_ad_attributes: 6 points
  }
  
  // Check for Google ad classes
  if (element.classList && element.classList.contains('adsbygoogle')) {
    score += 6; // adsbygoogle_class: 6 points
  }
  
  // Check for iframe with ad-related src
  if (element.tagName === 'IFRAME' && element.src) {
    const src = element.src.toLowerCase();
    if (src.includes('googlesyndication') || src.includes('doubleclick')) {
      score += 6; // iframe_ad_src: 6 points
    }
  }
  
  // Check for Google Publisher Tags elements
  const elementId = element.id || '';
  if (elementId.includes('gpt-ad') || elementId.includes('google_ads') || 
      elementId.includes('div-gpt-ad') || elementId.includes('gpt_unit')) {
    score += 6; // google_publisher_tags: 6 points
  }
  
  // Check for data-google-query-id attribute (high confidence)
  if (element.hasAttribute('data-google-query-id')) {
    score += 5; // google_query_id: 5 points
  }
  
  // Check for GoogleActiveViewElement
  if (element.classList && element.classList.contains('GoogleActiveViewElement')) {
    score += 7; // google_active_view: 7 points
  }
  
  // Check for standard ad dimensions
  const rect = element.getBoundingClientRect();
  const width = rect.width;
  const height = rect.height;
  
  const standardAdSizes = [
    [300, 250], [728, 90], [160, 600], [336, 280], [300, 600],
    [468, 60], [234, 60], [120, 600], [120, 240], [180, 150],
    [970, 90], [360, 300], [300, 600], [160, 600], [320, 50]
  ];
  
  for (const [w, h] of standardAdSizes) {
    if ((Math.abs(width - w) <= 5 && Math.abs(height - h) <= 5) ||
        (Math.abs(width - h) <= 5 && Math.abs(height - w) <= 5)) { // Check rotated as well
      score += 3; // standard_ad_size: 3 points
      break;
    }
  }
  
  // Check if element matches EasyList selectors (lower confidence, but adds up)
  if (matchesEasyListSelectors(element, cosmeticSelectors)) {
    score += 2; // easylist_match: 2 points
  }
  
  // Apply penalties for false positive indicators
  
  // Check if element is in main content containers
  const mainContentSelectors = ['main', 'article', '#main', '.main-content', '#content', '.content'];
  let isMainContent = false;
  let currentElement = element;
  
  // Traverse up the DOM to check parent elements
  while (currentElement && currentElement !== document) {
    if (currentElement.tagName) {
      const tagName = currentElement.tagName.toLowerCase();
      const id = currentElement.id ? currentElement.id.toLowerCase() : '';
      const className = currentElement.className ? currentElement.className.toLowerCase() : '';
      
      if (mainContentSelectors.some(selector => {
        if (selector.startsWith('#')) {
          return id === selector.substring(1);
        } else if (selector.startsWith('.')) {
          return className.split(' ').includes(selector.substring(1));
        } else {
          return tagName === selector;
        }
      })) {
        isMainContent = true;
        break;
      }
    }
    currentElement = currentElement.parentElement;
  }
  
  if (isMainContent) {
    score -= 5; // main_content_penalty: -5 points
  }
  
  // Check if element is very tall (more than 70% of viewport height)
  const viewportHeight = window.innerHeight;
  if (height > viewportHeight * 0.7) {
    score -= 3; // large_container_penalty: -3 points
  }
  
  // Check if element contains large amounts of text
  const textLength = element.textContent ? element.textContent.trim().length : 0;
  const elementArea = width * height;
  const textDensity = elementArea > 0 ? textLength / elementArea : 0;
  
  // If the element has high text density or large amount of text, penalize
  if (textLength > 200 || (textDensity > 0.1 && textLength > 50)) {
    score -= 4; // text_heavy_penalty: -4 points
  }
  
  // Additional penalty for common false positive elements
  const tagName = element.tagName.toLowerCase();
  const id = element.id ? element.id.toLowerCase() : '';
  const className = element.className ? element.className.toLowerCase() : '';
  
  // Check for cookie/banner related elements
  const cookieIndicators = ['cookie', 'banner', 'consent', 'notice', 'policy'];
  if (cookieIndicators.some(indicator => 
    id.includes(indicator) || className.includes(indicator))) {
    score -= 3; // Additional penalty for cookie banners
  }
  
  // Check for navigation elements
  const navIndicators = ['nav', 'header', 'navigation', 'menu'];
  if (navIndicators.some(indicator => 
    tagName.includes(indicator) || id.includes(indicator) || className.includes(indicator))) {
    score -= 3; // Additional penalty for navigation elements
  }
  
  // Additional check: if element is empty or has only ad-related content
  if (element.children && element.children.length === 0) {
    // If element is empty but has ad-related attributes, increase confidence
    if (element.hasAttribute('data-google-query-id') || element.hasAttribute('data-ad-client')) {
      score += 2; // Empty elements with ad attributes are likely ads
    }
  }
  
  // Additional check: if element has multiple ad-related indicators
  let adIndicatorsCount = 0;
  if (element.hasAttribute('data-ad-client')) adIndicatorsCount++;
  if (element.hasAttribute('data-google-av-ad')) adIndicatorsCount++;
  if (element.hasAttribute('data-google-av-element')) adIndicatorsCount++;
  if (element.hasAttribute('data-ad-slot')) adIndicatorsCount++;
  if (element.hasAttribute('data-ad-format')) adIndicatorsCount++;
  if (element.hasAttribute('data-google-query-id')) adIndicatorsCount++;
  if (element.classList.contains('adsbygoogle')) adIndicatorsCount++;
  if (element.classList.contains('google-ads')) adIndicatorsCount++;
  if (element.classList.contains('advertisement')) adIndicatorsCount++;
  if (element.classList.contains('GoogleActiveViewElement')) adIndicatorsCount++;
  
  if (adIndicatorsCount >= 2) {
    score += adIndicatorsCount; // Multiple ad indicators increase confidence
  }
  
  return Math.max(0, score); // Ensure score doesn't go below 0
}

// Check if element matches any EasyList selectors
function matchesEasyListSelectors(element, cosmeticSelectors) {
  if (!cosmeticSelectors || cosmeticSelectors.length === 0) {
    return false;
  }
  
  // Check if element matches any of the loaded cosmetic selectors
  for (const selector of cosmeticSelectors) {
    try {
      if (element.matches && element.matches(selector)) {
        return true;
      }
    } catch (e) {
      // Skip invalid selectors
      continue;
    }
  }
  
  return false;
}

// Function to detect Google Ads specifically
function detectGoogleAds(adElements, CONFIG, isAdElement, hasParentAdOverlay, addAdOverlay, isGoogleAdElement) {
  console.debug('🔍 Starting Google ads detection');
  
  // Specifically check for Google AdSense elements that may have been missed
  try {
    // Check for elements with Google AdSense specific patterns
    const googleAdSelectors = [
      '[id^="google_ads_iframe_"]',
      '[id*="gpt-ad-"]',
      '[id*="div-gpt-ad"]',
      '[id^="gpt_unit_"]',
      '[class*="google_ads_iframe"]',
      '[data-google-query-id]',
      '[data-ad-status="filled"]',
      'iframe[src*="googlesyndication"]',
      'iframe[src*="doubleclick"]',
      'iframe[src*="googleadservices"]',
      'iframe[src*="googletagservices"]',
      'iframe[src*="pagead"]',
      'iframe[src*="tpc.goog"]',
      'iframe[src*="securepubads"]',
      'iframe[src*="googleusercontent.com"][src*="ad"]'
    ];
    
    googleAdSelectors.forEach(selector => {
      try {
        const elements = document.querySelectorAll ? document.querySelectorAll(selector) : [];
        // Limit the number of elements processed to prevent performance issues
        const limitedElements = Array.from(elements).slice(0, 15);
        limitedElements.forEach(element => {
          if (element && element.nodeType === Node.ELEMENT_NODE && !isAdElement(element) && !hasParentAdOverlay(element) && isGoogleAdElement(element)) {
            addAdOverlay(element);
          }
        });
      } catch (e) {
        // Skip invalid selectors
        console.debug('Skipping Google ad selector:', selector, e);
      }
    });
    
    // Check for elements with Google ad attributes
    const googleAdAttributeSelectors = [
      '[data-ad-client]',
      '[data-google-av-ad]',
      '[data-google-av-element]',
      '[data-ad-slot]',
      '[data-ad-format]'
    ];
    
    googleAdAttributeSelectors.forEach(selector => {
      try {
        const elements = document.querySelectorAll ? document.querySelectorAll(selector) : [];
        // Limit the number of elements processed to prevent performance issues
        const limitedElements = Array.from(elements).slice(0, 15);
        limitedElements.forEach(element => {
          if (element && element.nodeType === Node.ELEMENT_NODE && !isAdElement(element) && !hasParentAdOverlay(element)) {
            addAdOverlay(element);
          }
        });
      } catch (e) {
        console.debug('Skipping Google ad attribute selector:', selector, e);
      }
    });
  } catch (e) {
    console.debug('Error in detectGoogleAds:', e);
  }
  
  console.debug('🔍 Completed Google ads detection');
}

// Function to detect high-confidence ads
function detectHighConfidenceAds(adElements, CONFIG, isAdElement, hasParentAdOverlay, addAdOverlay, isElementLikelyAd, calculateAdConfidence) {
  console.debug('🔍 Starting high-confidence ad detection');
  
  // Directly check for high-confidence ad signals
  
  try {
    // Check for iframes with ad-related sources
    const adIframes = document.querySelectorAll ? document.querySelectorAll('iframe[src*="googlesyndication" i], iframe[src*="doubleclick" i], iframe[src*="googleadservices" i], iframe[src*="googletagservices" i], iframe[src*="googlesyndication" i], iframe[src*="pagead" i], iframe[src*="tpc.goog" i], iframe[src*="googleusercontent.com" i][src*="ad"], iframe[src*="securepubads" i]') : [];
    // Limit the number of elements processed to prevent performance issues
    const limitedAdIframes = Array.from(adIframes).slice(0, 20);
    limitedAdIframes.forEach(element => {
      if (element && element.nodeType === Node.ELEMENT_NODE && !isAdElement(element) && !hasParentAdOverlay(element)) {
        // These are definitely ads based on their source, add them directly
        addAdOverlay(element);
      }
    });
    
    // Check for iframe containers that are likely ad containers based on class/id patterns
    const potentialAdContainers = document.querySelectorAll ? document.querySelectorAll('div[id^="google_ads_iframe_"], div[id*="gpt-ad-"], div[id*="div-gpt-ad"], ins[id^="gpt_unit_"], div[data-google-query-id], div[data-ad-client], div[data-ad-slot]') : [];
    const limitedAdContainers = Array.from(potentialAdContainers).slice(0, 20);
    limitedAdContainers.forEach(element => {
      if (element && element.nodeType === Node.ELEMENT_NODE && !isAdElement(element) && !hasParentAdOverlay(element)) {
        // These are likely ad containers, add them directly
        addAdOverlay(element);
      }
    });
    
    // Check for elements with Google ad attributes
    const googleAdElements = document.querySelectorAll ? document.querySelectorAll('[data-ad-client], [data-google-av-ad], [data-google-av-element], [data-ad-slot], [data-ad-format], [data-google-query-id], [data-ad-status="filled"]') : [];
    const limitedGoogleAdElements = Array.from(googleAdElements).slice(0, 20);
    limitedGoogleAdElements.forEach(element => {
      if (element && element.nodeType === Node.ELEMENT_NODE && !isAdElement(element) && !hasParentAdOverlay(element)) {
        // Elements with Google ad attributes are definitely ads, add them directly
        addAdOverlay(element);
      }
    });
    
    // Check for elements with adsbygoogle class
    const adsByGoogleElements = document.querySelectorAll ? document.querySelectorAll('.adsbygoogle') : [];
    const limitedAdsByGoogleElements = Array.from(adsByGoogleElements).slice(0, 20);
    limitedAdsByGoogleElements.forEach(element => {
      if (element && element.nodeType === Node.ELEMENT_NODE && !isAdElement(element) && !hasParentAdOverlay(element)) {
        // Elements with adsbygoogle class are definitely ads, add them directly
        addAdOverlay(element);
      }
    });
    
    // Check for Google Publisher Tags elements
    const gptElements = document.querySelectorAll ? document.querySelectorAll('[id*="gpt-ad" i], [id*="google_ads" i], [id*="div-gpt-ad" i], [id*="gpt_unit" i], [id*="google_ads_iframe" i], [class*="google_ads_iframe" i]') : [];
    const limitedGptElements = Array.from(gptElements).slice(0, 20);
    limitedGptElements.forEach(element => {
      if (element && element.nodeType === Node.ELEMENT_NODE && !isAdElement(element) && !hasParentAdOverlay(element)) {
        // These are Google Publisher Tags which are definitely ads, add them directly
        addAdOverlay(element);
      }
    });
    
    // Check for elements with data-google-query-id attribute (high confidence Google ads)
    const googleQueryIdElements = document.querySelectorAll ? document.querySelectorAll('[data-google-query-id]') : [];
    const limitedGoogleQueryIdElements = Array.from(googleQueryIdElements).slice(0, 20);
    limitedGoogleQueryIdElements.forEach(element => {
      if (element && element.nodeType === Node.ELEMENT_NODE && !isAdElement(element) && !hasParentAdOverlay(element)) {
        // Elements with data-google-query-id are definitely Google ads
        addAdOverlay(element);
      }
    });
    
    // Check for elements with GoogleActiveViewElement children
    const allElements = document.querySelectorAll ? document.querySelectorAll('*') : [];
    const limitedAllElements = Array.from(allElements).slice(0, 50);
    limitedAllElements.forEach(element => {
      if (element && element.nodeType === Node.ELEMENT_NODE && !isAdElement(element) && !hasParentAdOverlay(element)) {
        if (element.classList && element.classList.contains('GoogleActiveViewElement')) {
          // This is definitely an ad, add it directly
          addAdOverlay(element);
        } else if (element.querySelector && element.querySelector('.GoogleActiveViewElement')) {
          // This is definitely an ad, add it directly
          addAdOverlay(element);
        }
      }
    });
    
    // Additional check for common ad container patterns
    const commonAdSelectors = '.ad-container, .advertisement, .ad-placement, .ad-unit, .ad-banner, .ad-box, ' +
      '.google-ads, .pub_300x250, .pub_300x250m, .pub_728x90, .text-ad, .text-ads, ' +
      '.afs_ads, .googlesyndication, [id*="ad" i], [class*="ad" i], ' +
      '[id*="advertisement" i], [class*="advertisement" i], [id*="banner" i], [class*="banner" i]';
    
    const commonAdContainers = document.querySelectorAll ? document.querySelectorAll(commonAdSelectors) : [];
    const limitedCommonAdContainers = Array.from(commonAdContainers).slice(0, 20);
    
    limitedCommonAdContainers.forEach(element => {
      if (element && element.nodeType === Node.ELEMENT_NODE && !isAdElement(element) && !hasParentAdOverlay(element)) {
        // For common ad containers, apply confidence scoring to avoid false positives
        if (isElementLikelyAd(element)) {
          addAdOverlay(element);
        }
      }
    });
    
    // Check for elements that are likely ads based on size and attributes
    const allElementsCheck = document.querySelectorAll ? document.querySelectorAll('*') : [];
    const limitedAllElementsCheck = Array.from(allElementsCheck).slice(0, 30);
    limitedAllElementsCheck.forEach(element => {
      if (element && element.nodeType === Node.ELEMENT_NODE && !isAdElement(element) && !hasParentAdOverlay(element)) {
        // Check for standard ad dimensions
        const rect = element.getBoundingClientRect();
        const width = rect.width;
        const height = rect.height;
        
        // Common ad dimensions
        const standardAdSizes = [
          [300, 250], [728, 90], [160, 600], [336, 280], [300, 600],
          [468, 60], [234, 60], [120, 600], [120, 240], [180, 150],
          [320, 50], [970, 250], [970, 90], [300, 50], [320, 100]
        ];
        
        const hasStandardAdSize = standardAdSizes.some(([w, h]) => 
          (Math.abs(width - w) <= 5 && Math.abs(height - h) <= 5) ||
          (Math.abs(width - h) <= 5 && Math.abs(height - w) <= 5) // Check for rotated ads
        );
        
        // If element has standard ad size and contains iframe or img with ad-related src
        if (hasStandardAdSize) {
          const iframeChildren = element.querySelectorAll ? element.querySelectorAll('iframe, img') : [];
          const hasAdRelatedContent = Array.from(iframeChildren).some(child => {
            const src = child.src || '';
            return src.includes('googlesyndication') || src.includes('doubleclick') || 
                   src.includes('googleadservices') || src.includes('googletagservices') ||
                   src.includes('pagead') || src.includes('tpc.goog');
          });
          
          if (hasAdRelatedContent) {
            // This is definitely an ad container, add it directly
            addAdOverlay(element);
          }
        }
      }
    });
    
    // Enhanced check: look for any element that contains ad-like content
    const allElementsAggressive = document.querySelectorAll ? document.querySelectorAll('*') : [];
    const limitedAllElementsAggressive = Array.from(allElementsAggressive).slice(0, 30);
    limitedAllElementsAggressive.forEach(element => {
      if (element && element.nodeType === Node.ELEMENT_NODE && !isAdElement(element) && !hasParentAdOverlay(element)) {
        // Check if element itself has ad-related src or attributes
        const elementSrc = element.src || element.getAttribute('src') || '';
        const elementDataSrc = element.getAttribute('data-src') || '';
        
        if (elementSrc.includes('googlesyndication') || elementSrc.includes('doubleclick') || 
            elementSrc.includes('googleadservices') || elementSrc.includes('googletagservices') ||
            elementSrc.includes('pagead') || elementSrc.includes('tpc.goog') ||
            elementDataSrc.includes('googlesyndication') || elementDataSrc.includes('doubleclick') || 
            elementDataSrc.includes('googleadservices') || elementDataSrc.includes('googletagservices') ||
            elementDataSrc.includes('pagead') || elementDataSrc.includes('tpc.goog')) {
          // This is definitely an ad element, add it directly
          addAdOverlay(element);
        }
        
        // Check for ad-related data attributes
        const attrs = Array.from(element.attributes || []);
        const hasAdRelatedAttr = attrs.some(attr => 
          attr.value.includes('googlesyndication') || attr.value.includes('doubleclick') ||
          attr.value.includes('googleadservices') || attr.value.includes('googletagservices') ||
          attr.value.includes('pagead') || attr.value.includes('tpc.goog')
        );
        
        if (hasAdRelatedAttr) {
          // This is definitely an ad element, add it directly
          addAdOverlay(element);
        }
        
        // Check for specific Google AdSense elements
        const elementId = element.id || '';
        if (elementId.includes('gpt-ad') || elementId.includes('google_ads') || 
            elementId.includes('div-gpt-ad') || elementId.includes('gpt_unit')) {
          // These are definitely ads, add them directly
          addAdOverlay(element);
        }
      }
    });
  } catch (e) {
    console.debug('Error in detectHighConfidenceAds:', e);
  }
  
  console.debug('🔍 Completed high-confidence ad detection');
}

// Function to create overlay with position-aware logic using anchor element
function createAdOverlay(adMarker) {
  if (!adMarker || adMarker.nodeType !== Node.ELEMENT_NODE) return null;
  
  // Find the correct anchor element by walking up the DOM tree
  const anchorElement = findAdAnchorElement(adMarker);
  if (!anchorElement) {
    console.debug('Could not find valid anchor element for ad marker:', adMarker);
    return null;
  }
  
  // Check if anchor element is already covered to prevent duplicates
  if (coveredElements.has(anchorElement)) {
    console.debug('Anchor element already covered, skipping duplicate overlay:', anchorElement);
    return overlayMap.get(anchorElement) || null;
  }
  
  // Additional checks to avoid overlaying essential elements
  const tagName = anchorElement.tagName.toLowerCase();
  if (tagName === 'body' || tagName === 'html' || anchorElement === document.body || anchorElement === document.documentElement) {
    console.debug('Skipping overlay for essential element:', anchorElement);
    return null;
  }
  
  // Get anchor element bounding box with appropriate positioning
  const boundingBox = getElementBoundingBox(anchorElement);
  if (!boundingBox) {
    console.debug('Could not get bounding box for anchor element:', anchorElement);
    return null;
  }
  
  // Size safety checks
  const viewportWidth = window.innerWidth;
  const viewportHeight = window.innerHeight;
  
  if (boundingBox.width > viewportWidth * 0.9 || boundingBox.height > viewportHeight * 0.6 ||
      (boundingBox.width < 2 || boundingBox.height < 2)) {
    console.debug('Skipping overlay: anchor element too large or too small:', anchorElement, 'Box:', boundingBox);
    return null;
  }
  
  try {
    // Create overlay element
    const overlay = document.createElement('div');
    overlay.className = 'ad-click-guard-overlay';
    overlay.setAttribute('data-ad-element', 'true');
    
    // Mark the anchor element as covered
    anchorElement.setAttribute('data-ad-click-guard-covered', 'true');
    coveredElements.add(anchorElement);
    
    // Store reference to the original ad marker and anchor element on the overlay
    overlay._adElement = adMarker;
    overlay._anchorElement = anchorElement;
    
    // Apply position-specific styling
    overlay.style.position = boundingBox.position;
    overlay.style.top = boundingBox.top + 'px';
    overlay.style.left = boundingBox.left + 'px';
    overlay.style.width = boundingBox.width + 'px';
    overlay.style.height = boundingBox.height + 'px';
    overlay.style.zIndex = '2147483647';
    overlay.style.pointerEvents = 'auto';
    overlay.style.cursor = 'not-allowed';
    overlay.style.backgroundColor = 'rgba(255, 0, 0, 0.25)';
    overlay.style.boxSizing = 'border-box';
    overlay.style.border = '2px solid red';
    overlay.style.margin = '0';
    overlay.style.padding = '0';
    overlay.style.display = 'block';
    overlay.style.visibility = 'visible';
    overlay.style.opacity = '1';
    
    // Add scroll and resize listeners to keep overlay positioned correctly
    setupOverlayPositionSync(overlay, anchorElement);
    
    // Add overlay to document body
    if (document.body) {
      document.body.appendChild(overlay);
    } else {
      document.documentElement.appendChild(overlay);
    }
    
    // Store overlay reference in WeakMap using anchor element as key
    overlayMap.set(anchorElement, overlay);
    
    // Set up 5-second verification timer to check if anchor element still exists
    const verificationTimeout = setTimeout(() => {
      // Check if the anchor element still exists in the DOM
      if (!document.contains(anchorElement)) {
        console.log('❌ Anchor element removed from DOM, removing overlay:', anchorElement);
        removeAdOverlay(anchorElement, overlay);
      } else {
        console.log('✅ Anchor element still exists after 5 seconds, keeping overlay:', anchorElement);
      }
    }, 5000); // 5-second verification
    
    // Store the verification timeout for potential cleanup
    overlay._verificationTimeout = verificationTimeout;
    
    console.log('✅ Created overlay for', boundingBox.position, 'anchor element:', anchorElement, 'Original marker:', adMarker);
    
    return overlay;
  } catch (e) {
    console.error('❌ Error creating overlay:', e, 'Anchor element:', anchorElement, 'Ad marker:', adMarker);
    // Clean up if anchor element was marked as covered but overlay creation failed
    coveredElements.delete(anchorElement);
    anchorElement.removeAttribute('data-ad-click-guard-covered');
    return null;
  }
}

// Function to remove overlay and clean up
function removeAdOverlay(anchorElement, overlay) {
  if (!anchorElement || !overlay) return;
  
  try {
    // Clear the verification timeout
    if (overlay._verificationTimeout) {
      clearTimeout(overlay._verificationTimeout);
    }
    
    // Remove event listeners if they exist
    if (overlay._scrollListener) {
      window.removeEventListener('scroll', overlay._scrollListener);
    }
    if (overlay._resizeListener) {
      window.removeEventListener('resize', overlay._resizeListener);
    }
    if (overlay._elementObserver) {
      overlay._elementObserver.disconnect();
    }
    
    // Remove the overlay from DOM
    if (overlay.parentNode) {
      overlay.parentNode.removeChild(overlay);
    }
    
    // Remove from WeakMap
    overlayMap.delete(anchorElement);
    
    // Remove from covered elements set
    coveredElements.delete(anchorElement);
    
    // Remove data attribute from anchor element
    anchorElement.removeAttribute('data-ad-click-guard-covered');
    
    console.log('✅ Removed overlay for anchor element:', anchorElement);
  } catch (e) {
    console.error('❌ Error removing overlay:', e, 'Anchor element:', anchorElement);
  }
}

// Function to set up position synchronization for scroll and resize events
function setupOverlayPositionSync(overlay, element) {
  if (!overlay || !element) return;
  
  // Create throttled update function using requestAnimationFrame
  let scrollUpdatePending = false;
  let resizeUpdatePending = false;
  
  const updatePosition = () => {
    try {
      // Get updated bounding box
      const boundingBox = getElementBoundingBox(element);
      if (!boundingBox) return;
      
      // Update overlay position and size
      overlay.style.position = boundingBox.position;
      overlay.style.top = boundingBox.top + 'px';
      overlay.style.left = boundingBox.left + 'px';
      overlay.style.width = boundingBox.width + 'px';
      overlay.style.height = boundingBox.height + 'px';
    } catch (e) {
      console.error('Error updating overlay position:', e);
    }
  };
  
  const scrollHandler = () => {
    if (!scrollUpdatePending) {
      scrollUpdatePending = true;
      requestAnimationFrame(() => {
        updatePosition();
        scrollUpdatePending = false;
      });
    }
  };
  
  const resizeHandler = () => {
    if (!resizeUpdatePending) {
      resizeUpdatePending = true;
      requestAnimationFrame(() => {
        updatePosition();
        resizeUpdatePending = false;
      });
    }
  };
  
  // Add event listeners
  window.addEventListener('scroll', scrollHandler, { passive: true });
  window.addEventListener('resize', resizeHandler, { passive: true });
  
  // Store the handlers for cleanup
  overlay._scrollListener = scrollHandler;
  overlay._resizeListener = resizeHandler;
}

// Function to create and manage MutationObserver for detection execution control
function createAdDetectionObserver(callback) {
  let detectionInProgress = false;
  let observer = null;
  
  const detectionCallback = (mutations) => {
    if (detectionInProgress) return;
    
    let newNodesAdded = false;
    
    // Process mutations to see if new nodes were added
    for (const mutation of mutations) {
      if (mutation.type === 'childList') {
        for (const node of mutation.addedNodes) {
          if (node.nodeType === Node.ELEMENT_NODE) {
            newNodesAdded = true;
            break;
          }
        }
      }
    }
    
    if (newNodesAdded) {
      // Only run detection if new nodes were added
      detectionInProgress = true;
      
      // Run detection after a short delay to allow elements to be fully rendered
      setTimeout(() => {
        try {
          if (typeof callback === 'function') {
            callback();
          }
        } finally {
          detectionInProgress = false;
        }
      }, 100);
    }
  };
  
  // Create the observer
  observer = new MutationObserver(detectionCallback);
  
  // Start observing
  if (document.body) {
    observer.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: false, // Don't observe attribute changes to avoid unnecessary triggers
      attributeOldValue: false,
      characterData: false
    });
  }
  
  // Return observer instance for potential cleanup
  return observer;
}

// Function to stop the MutationObserver
function stopAdDetectionObserver(observer) {
  if (observer) {
    observer.disconnect();
  }
}

// Function to handle sticky ad detection and overlay creation
function handleStickyAdOverlay(adMarker) {
  if (!adMarker || adMarker.nodeType !== Node.ELEMENT_NODE) return null;
  
  // Find the correct anchor element for the sticky ad
  const anchorElement = findAdAnchorElement(adMarker);
  if (!anchorElement) {
    console.debug('Could not find anchor for sticky ad marker:', adMarker);
    return null;
  }
  
  // Create overlay using the anchor element
  return createAdOverlay(adMarker);
}

// Function to remove all overlays when extension is disabled
function removeAllOverlays() {
  // Iterate over all covered elements and remove their overlays
  const elementsToRemove = [];
  
  // Collect all elements that have overlays
  coveredElements.forEach(element => {
    if (element && document.contains(element)) {
      elementsToRemove.push(element);
    }
  });
  
  // Remove each overlay
  elementsToRemove.forEach(element => {
    const overlay = overlayMap.get(element);
    if (overlay) {
      removeAdOverlay(element, overlay);
    }
  });
  
  // Clear the covered elements set
  coveredElements.clear();
  
  console.log('✅ Removed all overlays, total:', elementsToRemove.length);
}

// Function to cleanup all timers, observers, and event listeners
function cleanupAllResources() {
  // Remove all overlays
  removeAllOverlays();
  
  // Clear any remaining timeouts/intervals if they exist
  // In a real implementation, you would track these in a collection
  
  console.log('✅ All resources cleaned up');
}

// Performance optimization: batch DOM reads and writes
function batchDOMOperations(operations) {
  // Use requestAnimationFrame to batch DOM operations and avoid layout thrashing
  return new Promise(resolve => {
    requestAnimationFrame(() => {
      const results = [];
      for (const operation of operations) {
        if (typeof operation === 'function') {
          results.push(operation());
        }
      }
      resolve(results);
    });
  });
}

// Performance constraint: limit the number of elements processed at once
function processElementsWithLimit(elements, processor, limit = 50) {
  if (!Array.isArray(elements)) return [];
  
  const results = [];
  const limitedElements = elements.slice(0, limit);
  
  for (const element of limitedElements) {
    if (typeof processor === 'function') {
      results.push(processor(element));
    }
  }
  
  return results;
}

// Debug function to visualize ad bounding boxes
function visualizeAdBoundingBoxes() {
  // Create a temporary container for debug elements
  let debugContainer = document.querySelector('#ad-debug-visualizer');
  if (!debugContainer) {
    debugContainer = document.createElement('div');
    debugContainer.id = 'ad-debug-visualizer';
    debugContainer.style.position = 'fixed';
    debugContainer.style.top = '0';
    debugContainer.style.left = '0';
    debugContainer.style.width = '0';
    debugContainer.style.height = '0';
    debugContainer.style.zIndex = '2147483646';
    debugContainer.style.pointerEvents = 'none';
    debugContainer.style.overflow = 'visible';
    document.body.appendChild(debugContainer);
  }
  
  // Remove existing debug elements
  while (debugContainer.firstChild) {
    debugContainer.removeChild(debugContainer.firstChild);
  }
  
  // Add visual indicators for each covered element
  coveredElements.forEach(element => {
    if (!document.contains(element)) return;
    
    const rect = element.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return;
    
    const debugBox = document.createElement('div');
    debugBox.style.position = 'absolute';
    debugBox.style.top = rect.top + 'px';
    debugBox.style.left = rect.left + 'px';
    debugBox.style.width = rect.width + 'px';
    debugBox.style.height = rect.height + 'px';
    debugBox.style.border = '2px dashed yellow';
    debugBox.style.backgroundColor = 'rgba(255, 255, 0, 0.2)';
    debugBox.style.pointerEvents = 'none';
    debugBox.style.zIndex = '2147483645';
    debugBox.style.boxSizing = 'border-box';
    
    // Add label with element info
    const label = document.createElement('div');
    label.textContent = `${element.tagName} - ${getElementPositionType(element)}`;
    label.style.position = 'absolute';
    label.style.top = '-20px';
    label.style.left = '0';
    label.style.fontSize = '12px';
    label.style.color = 'yellow';
    label.style.backgroundColor = 'rgba(0, 0, 0, 0.7)';
    label.style.padding = '2px 4px';
    label.style.borderRadius = '2px';
    
    debugBox.appendChild(label);
    debugContainer.appendChild(debugBox);
  });
}

// Debug function to log overlay information
function logOverlayInfo() {
  console.group('🔍 Ad Overlay Debug Info');
  console.log('Total covered elements:', coveredElements.size);
  
  coveredElements.forEach(element => {
    if (document.contains(element)) {
      const positionType = getElementPositionType(element);
      const rect = element.getBoundingClientRect();
      console.log('Element:', element, 'Position:', positionType, 'Size:', `${rect.width}x${rect.height}`);
    }
  });
  
  console.groupEnd();
}

// Export functions for use in content.js
if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    parseCosmeticFilters,
    sanitizeSelector,
    detectAndOverlayAds,
    isGoogleAdElement,
    isElementLikelyAd,
    isElementLikelyContent,
    calculateAdConfidence,
    matchesEasyListSelectors,
    detectGoogleAds,
    detectHighConfidenceAds,
    createAdOverlay,
    getElementPositionType,
    getElementBoundingBox,
    coveredElements,
    overlayMap,
    removeAdOverlay,
    setupOverlayPositionSync,
    createAdDetectionObserver,
    stopAdDetectionObserver,
    removeAllOverlays,
    cleanupAllResources,
    batchDOMOperations,
    processElementsWithLimit,
    visualizeAdBoundingBoxes,
    logOverlayInfo
  };
}

// Also make functions available globally for content scripts
window.adDetection = {
  parseCosmeticFilters,
  sanitizeSelector,
  detectAndOverlayAds,
  isGoogleAdElement,
  isElementLikelyAd,
  isElementLikelyContent,
  calculateAdConfidence,
  matchesEasyListSelectors,
  detectGoogleAds,
  detectHighConfidenceAds,
  createAdOverlay,
  getElementPositionType,
  getElementBoundingBox,
  coveredElements,
  overlayMap,
  removeAdOverlay,
  setupOverlayPositionSync,
  createAdDetectionObserver,
  stopAdDetectionObserver,
  removeAllOverlays,
  cleanupAllResources,
  batchDOMOperations,
  processElementsWithLimit,
  visualizeAdBoundingBoxes,
  logOverlayInfo
};