import Link from 'next/link';
import { Hammer, ArrowLeft, Github } from 'lucide-react';

export const ToolsLayout = ({ children }: { children: React.ReactNode }) => {
    return (
        <div className="min-h-screen flex flex-col bg-white text-zinc-900 font-sans">
            <header className="border-b border-zinc-200 sticky top-0 bg-white/80 backdrop-blur z-50 print:hidden">
                <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
                    <div className="flex items-center gap-2">
                        <a href="https://innosage.co" className="flex items-center gap-2 text-zinc-600 hover:text-zinc-900 transition-colors">
                            <ArrowLeft size={16} />
                            <span className="text-sm font-medium">Back to InnoSage</span>
                        </a>
                        <div className="h-4 w-px bg-zinc-300 mx-2" />
                        <Link href="/" className="flex items-center gap-2 font-bold text-lg text-zinc-900">
                            <Hammer size={20} className="text-orange-500" />
                            <span>DevTools</span>
                        </Link>
                    </div>
                    <nav className="flex items-center gap-4">
                        <a
                            href="https://github.com/innosage-llc/innosage-tools"
                            target="_blank"
                            rel="noopener noreferrer"
                            aria-label="View InnoSage Tools on GitHub"
                            title="View on GitHub"
                            className="inline-flex size-10 items-center justify-center rounded-md text-[#181717] transition-colors hover:bg-zinc-100 hover:text-black focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-zinc-900"
                        >
                            <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" className="size-5" aria-hidden="true" fill="currentColor">
                                <path d="M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576 4.765-1.589 8.199-6.086 8.199-11.386 0-6.627-5.373-12-12-12z" />
                            </svg>
                        </a>
                    </nav>
                </div>
            </header>

            <main className="flex-1 max-w-7xl w-full mx-auto px-4 sm:px-6 lg:px-8 py-8 print:p-0 print:max-w-none">
                {children}
            </main>

            <footer className="border-t border-zinc-200 py-12 bg-zinc-50 print:hidden">
                <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 flex flex-col md:flex-row justify-between items-center gap-4">
                    <div className="text-sm text-zinc-500">
                        © {new Date().getFullYear()} InnoSage LLC. Open Source Tools for Developers.
                    </div>
                    <div className="flex gap-6 text-sm font-medium">
                        <a href="https://innosage.co" className="text-zinc-600 hover:text-orange-500">Home</a>
                        <a href="https://innosage.co/privacy" className="text-zinc-600 hover:text-orange-500">Privacy</a>
                    </div>
                </div>
            </footer>
        </div>
    );
};
