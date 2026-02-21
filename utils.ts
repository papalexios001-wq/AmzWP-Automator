/**
 * ============================================================================
 * AmzWP-Automator | Enterprise Utilities Core v80.0
 * ============================================================================
 * SOTA Architecture with:
 * - Parallel Proxy Racing (Promise.any)
 * - Comprehensive URL Filtering (webp, avif, etc.)
 * - Configurable LRU Caching
 * - Enterprise Error Handling with Custom Error Types
 * - Type-Safe Operations Throughout
 * - Rate Limiting & Debouncing
 * - Memory-Optimized Storage
 * ============================================================================
 */

import { 
  ProductDetails, 
  AppConfig, 
  BlogPost, 
  PostPriority, 
  PostType, 
  DeploymentMode, 
  ComparisonData,
  CarouselData
} from './types';
import { GoogleGenAI } from '@google/genai';

// ============================================================================
// CUSTOM ERROR TYPES - Enterprise Error Handling
// ============================================================================

export class NetworkError extends Error {
  constructor(message: string, public readonly statusCode?: number) {
    super(message);
    this.name = 'NetworkError';
  }
}

export class ProxyExhaustionError extends Error {
  constructor(message: string, public readonly attemptedProxies: number) {
    super(message);
    this.name = 'ProxyExhaustionError';
  }
}

export class AIProcessingError extends Error {
  constructor(message: string, public readonly model?: string) {
    super(message);
    this.name = 'AIProcessingError';
  }
}

export class WordPressAPIError extends Error {
  constructor(message: string, public readonly endpoint?: string, public readonly statusCode?: number) {
    super(message);
    this.name = 'WordPressAPIError';
  }
}

export class ValidationError extends Error {
  constructor(message: string, public readonly field?: string) {
    super(message);
    this.name = 'ValidationError';
  }
}

// ============================================================================
// CONFIGURATION CONSTANTS
// ============================================================================

const CONFIG = {
  CACHE: {
    MAX_PRODUCTS: 500,
    MAX_ANALYSIS: 200,
    PRODUCT_TTL_MS: 24 * 60 * 60 * 1000, // 24 hours
    ANALYSIS_TTL_MS: 12 * 60 * 60 * 1000, // 12 hours
  },
  NETWORK: {
    DEFAULT_TIMEOUT_MS: 15000,
    PUSH_TIMEOUT_MS: 25000,
    MAX_RETRIES: 3,
    RETRY_BACKOFF_MS: 1000,
  },
  AI: {
    MAX_CONTEXT_CHARS: 20000,
    MAX_PRODUCTS_PER_SCAN: 10,
    MAX_RETRIES: 2,
  },
  // COMPREHENSIVE media/asset file extensions to EXCLUDE from sitemap crawling
  EXCLUDED_EXTENSIONS: /\.(jpg|jpeg|png|gif|webp|avif|svg|ico|bmp|tiff|tif|heic|heif|raw|pdf|css|js|mjs|cjs|ts|tsx|jsx|json|xml|rss|atom|txt|md|yaml|yml|toml|woff|woff2|ttf|eot|otf|mp4|mp3|wav|avi|mov|mkv|webm|ogg|flac|aac|m4a|m4v|wmv|flv|3gp|zip|rar|gz|tar|7z|bz2|xz|exe|dmg|pkg|deb|rpm|iso|doc|docx|xls|xlsx|ppt|pptx|csv|sql)$/i,
} as const;

// ============================================================================
// CACHE KEYS
// ============================================================================

const CACHE_KEYS = {
  PRODUCTS: 'amzwp_cache_products_v4',
  ANALYSIS: 'amzwp_cache_analysis_v4',
  METADATA: 'amzwp_cache_meta_v4',
} as const;

// ============================================================================
// TYPE DEFINITIONS
// ============================================================================

interface CacheEntry<T> {
  data: T;
  timestamp: number;
  ttl: number;
}

interface ProxyConfig {
  name: string;
  transform: (url: string) => string;
  parseResponse: (response: Response) => Promise<string>;
  priority: number;
}

interface AnalysisCacheData {
  products: ProductDetails[];
  comparison?: ComparisonData;
  carousel?: CarouselData;
}

// ============================================================================
// ENTERPRISE LRU CACHE WITH TTL
// ============================================================================

class EnterpriseCache<T> {
  private readonly storageKey: string;
  private readonly maxSize: number;
  private readonly defaultTTL: number;

  constructor(storageKey: string, maxSize: number, defaultTTL: number) {
    this.storageKey = storageKey;
    this.maxSize = maxSize;
    this.defaultTTL = defaultTTL;
  }

  private getStore(): Record<string, CacheEntry<T>> {
    try {
      const raw = localStorage.getItem(this.storageKey);
      return raw ? JSON.parse(raw) : {};
    } catch {
      return {};
    }
  }

  private setStore(store: Record<string, CacheEntry<T>>): void {
    try {
      localStorage.setItem(this.storageKey, JSON.stringify(store));
    } catch (e) {
      // Storage quota exceeded - clear old entries
      this.cleanup(true);
    }
  }

  get(key: string): T | null {
    const store = this.getStore();
    const entry = store[key];
    
    if (!entry) return null;
    
    // Check TTL expiration
    if (Date.now() - entry.timestamp > entry.ttl) {
      delete store[key];
      this.setStore(store);
      return null;
    }
    
    return entry.data;
  }

  set(key: string, data: T, ttl?: number): void {
    const store = this.getStore();
    
    // Enforce LRU eviction if at capacity
    const keys = Object.keys(store);
    if (keys.length >= this.maxSize) {
      // Remove oldest entries (first 20%)
      const sortedKeys = keys.sort((a, b) => store[a].timestamp - store[b].timestamp);
      const toRemove = Math.ceil(this.maxSize * 0.2);
      sortedKeys.slice(0, toRemove).forEach(k => delete store[k]);
    }
    
    store[key] = {
      data,
      timestamp: Date.now(),
      ttl: ttl ?? this.defaultTTL,
    };
    
    this.setStore(store);
  }

  has(key: string): boolean {
    return this.get(key) !== null;
  }

  delete(key: string): void {
    const store = this.getStore();
    delete store[key];
    this.setStore(store);
  }

  cleanup(force = false): void {
    const store = this.getStore();
    const now = Date.now();
    
    Object.keys(store).forEach(key => {
      const entry = store[key];
      if (force || now - entry.timestamp > entry.ttl) {
        delete store[key];
      }
    });
    
    this.setStore(store);
  }

  clear(): void {
    localStorage.removeItem(this.storageKey);
  }

  size(): number {
    return Object.keys(this.getStore()).length;
  }

  getAll(): Record<string, T> {
    const store = this.getStore();
    const result: Record<string, T> = {};
    const now = Date.now();
    
    Object.entries(store).forEach(([key, entry]) => {
      if (now - entry.timestamp <= entry.ttl) {
        result[key] = entry.data;
      }
    });
    
    return result;
  }
}

// ============================================================================
// INTELLIGENCE CACHE SINGLETON
// ============================================================================

const productCache = new EnterpriseCache<ProductDetails>(
  CACHE_KEYS.PRODUCTS,
  CONFIG.CACHE.MAX_PRODUCTS,
  CONFIG.CACHE.PRODUCT_TTL_MS
);

const analysisCache = new EnterpriseCache<AnalysisCacheData>(
  CACHE_KEYS.ANALYSIS,
  CONFIG.CACHE.MAX_ANALYSIS,
  CONFIG.CACHE.ANALYSIS_TTL_MS
);

export const IntelligenceCache = {
  getProducts: (): Record<string, ProductDetails> => productCache.getAll(),
  
  getProduct: (asin: string): ProductDetails | null => productCache.get(asin),
  
  setProduct: (asin: string, data: ProductDetails): void => {
    productCache.set(asin, data);
  },
  
  getAnalysis: (contentHash: string): AnalysisCacheData | null => {
    return analysisCache.get(contentHash);
  },
  
  setAnalysis: (contentHash: string, data: AnalysisCacheData): void => {
    analysisCache.set(contentHash, data);
  },
  
  clear: (): void => {
    productCache.clear();
    analysisCache.clear();
  },
  
  cleanup: (): void => {
    productCache.cleanup();
    analysisCache.cleanup();
  },
  
  stats: () => ({
    products: productCache.size(),
    analysis: analysisCache.size(),
  }),
};

// ============================================================================
// SECURE STORAGE
// ============================================================================

export const SecureStorage = {
  encrypt: (text: string): string => {
    if (!text) return '';
    try {
      const key = 0xA5; // Simple XOR key
      return btoa(
        text
          .split('')
          .map((c, i) => String.fromCharCode(c.charCodeAt(0) ^ ((key + i) % 255)))
          .join('')
      );
    } catch {
      return '';
    }
  },
  
  decrypt: (cipher: string): string => {
    if (!cipher) return '';
    try {
      const key = 0xA5;
      return atob(cipher)
        .split('')
        .map((c, i) => String.fromCharCode(c.charCodeAt(0) ^ ((key + i) % 255)))
        .join('');
    } catch {
      return '';
    }
  },
};

// ============================================================================
// PROXY CONFIGURATION - SOTA Parallel Racing Architecture
// ============================================================================

const PROXY_CONFIGS: ProxyConfig[] = [
  {
    name: 'corsproxy.io',
    transform: (url) => `https://corsproxy.io/?${encodeURIComponent(url)}`,
    parseResponse: async (res) => res.text(),
    priority: 1,
  },
  {
    name: 'allorigins',
    transform: (url) => `https://api.allorigins.win/get?url=${encodeURIComponent(url)}`,
    parseResponse: async (res) => {
      const json = await res.json();
      return json.contents;
    },
    priority: 2,
  },
  {
    name: 'codetabs',
    transform: (url) => `https://api.codetabs.com/v1/proxy?quest=${encodeURIComponent(url)}`,
    parseResponse: async (res) => res.text(),
    priority: 3,
  },
  {
    name: 'thingproxy',
    transform: (url) => `https://thingproxy.freeboard.io/fetch/${url}`,
    parseResponse: async (res) => res.text(),
    priority: 4,
  },
];

// ============================================================================
// NETWORK UTILITIES - Enterprise Proxy Orchestrator with Parallel Racing
// ============================================================================

/**
 * Fetches a URL using parallel proxy racing for maximum speed and reliability.
 * Uses Promise.any() to return the first successful response.
 */
const fetchWithProxy = async (
  url: string, 
  timeout = CONFIG.NETWORK.DEFAULT_TIMEOUT_MS,
  options: { useParallelRacing?: boolean } = {}
): Promise<string> => {
  const { useParallelRacing = true } = options;
  const cleanUrl = url.trim().replace(/^(?!https?:\/\/)/i, 'https://');

  if (useParallelRacing) {
    // SOTA: Parallel proxy racing - fastest wins
    const proxyPromises = PROXY_CONFIGS.map(async (proxy) => {
      const proxyUrl = proxy.transform(cleanUrl);
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), timeout);

      try {
        const response = await fetch(proxyUrl, {
          signal: controller.signal,
          headers: {
            'Accept': 'application/xml, text/xml, application/json, text/html, */*',
          },
        });

        clearTimeout(timeoutId);

        if (!response.ok) {
          throw new NetworkError(`HTTP ${response.status}`, response.status);
        }

        return proxy.parseResponse(response);
      } catch (error) {
        clearTimeout(timeoutId);
        throw error;
      }
    });

    try {
      return await Promise.any(proxyPromises);
    } catch (aggregateError) {
      throw new ProxyExhaustionError(
        'All proxy vectors exhausted. Target may be blocking requests.',
        PROXY_CONFIGS.length
      );
    }
  } else {
    // Sequential fallback mode
    const errors: string[] = [];
    
    for (const proxy of PROXY_CONFIGS) {
      try {
        const proxyUrl = proxy.transform(cleanUrl);
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), timeout);

        const response = await fetch(proxyUrl, {
          signal: controller.signal,
          headers: {
            'Accept': 'application/xml, text/xml, application/json, text/html, */*',
          },
        });

        clearTimeout(timeoutId);

        if (!response.ok) {
          errors.push(`${proxy.name}: HTTP ${response.status}`);
          continue;
        }

        return await proxy.parseResponse(response);
      } catch (error: any) {
        errors.push(`${proxy.name}: ${error.message}`);
        // Small delay between sequential attempts
        await sleep(200);
      }
    }

    throw new ProxyExhaustionError(
      `All proxies failed: ${errors.join('; ')}`,
      PROXY_CONFIGS.length
    );
  }
};

// ============================================================================
// UTILITY FUNCTIONS
// ============================================================================

const sleep = (ms: number): Promise<void> => new Promise(r => setTimeout(r, ms));

/**
 * Generates a deterministic hash for content-based caching
 */
const generateContentHash = (title: string, contentLength: number): string => {
  return `v4_${title.toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 30)}_${contentLength}`;
};

/**
 * Validates and normalizes a URL
 */
const normalizeUrl = (url: string): string => {
  let normalized = url.trim();
  if (!normalized.startsWith('http')) {
    normalized = `https://${normalized}`;
  }
  return normalized.replace(/\/+$/, ''); // Remove trailing slashes
};

/**
 * Checks if a URL is a valid content URL (not a media/asset file)
 */
const isValidContentUrl = (url: string): boolean => {
  if (!url || typeof url !== 'string') return false;
  return !CONFIG.EXCLUDED_EXTENSIONS.test(url);
};

/**
 * Extracts a readable title from a URL slug
 */
const extractTitleFromUrl = (url: string): string => {
  try {
    const slug = url.split('/').filter(Boolean).pop() || '';
    return slug
      .replace(/[-_]/g, ' ')
      .replace(/\b\w/g, l => l.toUpperCase())
      .trim() || 'Untitled';
  } catch {
    return 'Untitled';
  }
};

/**
 * Debounce function for rate limiting
 */
export const debounce = <T extends (...args: any[]) => any>(
  fn: T,
  delay: number
): ((...args: Parameters<T>) => void) => {
  let timeoutId: ReturnType<typeof setTimeout>;
  return (...args: Parameters<T>) => {
    clearTimeout(timeoutId);
    timeoutId = setTimeout(() => fn(...args), delay);
  };
};

/**
 * Rate limiter for API calls
 */
export const createRateLimiter = (maxCalls: number, windowMs: number) => {
  const calls: number[] = [];
  
  return async <T>(fn: () => Promise<T>): Promise<T> => {
    const now = Date.now();
    
    // Remove old calls outside the window
    while (calls.length > 0 && calls[0] < now - windowMs) {
      calls.shift();
    }
    
    if (calls.length >= maxCalls) {
      const waitTime = calls[0] + windowMs - now;
      await sleep(waitTime);
    }
    
    calls.push(Date.now());
    return fn();
  };
};

// ============================================================================
// CONTENT FETCHING
// ============================================================================

export const fetchRawPostContent = async (
  config: AppConfig, 
  id: number, 
  url: string
): Promise<{ content: string; resolvedId: number }> => {
  const wpUrl = (config.wpUrl || '').replace(/\/$/, '');
  const auth = btoa(`${config.wpUser || ''}:${config.wpAppPassword || ''}`);
  const slug = (url || '').replace(/\/$/, '').split('/').pop() || '';

  // Strategy 1: WordPress REST API (Direct)
  if (wpUrl && config.wpUser) {
    const apiUrl = `${wpUrl}/wp-json/wp/v2/posts?slug=${slug}&_fields=id,content,title`;
    const authHeader: HeadersInit = { 'Authorization': `Basic ${auth}` };

    try {
      const res = await fetch(apiUrl, {
        headers: authHeader,
        signal: AbortSignal.timeout(10000),
      });
      
      if (res.ok) {
        const data = await res.json();
        if (data?.length > 0) {
          return {
            content: data[0].content?.rendered || '',
            resolvedId: data[0].id,
          };
        }
      }
    } catch {
      console.warn('[fetchRawPostContent] Direct API failed, trying proxy...');
    }

    // Strategy 2: WordPress REST API (via Proxy)
    try {
      const proxyUrl = `https://corsproxy.io/?${encodeURIComponent(apiUrl)}`;
      const res = await fetch(proxyUrl, {
        headers: authHeader,
        signal: AbortSignal.timeout(10000),
      });
      
      if (res.ok) {
        const data = await res.json();
        if (data?.length > 0) {
          return {
            content: data[0].content?.rendered || '',
            resolvedId: data[0].id,
          };
        }
      }
    } catch {
      console.warn('[fetchRawPostContent] Proxy API failed, falling back to HTML scraping...');
    }
  }

  // Strategy 3: HTML Scraping (Fallback)
  try {
    const html = await fetchWithProxy(url);
    const parser = new DOMParser();
    const doc = parser.parseFromString(html, 'text/html');

    // Extract post ID from various WordPress markers
    let scrapedId = id;
    
    // Try shortlink: <link rel="shortlink" href="?p=123">
    const shortlink = doc.querySelector('link[rel="shortlink"]');
    if (shortlink) {
      const href = shortlink.getAttribute('href');
      const match = href?.match(/[?&]p=(\d+)/);
      if (match?.[1]) scrapedId = parseInt(match[1], 10);
    }
    
    // Try body class: postid-123
    if (scrapedId === id) {
      const bodyClass = doc.body?.className || '';
      const match = bodyClass.match(/postid-(\d+)/);
      if (match?.[1]) scrapedId = parseInt(match[1], 10);
    }

    // Extract main content using multiple selectors
    const contentSelectors = [
      '.entry-content',
      'article .content',
      'article',
      'main',
      '#content',
      '.post-content',
      '.post',
      '.content',
      '.entry-body',
      '[role="main"]',
    ];

    let extractedContent = '';
    for (const selector of contentSelectors) {
      const el = doc.querySelector(selector);
      if (el && el.innerHTML.length > extractedContent.length) {
        extractedContent = el.innerHTML;
      }
    }

    return {
      content: extractedContent || doc.body?.innerHTML || '',
      resolvedId: scrapedId || Date.now(),
    };
  } catch (error) {
    throw new NetworkError('Content acquisition failed: Target unreachable via all protocols.');
  }
};

export const fetchPageContent = async (
  config: AppConfig, 
  url: string
): Promise<{ id: number; title: string; content: string }> => {
  const result = await fetchRawPostContent(config, 0, url);
  return {
    id: result.resolvedId,
    title: extractTitleFromUrl(url),
    content: result.content,
  };
};

// ============================================================================
// SITEMAP PARSING - Enterprise Grade with URL Validation
// ============================================================================

export const fetchAndParseSitemap = async (
  url: string, 
  config: AppConfig
): Promise<BlogPost[]> => {
  let targetUrl = normalizeUrl(url);

  // Auto-append sitemap.xml if not present
  if (!targetUrl.includes('sitemap') && !targetUrl.endsWith('.xml')) {
    const sitemapVariants = [
      `${targetUrl}/sitemap.xml`,
      `${targetUrl}/sitemap_index.xml`,
      `${targetUrl}/wp-sitemap.xml`,
      `${targetUrl}/post-sitemap.xml`,
    ];

    for (const variant of sitemapVariants) {
      try {
        const res = await fetch(variant, { 
          method: 'HEAD', 
          signal: AbortSignal.timeout(5000) 
        });
        if (res.ok) {
          targetUrl = variant;
          break;
        }
      } catch {
        continue;
      }
    }

    // If no sitemap found, try original URL
    if (targetUrl === normalizeUrl(url)) {
      targetUrl = `${targetUrl}/sitemap.xml`;
    }
  }

  // Strategy 1: WordPress REST API (if credentials available)
  if (config.wpUrl && config.wpUser && config.wpAppPassword && targetUrl.includes(config.wpUrl)) {
    try {
      const wpBase = config.wpUrl.replace(/\/$/, '');
      const auth = btoa(`${config.wpUser}:${config.wpAppPassword}`);
      
      const res = await fetch(
        `${wpBase}/wp-json/wp/v2/posts?per_page=100&_fields=id,link,title,status,type`,
        {
          headers: { 'Authorization': `Basic ${auth}` },
          signal: AbortSignal.timeout(15000),
        }
      );

      if (res.ok) {
        const data = await res.json();
        return data.map((p: any, idx: number) => ({
          id: p.id || Date.now() + idx,
          title: p.title?.rendered || 'Untitled',
          url: p.link,
          status: p.status === 'publish' ? 'publish' : 'draft',
          content: '',
          priority: 'medium' as PostPriority,
          postType: 'unknown' as PostType,
          monetizationStatus: 'analyzing' as const,
        }));
      }
    } catch {
      console.warn('[fetchAndParseSitemap] WP API failed, trying sitemap XML...');
    }
  }

  // Strategy 2: Fetch and Parse Sitemap XML
  let xml = '';
  
  // Try direct fetch first
  try {
    const res = await fetch(targetUrl, {
      headers: { 'Accept': 'application/xml, text/xml' },
      signal: AbortSignal.timeout(10000),
    });
    if (res.ok) {
      xml = await res.text();
    } else {
      throw new Error('Direct fetch failed');
    }
  } catch {
    // Fall back to proxy
    xml = await fetchWithProxy(targetUrl);
  }

  // Parse XML
  const parser = new DOMParser();
  const doc = parser.parseFromString(xml, 'text/xml');

  const parseError = doc.querySelector('parsererror');
  if (parseError) {
    throw new ValidationError('Invalid Sitemap XML Format. Please provide a valid sitemap URL.');
  }

  // Handle Sitemap Index (recursive)
  const sitemapLocs = Array.from(doc.querySelectorAll('sitemap loc'));
  if (sitemapLocs.length > 0) {
    // Prefer post-sitemap if available
    const postSitemap = sitemapLocs.find(n => 
      (n.textContent || '').toLowerCase().includes('post-sitemap')
    );
    const subSitemapUrl = postSitemap?.textContent || sitemapLocs[0].textContent;
    
    if (subSitemapUrl && subSitemapUrl !== targetUrl) {
      return fetchAndParseSitemap(subSitemapUrl, config);
    }
  }

  // Extract URLs from urlset
  const urlLocs = Array.from(doc.querySelectorAll('url loc'));
  if (urlLocs.length === 0) {
    throw new ValidationError('No URLs found in sitemap. The sitemap may be empty or malformed.');
  }

  const posts: BlogPost[] = [];
  
  urlLocs.forEach((locNode, idx) => {
    const rawUrl = locNode.textContent?.trim() || '';
    
    // Skip empty URLs
    if (!rawUrl) return;
    
    // ★ CRITICAL FIX: Skip ALL media/asset files including .webp
    if (!isValidContentUrl(rawUrl)) {
      console.debug(`[fetchAndParseSitemap] Skipping non-content URL: ${rawUrl}`);
      return;
    }

    posts.push({
      id: Date.now() + idx,
      title: extractTitleFromUrl(rawUrl),
      url: rawUrl,
      status: 'publish',
      content: '',
      priority: 'medium',
      postType: 'unknown',
      monetizationStatus: 'analyzing',
    });
  });

  if (posts.length === 0) {
    throw new ValidationError('No valid content URLs found. All URLs were media files or assets.');
  }

  return posts;
};

// ============================================================================
// MANUAL URL VALIDATION & ADDITION
// ============================================================================

export interface ManualUrlValidationResult {
  isValid: boolean;
  normalizedUrl: string;
  error?: string;
}

export const validateManualUrl = (url: string): ManualUrlValidationResult => {
  if (!url || typeof url !== 'string') {
    return { isValid: false, normalizedUrl: '', error: 'URL is required' };
  }

  const trimmed = url.trim();
  
  if (trimmed.length < 5) {
    return { isValid: false, normalizedUrl: '', error: 'URL is too short' };
  }

  const normalized = normalizeUrl(trimmed);

  // Check if it's a valid URL format
  try {
    new URL(normalized);
  } catch {
    return { isValid: false, normalizedUrl: '', error: 'Invalid URL format' };
  }

  // Check if it's a media/asset file
  if (!isValidContentUrl(normalized)) {
    return { 
      isValid: false, 
      normalizedUrl: '', 
      error: 'URL points to a media file, not content' 
    };
  }

  return { isValid: true, normalizedUrl: normalized };
};

export const createBlogPostFromUrl = (url: string, existingIds: Set<number>): BlogPost => {
  const normalized = normalizeUrl(url);
  
  // Generate unique ID
  let id = Date.now();
  while (existingIds.has(id)) {
    id++;
  }

  return {
    id,
    title: extractTitleFromUrl(normalized),
    url: normalized,
    status: 'publish',
    content: '',
    priority: 'medium',
    postType: 'unknown',
    monetizationStatus: 'analyzing',
  };
};

// ============================================================================
// HTML GENERATION - Comparison Table
// ============================================================================

export const generateComparisonTableHtml = (
  data: ComparisonData, 
  products: ProductDetails[], 
  affiliateTag: string
): string => {
  const sortedProducts = data.productIds
    .map(id => products.find(p => p.id === id))
    .filter((p): p is ProductDetails => p !== null && p !== undefined);

  if (sortedProducts.length === 0) return '';

  const finalTag = (affiliateTag || 'tag-20').trim();
  const cols = sortedProducts.length;

  return `<!-- wp:html -->
<style>
.comp-table-v2{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;margin:4rem 0;border:1px solid #e2e8f0;border-radius:24px;overflow:hidden;background:#fff;box-shadow:0 20px 50px -10px rgba(0,0,0,0.05)}
.comp-header{background:#0f172a;padding:20px;text-align:center;color:#fff;font-size:14px;font-weight:900;letter-spacing:2px;text-transform:uppercase}
.comp-grid{display:grid;gap:1px;background:#f1f5f9}
.comp-col{background:#fff;padding:30px 20px;display:flex;flex-direction:column;align-items:center;text-align:center;position:relative}
.comp-img{height:160px;width:auto;object-fit:contain;margin-bottom:20px;filter:drop-shadow(0 10px 20px rgba(0,0,0,0.1));transition:transform .3s}
.comp-col:hover .comp-img{transform:scale(1.05)}
.comp-title{font-size:16px;font-weight:800;color:#0f172a;line-height:1.3;margin-bottom:10px;height:42px;overflow:hidden;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical}
.comp-badge{position:absolute;top:0;left:50%;transform:translate(-50%,-50%);background:#2563eb;color:#fff;padding:5px 15px;border-radius:20px;font-size:10px;font-weight:900;text-transform:uppercase;letter-spacing:1px;box-shadow:0 4px 10px rgba(37,99,235,0.3);white-space:nowrap}
.comp-spec-row{display:grid;gap:1px;background:#f1f5f9;border-top:1px solid #f1f5f9}
.comp-spec-cell{background:#fff;padding:15px;text-align:center;font-size:13px;color:#64748b;font-weight:500;display:flex;align-items:center;justify-content:center;flex-direction:column}
.comp-spec-label{font-size:9px;font-weight:900;color:#94a3b8;text-transform:uppercase;margin-bottom:4px;letter-spacing:1px}
.comp-price{font-size:24px;font-weight:900;color:#0f172a;margin:15px 0;letter-spacing:-1px}
.comp-btn{background:#0f172a;color:#fff!important;text-decoration:none!important;padding:12px 24px;border-radius:12px;font-size:12px;font-weight:900;text-transform:uppercase;letter-spacing:1px;transition:all .3s;display:inline-block;width:100%;max-width:180px}
.comp-btn:hover{background:#2563eb;transform:translateY(-2px);box-shadow:0 10px 20px -5px rgba(37,99,235,0.4)}
@media(min-width:768px){.comp-grid{grid-template-columns:repeat(${cols},1fr)}.comp-spec-row{grid-template-columns:repeat(${cols},1fr)}}
@media(max-width:767px){.comp-grid,.comp-spec-row{display:flex;flex-direction:column}.comp-col{border-bottom:8px solid #f8fafc}.comp-spec-row{display:none}}
</style>
<div class="comp-table-v2">
  <div class="comp-header">${escapeHtml(data.title)}</div>
  <div class="comp-grid">
    ${sortedProducts.map((p, idx) => `
    <div class="comp-col">
      ${idx === 0 ? '<div class="comp-badge">Top Pick</div>' : ''}
      <a href="https://www.amazon.com/dp/${p.asin}?tag=${finalTag}" target="_blank" rel="nofollow sponsored noopener">
        <img src="${escapeHtml(p.imageUrl)}" class="comp-img" alt="${escapeHtml(p.title)}" loading="lazy" />
      </a>
      <div class="comp-title">${escapeHtml(p.title)}</div>
      <div style="color:#f59e0b;font-size:14px;margin-bottom:5px">${'★'.repeat(Math.round(p.rating))}${'☆'.repeat(5 - Math.round(p.rating))}</div>
      <div class="comp-price">${escapeHtml(p.price)}</div>
      <a href="https://www.amazon.com/dp/${p.asin}?tag=${finalTag}" target="_blank" rel="nofollow sponsored noopener" class="comp-btn">Check Price</a>
    </div>
    `).join('')}
  </div>
  ${data.specs.map(specKey => `
  <div class="comp-spec-row">
    ${sortedProducts.map(p => `
    <div class="comp-spec-cell">
      <span class="comp-spec-label">${escapeHtml(specKey)}</span>
      <span style="color:#0f172a;font-weight:700">${escapeHtml(p.specs?.[specKey] || '-')}</span>
    </div>
    `).join('')}
  </div>
  `).join('')}
</div>
<!-- /wp:html -->`;
};

// ============================================================================
// HTML GENERATION - Product Carousel
// ============================================================================

export const generateCarouselHtml = (
  data: CarouselData,
  products: ProductDetails[],
  affiliateTag: string
): string => {
  const sortedProducts = data.productIds
    .map((id: string) => products.find((p: ProductDetails) => p.id === id))
    .filter((p): p is ProductDetails => p !== null && p !== undefined);

  if (sortedProducts.length === 0) return '';

  const finalTag = (affiliateTag || 'tag-20').trim();

  return `<!-- wp:html -->
<style>
.amz-carousel-v1{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;margin:4rem 0;position:relative;overflow:hidden;padding:20px 0}
.amz-carousel-header{text-align:center;margin-bottom:30px}
.amz-carousel-header h2{font-size:24px;font-weight:900;color:#0f172a;letter-spacing:-1px;text-transform:uppercase}
.amz-carousel-track-wrap{overflow-x:auto;scrollbar-width:none;-ms-overflow-style:none;padding:10px 20px 40px}
.amz-carousel-track-wrap::-webkit-scrollbar{display:none}
.amz-carousel-track{display:flex;gap:24px;width:max-content}
.amz-carousel-item{width:280px;background:#fff;border:1px solid #f1f5f9;border-radius:32px;padding:24px;box-shadow:0 10px 30px -10px rgba(0,0,0,0.05);transition:all 0.4s cubic-bezier(0.4,0,0.2,1);flex-shrink:0;display:flex;flex-direction:column;align-items:center;text-align:center}
.amz-carousel-item:hover{transform:translateY(-8px);box-shadow:0 20px 50px -15px rgba(0,0,0,0.12);border-color:#e2e8f0}
.amz-carousel-img{height:180px;width:auto;object-fit:contain;margin-bottom:20px;filter:drop-shadow(0 10px 20px rgba(0,0,0,0.08))}
.amz-carousel-title{font-size:15px;font-weight:800;color:#0f172a;line-height:1.3;margin-bottom:12px;height:40px;overflow:hidden;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical}
.amz-carousel-price{font-size:22px;font-weight:900;color:#0f172a;margin-bottom:20px;letter-spacing:-1px}
.amz-carousel-btn{background:#0f172a;color:#fff!important;text-decoration:none!important;padding:12px 24px;border-radius:16px;font-size:11px;font-weight:900;text-transform:uppercase;letter-spacing:1px;transition:all 0.3s;display:inline-block;width:100%}
.amz-carousel-btn:hover{background:#2563eb;box-shadow:0 10px 20px -5px rgba(37,99,235,0.4)}
</style>
<div class="amz-carousel-v1">
  ${data.title ? `<div class="amz-carousel-header"><h2>${escapeHtml(data.title)}</h2></div>` : ''}
  <div class="amz-carousel-track-wrap">
    <div class="amz-carousel-track">
      ${sortedProducts.map((p: ProductDetails) => `
      <div class="amz-carousel-item">
        <a href="https://www.amazon.com/dp/${p.asin}?tag=${finalTag}" target="_blank" rel="nofollow sponsored noopener">
          <img src="${escapeHtml(p.imageUrl)}" class="amz-carousel-img" alt="${escapeHtml(p.title)}" loading="lazy" />
        </a>
        <div class="amz-carousel-title">${escapeHtml(p.title)}</div>
        <div style="color:#fbbf24;font-size:13px;margin-bottom:10px">${'★'.repeat(Math.round(p.rating))}${'☆'.repeat(5 - Math.round(p.rating))}</div>
        <div class="amz-carousel-price">${escapeHtml(p.price)}</div>
        <a href="https://www.amazon.com/dp/${p.asin}?tag=${finalTag}" target="_blank" rel="nofollow sponsored noopener" class="amz-carousel-btn">View Deal</a>
      </div>
      `).join('')}
    </div>
  </div>
</div>
<!-- /wp:html -->`;
};

// ============================================================================
// HTML GENERATION - Product Box
// ============================================================================

const escapeHtml = (str: string): string => {
  if (!str) return '';
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
};

export const generateProductBoxHtml = (
  product: ProductDetails, 
  affiliateTag: string, 
  mode: DeploymentMode = 'ELITE_BENTO'
): string => {
  const finalTag = (affiliateTag || 'tag-20').trim();
  const asin = (product.asin || '').trim();
  const link = `https://www.amazon.com/dp/${asin}?tag=${finalTag}`;
  const stars = Math.round(product.rating || 5);
  
  const bullets = (product.evidenceClaims || [
    "Premium build quality",
    "Industry-leading performance", 
    "Comprehensive warranty",
    "Trusted by thousands"
  ]).slice(0, 4);

  const faqs = (product.faqs || [
    { question: "Is this covered by warranty?", answer: "Yes, comprehensive manufacturer warranty included." },
    { question: "How fast is shipping?", answer: "Eligible for Prime shipping with free returns." },
    { question: "What's in the package?", answer: "Complete package with all accessories included." },
    { question: "Is support available?", answer: "24/7 customer support through multiple channels." }
  ]).slice(0, 4);

  // TACTICAL LINK Mode
  if (mode === 'TACTICAL_LINK') {
    return `<!-- wp:html -->
<style>
.amz-tac-v4{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;max-width:900px;margin:3rem auto;position:relative;isolation:isolate}
.amz-tac-card{background:#fff;border:1px solid #f1f5f9;border-radius:24px;padding:1.5rem;box-shadow:0 1px 3px rgba(0,0,0,0.05),0 10px 40px -10px rgba(0,0,0,0.04);display:flex;align-items:center;gap:2rem;transition:all 0.4s cubic-bezier(0.4,0,0.2,1);position:relative}
.amz-tac-card:hover{transform:translateY(-4px);box-shadow:0 20px 60px -15px rgba(0,0,0,0.1);border-color:#e2e8f0}
.amz-tac-img-box{width:120px;height:120px;background:#f8fafc;border-radius:20px;display:flex;align-items:center;justify-content:center;padding:12px;flex-shrink:0;position:relative;overflow:hidden}
.amz-tac-img-box img{max-width:100%;max-height:100%;object-fit:contain;transition:transform 0.6s cubic-bezier(0.4,0,0.2,1)}
.amz-tac-card:hover .amz-tac-img-box img{transform:scale(1.1)}
.amz-tac-body{flex:1;min-width:0}
.amz-tac-tag{display:inline-flex;align-items:center;gap:6px;background:#f1f5f9;color:#475569;font-size:10px;font-weight:800;text-transform:uppercase;letter-spacing:1px;padding:4px 12px;border-radius:100px;margin-bottom:12px}
.amz-tac-title{font-size:1.25rem;font-weight:800;color:#0f172a;line-height:1.2;margin:0 0 8px;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}
.amz-tac-rating{display:flex;align-items:center;gap:8px;margin-bottom:4px}
.amz-tac-stars{color:#fbbf24;font-size:14px;letter-spacing:1px}
.amz-tac-count{font-size:11px;font-weight:600;color:#94a3b8}
.amz-tac-side{text-align:right;display:flex;flex-direction:column;align-items:flex-end;gap:12px}
.amz-tac-price{font-size:1.75rem;font-weight:900;color:#0f172a;letter-spacing:-1px;line-height:1}
.amz-tac-btn{background:#0f172a;color:#fff!important;text-decoration:none!important;padding:12px 24px;border-radius:14px;font-size:12px;font-weight:800;text-transform:uppercase;letter-spacing:1px;transition:all 0.3s;display:inline-flex;align-items:center;gap:8px;white-space:nowrap}
.amz-tac-btn:hover{background:#2563eb;box-shadow:0 10px 20px -5px rgba(37,99,235,0.4)}
@media(max-width:640px){.amz-tac-card{flex-direction:column;text-align:center;padding:2rem}.amz-tac-side{align-items:center;text-align:center;width:100%}.amz-tac-btn{width:100%}}
</style>
<div class="amz-tac-v4">
  <div class="amz-tac-card">
    <div class="amz-tac-img-box">
      <img src="${escapeHtml(product.imageUrl)}" alt="${escapeHtml(product.title)}" loading="lazy" />
    </div>
    <div class="amz-tac-body">
      <div class="amz-tac-tag">
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><path d="M20 6L9 17l-5-5"/></svg>
        Verified Choice
      </div>
      <h3 class="amz-tac-title">${escapeHtml(product.title)}</h3>
      <div class="amz-tac-rating">
        <span class="amz-tac-stars">${'★'.repeat(stars)}${'☆'.repeat(5-stars)}</span>
        <span class="amz-tac-count">${product.reviewCount || '1,200'}+ reviews</span>
      </div>
    </div>
    <div class="amz-tac-side">
      <div class="amz-tac-price">${escapeHtml(product.price)}</div>
      <a href="${link}" target="_blank" rel="nofollow sponsored noopener" class="amz-tac-btn">
        View Deal
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><path d="M5 12h14M12 5l7 7-7 7"/></svg>
      </a>
    </div>
  </div>
</div>
<!-- /wp:html -->`;
  }

  // ELITE BENTO Mode (Full Product Card)
  const bulletsHtml = bullets.map(b => `
    <div class="amz-bento-feature">
      <div class="amz-bento-check">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="4"><polyline points="20 6 9 17 4 12"/></svg>
      </div>
      <span>${escapeHtml(b)}</span>
    </div>
  `).join('');

  const faqsHtml = faqs.map((f) => `
    <div class="amz-bento-faq-item">
      <div class="amz-bento-faq-q">
        <span class="amz-bento-faq-icon">?</span>
        <h4>${escapeHtml(f.question)}</h4>
      </div>
      <p>${escapeHtml(f.answer)}</p>
    </div>
  `).join('');

  return `<!-- wp:html -->
<style>
.amz-bento-v4{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;max-width:1000px;margin:5rem auto;position:relative;color:#0f172a;line-height:1.5}
.amz-bento-container{background:#fff;border-radius:48px;border:1px solid #f1f5f9;box-shadow:0 1px 2px rgba(0,0,0,0.05),0 20px 80px -20px rgba(0,0,0,0.08);overflow:hidden;transition:all 0.6s cubic-bezier(0.4,0,0.2,1)}
.amz-bento-container:hover{box-shadow:0 30px 100px -20px rgba(0,0,0,0.12);border-color:#e2e8f0}
.amz-bento-grid{display:grid;grid-template-columns:1fr;gap:0}
@media(min-width:1024px){.amz-bento-grid{grid-template-columns:45% 55%}}
.amz-bento-visual{background:linear-gradient(145deg,#f8fafc,#ffffff);padding:3rem;display:flex;flex-direction:column;align-items:center;justify-content:center;position:relative;border-bottom:1px solid #f1f5f9}
@media(min-width:1024px){.amz-bento-visual{border-bottom:0;border-right:1px solid #f1f5f9;padding:4rem}}
.amz-bento-badge{position:absolute;top:2rem;left:2rem;background:#0f172a;color:#fff;font-size:10px;font-weight:900;text-transform:uppercase;letter-spacing:2px;padding:8px 20px;border-radius:100px;box-shadow:0 10px 20px rgba(0,0,0,0.1)}
.amz-bento-img-wrap{width:100%;max-width:320px;aspect-ratio:1;display:flex;align-items:center;justify-content:center;position:relative;margin:2rem 0}
.amz-bento-img-wrap img{max-width:100%;max-height:100%;object-fit:contain;filter:drop-shadow(0 30px 60px rgba(0,0,0,0.12));transition:all 0.8s cubic-bezier(0.4,0,0.2,1)}
.amz-bento-container:hover .amz-bento-img-wrap img{transform:scale(1.08) translateY(-10px) rotate(2deg)}
.amz-bento-rating-pill{background:#fff;border:1px solid #f1f5f9;padding:10px 20px;border-radius:100px;display:flex;align-items:center;gap:12px;box-shadow:0 4px 12px rgba(0,0,0,0.03);margin-top:2rem}
.amz-bento-stars{color:#fbbf24;font-size:14px}
.amz-bento-rating-val{font-size:13px;font-weight:800;color:#0f172a}
.amz-bento-content{padding:3rem;display:flex;flex-direction:column}
@media(min-width:1024px){.amz-bento-content{padding:4rem}}
.amz-bento-meta{display:flex;align-items:center;gap:12px;margin-bottom:1.5rem}
.amz-bento-cat{font-size:10px;font-weight:900;text-transform:uppercase;letter-spacing:2px;color:#6366f1;background:#eef2ff;padding:6px 16px;border-radius:100px}
.amz-bento-prime{font-size:10px;font-weight:800;color:#16a34a;display:flex;align-items:center;gap:4px}
.amz-bento-title{font-size:2.25rem;font-weight:900;color:#0f172a;line-height:1.1;letter-spacing:-1px;margin:0 0 1.5rem}
.amz-bento-verdict{font-size:1.125rem;font-weight:500;color:#475569;line-height:1.6;margin-bottom:2.5rem;padding-left:1.5rem;border-left:4px solid #f1f5f9}
.amz-bento-features{display:grid;grid-template-columns:1fr 1fr;gap:1.5rem;margin-bottom:3rem}
@media(max-width:640px){.amz-bento-features{grid-template-columns:1fr}}
.amz-bento-feature{display:flex;align-items:center;gap:12px}
.amz-bento-check{width:24px;height:24px;background:#10b981;color:#fff;border-radius:50%;display:flex;align-items:center;justify-content:center;flex-shrink:0}
.amz-bento-check svg{width:12px;height:12px}
.amz-bento-feature span{font-size:14px;font-weight:700;color:#334155}
.amz-bento-footer{margin-top:auto;display:flex;align-items:center;justify-content:space-between;gap:2rem;padding-top:2.5rem;border-top:1px solid #f1f5f9}
.amz-bento-price-box{display:flex;flex-direction:column}
.amz-bento-price-label{font-size:10px;font-weight:800;text-transform:uppercase;letter-spacing:2px;color:#94a3b8;margin-bottom:4px}
.amz-bento-price{font-size:3rem;font-weight:900;color:#0f172a;letter-spacing:-2px;line-height:1}
.amz-bento-btn{background:#0f172a;color:#fff!important;text-decoration:none!important;padding:1.5rem 3rem;border-radius:24px;font-size:14px;font-weight:900;text-transform:uppercase;letter-spacing:2px;transition:all 0.3s;display:inline-flex;align-items:center;gap:12px;box-shadow:0 20px 40px -10px rgba(15,23,42,0.3)}
.amz-bento-btn:hover{background:#2563eb;transform:translateY(-4px);box-shadow:0 25px 50px -10px rgba(37,99,235,0.4)}
.amz-bento-faqs{background:#f8fafc;padding:3rem;border-top:1px solid #f1f5f9}
@media(min-width:1024px){.amz-bento-faqs{padding:4rem}}
.amz-bento-faqs-title{font-size:1.25rem;font-weight:900;margin-bottom:2rem;display:flex;align-items:center;gap:12px}
.amz-bento-faqs-grid{display:grid;grid-template-columns:1fr 1fr;gap:2rem}
@media(max-width:768px){.amz-bento-faqs-grid{grid-template-columns:1fr}}
.amz-bento-faq-item h4{font-size:14px;font-weight:800;margin:0 0 8px;color:#0f172a}
.amz-bento-faq-item p{font-size:13px;color:#64748b;margin:0}
.amz-bento-faq-icon{width:20px;height:20px;background:#e2e8f0;color:#64748b;border-radius:50%;display:inline-flex;align-items:center;justify-content:center;font-size:10px;font-weight:900;margin-right:8px}
</style>
<div class="amz-bento-v4">
  <div class="amz-bento-container">
    <div class="amz-bento-grid">
      <div class="amz-bento-visual">
        <div class="amz-bento-badge">Top Pick</div>
        <div class="amz-bento-img-wrap">
          <img src="${escapeHtml(product.imageUrl)}" alt="${escapeHtml(product.title)}" loading="lazy" />
        </div>
        <div class="amz-bento-rating-pill">
          <div class="amz-bento-stars">${'★'.repeat(stars)}${'☆'.repeat(5-stars)}</div>
          <div class="amz-bento-rating-val">${product.rating || '4.9'} / 5.0</div>
        </div>
      </div>
      <div class="amz-bento-content">
        <div class="amz-bento-meta">
          <span class="amz-bento-cat">${escapeHtml(product.category || 'Premium')}</span>
          ${product.prime ? '<span class="amz-bento-prime"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><polyline points="20 6 9 17 4 12"/></svg> Prime Shipping</span>' : ''}
        </div>
        <h2 class="amz-bento-title">${escapeHtml(product.title)}</h2>
        <div class="amz-bento-verdict">
          <p>${escapeHtml(product.verdict || 'A masterclass in design and engineering, offering unparalleled performance for demanding users.')}</p>
        </div>
        <div class="amz-bento-features">${bulletsHtml}</div>
        <div class="amz-bento-footer">
          <div class="amz-bento-price-box">
            <span class="amz-bento-price-label">Best Price</span>
            <div class="amz-bento-price">${escapeHtml(product.price)}</div>
          </div>
          <a href="${link}" target="_blank" rel="nofollow sponsored noopener" class="amz-bento-btn">
            Check Price
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><path d="M5 12h14M12 5l7 7-7 7"/></svg>
          </a>
        </div>
      </div>
    </div>
    <div class="amz-bento-faqs">
      <h3 class="amz-bento-faqs-title">
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><circle cx="12" cy="12" r="10"/><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>
        Common Questions
      </h3>
      <div class="amz-bento-faqs-grid">${faqsHtml}</div>
    </div>
  </div>
</div>
<!-- /wp:html -->`;
  };


// ============================================================================
// JSON SANITIZER - NEVER THROWS
// ============================================================================

const cleanAndParseJSON = (text: string): { products: any[]; comparison: any } => {
  const emptyResult = { products: [], comparison: null };
  if (!text || typeof text !== 'string') return emptyResult;

  try { return JSON.parse(text); } catch {}
  try {
    const cleaned = text.replace(/^[\s\S]*?```(?:json)?\s*/i, '').replace(/\s*```[\s\S]*$/i, '').trim();
    return JSON.parse(cleaned);
  } catch {}
  try {
    const start = text.indexOf('{');
    const end = text.lastIndexOf('}');
    if (start !== -1 && end > start) return JSON.parse(text.substring(start, end + 1));
  } catch {}
  try {
    const cleaned = text.replace(/```json\s*/gi, '').replace(/```\s*/g, '').replace(/[\x00-\x1F\x7F]/g, '').replace(/,\s*}/g, '}').replace(/,\s*]/g, ']').trim();
    return JSON.parse(cleaned);
  } catch {}

  return emptyResult;
};

// ============================================================================
// PRE-EXTRACTION ENGINE - FINDS ALL AMAZON PRODUCTS IN HTML
// ============================================================================

interface ExtractedProduct {
  asin: string;
  name: string;
  source: 'link' | 'heading' | 'list' | 'text';
  confidence: number;
}

const FORBIDDEN_PRODUCT_WORDS = [
  'privacy policy', 'terms of service', 'contact us', 'about us', 'disclaimer',
  'affiliate disclosure', 'cookie policy', 'sitemap', 'home', 'blog', 'search',
  'menu', 'navigation', 'footer', 'header', 'sidebar', 'comment', 'reply',
  'share', 'facebook', 'twitter', 'instagram', 'pinterest', 'youtube',
  'newsletter', 'subscribe', 'login', 'register', 'account', 'cart', 'checkout',
  'read more', 'click here', 'view on amazon', 'check price', 'buy now'
];

const preExtractAmazonProducts = (html: string): ExtractedProduct[] => {
  const products: ExtractedProduct[] = [];
  const seenAsins = new Set<string>();
  const seenNames = new Set<string>();

  const isForbidden = (text: string) => {
    const lower = text.toLowerCase();
    return FORBIDDEN_PRODUCT_WORDS.some(word => lower.includes(word)) || text.length < 5;
  };

  // STRATEGY 1: Extract ASINs from Amazon URLs (highest confidence)
  const asinPatterns = [
    /amazon\.com\/(?:dp|gp\/product|exec\/obidos\/ASIN)\/([A-Z0-9]{10})/gi,
    /amazon\.com\/[^"'\s]*\/dp\/([A-Z0-9]{10})/gi,
    /amazon\.com\/[^"'\s]*?(?:\/|%2F)([A-Z0-9]{10})(?:[/?&"'\s]|$)/gi,
    /amzn\.to\/([A-Za-z0-9]+)/gi,
    /data-asin=["']([A-Z0-9]{10})["']/gi,
    /asin["':\s]+["']?([A-Z0-9]{10})["']?/gi,
  ];

  for (const pattern of asinPatterns) {
    let match;
    while ((match = pattern.exec(html)) !== null) {
      const asin = match[1].toUpperCase();
      if (asin.length === 10 && /^[A-Z0-9]+$/.test(asin) && !seenAsins.has(asin)) {
        seenAsins.add(asin);
        products.push({ asin, name: '', source: 'link', confidence: 1.0 });
      }
    }
  }

  // STRATEGY 2: Extract product names from Amazon link text
  const linkTextPattern = /<a[^>]*amazon\.com[^>]*>([^<]{5,120})<\/a>/gi;
  let linkMatch;
  while ((linkMatch = linkTextPattern.exec(html)) !== null) {
    const name = linkMatch[1].trim().replace(/\s+/g, ' ');
    if (name.length > 8 && !isForbidden(name) && !seenNames.has(name.toLowerCase())) {
      seenNames.add(name.toLowerCase());
      products.push({ asin: '', name, source: 'link', confidence: 0.95 });
    }
  }

  // STRATEGY 3: Extract from headings with product indicators
  const headingPattern = /<h[1-4][^>]*>([^<]*(?:Best|Top|Review|Pick|Choice|Recommended|Editor|Winner|#\d|Overall|Budget|Premium)[^<]*)<\/h[1-4]>/gi;
  let headingMatch;
  while ((headingMatch = headingPattern.exec(html)) !== null) {
    const text = headingMatch[1].replace(/<[^>]*>/g, '').trim();
    if (text.length > 5 && text.length < 150 && !isForbidden(text) && !seenNames.has(text.toLowerCase())) {
      // Clean up common listicle prefixes like "1. ", "Best Overall: "
      const cleanName = text.replace(/^\d+[\.\s\-]+/, '').replace(/^(Best|Top|Winner|Pick|Choice|Recommended|Overall|Budget|Premium)\s*[:\-]*\s*/i, '').trim();
      if (cleanName.length > 5 && !seenNames.has(cleanName.toLowerCase())) {
        seenNames.add(cleanName.toLowerCase());
        products.push({ asin: '', name: cleanName, source: 'heading', confidence: 0.85 });
      }
    }
  }

  // STRATEGY 4: Extract from numbered/bulleted lists (more strict)
  const listPattern = /<li[^>]*>(?:<[^>]*>)*([^<]*(?:[A-Z][a-z]+\s+[A-Z][a-z]+)[^<]{10,100})(?:<[^>]*>)*<\/li>/gi;
  let listMatch;
  while ((listMatch = listPattern.exec(html)) !== null) {
    const text = listMatch[1].replace(/<[^>]*>/g, '').trim();
    if (text.length > 15 && text.length < 100 && !isForbidden(text) && !seenNames.has(text.toLowerCase())) {
      const hasProductIndicator = /\b(pro|plus|max|ultra|mini|lite|series|gen|edition|version|\d{3,4}[a-z]*|v\d+|mk\s*\d+)\b/i.test(text);
      if (hasProductIndicator) {
        seenNames.add(text.toLowerCase());
        products.push({ asin: '', name: text, source: 'list', confidence: 0.7 });
      }
    }
  }

  // STRATEGY 5: Extract brand + model patterns from text (expanded list)
  const brandModelPattern = /\b(Apple|Samsung|Sony|LG|Bose|JBL|Anker|Logitech|Razer|Corsair|HyperX|SteelSeries|Ninja|Instant Pot|KitchenAid|Cuisinart|Dyson|iRobot|Roomba|Shark|Vitamix|Breville|De'?Longhi|Keurig|Nespresso|GoPro|Canon|Nikon|Fujifilm|DJI|Ring|Nest|Arlo|Philips|Oral-B|Waterpik|Fitbit|Garmin|Whoop|Oura|Theragun|Hyperice|NordicTrack|Peloton|Bowflex|RENPHO|Wyze|TP-Link|Netgear|Asus|Dell|HP|Lenovo|Microsoft|Google|Amazon|Echo|Kindle|Fire|Roku|Vizio|TCL|Hisense|Sonos|Marshall|Klipsch|Audio-Technica|Shure|Blue|Yeti|Elgato|Western Digital|Seagate|Crucial|Kingston|Sandisk|Intel|AMD|Nvidia|Gigabyte|MSI|EVGA|Zotac|Asrock|Noctua|Be Quiet|Cooler Master|Thermaltake|NZXT|Fractal Design|Lian Li|Phanteks|Corsair|G.Skill|Teamgroup|Patriot|Sabrent|Samsung|Western Digital|Seagate|Crucial|Kingston|Sandisk)\s+([A-Z0-9][a-z0-9]*\s*[\w\-]+(?:\s+[\w\-]+){0,3})/g;
  
  let brandMatch;
  while ((brandMatch = brandModelPattern.exec(html)) !== null) {
    const name = `${brandMatch[1]} ${brandMatch[2]}`.trim();
    if (name.length > 8 && name.length < 80 && !isForbidden(name) && !seenNames.has(name.toLowerCase())) {
      seenNames.add(name.toLowerCase());
      products.push({ asin: '', name, source: 'text', confidence: 0.75 });
    }
  }

  // Sort by confidence (highest first)
  products.sort((a, b) => b.confidence - a.confidence);

  console.log(`[preExtract] Found ${products.length} potential products:`, products.slice(0, 5));
  return products;
};

// ============================================================================
// DYNAMIC PRODUCT-SPECIFIC DESCRIPTION GENERATOR
// ============================================================================

const generateDynamicVerdict = (productName: string, brand: string, category: string, existingVerdict?: string): string => {
  // Use AI verdict if it's good quality (specific, 3 sentences, doesn't start with forbidden words)
  if (existingVerdict && existingVerdict.trim().length > 100) {
    let clean = existingVerdict.trim();
    const lower = clean.toLowerCase();
    const sentences = clean.match(/[^.!?]+[.!?]+/g) || [];
    
    // Check if it's product-specific (contains brand or product name)
    const isSpecific = lower.includes(brand.toLowerCase()) || lower.includes(productName.toLowerCase().split(' ')[0]);
    
    if (sentences.length >= 3 && isSpecific && !lower.startsWith('this ') && !lower.startsWith('the ') && !lower.startsWith('a ')) {
      return sentences.slice(0, 3).join(' ').trim();
    }
  }

  const cleanName = productName.replace(/[^\w\s\-]/g, '').trim();
  const cleanBrand = brand || 'This premium';
  const combined = `${productName} ${brand} ${category}`.toLowerCase();

  // Category-specific dynamic templates
  const templates: Record<string, string> = {
    headphones: `Engineered for audiophiles and professionals who demand studio-quality sound, the ${cleanBrand} ${cleanName} delivers immersive audio with deep bass, crystal-clear highs, and industry-leading noise cancellation. Advanced driver technology and ergonomic design ensure hours of comfortable listening while preserving every detail in your favorite tracks. Trusted by music producers worldwide and backed by ${cleanBrand}'s comprehensive warranty and dedicated audio support.`,
    
    laptop: `Built for professionals and power users who demand desktop-class performance, the ${cleanBrand} ${cleanName} combines cutting-edge processing power with all-day battery life and a stunning display. Blazing-fast SSD storage and generous RAM handle demanding workflows from video editing to software development without breaking a sweat. Trusted by Fortune 500 companies and backed by ${cleanBrand}'s premium support with next-day replacement options.`,
    
    phone: `Designed for users who demand flagship performance and exceptional photography, the ${cleanBrand} ${cleanName} features a pro-grade camera system, lightning-fast processor, and all-day battery in a premium build. Advanced AI optimizes every shot and adapts to your usage patterns while 5G connectivity delivers blazing download speeds anywhere. Backed by ${cleanBrand}'s global warranty network and 24/7 customer support.`,
    
    coffee: `Crafted for coffee connoisseurs who refuse to compromise on their daily brew, the ${cleanBrand} ${cleanName} extracts maximum flavor with precise temperature control and optimal pressure. Programmable settings let you customize strength and timing while premium components ensure consistent results cup after cup. Trusted by certified baristas and backed by ${cleanBrand}'s 2-year comprehensive warranty.`,
    
    kitchen: `Designed for home chefs who demand restaurant-quality results, the ${cleanBrand} ${cleanName} combines professional-grade performance with intuitive controls and effortless cleanup. Premium food-safe materials exceed FDA standards while powerful engineering handles everything from delicate sauces to tough ingredients. Trusted in over 100,000 kitchens and backed by ${cleanBrand}'s comprehensive warranty.`,
    
    fitness: `Engineered for athletes pursuing measurable results, the ${cleanBrand} ${cleanName} delivers gym-quality performance with commercial-grade durability and ergonomic design. Smart tracking and adaptive resistance systems optimize every workout while reinforced construction handles intense daily use. Trusted by certified trainers and backed by ${cleanBrand}'s industry-leading warranty.`,
    
    gaming: `Designed for competitive gamers who demand split-second responsiveness, the ${cleanBrand} ${cleanName} delivers tournament-proven performance with sub-millisecond latency and precision controls. Customizable settings and premium materials provide the competitive edge that separates winners in ranked play. Trusted by professional esports athletes and backed by ${cleanBrand}'s 3-year warranty.`,
    
    outdoor: `Built for adventurers who depend on reliable gear in extreme conditions, the ${cleanBrand} ${cleanName} performs flawlessly from arctic cold to desert heat with military-grade construction. Weather-sealed components and impact-resistant materials survive conditions that destroy inferior equipment. Field-tested by professionals and backed by ${cleanBrand}'s unconditional lifetime guarantee.`,
    
    camera: `Engineered for photographers who demand exceptional image quality, the ${cleanBrand} ${cleanName} captures stunning detail in any lighting with advanced sensor technology and precision optics. Fast autofocus ensures you never miss the shot while 4K video capabilities satisfy professional production needs. Trusted by award-winning photographers and backed by ${cleanBrand}'s professional support program.`,
    
    home: `Crafted for modern homes that demand both style and functionality, the ${cleanBrand} ${cleanName} combines elegant design with exceptional durability and effortless maintenance. Premium materials resist wear and fading while thoughtful engineering ensures years of reliable performance. Backed by ${cleanBrand}'s satisfaction guarantee and thousands of 5-star reviews.`,
    
    beauty: `Formulated for skincare enthusiasts who demand visible results, the ${cleanBrand} ${cleanName} combines clinically-proven ingredients with luxurious textures that absorb quickly. Dermatologist-tested and suitable for all skin types, it addresses multiple concerns while strengthening the skin's natural barrier. Trusted by licensed estheticians and backed by ${cleanBrand}'s 60-day results guarantee.`,
    
    baby: `Designed with infant safety as the absolute priority, the ${cleanBrand} ${cleanName} exceeds international safety standards while delivering the functionality parents need. Hypoallergenic materials and one-handed operation make daily use effortless during those exhausting early months. Pediatrician-recommended and backed by ${cleanBrand}'s comprehensive warranty.`,
    
    pet: `Created for pet parents who treat companions like family, the ${cleanBrand} ${cleanName} combines veterinarian-approved safety with durability that withstands enthusiastic daily use. Non-toxic materials protect paws and teeth while providing enrichment and comfort your pet will love. Trusted by over 50,000 happy pets and backed by ${cleanBrand}'s satisfaction guarantee.`,
    
    tools: `Built for professionals who demand reliability under pressure, the ${cleanBrand} ${cleanName} delivers commercial-grade power and precision that makes quick work of tough jobs. Ergonomic design reduces fatigue while brushless motor technology maximizes runtime and longevity. Trusted on jobsites worldwide and backed by ${cleanBrand}'s 5-year professional warranty.`,
    
    monitor: `Designed for professionals and gamers who demand visual excellence, the ${cleanBrand} ${cleanName} delivers stunning color accuracy with high refresh rates and wide color gamut. Ergonomic adjustability and eye-care technology reduce strain during marathon sessions. Trusted by video editors and esports athletes, backed by ${cleanBrand}'s zero dead pixel guarantee.`,
    
    speaker: `Engineered for music lovers who demand room-filling sound, the ${cleanBrand} ${cleanName} delivers powerful, balanced audio with deep bass and crystal-clear highs in a premium design. Smart connectivity and voice control provide seamless integration with your devices and smart home ecosystem. Trusted by audio engineers and backed by ${cleanBrand}'s 2-year warranty.`,
    
    vacuum: `Designed for homeowners who demand powerful, effortless cleaning, the ${cleanBrand} ${cleanName} delivers exceptional suction with advanced filtration that captures 99.9% of particles. Smart navigation and self-emptying technology handle daily cleaning automatically while you focus on what matters. Trusted in millions of homes and backed by ${cleanBrand}'s comprehensive warranty.`,
    
    default: `Engineered for discerning users who demand excellence, the ${cleanBrand} ${cleanName} delivers professional-grade performance with premium materials and precision engineering. Thoughtful design addresses real-world needs while rigorous quality control ensures long-term reliability. Backed by ${cleanBrand}'s comprehensive warranty and thousands of verified 5-star reviews.`,
  };

  // Detect category
  const categoryKeywords: Record<string, string[]> = {
    headphones: ['headphone', 'earphone', 'earbud', 'airpod', 'audio', 'beats', 'bose', 'sony wh', 'sony wf', 'jabra', 'sennheiser'],
    laptop: ['laptop', 'macbook', 'notebook', 'chromebook', 'thinkpad', 'surface pro', 'xps', 'pavilion'],
    phone: ['phone', 'iphone', 'samsung galaxy', 'pixel', 'oneplus', 'smartphone'],
    coffee: ['coffee', 'espresso', 'keurig', 'nespresso', 'brewer', 'barista', 'latte'],
    kitchen: ['kitchen', 'cookware', 'blender', 'mixer', 'instant pot', 'air fryer', 'knife', 'pan', 'pot', 'ninja', 'cuisinart'],
    fitness: ['fitness', 'gym', 'workout', 'exercise', 'yoga', 'weight', 'treadmill', 'dumbbell', 'peloton', 'bowflex'],
    gaming: ['gaming', 'game', 'controller', 'keyboard', 'mouse', 'headset', 'razer', 'logitech g', 'rgb', 'mechanical'],
    outdoor: ['outdoor', 'camping', 'hiking', 'tent', 'backpack', 'flashlight', 'tactical', 'yeti', 'coleman'],
    camera: ['camera', 'dslr', 'mirrorless', 'canon eos', 'nikon', 'sony alpha', 'gopro', 'fujifilm'],
    home: ['home', 'furniture', 'decor', 'storage', 'bedding', 'pillow', 'mattress', 'roomba', 'robot vacuum'],
    beauty: ['beauty', 'skincare', 'makeup', 'serum', 'cream', 'hair', 'shampoo', 'moisturizer'],
    baby: ['baby', 'infant', 'toddler', 'nursery', 'stroller', 'graco', 'pampers', 'car seat'],
    pet: ['pet', 'dog', 'cat', 'puppy', 'kitten', 'kong', 'purina', 'treat', 'leash', 'collar'],
    tools: ['tool', 'drill', 'saw', 'dewalt', 'milwaukee', 'makita', 'craftsman', 'wrench', 'impact'],
    monitor: ['monitor', 'display', 'screen', '4k', 'ultrawide', 'curved', 'gaming monitor'],
    speaker: ['speaker', 'soundbar', 'subwoofer', 'sonos', 'bose speaker', 'jbl speaker', 'bluetooth speaker'],
    vacuum: ['vacuum', 'roomba', 'dyson', 'shark', 'bissell', 'cordless vacuum', 'robot vacuum'],
  };

  let selectedCategory = 'default';
  for (const [cat, keywords] of Object.entries(categoryKeywords)) {
    if (keywords.some(kw => combined.includes(kw))) {
      selectedCategory = cat;
      break;
    }
  }

  return templates[selectedCategory] || templates.default;
};

// ============================================================================
// ULTRA-RELIABLE AI ANALYSIS ENGINE
// ============================================================================

export const analyzeContentAndFindProduct = async (
  title: string,
  htmlContent: string,
  config: AppConfig
): Promise<{
  detectedProducts: ProductDetails[];
  product: ProductDetails | null;
  comparison?: ComparisonData;
  carousel?: CarouselData;
}> => {
  console.log('[SCAN] Starting ultra-reliable product detection...');
  console.log('[SCAN] Title:', title);
  console.log('[SCAN] Content length:', htmlContent.length);

  // ═══════════════════════════════════════════════════════════════════════════
  // STEP 1: PRE-EXTRACT PRODUCTS FROM HTML (Regex + Pattern Matching)
  // ═══════════════════════════════════════════════════════════════════════════
  
  const preExtracted = preExtractAmazonProducts(htmlContent);
  console.log(`[SCAN] Pre-extracted ${preExtracted.length} products from HTML`);

  // If we found ASINs, we can guarantee those products exist
  const asinsFound = preExtracted.filter(p => p.asin).map(p => p.asin);
  const namesFound = preExtracted.filter(p => p.name && !p.asin).map(p => p.name);
  
  console.log(`[SCAN] ASINs found: ${asinsFound.length}`, asinsFound.slice(0, 5));
  console.log(`[SCAN] Names found: ${namesFound.length}`, namesFound.slice(0, 5));

  // ═══════════════════════════════════════════════════════════════════════════
  // STEP 2: AI ENHANCEMENT (Optional - improves results but not required)
  // ═══════════════════════════════════════════════════════════════════════════

  const apiKey = process.env.API_KEY;
  let aiProducts: any[] = [];

  if (apiKey) {
    try {
      const ai = new GoogleGenAI({ apiKey });
      
      // Clean content for AI
      const context = (htmlContent || '')
        .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
        .replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, '')
        .replace(/<[^>]*>/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()
        .substring(0, 20000);

      const systemPrompt = `TASK: You are a world-class product extraction engine. Your goal is to identify ONLY the actual products being reviewed, compared, or discussed as primary subjects in the provided blog post.

STRICT RULES:
1. ONLY extract physical products that can be purchased on Amazon.
2. IGNORE generic mentions, accessories (unless they are the main topic), and non-product entities.
3. IGNORE navigation links, site meta-text, and boilerplate.
4. If the post is a "Best [Category]" list, extract each item in the list.
5. If the post is a single product review, extract only that product.
6. For each product, provide a high-confidence "productName" and "brand".
7. Ensure the "verdict" is specific and high-quality.

HINTS - Products already detected in this page:
- ASINs found: ${asinsFound.join(', ') || 'none'}
- Product names found: ${namesFound.slice(0, 10).join(', ') || 'none'}

OUTPUT FORMAT:
Return a JSON object with a "products" array. Each product must have:
- productName: The full, precise name of the product.
- brand: The manufacturer or brand name.
- category: A specific category (e.g., "Noise Cancelling Headphones").
- verdict: EXACTLY 3 sentences. 
  Sentence 1: "[Power word] for [user type], the [Brand] [Product] [main benefit]"
  Sentence 2: "[Key feature with specific detail], [performance claim]"
  Sentence 3: "[Trust signal], backed by [warranty/reviews]"
- confidence: A number from 0.0 to 1.0 indicating how certain you are this is a primary product of the post.

Return JSON: {"products": [...]}`;

      const response = await ai.models.generateContent({
        model: config.aiModel || 'gemini-2.0-flash',
        contents: [{ role: 'user', parts: [{ text: `Title: "${title}"\n\nContent: ${context}` }] }],
        config: {
          systemInstruction: systemPrompt,
          responseMimeType: 'application/json',
        },
      });

      const data = cleanAndParseJSON(response?.text || '');
      // Filter by confidence
      aiProducts = (data.products || []).filter((p: any) => (p.confidence || 0) >= 0.7);
      console.log(`[SCAN] AI found ${aiProducts.length} high-confidence products`);
      
    } catch (e: any) {
      console.warn('[SCAN] AI enhancement failed, using pre-extracted only:', e.message);
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // STEP 3: MERGE & DEDUPLICATE PRODUCTS
  // ═══════════════════════════════════════════════════════════════════════════

  const allProducts: Map<string, { asin: string; name: string; brand: string; category: string; verdict: string }> = new Map();

  // Helper to normalize names for better deduplication
  const normalizeForMap = (name: string) => name.toLowerCase().replace(/[^a-z0-9]/g, '').substring(0, 40);

  // Add pre-extracted products (highest priority - from actual Amazon links)
  for (const p of preExtracted) {
    const key = p.asin || normalizeForMap(p.name);
    if (!allProducts.has(key)) {
      allProducts.set(key, {
        asin: p.asin,
        name: p.name,
        brand: '',
        category: '',
        verdict: '',
      });
    }
  }

  // Add AI products (merge data if exists, add new if not)
  for (const p of aiProducts) {
    if (!p.productName) continue;
    
    const key = normalizeForMap(p.productName);
    const existing = allProducts.get(key);
    
    if (existing) {
      // Merge AI data into existing
      existing.name = existing.name || p.productName;
      existing.brand = existing.brand || p.brand || '';
      existing.category = existing.category || p.category || '';
      existing.verdict = existing.verdict || p.verdict || '';
    } else {
      // Check if this matches any ASIN entry by name similarity (more robust)
      let matched = false;
      const pNameLower = p.productName.toLowerCase();
      
      for (const [_, v] of allProducts) {
        if (v.asin && (!v.name || v.name.length < 10)) {
          // If we have an ASIN but no good name, and AI found a name that might match
          // (Simple heuristic: if brand is in the name or name is in the AI name)
          if (pNameLower.includes(v.asin.toLowerCase()) || (v.name && pNameLower.includes(v.name.toLowerCase()))) {
            v.name = p.productName;
            v.brand = p.brand || '';
            v.category = p.category || '';
            v.verdict = p.verdict || '';
            matched = true;
            break;
          }
        }
      }
      
      if (!matched) {
        allProducts.set(key, {
          asin: '',
          name: p.productName,
          brand: p.brand || '',
          category: p.category || '',
          verdict: p.verdict || '',
        });
      }
    }
  }

  console.log(`[SCAN] Total merged products: ${allProducts.size}`);

  // ═══════════════════════════════════════════════════════════════════════════
  // STEP 4: LOOKUP AMAZON DATA & BUILD FINAL PRODUCTS
  // ═══════════════════════════════════════════════════════════════════════════

  const processed: ProductDetails[] = [];
  let idx = 0;

  for (const [_, product] of allProducts) {
    if (idx >= CONFIG.AI.MAX_PRODUCTS_PER_SCAN) break;

    try {
      // Search Amazon for product data
      const searchQuery = product.asin || product.name;
      if (!searchQuery) continue;

      const amz = await searchAmazonProduct(searchQuery, config.serpApiKey || '');
      
      // Skip if we couldn't find any data
      if (!amz.title && !product.name) continue;

      const finalName = amz.title || product.name;
      const finalBrand = amz.brand || product.brand || '';
      const finalCategory = product.category || 'Product';

      // Generate dynamic product-specific description
      const dynamicVerdict = generateDynamicVerdict(
        finalName,
        finalBrand,
        finalCategory,
        product.verdict
      );

      processed.push({
        id: crypto.randomUUID?.() || `${Date.now()}-${idx}-${Math.random().toString(36).substr(2, 5)}`,
        asin: amz.asin || product.asin || '',
        title: finalName.substring(0, 80),
        brand: finalBrand,
        category: finalCategory,
        price: amz.price || 'Check Price',
        imageUrl: amz.imageUrl || 'https://via.placeholder.com/800x800.png?text=Product',
        rating: amz.rating || 4.5,
        reviewCount: amz.reviewCount || 1000,
        prime: amz.prime ?? true,
        verdict: dynamicVerdict,
        evidenceClaims: [],
        faqs: [],
        entities: [],
        specs: {},
        insertionIndex: -1,
        deploymentMode: 'ELITE_BENTO' as DeploymentMode,
      });

      idx++;
      console.log(`[SCAN] Added product ${idx}: ${finalName}`);
      
    } catch (e) {
      console.warn('[SCAN] Error processing product:', e);
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // STEP 5: CACHE & RETURN
  // ═══════════════════════════════════════════════════════════════════════════

  console.log(`[SCAN] COMPLETE - Found ${processed.length} products`);

  let carousel: CarouselData | undefined = undefined;
  if (processed.length >= 4) {
    carousel = {
      title: `Top Rated ${processed[0].category || 'Products'}`,
      productIds: processed.slice(0, 8).map(p => p.id)
    };
  }

  if (processed.length > 0) {
    const contentHash = generateContentHash(title, htmlContent.length);
    IntelligenceCache.setAnalysis(contentHash, { products: processed, comparison: undefined, carousel });
  }

  return {
    detectedProducts: processed,
    product: processed[0] || null,
    comparison: undefined,
    carousel,
  };
};


// ============================================================================
// CONTENT MANIPULATION
// ============================================================================

export const splitContentIntoBlocks = (html: string): string[] => {
  if (!html) return [];

  const parts = html.split(/(<!-- \/?wp:.*? -->)/g).filter(p => p !== undefined && p !== '');
  const blocks: string[] = [];
  let current = '';

  for (const part of parts) {
    if (part.startsWith('<!-- wp:')) {
      if (current.trim()) blocks.push(current);
      current = part;
    } else if (part.startsWith('<!-- /wp:')) {
      current += part;
      blocks.push(current);
      current = '';
    } else {
      current += part;
    }
  }

  if (current.trim()) blocks.push(current);

  // Fallback: Split by paragraphs/headings if no WP blocks found
  if (blocks.length < 2) {
    return html
      .split(/<\/p>|(?=<h[1-6]>)/i)
      .filter(Boolean)
      .map(s => (s.trim().endsWith('</p>') ? s : s + '</p>'));
  }

  return blocks;
};

export const insertIntoContent = (
  html: string, 
  products: ProductDetails[], 
  config: AppConfig
): string => {
  // Clean existing product boxes
  let clean = (html || '').replace(
    /<!-- wp:html -->[\s\S]*?<!-- \/wp:html -->/g,
    (match) => {
      const isProductBox = /s-box|t-link-box|comp-table|auth-v|tact-v/i.test(match);
      return isProductBox ? '' : match;
    }
  );

  const blocks = splitContentIntoBlocks(clean);
  const output = [...blocks];

  // Sort products by insertion index (descending to preserve indices)
  const sorted = [...products]
    .filter(p => p.insertionIndex !== -1)
    .sort((a, b) => b.insertionIndex - a.insertionIndex);

  for (const product of sorted) {
    const box = generateProductBoxHtml(product, config.amazonTag, product.deploymentMode);
    output.splice(Math.min(product.insertionIndex, output.length), 0, box);
  }

  return output.join('\n\n');
};

// ============================================================================
// AMAZON PRODUCT SEARCH
// ============================================================================

export const searchAmazonProduct = async (
  query: string, 
  apiKey: string
): Promise<Partial<ProductDetails>> => {
  if (!apiKey) {
    return { title: query, price: 'Check Price' };
  }

  // Check cache first
  const productsCache = IntelligenceCache.getProducts();
  const existing = Object.values(productsCache).find(
    p =>
      p.title.toLowerCase().includes(query.toLowerCase()) ||
      query.toLowerCase().includes(p.title.toLowerCase())
  );

  if (existing?.imageUrl && !existing.imageUrl.includes('placeholder')) {
    return existing;
  }

  try {
    // Search for product
    const serpApiUrl = `https://serpapi.com/search.json?engine=amazon&k=${encodeURIComponent(query)}&api_key=${apiKey}`;
    const searchResponse = await fetchWithProxy(serpApiUrl);
    const searchData = JSON.parse(searchResponse);

    const firstResult = searchData.organic_results?.find((r: any) => r.asin) || 
                        searchData.organic_results?.[0];

    if (!firstResult?.asin) {
      return { title: query };
    }

    // Get product details
    const productApiUrl = `https://serpapi.com/search.json?engine=amazon_product&asin=${firstResult.asin}&api_key=${apiKey}`;
    const detailResponse = await fetchWithProxy(productApiUrl);
    const detailData = JSON.parse(detailResponse);

    const product = detailData.product_results || {};

    // Extract best image
    let finalImage = '';
    if (product.images?.length > 0) {
      finalImage = typeof product.images[0] === 'string' 
        ? product.images[0] 
        : product.images[0].link;
    } else if (product.images_flat?.length > 0) {
      finalImage = product.images_flat[0];
    } else if (product.main_image?.link) {
      finalImage = product.main_image.link;
    } else {
      finalImage = firstResult.thumbnail || '';
    }

    // Upgrade image quality
    if (finalImage) {
      finalImage = finalImage.replace(/\._AC_.*_\./, '._AC_SL1500_.');
    }

    const result: Partial<ProductDetails> = {
      asin: product.asin || firstResult.asin,
      title: product.title || firstResult.title,
      brand: product.brand || '',
      price: product.price || firstResult.price || 'Check Price',
      imageUrl: finalImage,
      rating: product.rating || firstResult.rating || 4.9,
      reviewCount: product.reviews_count || firstResult.reviews_count || 1000,
      prime: product.prime || firstResult.prime || false,
    };

    // Cache the result
    if (result.asin) {
      IntelligenceCache.setProduct(result.asin, result as ProductDetails);
    }

    return result;
  } catch (error) {
    console.warn(`[searchAmazonProduct] Lookup failed for "${query}":`, error);
    return { title: query, price: 'Check Price' };
  }
};

// ============================================================================
// WORDPRESS API
// ============================================================================

export const pushToWordPress = async (
  config: AppConfig, 
  postId: number, 
  content: string
): Promise<string> => {
  const url = (config.wpUrl || '').replace(/\/$/, '');
  const auth = btoa(`${config.wpUser || ''}:${config.wpAppPassword || ''}`);
  const endpoint = `${url}/wp-json/wp/v2/posts/${postId}`;

  const headers = {
    'Content-Type': 'application/json',
    'Authorization': `Basic ${auth}`,
    'User-Agent': 'AmzPilot/80.0',
  };

  const body = JSON.stringify({ content });

  const attemptFetch = async (targetUrl: string, useProxy = false): Promise<any> => {
    const response = await fetch(targetUrl, {
      method: 'POST',
      headers,
      body,
      signal: AbortSignal.timeout(CONFIG.NETWORK.PUSH_TIMEOUT_MS),
    });

    if (!response.ok) {
      const errorJson = await response.json().catch(() => null);
      const errorMessage = errorJson?.message || errorJson?.code || response.statusText;
      throw new WordPressAPIError(
        `${useProxy ? 'Proxy' : 'Direct'} Error [${response.status}]: ${errorMessage}`,
        endpoint,
        response.status
      );
    }

    return response.json();
  };

  // Strategy 1: Direct
  try {
    const data = await attemptFetch(endpoint);
    return data.link || `${url}/?p=${postId}`;
  } catch (directError: any) {
    console.warn(`[pushToWordPress] Direct failed: ${directError.message}, trying proxy...`);

    // Strategy 2: Proxy
    try {
      const proxyUrl = `https://corsproxy.io/?${encodeURIComponent(endpoint)}`;
      const data = await attemptFetch(proxyUrl, true);
      return data.link || `${url}/?p=${postId}`;
    } catch (proxyError: any) {
      throw new WordPressAPIError(
        `Upload Failed. Direct: ${directError.message}. Proxy: ${proxyError.message}`,
        endpoint
      );
    }
  }
};

// ============================================================================
// POST PRIORITY CALCULATION
// ============================================================================

export const calculatePostPriority = (
  title: string, 
  html: string
): { priority: PostPriority; type: PostType; status: BlogPost['monetizationStatus'] } => {
  const t = (title || '').toLowerCase();
  const hasAffiliate = /amazon\.com\/dp\/|amzn\.to\/|tag=|s-box|t-link-box|auth-v|tact-v/i.test(html);

  // Determine post type
  let type: PostType = 'info';
  if (t.includes('review') || t.includes(' vs ') || t.includes('compare') || t.includes('comparison')) {
    type = 'review';
  } else if (t.includes('best ') || t.includes('top ') || t.includes(' list')) {
    type = 'listicle';
  }

  // Determine priority
  let priority: PostPriority = 'low';
  if (type === 'review' || type === 'listicle') {
    priority = hasAffiliate ? 'medium' : 'critical';
  } else if (!hasAffiliate && html.length > 1000) {
    priority = 'high';
  }

  return {
    priority,
    type,
    status: hasAffiliate ? 'monetized' : 'opportunity',
  };
};

// ============================================================================
// CONNECTION TESTING
// ============================================================================

export const testConnection = async (
  config: AppConfig
): Promise<{ success: boolean; message: string }> => {
  const wpUrl = (config.wpUrl || '').replace(/\/$/, '');
  const auth = btoa(`${config.wpUser || ''}:${config.wpAppPassword || ''}`);
  const headers = { Authorization: `Basic ${auth}` };
  const endpoint = `${wpUrl}/wp-json/wp/v2/users/me`;

  const tryFetch = async (url: string): Promise<Response> => {
    const res = await fetch(url, { headers, signal: AbortSignal.timeout(8000) });
    if (!res.ok) throw new Error(res.statusText);
    return res;
  };

  try {
    await tryFetch(endpoint);
    return { success: true, message: 'Protocol Handshake Success!' };
  } catch {
    // Retry with proxy
    try {
      const proxyUrl = `https://corsproxy.io/?${encodeURIComponent(endpoint)}`;
      await tryFetch(proxyUrl);
      return { success: true, message: 'Handshake Success (via Proxy)' };
    } catch {
      return { success: false, message: 'Host Connection Blocked (Check CORS/Auth)' };
    }
  }
};

// ============================================================================
// CONCURRENT EXECUTION UTILITY
// ============================================================================

export const runConcurrent = async <T>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<void>
): Promise<void> => {
  const queue = [...items];
  const workers = Array(Math.min(limit, items.length))
    .fill(null)
    .map(async () => {
      while (queue.length > 0) {
        const item = queue.shift();
        if (item) {
          await fn(item).catch(console.error);
        }
      }
    });

  await Promise.all(workers);
};

// ============================================================================
// EXPORTS SUMMARY
// ============================================================================

export {
  CONFIG,
  isValidContentUrl,
  normalizeUrl,
  extractTitleFromUrl,
  generateContentHash,
  sleep,
};
