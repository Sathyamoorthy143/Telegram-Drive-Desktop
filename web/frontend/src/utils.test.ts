import { describe, it, expect } from 'vitest';
import { formatBytes, formatDuration, isMediaFile, isPdfFile, isImageFile, isVideoFile, isAudioFile, isTextFile, isOfficeFile, getPreviewKind } from './utils';

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
    [0, '0s'],
    [30, '30s'],
    [60, '1m 0s'],
    [3661, '1h 1m'],
    [3600, '1h 0m'],
  ])('formatDuration(%s) = %s', (seconds, expected) => {
    expect(formatDuration(seconds)).toBe(expected);
  });
});

describe('file type detection', () => {
  // isMediaFile: images + video + audio (not PDF, not archives)
  it.each([
    ['photo.jpg', true],
    ['video.mp4', true],
    ['clip.webm', true],
    ['doc.PDF', false],
    ['music.mp3', true],
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

  it('isTextFile excludes office/pdf formats', () => {
    expect(isTextFile('readme.txt')).toBe(true);
    expect(isTextFile('notes.md')).toBe(true);
    expect(isTextFile('config.json')).toBe(true);
    expect(isTextFile('script.py')).toBe(true);
    expect(isTextFile('data.csv')).toBe(true);
    expect(isTextFile('report.doc')).toBe(false);
    expect(isTextFile('report.docx')).toBe(false);
    expect(isTextFile('slides.ppt')).toBe(false);
    expect(isTextFile('sheet.xlsx')).toBe(false);
    expect(isTextFile('doc.rtf')).toBe(false);
    expect(isTextFile('file.pdf')).toBe(false);
  });

  it('isOfficeFile detects word/excel/powerpoint formats', () => {
    expect(isOfficeFile('report.docx')).toBe(true);
    expect(isOfficeFile('doc.doc')).toBe(true);
    expect(isOfficeFile('notes.odt')).toBe(true);
    expect(isOfficeFile('doc.rtf')).toBe(true);
    expect(isOfficeFile('sheet.xlsx')).toBe(true);
    expect(isOfficeFile('data.xls')).toBe(true);
    expect(isOfficeFile('numbers.ods')).toBe(true);
    expect(isOfficeFile('slides.pptx')).toBe(true);
    expect(isOfficeFile('presentation.ppt')).toBe(true);
    expect(isOfficeFile('deck.odp')).toBe(true);
    expect(isOfficeFile('readme.txt')).toBe(false);
    expect(isOfficeFile('photo.jpg')).toBe(false);
    expect(isOfficeFile('file.pdf')).toBe(false);
  });

  it('getPreviewKind classifies office documents for embedded viewer', () => {
    expect(getPreviewKind({ name: 'report.docx' })).toBe('office');
    expect(getPreviewKind({ name: 'sheet.xlsx' })).toBe('office');
    expect(getPreviewKind({ name: 'deck.pptx' })).toBe('office');
    expect(getPreviewKind({ name: 'doc.rtf' })).toBe('office');
    expect(getPreviewKind({ name: 'data.csv' })).toBe('text');
    expect(getPreviewKind({ name: 'readme.txt' })).toBe('text');
    expect(getPreviewKind({ name: 'photo.jpg' })).toBe('image');
    expect(getPreviewKind({ name: 'clip.mp4' })).toBe('video');
    expect(getPreviewKind({ name: 'song.mp3' })).toBe('audio');
    expect(getPreviewKind({ name: 'file.pdf' })).toBe('pdf');
    expect(getPreviewKind({ name: 'script.ts' })).toBe('code');
    expect(getPreviewKind({ name: 'unknown.xyz' })).toBe('unknown');
  });
});
