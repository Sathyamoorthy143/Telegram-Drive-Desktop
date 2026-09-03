import { useState, useEffect, useRef } from 'react';
import { X } from 'lucide-react';

export interface PromptRequest {
    title: string;
    message?: string;
    placeholder?: string;
    confirmLabel?: string;
    defaultValue?: string;
    maxLength?: number;
}

interface PromptModalProps extends PromptRequest {
    onSubmit: (value: string | null) => void;
}

export function PromptModal({
    title, message, placeholder, confirmLabel = 'Confirm', defaultValue = '', maxLength = 100, onSubmit,
}: PromptModalProps) {
    const [value, setValue] = useState(defaultValue);
    const [error, setError] = useState<string | null>(null);
    const inputRef = useRef<HTMLInputElement>(null);

    useEffect(() => {
        inputRef.current?.focus();
        inputRef.current?.select();
    }, []);

    const submit = () => {
        const v = value.trim();
        if (!v) {
            setError('Please enter a value.');
            return;
        }
        onSubmit(v);
    };

    return (
        <div
            className="fixed inset-0 z-[120] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 animate-in fade-in duration-200"
            onClick={() => onSubmit(null)}
        >
            <div
                className="glass-modal rounded-2xl w-full max-w-sm shadow-2xl overflow-hidden animate-in zoom-in-95 duration-200"
                onClick={e => e.stopPropagation()}
            >
                <div className="px-5 py-4 border-b border-telegram-border flex items-center justify-between">
                    <h3 className="text-sm font-bold text-telegram-text">{title}</h3>
                    <button onClick={() => onSubmit(null)} className="p-1.5 hover:bg-white/10 rounded-full transition-colors">
                        <X className="w-4 h-4 text-telegram-subtext" />
                    </button>
                </div>
                <div className="p-5 space-y-3">
                    {message && <p className="text-xs text-telegram-subtext leading-relaxed">{message}</p>}
                    <input
                        ref={inputRef}
                        value={value}
                        maxLength={maxLength}
                        onChange={e => { setValue(e.target.value); setError(null); }}
                        onKeyDown={e => {
                            if (e.key === 'Enter') submit();
                            else if (e.key === 'Escape') onSubmit(null);
                        }}
                        placeholder={placeholder}
                        className="w-full bg-black/20 border border-telegram-border rounded-xl px-4 py-3 text-sm text-telegram-text placeholder:text-telegram-subtext/50 focus:outline-none focus:ring-2 focus:ring-telegram-primary/50"
                    />
                    {error && <p className="text-xs text-red-400">{error}</p>}
                    <div className="flex justify-end gap-2 pt-1">
                        <button
                            onClick={() => onSubmit(null)}
                            className="px-4 py-2 text-xs font-medium text-telegram-subtext hover:text-telegram-text transition-colors"
                        >
                            Cancel
                        </button>
                        <button
                            onClick={submit}
                            className="px-5 py-2 bg-telegram-primary hover:bg-telegram-primary/90 text-white rounded-xl text-xs font-bold transition-colors"
                        >
                            {confirmLabel}
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
}
