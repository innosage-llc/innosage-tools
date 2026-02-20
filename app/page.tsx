"use client";

import { ToolsLayout } from '@/components/ToolsLayout';
import Link from 'next/link';
import { FileText, ArrowRight, Maximize2 } from 'lucide-react';

export default function ToolsIndexPage() {
  return (
    <ToolsLayout>
      <div className="py-12 md:py-20 text-center max-w-3xl mx-auto">
        <h1 className="text-4xl md:text-5xl font-bold tracking-tight text-zinc-900 mb-6">
          Developer Tools <span className="text-zinc-400">by InnoSage</span>
        </h1>
        <p className="text-lg text-zinc-600 mb-8">
          A collection of simple, fast, and private utilities designed to make your daily workflow easier. No ads, no tracking, just code.
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 max-w-6xl mx-auto">
        {/* Tool Card: Markdown to PDF */}
        <Link href="/markdown-to-pdf" className="group">
          <div className="bg-white border border-zinc-200 rounded-2xl p-6 hover:shadow-md hover:border-zinc-300 transition-all h-full flex flex-col">
            <div className="w-12 h-12 bg-orange-100 rounded-xl flex items-center justify-center mb-4 group-hover:scale-110 transition-transform">
              <FileText className="text-orange-600" size={24} />
            </div>
            <h3 className="text-xl font-bold text-zinc-900 mb-2">Markdown to PDF</h3>
            <p className="text-zinc-500 mb-6 flex-1">
              Convert markdown text to a clean, print-ready PDF instantly in your browser. Perfect for documentation and quick notes.
            </p>
            <div className="flex items-center text-sm font-medium text-zinc-900 group-hover:text-orange-600 transition-colors">
              Launch Tool <ArrowRight size={16} className="ml-2 group-hover:translate-x-1 transition-transform" />
            </div>
          </div>
        </Link>

        {/* Tool Card: SVG to Image */}
        <Link href="/svg-to-image" className="group">
          <div className="bg-white border border-zinc-200 rounded-2xl p-6 hover:shadow-md hover:border-zinc-300 transition-all h-full flex flex-col">
            <div className="w-12 h-12 bg-orange-100 rounded-xl flex items-center justify-center mb-4 group-hover:scale-110 transition-transform">
              <Maximize2 className="text-orange-600" size={24} />
            </div>
            <h3 className="text-xl font-bold text-zinc-900 mb-2">SVG to Image</h3>
            <p className="text-zinc-500 mb-6 flex-1">
              Convert SVG files to high-resolution PNG or JPEG images client-side. Perfect for design and presentation assets.
            </p>
            <div className="flex items-center text-sm font-medium text-zinc-900 group-hover:text-orange-600 transition-colors">
              Launch Tool <ArrowRight size={16} className="ml-2 group-hover:translate-x-1 transition-transform" />
            </div>
          </div>
        </Link>

        {/* Placeholder for Future Tools */}
        {/* 
        <div className="bg-zinc-50 border border-zinc-100 rounded-2xl p-6 flex flex-col justify-center items-center text-center h-full opacity-60">
             <span className="text-zinc-400 font-medium">More coming soon...</span>
        </div> 
        */}
      </div>
    </ToolsLayout>
  );
}
