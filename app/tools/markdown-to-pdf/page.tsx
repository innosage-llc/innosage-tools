"use client";

import { useState, useRef } from 'react';
import { ToolsLayout } from '@/components/ToolsLayout';
import { MarkdownInput } from './MarkdownInput';
import { DocumentPreview } from './DocumentPreview';
import { Download } from 'lucide-react';

const DEFAULT_MARKDOWN = `# Markdown to PDF

Simple, private, and free.

## How to use
1. Type on the **left**.
2. See the preview on the **right**.
3. Click **Download PDF** to save.

## Features
- **Privacy First**: Everything stays in your browser.
- **Clean Output**: Optimized for A4 printing.
- **Fast**: No server uploads.

> "Simplicity is the ultimate sophistication." - Leonardo da Vinci
`;

export default function MarkdownToPdfPage() {
    const [markdown, setMarkdown] = useState(DEFAULT_MARKDOWN);
    const previewRef = useRef<HTMLDivElement>(null);

    const handlePrint = () => {
        window.print();
    };

    return (
        <ToolsLayout>
            <div className="h-[calc(100vh-14rem)] flex flex-col lg:flex-row border border-zinc-200 rounded-xl overflow-hidden shadow-sm bg-white print:border-none print:shadow-none print:h-auto print:block">

                {/* Helper Instructions / SEO H1 - Hidden visually in app, visible to bots/screen readers */}
                <h1 className="sr-only">Free Markdown to PDF Converter</h1>

                {/* Action Bar (Mobile Only) */}
                <div className="lg:hidden p-4 border-b border-zinc-200 bg-zinc-50 flex justify-between items-center print:hidden">
                    <span className="font-bold text-zinc-900">Editor</span>
                    <button
                        onClick={handlePrint}
                        className="bg-zinc-900 text-white px-4 py-2 rounded-lg text-sm font-medium flex items-center gap-2 active:scale-95 transition-transform"
                    >
                        <Download size={16} /> Save PDF
                    </button>
                </div>

                {/* Input Pane */}
                <div className="flex-1 lg:w-1/2 min-h-[50vh] lg:min-h-auto border-b lg:border-b-0 lg:border-r border-zinc-200 print:hidden">
                    <MarkdownInput value={markdown} onChange={setMarkdown} />
                </div>

                {/* Preview Pane */}
                <div className="flex-1 lg:w-1/2 min-h-[50vh] lg:min-h-auto bg-zinc-100 print:bg-white print:w-full">
                    <DocumentPreview markdown={markdown} ref={previewRef} />
                </div>

            </div>

            {/* Desktop Floating Action Button */}
            <div className="fixed bottom-8 right-8 print:hidden hidden lg:block">
                <button
                    onClick={handlePrint}
                    className="bg-zinc-900 hover:bg-zinc-800 text-white px-6 py-3 rounded-full shadow-lg hover:shadow-xl font-medium flex items-center gap-3 active:scale-95 transition-all"
                >
                    <Download size={20} />
                    Download PDF
                </button>
            </div>

            <style dangerouslySetInnerHTML={{
                __html: `
        @media print {
            /* Hide ALL UI elements by default using visibility */
            body *, main *, header, footer {
                visibility: hidden !important;
            }
            
            /* Explicitly show the print area and its contents */
            #print-area, #print-area * {
                visibility: visible !important;
            }

            /* Pull the print area to the top-left of the page */
            #print-area {
                position: absolute !important;
                left: 0 !important;
                top: 0 !important;
                width: 100% !important;
                margin: 0 !important;
                padding: 20mm !important;
                box-shadow: none !important;
                display: block !important;
            }

            /* Ensure parents don't clip or shift the absolute child */
            body, html, main, #__next {
                margin: 0 !important;
                padding: 0 !important;
                height: auto !important;
                overflow: visible !important;
                background: white !important;
            }

            @page {
                size: auto;
                margin: 0mm; /* Remove browser headers/footers */
            }
        }
      `}} />
        </ToolsLayout>
    );
}
