
import React from 'react';
import { ProductDetails, CarouselData } from '../types';

interface CarouselPreviewProps {
  data: CarouselData;
  products: ProductDetails[];
}

export const CarouselPreview: React.FC<CarouselPreviewProps> = ({ data, products }) => {
  const sortedProducts = data.productIds
    .map(id => products.find(p => p.id === id))
    .filter((p): p is ProductDetails => p !== null && p !== undefined);

  if (sortedProducts.length === 0) return null;

  return (
    <div className="w-full max-w-[1000px] mx-auto my-12 font-sans">
      <div className="bg-white rounded-[48px] border border-slate-100 shadow-[0_20px_80px_-20px_rgba(0,0,0,0.08)] p-10">
        {data.title && (
          <div className="text-center mb-10">
            <h2 className="text-2xl font-black text-slate-900 uppercase tracking-tight">
              {data.title}
            </h2>
          </div>
        )}
        
        <div className="overflow-x-auto pb-6 -mx-4 px-4 scrollbar-hide">
          <div className="flex gap-6 w-max">
            {sortedProducts.map((p) => (
              <div 
                key={p.id}
                className="w-[280px] bg-slate-50/50 border border-slate-100 rounded-[32px] p-6 flex flex-col items-center text-center transition-all duration-500 hover:-translate-y-2 hover:bg-white hover:shadow-xl group"
              >
                <div className="h-40 w-full flex items-center justify-center mb-6">
                  <img 
                    src={p.imageUrl} 
                    alt={p.title}
                    className="max-h-full max-w-full object-contain mix-blend-multiply transition-transform duration-700 group-hover:scale-110"
                  />
                </div>
                
                <h3 className="text-sm font-black text-slate-900 line-clamp-2 mb-3 h-10">
                  {p.title}
                </h3>
                
                <div className="flex text-amber-400 text-xs mb-4">
                  {'★'.repeat(Math.round(p.rating))}{'☆'.repeat(5 - Math.round(p.rating))}
                </div>
                
                <div className="text-2xl font-black text-slate-900 mb-6">
                  {p.price}
                </div>
                
                <button className="w-full py-3 bg-slate-900 text-white text-[10px] font-black uppercase tracking-widest rounded-xl hover:bg-blue-600 transition-all">
                  View Deal
                </button>
              </div>
            ))}
          </div>
        </div>
        
        <div className="mt-4 flex justify-center gap-2">
          <div className="w-1.5 h-1.5 rounded-full bg-slate-900" />
          <div className="w-1.5 h-1.5 rounded-full bg-slate-200" />
          <div className="w-1.5 h-1.5 rounded-full bg-slate-200" />
        </div>
      </div>
    </div>
  );
};
