/** Per-file-type color accents (literal Tailwind classes so the scanner picks them up). */
export interface FileAccent {
  /** Top glow-bar color, e.g. 'bg-fuchsia-500'. */
  bar: string;
  /** Soft outer glow, e.g. 'shadow-[0_0_14px_rgba(232,121,249,0.45)]'. */
  glow: string;
}

const IMAGE = { bar: 'bg-fuchsia-500', glow: 'shadow-[0_0_14px_rgba(232,121,249,0.45)]' };
const VIDEO = { bar: 'bg-rose-500', glow: 'shadow-[0_0_14px_rgba(244,63,94,0.45)]' };
const AUDIO = { bar: 'bg-emerald-500', glow: 'shadow-[0_0_14px_rgba(16,185,129,0.45)]' };
const DOC = { bar: 'bg-sky-500', glow: 'shadow-[0_0_14px_rgba(14,165,233,0.45)]' };
const ARCHIVE = { bar: 'bg-orange-500', glow: 'shadow-[0_0_14px_rgba(249,115,22,0.45)]' };
const FOLDER = { bar: 'bg-amber-400', glow: 'shadow-[0_0_14px_rgba(251,191,36,0.45)]' };
const DEFAULT = { bar: 'bg-slate-500', glow: 'shadow-[0_0_14px_rgba(100,116,139,0.45)]' };

export function fileAccent(filename: string, isFolder: boolean): FileAccent {
  if (isFolder) return FOLDER;
  const ext = (filename || '').split('.').pop()?.toLowerCase() || '';
  if (['jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp', 'svg', 'heic'].includes(ext)) return IMAGE;
  if (['mp4', 'mkv', 'webm', 'mov', 'avi', 'm4v'].includes(ext)) return VIDEO;
  if (['mp3', 'wav', 'ogg', 'oga', 'opus', 'm4a', 'flac', 'amr'].includes(ext)) return AUDIO;
  if (['pdf', 'doc', 'docx', 'txt', 'md', 'xls', 'xlsx', 'ppt', 'pptx', 'csv'].includes(ext)) return DOC;
  if (['zip', 'rar', '7z', 'tar', 'gz'].includes(ext)) return ARCHIVE;
  return DEFAULT;
}
