import { useState, useEffect, useCallback } from 'react';
import { api } from '../../api';
import { CircleX, ChevronDown, ChevronUp, Loader2 } from 'lucide-react';

interface DiagRow {
  id: string;
  label: string;
  value: string;
  changed: boolean;
}

/**
 * Diagnostic overlay for the master admin. Fetches
 * GET /api/admin/organizations/{id}/unlock-diag and shows
 * the org's unlock-ability state inline so sign-in failures
 * can be narrowed without reproducing locally.
 *
 * Only renders when the `orgId` prop is set (master admin
 * context). The master admin toggles it via the floating
 * button in the corner.
 */
export function SignInDiagnostic({ orgId }: { orgId: string | null }) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [diag, setDiag] = useState<DiagRow[]>([]);
  const [error, setError] = useState<string | null>(null);

  const fetchDiag = useCallback(async () => {
    if (!orgId) return;
    setLoading(true);
    setError(null);
    try {
      const data: Record<string, any> = await api('GET', `/api/admin/organizations/${orgId}/unlock-diag`);
      const rows: DiagRow[] = [
        { id: 'id', label: 'ID', value: String(data.id ?? ''), changed: false },
        { id: 'name', label: 'Name', value: String(data.name ?? ''), changed: false },
        { id: 'subdomain', label: 'Subdomain', value: String(data.subdomain ?? ''), changed: false },
        { id: 'active', label: 'Active', value: String(data.active ?? ''), changed: false },
        { id: 'master_admin_id', label: 'Master Admin ID', value: String(data.master_admin_id ?? ''), changed: false },
        { id: 'owner_did_match', label: 'Owner matches Telegram', value: String(data.owner_did_match_telegram ?? ''), changed: false },
        { id: 'effective_owner', label: 'Effective Owner', value: String(data.effective_owner ?? ''), changed: false },
        { id: 'hash_present', label: 'Entry Hash Present', value: String(data.entry_hash_present ?? ''), changed: false },
        { id: 'unlockable', label: 'Unlockable without master', value: String(data.unlockable_without_master ?? ''), changed: false },
      ];
      setDiag(rows);
    } catch (err: any) {
      setError(String(err?.message || 'Failed to fetch diagnostic'));
    } finally {
      setLoading(false);
    }
  }, [orgId]);

  useEffect(() => {
    if (open && orgId && diag.length === 0) fetchDiag();
  }, [open, orgId, diag.length, fetchDiag]);

  if (!orgId) return null;

  return (
    <>
      <button
        onClick={() => { setOpen(!open); if (!open) fetchDiag(); }}
        className="fixed bottom-4 right-4 z-50 w-10 h-10 rounded-full bg-telegram-primary text-white shadow-lg hover:bg-telegram-primary/80 transition-colors flex items-center justify-center"
        title="Org Unlock Diagnostic"
        aria-label="Open unlock diagnostic"
      >
        {loading ? <Loader2 className="w-5 h-5 animate-spin" /> : <ChevronDown className="w-5 h-5" />}
      </button>
      {open && (
        <div className="fixed bottom-16 right-4 z-50 w-80 max-h-96 overflow-y-auto bg-telegram-surface border border-telegram-border rounded-xl shadow-2xl p-4">
          <div className="flex items-center justify-between mb-3">
            <h3 className="font-bold text-sm">Unlock Diagnostic</h3>
            <button onClick={() => setOpen(false)} className="p-1 rounded hover:bg-telegram-hover" aria-label="Close">
              <CircleX className="w-4 h-4" />
            </button>
          </div>
          {error && <p className="text-red-500 text-xs mb-3">{error}</p>}
          {loading && diag.length === 0 && <Loader2 className="w-6 h-6 animate-spin mx-auto my-4 text-telegram-subtext" />}
          {!loading && diag.length > 0 && (
            <table className="w-full text-xs">
              <tbody>
                {diag.map((row) => (
                  <tr key={row.id} className="border-b border-telegram-border/30 last:border-0">
                    <td className="py-1 pr-2 text-telegram-subtext font-medium">{row.label}</td>
                    <td className={`py-1 ${row.changed ? 'text-amber-600 font-bold' : ''}`}>
                      {row.value}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          {!loading && diag.length === 0 && !error && (
            <button onClick={fetchDiag} className="text-xs text-telegram-primary underline">Retry</button>
          )}
        </div>
      )}
    </>
  );
}
