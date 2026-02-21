import React, { useState } from 'react';
import { AppConfig, AIProvider } from '../types';
import { testConnection, SecureStorage } from '../utils';
import Toastify from 'toastify-js';

interface ConfigPanelProps {
  onSave: (config: AppConfig) => void;
  initialConfig: AppConfig;
}

export const ConfigPanel: React.FC<ConfigPanelProps> = ({ onSave, initialConfig }) => {
  const [config, setConfig] = useState<AppConfig>({
      ...initialConfig,
      amazonAccessKey: SecureStorage.decrypt(initialConfig.amazonAccessKey || ''),
      amazonSecretKey: SecureStorage.decrypt(initialConfig.amazonSecretKey || ''),
  });
  
  const [isOpen, setIsOpen] = useState(false);
  const [activeTab, setActiveTab] = useState<'wp' | 'amazon' | 'ai' | 'sota'>('wp');
  const [testStatus, setTestStatus] = useState<'idle' | 'testing' | 'success' | 'error'>('idle');

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSave({
        ...config,
        amazonAccessKey: SecureStorage.encrypt(config.amazonAccessKey),
        amazonSecretKey: SecureStorage.encrypt(config.amazonSecretKey)
    });
    setIsOpen(false);
  };

  const handleTestConnection = async () => {
      setTestStatus('testing');
      const result = await testConnection(config);
      if (result.success) {
          setTestStatus('success');
          Toastify({ text: "Connected to WordPress!", backgroundColor: "#10b981" }).showToast();
      } else {
          setTestStatus('error');
          Toastify({ text: result.message, duration: 4000, backgroundColor: "#ef4444" }).showToast();
      }
  };

  return (
    <>
      <button onClick={() => setIsOpen(true)} className="fixed top-4 left-4 z-50 bg-dark-900/50 backdrop-blur p-4 rounded-2xl text-brand-400 border border-dark-700 hover:scale-110 transition-transform shadow-2xl">
         <i className="fa-solid fa-gear text-xl"></i>
      </button>

      {isOpen && (
      <div className="fixed inset-0 z-[100] bg-black/90 backdrop-blur-xl flex items-center justify-center p-2 md:p-4">
        <div className="bg-dark-900 border border-dark-800 w-full max-w-2xl rounded-[24px] md:rounded-[32px] shadow-2xl flex flex-col max-h-[95vh] md:max-h-[90vh] overflow-hidden">
          
          <div className="flex justify-between items-center p-6 md:p-8 border-b border-dark-800">
            <h2 className="text-2xl md:text-3xl font-black text-white tracking-tighter">System Configuration</h2>
            <button onClick={() => setIsOpen(false)} className="text-gray-400 hover:text-white"><i className="fa-solid fa-times text-xl"></i></button>
          </div>

          <div className="flex border-b border-dark-800 bg-dark-950/50 overflow-x-auto scrollbar-hide">
             {['wp', 'amazon', 'ai', 'sota'].map(t => (
                 <button key={t} onClick={() => setActiveTab(t as any)} className={`flex-1 min-w-[100px] py-4 text-[9px] md:text-[10px] font-black uppercase tracking-widest transition-all ${activeTab === t ? 'text-brand-400 border-b-2 border-brand-500' : 'text-gray-500'}`}>
                     {t === 'wp' ? 'WordPress' : t === 'amazon' ? 'Amazon' : t === 'ai' ? 'Brain Core' : 'SOTA Flags'}
                 </button>
             ))}
          </div>

          <form onSubmit={handleSubmit} className="p-6 md:p-8 overflow-y-auto space-y-6 custom-scrollbar">
            
            {activeTab === 'wp' && (
                <div className="space-y-4 animate-fade-in">
                    <div>
                        <label className="text-[9px] md:text-[10px] text-brand-500 font-black uppercase tracking-widest mb-2 block">Site URL</label>
                        <input type="url" className="w-full bg-dark-950 border border-dark-700 rounded-xl px-4 py-3 text-white focus:border-brand-500 outline-none transition-colors text-sm" placeholder="https://mysite.com" value={config.wpUrl} onChange={e => setConfig({...config, wpUrl: e.target.value})} required />
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                        <input type="text" className="bg-dark-950 border border-dark-700 rounded-xl px-4 py-3 text-white outline-none text-sm" placeholder="Username" value={config.wpUser} onChange={e => setConfig({...config, wpUser: e.target.value})} required />
                        <input type="password" className="bg-dark-950 border border-dark-700 rounded-xl px-4 py-3 text-white outline-none text-sm" placeholder="App Password" value={config.wpAppPassword} onChange={e => setConfig({...config, wpAppPassword: e.target.value})} required />
                    </div>
                    <button type="button" onClick={handleTestConnection} className="w-full bg-dark-800 py-3 rounded-xl text-[11px] font-bold text-gray-400 border border-dark-700 hover:bg-dark-700 transition-colors">
                        {testStatus === 'testing' ? <i className="fa-solid fa-spinner fa-spin mr-2"></i> : null}
                        Test WP API Link
                    </button>
                </div>
            )}

            {activeTab === 'amazon' && (
                <div className="space-y-4 animate-fade-in">
                    <input type="text" className="w-full bg-dark-950 border border-dark-700 rounded-xl px-4 py-3 text-white outline-none text-sm" placeholder="Associate Tag (e.g. tag-20)" value={config.amazonTag} onChange={e => setConfig({...config, amazonTag: e.target.value})} required />
                    <input type="text" className="w-full bg-dark-950 border border-dark-700 rounded-xl px-4 py-3 text-white outline-none text-sm" placeholder="SerpApi Key (Required for Product Lookup)" value={config.serpApiKey || ''} onChange={e => setConfig({...config, serpApiKey: e.target.value})} />
                    <div className="p-4 bg-amber-500/10 border border-amber-500/30 rounded-xl">
                      <p className="text-[11px] text-amber-400 leading-relaxed">
                        <i className="fa-solid fa-triangle-exclamation mr-2"></i>
                        SerpApi key is required for accurate product images and data. Get one at <a href="https://serpapi.com" target="_blank" rel="noopener" className="underline">serpapi.com</a>
                      </p>
                    </div>
                </div>
            )}

            {activeTab === 'ai' && (
                <div className="space-y-4 animate-fade-in">
                    <select className="w-full bg-dark-950 border border-dark-700 rounded-xl px-4 py-3 text-white outline-none text-sm" value={config.aiProvider} onChange={e => setConfig({...config, aiProvider: e.target.value as AIProvider})}>
                        <option value="gemini">Google Gemini</option>
                        <option value="openai">OpenAI (Coming Soon)</option>
                    </select>
                    <select className="w-full bg-dark-950 border border-dark-700 rounded-xl px-4 py-3 text-white outline-none text-sm" value={config.aiModel} onChange={e => setConfig({...config, aiModel: e.target.value})}>
                        <option value="gemini-2.0-flash">Gemini 2.0 Flash (Recommended)</option>
                        <option value="gemini-1.5-flash">Gemini 1.5 Flash (Fallback)</option>
                        <option value="gemini-1.5-pro">Gemini 1.5 Pro (High Quality)</option>
                    </select>
                    <div className="p-4 bg-blue-500/10 border border-blue-500/30 rounded-xl">
                      <p className="text-[11px] text-blue-400 leading-relaxed">
                        <i className="fa-solid fa-info-circle mr-2"></i>
                        Gemini 2.0 Flash provides the best balance of speed and accuracy for product extraction.
                      </p>
                    </div>
                </div>
            )}

            {activeTab === 'sota' && (
                <div className="space-y-4 animate-fade-in">
                    <div className="flex items-center justify-between p-4 bg-dark-950 border border-dark-700 rounded-2xl">
                        <span className="text-[11px] font-bold">Inject JSON-LD Schema</span>
                        <input type="checkbox" checked={config.enableSchema} onChange={e => setConfig({...config, enableSchema: e.target.checked})} className="w-5 h-5 accent-brand-500" />
                    </div>
                    <div className="flex items-center justify-between p-4 bg-dark-950 border border-dark-700 rounded-2xl">
                        <span className="text-[11px] font-bold">Precision Placement (Auto-Intro/Outro)</span>
                        <input type="checkbox" checked={config.enableStickyBar} onChange={e => setConfig({...config, enableStickyBar: e.target.checked})} className="w-5 h-5 accent-brand-500" />
                    </div>
                </div>
            )}

            <button type="submit" className="w-full bg-brand-600 hover:bg-brand-500 text-white font-black py-4 rounded-2xl shadow-xl transition-all text-xs uppercase tracking-widest">Save System Config</button>
          </form>
        </div>
      </div>
      )}
    </>
  );
};
