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

            <div className="flex-1 overflow-y-auto bg-zinc-100 p-8 print:p-0 print:bg-white print:overflow-visible">
                <div
                    ref={ref}
                    id="print-area"
                    className="bg-white shadow-sm mx-auto max-w-[210mm] min-h-[297mm] p-[20mm] print:shadow-none print:m-0 print:w-full print:max-w-none print:min-h-0 print:p-0 print:block"
                >
                    <article className="prose prose-zinc max-w-none prose-headings:font-bold prose-h1:text-4xl prose-h1:tracking-tight prose-a:text-blue-600">
                        <ReactMarkdown>{markdown}</ReactMarkdown>
                    </article>
                </div>
            </div>
        </div>
    );
});

DocumentPreview.displayName = 'DocumentPreview';
