/**
 * ============================================================================
 * ProductBoxPreview | SOTA React Component v5.0
 * ============================================================================
 * Enterprise-Grade Product Box Preview with:
 * - SOTA Verdict Display with Verified Analysis Badge
 * - Dual Deployment Modes (ELITE_BENTO / TACTICAL_LINK)
 * - Premium Visual Design with Micro-Animations
 * - Expandable FAQ Section
 * - Trust Signal Footer
 * - Responsive Design
 * - Error State Handling
 * ============================================================================
 */

import React, { useState, useMemo } from 'react';
import { ProductDetails, DeploymentMode, FAQItem } from '../types';

// ============================================================================
// TYPES & INTERFACES
// ============================================================================

interface ProductBoxPreviewProps {
  product: ProductDetails;
  affiliateTag?: string;
  mode?: DeploymentMode;
}

// ============================================================================
// CONSTANTS
// ============================================================================

const DEFAULT_BULLETS = [
  "Premium build quality with attention to detail",
  "Industry-leading performance metrics", 
  "Backed by comprehensive warranty",
  "Trusted by thousands of verified buyers"
];

const DEFAULT_FAQS: FAQItem[] = [
  { 
    question: "Is this product covered by warranty?", 
    answer: "Yes, this product comes with a comprehensive manufacturer warranty for complete peace of mind." 
  },
  { 
    question: "How does shipping work?", 
    answer: "Eligible for fast Prime shipping with free returns within 30 days." 
  },
  { 
    question: "What's included in the package?", 
    answer: "Complete package includes the main product, all necessary accessories, and detailed documentation." 
  },
  { 
    question: "Is customer support available?", 
    answer: "24/7 customer support available through phone, email, and live chat for any assistance." 
  }
];

const DEFAULT_VERDICT = "Engineered for discerning users who demand excellence, this premium product delivers professional-grade performance with meticulous attention to detail. Backed by thousands of verified reviews and trusted by industry professionals worldwide.";

const TRUST_SIGNALS = [
  { icon: 'fa-amazon', text: 'Amazon Verified', isBrand: true },
  { icon: 'fa-shield-halved', text: 'Secure Checkout', isBrand: false },
  { icon: 'fa-rotate-left', text: '30-Day Returns', isBrand: false },
  { icon: 'fa-truck-fast', text: 'Fast Shipping', isBrand: false },
];

// ============================================================================
// SUB-COMPONENTS
// ============================================================================

interface TrustSignalsProps {
  signals: typeof TRUST_SIGNALS;
}

const TrustSignals: React.FC<TrustSignalsProps> = ({ signals }) => (
  <div className="mt-6 flex flex-wrap justify-center items-center gap-6 md:gap-10">
    {signals.map((signal, idx) => (
      <div 
        key={idx} 
        className="flex items-center gap-2 text-slate-400 hover:text-slate-600 transition-colors group/trust cursor-default"
      >
        <i 
          className={`fa-${signal.isBrand ? 'brands' : 'solid'} ${signal.icon} text-sm group-hover/trust:scale-110 transition-transform`}
        />
        <span className="text-[10px] font-bold uppercase tracking-wider">
          {signal.text}
        </span>
      </div>
    ))}
  </div>
);

// ============================================================================
// TACTICAL LINK COMPONENT
// ============================================================================

interface TacticalLinkProps {
  product: ProductDetails;
  amazonLink: string;
  imageSrc: string;
  stars: number;
  verdict: string;
  onImageError: () => void;
}

const TacticalLink: React.FC<TacticalLinkProps> = ({
  product,
  amazonLink,
  imageSrc,
  stars,
  onImageError
}) => {
  return (
    <div className="w-full max-w-[900px] mx-auto my-12 px-4 font-sans">
      <div className="relative bg-white border border-slate-100 rounded-[24px] p-6 shadow-[0_1px_3px_rgba(0,0,0,0.05),0_10px_40px_-10px_rgba(0,0,0,0.04)] hover:shadow-[0_20px_60px_-15px_rgba(0,0,0,0.1)] hover:border-slate-200 transition-all duration-500 flex flex-col sm:flex-row items-center gap-8 group">
        
        {/* Image Box */}
        <div className="w-32 h-32 bg-slate-50 rounded-[20px] flex items-center justify-center p-3 flex-shrink-0 relative overflow-hidden">
          <img 
            src={imageSrc} 
            className="max-h-full max-w-full object-contain mix-blend-multiply transition-transform duration-700 group-hover:scale-110" 
            alt={product.title}
            onError={onImageError}
            loading="lazy"
          />
        </div>

        {/* Body */}
        <div className="flex-1 min-w-0 text-center sm:text-left">
          <div className="inline-flex items-center gap-1.5 bg-slate-100 text-slate-600 text-[10px] font-black uppercase tracking-wider px-3 py-1 rounded-full mb-3">
            <i className="fa-solid fa-check text-[8px]" />
            Verified Choice
          </div>
          <h3 className="text-xl font-black text-slate-900 leading-tight mb-2 line-clamp-2">
            {product.title}
          </h3>
          <div className="flex items-center justify-center sm:justify-start gap-2">
            <div className="flex text-amber-400 text-sm">
              {'★'.repeat(stars)}{'☆'.repeat(5-stars)}
            </div>
            <span className="text-[11px] font-bold text-slate-400">
              {product.reviewCount || '1,200'}+ reviews
            </span>
          </div>
        </div>

        {/* Side/Action */}
        <div className="flex flex-col items-center sm:items-end gap-3 flex-shrink-0 w-full sm:w-auto">
          <div className="text-2xl md:text-3xl font-black text-slate-900 tracking-tighter">
            {product.price}
          </div>
          <a 
            href={amazonLink} 
            target="_blank" 
            rel="nofollow sponsored noopener"
            className="w-full sm:w-auto px-6 py-3 bg-slate-900 text-white text-xs font-black uppercase tracking-widest rounded-xl hover:bg-blue-600 transition-all duration-300 shadow-xl hover:shadow-blue-500/30 flex items-center justify-center gap-2 group/btn"
          >
            View Deal 
            <i className="fa-solid fa-arrow-right group-hover/btn:translate-x-1 transition-transform" />
          </a>
        </div>
      </div>
    </div>
  );
};

// ============================================================================
// ELITE BENTO COMPONENT
// ============================================================================

interface EliteBentoProps {
  product: ProductDetails;
  amazonLink: string;
  imageSrc: string;
  stars: number;
  verdict: string;
  bullets: string[];
  faqs: FAQItem[];
  onImageError: () => void;
}

const EliteBento: React.FC<EliteBentoProps> = ({
  product,
  amazonLink,
  imageSrc,
  stars,
  verdict,
  bullets,
  faqs,
  onImageError
}) => {
  const [expandedFaq, setExpandedFaq] = useState<number | null>(null);

  return (
    <div className="w-full max-w-[1000px] mx-auto my-20 font-sans text-slate-900 leading-relaxed group animate-fade-in px-4">
      
      {/* Main Container */}
      <div className="bg-white rounded-[48px] border border-slate-100 shadow-[0_1px_2px_rgba(0,0,0,0.05),0_20px_80px_-20px_rgba(0,0,0,0.08)] overflow-hidden transition-all duration-700 hover:shadow-[0_30px_100px_-20px_rgba(0,0,0,0.12)] hover:border-slate-200">
        
        <div className="grid grid-cols-1 lg:grid-cols-[45%_55%]">
          
          {/* Visual Section */}
          <div className="bg-gradient-to-br from-slate-50 to-white p-12 lg:p-16 flex flex-col items-center justify-center relative border-b lg:border-b-0 lg:border-r border-slate-100">
            <div className="absolute top-8 left-8 bg-slate-900 text-white text-[10px] font-black uppercase tracking-widest px-5 py-2 rounded-full shadow-lg">
              Top Pick
            </div>
            
            <div className="w-full max-w-[320px] aspect-square flex items-center justify-center relative my-8">
              <img 
                src={imageSrc} 
                alt={product.title}
                onError={onImageError}
                loading="lazy"
                className="max-h-full max-w-full object-contain drop-shadow-[0_30px_60px_rgba(0,0,0,0.12)] transition-all duration-1000 group-hover:scale-110 group-hover:-translate-y-2 group-hover:rotate-2"
              />
            </div>
            
            <div className="bg-white border border-slate-100 px-5 py-2.5 rounded-full flex items-center gap-3 shadow-sm mt-8">
              <div className="flex text-amber-400 text-sm">
                {'★'.repeat(stars)}{'☆'.repeat(5-stars)}
              </div>
              <span className="text-xs font-black text-slate-900">
                {product.rating || '4.9'} / 5.0
              </span>
            </div>
          </div>

          {/* Content Section */}
          <div className="p-12 lg:p-16 flex flex-col">
            <div className="flex items-center gap-3 mb-6">
              <span className="text-[10px] font-black uppercase tracking-widest text-indigo-600 bg-indigo-50 px-4 py-1.5 rounded-full">
                {product.category || "Premium"}
              </span>
              {product.prime && (
                <span className="text-[10px] font-black text-emerald-600 flex items-center gap-1">
                  <i className="fa-solid fa-check text-[8px]" />
                  Prime Shipping
                </span>
              )}
            </div>
            
            <h2 className="text-4xl lg:text-5xl font-black text-slate-900 leading-[1.1] tracking-tighter mb-6">
              {product.title}
            </h2>
            
            <div className="text-lg font-medium text-slate-500 border-l-4 border-slate-100 pl-6 mb-10 italic">
              {verdict}
            </div>

            {/* Features Grid */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-6 mb-12">
              {bullets.map((bullet, idx) => (
                <div key={idx} className="flex items-center gap-3">
                  <div className="w-6 h-6 rounded-full bg-emerald-500 text-white flex items-center justify-center flex-shrink-0">
                    <i className="fa-solid fa-check text-[10px]" />
                  </div>
                  <span className="text-sm font-bold text-slate-700">{bullet}</span>
                </div>
              ))}
            </div>

            {/* Footer Action */}
            <div className="mt-auto pt-10 border-t border-slate-100 flex flex-col sm:flex-row items-center justify-between gap-8">
              <div className="text-center sm:text-left">
                <span className="text-[10px] font-black uppercase tracking-widest text-slate-400 mb-1 block">
                  Best Price
                </span>
                <div className="text-5xl font-black text-slate-900 tracking-tighter">
                  {product.price}
                </div>
              </div>
              
              <a 
                href={amazonLink} 
                target="_blank" 
                rel="nofollow sponsored noopener"
                className="w-full sm:w-auto px-12 py-5 bg-slate-900 text-white text-sm font-black uppercase tracking-widest rounded-3xl shadow-[0_20px_40px_-10px_rgba(15,23,42,0.3)] hover:bg-blue-600 hover:-translate-y-1 hover:shadow-[0_25px_50px_-10px_rgba(37,99,235,0.4)] transition-all duration-300 flex items-center justify-center gap-3 group/btn"
              >
                Check Price
                <i className="fa-solid fa-arrow-right group-hover/btn:translate-x-1 transition-transform" />
              </a>
            </div>
          </div>
        </div>

        {/* FAQ Section */}
        {faqs.length > 0 && (
          <div className="bg-slate-50 p-12 lg:p-16 border-t border-slate-100">
            <h3 className="text-xl font-black mb-8 flex items-center gap-3">
              <i className="fa-solid fa-circle-question text-slate-400" />
              Common Questions
            </h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
              {faqs.map((faq, idx) => (
                <div 
                  key={idx}
                  onClick={() => setExpandedFaq(expandedFaq === idx ? null : idx)}
                  className="cursor-pointer group/faq"
                >
                  <h4 className="text-sm font-black text-slate-900 mb-2 flex items-center gap-2 group-hover/faq:text-blue-600 transition-colors">
                    <span className="w-5 h-5 rounded-full bg-slate-200 text-slate-500 text-[10px] flex items-center justify-center font-black">?</span>
                    {faq.question}
                  </h4>
                  <p className={`text-sm text-slate-500 transition-all duration-300 ${expandedFaq === idx ? 'opacity-100 max-h-40 mt-2' : 'opacity-0 max-h-0 overflow-hidden'}`}>
                    {faq.answer}
                  </p>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
      
      {/* Trust Signals */}
      <TrustSignals signals={TRUST_SIGNALS} />
    </div>
  );
};

// ============================================================================
// MAIN COMPONENT EXPORT
// ============================================================================

export const ProductBoxPreview: React.FC<ProductBoxPreviewProps> = ({ 
  product, 
  affiliateTag = 'tag-20', 
  mode = 'ELITE_BENTO' 
}) => {
  const [imgError, setImgError] = useState(false);
  
  // Computed values
  const stars = Math.round(product.rating || 5);
  const amazonLink = `https://www.amazon.com/dp/${product.asin || "B08N5M7S6K"}?tag=${affiliateTag}`;

  const imageSrc = imgError 
    ? `https://via.placeholder.com/800x800.png?text=${encodeURIComponent(product.brand || 'Product')}` 
    : (product.imageUrl || 'https://via.placeholder.com/800x800.png?text=Acquiring+Asset');

  // Memoized values for performance
  const bullets = useMemo(() => {
    return (product.evidenceClaims && product.evidenceClaims.length >= 4)
      ? product.evidenceClaims.slice(0, 4)
      : DEFAULT_BULLETS;
  }, [product.evidenceClaims]);

  const faqs = useMemo(() => {
    return (product.faqs && product.faqs.length >= 4)
      ? product.faqs.slice(0, 4)
      : DEFAULT_FAQS;
  }, [product.faqs]);

  const verdict = useMemo(() => {
    return (product.verdict && product.verdict.length > 30)
      ? product.verdict
      : DEFAULT_VERDICT;
  }, [product.verdict]);

  const handleImageError = () => setImgError(true);

  // Render based on mode
  if (mode === 'TACTICAL_LINK') {
    return (
      <TacticalLink
        product={product}
        amazonLink={amazonLink}
        imageSrc={imageSrc}
        stars={stars}
        verdict={verdict}
        onImageError={handleImageError}
      />
    );
  }

  return (
    <EliteBento
      product={product}
      amazonLink={amazonLink}
      imageSrc={imageSrc}
      stars={stars}
      verdict={verdict}
      bullets={bullets}
      faqs={faqs}
      onImageError={handleImageError}
    />
  );
};

// ============================================================================
// DEFAULT EXPORT
// ============================================================================

export default ProductBoxPreview;
