import type { Metadata } from 'next';
export const metadata: Metadata = { title: 'Google Drive Markdown demo | InnoSage Tools', robots: { index: false, follow: false } };
export default function ByosPage() {
  return <main className="mx-auto max-w-4xl p-8"><h1 className="text-2xl font-bold">Google Drive Markdown research demo</h1><p className="my-4">Explicit synchronization, local protected edits and conflict recovery. Dedicated disposable test account only. This is not a production release.</p><a className="underline" href="/tools/byos-demo/index.html">Open Markdown demo</a></main>;
}
