import { describe, it, expect } from 'vitest';
import { formatBytes, formatDuration, isMediaFile, isPdfFile, isImageFile, isVideoFile, isAudioFile } from './utils';

describe('formatBytes', () => {
  it.each([
    [0, '0 Bytes'],
    [1, '1 Bytes'],
    [1024, '1 KB'],
    [1024 * 1024, '1 MB'],
    [1024 * 1024 * 1024, '1 GB'],
    [1024 * 1024 * 1024 * 1024, '1 TB'],
    [1536, '1.5 KB'],
    [null as unknown as number, '0 Bytes'],
  ])('formatBytes(%s) = %s', (input, expected) => {
    expect(formatBytes(input)).toBe(expected);
  });
});

describe('formatDuration', () => {
  it.each([
    [0, '0:00'],
    [30, '0:30'],
    [60, '1:00'],
    [3661, '1:01:01'],
    [3600, '1:00:00'],
  ])('formatDuration(%s) = %s', (seconds, expected) => {
    expect(formatDuration(seconds)).toBe(expected);
  });
});

describe('file type detection', () => {
  // isMediaFile: images + video (not PDF, not audio)
  it.each([
    ['photo.jpg', true],
    ['video.mp4', true],
    ['clip.webm', true],
    ['doc.PDF', false],
    ['music.mp3', false],
    ['archive.zip', false],
  ])('%s isMediaFile=%s', (name, expected) => {
    expect(isMediaFile(name)).toBe(expected);
  });

  it('isPdfFile', () => {
    expect(isPdfFile('report.pdf')).toBe(true);
    expect(isPdfFile('report.PDF')).toBe(true);
    expect(isPdfFile('report.txt')).toBe(false);
  });

  it('isImageFile', () => {
    expect(isImageFile('a.png')).toBe(true);
    expect(isImageFile('b.mp4')).toBe(false);
  });

  it('isVideoFile', () => {
    expect(isVideoFile('clip.mkv')).toBe(true);
    expect(isVideoFile('clip.wav')).toBe(false);
  });

  it('isAudioFile', () => {
    expect(isAudioFile('song.flac')).toBe(true);
    expect(isAudioFile('song.jpg')).toBe(false);
  });

  it('handles filenames without extension', () => {
    expect(isMediaFile('noext')).toBe(false);
    expect(isPdfFile('noext')).toBe(false);
  });

  it('handles deeply nested paths', () => {
    expect(isImageFile('/some/deep/path/photo.GIF')).toBe(true);
    expect(isVideoFile('/some/deep/path/movie.mp4')).toBe(true);
  });
});
