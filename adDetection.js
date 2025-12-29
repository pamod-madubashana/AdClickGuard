// Ad Detection Functions
// Contains all EasyList-based ad detection logic and related functions

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
  if (!cosmeticSelectors || cosmeticSelectors.length === 0) return;
  
  console.log('🔍 Starting ad detection with', cosmeticSelectors.length, 'selectors');
  
  let totalChecked = 0;
  let totalMatched = 0;
  let selectorsApplied = 0;
  let selectorsSkipped = 0;
  
  try {
    // Process all cosmetic selectors but validate with confidence scoring
    for (const selector of cosmeticSelectors) {
      const sanitizedSelector = sanitizeSelector(selector);
      
      if (!sanitizedSelector) {
        selectorsSkipped++;
        continue;
      }
      
      try {
        const elements = document.querySelectorAll ? document.querySelectorAll(sanitizedSelector) : [];
        console.debug('Checking selector:', sanitizedSelector, 'Found elements:', elements.length);
        
        elements.forEach(element => {
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
        elements.forEach(element => {
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
        elements.forEach(element => {
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
}

// Function to detect high-confidence ads
function detectHighConfidenceAds(adElements, CONFIG, isAdElement, hasParentAdOverlay, addAdOverlay, isElementLikelyAd, calculateAdConfidence) {
  // Directly check for high-confidence ad signals
  
  try {
    // Check for iframes with ad-related sources
    const adIframes = document.querySelectorAll ? document.querySelectorAll('iframe[src*="googlesyndication" i], iframe[src*="doubleclick" i], iframe[src*="googleadservices" i], iframe[src*="googletagservices" i], iframe[src*="googlesyndication" i], iframe[src*="pagead" i], iframe[src*="tpc.goog" i], iframe[src*="googleusercontent.com" i][src*="ad"], iframe[src*="securepubads" i]') : [];
    adIframes.forEach(element => {
      if (element && element.nodeType === Node.ELEMENT_NODE && !isAdElement(element) && !hasParentAdOverlay(element)) {
        // These are definitely ads based on their source, add them directly
        addAdOverlay(element);
      }
    });
    
    // Check for iframe containers that are likely ad containers based on class/id patterns
    const potentialAdContainers = document.querySelectorAll ? document.querySelectorAll('div[id^="google_ads_iframe_"], div[id*="gpt-ad-"], div[id*="div-gpt-ad"], ins[id^="gpt_unit_"], div[data-google-query-id], div[data-ad-client], div[data-ad-slot]') : [];
    potentialAdContainers.forEach(element => {
      if (element && element.nodeType === Node.ELEMENT_NODE && !isAdElement(element) && !hasParentAdOverlay(element)) {
        // These are likely ad containers, add them directly
        addAdOverlay(element);
      }
    });
    
    // Check for elements with Google ad attributes
    const googleAdElements = document.querySelectorAll ? document.querySelectorAll('[data-ad-client], [data-google-av-ad], [data-google-av-element], [data-ad-slot], [data-ad-format], [data-google-query-id], [data-ad-status="filled"]') : [];
    googleAdElements.forEach(element => {
      if (element && element.nodeType === Node.ELEMENT_NODE && !isAdElement(element) && !hasParentAdOverlay(element)) {
        // Elements with Google ad attributes are definitely ads, add them directly
        addAdOverlay(element);
      }
    });
    
    // Check for elements with adsbygoogle class
    const adsByGoogleElements = document.querySelectorAll ? document.querySelectorAll('.adsbygoogle') : [];
    adsByGoogleElements.forEach(element => {
      if (element && element.nodeType === Node.ELEMENT_NODE && !isAdElement(element) && !hasParentAdOverlay(element)) {
        // Elements with adsbygoogle class are definitely ads, add them directly
        addAdOverlay(element);
      }
    });
    
    // Check for Google Publisher Tags elements
    const gptElements = document.querySelectorAll ? document.querySelectorAll('[id*="gpt-ad" i], [id*="google_ads" i], [id*="div-gpt-ad" i], [id*="gpt_unit" i], [id*="google_ads_iframe" i], [class*="google_ads_iframe" i]') : [];
    gptElements.forEach(element => {
      if (element && element.nodeType === Node.ELEMENT_NODE && !isAdElement(element) && !hasParentAdOverlay(element)) {
        // These are Google Publisher Tags which are definitely ads, add them directly
        addAdOverlay(element);
      }
    });
    
    // Check for elements with data-google-query-id attribute (high confidence Google ads)
    const googleQueryIdElements = document.querySelectorAll ? document.querySelectorAll('[data-google-query-id]') : [];
    googleQueryIdElements.forEach(element => {
      if (element && element.nodeType === Node.ELEMENT_NODE && !isAdElement(element) && !hasParentAdOverlay(element)) {
        // Elements with data-google-query-id are definitely Google ads
        addAdOverlay(element);
      }
    });
    
    // Check for elements with GoogleActiveViewElement children
    const allElements = document.querySelectorAll ? document.querySelectorAll('*') : [];
    allElements.forEach(element => {
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
    
    commonAdContainers.forEach(element => {
      if (element && element.nodeType === Node.ELEMENT_NODE && !isAdElement(element) && !hasParentAdOverlay(element)) {
        // For common ad containers, apply confidence scoring to avoid false positives
        if (isElementLikelyAd(element)) {
          addAdOverlay(element);
        }
      }
    });
    
    // Check for elements that are likely ads based on size and attributes
    const allElementsCheck = document.querySelectorAll ? document.querySelectorAll('*') : [];
    allElementsCheck.forEach(element => {
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
    allElementsAggressive.forEach(element => {
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
    detectHighConfidenceAds
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
  detectHighConfidenceAds
};