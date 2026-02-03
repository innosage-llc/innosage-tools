"use client";

import { useRef, useEffect } from 'react';

interface MarkdownInputProps {
    value: string;
    onChange: (value: string) => void;
}

export const MarkdownInput = ({ value, onChange }: MarkdownInputProps) => {
    const textareaRef = useRef<HTMLTextAreaElement>(null);

    useEffect(() => {
        // Auto-resize
        if (textareaRef.current) {
            textareaRef.current.style.height = 'auto';
            textareaRef.current.style.height = textareaRef.current.scrollHeight + 'px';
        }
    }, [value]);

    return (
        <div className="h-full flex flex-col">
            <div className="bg-zinc-100 border-b border-zinc-200 px-4 py-2 text-xs font-mono text-zinc-500 uppercase tracking-wider">
                Markdown Input
            </div>
            <textarea
                ref={textareaRef}
                value={value}
                onChange={(e) => onChange(e.target.value)}
                className="flex-1 w-full bg-zinc-50 p-6 font-mono text-sm leading-relaxed text-zinc-800 resize-none focus:outline-none focus:ring-0"
                placeholder="# Start typing your document here..."
                spellCheck={false}
            />
        </div>
    );
};
