import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

const html = await readFile(resolve("out/index.html"), "utf8");
const canonicalUrl = "https://innosage.co/tools";

assert.match(
  html,
  /<title>Free Browser Developer Tools \| InnoSage<\/title>/,
  "The /tools page must have its own descriptive title.",
);
assert.match(
  html,
  new RegExp(
    `<link rel="canonical" href="${canonicalUrl.replaceAll("/", "\\/")}"`,
  ),
  "The /tools page must declare the production canonical URL.",
);
assert.match(
  html,
  /<meta property="og:type" content="website"/,
  "The /tools page must expose Open Graph metadata.",
);
assert.match(
  html,
  new RegExp(
    `<meta property="og:url" content="${canonicalUrl.replaceAll("/", "\\/")}"`,
  ),
  "The Open Graph URL must match the canonical URL.",
);
assert.doesNotMatch(
  html,
  /href="\/tools\/tools(?:["/#?])/,
  "The DevTools home link must not repeat the base path.",
);

const jsonLdBlocks = [
  ...html.matchAll(
    /<script type="application\/ld\+json">([\s\S]*?)<\/script>/g,
  ),
].map((match) => JSON.parse(match[1]));
const collectionPage = jsonLdBlocks.find(
  (block) => block["@type"] === "CollectionPage",
);
const faqPage = jsonLdBlocks.find((block) => block["@type"] === "FAQPage");

assert.ok(
  collectionPage,
  "The /tools page must publish CollectionPage JSON-LD.",
);
assert.equal(collectionPage.url, canonicalUrl);
assert.equal(collectionPage.mainEntity?.["@type"], "ItemList");
assert.equal(collectionPage.mainEntity?.numberOfItems, 8);
assert.equal(collectionPage.mainEntity?.itemListElement?.length, 8);

assert.ok(faqPage, "The /tools page must publish FAQPage JSON-LD.");
assert.equal(faqPage.url, canonicalUrl);
assert.equal(faqPage.mainEntity?.length, 4);

assert.equal(
  html.match(/<h1(?:\s|>)/g)?.length,
  1,
  "The /tools page must contain exactly one H1.",
);
assert.equal(
  html.match(/<h2(?:\s|>)/g)?.length,
  3,
  "The /tools page must use question-led H2 section headings.",
);
assert.equal(
  html.match(/<h3(?:\s|>)/g)?.length,
  8,
  "Each listed tool must use an H3 heading under the collection section.",
);

assert.match(
  html,
  /<h1[^>]*>What free browser developer tools can you use\?<\/h1>/,
  "The /tools H1 must be a direct, question-led query.",
);
assert.match(
  html,
  /Maintained and reviewed by InnoSage/,
  "The /tools page must expose visible ownership and review information.",
);

console.log("SEO contract verified for out/index.html");
