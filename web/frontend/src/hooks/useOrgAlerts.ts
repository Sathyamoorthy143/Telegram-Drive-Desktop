import { useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import * as api from '../api';
import type { OrgAlert } from '../types';

const POLL_INTERVAL_MS = 30000;
const MAX_ALERTS = 50;
const MAX_NEW_COUNT = 99;
// Outage backoff: consecutive failures double the quiet period
// (30s, 60s, 120s …) up to this cap, so a dead backend/DNS doesn't turn
// the poller into an error storm. Reset on the first success.
const MAX_BACKOFF_MS = 5 * 60 * 1000;

/** Pure dedupe: return entries not yet seen, recording their ids. Id-less entries are skipped. */
export function filterNewAlerts(seen: Set<string>, data: OrgAlert[]): OrgAlert[] {
  const fresh: OrgAlert[] = [];
  for (const a of data) {
    if (a.id && !seen.has(a.id)) {
      seen.add(a.id);
      fresh.push(a);
    }
  }
  return fresh;
}

export function useOrgAlerts(orgId: string | null) {
  const [alerts, setAlerts] = useState<OrgAlert[]>([]);
  const [newCount, setNewCount] = useState(0);
  const [expired, setExpired] = useState(false);
  const seenIdsRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    // Fresh org → fresh dedupe state (never leak seen ids across orgs).
    seenIdsRef.current = new Set();
    setAlerts([]);
    setNewCount(0);
    setExpired(false);
    if (!orgId) return;

    let cancelled = false;
    let failures = 0;
    let nextAllowedAt = 0;

    const fetchAlerts = async () => {
      // No polling for background tabs — resume on visibilitychange.
      if (typeof document !== 'undefined' && document.hidden) return;
      // In an outage, sit out ticks until the backoff expires.
      if (Date.now() < nextAllowedAt) return;
      try {
        const data = await api.getOrgAlerts(orgId);
        if (cancelled) return;
        failures = 0;
        nextAllowedAt = 0;
        const newAlerts = filterNewAlerts(seenIdsRef.current, data);
        if (newAlerts.length > 0) {
          setNewCount(prev => Math.min(MAX_NEW_COUNT, prev + newAlerts.length));
          // Show toast for the most recent new alert only (debounce spam)
          const latest = newAlerts[0];
          const actionLabel = latest.action.replace('org.', '');
          toast.info(actionLabel, {
            description: latest.target_type ? `${latest.target_type}:${latest.target_id}` : undefined,
            duration: 5000,
          });
        }
        setAlerts(data.slice(0, MAX_ALERTS));
      } catch (e: any) {
        if (cancelled) return;
        // Auth failure: stop polling so an expired token doesn't spin forever.
        if (String(e?.message || '').includes('401') || String(e?.message || '').toLowerCase().includes('unauthorized')) {
          setExpired(true);
        }
        // Anything else: back off exponentially (outage/DNS/sleeping backend).
        failures += 1;
        nextAllowedAt = Date.now() + Math.min(POLL_INTERVAL_MS * Math.pow(2, failures - 1), MAX_BACKOFF_MS);
      }
    };

    // Initial fetch
    fetchAlerts();

    // Poll every 30s
    const interval = setInterval(fetchAlerts, POLL_INTERVAL_MS);
    const onVisible = () => fetchAlerts();
    document?.addEventListener?.('visibilitychange', onVisible);
    return () => {
      cancelled = true;
      clearInterval(interval);
      document?.removeEventListener?.('visibilitychange', onVisible);
    };
  }, [orgId]);

  const clearNewCount = () => setNewCount(0);

  return { alerts, newCount, clearNewCount, expired };
}