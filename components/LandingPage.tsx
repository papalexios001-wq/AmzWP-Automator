
import React from 'react';

interface LandingPageProps {
  onEnter: () => void;
}

export const LandingPage: React.FC<LandingPageProps> = ({ onEnter }) => {
  return (
    <div className="min-h-screen bg-dark-950 text-white flex flex-col font-sans relative overflow-hidden selection:bg-brand-500 selection:text-white">
      
      {/* Dynamic Background Effects */}
      <div className="absolute inset-0 z-0 pointer-events-none overflow-hidden">
        <div className="absolute top-[-10%] left-[-10%] w-[600px] h-[600px] bg-brand-600/10 rounded-full blur-[120px] animate-pulse-slow"></div>
        <div className="absolute bottom-[-10%] right-[-10%] w-[600px] h-[600px] bg-purple-600/10 rounded-full blur-[120px] animate-pulse-slow" style={{ animationDelay: '2s' }}></div>
      </div>

      {/* Navigation */}
      <nav className="relative z-20 w-full max-w-7xl mx-auto px-6 py-6 md:py-8 flex flex-col md:flex-row justify-between items-center gap-4 md:gap-6">
        {/* Artistic SOTA Logo */}
        <div className="flex items-center gap-3 group cursor-default">
          <div className="relative w-10 h-10 md:w-12 md:h-12 flex items-center justify-center">
            <div className="absolute inset-0 bg-gradient-to-br from-brand-400 to-purple-600 rounded-xl rotate-3 group-hover:rotate-12 transition-transform duration-500 ease-out opacity-80"></div>
            <div className="absolute inset-0 bg-dark-900 rounded-xl rotate-3 scale-90 group-hover:scale-95 transition-transform duration-500"></div>
            <i className="fa-solid fa-rocket text-transparent bg-clip-text bg-gradient-to-br from-brand-400 to-purple-400 text-xl md:text-2xl relative z-10 transform -rotate-3 group-hover:rotate-0 transition-all"></i>
          </div>
          <div className="flex flex-col">
            <span className="text-xl md:text-2xl font-black tracking-tighter leading-none">Amz<span className="text-transparent bg-clip-text bg-gradient-to-r from-brand-400 to-purple-400">Pilot</span></span>
            <span className="text-[8px] md:text-[10px] font-bold uppercase tracking-widest text-gray-500">Autonomous Core</span>
          </div>
        </div>
        
        <a 
          href="https://affiliatemarketingforsuccess.com" 
          target="_blank" 
          rel="noopener noreferrer"
          className="text-[10px] md:text-xs font-bold uppercase tracking-widest text-gray-400 hover:text-brand-400 transition-all border-b border-transparent hover:border-brand-500/50 pb-1 text-center"
        >
          From the creators of AffiliateMarketingForSuccess.com
        </a>
      </nav>

      {/* Hero Section */}
      <main className="relative z-10 flex-1 flex flex-col items-center justify-center text-center px-6 py-12 md:py-24">
        <div className="max-w-5xl mx-auto space-y-8 md:space-y-10 animate-fade-in-up">
          
          <div className="inline-block px-4 py-1.5 rounded-full border border-brand-500/30 bg-brand-500/10 backdrop-blur-sm mb-2">
             <span className="text-brand-300 text-[10px] md:text-xs font-bold uppercase tracking-widest">v3.0 System Online</span>
          </div>

          <h1 className="text-4xl sm:text-5xl md:text-7xl lg:text-8xl font-black leading-tight tracking-tighter">
            Automate Your <br className="hidden sm:block"/>
            <span className="text-transparent bg-clip-text bg-gradient-to-r from-brand-400 via-purple-400 to-pink-400 animate-gradient-x">Affiliate Empire</span>
          </h1>
          
          <p className="text-base md:text-xl text-slate-400 max-w-3xl mx-auto leading-relaxed font-light">
            The world's first <span className="text-white font-medium">Autonomous WordPress Monetization Engine</span>. 
            Scan content, identify opportunities, and deploy high-conversion assets with military-grade precision.
          </p>

          <div className="flex flex-col md:flex-row items-center justify-center gap-4 md:gap-6 pt-4 md:pt-8 w-full">
            <button 
              onClick={onEnter}
              className="w-full md:w-auto group relative px-8 py-4 md:py-5 bg-white text-dark-950 font-black text-base md:text-lg rounded-2xl shadow-[0_0_40px_-10px_rgba(255,255,255,0.3)] hover:shadow-[0_0_60px_-15px_rgba(255,255,255,0.5)] hover:scale-105 transition-all duration-300 overflow-hidden"
            >
              <div className="absolute inset-0 bg-gradient-to-r from-gray-100 to-white opacity-0 group-hover:opacity-100 transition-opacity"></div>
              <span className="relative z-10 flex items-center justify-center gap-3">
                Initialize App <i className="fa-solid fa-arrow-right group-hover:translate-x-1 transition-transform"></i>
              </span>
            </button>

            <a 
              href="https://seo-hub.affiliatemarketingforsuccess.com/"
              target="_blank"
              rel="noopener noreferrer"
              className="w-full md:w-auto px-6 md:px-8 py-4 md:py-5 rounded-2xl border border-brand-500/30 bg-dark-900/50 hover:bg-brand-900/20 text-brand-300 hover:text-brand-200 font-bold transition-all duration-300 flex items-center justify-center gap-3 shadow-lg hover:shadow-brand-500/20 backdrop-blur-sm group text-sm md:text-base"
            >
              <i className="fa-solid fa-gem text-brand-500 group-hover:scale-110 transition-transform"></i> 
              <span className="text-center">Unlock Your Complete AI-Powered SEO Arsenal</span>
            </a>
          </div>

        </div>
      </main>

      {/* SOTA Footer */}
      <footer className="relative z-10 bg-dark-950/80 border-t border-dark-800/50 backdrop-blur-xl mt-auto">
        <div className="max-w-7xl mx-auto px-6 py-12 md:py-16">
          <div className="flex flex-col lg:flex-row justify-between items-center lg:items-start gap-10 md:gap-12">
            
            {/* Brand / Owner Column */}
            <div className="flex flex-col items-center lg:items-start text-center lg:text-left space-y-6 max-w-md">
               <a href="https://affiliatemarketingforsuccess.com" target="_blank" rel="noopener noreferrer" className="block hover:opacity-80 transition-opacity">
                 <img 
                   src="https://affiliatemarketingforsuccess.com/wp-content/uploads/2023/03/cropped-Affiliate-Marketing-for-Success-Logo-Edited.png?lm=6666FEE0" 
                   alt="Affiliate Marketing For Success" 
                   className="h-12 md:h-16 w-auto mx-auto lg:mx-0"
                 />
               </a>
               <div className="space-y-2">
                 <p className="text-sm text-gray-400 font-medium">
                   This App is Created by <span className="text-white font-bold">Alexios Papaioannou</span>
                 </p>
                 <p className="text-[10px] md:text-xs text-brand-500 uppercase tracking-widest font-bold">
                   Owner of affiliatemarketingforsuccess.com
                 </p>
               </div>
            </div>

            {/* Links Grid */}
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-x-4 md:gap-x-8 gap-y-4 w-full lg:w-auto">
               {[
                 { name: "Affiliate Marketing", url: "https://affiliatemarketingforsuccess.com/affiliate-marketing" },
                 { name: "AI", url: "https://affiliatemarketingforsuccess.com/ai" },
                 { name: "SEO", url: "https://affiliatemarketingforsuccess.com/seo" },
                 { name: "Blogging", url: "https://affiliatemarketingforsuccess.com/blogging" },
                 { name: "Reviews", url: "https://affiliatemarketingforsuccess.com/review" }
               ].map((link) => (
                 <a 
                   key={link.name} 
                   href={link.url}
                   target="_blank"
                   rel="noopener noreferrer" 
                   className="group flex items-center gap-2 text-[11px] md:text-sm font-medium text-gray-500 hover:text-white transition-colors p-2 rounded-lg hover:bg-white/5"
                 >
                   <span className="w-1.5 h-1.5 rounded-full bg-brand-500/50 group-hover:bg-brand-400 transition-colors"></span>
                   {link.name}
                 </a>
               ))}
            </div>
          </div>
          
          <div className="mt-12 md:mt-16 pt-8 border-t border-dark-800/50 text-center flex flex-col md:flex-row justify-between items-center gap-4 text-[10px] md:text-xs text-gray-600">
            <p>&copy; {new Date().getFullYear()} Alexios Papaioannou. All rights reserved.</p>
            <div className="flex gap-4">
              <a href="#" className="hover:text-gray-400 cursor-pointer transition-colors">Privacy Policy</a>
              <a href="#" className="hover:text-gray-400 cursor-pointer transition-colors">Terms of Service</a>
            </div>
          </div>
        </div>
      </footer>
    </div>
  );
};
