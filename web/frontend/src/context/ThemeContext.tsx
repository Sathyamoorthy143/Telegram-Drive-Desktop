import { createContext, useContext, useState, ReactNode, useLayoutEffect } from 'react';
type Theme = 'light' | 'dark';
interface ThemeContextType { theme: Theme; toggleTheme: () => void; setTheme: (t: Theme) => void; }
const ThemeContext = createContext<ThemeContextType | undefined>(undefined);
function getInitialTheme(): Theme { if (typeof window !== 'undefined') { const s = localStorage.getItem('theme') as Theme; if (s === 'light' || s === 'dark') return s; if (window.matchMedia('(prefers-color-scheme: light)').matches) return 'light'; } return 'dark'; }
function applyTheme(t: Theme) { const r = document.documentElement; if (t === 'light') { r.classList.add('light'); r.classList.remove('dark'); } else { r.classList.add('dark'); r.classList.remove('light'); } }
if (typeof window !== 'undefined') applyTheme(getInitialTheme());
export function ThemeProvider({ children }: { children: ReactNode }) {
    const [theme, setThemeState] = useState<Theme>(getInitialTheme);
    useLayoutEffect(() => { applyTheme(theme); localStorage.setItem('theme', theme); }, [theme]);
    const toggleTheme = () => setThemeState(t => t === 'dark' ? 'light' : 'dark');
    return <ThemeContext.Provider value={{ theme, toggleTheme, setTheme: setThemeState }}>{children}</ThemeContext.Provider>;
}
export const useTheme = () => { const c = useContext(ThemeContext); if (!c) throw new Error('useTheme must be used within a ThemeProvider'); return c; };
