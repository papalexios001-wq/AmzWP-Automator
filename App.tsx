/**
 * ============================================================================
 * AmzWP-Automator | Application Shell v80.0
 * ============================================================================
 * Enterprise-grade React application with:
 * - Error Boundaries
 * - State Persistence
 * - Performance Optimizations
 * - Clean Architecture
 * ============================================================================
 */

import React, { 
  useState, 
  useEffect, 
  useCallback, 
  useMemo,
  Suspense,
  lazy,
  ErrorInfo,
  Component,
  ReactNode,
} from 'react';
import { AppConfig, BlogPost, AppStep, SitemapState } from './types';
import { ConfigPanel } from './components/ConfigPanel';
import { SitemapScanner } from './components/SitemapScanner';
import { LandingPage } from './components/LandingPage';
import { IntelligenceCache } from './utils';

// Lazy load the PostEditor for better initial load performance
const PostEditor = lazy(() => 
  import('./components/PostEditor').then(module => ({ default: module.PostEditor }))
);

// ============================================================================
// CONSTANTS
// ============================================================================

const STORAGE_KEYS = {
  HAS_ENTERED: 'amzwp_has_entered',
  CONFIG: 'amzwp_config_v4',
  SITEMAP_STATE: 'amzwp_sitemap_state_v4',
} as const;

const DEFAULT_CONFIG: AppConfig = {
  amazonTag: '',
  amazonAccessKey: '',
  amazonSecretKey: '',
  amazonRegion: 'us-east-1',
  wpUrl: '',
  wpUser: '',
  wpAppPassword: '',
  serpApiKey: '',
  autoPublishThreshold: 85,
  concurrencyLimit: 5,
  enableSchema: true,
  enableStickyBar: true,
  aiProvider: 'gemini',
  aiModel: 'gemini-2.0-flash',
};

// ============================================================================
// ERROR BOUNDARY
// ============================================================================

interface ErrorBoundaryProps {
  children: ReactNode;
  fallback?: ReactNode;
}

interface ErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
}

class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error('[ErrorBoundary] Caught error:', error, errorInfo);
  }

  render() {
    if (this.state.hasError) {
      return (
        this.props.fallback || (
          <div className="min-h-screen bg-dark-950 flex items-center justify-center p-8">
            <div className="bg-dark-900 border border-red-500/30 rounded-3xl p-12 max-w-lg text-center">
              <div className="text-6xl mb-6 text-red-500">
                <i className="fa-solid fa-triangle-exclamation"></i>
              </div>
              <h1 className="text-2xl font-black text-white mb-4">
                Application Error
              </h1>
              <p className="text-gray-400 mb-8">
                {this.state.error?.message || 'An unexpected error occurred'}
              </p>
              <button
                onClick={() => window.location.reload()}
                className="bg-white text-dark-950 px-8 py-4 rounded-xl font-bold hover:bg-brand-500 hover:text-white transition-all"
              >
                Reload Application
              </button>
            </div>
          </div>
        )
      );
    }

    return this.props.children;
  }
}

// ============================================================================
// LOADING COMPONENT
// ============================================================================

const LoadingSpinner: React.FC<{ message?: string }> = ({ message = 'Loading...' }) => (
  <div className="min-h-screen bg-dark-950 flex items-center justify-center">
    <div className="text-center">
      <div className="relative w-20 h-20 mx-auto mb-6">
        <div className="absolute inset-0 border-4 border-brand-500/20 rounded-full"></div>
        <div className="absolute inset-0 border-4 border-transparent border-t-brand-500 rounded-full animate-spin"></div>
      </div>
      <p className="text-gray-500 font-bold uppercase tracking-widest text-xs">
        {message}
      </p>
    </div>
  </div>
);

// ============================================================================
// CUSTOM HOOKS
// ============================================================================

/**
 * Persisted state hook with localStorage
 */
function usePersistedState<T>(
  key: string,
  defaultValue: T
): [T, React.Dispatch<React.SetStateAction<T>>] {
  const [state, setState] = useState<T>(() => {
    try {
      const stored = localStorage.getItem(key);
      return stored ? JSON.parse(stored) : defaultValue;
    } catch {
      return defaultValue;
    }
  });

  useEffect(() => {
    try {
      localStorage.setItem(key, JSON.stringify(state));
    } catch (error) {
      console.warn(`[usePersistedState] Failed to persist ${key}:`, error);
    }
  }, [key, state]);

  return [state, setState];
}

/**
 * Keyboard shortcut hook
 */
function useKeyboardShortcuts(shortcuts: Record<string, () => void>) {
  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      // Build shortcut string (e.g., "ctrl+s", "meta+k")
      const parts: string[] = [];
      if (event.ctrlKey) parts.push('ctrl');
      if (event.metaKey) parts.push('meta');
      if (event.shiftKey) parts.push('shift');
      if (event.altKey) parts.push('alt');
      parts.push(event.key.toLowerCase());
      
      const shortcut = parts.join('+');
      
      if (shortcuts[shortcut]) {
        event.preventDefault();
        shortcuts[shortcut]();
      }
    };

    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [shortcuts]);
}

// ============================================================================
// MAIN APPLICATION COMPONENT
// ============================================================================

const App: React.FC = () => {
  // ========== STATE ==========
  const [hasEntered, setHasEntered] = usePersistedState(
    STORAGE_KEYS.HAS_ENTERED,
    false
  );
  
  const [config, setConfig] = usePersistedState<AppConfig>(
    STORAGE_KEYS.CONFIG,
    DEFAULT_CONFIG
  );

  const [currentStep, setCurrentStep] = useState<AppStep>(AppStep.SITEMAP);
  const [selectedPost, setSelectedPost] = useState<BlogPost | null>(null);
  
  const [sitemapData, setSitemapData] = usePersistedState<SitemapState>(
    STORAGE_KEYS.SITEMAP_STATE,
    { url: '', posts: [] }
  );

  // ========== CALLBACKS ==========
  
  const handleEnter = useCallback(() => {
    setHasEntered(true);
  }, [setHasEntered]);

  const handleConfigSave = useCallback((newConfig: AppConfig) => {
    setConfig(newConfig);
  }, [setConfig]);

  const handlePostSelect = useCallback((post: BlogPost) => {
    setSelectedPost(post);
    setCurrentStep(AppStep.EDITOR);
  }, []);

  const handleBackToSitemap = useCallback(() => {
    setSelectedPost(null);
    setCurrentStep(AppStep.SITEMAP);
  }, []);

  const handleSitemapStateChange = useCallback((state: SitemapState) => {
    setSitemapData(state);
  }, [setSitemapData]);

  // ========== KEYBOARD SHORTCUTS ==========
  
  const shortcuts = useMemo(() => ({
    'escape': () => {
      if (currentStep === AppStep.EDITOR) {
        handleBackToSitemap();
      }
    },
  }), [currentStep, handleBackToSitemap]);

  useKeyboardShortcuts(shortcuts);

  // ========== CLEANUP ON UNMOUNT ==========
  
  useEffect(() => {
    // Cleanup expired cache entries on app load
    IntelligenceCache.cleanup();
  }, []);

  // ========== RENDER ==========

  // Landing page
  if (!hasEntered) {
    return (
      <ErrorBoundary>
        <LandingPage onEnter={handleEnter} />
      </ErrorBoundary>
    );
  }

  return (
    <ErrorBoundary>
      <div className="h-dvh w-screen bg-dark-950 text-slate-200 font-sans selection:bg-brand-500 selection:text-white overflow-hidden flex flex-col animate-fade-in">
        
        {/* Configuration Panel (Global) */}
        <ConfigPanel 
          initialConfig={config} 
          onSave={handleConfigSave} 
        />

        {/* Main Application Area */}
        <main className="flex-1 w-full h-full relative overflow-hidden">
          
          {/* Sitemap Scanner View */}
          {currentStep === AppStep.SITEMAP && (
            <SitemapScanner
              onPostSelect={handlePostSelect}
              savedState={sitemapData}
              onStateChange={handleSitemapStateChange}
              config={config}
            />
          )}

          {/* Post Editor View (Lazy Loaded) */}
          {currentStep === AppStep.EDITOR && selectedPost && (
            <Suspense fallback={<LoadingSpinner message="Loading Editor" />}>
              <PostEditor
                key={selectedPost.id}
                post={selectedPost}
                config={config}
                onBack={handleBackToSitemap}
                allPosts={sitemapData.posts}
                onSwitchPost={setSelectedPost}
              />
            </Suspense>
          )}
        </main>

        {/* Global Progress Indicator (for async operations) */}
        <div 
          id="global-progress" 
          className="fixed bottom-0 left-0 right-0 h-1 bg-transparent pointer-events-none z-50"
        />
      </div>
    </ErrorBoundary>
  );
};

// ============================================================================
// EXPORT
// ============================================================================

export default App;
