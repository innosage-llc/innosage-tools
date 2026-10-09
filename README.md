# InnoSage DevTools

InnoSage DevTools is a free, open-source collection of browser utilities for QR codes, documents, audio, images, recordings, and video. The canonical collection is available at [innosage.co/tools](https://innosage.co/tools).

## Which tools are included?

| Tool | What it does |
| --- | --- |
| URL to QR Code | Turns a link into a phone-ready QR code in the browser. |
| Markdown to PDF | Converts Markdown into a clean, print-ready PDF. |
| Audio Splitter | Splits large audio files into smaller chunks by target size. |
| Image Joiner | Crops and joins two images into one downloadable image. |
| SVG to Image | Converts SVG files into high-resolution PNG or JPEG images. |
| A/V Recorder | Records audio and video directly to local disk. |
| Meeting Fixer | Adds an amendment to an incomplete meeting recording and combines the files. |
| Video to GIF | Converts videos into optimized GIFs with practical size presets. |

## Are InnoSage DevTools private?

The tools are designed to process files locally in the browser. InnoSage does not add ads or tracking to the collection. Review the source in this repository before using a tool with sensitive material.

## How do I run the collection locally?

Install the dependencies and start the Next.js development server:

```bash
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) in a supported browser.

## How do I validate a change?

Run the repository's required quality gates before opening a pull request:

```bash
npm run lint
npm run build
npm run test:seo
```

## How do I deploy?

Use the same operator interface as Draft while retaining Cloudflare Pages:

```bash
npm run deploy:staging
npm run deploy:verify:staging
# Only after accepting that exact staging candidate and approving production:
npm run deploy:production
```

The staging command prints its immutable Pages URL. Open its `/tools/recorder`
path; no custom staging domain is needed. Merge-to-main does not publish
production. See [the deployment runbook](docs/runbooks/tools-deployment.md) for
version tags, retained artifacts, CI invocation, promotion and rollback.

## Can I contribute?

Yes. This public repository contains the source code for InnoSage DevTools. Issues and pull requests are welcome; keep changes focused, test them locally, and preserve browser-first file processing where practical.

## Who maintains InnoSage DevTools?

InnoSage DevTools is maintained by [InnoSage LLC](https://innosage.co), a two-person, privacy-first software studio building tools for writing, focus, video creation, and browser-based workflows.

- [Canonical tools collection](https://innosage.co/tools)
- [InnoSage engineering blog](https://innosage.co/blog)
- [InnoSage product portfolio](https://innosage.co/#products)

## License

InnoSage DevTools is available under the [MIT License](LICENSE).
