
import React, { useState, useEffect, Dispatch, SetStateAction } from 'react';
import { BlogPost, ProductDetails, AppConfig, DeploymentMode, ComparisonData, CarouselData } from '../types';
import { pushToWordPress, fetchRawPostContent, analyzeContentAndFindProduct, splitContentIntoBlocks, IntelligenceCache, generateProductBoxHtml, generateComparisonTableHtml, generateCarouselHtml } from '../utils';
import { ProductBoxPreview } from './ProductBoxPreview';
import { ComparisonTablePreview } from './ComparisonTablePreview';
import { CarouselPreview } from './CarouselPreview';
import Toastify from 'toastify-js';

interface PostEditorProps {
    post: BlogPost;
    config: AppConfig;
    onBack: () => void;
    allPosts?: BlogPost[];
    onSwitchPost?: Dispatch<SetStateAction<BlogPost | null>>;
}

interface EditorNode {
    id: string;
    type: 'HTML' | 'PRODUCT' | 'COMPARISON' | 'CAROUSEL';
    content?: string;
    productId?: string;
    comparisonData?: ComparisonData; // Only for COMPARISON type
    carouselData?: CarouselData; // Only for CAROUSEL type
}

export const PostEditor: React.FC<PostEditorProps> = ({ post, config, onBack }) => {
    // Core State
    const [editorNodes, setEditorNodes] = useState<EditorNode[]>([]);
    const [productMap, setProductMap] = useState<Record<string, ProductDetails>>({});
    const [currentId, setCurrentId] = useState<number>(post.id);
    const [status, setStatus] = useState<'idle' | 'fetching' | 'analyzing' | 'pushing' | 'error'>('idle');
    const [viewTab, setViewTab] = useState<'visual' | 'code'>('visual');
    const [hoveredNode, setHoveredNode] = useState<string | null>(null);
    const [showAssetsDeck, setShowAssetsDeck] = useState(false);

    // Initialization Logic
    useEffect(() => {
        const init = async () => {
            setStatus('fetching');
            try {
                // 1. Fetch Content
                const result = await fetchRawPostContent(config, post.id, post.url || "");
                setCurrentId(result.resolvedId);
                
                // 2. Hydrate Products from Cache or Props
                let initialProducts = post.activeProducts || [];
                const contentHash = `v3_${post.title}_${result.content.length}`;
                const cached = IntelligenceCache.getAnalysis(contentHash);
                
                let initialComparison: ComparisonData | undefined = undefined;
                let initialCarousel: CarouselData | undefined = undefined;

                if (cached) {
                    if (initialProducts.length === 0) initialProducts = cached.products;
                    if (cached.comparison) initialComparison = cached.comparison;
                    if (cached.carousel) initialCarousel = cached.carousel;
                }

                // 3. Build Product Map
                const pMap: Record<string, ProductDetails> = {};
                initialProducts.forEach(p => pMap[p.id] = p);
                setProductMap(pMap);

                // 4. Construct Editor Nodes
                const rawBlocks = splitContentIntoBlocks(result.content || '');
                const nodes: EditorNode[] = [];
                
                rawBlocks.forEach((block, idx) => {
                    nodes.push({ id: `block-${Date.now()}-${idx}`, type: 'HTML', content: block });
                });

                // Initial Placement Strategy
                const placedProducts = initialProducts.filter(p => p.insertionIndex > -1).sort((a, b) => a.insertionIndex - b.insertionIndex);
                
                let offset = 0;
                placedProducts.forEach(p => {
                    const targetIndex = Math.min(p.insertionIndex + offset, nodes.length);
                    nodes.splice(targetIndex, 0, { id: `prod-node-${p.id}`, type: 'PRODUCT', productId: p.id });
                    offset++;
                });

                // Auto-inject comparison table if detected and not present
                if (initialComparison) {
                    nodes.splice(1, 0, { // Inject after first block (usually Intro)
                        id: `comp-table-${Date.now()}`,
                        type: 'COMPARISON',
                        comparisonData: initialComparison
                    });
                    offset++;
                }

                // Auto-inject carousel if detected
                if (initialCarousel) {
                    nodes.push({
                        id: `carousel-${Date.now()}`,
                        type: 'CAROUSEL',
                        carouselData: initialCarousel
                    });
                }

                setEditorNodes(nodes);
                setStatus('idle');
            } catch (e: any) {
                setStatus('error');
                Toastify({ text: "Intelligence Protocol Link Failure", style: { background: "#ef4444" } }).showToast();
            }
        };
        init();
    }, [post.id, config]);

    // --- RELEVANCE ENGINE ---

    const calculateRelevance = (text: string, product: ProductDetails) => {
        const cleanText = text.toLowerCase();
        // Weighted Keywords
        const titleWords = product.title.toLowerCase().split(/\s+/).filter(w => w.length > 3);
        const brand = product.brand?.toLowerCase();
        
        let score = 0;
        
        // Exact Title Match (Highest Confidence)
        if (cleanText.includes(product.title.toLowerCase())) score += 100;
        
        // Brand Mention
        if (brand && cleanText.includes(brand)) score += 20;
        
        // Keyword density
        titleWords.forEach(word => {
            if (cleanText.includes(word)) score += 5;
        });

        // Negative heuristic: Don't place inside very short blocks (likely headers) unless exact match
        if (text.length < 50 && score < 50) score -= 10;

        return score;
    };

    const findBestInsertionIndex = (product: ProductDetails, nodesSnapshot: EditorNode[]) => {
        let bestIndex = 0;
        let maxScore = -1;

        nodesSnapshot.forEach((node, idx) => {
            if (node.type === 'HTML' && node.content) {
                const score = calculateRelevance(node.content, product);
                // We want to insert AFTER the relevant block
                if (score > maxScore) {
                    maxScore = score;
                    bestIndex = idx;
                }
            }
        });
        
        // Return index + 1 to insert *after* the matched block
        return bestIndex + 1;
    };

    const getContextualProducts = (nodeIndex: number) => {
        const unplaced = getUnplacedProducts();
        const prevNode = editorNodes[nodeIndex]; // The node we are appending AFTER
        
        if (!prevNode || prevNode.type !== 'HTML' || !prevNode.content) return unplaced;

        // Sort unplaced products by relevance to the preceding block
        return [...unplaced].sort((a, b) => {
            const scoreA = calculateRelevance(prevNode.content!, a);
            const scoreB = calculateRelevance(prevNode.content!, b);
            return scoreB - scoreA; // Descending score
        });
    };

    // --- ACTIONS ---

    const injectProduct = (productId: string, index: number) => {
        const newNode: EditorNode = { id: `prod-node-${productId}-${Date.now()}`, type: 'PRODUCT', productId };
        const newNodes = [...editorNodes];
        newNodes.splice(index, 0, newNode);
        setEditorNodes(newNodes);
        Toastify({ text: "Asset Injected to Canvas", style: { background: "#10b981" } }).showToast();
    };

    const smartInjectProduct = (productId: string) => {
        const product = productMap[productId];
        if (!product) return;
        
        const targetIndex = findBestInsertionIndex(product, editorNodes);
        injectProduct(productId, targetIndex);
        Toastify({ text: `Auto-Placed: ${product.title.substring(0, 20)}...`, style: { background: "#3b82f6" } }).showToast();
    };

    const handleAutoPopulate = () => {
        const unplaced = getUnplacedProducts();
        if (unplaced.length === 0) {
             Toastify({ text: "All Assets Already Deployed", style: { background: "#f59e0b" } }).showToast();
             return;
        }

        let newNodes = [...editorNodes];
        let injectedCount = 0;

        unplaced.forEach(p => {
             let bestIdx = 0;
             let maxScore = -1;
             
             newNodes.forEach((node, idx) => {
                if (node.type === 'HTML' && node.content) {
                    const score = calculateRelevance(node.content, p);
                    if (score > maxScore) {
                        maxScore = score;
                        bestIdx = idx;
                    }
                }
             });
             
             const newNode: EditorNode = { id: `prod-node-${p.id}-${Date.now()}`, type: 'PRODUCT', productId: p.id };
             newNodes.splice(bestIdx + 1, 0, newNode);
             injectedCount++;
        });

        setEditorNodes(newNodes);
        Toastify({ text: `Sovereign Automation: ${injectedCount} Assets Deployed`, style: { background: "#3b82f6" } }).showToast();
    };

    // --- STANDARD OPERATIONS ---

    const runDeepScan = async () => {
        setStatus('analyzing');
        try {
            const currentHtml = editorNodes.filter(n => n.type === 'HTML').map(n => n.content).join('');
            const res = await analyzeContentAndFindProduct(post.title, currentHtml, config);
            
            // Handle Products
            if (res.detectedProducts.length > 0) {
                const newPMap = { ...productMap };
                res.detectedProducts.forEach(p => newPMap[p.id] = p);
                setProductMap(newPMap);
                Toastify({ text: `Deep Scan Protocol Locked: ${res.detectedProducts.length} Assets Registered`, style: { background: "#3b82f6" } }).showToast();
            } else {
                Toastify({ text: "Zero Match: No monetization entities mapped.", style: { background: "#f59e0b" } }).showToast();
            }

            // Handle Comparison Table
            if (res.comparison) {
                // Remove existing comparison nodes if any to prevent dups (optional, simplified here to just add)
                const newNodes = [...editorNodes];
                // Inject near top
                newNodes.splice(1, 0, {
                    id: `comp-table-${Date.now()}`,
                    type: 'COMPARISON',
                    comparisonData: res.comparison
                });
                setEditorNodes(newNodes);
                Toastify({ text: "Comparison Matrix Generated", style: { background: "#8b5cf6" } }).showToast();
            }

            // Handle Carousel
            if (res.carousel) {
                setEditorNodes(prev => [...prev, {
                    id: `carousel-${Date.now()}`,
                    type: 'CAROUSEL',
                    carouselData: res.carousel
                }]);
                Toastify({ text: "Product Carousel Deployed", style: { background: "#ec4899" } }).showToast();
            }

        } catch (e: any) {
            console.error(e);
            // SOTA Error Reporting: Show exact error from the utility function
            const errorMsg = e.message || "Unknown error";
            const displayMsg = errorMsg.length > 80 ? errorMsg.substring(0, 77) + "..." : errorMsg;
            Toastify({ text: `Intelligence Failure: ${displayMsg}`, duration: 5000, style: { background: "#ef4444" } }).showToast();
        } finally { setStatus('idle'); }
    };

    const deleteNode = (id: string) => {
        setEditorNodes(prev => prev.filter(n => n.id !== id));
        Toastify({ text: "Block Extinguished", style: { background: "#ef4444" } }).showToast();
    };

    const moveNode = (index: number, direction: -1 | 1) => {
        const newNodes = [...editorNodes];
        if (index + direction < 0 || index + direction >= newNodes.length) return;
        [newNodes[index], newNodes[index + direction]] = [newNodes[index + direction], newNodes[index]];
        setEditorNodes(newNodes);
    };

    const updateHtmlNode = (id: string, newContent: string) => {
        setEditorNodes(prev => prev.map(n => n.id === id ? { ...n, content: newContent } : n));
    };

    const cleanImagesFromBlock = (id: string) => {
        const node = editorNodes.find(n => n.id === id);
        if (!node || !node.content) return;
        const cleanContent = node.content.replace(/<img[^>]*>/g, "");
        updateHtmlNode(id, cleanContent);
        Toastify({ text: "Visual Artifacts Purged from Block", style: { background: "#f59e0b" } }).showToast();
    };

    const updateProductMode = (id: string, mode: DeploymentMode) => {
        setProductMap(prev => ({ ...prev, [id]: { ...prev[id], deploymentMode: mode } }));
    };

    const getUnplacedProducts = () => {
        const placedIds = new Set(editorNodes.filter(n => n.type === 'PRODUCT').map(n => n.productId));
        return Object.values(productMap).filter(p => !placedIds.has(p.id));
    };

    const generateFinalHtml = () => {
        return editorNodes.map(node => {
            if (node.type === 'HTML') return node.content;
            if (node.type === 'PRODUCT' && node.productId && productMap[node.productId]) {
                return generateProductBoxHtml(productMap[node.productId], config.amazonTag, productMap[node.productId].deploymentMode);
            }
            if (node.type === 'COMPARISON' && node.comparisonData) {
                return generateComparisonTableHtml(node.comparisonData, Object.values(productMap), config.amazonTag);
            }
            if (node.type === 'CAROUSEL' && node.carouselData) {
                return generateCarouselHtml(node.carouselData, Object.values(productMap), config.amazonTag);
            }
            return '';
        }).join('\n\n');
    };

    const handlePush = async () => {
        setStatus('pushing');
        try {
            const html = generateFinalHtml();
            const link = await pushToWordPress(config, currentId, html);
            Toastify({ text: "Production Sync Successful", style: { background: "#10b981" } }).showToast();
            window.open(link, '_blank');
        } catch (e: any) {
            console.error(e);
            const msg = e.message.length > 100 ? e.message.substring(0, 97) + "..." : e.message;
            Toastify({ text: msg, duration: 5000, style: { background: "#ef4444" } }).showToast();
        } finally { setStatus('idle'); }
    };

    return (
        <div className="flex h-full bg-dark-950 flex-col md:flex-row overflow-hidden animate-fade-in font-sans relative">
            
            {/* Mobile Assets Deck Overlay */}
            {showAssetsDeck && (
                <div 
                    className="fixed inset-0 bg-dark-950/80 backdrop-blur-sm z-40 md:hidden animate-fade-in"
                    onClick={() => setShowAssetsDeck(false)}
                />
            )}

            {/* --- LEFT CONTROL PANEL (Assets Deck) --- */}
            <div className={`
                fixed inset-y-0 left-0 w-full sm:w-[420px] bg-[#0b1121] border-r border-dark-800 flex flex-col h-full z-50 shadow-[10px_0_30px_rgba(0,0,0,0.3)] transition-transform duration-500 md:relative md:translate-x-0
                ${showAssetsDeck ? 'translate-x-0' : '-translate-x-full'}
            `}>
                {/* Header */}
                <div className="p-6 md:p-8 border-b border-dark-800 bg-dark-950/50 backdrop-blur-md">
                    <div className="flex items-center justify-between mb-6">
                        <button onClick={onBack} className="text-gray-500 text-[10px] font-black uppercase tracking-[4px] hover:text-white transition-all flex items-center gap-3 group">
                            <i className="fa-solid fa-arrow-left group-hover:-translate-x-1 transition-transform"></i> <span className="hidden sm:inline">Return to Command</span><span className="sm:hidden">Back</span>
                        </button>
                        <button 
                            onClick={() => setShowAssetsDeck(false)}
                            className="md:hidden w-10 h-10 rounded-full bg-dark-800 text-gray-400 flex items-center justify-center"
                        >
                            <i className="fa-solid fa-xmark"></i>
                        </button>
                    </div>
                    <div className="flex items-center justify-between">
                        <h1 className="text-xl font-black text-white tracking-tight">Assets <span className="text-brand-500">deck</span></h1>
                        <div className="flex gap-3">
                            <button onClick={() => { IntelligenceCache.clear(); window.location.reload(); }} className="w-8 h-8 rounded-full bg-dark-800 hover:bg-red-500/20 text-gray-400 hover:text-red-500 flex items-center justify-center transition-all" title="Clear Cache"><i className="fa-solid fa-trash-can text-xs"></i></button>
                        </div>
                    </div>
                </div>

                {/* Scan & Unused Assets */}
                <div className="flex-1 overflow-y-auto p-6 md:p-8 space-y-8 md:space-y-10 custom-scrollbar">
                    
                    {/* Deep Scan Card */}
                    <div className="relative overflow-hidden rounded-[24px] md:rounded-[32px] bg-gradient-to-br from-brand-900/20 to-dark-900 border border-brand-500/20 p-6 md:p-8 group">
                        <div className="absolute top-0 right-0 w-32 h-32 bg-brand-500/10 blur-[60px] rounded-full"></div>
                        <h3 className="text-brand-400 font-black uppercase tracking-[4px] text-[10px] md:text-[11px] mb-2">Deep Intelligence</h3>
                        <p className="text-slate-400 text-[11px] md:text-xs mb-6 leading-relaxed">Analyze content DNA to extract monetization nodes.</p>
                        <div className="flex gap-2">
                             <button onClick={() => { runDeepScan(); setShowAssetsDeck(false); }} disabled={status !== 'idle'} className="flex-1 py-4 bg-brand-600 hover:bg-brand-500 text-white rounded-xl text-xs font-black uppercase tracking-widest shadow-lg transition-all flex items-center justify-center gap-2">
                                {status === 'analyzing' ? <i className="fa-solid fa-spinner fa-spin"></i> : <i className="fa-solid fa-bolt"></i>}
                                <span>Scan</span>
                            </button>
                        </div>
                    </div>

                    {/* Draggable/Injectable Assets */}
                    <div>
                        <div className="flex items-center justify-between mb-6">
                            <h3 className="text-gray-500 font-black uppercase tracking-[4px] text-[9px] md:text-[10px]">Staging Area</h3>
                            <span className="bg-dark-800 text-gray-400 px-3 py-1 rounded-full text-[9px] md:text-[10px] font-bold">{getUnplacedProducts().length}</span>
                        </div>
                        
                        <div className="space-y-4">
                            {getUnplacedProducts().length === 0 ? (
                                <div className="p-8 border-2 border-dashed border-dark-800 rounded-2xl md:rounded-3xl text-center">
                                    <div className="text-dark-700 mb-2 text-2xl"><i className="fa-brands fa-dropbox"></i></div>
                                    <div className="text-dark-600 text-[9px] md:text-[10px] font-black uppercase tracking-widest">Queue Empty</div>
                                </div>
                            ) : (
                                getUnplacedProducts().map(p => (
                                    <div key={p.id} className="bg-dark-900 border border-dark-700 p-4 rounded-xl md:rounded-2xl flex items-center gap-4 group hover:border-brand-500 transition-all">
                                        <img src={p.imageUrl} className="w-10 h-10 md:w-12 md:h-12 object-contain bg-white rounded-lg p-1" />
                                        <div className="flex-1 min-w-0">
                                            <div className="text-white font-bold text-xs md:text-sm truncate">{p.title}</div>
                                            <div className="text-brand-400 text-[9px] md:text-[10px] font-black tracking-wider">{p.price}</div>
                                        </div>
                                        <button 
                                            onClick={() => { smartInjectProduct(p.id); setShowAssetsDeck(false); }} 
                                            className="w-8 h-8 rounded-full bg-brand-600 text-white flex items-center justify-center shadow-lg hover:scale-110 transition-transform hover:bg-white hover:text-brand-600"
                                            title="Smart Auto-Inject"
                                        >
                                            <i className="fa-solid fa-wand-magic-sparkles text-[10px]"></i>
                                        </button>
                                    </div>
                                ))
                            )}
                        </div>
                    </div>
                </div>

                {/* Push Action */}
                <div className="p-6 md:p-8 bg-dark-950 border-t border-dark-800">
                    <button onClick={handlePush} disabled={status !== 'idle'} className="w-full py-4 md:py-6 bg-white text-dark-950 rounded-xl md:rounded-[20px] font-black uppercase tracking-[2px] md:tracking-[4px] text-xs md:text-sm shadow-[0_0_30px_rgba(255,255,255,0.1)] hover:shadow-[0_0_50px_rgba(255,255,255,0.2)] hover:scale-[1.02] transition-all flex items-center justify-center gap-3">
                        {status === 'pushing' ? <i className="fa-solid fa-circle-notch fa-spin"></i> : <i className="fa-solid fa-cloud-arrow-up"></i>}
                        <span>Deploy Live</span>
                    </button>
                </div>
            </div>

            {/* --- RIGHT VISUAL ARCHITECT --- */}
            <div className="flex-1 bg-slate-50 relative flex flex-col h-full overflow-hidden">
                
                {/* Global Toolbar */}
                <div className="absolute top-4 md:top-6 left-0 right-0 px-4 md:px-0 z-40 flex flex-col sm:flex-row items-center justify-center gap-3 md:gap-4">
                    
                    <div className="flex items-center gap-2 md:gap-4 w-full sm:w-auto justify-center">
                        <button 
                            onClick={() => setShowAssetsDeck(true)}
                            className="md:hidden w-11 h-11 rounded-full bg-dark-950 text-white flex items-center justify-center shadow-2xl border border-white/10"
                        >
                            <i className="fa-solid fa-box-open text-xs"></i>
                        </button>

                        {/* View Toggles */}
                        <div className="bg-white/80 backdrop-blur-xl border border-white/20 shadow-2xl rounded-full p-1 flex gap-1 md:gap-2">
                            {['visual', 'code'].map((v) => (
                                <button 
                                    key={v}
                                    onClick={() => setViewTab(v as any)}
                                    className={`px-4 md:px-8 py-2 md:py-3 rounded-full text-[8px] md:text-[10px] font-black uppercase tracking-[2px] md:tracking-[3px] transition-all ${viewTab === v ? 'bg-dark-950 text-white shadow-lg' : 'text-slate-400 hover:text-slate-600 hover:bg-slate-100'}`}
                                >
                                    {v === 'visual' ? 'Visual' : 'Code'}
                                </button>
                            ))}
                        </div>

                        {/* Auto-Deploy Button */}
                        <button 
                            onClick={handleAutoPopulate}
                            disabled={getUnplacedProducts().length === 0}
                            className="h-[40px] md:h-[46px] px-4 md:px-8 bg-brand-600 text-white rounded-full text-[8px] md:text-[10px] font-black uppercase tracking-[2px] md:tracking-[3px] shadow-2xl hover:bg-brand-500 hover:scale-105 disabled:opacity-50 disabled:scale-100 transition-all flex items-center gap-2"
                            title="Automatically place ALL products based on context"
                        >
                             <i className="fa-solid fa-wand-magic-sparkles"></i> <span className="hidden sm:inline">Auto-Deploy All</span>
                        </button>
                    </div>
                </div>

                {/* Canvas Area */}
                <div className="flex-1 overflow-y-auto overflow-x-hidden p-4 md:p-20 pt-24 md:pt-32 custom-scrollbar">
                    {viewTab === 'visual' ? (
                        <div className="max-w-[1000px] mx-auto min-h-screen bg-white rounded-[32px] md:rounded-[60px] shadow-[0_40px_100px_-30px_rgba(0,0,0,0.08)] border border-slate-100 p-6 md:p-24 relative">
                            
                            {/* Document Title (Read Only Preview) */}
                            <h1 className="text-2xl md:text-6xl font-black text-slate-900 tracking-tighter mb-8 md:text-center md:mb-16 leading-tight border-b border-slate-100 pb-6 md:pb-10">
                                {post.title}
                            </h1>

                            <div className="space-y-4">
                                {editorNodes.map((node, index) => (
                                    <div 
                                        key={node.id}
                                        onMouseEnter={() => setHoveredNode(node.id)}
                                        onMouseLeave={() => setHoveredNode(null)}
                                        className={`relative group/node transition-all duration-300 rounded-[20px] md:rounded-[32px] border-2 ${hoveredNode === node.id ? 'border-brand-100 bg-brand-50/10' : 'border-transparent'}`}
                                    >
                                        
                                        {/* --- BLOCK CONTROLS (Floating Glass) --- */}
                                        <div className={`absolute -right-2 md:-right-14 top-2 md:top-4 flex md:flex-col gap-1 md:gap-2 transition-all duration-300 z-30 ${hoveredNode === node.id ? 'opacity-100 translate-x-0' : 'opacity-0 md:-translate-x-4 pointer-events-none'}`}>
                                            <button onClick={() => moveNode(index, -1)} className="w-8 h-8 md:w-10 md:h-10 rounded-full bg-white text-slate-400 hover:text-brand-500 shadow-xl border border-slate-100 flex items-center justify-center transition-all hover:scale-110" title="Move Up"><i className="fa-solid fa-arrow-up text-[10px]"></i></button>
                                            <button onClick={() => moveNode(index, 1)} className="w-8 h-8 md:w-10 md:h-10 rounded-full bg-white text-slate-400 hover:text-brand-500 shadow-xl border border-slate-100 flex items-center justify-center transition-all hover:scale-110" title="Move Down"><i className="fa-solid fa-arrow-down text-[10px]"></i></button>
                                            <button onClick={() => deleteNode(node.id)} className="w-8 h-8 md:w-10 md:h-10 rounded-full bg-white text-slate-400 hover:text-red-500 shadow-xl border border-slate-100 flex items-center justify-center transition-all hover:scale-110" title="Delete Block"><i className="fa-solid fa-trash-can text-[10px]"></i></button>
                                            
                                            {/* Special Media Cleaner for HTML Blocks */}
                                            {node.type === 'HTML' && node.content && (node.content.includes('<img') || node.content.includes('figure')) && (
                                                <button onClick={() => cleanImagesFromBlock(node.id)} className="w-8 h-8 md:w-10 md:h-10 rounded-full bg-white text-orange-400 hover:text-orange-600 shadow-xl border border-slate-100 flex items-center justify-center transition-all hover:scale-110" title="Remove Images Only"><i className="fa-solid fa-image-slash text-[10px]"></i></button>
                                            )}
                                        </div>

                                        {/* --- RENDER CONTENT --- */}
                                        <div className="p-1 md:p-6">
                                            {node.type === 'HTML' ? (
                                                <div 
                                                    className="prose prose-lg md:prose-xl prose-slate max-w-none focus:outline-none focus:ring-2 focus:ring-brand-100 rounded-xl p-2 transition-all"
                                                    contentEditable
                                                    suppressContentEditableWarning
                                                    onBlur={(e) => updateHtmlNode(node.id, e.currentTarget.innerHTML)}
                                                    dangerouslySetInnerHTML={{ __html: node.content || '' }}
                                                />
                                            ) : node.type === 'COMPARISON' && node.comparisonData ? (
                                                <div className="overflow-x-auto scrollbar-hide -mx-2 px-2">
                                                    <ComparisonTablePreview 
                                                        data={node.comparisonData} 
                                                        products={Object.values(productMap)} 
                                                        affiliateTag={config.amazonTag} 
                                                    />
                                                </div>
                                            ) : node.type === 'CAROUSEL' && node.carouselData ? (
                                                <CarouselPreview 
                                                    data={node.carouselData} 
                                                    products={Object.values(productMap)} 
                                                />
                                            ) : (
                                                node.productId && productMap[node.productId] ? (
                                                    <div className="relative">
                                                        <ProductBoxPreview product={productMap[node.productId]} affiliateTag={config.amazonTag} mode={productMap[node.productId].deploymentMode} />
                                                        
                                                        {/* Product Specific Controls */}
                                                        {hoveredNode === node.id && (
                                                            <div className="absolute top-2 md:top-6 left-2 md:left-auto md:right-6 flex gap-2 md:gap-3 z-30 animate-fade-in-up">
                                                                <button 
                                                                    onClick={() => updateProductMode(node.productId!, 'ELITE_BENTO')} 
                                                                    className={`px-3 md:px-4 py-1.5 md:py-2 rounded-full text-[8px] md:text-[10px] font-black uppercase tracking-wider shadow-lg transition-all ${productMap[node.productId!].deploymentMode === 'ELITE_BENTO' ? 'bg-dark-950 text-white' : 'bg-white text-slate-500'}`}
                                                                >Bento</button>
                                                                <button 
                                                                    onClick={() => updateProductMode(node.productId!, 'TACTICAL_LINK')} 
                                                                    className={`px-3 md:px-4 py-1.5 md:py-2 rounded-full text-[8px] md:text-[10px] font-black uppercase tracking-wider shadow-lg transition-all ${productMap[node.productId!].deploymentMode === 'TACTICAL_LINK' ? 'bg-dark-950 text-white' : 'bg-white text-slate-500'}`}
                                                                >Tactical</button>
                                                            </div>
                                                        )}
                                                    </div>
                                                ) : <div className="p-8 bg-red-50 text-red-400 font-mono text-[10px] text-center border border-red-100 rounded-2xl">Asset Data Corrupted</div>
                                            )}
                                        </div>

                                        {/* --- INJECTION POINTS --- */}
                                        <div className={`h-8 flex items-center justify-center opacity-0 group-hover/node:opacity-100 transition-all z-20`}>
                                            <div className="relative group/add">
                                                <button className="w-8 h-8 rounded-full bg-brand-50 text-brand-500 border border-brand-200 flex items-center justify-center shadow-sm hover:scale-110 transition-transform"><i className="fa-solid fa-plus text-[10px]"></i></button>
                                                
                                                {/* Mini Injection Menu */}
                                                <div className="absolute top-full left-1/2 -translate-x-1/2 mt-2 bg-white border border-slate-100 shadow-2xl rounded-xl p-2 flex flex-col gap-1 w-64 opacity-0 group-hover/add:opacity-100 pointer-events-none group-hover/add:pointer-events-auto transition-all transform origin-top scale-95 group-hover/add:scale-100 z-50 max-h-64 overflow-y-auto custom-scrollbar">
                                                    <div className="text-[9px] font-black uppercase text-slate-300 px-3 py-1">Insert Node</div>
                                                    <button onClick={() => {
                                                        const newNodes = [...editorNodes];
                                                        newNodes.splice(index + 1, 0, { id: `html-${Date.now()}`, type: 'HTML', content: '<p>Write something brilliant...</p>' });
                                                        setEditorNodes(newNodes);
                                                    }} className="text-left px-3 py-2 text-xs font-bold text-slate-600 hover:bg-slate-50 rounded-lg transition-colors">Text Block</button>
                                                    
                                                    <button onClick={() => {
                                                        const products = Object.values(productMap);
                                                        if (products.length < 2) {
                                                            Toastify({ text: "Need at least 2 assets for carousel", style: { background: "#f59e0b" } }).showToast();
                                                            return;
                                                        }
                                                        const newNodes = [...editorNodes];
                                                        newNodes.splice(index + 1, 0, { 
                                                            id: `carousel-${Date.now()}`, 
                                                            type: 'CAROUSEL', 
                                                            carouselData: {
                                                                title: "Featured Selection",
                                                                productIds: products.slice(0, 6).map(p => p.id)
                                                            }
                                                        });
                                                        setEditorNodes(newNodes);
                                                        Toastify({ text: "Carousel Injected", style: { background: "#ec4899" } }).showToast();
                                                    }} className="text-left px-3 py-2 text-xs font-bold text-pink-600 hover:bg-pink-50 rounded-lg transition-colors">Product Carousel</button>
                                                    
                                                    <div className="h-px bg-slate-100 my-1"></div>
                                                    <div className="text-[9px] font-black uppercase text-brand-300 px-3 py-1">Relevant Assets</div>
                                                    
                                                    {getContextualProducts(index).map(p => (
                                                        <button key={p.id} onClick={() => injectProduct(p.id, index + 1)} className="text-left px-3 py-2 text-xs font-bold text-brand-600 hover:bg-brand-50 rounded-lg transition-colors truncate w-full flex items-center gap-2">
                                                            <span className="w-1.5 h-1.5 rounded-full bg-brand-400 flex-shrink-0"></span> {p.title}
                                                        </button>
                                                    ))}
                                                    
                                                    {getContextualProducts(index).length === 0 && (
                                                        <div className="px-3 py-2 text-[10px] text-slate-400 italic">No assets available</div>
                                                    )}
                                                </div>
                                            </div>
                                        </div>

                                    </div>
                                ))}
                                
                                {/* Empty State / End Injection */}
                                {editorNodes.length === 0 && (
                                    <div className="py-20 md:py-40 text-center border-2 border-dashed border-slate-200 rounded-[24px] md:rounded-[40px]">
                                        <p className="text-slate-400 font-bold uppercase tracking-widest text-[10px] md:text-xs mb-4">Canvas Empty</p>
                                        <button onClick={() => setEditorNodes([{id: 'init', type:'HTML', content:'<p>Start writing...</p>'}])} className="text-brand-500 font-black underline">Initialize Block</button>
                                    </div>
                                )}
                            </div>
                        </div>
                    ) : (
                        // Code View
                        <div className="max-w-4xl mx-auto h-full px-4">
                            <div className="bg-[#1e1e1e] text-blue-300 p-6 md:p-10 rounded-[24px] md:rounded-[40px] shadow-2xl font-mono text-xs md:text-sm leading-relaxed overflow-auto min-h-[80vh] border border-white/10">
                                {generateFinalHtml()}
                            </div>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
};
