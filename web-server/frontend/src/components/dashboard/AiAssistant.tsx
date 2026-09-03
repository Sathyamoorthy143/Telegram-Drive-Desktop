import { useState, useEffect, useRef } from 'react';
import { X, Bot, Send, User, Sparkles, Loader2, BrainCircuit } from 'lucide-react';
import { callApi } from '../../services/apiBridge';
import { TelegramFile } from '../../types';

interface Message {
    role: 'user' | 'ai';
    content: string;
}

interface AiAssistantProps {
    onClose: () => void;
    currentFolderFiles: TelegramFile[];
}

export function AiAssistant({ onClose, currentFolderFiles }: AiAssistantProps) {
    const [messages, setMessages] = useState<Message[]>([
        { role: 'ai', content: "Hello! I'm your Antigravity AI Assistant. I can help you analyze your files and folders. What would you like to know?" }
    ]);
    const [input, setInput] = useState("");
    const [loading, setLoading] = useState(false);
    const scrollRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        if (scrollRef.current) {
            scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
        }
    }, [messages]);

    const handleSend = async () => {
        if (!input.trim() || loading) return;

        const userMsg = input.trim();
        setInput("");
        setMessages(prev => [...prev, { role: 'user', content: userMsg }]);
        setLoading(true);

        try {
            // We pass the current file list as context to Gemini
            const context = currentFolderFiles.map(f => `${f.name} (${f.size} bytes)`).join(', ');
            const prompt = `User is looking at these files: ${context}. User asks: ${userMsg}`;

            // In a real implementation, we'd have a backend command for Gemini
            const response = await callApi<string>('cmd_gemini_chat', { prompt });
            setMessages(prev => [...prev, { role: 'ai', content: response }]);
        } catch (err) {
            setMessages(prev => [...prev, { role: 'ai', content: "Error: " + err }]);
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="fixed bottom-20 right-8 w-[400px] h-[550px] bg-telegram-surface border border-telegram-border rounded-2xl shadow-2xl flex flex-col overflow-hidden z-[90] animate-in slide-in-from-bottom-4 duration-300">
            {/* Header */}
            <div className="px-4 py-3 bg-white/5 border-b border-telegram-border flex items-center justify-between">
                <div className="flex items-center gap-2">
                    <div className="p-1.5 bg-purple-500/20 rounded-lg">
                        <Bot className="w-5 h-5 text-purple-400" />
                    </div>
                    <div>
                        <h3 className="text-sm font-bold text-telegram-text">AI Assistant</h3>
                        <div className="flex items-center gap-1">
                            <div className="w-1.5 h-1.5 rounded-full bg-green-500 animate-pulse" />
                            <span className="text-[10px] text-telegram-subtext">Gemini Powered</span>
                        </div>
                    </div>
                </div>
                <button onClick={onClose} className="p-1 hover:bg-white/10 rounded-full transition-colors">
                    <X className="w-5 h-5 text-telegram-subtext" />
                </button>
            </div>

            {/* Messages */}
            <div ref={scrollRef} className="flex-1 overflow-y-auto p-4 space-y-4">
                {messages.map((m, i) => (
                    <div key={i} className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                        <div className={`max-w-[85%] flex gap-3 ${m.role === 'user' ? 'flex-row-reverse' : ''}`}>
                            <div className={`w-8 h-8 rounded-full flex-shrink-0 flex items-center justify-center ${m.role === 'user' ? 'bg-telegram-primary' : 'bg-purple-500'}`}>
                                {m.role === 'user' ? <User className="w-4 h-4 text-white" /> : <Bot className="w-4 h-4 text-white" />}
                            </div>
                            <div className={`p-3 rounded-2xl text-sm leading-relaxed ${m.role === 'user' ? 'bg-telegram-primary text-white rounded-tr-none' : 'bg-white/5 text-telegram-text rounded-tl-none border border-white/5'}`}>
                                {m.content}
                            </div>
                        </div>
                    </div>
                ))}
                {loading && (
                    <div className="flex justify-start">
                        <div className="max-w-[85%] flex gap-3">
                            <div className="w-8 h-8 rounded-full bg-purple-500 flex items-center justify-center">
                                <Loader2 className="w-4 h-4 text-white animate-spin" />
                            </div>
                            <div className="p-3 bg-white/5 text-telegram-subtext rounded-2xl rounded-tl-none border border-white/5 flex items-center gap-2">
                                <Sparkles className="w-3 h-3 animate-pulse" />
                                Thinking...
                            </div>
                        </div>
                    </div>
                )}
            </div>

            {/* Input */}
            <div className="p-4 border-t border-telegram-border bg-white/5">
                <div className="flex gap-2 p-1 bg-black/20 rounded-xl border border-telegram-border focus-within:border-telegram-primary transition-colors">
                    <input
                        type="text"
                        value={input}
                        onChange={e => setInput(e.target.value)}
                        onKeyDown={e => e.key === 'Enter' && handleSend()}
                        placeholder="Ask anything about your files..."
                        className="flex-1 bg-transparent border-none focus:outline-none px-3 py-2 text-sm text-telegram-text"
                    />
                    <button
                        onClick={handleSend}
                        disabled={!input.trim() || loading}
                        className="p-2 bg-telegram-primary hover:bg-telegram-primary-hover disabled:opacity-50 text-white rounded-lg transition-all shadow-lg shadow-telegram-primary/20"
                    >
                        <Send className="w-4 h-4" />
                    </button>
                </div>
                <div className="flex items-center justify-center gap-1.5 mt-3 text-[9px] text-telegram-subtext uppercase tracking-widest font-bold">
                    <BrainCircuit className="w-3 h-3" />
                    Antigravity Intelligence v1.0
                </div>
            </div>
        </div>
    );
}
