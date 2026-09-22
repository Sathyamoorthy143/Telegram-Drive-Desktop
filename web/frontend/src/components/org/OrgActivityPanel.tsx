import { useEffect, useState } from 'react';
import { OrgCard } from './ui';
import * as api from '../../api';
import type { AuditEntry } from '../../types';

export function OrgActivityPanel({ orgId }: { orgId: string }) {
  const [activity, setActivity] = useState<AuditEntry[]>([]);
  const [activityLoading, setActivityLoading] = useState(false);
  const [activityError, setActivityError] = useState<string | null>(null);

  const loadActivity = async () => {
    setActivityLoading(true);
    setActivityError(null);
    try { setActivity(await api.getOrgActivity(orgId)); }
    catch (e: any) { setActivityError(e.message || 'Failed to load activity'); }
    finally { setActivityLoading(false); }
  };

  useEffect(() => {
    loadActivity();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orgId]);

  return (
    <div>
      <OrgCard>
      <h2 className="text-sm font-medium text-telegram-subtext mb-2">Audit log — who / what / when</h2>
      {activityLoading ? (
        <p className="text-sm text-telegram-subtext">Loading activity…</p>
      ) : activityError ? (
        <div className="text-sm">
          <p className="text-red-500 mb-2">Failed to load activity: {activityError}</p>
          <button onClick={loadActivity} className="px-3 py-1.5 rounded-lg border border-telegram-border hover:bg-telegram-hover">Retry</button>
        </div>
      ) : activity.length === 0 ? (
        <p className="text-sm text-telegram-subtext">No activity yet.</p>
      ) : (
        <ul className="grid gap-1">
          {activity.map((a, i) => (
            <li key={a.id || i} className="text-xs px-3 py-2 rounded-lg bg-telegram-surface border border-telegram-border">
              <span className="font-medium text-sm">{a.action}</span>
              <span className="text-telegram-subtext">
                {a.target_type ? ` · ${a.target_type}:${a.target_id}` : ''} · {a.created_at || ''}
              </span>
            </li>
          ))}
        </ul>
      )}
      </OrgCard>
    </div>
  );
}
