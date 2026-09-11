import { describe, it, expect } from 'vitest';
import { fileAccent } from './accents';

describe('fileAccent', () => {
  it('colors folders with the brand accent', () => {
    expect(fileAccent('anything', true).bar).toContain('amber');
  });

  it.each([
    ['photo.jpg', 'fuchsia'],
    ['clip.mp4', 'rose'],
    ['song.mp3', 'emerald'],
    ['doc.pdf', 'sky'],
    ['notes.txt', 'sky'],
    ['data.zip', 'orange'],
  ])('%s glows %s', (name, color) => {
    expect(fileAccent(name, false).bar).toContain(color);
  });

  it('falls back for unknown types', () => {
    expect(fileAccent('file.unknownext', false).bar).toContain('slate');
  });
});
