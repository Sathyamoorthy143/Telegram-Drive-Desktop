import { useState } from 'react';
import * as api from '../../api';
import { OrgShell, OrgCard, AuthCard, Banner } from './ui';

interface Props {
  orgId: string;
  orgName: string;
  inactive?: boolean;
  onLogin: (session: { username: string; role: string; member_id: string }) => void;
}

function friendlyOrgLoginError(raw?: string): string {
  const m = String(raw || '');
  if (/invalid username or password/i.test(m)) return 'Wrong username or password. Ask your org admin to verify your account.';
  if (/inactive/i.test(m)) return 'This organization is inactive — contact your admin.';
  if (/not configured|unavailable|service/i.test(m)) return 'Organization sign-in is temporarily unavailable. Try again shortly.';
  return m;
}

export function OrgLogin({ orgId, orgName, inactive, onLogin }: Props) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (inactive) {
      setError('This organization is inactive — contact your admin.');
      return;
    }
    if (!username.trim() || !password) {
      setError('Enter your username and password.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const sess = await api.orgLogin(orgId, username.trim(), password);
      if (sess.org_id !== orgId) {
        setError('Signed into the wrong organization — please use this org’s own login page.');
        return;
      }
      api.setOrgToken(sess.token, sess.org_id);
      api.setOrgId(sess.org_id);
      onLogin({ username: sess.username, role: sess.role, member_id: sess.member_id });
    } catch (err: any) {
      setError(friendlyOrgLoginError(err?.message) || 'Login failed');
    } finally {
      setBusy(false);
    }
  };

  return (
    <OrgShell>
      <div className="flex justify-center pt-8">
        <div className="w-full max-w-sm">
          <OrgCard>
            <AuthCard title={orgName} submitLabel="Sign in" busy={busy || inactive === true} error={error} onSubmit={submit}
              footer={<>
                <button type="button" onClick={() => { window.location.href = '/'; }}
                  className="w-full mt-3 text-xs text-telegram-primary hover:underline">← Back to master dashboard</button>
                <p className="text-xs text-telegram-subtext mt-3 text-center">Organization accounts are created by your org admin. No Telegram login needed. Signing in here ends any other session for this account.</p>
              </>}>
              {inactive && <Banner variant="warning">This organization is deactivated. Contact your admin to reactivate it.</Banner>}
              <p className="text-sm text-telegram-subtext mb-5">Sign in with your organization account.</p>
              <label className="block text-xs font-medium text-telegram-subtext mb-1">Username</label>
              <input value={username} onChange={(e) => setUsername(e.target.value)} autoComplete="username"
                className="w-full mb-3 px-3 py-2 rounded-lg bg-telegram-bg border border-telegram-border outline-none focus:border-telegram-primary" placeholder="e.g. alice" />
              <label className="block text-xs font-medium text-telegram-subtext mb-1">Password</label>
              <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password"
                className="w-full mb-4 px-3 py-2 rounded-lg bg-telegram-bg border border-telegram-border outline-none focus:border-telegram-primary" placeholder="••••••••" />
            </AuthCard>
          </OrgCard>
        </div>
      </div>
    </OrgShell>
  );
}
