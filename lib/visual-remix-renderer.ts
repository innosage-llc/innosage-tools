import { parseScene, type Scene } from './visual-remix.ts';
import { LocalAssets } from './visual-remix-assets.ts';
import type { LayoutDiagnostic, RenderedScene } from './visual-remix-controller.ts';

export const REMIX_FONTS = {
  sans: 'Arial, "PingFang SC", "Noto Sans CJK SC", sans-serif',
  serif: 'Georgia, "Songti SC", "Noto Serif CJK SC", serif',
  mono: 'Menlo, "Noto Sans Mono CJK SC", monospace',
};

// One PNG is both the displayed preview and export. No second layout path.
// Konva stays in a dynamic browser chunk; no server-side Canvas dependency.
let renderQueue: Promise<void> = Promise.resolve();
export function renderScene(input: Scene, assets: LocalAssets, signal: AbortSignal): Promise<RenderedScene> {
  const scene = parseScene(input);
  // Browser raster decode is not abortable. Serialize across controllers too:
  // replacement renders cannot multiply the aggregate decoded pixel budget.
  const task = renderQueue.then(() => renderSerial(scene, assets, signal));
  renderQueue = task.then(() => {}, () => {});
  return task;
}
async function renderSerial(scene: Scene, assets: LocalAssets, signal: AbortSignal): Promise<RenderedScene> {
  signal.throwIfAborted();
  const { default: Konva } = await import('konva');
  signal.throwIfAborted();
  const container = document.createElement('div');
  const stage = new Konva.Stage({ container, width: 1080, height: 1440 });
  const bitmaps: ImageBitmap[] = [];
  const diagnostics: LayoutDiagnostic[] = [];
  try {
    const layer = new Konva.Layer({ listening: false }); stage.add(layer);
    layer.add(new Konva.Rect({ x: 0, y: 0, width: 1080, height: 1440, fill: scene.background, listening: false }));
    const images = new Map<string, ImageBitmap>();
    for (const a of scene.assets) {
      signal.throwIfAborted();
      const bitmap = await createImageBitmap(assets.blob(a), { imageOrientation: 'none' }); bitmaps.push(bitmap);
      signal.throwIfAborted();
      if (bitmap.width !== a.width || bitmap.height !== a.height) throw new Error('RASTER_DIMENSION_MISMATCH');
      images.set(a.id, bitmap);
    }
    const fonts = [...new Set(scene.nodes.filter(n => n.type === 'text').map(n => n.font))];
    for (const font of fonts) await document.fonts.load(`16px ${REMIX_FONTS[font]}`, 'English 中文');
    signal.throwIfAborted();
    if (fonts.length) diagnostics.push({ code: 'FONT_FALLBACK', severity: 'warning', nodeIds: [], message: 'Uses local font stacks: ' + fonts.map(f => REMIX_FONTS[f]).join('; ') + '. Unavailable fonts/glyphs fall back to this browser; compare the preview on each device.' });
    const textBoxes: { id: string; x: number; y: number; width: number; height: number }[] = [];
    for (const n of scene.nodes) {
      const group = new Konva.Group({ x: n.x, y: n.y, rotation: n.rotation, opacity: n.opacity, listening: false }); layer.add(group);
      if (n.type === 'text') {
        // Auto height measures every wrapped line; never pass a fixed height,
        // ellipsis, clipping or global font shrinking to the renderer.
        const text = new Konva.Text({ x: 0, y: 0, width: n.width, text: n.text, fontFamily: REMIX_FONTS[n.font], fontSize: n.fontSize, fontStyle: n.fontWeight, lineHeight: n.lineHeight, align: n.align, wrap: n.wrap, fill: n.fill, padding: 0, listening: false });
        group.add(text);
        // Konva drops the rest of a paragraph if its next grapheme cannot fit.
        // Auto-height/line widths alone then falsely describe the truncated result
        // as valid. Compare actual laid-out content, allowing wrapping whitespace.
        const visibleContent = (value: string) => value.replace(/\s/g, '');
        const omitted = visibleContent(text.textArr.map(line => line.text).join('')) !== visibleContent(n.text);
        if (omitted) {
          // Use the active renderer font's actual metrics, not font-size heuristics.
          const graphemes = new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(n.text);
          const minimumWidth = Array.from(graphemes).reduce((width, item) => item.segment.trim() ? Math.max(width, text.measureSize(item.segment).width) : width, 0);
          diagnostics.push({ code: 'TEXT_OVERFLOW', severity: 'error', nodeIds: [n.id], message: `Some text could not be laid out. Widest grapheme measures ${Math.ceil(minimumWidth)}px; box width is ${n.width}px. Widen the text box before exporting.` });
        } else if (text.height() > n.height + 0.5 || text.textArr.some(line => line.width > n.width + 0.5)) diagnostics.push({ code: 'TEXT_OVERFLOW', severity: 'error', nodeIds: [n.id], message: `Text needs ${Math.ceil(text.height())}px height; box has ${n.height}px. Enlarge or move the text box.` });
        if (n.text.trim() && n.opacity > 0) textBoxes.push({ id: n.id, ...text.getClientRect() });
      } else if (n.type === 'rect') group.add(new Konva.Rect({ width: n.width, height: n.height, fill: n.fill, cornerRadius: n.cornerRadius, listening: false }));
      else if (n.type === 'ellipse') group.add(new Konva.Ellipse({ x: n.width/2, y: n.height/2, radiusX: n.width/2, radiusY: n.height/2, fill: n.fill, listening: false }));
      else group.add(new Konva.Image({ width: n.width, height: n.height, image: images.get(n.assetId)!, crop: n.crop, listening: false }));
      const bounds = group.getClientRect();
      if (bounds.x < -0.5 || bounds.y < -0.5 || bounds.x + bounds.width > 1080.5 || bounds.y + bounds.height > 1440.5) diagnostics.push({ code: 'OUTSIDE_CANVAS', severity: 'error', nodeIds: [n.id], message: 'Rendered content extends outside the canvas. Move or resize it before exporting.' });
    }
    for (let i = 0; i < textBoxes.length; i++) for (let j = i + 1; j < textBoxes.length; j++) {
      const a = textBoxes[i], b = textBoxes[j];
      if (Math.min(a.x+a.width,b.x+b.width) > Math.max(a.x,b.x) + 0.5 && Math.min(a.y+a.height,b.y+b.height) > Math.max(a.y,b.y) + 0.5) diagnostics.push({ code: 'TEXT_OVERLAP', severity: 'error', nodeIds: [a.id,b.id], message: 'Text bounds overlap. Separate the blocks before exporting.' });
    }
    signal.throwIfAborted(); layer.draw();
    const png = await stage.toBlob({ mimeType: 'image/png', pixelRatio: 1 });
    signal.throwIfAborted();
    if (!png) throw new Error('PNG_EXPORT_FAILED');
    return { png, diagnostics };
  } finally { stage.destroy(); bitmaps.forEach(b => b.close()); container.remove(); }
}
