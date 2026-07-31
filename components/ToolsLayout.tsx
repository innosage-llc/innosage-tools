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
                            className="inline-flex items-center justify-center rounded-md p-2 text-zinc-500 transition-colors hover:bg-zinc-100 hover:text-zinc-900 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-zinc-900"
                        >
                            <Github size={20} aria-hidden="true" />
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
