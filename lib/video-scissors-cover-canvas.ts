import { coverPreset, localCoverTitle, type CoverPresetId } from './video-scissors-covers';

// Runs only inside the local editor. No source name, title, pixels or PNG leaves it.
export async function createTitleCard(fileName: string, presetId: CoverPresetId, width: number, height: number): Promise<Uint8Array> {
  const canvas = document.createElement('canvas');
  canvas.width = width; canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('This browser cannot draw a local title card.');
  const preset = coverPreset(presetId);
  if (preset.colors.length > 1) {
    const gradient = ctx.createLinearGradient(0, 0, width, height);
    preset.colors.forEach((color, index) => gradient.addColorStop(index / (preset.colors.length - 1), color));
    ctx.fillStyle = gradient;
  } else ctx.fillStyle = preset.colors[0];
  ctx.fillRect(0, 0, width, height);
  const title = localCoverTitle(fileName);
  const maxWidth = width * 0.74;
  let fontSize = Math.max(12, Math.floor(Math.min(width * 0.065, height * 0.12)));
  const wrap = () => {
    const lines: string[] = []; let line = '';
    for (const character of Array.from(title)) {
      if (line && ctx.measureText(line + character).width > maxWidth) { lines.push(line.trim()); line = character; }
      else line += character;
    }
    if (line) lines.push(line.trim());
    return lines;
  };
  let lines: string[];
  do {
    ctx.font = `600 ${fontSize}px system-ui, -apple-system, "PingFang SC", "Noto Sans CJK SC", sans-serif`;
    lines = wrap();
    if (lines.length <= 3 || fontSize <= 8) break;
    fontSize -= 1;
  } while (true);
  const lineHeight = fontSize * 1.35;
  if (preset.panel) {
    ctx.fillStyle = preset.panel;
    ctx.fillRect(width * 0.08, height / 2 - lines.length * lineHeight / 2 - fontSize, width * 0.84, lines.length * lineHeight + fontSize * 2);
  }
  ctx.fillStyle = preset.foreground;
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  lines.forEach((line, index) => ctx.fillText(line, width / 2, height / 2 + (index - (lines.length - 1) / 2) * lineHeight, maxWidth));
  const png = await new Promise<Blob>((resolve, reject) => canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error('Local title-card drawing failed.')), 'image/png'));
  return new Uint8Array(await png.arrayBuffer());
}
