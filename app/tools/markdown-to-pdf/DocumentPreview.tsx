"use client";

import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import React, { forwardRef, useEffect, useState, useRef } from 'react';
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter';
import { prism } from 'react-syntax-highlighter/dist/esm/styles/prism';

interface DocumentPreviewProps {
    markdown: string;
}

export const DocumentPreview = forwardRef<HTMLDivElement, DocumentPreviewProps>(({ markdown }, ref) => {
    const containerRef = useRef<HTMLDivElement>(null);
    const [scale, setScale] = useState(1);
    const [mounted, setMounted] = useState(false);

    const updateScale = React.useCallback(() => {
        if (!containerRef.current) return;
        const padding = 64;
        const availableWidth = containerRef.current.offsetWidth - padding;
        const a4WidthInPx = 794;

        if (availableWidth < a4WidthInPx) {
            setScale(availableWidth / a4WidthInPx);
        } else {
            setScale(1);
        }
    }, []);

    useEffect(() => {
        setMounted(true);
    }, []);

    useEffect(() => {
        if (!mounted) return;

        // Final attempt at scaling once mounted and ref is attached
        const timer = setTimeout(updateScale, 100);

        const resizeObserver = new ResizeObserver(updateScale);
        if (containerRef.current) resizeObserver.observe(containerRef.current);

        return () => {
            clearTimeout(timer);
            resizeObserver.disconnect();
        };
    }, [mounted, updateScale]);

    if (!mounted) return (
        <div className="h-full flex flex-col bg-zinc-50 border-l border-zinc-200/50 animate-pulse" />
    );

    return (
        <div className="h-full flex flex-col bg-zinc-50 border-l border-zinc-200/50">
            <div className="bg-white border-b border-zinc-200 px-4 py-2 text-xs font-mono text-zinc-500 uppercase tracking-wider flex justify-between items-center print:hidden">
                <span>Preview</span>
                <span className="text-[10px] bg-zinc-100 px-2 py-0.5 rounded text-zinc-400">
                    A4 Render {scale < 1 ? `(${Math.round(scale * 100)}%)` : ''}
                </span>
            </div>

            <div
                ref={containerRef}
                className="flex-1 overflow-auto bg-zinc-100 p-8 flex justify-center items-start scrollbar-thin scrollbar-thumb-zinc-300 scrollbar-track-transparent"
            >
                <div
                    ref={ref}
                    style={{
                        transform: `scale(${scale})`,
                        transformOrigin: 'top center',
                        width: '210mm',
                        minHeight: '297mm',
                    }}
                    className="bg-white shadow-2xl mx-auto p-[20mm] shrink-0 transition-transform duration-200 origin-top"
                >
                    <article className="prose prose-zinc max-w-none prose-headings:font-bold prose-headings:tracking-tight prose-img:rounded-xl">
                        <ReactMarkdown
                            remarkPlugins={[remarkGfm]}
                            components={{
                                code({ inline, className, children, ...props }: { inline?: boolean, className?: string, children?: React.ReactNode }) {
                                    const match = /language-(\w+)/.exec(className || '');
                                    return !inline && match ? (
                                        <SyntaxHighlighter
                                            style={prism}
                                            language={match[1]}
                                            PreTag="div"
                                            {...props}
                                        >
                                            {String(children).replace(/\n$/, '')}
                                        </SyntaxHighlighter>
                                    ) : (
                                        <code className={className} {...props}>
                                            {children}
                                        </code>
                                    );
                                },
                            }}
                        >
                            {markdown}
                        </ReactMarkdown>
                    </article>
                </div>
            </div>
        </div>
    );
});

DocumentPreview.displayName = 'DocumentPreview';
