const fs = require('fs');

let content = fs.readFileSync('src/components/AuthWizard.tsx', 'utf8');
content = content.replace(/import \\{ callApi \\} from '\\.\\.\\/services\\/apiBridge';\\r?\\n/g, '');
content = content.replace(/import \\{ getStore \\} from '\\.\\.\\/services\\/apiBridge';\\r?\\n/g, '');
content = content.replace(/import \\{ callApi, getStore \\} from '\\.\\.\\/services\\/apiBridge';\\r?\\n/g, '');
content = content.replace(/import \\{ useTheme \\} from '\\.\\.\\/context\\/ThemeContext';/, 'import { useTheme } from \\'../context/ThemeContext\\';\\nimport { callApi, getStore } from \\'../services/apiBridge\\';');
fs.writeFileSync('src/components/AuthWizard.tsx', content);

