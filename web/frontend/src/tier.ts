import { api } from './api';

export interface AccountTier {
  premium: boolean;
  max_upload_bytes: number;
}

export const getAccountTier = () =>
  api<AccountTier>('GET', '/api/account/tier');

/** Short human label for the upload cap, e.g. "2 GB" or "4 GB (Premium)". */
export function tierUploadLabel(tier: AccountTier): string {
  const gb = tier.max_upload_bytes / 1024 ** 3;
  const size = Number.isInteger(gb) ? `${gb} GB` : `${gb.toFixed(1)} GB`;
  return tier.premium ? `${size} (Premium)` : size;
}
