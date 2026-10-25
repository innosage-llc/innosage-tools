// Actual exported route smoke. Scenes below are control fixtures, NOT vision proof.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";
import { chromium } from "playwright";

test(
  "public Visual Remix route: local input, proposal/apply, reuse, editing and privacy",
  { timeout: 120_000 },
  async () => {
    const root = path.resolve(
        path.dirname(fileURLToPath(import.meta.url)),
        "..",
      ),
      output = path.join(root, ".deploy", "visual-remix-editor");
    await mkdir(output, { recursive: true });
    const requests = [];
    const server = createServer(async (req, res) => {
      const request = { method: req.method, path: req.url, bodyBytes: 0 };
      requests.push(request);
      req.on("data", (chunk) => {
        request.bodyBytes += chunk.length;
      });
      try {
        const url = new URL(req.url, "http://localhost");
        let relative = decodeURIComponent(url.pathname).replace(
          /^\/tools\/?/,
          "",
        );
        if (relative.includes("..")) {
          res.statusCode = 400;
          return res.end();
        }
        if (!relative) relative = "index.html";
        else if (!path.extname(relative)) relative += ".html";
        const file = path.join(root, "out", relative);
        const mime =
          {
            ".html": "text/html",
            ".js": "text/javascript",
            ".css": "text/css",
            ".png": "image/png",
            ".woff2": "font/woff2",
            ".svg": "image/svg+xml",
          }[path.extname(file)] ?? "application/octet-stream";
        res.setHeader("Content-Type", mime);
        res.end(await readFile(file));
      } catch {
        res.statusCode = 404;
        res.end();
      }
    });
    await new Promise((resolve, reject) => {
      server.once("error", reject);
      server.listen(0, "127.0.0.1", resolve);
    });
    let browser;
    try {
      const origin = `http://127.0.0.1:${server.address().port}`;
      browser = await chromium.launch({ headless: true });
      const page = await browser.newPage({
        viewport: { width: 1440, height: 1100 },
        acceptDownloads: true,
      });
      const errors = [],
        external = [];
      page.on("pageerror", (e) => errors.push(e.message));
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
      await page.getByText("Ready. Select a reference or open a saved project.", { exact:true }).waitFor();
      const initialJS = await page.evaluate(() =>
        performance
          .getEntriesByType("resource")
          .filter((r) => r.name.includes(".js"))
          .map((r) => new URL(r.name).pathname),
      );
      async function download(name) {
        const event = page.waitForEvent("download");
        await page.getByRole("button", { name, exact: true }).click();
        const result = await event;
        const bytes = await readFile(await result.path());
        return { bytes, name: result.suggestedFilename() };
      }
      const raster = await page.evaluate(() => {
        const c = document.createElement("canvas");
        c.width = 120;
        c.height = 160;
        const x = c.getContext("2d");
        x.fillStyle = "#ffb347";
        x.fillRect(0, 0, 120, 160);
        return {
          png: c.toDataURL("image/png").split(",")[1],
          jpeg: c.toDataURL("image/jpeg", 0.9).split(",")[1],
        };
      });
      const image = Buffer.from(raster.png, "base64");
      const jpeg = Buffer.from(raster.jpeg, "base64");
      assert.equal(jpeg.readUInt16BE(0), 0xffd8);
      await page.getByLabel("Reference image", { exact: true }).setInputFiles({
        name: "private-reference-name.png",
        mimeType: "image/png",
        buffer: image,
      });
      await page
        .getByText("Reference ready locally.", { exact: false })
        .waitFor();
      assert.ok(
        (
          await page.getByAltText("Reference · local only").getAttribute("src")
        ).startsWith("blob:"),
      );
      await page
        .getByText("Approve local raster assets (0/10)", { exact: true })
        .click();
      await page
        .getByLabel("Approve local asset", { exact: true })
        .setInputFiles({
          name: "private-crop-name.jpg",
          mimeType: "image/jpeg",
          buffer: jpeg,
        });
      await page
        .getByText("Only its descriptor appears", { exact: false })
        .waitFor();
      const brief = JSON.parse(
        (await download("Download agent brief")).bytes.toString(),
      );
      assert.equal(brief.approvedAssets.length, 1);
      assert.equal(brief.approvedAssets[0].mime, "image/jpeg");
      assert.equal(brief.currentScene.nodes.length, 0);
      assert.doesNotMatch(
        JSON.stringify(brief),
        /private-reference-name|private-crop-name|data:image|blob:|base64/,
      );
      const scene = {
        ...brief.currentScene,
        background: "#f7f4ea",
        nodes: [
          {
            id: "title",
            type: "text",
            x: 80,
            y: 100,
            width: 900,
            height: 100,
            rotation: 0,
            opacity: 1,
            text: "UI control fixture · 可编辑",
            font: "sans",
            fontSize: 48,
            fontWeight: "bold",
            lineHeight: 1.3,
            align: "left",
            wrap: "word",
            fill: "#14213d",
          },
          {
            id: "graphic",
            type: "rect",
            x: 80,
            y: 300,
            width: 600,
            height: 400,
            rotation: 0,
            opacity: 1,
            fill: "#ffb347",
            cornerRadius: 20,
          },
          {
            id: "crop",
            type: "image",
            x: 800,
            y: 800,
            width: 120,
            height: 160,
            rotation: 0,
            opacity: 1,
            assetId: brief.approvedAssets[0].id,
            crop: { x: 0, y: 0, width: 120, height: 160 },
          },
        ],
        assets: brief.approvedAssets,
        captions: {
          titleCN: "本地测试",
          captionCN: "这是界面控件测试，不是视觉重建证据。",
          titleEN: "Local UI test",
          captionEN: "A control fixture, not agent reconstruction.",
        },
        provenance: "Original synthetic UI control fixture.",
        limitations: "No image interpretation was performed.",
      };
      const proposal = {
        ...brief.proposalIdentity,
        requestId: "ui-first",
        scene,
        explanation: "Control fixture: new text, layout and approved raster.",
      };
      await page
        .getByLabel("Import proposal file", { exact: true })
        .setInputFiles({
          name: "proposal.json",
          mimeType: "application/json",
          buffer: Buffer.from(JSON.stringify(proposal)),
        });
      await page
        .getByRole("button", { name: "Apply candidate", exact: true })
        .waitFor();
      assert.match(await page.getByTestId("revision").textContent(), /0/);
      assert.equal(
        JSON.parse(await page.getByTestId("applied-scene").textContent()).nodes
          .length,
        0,
      );
      const candidateBytes = await page
        .getByAltText("Candidate · not applied")
        .evaluate(async (image) =>
          Array.from(
            new Uint8Array(await (await fetch(image.src)).arrayBuffer()),
          ),
        );
      await page.evaluate(() => window.scrollTo(0, 0));
      await page.evaluate(() => new Promise(requestAnimationFrame));
      await page.screenshot({
        path: path.join(output, "candidate-desktop.png"),
        fullPage: true,
      });
      await page
        .getByRole("button", { name: "Apply candidate", exact: true })
        .click();
      assert.match(await page.getByTestId("revision").textContent(), /1/);
      const png = await download("Download PNG");
      assert.deepEqual(png.bytes, Buffer.from(candidateBytes));
      assert.equal(png.bytes.readUInt32BE(16), 1080);
      assert.equal(png.bytes.readUInt32BE(20), 1440);
      const saved = await download("Save project");
      const project = JSON.parse(saved.bytes.toString());
      assert.equal(project.assets.length, 1);
      assert.equal(
        project.assets[0].data,
        `data:image/jpeg;base64,${raster.jpeg}`,
      );
      assert.doesNotMatch(
        saved.bytes.toString(),
        /private-reference-name|private-crop-name/,
      );
      await writeFile(path.join(output, "applied.png"), png.bytes);
      await writeFile(path.join(output, "control.project.json"), saved.bytes);
      await page
        .getByLabel("Proposal JSON", { exact: true })
        .fill('{"unsafe":"<script>"}');
      await page
        .getByRole("button", { name: "Preview proposal", exact: true })
        .click();
      await page
        .getByRole("alert")
        .filter({ hasText: /INVALID_SCENE_DATA|Invalid scene data/ })
        .waitFor();
      assert.match(await page.getByTestId("revision").textContent(), /1/);
      assert.deepEqual((await download("Download PNG")).bytes, png.bytes);
      await page.reload();
      await page.getByText("Ready. Select a reference or open a saved project.", { exact:true }).waitFor();
      await page.getByLabel("Open project", { exact: true }).setInputFiles({
        name: "reusable.json",
        mimeType: "application/json",
        buffer: saved.bytes,
      });
      await page
        .getByText("Project reopened with fresh approval identity.", {
          exact: false,
        })
        .waitFor();
      assert.equal(
        await page.getByAltText("Reference · local only").count(),
        0,
      );
      const reuseBrief = JSON.parse(
        (await download("Download agent brief")).bytes.toString(),
      );
      assert.notEqual(
        reuseBrief.proposalIdentity.generation,
        brief.proposalIdentity.generation,
      );
      assert.equal(reuseBrief.currentScene.nodes.length, 3);
      const appliedScene=async()=>JSON.parse(await page.getByTestId('applied-scene').textContent());
      const waitRevision=revision=>page.waitForFunction(r=>Number(document.querySelector('[data-testid=revision]').textContent.replace(/\D/g,''))>r,revision);
      let revision=Number((await page.getByTestId('revision').textContent()).replace(/\D/g,''));
      await page.getByLabel('Layer',{exact:true}).selectOption('crop');
      await page.getByRole('button',{name:'Remove selected',exact:true}).click();await waitRevision(revision);
      const removed=JSON.parse((await download('Save project')).bytes.toString());assert.equal(removed.scene.nodes.some(n=>n.type==='image'),false);assert.deepEqual(removed.scene.assets,[]);assert.deepEqual(removed.assets,[]);
      await page.getByRole('button',{name:'Undo last apply',exact:true}).click();
      const restored=JSON.parse((await download('Save project')).bytes.toString());assert.deepEqual(restored.scene,project.scene);assert.deepEqual(restored.assets,project.assets);
      await page.getByLabel('Layer',{exact:true}).selectOption('title');
      revision=Number((await page.getByTestId('revision').textContent()).replace(/\D/g,''));
      await page.getByLabel('Text content',{exact:true}).fill('Second post · 重用已有设计');
      assert.equal(await page.getByRole('button',{name:'Download PNG',exact:true}).isDisabled(),true,'pending local draft cannot export the old PNG');
      await page.getByLabel('Node y',{exact:true}).fill('190');
      await page.getByText('Chinese / English publishing captions',{exact:true}).click();await page.getByLabel('titleCN',{exact:true}).fill('第二篇文章');
      await page.waitForFunction(()=>JSON.parse(document.querySelector('[data-testid=applied-scene]').textContent).captions.titleCN==='第二篇文章');
      assert.equal((await appliedScene()).nodes[0].y,190);assert.match((await appliedScene()).nodes[0].text,/Second post/);
      assert.equal(await page.getByRole('button',{name:'Apply candidate',exact:true}).count(),0,'local parameters do not require Apply');
      assert.equal(JSON.parse((await download('Download captions')).bytes.toString()).captions.titleCN,'第二篇文章');
      await page.getByRole('button',{name:'Undo last apply',exact:true}).click();assert.equal((await appliedScene()).nodes[0].y,100);
      const beforeRevoke=await download('Download PNG');
      // Revoke must restore canceled form values, not merely the PNG.
      await page.getByLabel('Node y',{exact:true}).fill('333');
      await page.getByRole('button',{name:'Revoke pending work',exact:true}).click();
      assert.equal(await page.getByLabel('Node y',{exact:true}).inputValue(),'100');
      await page.getByLabel('Node x',{exact:true}).fill('90');
      await page.waitForFunction(()=>JSON.parse(document.querySelector('[data-testid=applied-scene]').textContent).nodes[0].x===90);
      assert.equal((await appliedScene()).nodes[0].y,100,'a later edit cannot resurrect a revoked local y');
      await page.getByRole('button',{name:'Undo last apply',exact:true}).click();
      assert.deepEqual((await download('Download PNG')).bytes,beforeRevoke.bytes);
      // Remote/imported agent proposals remain separate, explicitly applied candidates.
      const previewRemote=async(id)=>{const b=JSON.parse((await download('Download agent brief')).bytes.toString());const changed=structuredClone(b.currentScene);changed.nodes[0].y=160;await page.getByLabel('Proposal JSON',{exact:true}).fill(JSON.stringify({...b.proposalIdentity,requestId:id,scene:changed,explanation:'Remote candidate remains pending'}));await page.getByRole('button',{name:'Preview proposal',exact:true}).click();await page.getByRole('button',{name:'Apply candidate',exact:true}).waitFor();return b;};
      await previewRemote('remote-cancel');await page.getByRole('button',{name:'Cancel candidate',exact:true}).click();assert.deepEqual((await download('Download PNG')).bytes,beforeRevoke.bytes);
      // Starting a proposal operation cancels an invalid draft and resets inputs.
      const operationBrief=JSON.parse((await download('Download agent brief')).bytes.toString());
      await page.getByLabel('Node fill',{exact:true}).fill('invalid');
      await page.getByText('These parameters could not render.',{exact:false}).waitFor();
      const operationBase=await appliedScene();
      await page.getByLabel('Proposal JSON',{exact:true}).fill(JSON.stringify({...operationBrief.proposalIdentity,requestId:'invalid-draft-reset',scene:operationBrief.currentScene,explanation:'Resets canceled local draft'}));
      await page.getByRole('button',{name:'Preview proposal',exact:true}).click();
      await page.getByRole('button',{name:'Cancel candidate',exact:true}).waitFor();
      assert.equal(await page.getByLabel('Node fill',{exact:true}).inputValue(),operationBase.nodes[0].fill);
      await page.getByRole('button',{name:'Cancel candidate',exact:true}).click();
      const oldBrief=await previewRemote('remote-revoke');await page.getByRole('button',{name:'Revoke pending work',exact:true}).click();assert.equal(await page.getByRole('button',{name:'Apply candidate',exact:true}).count(),0);
      const stale={...oldBrief.proposalIdentity,requestId:'stale-after-revoke',scene:oldBrief.currentScene,explanation:'Must be rejected.'};await page.getByLabel('Proposal JSON',{exact:true}).fill(JSON.stringify(stale));await page.getByRole('button',{name:'Preview proposal',exact:true}).click();await page.getByText('stale-after-revoke: stale.',{exact:false}).waitFor();assert.deepEqual((await download('Download PNG')).bytes,beforeRevoke.bytes);
      // Revoke during a non-abortable File.text() must invalidate its later result.
      await page.evaluate(() => {
        const original = File.prototype.text;
        File.prototype.text = function () {
          const result = original.call(this);
          if (this.name !== "delayed.json") return result;
          return new Promise((resolve) => {
            globalThis.releaseProjectRead = () => {
              File.prototype.text = original;
              result.then(resolve);
            };
          });
        };
      });
      await page.getByLabel("Open project", { exact: true }).setInputFiles({
        name: "delayed.json",
        mimeType: "application/json",
        buffer: saved.bytes,
      });
      await page
        .getByRole("button", { name: "Revoke pending work", exact: true })
        .click();
      await page.evaluate(async () => {
        globalThis.releaseProjectRead();
        await new Promise((resolve) => setTimeout(resolve, 50));
      });
      assert.deepEqual(
        (await download("Download PNG")).bytes,
        beforeRevoke.bytes,
      );
      // Local overflow auto-applies for correction, but genuine export safety remains.
      revision=Number((await page.getByTestId('revision').textContent()).replace(/\D/g,''));
      await page.getByLabel('Node width',{exact:true}).fill('1');await waitRevision(revision);
      assert.equal(await page.getByRole('button',{name:'Download PNG',exact:true}).isDisabled(),true);
      await page.getByRole('button',{name:'Undo last apply',exact:true}).click();
      const validBefore=await download('Download PNG');
      await page.getByLabel('Node fill',{exact:true}).fill('invalid');
      await page.getByText('These parameters could not render.',{exact:false}).waitFor();assert.equal(await page.getByRole('button',{name:'Save project',exact:true}).isDisabled(),true);
      await page.getByRole('button',{name:'Discard local draft',exact:true}).click();assert.deepEqual((await download('Download PNG')).bytes,validBefore.bytes);
      // Tight crop approval is separate from selecting a reference and from Apply.
      await page.getByRole("button",{name:"New blank project",exact:true}).click();
      await page.getByText("New blank project ready.",{exact:true}).waitFor();
      await page.getByLabel("Reference image",{exact:true}).setInputFiles({name:"private-reference-name.png",mimeType:"image/png",buffer:image});
      await page.getByText("Reference ready locally.",{exact:false}).waitFor();
      const cropDetails=page.locator("details").filter({has:page.getByText("Approve local raster assets (0/10)",{exact:true})});
      if(!await cropDetails.evaluate(el=>el.open))await page.getByText("Approve local raster assets (0/10)",{exact:true}).click();
      await page.getByLabel("Crop x",{exact:true}).fill("10");await page.getByLabel("Crop y",{exact:true}).fill("20");
      await page.getByLabel("Crop width",{exact:true}).fill("30");await page.getByLabel("Crop height",{exact:true}).fill("40");
      await page.getByRole("button",{name:"Preview crop",exact:true}).click();
      await page.getByAltText("Crop pixels to approve",{exact:true}).waitFor();
      assert.equal(JSON.parse((await download("Download agent brief")).bytes.toString()).approvedAssets.length,0,"preview is not approval");
      await page.getByRole("button",{name:"Approve crop and preview placement",exact:true}).click();
      await page.getByRole("button",{name:"Apply candidate",exact:true}).waitFor();
      assert.equal(JSON.parse(await page.getByTestId("applied-scene").textContent()).nodes.length,0,"approval is not Apply");
      await page.getByRole("button",{name:"Apply candidate",exact:true}).click();
      const cropped=JSON.parse((await download("Save project")).bytes.toString());
      assert.equal(cropped.assets.length,1);assert.equal(cropped.scene.assets[0].width,30);assert.equal(cropped.scene.assets[0].height,40);
      const cropBytes=Buffer.from(cropped.assets[0].data.split(',')[1],'base64');assert.equal(cropBytes.readUInt32BE(16),30);assert.equal(cropBytes.readUInt32BE(20),40);
      assert.equal(cropped.scene.nodes[0].type,"image");assert.equal(cropped.scene.nodes[0].assetId,cropped.scene.assets[0].id);
      const cropPNG=await download("Download PNG");
      await page.getByLabel("Open project",{exact:true}).setInputFiles({name:"cropped-project.json",mimeType:"application/json",buffer:Buffer.from(JSON.stringify(cropped))});
      await page.getByText("Project reopened with fresh approval identity.",{exact:false}).waitFor();
      assert.equal(await page.getByAltText("Reference · local only").count(),0);
      assert.deepEqual((await download("Download PNG")).bytes,cropPNG.bytes);
      const cropReused=JSON.parse((await download("Save project")).bytes.toString());assert.deepEqual(cropReused.assets,cropped.assets);
      await page.setViewportSize({ width: 390, height: 844 });
      await page.evaluate(() => window.scrollTo(0, 0));
      await page.evaluate(() => new Promise(requestAnimationFrame));
      await page.screenshot({
        path: path.join(output, "mobile.png"),
        fullPage: true,
      });
      await page
        .getByRole("heading", { name: "Applied image", exact: true })
        .evaluate((element) =>
          window.scrollTo(
            0,
            element.getBoundingClientRect().top + window.scrollY - 80,
          ),
        );
      await page.screenshot({
        path: path.join(output, "mobile-preview-viewport.png"),
      });
      assert.equal(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= window.innerWidth,
        ),
        true,
        "no horizontal mobile overflow",
      );
      assert.deepEqual(errors, []);
      assert.deepEqual(external, []);
      assert.ok(
        requests.every(
          (r) => ["GET", "HEAD"].includes(r.method) && r.bodyBytes === 0,
        ),
        `no image uploads or mutation requests: ${JSON.stringify(requests.filter((r) => !["GET", "HEAD"].includes(r.method) || r.bodyBytes))}`,
      );
      const index = await browser.newPage();
      await index.goto(origin + "/tools");
      await index.waitForLoadState("networkidle");
      const indexJS = await index.evaluate(() =>
        performance
          .getEntriesByType("resource")
          .filter((r) => r.name.includes(".js"))
          .map((r) => new URL(r.name).pathname),
      );
      const details = [];
      const htmlScripts = async (file) =>
        [
          ...(await readFile(path.join(root, "out", file), "utf8")).matchAll(
            /<script[^>]+src="([^"]+)"/g,
          ),
        ].map((match) => match[1]);
      const routeInitialScripts = await htmlScripts("visual-remix.html"),
        indexInitialScripts = await htmlScripts("index.html");
      for (const url of [...new Set(initialJS)]) {
        const bytes = await readFile(
          path.join(root, "out", url.replace(/^\/tools\//, "")),
        );
        details.push({
          url,
          bytes: bytes.length,
          gzip: gzipSync(bytes).length,
          sharedWithIndex: indexJS.includes(url),
          inInitialRouteHTML: routeInitialScripts.includes(url),
          inInitialIndexHTML: indexInitialScripts.includes(url),
          containsKonva: /Konva/.test(bytes.toString()),
        });
      }
      const report = {
        browser: browser.version(),
        classification:
          "Control-fixture UI workflow, NOT actual agent vision acceptance",
        checks: [
          "reference local preview",
          "tight reference crop: preview/approval/Apply separate, embedded cropped pixels, reopen same PNG without reference",
          "approved asset descriptor-only brief",
          "separate candidate",
          "explicit apply",
          "preview/download exact bytes",
          "PNG reference and real JPEG asset header/decode/portable reload",
          "project/assets reload without reference",
          "removed image excluded from portable descriptors/bytes; Undo retains crop and JPEG",
          "content+geometry+caption edit auto-applies without Preview/Apply; pending/invalid draft export block; coalesced Undo",
          "undo/cancel/revoke/stale preservation",
          "revoke during delayed project file read",
          "invalid export blocked",
          "390px responsive",
          "no POST/external upload",
        ],
        requests: requests.length,
        externalRequests: external.length,
        scriptChunks: details,
        initialRouteExtraJS: details
          .filter((d) => d.inInitialRouteHTML && !d.inInitialIndexHTML)
          .reduce(
            (sum, d) => ({
              bytes: sum.bytes + d.bytes,
              gzip: sum.gzip + d.gzip,
            }),
            { bytes: 0, gzip: 0 },
          ),
        routeOnlyJS: details
          .filter((d) => !d.sharedWithIndex)
          .reduce(
            (s, d) => ({ bytes: s.bytes + d.bytes, gzip: s.gzip + d.gzip }),
            { bytes: 0, gzip: 0 },
          ),
      };
      await writeFile(
        path.join(output, "route-evidence.json"),
        JSON.stringify(report, null, 2) + "\n",
      );
      console.log(JSON.stringify(report));
    } finally {
      await browser?.close();
      await new Promise((resolve) => server.close(resolve));
    }
  },
);
