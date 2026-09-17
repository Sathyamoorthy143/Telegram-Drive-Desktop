import { useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import * as api from '../api';
import type { OrgAlert } from '../types';

const POLL_INTERVAL_MS = 30000;
const MAX_ALERTS = 50;

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
  const seenIdsRef = useRef<Set<string>>(new Set());
  const lastFetchRef = useRef<number>(0);

  useEffect(() => {
    if (!orgId) {
      setAlerts([]);
      setNewCount(0);
      return;
    }

    let cancelled = false;

    const fetchAlerts = async () => {
      try {
        const data = await api.getOrgAlerts(orgId);
        if (cancelled) return;
        const newAlerts = filterNewAlerts(seenIdsRef.current, data);
        if (newAlerts.length > 0) {
          setNewCount(prev => prev + newAlerts.length);
          // Show toast for the most recent new alert only (debounce spam)
          const latest = newAlerts[0];
          const actionLabel = latest.action.replace('org.', '');
          toast.info(actionLabel, {
            description: latest.target_type ? `${latest.target_type}:${latest.target_id}` : undefined,
            duration: 5000,
          });
        }
        setAlerts(data.slice(0, MAX_ALERTS));
        lastFetchRef.current = Date.now();
      } catch {
        // Silently ignore polling errors
      }
    };

    // Initial fetch
    fetchAlerts();

    // Poll every 30s
    const interval = setInterval(fetchAlerts, POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [orgId]);

  const clearNewCount = () => setNewCount(0);

  return { alerts, newCount, clearNewCount };
}