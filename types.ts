
export type AIProvider = 'gemini' | 'openai' | 'anthropic' | 'groq' | 'openrouter';

export interface FAQItem {
  question: string;
  answer: string;
}

export type DeploymentMode = 'ELITE_BENTO' | 'TACTICAL_LINK';

export interface AppConfig {
  amazonTag: string;
  amazonAccessKey: string;
  amazonSecretKey: string;
  amazonRegion: string;
  wpUrl: string;
  wpUser: string;
  wpAppPassword: string;
  serpApiKey?: string;
  
  autoPublishThreshold: number; 
  concurrencyLimit: number; 
  enableSchema: boolean; 
  enableStickyBar: boolean;
  
  aiProvider: AIProvider;
  aiModel: string;
}

export interface ProductDetails {
  id: string; 
  asin: string;
  title: string;
  brand: string; 
  category: string; 
  price: string;
  imageUrl: string;
  rating: number;
  reviewCount: number; 
  prime: boolean;
  description?: string;
  pros?: string[];
  cons?: string[];
  verdict?: string;
  faqs: FAQItem[]; 
  entities: string[]; 
  evidenceClaims: string[]; 
  specs?: Record<string, string>; // NEW: For Comparison Table
  insertionIndex: number; 
  deploymentMode: DeploymentMode;
}

// NEW: Comparison Table Data Structure
export interface ComparisonData {
  title: string;
  productIds: string[]; // IDs of the top 3 products
  specs: string[]; // Keys like "Weight", "Battery", "Speed"
}

// NEW: Carousel Data Structure
export interface CarouselData {
  title: string;
  productIds: string[];
}

export type PostPriority = 'critical' | 'high' | 'medium' | 'low';
export type PostType = 'review' | 'listicle' | 'info' | 'unknown';

export interface BlogPost {
  id: number;
  title: string;
  url: string;
  status: 'draft' | 'publish';
  content: string; 
  date?: string;
  priority?: PostPriority;
  postType?: PostType;
  monetizationStatus?: 'analyzing' | 'monetized' | 'opportunity' | 'error' | 'queued';
  proposedProduct?: ProductDetails;
  activeProducts?: ProductDetails[]; 
  detectedProducts?: ProductDetails[]; 
  comparisonData?: ComparisonData; // NEW
}

export interface SitemapState {
  url: string;
  posts: BlogPost[];
  lastScanned?: number;
}

export enum AppStep {
  CONFIG = 'CONFIG',
  SITEMAP = 'SITEMAP',
  EDITOR = 'EDITOR',
}
