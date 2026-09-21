import { useState, useEffect } from 'react';
import { X, Save, Palette, ShieldCheck, Lock, Timer, Bell, Power, Database, CopyCheck } from 'lucide-react';
import * as api from '../../api';
import { getStorageStatus, provisionStorage, backfillStorage, formatBackfillResult, type StorageStatus } from '../../storage';
import { getAccountTier, tierUploadLabel, type AccountTier } from '../../tier';
import { toast } from 'sonner';
import { useLock } from '../../context/LockContext';
import { AppSettings } from '../../types';

interface SettingsModalProps {
    onClose: () => void;
}

export function SettingsModal({ onClose }: SettingsModalProps) {
    const [settings, setSettings] = useState<AppSettings>({
        theme: 'dark',
        auto_login: true,
    });
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const { hasPin, lockIntervalMs, notificationMode, setPin, setLockInterval, setNotificationMode } = useLock();
    const [pinInput, setPinInput] = useState('');
    const [pinConfirm, setPinConfirm] = useState('');
    const [masterPw, setMasterPw] = useState('');
    const [masterPwConfirm, setMasterPwConfirm] = useState('');
    const [savingMasterPw, setSavingMasterPw] = useState(false);
    const [storage, setStorage] = useState<StorageStatus | null>(null);
    const [tier, setTier] = useState<AccountTier | null>(null);
    const [provisioning, setProvisioning] = useState(false);
    const [backfilling, setBackfilling] = useState(false);
    const [encEnabled, setEncEnabled] = useState(() => { try { return localStorage.getItem('encryption_enabled') === '1'; } catch { return false; } });

    useEffect(() => {
        const loadSettings = async () => {
            try {
                const data = await api.getSettings();
                setSettings(prev => ({ ...prev, ...data }));
            } catch (err) {
                console.error("Failed to load settings:", err);
            } finally {
                setLoading(false);
            }
        };
        loadSettings();
        getStorageStatus().then(setStorage).catch(() => {});
        getAccountTier().then(setTier).catch(() => {});
    }, []);

    const handleProvision = async () => {
        setProvisioning(true);
        try {
            const r = await provisionStorage();
            setStorage({ provisioned: true, main_channel_id: r.main_channel_id, backup_channel_id: r.backup_channel_id });
            toast.success('Storage channels ready');
        } catch (err) {
            toast.error('Provision failed: ' + err);
        } finally {
            setProvisioning(false);
        }
    };

    const handleBackfill = async () => {
        setBackfilling(true);
        try {
            const r = await backfillStorage();
            toast.success(formatBackfillResult(r));
        } catch (err) {
            toast.error('Backfill failed: ' + err);
        } finally {
            setBackfilling(false);
        }
    };

    const handleSave = async () => {
        setSaving(true);
        try {
            try { localStorage.setItem('encryption_enabled', encEnabled ? '1' : '0'); } catch {}
            await api.saveSettings(settings);
            try { const { setEncryptionEnabled } = await import('../../lib/crypto'); setEncryptionEnabled(encEnabled); } catch {}
            toast.success("Settings saved successfully");
            onClose();
        } catch (err) {
            toast.error("Failed to save settings: " + err);
        } finally {
            setSaving(false);
        }
    };

    if (loading) return null;

    return (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 backdrop-blur-sm animate-in fade-in duration-200 p-4">
            <div className="glass-modal rounded-2xl w-full max-w-md max-h-[90vh] flex flex-col shadow-2xl overflow-hidden animate-in zoom-in-95 duration-200">
                {/* Header */}
                <div className="px-6 py-4 border-b border-telegram-border flex items-center justify-between bg-white/5">
                    <div className="flex items-center gap-3">
                        <div className="p-2 bg-telegram-primary/20 rounded-lg">
                            <Palette className="w-5 h-5 text-telegram-primary" />
                        </div>
                        <h2 className="text-lg font-bold text-telegram-text">App Settings</h2>
                    </div>
                    <button onClick={onClose} className="p-2 hover:bg-white/10 rounded-full transition-colors">
                        <X className="w-5 h-5 text-telegram-subtext" />
                    </button>
                </div>

                {/* Body */}
                <div className="p-6 space-y-6 overflow-y-auto flex-1 min-h-0">
                    {/* Storage Section - MAIN/BACKUP channels + tier */}
                    <div className="space-y-4">
                        <div className="flex items-center gap-2 text-sm font-semibold text-telegram-text">
                            <Database className="w-4 h-4 text-telegram-primary" />
                            Storage Channels
                            {tier && (
                                <span className="ml-auto text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full bg-telegram-primary/15 text-telegram-primary border border-telegram-primary/30">
                                    {tierUploadLabel(tier)}
                                </span>
                            )}
                        </div>
                        <div className="p-3 bg-telegram-hover/40 border border-telegram-border rounded-xl text-[11px] text-telegram-subtext space-y-1">
                            <div>Main: {storage?.main_channel_id ? <span className="font-mono text-telegram-text">{storage.main_channel_id}</span> : 'not set up'}</div>
                            <div>Backup: {storage?.backup_channel_id ? <span className="font-mono text-telegram-text">{storage.backup_channel_id}</span> : 'not set up'}</div>
                        </div>
                        <div className="flex gap-2">
                            <button
                                onClick={handleProvision}
                                disabled={provisioning}
                                className="flex-1 px-3 py-2 bg-telegram-primary hover:bg-telegram-primary/90 disabled:opacity-50 text-white rounded-xl text-xs font-bold transition-colors"
                            >
                                {provisioning ? 'Setting up…' : storage?.provisioned ? 'Repair Channels' : 'Set Up Channels'}
                            </button>
                            <button
                                onClick={handleBackfill}
                                disabled={backfilling || !storage?.provisioned}
                                title="Copy old Saved Messages files into MAIN (safe to rerun)"
                                className="flex-1 px-3 py-2 bg-white/10 hover:bg-white/20 disabled:opacity-40 text-telegram-text rounded-xl text-xs font-bold transition-colors flex items-center justify-center gap-1.5"
                            >
                                <CopyCheck className="w-3.5 h-3.5" />
                                {backfilling ? 'Copying…' : 'Copy Old Files'}
                            </button>
                        </div>
                    </div>

                    <div className="h-px bg-telegram-border" />

                    <div className="space-y-4">
                        <div className="flex items-center gap-2 text-sm font-semibold text-telegram-text">
                            <ShieldCheck className="w-4 h-4 text-telegram-primary" />
                            Master Admin password
                        </div>
                        <div className="p-3 bg-telegram-hover/40 border border-telegram-border rounded-xl text-[11px] text-telegram-subtext">
                            Reset without the old password. Used to open the personal drive from the org picker.
                        </div>
                        <div className="flex gap-2">
                            <input type="password" value={masterPw} onChange={e => setMasterPw(e.target.value)} placeholder="New password (min 4)" className="flex-1 bg-black/20 border border-telegram-border rounded-xl px-3 py-2 text-sm text-telegram-text placeholder:text-telegram-subtext/50 focus:outline-none focus:ring-2 focus:ring-telegram-primary/50" />
                            <input type="password" value={masterPwConfirm} onChange={e => setMasterPwConfirm(e.target.value)} placeholder="Confirm" className="flex-1 bg-black/20 border border-telegram-border rounded-xl px-3 py-2 text-sm text-telegram-text placeholder:text-telegram-subtext/50 focus:outline-none focus:ring-2 focus:ring-telegram-primary/50" />
                            <button
                                disabled={savingMasterPw}
                                onClick={async () => {
                                    if (masterPw.length < 4) return toast.error('Password must be at least 4 characters');
                                    if (masterPw !== masterPwConfirm) return toast.error('Passwords do not match');
                                    setSavingMasterPw(true);
                                    try {
                                        await api.setMasterPassword(masterPw);
                                        toast.success('Master Admin password saved');
                                        setMasterPw('');
                                        setMasterPwConfirm('');
                                    } catch (err: any) {
                                        toast.error(err?.message || 'Failed to save password');
                                    } finally {
                                        setSavingMasterPw(false);
                                    }
                                }}
                                className="px-4 py-2 bg-telegram-primary hover:bg-telegram-primary/90 disabled:opacity-50 text-white rounded-xl text-xs font-bold"
                            >
                                {savingMasterPw ? 'Saving…' : 'Set'}
                            </button>
                        </div>
                    </div>

                    <div className="h-px bg-telegram-border" />

                    {/* Lockscreen Section - Absolute + Background */}
                    <div className="space-y-4">
                        <div className="flex items-center gap-2 text-sm font-semibold text-telegram-text">
                            <Lock className="w-4 h-4 text-orange-400" />
                            Lockscreen Protection
                        </div>
                        <div className="p-3 bg-orange-500/10 border border-orange-500/20 rounded-xl text-[11px] text-telegram-subtext">
                            Locks after the interval below of no mouse/keyboard/touch input. Leaving the page never locks. PIN required to unlock. Supabase persisted.
                        </div>
                        <div className="space-y-1">
                            <label className="text-[10px] uppercase tracking-wider text-telegram-subtext font-bold ml-1">Set PIN (4 digits) {hasPin && <span className="text-green-400">• Active</span>}</label>
                            <div className="flex gap-2">
                                <input type="password" inputMode="numeric" maxLength={4} value={pinInput} onChange={e => setPinInput(e.target.value.replace(/\D/g,''))} placeholder="1234" className="flex-1 bg-black/20 border border-telegram-border rounded-xl px-3 py-2 text-sm text-telegram-text placeholder:text-telegram-subtext/50 focus:outline-none focus:ring-2 focus:ring-telegram-primary/50" />
                                <input type="password" inputMode="numeric" maxLength={4} value={pinConfirm} onChange={e => setPinConfirm(e.target.value.replace(/\D/g,''))} placeholder="Confirm" className="flex-1 bg-black/20 border border-telegram-border rounded-xl px-3 py-2 text-sm text-telegram-text placeholder:text-telegram-subtext/50 focus:outline-none focus:ring-2 focus:ring-telegram-primary/50" />
                                <button onClick={async () => {
                                    if (pinInput.length !== 4) return toast.error('PIN must be 4 digits');
                                    if (pinInput !== pinConfirm) return toast.error('PIN mismatch');
                                    await setPin(pinInput); toast.success('PIN saved, lockscreen active'); setPinInput(''); setPinConfirm('');
                                }} className="px-4 py-2 bg-orange-500 hover:bg-orange-600 text-white rounded-xl text-xs font-bold">Set</button>
                            </div>
                        </div>
                        <div className="space-y-1">
                            <label className="text-[10px] uppercase tracking-wider text-telegram-subtext font-bold ml-1 flex items-center gap-1"><Timer className="w-3 h-3" /> Absolute Interval</label>
                            <select value={lockIntervalMs} onChange={e => setLockInterval(parseInt(e.target.value))} className="w-full bg-black/20 border border-telegram-border rounded-xl px-3 py-2 text-sm text-telegram-text focus:outline-none focus:ring-2 focus:ring-telegram-primary/50">
                                <option value={5*60*1000}>5 minutes</option>
                                <option value={15*60*1000}>15 minutes</option>
                                <option value={30*60*1000}>30 minutes</option>
                                <option value={60*60*1000}>60 minutes</option>
                            </select>
                        </div>
                        <div className="space-y-2">
                            <label className="text-[10px] uppercase tracking-wider text-telegram-subtext font-bold ml-1 flex items-center gap-1"><Bell className="w-3 h-3" /> Notifications when locked (User Choice)</label>
                            <div className="grid grid-cols-3 gap-2">
                                {(['suppress','hide','allow'] as const).map(mode => (
                                    <button key={mode} onClick={() => setNotificationMode(mode)} className={`px-2 py-2 rounded-xl text-xs font-semibold border capitalize ${notificationMode===mode ? 'bg-telegram-primary text-white border-telegram-primary' : 'bg-black/20 text-telegram-subtext border-telegram-border hover:bg-white/5'}`}>
                                        {mode}
                                    </button>
                                ))}
                            </div>
                            <p className="text-[10px] text-telegram-subtext ml-1">suppress=queue, hide=show “New notification”, allow=show full</p>
                        </div>
                    </div>

                    <div className="h-px bg-telegram-border" />

                    {/* General Section */}
                    <div className="space-y-4">
                        <div className="flex items-center justify-between group">
                            <div className="flex items-center gap-3">
                                <div className="p-2 bg-green-500/10 rounded-lg group-hover:bg-green-500/20 transition-colors">
                                    <ShieldCheck className="w-4 h-4 text-green-500" />
                                </div>
                                <div className="flex flex-col">
                                    <span className="text-sm font-medium text-telegram-text">E2E Encryption</span>
                                    <span className="text-[10px] text-telegram-subtext">AES-GCM on device, key from lock PIN</span>
                                </div>
                            </div>
                            <button
                                onClick={() => setEncEnabled(!encEnabled)}
                                className={`w-10 h-5 rounded-full transition-all relative ${encEnabled ? 'bg-telegram-primary' : 'bg-white/10'}`}
                            >
                                <div className={`absolute top-1 w-3 h-3 rounded-full bg-white transition-all ${encEnabled ? 'left-6' : 'left-1'}`} />
                            </button>
                        </div>
                        {encEnabled && <p className="text-[10px] text-telegram-subtext ml-1">Uploads become .enc (needs lock PIN to decrypt on download). Set lockscreen PIN first.</p>}
                        <div className="flex items-center justify-between group">
                            <div className="flex items-center gap-3">
                                <div className="p-2 bg-blue-500/10 rounded-lg group-hover:bg-blue-500/20 transition-colors">
                                    <Power className="w-4 h-4 text-blue-500" />
                                </div>
                                <div className="flex flex-col">
                                    <span className="text-sm font-medium text-telegram-text">Auto Login</span>
                                    <span className="text-[10px] text-telegram-subtext">Remember session on startup</span>
                                </div>
                            </div>
                            <button
                                onClick={() => setSettings({ ...settings, auto_login: !settings.auto_login })}
                                className={`w-10 h-5 rounded-full transition-all relative ${settings.auto_login ? 'bg-telegram-primary' : 'bg-white/10'}`}
                            >
                                <div className={`absolute top-1 w-3 h-3 rounded-full bg-white transition-all ${settings.auto_login ? 'left-6' : 'left-1'}`} />
                            </button>
                        </div>
                    </div>
                </div>

                {/* Footer */}
                <div className="px-6 py-4 bg-white/5 border-t border-telegram-border flex items-center justify-end gap-3">
                    <button
                        onClick={onClose}
                        className="px-4 py-2 text-sm font-medium text-telegram-subtext hover:text-telegram-text transition-colors"
                    >
                        Cancel
                    </button>
                    <button
                        onClick={handleSave}
                        disabled={saving}
                        className="flex items-center gap-2 px-6 py-2 bg-telegram-primary hover:bg-telegram-primary-hover text-white rounded-xl text-sm font-bold shadow-lg shadow-telegram-primary/20 transition-all disabled:opacity-50 disabled:scale-95"
                    >
                        {saving ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                        Save Settings
                    </button>
                </div>
            </div>
        </div>
    );
}

function RefreshCw(props: any) {
    return <svg {...props} xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8"/><path d="M21 3v5h-5"/><path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16"/><path d="M3 21v-5h5"/></svg>
}
