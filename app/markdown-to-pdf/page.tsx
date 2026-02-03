"use client";

import { useState, useRef } from 'react';
import { ToolsLayout } from '@/components/ToolsLayout';
import { MarkdownInput } from './MarkdownInput';
import { DocumentPreview } from './DocumentPreview';
import { Download } from 'lucide-react';
import { printDocument } from './printService';

const DEFAULT_MARKDOWN = `# 📄 Project Proposal: InnoSage AI

Welcome to the **Markdown to PDF** converter. This tool is designed for high-fidelity document generation directly in your browser.

## 🚀 Key Features

*   **Privacy First**: Everything stays in your browser.
*   **A4 Optimized**: Pixel-perfect scaling for standard office printing.
*   **Zero Latency**: Powered by client-side rendering.

---

## 📊 Sample Table

| Milestone | Deliverable | Status |
| :--- | :--- | :--- |
| Phase 1 | Core Engine | ✅ Done |
| Phase 2 | PDF Export | 🛠️ In Progress |
| Phase 3 | Cloud Sync | 📅 Q3 2026 |

## 💻 Code Example

\`\`\`typescript
const printDocument = (content: string) => {
  const win = window.open('', '_blank');
  win.document.write(\`<html><body>\${content}</body></html>\`);
  win.print();
};
\`\`\`

> "Simplicity is the ultimate sophistication." - Leonardo da Vinci

### ✅ Task List
- [x] Implement Markdown parser
- [x] Configure A4 preview scaling
- [ ] Add dark mode support
`;

export default function MarkdownToPdfPage() {
    const [markdown, setMarkdown] = useState(DEFAULT_MARKDOWN);
    const previewRef = useRef<HTMLDivElement>(null);

    const handlePrint = () => {
        if (previewRef.current) {
            const article = previewRef.current.querySelector('article');
            if (article) {
                const titleMatch = markdown.match(/^#\s+(.+)$/m);
                const title = titleMatch ? titleMatch[1] : 'InnoSage Document';
                printDocument(title, article.innerHTML);
            }
        }
    };

    return (
        <ToolsLayout>
            <div className="h-[calc(100vh-14rem)] flex flex-col lg:flex-row border border-zinc-200/50 rounded-2xl overflow-hidden shadow-2xl shadow-zinc-200/50 bg-white/70 backdrop-blur-xl">

                {/* Helper Instructions / SEO H1 - Hidden visually in app, visible to bots/screen readers */}
                <h1 className="sr-only">Free Markdown to PDF Converter</h1>

                {/* Action Bar (Mobile Only) */}
                <div className="lg:hidden p-4 border-b border-zinc-200 bg-zinc-50 flex justify-between items-center">
                    <span className="font-bold text-zinc-900">Editor</span>
                    <button
                        onClick={handlePrint}
                        className="bg-zinc-900 text-white px-4 py-2 rounded-lg text-sm font-medium flex items-center gap-2 active:scale-95 transition-transform"
                    >
                        <Download size={16} /> Save PDF
                    </button>
                </div>

                {/* Input Pane */}
                <div className="flex-1 lg:w-1/2 min-h-[50vh] lg:min-h-auto border-b lg:border-b-0 lg:border-r border-zinc-200">
                    <MarkdownInput value={markdown} onChange={setMarkdown} />
                </div>

                {/* Preview Pane */}
                <div className="flex-1 lg:w-1/2 min-h-[50vh] lg:min-h-auto bg-zinc-100">
                    <DocumentPreview markdown={markdown} ref={previewRef} />
                </div>

            </div>

            {/* Desktop Floating Action Button */}
            <div className="fixed bottom-10 right-10 hidden lg:block group">
                <button
                    onClick={handlePrint}
                    className="relative flex items-center gap-3 bg-zinc-900 text-white px-8 py-4 rounded-full shadow-2xl transition-all duration-300 hover:scale-105 active:scale-95 hover:bg-zinc-800 ring-4 ring-zinc-900/10"
                >
                    <Download size={22} className="group-hover:translate-y-0.5 transition-transform" />
                    <span className="font-semibold tracking-tight">Download PDF</span>
                </button>
            </div>
        </ToolsLayout>
    );
}
