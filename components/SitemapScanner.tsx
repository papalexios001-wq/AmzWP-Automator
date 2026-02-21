/**
 * ============================================================================
 * AmzWP-Automator | Sitemap Scanner Component v80.0
 * ============================================================================
 * Enterprise-grade sitemap scanner with:
 * - Manual URL Addition
 * - Bulk URL Import
 * - Real-time Audit Progress
 * - Advanced Filtering
 * - URL Validation
 * - Duplicate Detection
 * ============================================================================
 */

import React, { useState, useMemo, useCallback, useRef } from 'react';
import { BlogPost, SitemapState, AppConfig } from '../types';
import { 
  fetchAndParseSitemap, 
  fetchPageContent, 
  runConcurrent, 
  calculatePostPriority,
  validateManualUrl,
  createBlogPostFromUrl,
  debounce,
} from '../utils';
import Toastify from 'toastify-js';

// ============================================================================
// TYPE DEFINITIONS
// ============================================================================

interface SitemapScannerProps {
  onPostSelect: (post: BlogPost) => void;
  savedState: SitemapState;
  onPostUpdate?: (post: BlogPost) => void;
  onStateChange: (state: SitemapState) => void;
  config: AppConfig;
}

type FilterTab = 'all' | 'critical' | 'high' | 'monetized' | 'opportunity';
type ScanStatus = 'idle' | 'scanning' | 'auditing';

interface AuditProgress {
  current: number;
  total: number;
  percentage: number;
}

// ============================================================================
// COMPONENT
// ============================================================================

export const SitemapScanner: React.FC<SitemapScannerProps> = ({
  onPostSelect,
  savedState,
  onStateChange,
  config,
}) => {
  // ========== STATE ==========
  const [sitemapUrl, setSitemapUrl] = useState(savedState.url || '');
  const [status, setStatus] = useState<ScanStatus>('idle');
  const [auditProgress, setAuditProgress] = useState<AuditProgress>({
    current: 0,
    total: 0,
    percentage: 0,
  });
  const [activeTab, setActiveTab] = useState<FilterTab>('critical');
  const [searchQuery, setSearchQuery] = useState('');
  const [showSidebar, setShowSidebar] = useState(false);
  
  // Manual URL Addition State
  const [showManualInput, setShowManualInput] = useState(false);
  const [manualUrl, setManualUrl] = useState('');
  const [manualUrlError, setManualUrlError] = useState('');
  const [showBulkImport, setShowBulkImport] = useState(false);
  const [bulkUrls, setBulkUrls] = useState('');

  // Refs for preventing race conditions
  const abortControllerRef = useRef<AbortController | null>(null);

  // ========== MEMOIZED VALUES ==========
  
  const stats = useMemo(() => ({
    total: savedState.posts.length,
    critical: savedState.posts.filter(p => p.priority === 'critical').length,
    high: savedState.posts.filter(p => p.priority === 'high').length,
    monetized: savedState.posts.filter(p => p.monetizationStatus === 'monetized').length,
    opportunity: savedState.posts.filter(p => p.monetizationStatus === 'opportunity').length,
  }), [savedState.posts]);

  const filteredPosts = useMemo(() => {
    let posts = savedState.posts;

    // Apply tab filter
    switch (activeTab) {
      case 'critical':
        posts = posts.filter(p => p.priority === 'critical');
        break;
      case 'high':
        posts = posts.filter(p => p.priority === 'high');
        break;
      case 'monetized':
        posts = posts.filter(p => p.monetizationStatus === 'monetized');
        break;
      case 'opportunity':
        posts = posts.filter(p => p.monetizationStatus === 'opportunity');
        break;
    }

    // Apply search filter
    if (searchQuery.trim()) {
      const query = searchQuery.toLowerCase();
      posts = posts.filter(p => 
        p.title.toLowerCase().includes(query) ||
        p.url.toLowerCase().includes(query)
      );
    }

    return posts;
  }, [savedState.posts, activeTab, searchQuery]);

  const existingUrls = useMemo(() => 
    new Set(savedState.posts.map(p => p.url.toLowerCase())),
    [savedState.posts]
  );

  const existingIds = useMemo(() => 
    new Set(savedState.posts.map(p => p.id)),
    [savedState.posts]
  );

  // ========== HANDLERS ==========

  const showToast = useCallback((message: string, type: 'success' | 'error' | 'warning' | 'info' = 'info') => {
    const backgrounds = {
      success: '#10b981',
      error: '#ef4444',
      warning: '#f59e0b',
      info: '#3b82f6',
    };
    
    Toastify({
      text: message,
      duration: type === 'error' ? 5000 : 3000,
      style: { background: backgrounds[type] },
      close: type === 'error',
    }).showToast();
  }, []);

  const handleFetch = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!sitemapUrl.trim()) return;

    // Cancel any existing operation
    abortControllerRef.current?.abort();
    abortControllerRef.current = new AbortController();

    setStatus('scanning');
    
    try {
      const posts = await fetchAndParseSitemap(sitemapUrl, config);
      
      onStateChange({
        url: sitemapUrl,
        posts,
        lastScanned: Date.now(),
      });

      showToast(`Discovery Complete: ${posts.length} content pages found`, 'success');
      
      // Automatically run deep audit
      runDeepAudit(posts);
    } catch (error: any) {
      const message = error.message || 'Unknown error occurred';
      
      if (message.includes('WordPress Credentials')) {
        showToast(
          'Advanced Discovery requires WordPress credentials. Configure in Settings ⚙️',
          'warning'
        );
      } else {
        showToast(`Scan Failed: ${message}`, 'error');
      }
      
      setStatus('idle');
    }
  };

  const runDeepAudit = async (posts: BlogPost[]) => {
    setStatus('auditing');
    setAuditProgress({ current: 0, total: posts.length, percentage: 0 });

    const postMap = new Map(posts.map(p => [p.url, p]));

    // Initial quick audit based on title only
    posts.forEach(p => {
      const analysis = calculatePostPriority(p.title, '');
      postMap.set(p.url, {
        ...p,
        priority: analysis.priority,
        postType: analysis.type,
        monetizationStatus: analysis.status,
      });
    });

    onStateChange({ ...savedState, posts: Array.from(postMap.values()) });

    const targets = Array.from(postMap.values());
    let processed = 0;

    // Process with concurrency
    await runConcurrent(targets, 10, async (post) => {
      try {
        const page = await fetchPageContent(config, post.url);
        const analysis = calculatePostPriority(post.title, page.content);
        
        postMap.set(post.url, {
          ...post,
          content: page.content,
          priority: analysis.priority,
          monetizationStatus: analysis.status,
          postType: analysis.type,
        });
      } catch {
        // Keep original analysis if fetch fails
      }

      processed++;
      const percentage = Math.floor((processed / targets.length) * 100);
      setAuditProgress({ current: processed, total: targets.length, percentage });

      // Throttle state updates for performance
      if (processed % 10 === 0 || processed === targets.length) {
        onStateChange({ ...savedState, posts: Array.from(postMap.values()) });
      }
    });

    onStateChange({
      url: sitemapUrl,
      posts: Array.from(postMap.values()),
      lastScanned: Date.now(),
    });

    setStatus('idle');
    setAuditProgress({ current: 0, total: 0, percentage: 0 });
    showToast('Content Audit Complete', 'success');
  };

  // ========== MANUAL URL HANDLERS ==========

  const handleManualUrlChange = (value: string) => {
    setManualUrl(value);
    setManualUrlError('');
  };

  const handleAddManualUrl = useCallback(() => {
    const validation = validateManualUrl(manualUrl);
    
    if (!validation.isValid) {
      setManualUrlError(validation.error || 'Invalid URL');
      showToast(validation.error || 'Invalid URL', 'error');
      return;
    }

    // Check for duplicates
    if (existingUrls.has(validation.normalizedUrl.toLowerCase())) {
      setManualUrlError('URL already exists in the list');
      showToast('URL already exists', 'warning');
      return;
    }

    const newPost = createBlogPostFromUrl(validation.normalizedUrl, existingIds);

    onStateChange({
      ...savedState,
      posts: [...savedState.posts, newPost],
    });

    setManualUrl('');
    setManualUrlError('');
    showToast('URL added successfully', 'success');
  }, [manualUrl, existingUrls, existingIds, savedState, onStateChange, showToast]);

  const handleBulkImport = useCallback(() => {
    const lines = bulkUrls
      .split('\n')
      .map(line => line.trim())
      .filter(line => line.length > 0);

    if (lines.length === 0) {
      showToast('No valid URLs found', 'warning');
      return;
    }

    let added = 0;
    let skipped = 0;
    const newPosts: BlogPost[] = [];
    const currentIds = new Set(existingIds);
    const currentUrls = new Set(existingUrls);

    lines.forEach(line => {
      const validation = validateManualUrl(line);
      
      if (!validation.isValid) {
        skipped++;
        return;
      }

      if (currentUrls.has(validation.normalizedUrl.toLowerCase())) {
        skipped++;
        return;
      }

      const newPost = createBlogPostFromUrl(validation.normalizedUrl, currentIds);
      newPosts.push(newPost);
      currentIds.add(newPost.id);
      currentUrls.add(validation.normalizedUrl.toLowerCase());
      added++;
    });

    if (newPosts.length > 0) {
      onStateChange({
        ...savedState,
        posts: [...savedState.posts, ...newPosts],
      });
    }

    setBulkUrls('');
    setShowBulkImport(false);
    showToast(`Added ${added} URLs, skipped ${skipped}`, added > 0 ? 'success' : 'warning');
  }, [bulkUrls, existingUrls, existingIds, savedState, onStateChange, showToast]);

  const handleRemovePost = useCallback((postId: number) => {
    onStateChange({
      ...savedState,
      posts: savedState.posts.filter(p => p.id !== postId),
    });
    showToast('URL removed', 'info');
  }, [savedState, onStateChange, showToast]);

  // Debounced search handler
  const debouncedSearch = useMemo(
    () => debounce((value: string) => setSearchQuery(value), 300),
    []
  );

  // ========== RENDER ==========

  return (
    <div className="flex h-full bg-dark-950 animate-fade-in relative">
      
      {/* Mobile Sidebar Overlay */}
      {showSidebar && (
        <div 
          className="fixed inset-0 bg-dark-950/80 backdrop-blur-sm z-40 md:hidden animate-fade-in"
          onClick={() => setShowSidebar(false)}
        />
      )}

      {/* ========== SIDEBAR ========== */}
      <aside className={`
        fixed inset-y-0 left-0 w-80 bg-dark-900 border-r border-dark-800 p-8 flex flex-col gap-8 shadow-3xl z-50 transition-transform duration-500 md:relative md:translate-x-0
        ${showSidebar ? 'translate-x-0' : '-translate-x-full'}
      `}>
        
        {/* Logo */}
        <div className="flex items-center justify-between">
          <div className="space-y-1">
            <h1 className="text-3xl font-black text-white tracking-tighter">
              Amz<span className="text-brand-500">Pilot</span>
            </h1>
            <p className="text-[9px] font-black uppercase tracking-[4px] text-gray-600">
              Enterprise v80.0
            </p>
          </div>
          <button 
            onClick={() => setShowSidebar(false)}
            className="md:hidden w-10 h-10 rounded-full bg-dark-800 text-gray-400 flex items-center justify-center"
          >
            <i className="fa-solid fa-xmark"></i>
          </button>
        </div>

        {/* Stats Cards */}
        <div className="space-y-3 overflow-y-auto custom-scrollbar pr-2">
          {/* Critical Posts Card */}
          <button
            onClick={() => { setActiveTab('critical'); setShowSidebar(false); }}
            className={`w-full p-5 rounded-[24px] border-2 cursor-pointer transition-all duration-300 text-left ${
              activeTab === 'critical'
                ? 'bg-red-500/10 border-red-500 shadow-2xl shadow-red-500/20'
                : 'bg-dark-950 border-dark-800 hover:border-red-500/40'
            }`}
          >
            <div className="text-[9px] text-red-400 uppercase font-black tracking-widest mb-1">
              High Priority Gaps
            </div>
            <div className="text-3xl font-black text-white leading-none">
              {stats.critical}
            </div>
          </button>

          {/* High Priority Card */}
          <button
            onClick={() => { setActiveTab('high'); setShowSidebar(false); }}
            className={`w-full p-5 rounded-[24px] border-2 cursor-pointer transition-all duration-300 text-left ${
              activeTab === 'high'
                ? 'bg-orange-500/10 border-orange-500 shadow-2xl shadow-orange-500/20'
                : 'bg-dark-950 border-dark-800 hover:border-orange-500/40'
            }`}
          >
            <div className="text-[9px] text-orange-400 uppercase font-black tracking-widest mb-1">
              Medium Priority
            </div>
            <div className="text-3xl font-black text-white leading-none">
              {stats.high}
            </div>
          </button>

          {/* Monetized Card */}
          <button
            onClick={() => { setActiveTab('monetized'); setShowSidebar(false); }}
            className={`w-full p-5 rounded-[24px] border-2 cursor-pointer transition-all duration-300 text-left ${
              activeTab === 'monetized'
                ? 'bg-green-500/10 border-green-500 shadow-2xl shadow-green-500/20'
                : 'bg-dark-950 border-dark-800 hover:border-green-500/40'
            }`}
          >
            <div className="text-[9px] text-green-400 uppercase font-black tracking-widest mb-1">
              Revenue Active
            </div>
            <div className="text-3xl font-black text-white leading-none">
              {stats.monetized}
            </div>
          </button>
        </div>

        {/* Action Buttons */}
        <div className="mt-auto space-y-3">
          <button
            onClick={() => { setShowManualInput(!showManualInput); setShowSidebar(false); }}
            className="w-full bg-brand-600 hover:bg-brand-500 text-white py-4 rounded-2xl text-[10px] font-black uppercase tracking-widest shadow-xl transition-all flex items-center justify-center gap-2"
          >
            <i className="fa-solid fa-plus"></i>
            Add URL Manually
          </button>
          
          <button
            onClick={() => { runDeepAudit(savedState.posts); setShowSidebar(false); }}
            disabled={status !== 'idle' || savedState.posts.length === 0}
            className="w-full bg-white text-dark-950 py-4 rounded-2xl text-[10px] font-black uppercase tracking-widest shadow-2xl hover:scale-105 active:scale-95 transition-all disabled:opacity-50 disabled:scale-100"
          >
            {status === 'auditing' 
              ? `Auditing ${auditProgress.percentage}%` 
              : 'Re-Audit All Content'
            }
          </button>
        </div>
      </aside>

      {/* ========== MAIN CONTENT ========== */}
      <main className="flex-1 flex flex-col overflow-hidden relative z-0">
        
        {/* Header with Search */}
        <header className="p-4 md:p-8 border-b border-dark-800 bg-dark-900/40 backdrop-blur-3xl shadow-xl sticky top-0 z-30">
          <div className="max-w-6xl mx-auto space-y-4 md:space-y-6">
            
            <div className="flex items-center gap-4">
              <button 
                onClick={() => setShowSidebar(true)}
                className="md:hidden w-12 h-12 rounded-2xl bg-dark-950 border border-dark-700 text-white flex items-center justify-center shadow-xl"
              >
                <i className="fa-solid fa-bars-staggered"></i>
              </button>

              {/* Sitemap Input Form */}
              <form onSubmit={handleFetch} className="flex-1 flex gap-2 md:gap-4">
                <input
                  type="text"
                  value={sitemapUrl}
                  onChange={e => setSitemapUrl(e.target.value)}
                  placeholder="Domain or sitemap URL..."
                  className="flex-1 bg-dark-950 border border-dark-700 rounded-xl md:rounded-2xl px-4 md:px-6 py-3 md:py-4 text-white focus:ring-4 focus:ring-brand-500/20 focus:border-brand-500 outline-none shadow-xl transition-all font-medium placeholder-gray-600 text-sm md:text-base"
                />
                <button
                  type="submit"
                  disabled={status !== 'idle'}
                  className="bg-brand-600 text-white font-black px-4 md:px-10 rounded-xl md:rounded-2xl uppercase tracking-[2px] md:tracking-[3px] text-[10px] md:text-[11px] shadow-2xl hover:bg-brand-500 hover:scale-105 transition-all disabled:opacity-50 min-w-[100px] md:min-w-[160px] flex items-center justify-center gap-2"
                >
                  {status === 'scanning' ? (
                    <i className="fa-solid fa-satellite-dish animate-bounce"></i>
                  ) : status === 'auditing' ? (
                    <i className="fa-solid fa-sync fa-spin"></i>
                  ) : (
                    <>
                      <i className="fa-solid fa-radar"></i>
                      <span className="hidden sm:inline">Discover</span>
                    </>
                  )}
                </button>
              </form>
            </div>

            {/* Manual URL Input (Collapsible) */}
            {showManualInput && (
              <div className="animate-fade-in bg-dark-950/50 border border-dark-700 rounded-2xl p-4 md:p-6 space-y-4">
                <div className="flex items-center justify-between">
                  <h3 className="text-sm font-bold text-white flex items-center gap-2">
                    <i className="fa-solid fa-link text-brand-500"></i>
                    Add URL Manually
                  </h3>
                  <button
                    onClick={() => setShowBulkImport(!showBulkImport)}
                    className="text-xs text-brand-400 hover:text-brand-300 font-bold uppercase tracking-wider"
                  >
                    {showBulkImport ? 'Single URL' : 'Bulk Import'}
                  </button>
                </div>

                {showBulkImport ? (
                  <>
                    <textarea
                      value={bulkUrls}
                      onChange={e => setBulkUrls(e.target.value)}
                      placeholder="Paste multiple URLs (one per line)&#10;https://example.com/post-1&#10;https://example.com/post-2"
                      className="w-full h-32 bg-dark-900 border border-dark-700 rounded-xl px-4 py-3 text-white text-sm outline-none focus:border-brand-500 resize-none"
                    />
                    <button
                      onClick={handleBulkImport}
                      className="w-full bg-brand-600 hover:bg-brand-500 text-white py-3 rounded-xl text-xs font-bold uppercase tracking-widest transition-all"
                    >
                      Import All URLs
                    </button>
                  </>
                ) : (
                  <>
                    <div className="flex flex-col sm:flex-row gap-3">
                      <div className="flex-1 relative">
                        <input
                          type="text"
                          value={manualUrl}
                          onChange={e => handleManualUrlChange(e.target.value)}
                          onKeyDown={e => e.key === 'Enter' && (e.preventDefault(), handleAddManualUrl())}
                          placeholder="https://example.com/blog-post"
                          className={`w-full bg-dark-900 border rounded-xl px-4 py-3 text-white text-sm outline-none transition-colors ${
                            manualUrlError 
                              ? 'border-red-500 focus:border-red-400' 
                              : 'border-dark-700 focus:border-brand-500'
                          }`}
                        />
                        {manualUrlError && (
                          <p className="absolute -bottom-5 left-0 text-[10px] text-red-400">
                            {manualUrlError}
                          </p>
                        )}
                      </div>
                      <button
                        onClick={handleAddManualUrl}
                        className="bg-green-600 hover:bg-green-500 text-white px-6 py-3 sm:py-0 rounded-xl text-xs font-bold uppercase tracking-wider transition-all flex items-center justify-center gap-2"
                      >
                        <i className="fa-solid fa-plus"></i>
                        Add
                      </button>
                    </div>
                    <p className="text-[10px] text-gray-500">
                      Press Enter to add quickly. Media files are automatically filtered.
                    </p>
                  </>
                )}
              </div>
            )}

            {/* Search & Filter Bar */}
            {savedState.posts.length > 0 && (
              <div className="flex flex-col lg:flex-row items-stretch lg:items-center gap-4">
                <div className="relative flex-1">
                  <i className="fa-solid fa-search absolute left-4 top-1/2 -translate-y-1/2 text-gray-500"></i>
                  <input
                    type="text"
                    onChange={e => debouncedSearch(e.target.value)}
                    placeholder="Search posts..."
                    className="w-full bg-dark-950 border border-dark-700 rounded-xl pl-11 pr-4 py-3 text-white text-sm outline-none focus:border-brand-500"
                  />
                </div>
                
                <div className="flex bg-dark-900/50 p-1 rounded-xl md:rounded-full border border-dark-800 overflow-x-auto scrollbar-hide">
                  {(['all', 'critical', 'high', 'monetized', 'opportunity'] as FilterTab[]).map(tab => (
                    <button
                      key={tab}
                      onClick={() => setActiveTab(tab)}
                      className={`px-4 md:px-6 py-2 rounded-lg md:rounded-full text-[9px] md:text-[10px] font-black uppercase tracking-widest transition-all whitespace-nowrap ${
                        activeTab === tab
                          ? 'bg-white text-dark-950 shadow-xl'
                          : 'text-gray-500 hover:text-white'
                      }`}
                    >
                      {tab} <span className="opacity-50 ml-1">{stats[tab as keyof typeof stats] || 0}</span>
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
        </header>

        {/* Post List */}
        <div className="flex-1 overflow-y-auto p-4 md:p-8 space-y-6 pb-32 custom-scrollbar">
          <div className="max-w-6xl mx-auto">
            
            {/* List Header */}
            <div className="flex items-center justify-between mb-6 md:mb-8">
              <h2 className="text-[10px] md:text-[12px] font-black uppercase tracking-[4px] md:tracking-[8px] text-gray-600">
                {filteredPosts.length} of {savedState.posts.length} Posts
              </h2>
              {savedState.lastScanned && (
                <span className="text-[9px] md:text-[10px] text-gray-600 hidden sm:inline">
                  Last scanned: {new Date(savedState.lastScanned).toLocaleString()}
                </span>
              )}
            </div>

            {/* Empty State */}
            {filteredPosts.length === 0 ? (
              <div className="py-20 md:py-32 text-center space-y-6 bg-dark-900/20 rounded-[32px] md:rounded-[48px] border-2 border-dashed border-dark-800">
                <div className="text-4xl md:text-6xl text-dark-700">
                  <i className="fa-solid fa-folder-open"></i>
                </div>
                <p className="text-gray-600 font-black uppercase tracking-[4px] md:tracking-[8px] text-sm md:text-base">
                  {savedState.posts.length === 0 ? 'No Content Detected' : 'No Matching Posts'}
                </p>
                <p className="text-[10px] md:text-xs text-gray-600 max-w-md mx-auto px-6">
                  {savedState.posts.length === 0
                    ? 'Enter a domain or sitemap URL above to discover content, or add URLs manually.'
                    : 'Try adjusting your search or filter criteria.'
                  }
                </p>
              </div>
            ) : (
              <div className="space-y-4">
                {filteredPosts.map(post => (
                  <article
                    key={post.id}
                    className="bg-dark-900/80 border border-dark-800 rounded-[24px] md:rounded-[36px] p-6 md:p-8 flex flex-col sm:flex-row items-start sm:items-center justify-between group hover:border-brand-500 hover:bg-dark-900 transition-all duration-300 shadow-xl gap-6"
                  >
                    <div className="flex-1 min-w-0 w-full">
                      {/* Status Badges */}
                      <div className="flex items-center gap-2 md:gap-3 mb-3 flex-wrap">
                        {post.priority === 'critical' && (
                          <span className="bg-red-500/10 text-red-500 text-[8px] md:text-[9px] font-black px-3 md:px-4 py-1 md:py-1.5 rounded-full border border-red-500/30 uppercase tracking-[1px] md:tracking-[2px]">
                            High Priority
                          </span>
                        )}
                        {post.priority === 'high' && (
                          <span className="bg-orange-500/10 text-orange-500 text-[8px] md:text-[9px] font-black px-3 md:px-4 py-1 md:py-1.5 rounded-full border border-orange-500/30 uppercase tracking-[1px] md:tracking-[2px]">
                            Medium Priority
                          </span>
                        )}
                        {post.monetizationStatus === 'monetized' && (
                          <span className="bg-green-500/10 text-green-500 text-[8px] md:text-[9px] font-black px-3 md:px-4 py-1 md:py-1.5 rounded-full border border-green-500/30 uppercase tracking-[1px] md:tracking-[2px]">
                            <i className="fa-solid fa-check mr-1"></i>
                            Monetized
                          </span>
                        )}
                        <span className="text-[8px] md:text-[9px] text-gray-600 font-black uppercase tracking-widest">
                          {post.postType}
                        </span>
                      </div>

                      {/* Title */}
                      <h3 className="text-xl md:text-2xl font-black text-white truncate tracking-tight group-hover:text-brand-400 transition-colors">
                        {post.title}
                      </h3>

                      {/* URL */}
                      <a
                        href={post.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-[10px] md:text-[11px] font-mono text-gray-500 hover:text-brand-400 truncate mt-2 block w-fit transition-colors"
                        onClick={e => e.stopPropagation()}
                      >
                        {post.url}
                      </a>
                    </div>

                    {/* Actions */}
                    <div className="flex items-center gap-3 w-full sm:w-auto">
                      <button
                        onClick={() => handleRemovePost(post.id)}
                        className="w-10 h-10 md:w-12 md:h-12 rounded-full bg-dark-800 text-gray-500 hover:bg-red-500/20 hover:text-red-400 flex items-center justify-center transition-all sm:opacity-0 group-hover:opacity-100"
                        title="Remove URL"
                      >
                        <i className="fa-solid fa-trash-can text-xs"></i>
                      </button>
                      <button
                        onClick={() => onPostSelect(post)}
                        className="flex-1 sm:flex-none bg-white text-dark-950 font-black px-6 md:px-10 py-3 md:py-4 rounded-xl md:rounded-[20px] uppercase tracking-[2px] md:tracking-[3px] text-[10px] md:text-[11px] shadow-xl hover:bg-brand-500 hover:text-white hover:scale-105 active:scale-95 transition-all"
                      >
                        Edit Post
                      </button>
                    </div>
                  </article>
                ))}
              </div>
            )}
          </div>
        </div>
      </main>
    </div>
  );
};

export default SitemapScanner;
