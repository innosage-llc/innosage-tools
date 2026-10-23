import { test } from "node:test";
import assert from "node:assert/strict";
import { RemixMotion, motionBackground } from "../lib/visual-remix-motion.ts";
const png = new Blob(["unchanged PNG"], { type: "image/png" });
const mp4 = new Blob(["verified video"], { type: "video/mp4" });
test("motion captures exact PNG; single active encoder and stale completion cannot restore old video", async () => {
  const motion = new RemixMotion();
  motion.bind("project-generation-revision1");
  let release!: (value: Blob) => void, activeSignal!: AbortSignal;
  const pending = motion.render(
    png,
    "#123456",
    async (input, background, signal) => {
      assert.equal(input, png);
      assert.equal(background, "#123456");
      activeSignal = signal;
      return new Promise((resolve) => (release = resolve));
    },
    () => {},
  );
  await assert.rejects(
    motion.render(
      png,
      "#123456",
      async () => mp4,
      () => {},
    ),
    /already running/,
  );
  motion.bind("project-generation-revision2");
  assert.equal(activeSignal.aborted, true);
  release(mp4);
  assert.equal(await pending, false);
  assert.equal(motion.output, null);
  assert.equal(await png.text(), "unchanged PNG");
});
test("cancel and failed re-export preserve current good output, authority changes invalidate it", async () => {
  const motion = new RemixMotion();
  motion.bind("a");
  await motion.render(
    png,
    "#ffffff",
    async () => mp4,
    () => {},
  );
  await assert.rejects(
    motion.render(
      png,
      "#ffffff",
      async () => new Blob(),
      () => {},
    ),
    /empty or invalid/,
  );
  assert.equal(motion.output, mp4);
  let release!: (value: Blob) => void;
  const pending = motion.render(
    png,
    "#ffffff",
    async () => new Promise((resolve) => (release = resolve)),
    () => {
      throw new Error("late progress");
    },
  );
  motion.cancel();
  release(mp4);
  assert.equal(await pending, false);
  assert.equal(motion.output, mp4);
  motion.bind("revoked");
  assert.equal(motion.output, null);
});

test("transparent scene backgrounds explain MP4 limitation; explicit opaque alpha normalizes", () => {
  assert.equal(motionBackground("#123456ff"), "#123456");
  assert.throws(
    () => motionBackground("#12345680"),
    /transparent background.*opaque background.*PNG/,
  );
});
