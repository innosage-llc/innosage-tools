// Shared by the sample gallery and the local renderer. No source metadata here.
export const TITLE_CARD_SECONDS = 1.5;
export const COVER_PRESETS = [
  { id: 'midnight-black', name: 'Midnight black', colors: ['#111111'], foreground: '#FFFFFF', panel: null },
  { id: 'clean-white', name: 'Clean white', colors: ['#FFFFFF'], foreground: '#17251E', panel: null },
  { id: 'sage-mist', name: 'Sage mist', colors: ['#DCEBDD'], foreground: '#153D2B', panel: null },
  { id: 'ocean-gradient', name: 'Ocean gradient', colors: ['#0A5375', '#8AC9CD'], foreground: '#FFFFFF', panel: '#102A38' },
  { id: 'lavender', name: 'Lavender', colors: ['#7065AC', '#DEC9F1'], foreground: '#FFFFFF', panel: '#302747' },
  { id: 'sunrise', name: 'Sunrise', colors: ['#F5CB99', '#E98A8C'], foreground: '#FFFFFF', panel: '#472D30' },
] as const;
export type CoverPresetId = typeof COVER_PRESETS[number]['id'];
export const COVER_SAMPLE_TITLE = 'Founder Sync / Meeting Recap';
export function isCoverPresetId(value: unknown): value is CoverPresetId {
  return COVER_PRESETS.some(preset => preset.id === value);
}
export function coverPreset(value: unknown) {
  const preset = COVER_PRESETS.find(preset => preset.id === value);
  if (!preset) throw new Error('Unknown title-card preset.');
  return preset;
}
// This function is used only with the browser's File.name. Never publish its result.
export function localCoverTitle(fileName: string): string {
  const base = fileName.split(/[\\/]/).at(-1) ?? '';
  const clean = base.normalize('NFC').replace(/\.[^.]*$/, '')
    .replace(/[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/g, '')
    .replace(/[_\s]+/g, ' ').trim();
  const characters = Array.from(clean);
  return characters.length ? characters.slice(0, 80).join('') + (characters.length > 80 ? '…' : '') : 'Meeting recap';
}
