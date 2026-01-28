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
  FAQItem 
} from './types';
import { GoogleGenAI, Type } from '@google/genai';

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

interface CacheMetadata {
  version: string;
  lastCleanup: number;
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
.amz-tac-v3{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;max-width:950px;margin:2.5rem auto;position:relative}
.amz-tac-card{background:linear-gradient(to right,#fff,#fff,#fafafa);border:1px solid rgba(226,232,240,0.8);border-radius:28px;padding:1.25rem 1.75rem;box-shadow:0 20px 60px -15px rgba(0,0,0,0.08);display:flex;flex-wrap:wrap;align-items:center;gap:1.5rem;transition:all 0.5s;position:relative;overflow:hidden}
.amz-tac-card:hover{box-shadow:0 30px 80px -20px rgba(0,0,0,0.15);border-color:#93c5fd}
.amz-tac-accent{position:absolute;top:0;left:0;width:6px;height:100%;background:linear-gradient(to bottom,#3b82f6,#8b5cf6,#3b82f6);border-radius:28px 0 0 28px}
.amz-tac-badge{position:absolute;top:-4px;right:-4px;background:linear-gradient(to right,#f59e0b,#f97316);color:#fff;font-size:8px;font-weight:900;text-transform:uppercase;letter-spacing:2px;padding:6px 16px;border-radius:0 26px 0 16px;box-shadow:0 4px 12px rgba(249,115,22,0.3)}
.amz-tac-img{width:100px;height:100px;background:linear-gradient(to br,#f8fafc,#fff);border-radius:16px;display:flex;align-items:center;justify-content:center;border:1px solid #f1f5f9;padding:12px;flex-shrink:0;box-shadow:inset 0 2px 4px rgba(0,0,0,0.02)}
.amz-tac-img img{max-width:100%;max-height:100%;object-fit:contain;mix-blend-mode:multiply}
.amz-tac-info{flex:1;min-width:200px;text-align:left}
.amz-tac-meta{display:flex;align-items:center;gap:12px;flex-wrap:wrap;margin-bottom:8px}
.amz-tac-label{font-size:10px;font-weight:900;text-transform:uppercase;letter-spacing:2px;color:#2563eb;background:#eff6ff;padding:4px 12px;border-radius:20px;border:1px solid #dbeafe}
.amz-tac-stars{color:#fbbf24;font-size:13px}
.amz-tac-reviews{font-size:10px;font-weight:700;color:#94a3b8}
.amz-tac-title{font-size:1.125rem;font-weight:800;color:#0f172a;line-height:1.3;margin:0 0 6px}
.amz-tac-desc{font-size:13px;color:#64748b;margin:0;line-height:1.5}
.amz-tac-action{flex-shrink:0;text-align:center;display:flex;flex-direction:column;gap:12px}
.amz-tac-price-label{font-size:9px;text-transform:uppercase;letter-spacing:2px;color:#94a3b8;font-weight:700}
.amz-tac-price{font-size:1.75rem;font-weight:900;color:#0f172a;letter-spacing:-1px}
.amz-tac-btn{display:inline-flex;align-items:center;justify-content:center;gap:8px;background:linear-gradient(to right,#0f172a,#1e293b);color:#fff!important;text-decoration:none!important;padding:14px 28px;border-radius:14px;font-size:11px;font-weight:900;text-transform:uppercase;letter-spacing:2px;transition:all 0.3s;box-shadow:0 10px 30px -10px rgba(15,23,42,0.4)}
.amz-tac-btn:hover{background:linear-gradient(to right,#2563eb,#3b82f6);transform:translateY(-2px);box-shadow:0 15px 40px -10px rgba(37,99,235,0.4)}
@media(max-width:768px){.amz-tac-card{flex-direction:column;text-align:center;padding:2rem}.amz-tac-info{text-align:center}.amz-tac-meta{justify-content:center}.amz-tac-action{width:100%}.amz-tac-btn{width:100%}}
</style>
<div class="amz-tac-v3">
  <div class="amz-tac-card">
    <div class="amz-tac-accent"></div>
    <div class="amz-tac-badge">★ Top Rated</div>
    <div class="amz-tac-img">
      <img src="${escapeHtml(product.imageUrl)}" alt="${escapeHtml(product.title)}" loading="lazy" />
    </div>
    <div class="amz-tac-info">
      <div class="amz-tac-meta">
        <span class="amz-tac-label">Editor's Choice</span>
        <span class="amz-tac-stars">${'★'.repeat(stars)}${'☆'.repeat(5-stars)}</span>
        <span class="amz-tac-reviews">(${product.reviewCount || '2.4k'})</span>
      </div>
      <h3 class="amz-tac-title">${escapeHtml(product.title)}</h3>
      <p class="amz-tac-desc">${escapeHtml(product.verdict || 'Premium selection backed by verified reviews.')}</p>
    </div>
    <div class="amz-tac-action">
      <div>
        <span class="amz-tac-price-label">Best Price</span>
        <div class="amz-tac-price">${escapeHtml(product.price)}</div>
      </div>
      <a href="${link}" target="_blank" rel="nofollow sponsored noopener" class="amz-tac-btn">
        View Deal <span>→</span>
      </a>
    </div>
  </div>
</div>
<!-- /wp:html -->`;
  }

  // ELITE BENTO Mode (Full Product Card)
  const bulletsHtml = bullets.map(b => `
    <div class="amz-bullet">
      <div class="amz-bullet-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><polyline points="20 6 9 17 4 12"/></svg></div>
      <span>${escapeHtml(b)}</span>
    </div>
  `).join('');

  const faqsHtml = faqs.map((f, i) => `
    <div class="amz-faq">
      <div class="amz-faq-num">Q${i+1}</div>
      <div class="amz-faq-content">
        <h4>${escapeHtml(f.question)}</h4>
        <p>${escapeHtml(f.answer)}</p>
      </div>
    </div>
  `).join('');

  return `<!-- wp:html -->
<style>
.amz-elite-v3{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;max-width:1100px;margin:4rem auto;position:relative}
.amz-elite-card{background:#fff;border-radius:40px;border:1px solid rgba(226,232,240,0.8);box-shadow:0 50px 100px -30px rgba(0,0,0,0.1);overflow:hidden;transition:all 0.7s}
.amz-elite-card:hover{box-shadow:0 60px 120px -25px rgba(0,0,0,0.18);border-color:#cbd5e1}
.amz-elite-badge{position:absolute;top:0;right:0;z-index:30;background:linear-gradient(to right,#0f172a,#1e293b,#0f172a);color:#fff;font-size:10px;font-weight:900;text-transform:uppercase;letter-spacing:3px;padding:12px 32px;border-bottom-left-radius:32px;display:flex;align-items:center;gap:8px}
.amz-elite-badge svg{width:14px;height:14px;color:#fbbf24}
.amz-elite-grid{display:flex;flex-direction:column}
@media(min-width:1024px){.amz-elite-grid{flex-direction:row}}
.amz-elite-visual{background:linear-gradient(to bottom right,rgba(248,250,252,0.8),#fff,rgba(248,250,252,0.5));padding:2.5rem;display:flex;flex-direction:column;align-items:center;justify-content:center;position:relative;border-bottom:1px solid #f1f5f9}
@media(min-width:1024px){.amz-elite-visual{width:42%;border-bottom:0;border-right:1px solid #f1f5f9;padding:3.5rem}}
.amz-elite-rating{position:absolute;top:2rem;left:2rem;background:rgba(255,255,255,0.9);backdrop-filter:blur(12px);border:1px solid #f1f5f9;box-shadow:0 10px 30px -10px rgba(0,0,0,0.1);padding:10px 16px;border-radius:16px;display:flex;align-items:center;gap:12px}
.amz-elite-rating-stars{color:#fbbf24;font-size:14px}
.amz-elite-rating-count{font-size:11px;font-weight:700;color:#64748b}
.amz-elite-img-wrap{position:relative;width:100%;display:flex;align-items:center;justify-content:center;padding:3rem 0}
.amz-elite-img-wrap::before{content:'';position:absolute;inset:15%;border:2px dashed rgba(226,232,240,0.5);border-radius:50%;opacity:0;transition:opacity 0.5s}
.amz-elite-card:hover .amz-elite-img-wrap::before{opacity:1}
.amz-elite-img{max-width:100%;max-height:340px;object-fit:contain;filter:drop-shadow(0 25px 50px rgba(0,0,0,0.15));transition:all 0.7s}
.amz-elite-card:hover .amz-elite-img{transform:scale(1.1) rotate(-3deg)}
.amz-elite-brand{display:flex;align-items:center;gap:8px;margin-top:1.5rem}
.amz-elite-brand::before,.amz-elite-brand::after{content:'';width:32px;height:1px;background:linear-gradient(to right,transparent,#cbd5e1)}
.amz-elite-brand span{font-size:10px;font-weight:900;text-transform:uppercase;letter-spacing:4px;color:#94a3b8}
.amz-elite-content{padding:2.5rem;display:flex;flex-direction:column;justify-content:space-between;background:#fff}
@media(min-width:1024px){.amz-elite-content{width:58%;padding:3.5rem}}
.amz-elite-header{margin-bottom:2rem}
.amz-elite-cats{display:flex;flex-wrap:wrap;align-items:center;gap:12px;margin-bottom:1rem}
.amz-elite-cat{display:inline-flex;align-items:center;gap:6px;background:linear-gradient(to right,#eff6ff,#eef2ff);color:#1d4ed8;font-size:10px;font-weight:900;text-transform:uppercase;letter-spacing:2px;padding:8px 16px;border-radius:20px;border:1px solid rgba(191,219,254,0.8)}
.amz-elite-cat::before{content:'';width:6px;height:6px;background:#3b82f6;border-radius:50%;animation:pulse 2s infinite}
.amz-elite-ship{font-size:10px;font-weight:700;color:#16a34a;background:#f0fdf4;padding:6px 12px;border-radius:20px;border:1px solid #bbf7d0}
.amz-elite-title{font-size:2rem;font-weight:900;color:#0f172a;line-height:1.1;letter-spacing:-0.5px;margin:0 0 1.5rem}
@media(min-width:1024px){.amz-elite-title{font-size:2.5rem}}
.amz-elite-quote{position:relative;padding:1rem 0 1rem 1.5rem;border-left:4px solid #e2e8f0;margin-bottom:2rem;background:linear-gradient(to right,rgba(248,250,252,0.8),transparent);border-radius:0 12px 12px 0}
.amz-elite-quote::before{content:'"';position:absolute;left:-.25rem;top:-.5rem;font-size:4rem;color:#dbeafe;font-family:serif;line-height:1}
.amz-elite-quote p{font-size:1rem;font-weight:500;color:#475569;font-style:italic;line-height:1.7;margin:0}
@media(min-width:1024px){.amz-elite-quote p{font-size:1.125rem}}
.amz-bullets{display:grid;grid-template-columns:1fr;gap:12px;margin-bottom:2rem}
@media(min-width:640px){.amz-bullets{grid-template-columns:1fr 1fr}}
.amz-bullet{display:flex;align-items:flex-start;gap:12px;padding:1rem;background:linear-gradient(to bottom right,#f8fafc,#fff);border-radius:16px;border:1px solid #f1f5f9;transition:all 0.3s}
.amz-bullet:hover{border-color:#bbf7d0;box-shadow:0 10px 30px -10px rgba(0,0,0,0.05)}
.amz-bullet-icon{width:32px;height:32px;border-radius:12px;background:linear-gradient(to bottom right,#22c55e,#16a34a);display:flex;align-items:center;justify-content:center;flex-shrink:0;box-shadow:0 8px 20px -8px rgba(34,197,94,0.4)}
.amz-bullet-icon svg{width:14px;height:14px;color:#fff}
.amz-bullet span{font-size:13px;font-weight:600;color:#334155;line-height:1.4;padding-top:4px}
.amz-elite-action{margin-top:auto;padding-top:2rem;border-top:1px solid #f1f5f9;display:flex;flex-wrap:wrap;align-items:center;justify-content:space-between;gap:1.5rem}
.amz-elite-price-wrap{text-align:left}
.amz-elite-price-meta{display:flex;align-items:center;gap:8px;margin-bottom:8px}
.amz-elite-price-label{font-size:10px;font-weight:900;text-transform:uppercase;letter-spacing:3px;color:#94a3b8}
.amz-elite-price-save{font-size:9px;font-weight:700;color:#16a34a;background:#f0fdf4;padding:4px 8px;border-radius:20px}
.amz-elite-price{font-size:3rem;font-weight:900;color:#0f172a;letter-spacing:-2px;line-height:1}
@media(min-width:1024px){.amz-elite-price{font-size:3.5rem}}
.amz-elite-btn-wrap{position:relative}
.amz-elite-btn-glow{position:absolute;inset:0;background:linear-gradient(to right,#2563eb,#3b82f6,#2563eb);border-radius:16px;filter:blur(8px);opacity:0.6}
.amz-elite-btn{position:relative;display:inline-flex;align-items:center;justify-content:center;gap:16px;background:linear-gradient(to right,#0f172a,#1e293b,#0f172a);color:#fff!important;text-decoration:none!important;padding:1.5rem 3rem;border-radius:16px;font-size:14px;font-weight:900;text-transform:uppercase;letter-spacing:3px;box-shadow:0 20px 40px -15px rgba(15,23,42,0.5);transition:all 0.3s}
.amz-elite-btn:hover{background:linear-gradient(to right,#2563eb,#3b82f6,#2563eb);transform:translateY(-2px);box-shadow:0 25px 50px -15px rgba(37,99,235,0.5)}
.amz-elite-btn-icon{width:40px;height:40px;border-radius:50%;background:rgba(255,255,255,0.1);display:flex;align-items:center;justify-content:center}
.amz-elite-faqs{background:linear-gradient(to bottom,rgba(248,250,252,0.8),rgba(241,245,249,0.5));border-top:1px solid rgba(226,232,240,0.8);padding:2rem}
@media(min-width:1024px){.amz-elite-faqs{padding:3rem}}
.amz-elite-faqs-header{display:flex;align-items:center;justify-content:space-between;margin-bottom:2rem}
.amz-elite-faqs-title{display:flex;align-items:center;gap:16px}
.amz-elite-faqs-icon{width:48px;height:48px;border-radius:16px;background:linear-gradient(to bottom right,#8b5cf6,#6366f1);display:flex;align-items:center;justify-content:center;box-shadow:0 10px 30px -10px rgba(139,92,246,0.4)}
.amz-elite-faqs-icon svg{width:20px;height:20px;color:#fff}
.amz-elite-faqs-text h3{font-size:1.125rem;font-weight:900;color:#0f172a;margin:0 0 4px}
.amz-elite-faqs-text p{font-size:12px;color:#64748b;margin:0}
.amz-elite-faqs-count{font-size:9px;font-weight:700;text-transform:uppercase;letter-spacing:2px;color:#94a3b8;background:#fff;padding:8px 16px;border-radius:20px;border:1px solid #e2e8f0}
.amz-elite-faqs-grid{display:grid;gap:1rem}
@media(min-width:768px){.amz-elite-faqs-grid{grid-template-columns:1fr 1fr}}
.amz-faq{background:#fff;border-radius:16px;border:1px solid #f1f5f9;padding:1.25rem;display:flex;align-items:flex-start;gap:1rem;transition:all 0.3s}
.amz-faq:hover{border-color:#c7d2fe;box-shadow:0 10px 30px -10px rgba(99,102,241,0.1)}
.amz-faq-num{width:32px;height:32px;border-radius:10px;background:linear-gradient(to bottom right,#3b82f6,#6366f1);display:flex;align-items:center;justify-content:center;flex-shrink:0;font-size:10px;font-weight:900;color:#fff}
.amz-faq-content h4{font-size:13px;font-weight:800;color:#0f172a;margin:0 0 8px;line-height:1.4}
.amz-faq-content p{font-size:12px;color:#64748b;margin:0;line-height:1.6;padding-left:12px;border-left:2px solid #dbeafe}
.amz-elite-trust{margin-top:1.5rem;display:flex;flex-wrap:wrap;justify-content:center;gap:1.5rem}
.amz-elite-trust-item{display:flex;align-items:center;gap:8px;color:#94a3b8;font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:1px;transition:color 0.3s}
.amz-elite-trust-item:hover{color:#64748b}
.amz-elite-trust-item svg{width:14px;height:14px}
@keyframes pulse{0%,100%{opacity:1}50%{opacity:0.5}}
</style>
<div class="amz-elite-v3">
  <div class="amz-elite-card">
    <div class="amz-elite-badge">
      <svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"/></svg>
      Editor's Choice
    </div>
    <div class="amz-elite-grid">
      <div class="amz-elite-visual">
        <div class="amz-elite-rating">
          <span class="amz-elite-rating-stars">${'★'.repeat(stars)}${'☆'.repeat(5-stars)}</span>
          <span class="amz-elite-rating-count">${product.reviewCount || '2.4k'} reviews</span>
        </div>
        <a href="${link}" target="_blank" rel="nofollow sponsored noopener" class="amz-elite-img-wrap">
          <img src="${escapeHtml(product.imageUrl)}" alt="${escapeHtml(product.title)}" class="amz-elite-img" loading="lazy" />
        </a>
        <div class="amz-elite-brand">
          <span>Official ${escapeHtml(product.brand || 'Brand')} Product</span>
        </div>
      </div>
      <div class="amz-elite-content">
        <div class="amz-elite-header">
          <div class="amz-elite-cats">
            <span class="amz-elite-cat">${escapeHtml(product.category || 'Premium Selection')}</span>
            ${product.prime ? '<span class="amz-elite-ship">✓ Free Delivery</span>' : ''}
          </div>
          <h2 class="amz-elite-title">${escapeHtml(product.title)}</h2>
          <div class="amz-elite-quote">
            <p>${escapeHtml(product.verdict || 'Engineered for excellence. This product represents the pinnacle of design innovation and functional superiority.')}</p>
          </div>
          <div class="amz-bullets">${bulletsHtml}</div>
        </div>
        <div class="amz-elite-action">
          <div class="amz-elite-price-wrap">
            <div class="amz-elite-price-meta">
              <span class="amz-elite-price-label">Best Price</span>
              <span class="amz-elite-price-save">Save Today</span>
            </div>
            <div class="amz-elite-price">${escapeHtml(product.price)}</div>
          </div>
          <div class="amz-elite-btn-wrap">
            <div class="amz-elite-btn-glow"></div>
            <a href="${link}" target="_blank" rel="nofollow sponsored noopener" class="amz-elite-btn">
              <span>Check Price</span>
              <div class="amz-elite-btn-icon">→</div>
            </a>
          </div>
        </div>
      </div>
    </div>
    <div class="amz-elite-faqs">
      <div class="amz-elite-faqs-header">
        <div class="amz-elite-faqs-title">
          <div class="amz-elite-faqs-icon">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>
          </div>
          <div class="amz-elite-faqs-text">
            <h3>Frequently Asked Questions</h3>
            <p>Quick answers about this product</p>
          </div>
        </div>
        <span class="amz-elite-faqs-count">${faqs.length} FAQs</span>
      </div>
      <div class="amz-elite-faqs-grid">${faqsHtml}</div>
    </div>
  </div>
  <div class="amz-elite-trust">
    <span class="amz-elite-trust-item"><svg viewBox="0 0 24 24" fill="currentColor"><path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"/></svg> Amazon Verified</span>
    <span class="amz-elite-trust-item"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg> Secure Checkout</span>
    <span class="amz-elite-trust-item"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="1 4 1 10 7 10"/><path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10"/></svg> 30-Day Returns</span>
    <span class="amz-elite-trust-item"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="1" y="3" width="15" height="13"/><polygon points="16 8 20 8 23 11 23 16 16 16 16 8"/><circle cx="5.5" cy="18.5" r="2.5"/><circle cx="18.5" cy="18.5" r="2.5"/></svg> Fast Shipping</span>
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

const preExtractAmazonProducts = (html: string): ExtractedProduct[] => {
  const products: ExtractedProduct[] = [];
  const seenAsins = new Set<string>();
  const seenNames = new Set<string>();

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
  const linkTextPattern = /<a[^>]*amazon\.com[^>]*>([^<]{10,100})<\/a>/gi;
  let linkMatch;
  while ((linkMatch = linkTextPattern.exec(html)) !== null) {
    const name = linkMatch[1].trim().replace(/\s+/g, ' ');
    if (name.length > 10 && !seenNames.has(name.toLowerCase())) {
      seenNames.add(name.toLowerCase());
      products.push({ asin: '', name, source: 'link', confidence: 0.9 });
    }
  }

  // STRATEGY 3: Extract from headings with product indicators
  const headingPattern = /<h[1-4][^>]*>([^<]*(?:Best|Top|Review|Pick|Choice|Recommended|Editor|Winner|#\d)[^<]*)<\/h[1-4]>/gi;
  let headingMatch;
  while ((headingMatch = headingPattern.exec(html)) !== null) {
    const text = headingMatch[1].replace(/<[^>]*>/g, '').trim();
    if (text.length > 5 && text.length < 150 && !seenNames.has(text.toLowerCase())) {
      seenNames.add(text.toLowerCase());
      products.push({ asin: '', name: text, source: 'heading', confidence: 0.7 });
    }
  }

  // STRATEGY 4: Extract from numbered/bulleted lists
  const listPattern = /<li[^>]*>(?:<[^>]*>)*([^<]*(?:[A-Z][a-z]+\s+[A-Z][a-z]+)[^<]{5,80})(?:<[^>]*>)*<\/li>/gi;
  let listMatch;
  while ((listMatch = listPattern.exec(html)) !== null) {
    const text = listMatch[1].replace(/<[^>]*>/g, '').trim();
    if (text.length > 10 && text.length < 100 && !seenNames.has(text.toLowerCase())) {
      const hasProductIndicator = /\b(pro|plus|max|ultra|mini|lite|series|gen|edition|version|\d{3,4}[a-z]*)\b/i.test(text);
      if (hasProductIndicator) {
        seenNames.add(text.toLowerCase());
        products.push({ asin: '', name: text, source: 'list', confidence: 0.6 });
      }
    }
  }

  // STRATEGY 5: Extract brand + model patterns from text
  const brandModelPattern = /\b(Apple|Samsung|Sony|LG|Bose|JBL|Anker|Logitech|Razer|Corsair|HyperX|SteelSeries|Ninja|Instant Pot|KitchenAid|Cuisinart|Dyson|iRobot|Roomba|Shark|Vitamix|Breville|De'?Longhi|Keurig|Nespresso|GoPro|Canon|Nikon|Fujifilm|DJI|Ring|Nest|Arlo|Philips|Oral-B|Waterpik|Fitbit|Garmin|Whoop|Oura|Theragun|Hyperice|NordicTrack|Peloton|Bowflex|RENPHO|Wyze|TP-Link|Netgear|Asus|Dell|HP|Lenovo|Microsoft|Google|Amazon|Echo|Kindle|Fire)\s+([A-Z]?[a-z]*\s*[\w\-]+(?:\s+[\w\-]+)?)/gi;
  
  let brandMatch;
  while ((brandMatch = brandModelPattern.exec(html)) !== null) {
    const name = `${brandMatch[1]} ${brandMatch[2]}`.trim();
    if (name.length > 5 && name.length < 80 && !seenNames.has(name.toLowerCase())) {
      seenNames.add(name.toLowerCase());
      products.push({ asin: '', name, source: 'text', confidence: 0.8 });
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
}> => {
  const emptyResult = { detectedProducts: [], product: null, comparison: undefined };

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

      const systemPrompt = `TASK: Extract ALL Amazon products from this content. Be thorough - find EVERY product mentioned.

HINTS - Products already detected in this page:
- ASINs found: ${asinsFound.join(', ') || 'none'}
- Product names found: ${namesFound.slice(0, 10).join(', ') || 'none'}

For EACH product, provide:
1. productName: EXACT product name as written
2. brand: Brand/manufacturer
3. category: Product category
4. verdict: EXACTLY 3 sentences - specific to THIS product, mention brand and name

VERDICT RULES:
- Sentence 1: "[Power word] for [user type], the [Brand] [Product] [main benefit]"
- Sentence 2: "[Key feature with specific detail], [performance claim]"
- Sentence 3: "[Trust signal], backed by [warranty/reviews]"
- NEVER start with "This", "The", "A"

Return JSON: {"products":[...]}`;

      const response = await ai.models.generateContent({
        model: config.aiModel || 'gemini-2.0-flash',
        contents: [{ role: 'user', parts: [{ text: `Title: "${title}"\n\nContent: ${context}` }] }],
        config: {
          systemInstruction: systemPrompt,
          responseMimeType: 'application/json',
        },
      });

      const data = cleanAndParseJSON(response?.text || '');
      aiProducts = data.products || [];
      console.log(`[SCAN] AI found ${aiProducts.length} additional products`);
      
    } catch (e: any) {
      console.warn('[SCAN] AI enhancement failed, using pre-extracted only:', e.message);
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // STEP 3: MERGE & DEDUPLICATE PRODUCTS
  // ═══════════════════════════════════════════════════════════════════════════

  const allProducts: Map<string, { asin: string; name: string; brand: string; category: string; verdict: string }> = new Map();

  // Add pre-extracted products (highest priority - from actual Amazon links)
  for (const p of preExtracted) {
    const key = p.asin || p.name.toLowerCase().substring(0, 30);
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
    
    const key = p.productName.toLowerCase().substring(0, 30);
    const existing = allProducts.get(key);
    
    if (existing) {
      // Merge AI data into existing
      existing.brand = existing.brand || p.brand || '';
      existing.category = existing.category || p.category || '';
      existing.verdict = existing.verdict || p.verdict || '';
    } else {
      // Check if this matches any ASIN entry by name similarity
      let matched = false;
      for (const [k, v] of allProducts) {
        if (v.asin && !v.name && p.productName) {
          // This could be the name for an ASIN we found
          v.name = p.productName;
          v.brand = p.brand || '';
          v.category = p.category || '';
          v.verdict = p.verdict || '';
          matched = true;
          break;
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

  if (processed.length > 0) {
    const contentHash = generateContentHash(title, htmlContent.length);
    IntelligenceCache.setAnalysis(contentHash, { products: processed, comparison: undefined });
  }

  return {
    detectedProducts: processed,
    product: processed[0] || null,
    comparison: undefined,
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
