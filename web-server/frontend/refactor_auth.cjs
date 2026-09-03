const fs = require('fs');
const file = 'c:/Users/sk143/Downloads/telegram drive/Telegram-Drive/web-server/frontend/src/components/AuthWizard.tsx';
let content = fs.readFileSync(file, 'utf8');

// Remove Tauri imports
content = content.replace(/import \\{ load \\} from '@tauri-apps\\/plugin-store';\\n/g, '');
content = content.replace(/import \\{ open \\} from '@tauri-apps\\/plugin-shell';\\n/g, '');

// Import getStore
content = content.replace(/import \\{ callApi \\} from '\\.\\.\\/services\\/apiBridge';/g, 'import { callApi, getStore } from \\'../services/apiBridge\\';');

// Remove isBrowser block
content = content.replace(/const isBrowser = typeof window !== 'undefined' && !\\('__TAURI_INTERNALS__' in window\\);[\\s\\S]*?if \\(isBrowser\\) \\{[\\s\\S]*?return \\([\\s\\S]*?\\)[\\s\\S]*?\\}/m, '');

// Replace store logic
content = content.replace(/const store = await load\\('config.json'\\);/g, 'const store = await getStore();');

// Replace open links
content = content.replace(/open\\('(.*?)'\\)/g, 'window.open(\\'\\\', \\'_blank\\')');

fs.writeFileSync(file, content);

