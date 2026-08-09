import type { Metadata } from "next";
import Link from "next/link";
import {
  ArrowRight,
  FileText,
  Maximize2,
  QrCode,
  Scissors,
  Video,
} from "lucide-react";
import { ToolsLayout } from "@/components/ToolsLayout";

const canonicalUrl = "https://innosage.co/tools";
const pageTitle = "Free Browser Developer Tools | InnoSage";
const pageDescription =
  "Use free, open-source browser tools for QR codes, Markdown to PDF, audio, images, recordings, and video. Fast, private utilities from InnoSage.";
const lastReviewed = "August 9, 2026";

export const metadata: Metadata = {
  title: pageTitle,
  description: pageDescription,
  alternates: {
    canonical: canonicalUrl,
  },
  robots: {
    index: true,
    follow: true,
  },
  openGraph: {
    title: pageTitle,
    description: pageDescription,
    url: canonicalUrl,
    siteName: "InnoSage",
    type: "website",
    images: [
      {
        url: `${canonicalUrl}/apple-icon.png`,
        width: 180,
        height: 180,
        alt: "InnoSage DevTools",
      },
    ],
  },
  twitter: {
    card: "summary",
    title: pageTitle,
    description: pageDescription,
    images: [`${canonicalUrl}/apple-icon.png`],
  },
};

const tools = [
  {
    name: "URL to QR Code",
    path: "/url-to-qrcode",
    description:
      "Turn any link into a phone-ready QR code locally in your browser.",
  },
  {
    name: "Markdown to PDF",
    path: "/markdown-to-pdf",
    description:
      "Convert Markdown into a clean, print-ready PDF in your browser.",
  },
  {
    name: "Audio Splitter",
    path: "/audio-splitter",
    description:
      "Split large audio files into smaller chunks based on a target size.",
  },
  {
    name: "Image Joiner",
    path: "/image-joiner",
    description:
      "Crop and join two images side by side into one downloadable image.",
  },
  {
    name: "SVG to Image",
    path: "/svg-to-image",
    description: "Convert SVG files into high-resolution PNG or JPEG images.",
  },
  {
    name: "A/V Recorder",
    path: "/recorder",
    description:
      "Record audio and video directly to your local disk from the browser.",
  },
  {
    name: "Meeting Fixer",
    path: "/meeting-fixer",
    description:
      "Add an amendment to an incomplete meeting recording and combine the files.",
  },
  {
    name: "Video to GIF",
    path: "/video-to-gif",
    description:
      "Convert videos into optimized GIFs with practical size presets.",
  },
] as const;

const faqs = [
  {
    question: "Are InnoSage DevTools free to use?",
    answer:
      "Yes. Every tool in this collection is free to use in a supported web browser, with no paid plan or account required.",
  },
  {
    question: "Are InnoSage DevTools open source?",
    answer:
      "Yes. The complete source code is publicly available in the innosage-tools repository on GitHub for review and contribution.",
  },
  {
    question: "Do InnoSage DevTools upload my files?",
    answer:
      "The tools are designed to process your files locally in the browser. InnoSage does not add ads or tracking to the collection.",
  },
  {
    question: "Which tasks can InnoSage DevTools handle?",
    answer:
      "The collection covers QR codes, Markdown-to-PDF conversion, audio splitting, image joining, SVG conversion, recording, meeting repair, and video-to-GIF conversion.",
  },
] as const;

const collectionPageJsonLd = {
  "@context": "https://schema.org",
  "@type": "CollectionPage",
  "@id": `${canonicalUrl}#collection`,
  url: canonicalUrl,
  name: pageTitle,
  description: pageDescription,
  inLanguage: "en",
  isPartOf: {
    "@type": "WebSite",
    "@id": "https://innosage.co/#website",
    name: "InnoSage",
    url: "https://innosage.co",
  },
  about: {
    "@type": "Organization",
    "@id": "https://innosage.co/#organization",
    name: "InnoSage LLC",
    alternateName: "InnoSage",
    url: "https://innosage.co",
    sameAs: ["https://github.com/innosage-llc/innosage-tools"],
  },
  mainEntity: {
    "@type": "ItemList",
    numberOfItems: tools.length,
    itemListElement: tools.map((tool, index) => ({
      "@type": "ListItem",
      position: index + 1,
      item: {
        "@type": "WebApplication",
        name: tool.name,
        description: tool.description,
        url: `${canonicalUrl}${tool.path}`,
        applicationCategory: "DeveloperApplication",
        operatingSystem: "Any",
        isAccessibleForFree: true,
      },
    })),
  },
};

const faqPageJsonLd = {
  "@context": "https://schema.org",
  "@type": "FAQPage",
  "@id": `${canonicalUrl}#faq`,
  url: canonicalUrl,
  mainEntity: faqs.map((faq) => ({
    "@type": "Question",
    name: faq.question,
    acceptedAnswer: {
      "@type": "Answer",
      text: faq.answer,
    },
  })),
};

export default function ToolsIndexPage() {
  return (
    <ToolsLayout>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: JSON.stringify(collectionPageJsonLd),
        }}
      />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: JSON.stringify(faqPageJsonLd),
        }}
      />
      <div className="py-12 md:py-20 text-center max-w-3xl mx-auto">
        <h1 className="text-4xl md:text-5xl font-bold tracking-tight text-zinc-900 mb-6">
          What free browser developer tools can you use?
        </h1>
        <p className="text-lg text-zinc-600 mb-8">
          InnoSage DevTools provides free, open-source browser utilities for QR
          codes, documents, audio, images, recordings, and video. The tools are
          fast, private, and available without ads or tracking.
        </p>
        <p className="text-sm text-zinc-600">
          Review the source code or contribute on{" "}
          <a
            href="https://github.com/innosage-llc/innosage-tools"
            target="_blank"
            rel="noopener noreferrer"
            className="font-medium text-orange-700 underline underline-offset-4 hover:text-orange-800"
          >
            GitHub
          </a>
          .
        </p>
        <p className="mt-3 text-xs text-zinc-500">
          Maintained and reviewed by InnoSage · Updated {lastReviewed}
        </p>
      </div>

      <section
        className="max-w-6xl mx-auto"
        aria-labelledby="available-tools-heading"
      >
        <div className="mb-8 text-center">
          <h2
            id="available-tools-heading"
            className="text-3xl font-bold text-zinc-900"
          >
            Which browser tools are available?
          </h2>
          <p className="mt-3 text-zinc-600">
            Choose a task below to launch a focused utility that runs directly
            in your browser.
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {/* Tool Card: URL to QR Code */}
          <Link href="/url-to-qrcode" className="group">
            <div className="bg-white border border-zinc-200 rounded-2xl p-6 hover:shadow-md hover:border-zinc-300 transition-all h-full flex flex-col">
              <div className="w-12 h-12 bg-orange-100 rounded-xl flex items-center justify-center mb-4 group-hover:scale-110 transition-transform">
                <QrCode className="text-orange-600" size={24} />
              </div>
              <h3 className="text-xl font-bold text-zinc-900 mb-2">
                URL to QR Code
              </h3>
              <p className="text-zinc-500 mb-6 flex-1">
                Turn any link into a phone-ready QR code instantly. Generated
                locally in your browser with no tracking.
              </p>
              <div className="flex items-center text-sm font-medium text-zinc-900 group-hover:text-orange-600 transition-colors">
                Launch Tool{" "}
                <ArrowRight
                  size={16}
                  className="ml-2 group-hover:translate-x-1 transition-transform"
                />
              </div>
            </div>
          </Link>

          {/* Tool Card: Markdown to PDF */}
          <Link href="/markdown-to-pdf" className="group">
            <div className="bg-white border border-zinc-200 rounded-2xl p-6 hover:shadow-md hover:border-zinc-300 transition-all h-full flex flex-col">
              <div className="w-12 h-12 bg-orange-100 rounded-xl flex items-center justify-center mb-4 group-hover:scale-110 transition-transform">
                <FileText className="text-orange-600" size={24} />
              </div>
              <h3 className="text-xl font-bold text-zinc-900 mb-2">
                Markdown to PDF
              </h3>
              <p className="text-zinc-500 mb-6 flex-1">
                Convert markdown text to a clean, print-ready PDF instantly in
                your browser. Perfect for documentation and quick notes.
              </p>
              <div className="flex items-center text-sm font-medium text-zinc-900 group-hover:text-orange-600 transition-colors">
                Launch Tool{" "}
                <ArrowRight
                  size={16}
                  className="ml-2 group-hover:translate-x-1 transition-transform"
                />
              </div>
            </div>
          </Link>

          {/* Tool Card: Audio Splitter */}
          <Link href="/audio-splitter" className="group">
            <div className="bg-white border border-zinc-200 rounded-2xl p-6 hover:shadow-md hover:border-zinc-300 transition-all h-full flex flex-col">
              <div className="w-12 h-12 bg-orange-100 rounded-xl flex items-center justify-center mb-4 group-hover:scale-110 transition-transform">
                <Scissors className="text-orange-600" size={24} />
              </div>
              <h3 className="text-xl font-bold text-zinc-900 mb-2">
                Audio Splitter
              </h3>
              <p className="text-zinc-500 mb-6 flex-1">
                Split large audio files into smaller chunks based on target
                size. Perfect for meeting recordings and transcription prep.
              </p>
              <div className="flex items-center text-sm font-medium text-zinc-900 group-hover:text-orange-600 transition-colors">
                Launch Tool{" "}
                <ArrowRight
                  size={16}
                  className="ml-2 group-hover:translate-x-1 transition-transform"
                />
              </div>
            </div>
          </Link>

          {/* Tool Card: Image Joiner */}
          <Link href="/image-joiner" className="group">
            <div className="bg-white border border-zinc-200 rounded-2xl p-6 hover:shadow-md hover:border-zinc-300 transition-all h-full flex flex-col">
              <div className="w-12 h-12 bg-orange-100 rounded-xl flex items-center justify-center mb-4 group-hover:scale-110 transition-transform">
                <Scissors className="text-orange-600" size={24} />
              </div>
              <h3 className="text-xl font-bold text-zinc-900 mb-2">
                Image Joiner
              </h3>
              <p className="text-zinc-500 mb-6 flex-1">
                Upload two images, crop them using a WYSIWYG pan/zoom interface,
                and join them side-by-side into a single downloadable image.
              </p>
              <div className="flex items-center text-sm font-medium text-zinc-900 group-hover:text-orange-600 transition-colors">
                Launch Tool{" "}
                <ArrowRight
                  size={16}
                  className="ml-2 group-hover:translate-x-1 transition-transform"
                />
              </div>
            </div>
          </Link>

          {/* Tool Card: SVG to Image */}
          <Link href="/svg-to-image" className="group">
            <div className="bg-white border border-zinc-200 rounded-2xl p-6 hover:shadow-md hover:border-zinc-300 transition-all h-full flex flex-col">
              <div className="w-12 h-12 bg-orange-100 rounded-xl flex items-center justify-center mb-4 group-hover:scale-110 transition-transform">
                <Maximize2 className="text-orange-600" size={24} />
              </div>
              <h3 className="text-xl font-bold text-zinc-900 mb-2">
                SVG to Image
              </h3>
              <p className="text-zinc-500 mb-6 flex-1">
                Convert SVG files to high-resolution PNG or JPEG images
                client-side. Perfect for design and presentation assets.
              </p>
              <div className="flex items-center text-sm font-medium text-zinc-900 group-hover:text-orange-600 transition-colors">
                Launch Tool{" "}
                <ArrowRight
                  size={16}
                  className="ml-2 group-hover:translate-x-1 transition-transform"
                />
              </div>
            </div>
          </Link>

          {/* Tool Card: Continuous Recorder */}
          <Link href="/recorder" className="group">
            <div className="bg-white border border-zinc-200 rounded-2xl p-6 hover:shadow-md hover:border-zinc-300 transition-all h-full flex flex-col">
              <div className="w-12 h-12 bg-orange-100 rounded-xl flex items-center justify-center mb-4 group-hover:scale-110 transition-transform">
                <Video className="text-orange-600" size={24} />
              </div>
              <h3 className="text-xl font-bold text-zinc-900 mb-2">
                A/V Recorder
              </h3>
              <p className="text-zinc-500 mb-6 flex-1">
                Record audio and video directly to your local disk. Mixes
                microphone and system audio seamlessly in the browser.
              </p>
              <div className="flex items-center text-sm font-medium text-zinc-900 group-hover:text-orange-600 transition-colors">
                Launch Tool{" "}
                <ArrowRight
                  size={16}
                  className="ml-2 group-hover:translate-x-1 transition-transform"
                />
              </div>
            </div>
          </Link>

          {/* Tool Card: Meeting Fixer */}
          <Link href="/meeting-fixer" className="group">
            <div className="bg-white border border-zinc-200 rounded-2xl p-6 hover:shadow-md hover:border-zinc-300 transition-all h-full flex flex-col">
              <div className="w-12 h-12 bg-orange-100 rounded-xl flex items-center justify-center mb-4 group-hover:scale-110 transition-transform">
                <Scissors className="text-orange-600" size={24} />
              </div>
              <h3 className="text-xl font-bold text-zinc-900 mb-2">
                Meeting Fixer
              </h3>
              <p className="text-zinc-500 mb-6 flex-1">
                Upload an incomplete meeting recording, record an amendment, and
                stitch them together instantly in your browser.
              </p>
              <div className="flex items-center text-sm font-medium text-zinc-900 group-hover:text-orange-600 transition-colors">
                Launch Tool{" "}
                <ArrowRight
                  size={16}
                  className="ml-2 group-hover:translate-x-1 transition-transform"
                />
              </div>
            </div>
          </Link>

          {/* Tool Card: Video to GIF */}
          <Link href="/video-to-gif" className="group">
            <div className="bg-white border border-zinc-200 rounded-2xl p-6 hover:shadow-md hover:border-zinc-300 transition-all h-full flex flex-col">
              <div className="w-12 h-12 bg-orange-100 rounded-xl flex items-center justify-center mb-4 group-hover:scale-110 transition-transform">
                <Video className="text-orange-600" size={24} />
              </div>
              <h3 className="text-xl font-bold text-zinc-900 mb-2">
                Video to GIF
              </h3>
              <p className="text-zinc-500 mb-6 flex-1">
                Convert videos to optimized GIFs instantly in your browser. Easy
                presets to hit common file size limits.
              </p>
              <div className="flex items-center text-sm font-medium text-zinc-900 group-hover:text-orange-600 transition-colors">
                Launch Tool{" "}
                <ArrowRight
                  size={16}
                  className="ml-2 group-hover:translate-x-1 transition-transform"
                />
              </div>
            </div>
          </Link>

          {/* Placeholder for Future Tools */}
          {/*
        <div className="bg-zinc-50 border border-zinc-100 rounded-2xl p-6 flex flex-col justify-center items-center text-center h-full opacity-60">
             <span className="text-zinc-400 font-medium">More coming soon...</span>
        </div> 
        */}
        </div>
      </section>

      <section
        className="max-w-4xl mx-auto py-16"
        aria-labelledby="tools-faq-heading"
      >
        <h2 id="tools-faq-heading" className="text-3xl font-bold text-zinc-900">
          What should you know about InnoSage DevTools?
        </h2>
        <p className="mt-3 text-zinc-600">
          InnoSage DevTools is a free, open-source collection designed for
          private, browser-based everyday tasks.
        </p>
        <dl className="mt-8 divide-y divide-zinc-200 border-y border-zinc-200">
          {faqs.map((faq) => (
            <div key={faq.question} className="py-6">
              <dt className="font-semibold text-zinc-900">{faq.question}</dt>
              <dd className="mt-2 text-zinc-600">{faq.answer}</dd>
            </div>
          ))}
        </dl>
      </section>

      <aside
        className="max-w-4xl mx-auto rounded-2xl bg-zinc-50 p-6 md:p-8"
        aria-labelledby="explore-next-heading"
      >
        <h2
          id="explore-next-heading"
          className="text-2xl font-bold text-zinc-900"
        >
          What can you explore next?
        </h2>
        <p className="mt-2 text-zinc-600">
          Explore the InnoSage engineering blog, product portfolio, or pricing
          after choosing a developer tool.
        </p>
        <nav
          className="mt-5 flex flex-wrap gap-x-6 gap-y-3"
          aria-label="Explore InnoSage"
        >
          <a
            className="font-medium text-orange-700 underline underline-offset-4"
            href="https://innosage.co/blog"
          >
            Engineering blog
          </a>
          <a
            className="font-medium text-orange-700 underline underline-offset-4"
            href="https://innosage.co/#products"
          >
            Product portfolio
          </a>
          <a
            className="font-medium text-orange-700 underline underline-offset-4"
            href="https://innosage.co/pricing"
          >
            Pricing
          </a>
        </nav>
      </aside>
    </ToolsLayout>
  );
}
