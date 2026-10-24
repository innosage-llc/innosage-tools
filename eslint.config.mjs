import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    ".deploy/**",
    ".wrangler/**",
    "build/**",
    "public/video-scissors/ffmpeg/**",
    "spikes/byos-sync/.browser-bundle.js",
    "spikes/byos-sync/native-overlay/.generated/**",
    "spikes/byos-remediation/.browser-bundle.js",
    "next-env.d.ts",
  ]),
]);

export default eslintConfig;
