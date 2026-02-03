import Link from 'next/link';
import { Hammer, ArrowLeft } from 'lucide-react';

export const ToolsLayout = ({ children }: { children: React.ReactNode }) => {
    return (
        <div className="min-h-screen flex flex-col bg-white text-zinc-900 font-sans">
            <header className="border-b border-zinc-200 sticky top-0 bg-white/80 backdrop-blur z-50 print:hidden">
                <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
                    <div className="flex items-center gap-2">
                        <Link href="https://innosage.co" className="flex items-center gap-2 text-zinc-600 hover:text-zinc-900 transition-colors">
                            <ArrowLeft size={16} />
                            <span className="text-sm font-medium">Back to InnoSage</span>
                        </Link>
                        <div className="h-4 w-px bg-zinc-300 mx-2" />
                        <Link href="/tools" className="flex items-center gap-2 font-bold text-lg text-zinc-900">
                            <Hammer size={20} className="text-orange-500" />
                            <span>DevTools</span>
                        </Link>
                    </div>
                    <nav className="flex items-center gap-4">
                        <a href="https://github.com/innosage-llc" target="_blank" rel="noopener noreferrer" className="text-sm font-medium text-zinc-500 hover:text-zinc-900">
                            GitHub
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
                        <Link href="https://innosage.co" className="text-zinc-600 hover:text-orange-500">Home</Link>
                        <Link href="https://innosage.co/privacy" className="text-zinc-600 hover:text-orange-500">Privacy</Link>
                    </div>
                </div>
            </footer>
        </div>
    );
};
