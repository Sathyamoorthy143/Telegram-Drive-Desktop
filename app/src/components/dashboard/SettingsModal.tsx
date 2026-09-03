import { useState, useEffect } from 'react';
import { X, Save, Bot, Palette, Power, ShieldCheck } from 'lucide-react';
import { invoke } from '@tauri-apps/api/core';
import { toast } from 'sonner';

interface AppSettings {
    gemini_api_key?: string;
    theme: string;
    auto_login: boolean;
    ai_proxy_url: string;
}

interface SettingsModalProps {
    onClose: () => void;
}

export function SettingsModal({ onClose }: SettingsModalProps) {
    const [settings, setSettings] = useState<AppSettings>({
        theme: 'dark',
        auto_login: true,
        ai_proxy_url: 'https://telegram-drive-desktop.onrender.com/chat'
    });
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);

    useEffect(() => {
        const loadSettings = async () => {
            try {
                const data = await invoke<AppSettings>('get_settings');
                setSettings(data);
            } catch (err) {
                console.error("Failed to load settings:", err);
            } finally {
                setLoading(false);
            }
        };
        loadSettings();
    }, []);

    const handleSave = async () => {
        setSaving(true);
        try {
            await invoke('save_settings', { settings });
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
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 backdrop-blur-sm animate-in fade-in duration-200">
            <div className="glass-modal rounded-2xl w-full max-w-md shadow-2xl overflow-hidden animate-in zoom-in-95 duration-200">
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
                <div className="p-6 space-y-6">
                    {/* Gemini Section */}
                    <div className="space-y-4">
                        <div className="flex items-center gap-2 text-sm font-semibold text-telegram-text">
                            <Bot className="w-4 h-4 text-purple-400" />
                            AI Configuration (Gemini)
                        </div>
                        
                        <div className="space-y-1">
                            <label className="text-[10px] uppercase tracking-wider text-telegram-subtext font-bold ml-1">
                                API Key
                            </label>
                            <div className="relative">
                                <input
                                    type="password"
                                    value={settings.gemini_api_key || ''}
                                    onChange={e => setSettings({ ...settings, gemini_api_key: e.target.value })}
                                    placeholder="Paste your Gemini API key here..."
                                    className="w-full bg-black/20 border border-telegram-border rounded-xl px-4 py-3 text-sm text-telegram-text focus:outline-none focus:ring-2 focus:ring-telegram-primary/50 transition-all placeholder:text-telegram-subtext/50"
                                />
                                <ShieldCheck className="absolute right-4 top-3.5 w-4 h-4 text-green-500/50" />
                            </div>
                        </div>

                        <div className="space-y-1">
                            <label className="text-[10px] uppercase tracking-wider text-telegram-subtext font-bold ml-1">
                                AI Proxy URL
                            </label>
                            <div className="relative">
                                <input
                                    type="text"
                                    value={settings.ai_proxy_url}
                                    onChange={e => setSettings({ ...settings, ai_proxy_url: e.target.value })}
                                    placeholder="http://127.0.0.1:5000/chat"
                                    className="w-full bg-black/20 border border-telegram-border rounded-xl px-4 py-3 text-sm text-telegram-text focus:outline-none focus:ring-2 focus:ring-telegram-primary/50 transition-all placeholder:text-telegram-subtext/50"
                                />
                                <Power className="absolute right-4 top-3.5 w-4 h-4 text-blue-500/50" />
                            </div>
                            <p className="text-[10px] text-telegram-subtext ml-1">
                                Change to your Cloud URL (e.g. Render/Heroku) for 24/7 AI access.
                            </p>
                        </div>
                    </div>

                    <div className="h-px bg-telegram-border" />

                    {/* General Section */}
                    <div className="space-y-4">
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
