"use client";

import ReactMarkdown from 'react-markdown';
import React, { forwardRef } from 'react';

interface DocumentPreviewProps {
    markdown: string;
}

export const DocumentPreview = forwardRef<HTMLDivElement, DocumentPreviewProps>(({ markdown }, ref) => {
    return (
        <div className="h-full flex flex-col bg-white">
            <div className="bg-white border-b border-zinc-200 px-4 py-2 text-xs font-mono text-zinc-500 uppercase tracking-wider flex justify-between items-center print:hidden">
                <span>Preview</span>
                <span className="text-[10px] bg-zinc-100 px-2 py-0.5 rounded text-zinc-400">A4 Render</span>
            </div>

            <div className="flex-1 overflow-y-auto bg-zinc-100 p-8 scrollbar-thin scrollbar-thumb-zinc-300 scrollbar-track-transparent">
                <div
                    ref={ref}
                    className="bg-white shadow-sm mx-auto max-w-[210mm] min-h-[297mm] p-[20mm]"
                >
                    <article className="prose prose-zinc max-w-none prose-headings:font-bold prose-headings:tracking-tight prose-h1:text-4xl prose-h1:mb-8 prose-h2:mt-12 prose-a:text-blue-600 prose-img:rounded-xl">
                        <ReactMarkdown>{markdown}</ReactMarkdown>
                    </article>
                </div>
            </div>
        </div>
    );
});

DocumentPreview.displayName = 'DocumentPreview';
