import { useEffect, useState } from 'react';
import { Crown } from 'lucide-react';
import { getAccountTier, tierUploadLabel, type AccountTier } from '../../tier';

/** Small account-tier pill: free cap vs Premium cap. Silent when offline. */
export function TierBadge() {
  const [tier, setTier] = useState<AccountTier | null>(null);

  useEffect(() => {
    let live = true;
    getAccountTier()
      .then((t) => live && setTier(t))
      .catch(() => {});
    return () => {
      live = false;
    };
  }, []);

  if (!tier) return null;

  return (
    <span
      title={`Upload limit ${tierUploadLabel(tier)}`}
      className={`flex items-center gap-1 px-2 py-1 rounded-full text-[10px] font-bold uppercase tracking-wider border ${
        tier.premium
          ? 'bg-telegram-primary/15 text-telegram-primary border-telegram-primary/30 animate-pulse-glow'
          : 'bg-telegram-hover text-telegram-subtext border-telegram-border'
      }`}
    >
      {tier.premium && <Crown className="w-3 h-3" />}
      {tierUploadLabel(tier)}
    </span>
  );
}
