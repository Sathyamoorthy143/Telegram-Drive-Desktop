import { useState, useEffect } from 'react';
import { X, Tag, Plus } from 'lucide-react';
import * as api from '../../api';
import { toast } from 'sonner';

export function TagsModal({ file, onClose }: { file: any; onClose: () => void }) {
  const [tags, setTags] = useState<string[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    api.getTags(file.id).then(setTags).catch(()=>{}).finally(()=>setLoading(false));
  }, [file]);
  const add = () => {
    const t = input.trim().toLowerCase().replace(/\s+/g, '-');
    if (!t) return;
    if (tags.includes(t)) { setInput(''); return; }
    setTags([...tags, t]); setInput('');
  };
  const save = async () => {
    try { await api.setTags(file.id, tags); toast.success('Tags saved'); onClose(); }
    catch (e: any) { toast.error(`Save failed: ${e.message}`); }
  };
  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4" onClick={onClose}>
      <div className="glass-modal rounded-2xl w-full max-w-sm p-6" onClick={e=>e.stopPropagation()}>
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-sm font-bold text-telegram-text flex items-center gap-2"><Tag className="w-4 h-4 text-purple-400" /> Tags — {file.name}</h3>
          <button onClick={onClose} className="p-1 hover:bg-white/10 rounded-full"><X className="w-4 h-4 text-telegram-subtext" /></button>
        </div>
        {loading ? <div className="flex justify-center p-4"><div className="w-5 h-5 border-2 border-telegram-primary border-t-transparent rounded-full animate-spin" /></div> : (
          <>
            <div className="flex flex-wrap gap-2 mb-4">
              {tags.length === 0 && <span className="text-xs text-telegram-subtext">No tags yet</span>}
              {tags.map(t => (
                <span key={t} className="px-2 py-1 bg-purple-500/15 text-purple-300 rounded-lg text-xs flex items-center gap-1">
                  #{t}
                  <button onClick={()=>setTags(tags.filter(x=>x!==t))} className="hover:text-red-400">×</button>
                </span>
              ))}
            </div>
            <div className="flex gap-2 mb-4">
              <input value={input} onChange={e=>setInput(e.target.value)} onKeyDown={e=>e.key==='Enter'&&add()} placeholder="Add tag..." className="flex-1 bg-black/20 border border-telegram-border rounded-xl px-3 py-2 text-sm text-telegram-text" />
              <button onClick={add} className="px-3 py-2 bg-purple-500/20 text-purple-300 rounded-xl"><Plus className="w-4 h-4" /></button>
            </div>
            <button onClick={save} className="w-full py-2 bg-telegram-primary text-white rounded-xl text-sm font-bold">Save</button>
          </>
        )}
      </div>
    </div>
  );
}
