import { api } from './api';

export interface StorageStatus {
  provisioned: boolean;
  main_channel_id: number | null;
  backup_channel_id: number | null;
}

export interface BackfillResult {
  copied: number;
  skipped: number;
  checked: number;
}

export interface TranscribeResult {
  text: string;
  pending: boolean;
}

export const getStorageStatus = () =>
  api<StorageStatus>('GET', '/api/storage/status');

export const provisionStorage = () =>
  api<{ main_channel_id: number; backup_channel_id: number }>('POST', '/api/storage/provision');

export const backfillStorage = (limit = 200) =>
  api<BackfillResult>('POST', `/api/storage/backfill?limit=${limit}`);

export const transcribeMessage = (message_id: number, channel_id?: number) =>
  api<TranscribeResult>('POST', '/api/preview/transcribe', { message_id, channel_id });

/** One-line summary of a backfill run, e.g. "Copied 12 • skipped 3 • checked 20". */
export function formatBackfillResult(r: BackfillResult): string {
  return `Copied ${r.copied} • skipped ${r.skipped} • checked ${r.checked}`;
}
