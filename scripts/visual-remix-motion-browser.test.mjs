import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { chromium } from "playwright";

test(
  "actual route WASM motion, decoded frames, playback, cancellation and stale authority",
  { timeout: 240000 },
  async () => {
    const root = process.cwd(),
      output = path.join(root, ".deploy/visual-remix-motion");
    await mkdir(output, { recursive: true });
    const requests = [],
      external = [];
    const server = createServer(async (req, res) => {
      requests.push({ method: req.method, url: req.url });
      try {
        let relative = new URL(req.url, "http://localhost").pathname.replace(
          /^\/tools\/?/,
          "",
        );
        if (relative.includes("..")) throw new Error("path");
        if (!relative) relative = "index.html";
        else if (!path.extname(relative)) relative += ".html";
        res.setHeader(
          "Content-Type",
          {
            ".html": "text/html",
            ".js": "text/javascript",
            ".css": "text/css",
            ".woff2": "font/woff2",
          }[path.extname(relative)] || "application/octet-stream",
        );
        res.end(await readFile(path.join(root, "out", relative)));
      } catch {
        res.statusCode = 404;
        res.end();
      }
    });
    await new Promise((r) => server.listen(0, "127.0.0.1", r));
    let browser;
    try {
      const origin = `http://127.0.0.1:${server.address().port}`;
      browser = await chromium.launch({ headless: true });
      const page = await browser.newPage({ acceptDownloads: true });
      await page.route("**/*", (route) => {
        if (!route.request().url().startsWith(origin)) {
          external.push(route.request().url());
          return route.abort();
        }
        return route.continue();
      });
      await page.goto(origin + "/tools/visual-remix");
      await page
        .getByRole("button", { name: "Download agent brief", exact: true })
        .waitFor();
      async function download(name) {
        const event = page.waitForEvent("download");
        await page.getByRole("button", { name, exact: true }).click();
        return readFile(await (await event).path());
      }
      const brief = JSON.parse(
        (await download("Download agent brief")).toString(),
      );
      const scene = {
        ...brief.currentScene,
        background: "#e6ecd5",
        nodes: [
          {
            id: "panel",
            type: "rect",
            x: 100,
            y: 160,
            width: 880,
            height: 700,
            rotation: 0,
            opacity: 1,
            fill: "#254c38",
            cornerRadius: 20,
          },
          {
            id: "title",
            type: "text",
            x: 150,
            y: 230,
            width: 760,
            height: 300,
            rotation: 0,
            opacity: 1,
            text: "NIGHT GARDEN\n城市夜花园",
            font: "sans",
            fontSize: 64,
            fontWeight: "bold",
            lineHeight: 1.3,
            align: "left",
            wrap: "word",
            fill: "#f4f5d6",
          },
          {
            id: "accent",
            type: "rect",
            x: 100,
            y: 1000,
            width: 880,
            height: 200,
            rotation: 0,
            opacity: 1,
            fill: "#db7656",
            cornerRadius: 0,
          },
        ],
      };
      await page.getByLabel("Proposal JSON", { exact: true }).fill(
        JSON.stringify({
          ...brief.proposalIdentity,
          schemaVersion: 1,
          requestId: "motion-control",
          scene,
          explanation: "Control fixture for actual motion encoding",
        }),
      );
      await page
        .getByRole("button", { name: "Preview proposal", exact: true })
        .click();
      await page
        .getByRole("button", { name: "Apply candidate", exact: true })
        .click();
      const source = await download("Download PNG");
      await writeFile(path.join(output, "source.png"), source);
      assert.equal(
        requests.some((r) => r.url.includes("/ffmpeg/")),
        false,
        "PNG flow must not fetch video runtime",
      );
      // Cancel a real runtime load; no stale completion may publish a video.
      await page
        .getByRole("button", { name: "Export MP4", exact: true })
        .click();
      await page.waitForRequest((r) => r.url().includes("core.wasm.gz"));
      await page
        .getByRole("button", { name: "Cancel motion export", exact: true })
        .click();
      assert.match(
        await page.getByTestId("motion-status").textContent(),
        /cancelled/,
      );
      assert.deepEqual(await download("Download PNG"), source);
      assert.equal(
        await page
          .getByRole("button", { name: "Download MP4", exact: true })
          .count(),
        0,
      );
      const started = Date.now();
      await page
        .getByRole("button", { name: "Export MP4", exact: true })
        .click();
      await page
        .getByRole("button", { name: "Download MP4", exact: true })
        .waitFor({ timeout: 150000 });
      const elapsedMs = Date.now() - started,
        mp4 = await download("Download MP4");
      await writeFile(path.join(output, "motion.mp4"), mp4);
      const decoded = await page.evaluate(async (base64) => {
        const video = document.querySelector(
          'video[aria-label="Applied scene motion preview"]',
        );
        if (video.readyState < 2)
          await new Promise((resolve, reject) => {
            video.onloadeddata = resolve;
            video.onerror = reject;
          });
        const canvas = document.createElement("canvas");
        canvas.width = 1080;
        canvas.height = 1440;
        const ctx = canvas.getContext("2d", { willReadFrequently: true });
        const img = new Image();
        img.src = "data:image/png;base64," + base64;
        await img.decode();
        ctx.drawImage(img, 0, 0);
        const source = ctx.getImageData(0, 0, 1080, 1440).data;
        const frames = [];
        let held;
        for (const time of [0.001, 0.25, 2.5, 4.9]) {
          await new Promise((resolve) => {
            video.onseeked = resolve;
            video.currentTime = time;
          });
          ctx.drawImage(video, 0, 0);
          const data = ctx.getImageData(0, 0, 1080, 1440).data;
          let error = 0,
            stable = 0,
            count = 0;
          for (let i = 0; i < data.length; i += 4) {
            for (let c = 0; c < 3; c++) {
              error += Math.abs(data[i + c] - source[i + c]);
              if (held) stable += Math.abs(data[i + c] - held[i + c]);
              count++;
            }
          }
          frames.push({
            time,
            meanAbsoluteError: error / count,
            stableMAE: held ? stable / count : null,
            background: Array.from(data.slice(0, 3)),
            panel: Array.from(
              data.slice((500 * 1080 + 500) * 4, (500 * 1080 + 500) * 4 + 3),
            ),
            png: canvas.toDataURL().split(",")[1],
          });
          if (time === 2.5) held = data;
        }
        video.currentTime = 1;
        video.muted = true;
        await video.play();
        await new Promise((r) => setTimeout(r, 250));
        const playing = video.currentTime > 1;
        video.pause();
        return {
          width: video.videoWidth,
          height: video.videoHeight,
          duration: video.duration,
          playing,
          frames,
        };
      }, source.toString("base64"));
      assert.equal(decoded.width, 1080);
      assert.equal(decoded.height, 1440);
      assert.ok(Math.abs(decoded.duration - 5) < 0.1);
      assert.equal(decoded.playing, true);
      const bg = [230, 236, 213];
      assert.ok(
        decoded.frames[0].panel.every((x, i) => Math.abs(x - bg[i]) < 8),
        "first frame is scene background",
      );
      assert.ok(
        decoded.frames[1].meanAbsoluteError >
          decoded.frames[2].meanAbsoluteError + 10,
        "fade transitions into scene",
      );
      assert.ok(
        decoded.frames[3].meanAbsoluteError < 5,
        "held frame matches PNG within lossy encoding",
      );
      assert.ok(decoded.frames[3].stableMAE < 1, "stable hold");
      for (const frame of decoded.frames) {
        await writeFile(
          path.join(output, `frame-${frame.time}.png`),
          Buffer.from(frame.png, "base64"),
        );
        delete frame.png;
      }
      await page
        .getByRole("button", { name: "Revoke pending work", exact: true })
        .click();
      assert.equal(
        await page
          .getByRole("button", { name: "Download MP4", exact: true })
          .count(),
        0,
      );
      await page.locator("video").waitFor({ state: "detached" });
      assert.deepEqual(await download("Download PNG"), source);
      await page.evaluate(() => {
        window.DecompressionStream = undefined;
      });
      await page
        .getByRole("button", { name: "Export MP4", exact: true })
        .click();
      await page
        .getByTestId("motion-status")
        .filter({ hasText: "Use a current desktop Chrome" })
        .waitFor();
      assert.deepEqual(await download("Download PNG"), source);
      assert.equal(
        await page
          .getByRole("button", { name: "Download MP4", exact: true })
          .count(),
        0,
      );
      assert.equal(external.length, 0);
      assert.ok(requests.every((r) => ["GET", "HEAD"].includes(r.method)));
      const evidence = {
        browser: browser.version(),
        elapsedMs,
        outputBytes: mp4.length,
        decoded,
        requests: requests.length,
        externalRequests: external.length,
        runtime: "Actual browser FFmpeg WASM, not native ffmpeg",
        checks: [
          "lazy runtime",
          "cancel real load preserves PNG",
          "verified MP4 metadata/play/seek",
          "decoded background/fade/hold",
          "revoke removes stale video and preserves PNG",
          "unsupported processor explains fallback and preserves PNG",
        ],
      };
      await writeFile(
        path.join(output, "motion-evidence.json"),
        JSON.stringify(evidence, null, 2) + "\n",
      );
      console.log(JSON.stringify(evidence));
    } finally {
      await browser?.close();
      await new Promise((r) => server.close(r));
    }
  },
);
