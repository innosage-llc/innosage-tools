"use client";

import { useEffect, useState } from 'react';
import QRCode from 'qrcode';
import { Check, Copy, Download, Link2, LockKeyhole, QrCode } from 'lucide-react';
import { ToolsLayout } from '@/components/ToolsLayout';

const QR_SIZE = 640;

function normalizeUrl(value: string) {
  const trimmed = value.trim();
  if (!trimmed) return '';

  try {
    return new URL(trimmed.includes('://') ? trimmed : `https://${trimmed}`).toString();
  } catch {
    return null;
  }
}

export default function UrlToQrcodePage() {
  const [input, setInput] = useState('');
  const [qrCode, setQrCode] = useState('');
  const [error, setError] = useState('');
  const [isCopied, setIsCopied] = useState(false);

  const normalizedUrl = normalizeUrl(input);

  useEffect(() => {
    let isCurrent = true;

    async function createQrCode() {
      if (!normalizedUrl) {
        if (isCurrent) setQrCode('');
        return;
      }

      try {
        const dataUrl = await QRCode.toDataURL(normalizedUrl, {
          width: QR_SIZE,
          margin: 2,
          errorCorrectionLevel: 'M',
          color: { dark: '#18181b', light: '#ffffff' },
        });
        if (isCurrent) setQrCode(dataUrl);
      } catch {
        if (isCurrent) setError('We could not generate a QR code for this URL.');
      }
    }

    createQrCode();
    return () => { isCurrent = false; };
  }, [normalizedUrl]);

  const handleInput = (value: string) => {
    setInput(value);
    setError(value.trim() && normalizeUrl(value) === null ? 'Enter a valid web address.' : '');
  };

  const copyUrl = async () => {
    if (!normalizedUrl) return;
    await navigator.clipboard.writeText(normalizedUrl);
    setIsCopied(true);
    window.setTimeout(() => setIsCopied(false), 1600);
  };

  const downloadQr = () => {
    if (!qrCode) return;
    const link = document.createElement('a');
    link.href = qrCode;
    link.download = 'url-qrcode.png';
    link.click();
  };

  return (
    <ToolsLayout>
      <div className="max-w-4xl mx-auto py-8 md:py-16">
        <div className="text-center max-w-2xl mx-auto mb-10">
          <div className="w-12 h-12 bg-orange-100 rounded-xl flex items-center justify-center mx-auto mb-5">
            <QrCode className="text-orange-600" size={24} />
          </div>
          <h1 className="text-3xl md:text-4xl font-bold tracking-tight text-zinc-900 mb-3">URL to QR Code</h1>
          <p className="text-lg text-zinc-600">Send a link to your phone in seconds. Your URL never leaves this browser.</p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-[1.1fr_0.9fr] gap-6 items-stretch">
          <section className="bg-white border border-zinc-200 rounded-3xl p-6 md:p-8 shadow-sm flex flex-col">
            <label htmlFor="url" className="text-sm font-bold text-zinc-700 mb-3">Link to share</label>
            <div className="relative">
              <Link2 size={20} className="absolute left-4 top-1/2 -translate-y-1/2 text-zinc-400" />
              <input
                id="url"
                type="url"
                inputMode="url"
                autoComplete="url"
                value={input}
                onChange={(event) => handleInput(event.target.value)}
                placeholder="https://example.com/a-long-link"
                data-testid="url-input"
                className="w-full rounded-2xl border border-zinc-300 bg-white py-4 pl-12 pr-4 text-zinc-900 outline-none transition focus:border-orange-500 focus:ring-4 focus:ring-orange-100"
              />
            </div>
            {error && <p role="alert" className="mt-3 text-sm font-medium text-red-600">{error}</p>}

            <div className="mt-6 rounded-2xl bg-orange-50 p-4 flex gap-3 text-sm text-zinc-700">
              <LockKeyhole size={19} className="shrink-0 text-orange-600 mt-0.5" />
              <p><strong className="text-zinc-900">Local-only generation.</strong> The QR code is created on your device. We do not upload, store, or track your link.</p>
            </div>

            <div className="mt-auto pt-6 flex flex-wrap gap-3">
              <button
                type="button"
                onClick={copyUrl}
                disabled={!normalizedUrl}
                className="inline-flex items-center justify-center gap-2 rounded-xl border border-zinc-300 px-4 py-3 text-sm font-bold text-zinc-700 transition hover:bg-zinc-50 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {isCopied ? <Check size={18} className="text-green-600" /> : <Copy size={18} />}
                {isCopied ? 'Copied' : 'Copy link'}
              </button>
              <button
                type="button"
                onClick={downloadQr}
                disabled={!qrCode}
                data-testid="download-button"
                className="inline-flex items-center justify-center gap-2 rounded-xl bg-orange-500 px-4 py-3 text-sm font-bold text-white shadow-sm transition hover:bg-orange-600 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50"
              >
                <Download size={18} /> Download PNG
              </button>
            </div>
          </section>

          <section className="bg-zinc-50 border border-zinc-200 rounded-3xl p-6 md:p-8 flex flex-col items-center justify-center min-h-80">
            {qrCode ? (
              <>
                <div className="bg-white rounded-2xl p-4 shadow-sm border border-zinc-100">
                  <img src={qrCode} alt={`QR code for ${normalizedUrl}`} width={280} height={280} className="w-64 h-64 md:w-72 md:h-72" data-testid="qr-preview" />
                </div>
                <p className="mt-5 text-sm text-zinc-500 text-center">Point your phone camera at the code.</p>
              </>
            ) : (
              <div className="text-center text-zinc-400">
                <QrCode size={56} strokeWidth={1.4} className="mx-auto mb-4" />
                <p className="font-medium">Your QR code will appear here.</p>
              </div>
            )}
          </section>
        </div>
      </div>
    </ToolsLayout>
  );
}
