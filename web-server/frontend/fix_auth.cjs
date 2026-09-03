const fs = require('fs');
let lines = fs.readFileSync('src/components/AuthWizard.tsx', 'utf8').split('\n');
lines = lines.filter(line => !line.includes("import { callApi } from '../services/apiBridge';") && !line.includes("import { getStore } from '../services/apiBridge';"));
lines.splice(4, 0, "import { callApi, getStore } from '../services/apiBridge';");
fs.writeFileSync('src/components/AuthWizard.tsx', lines.join('\n'));
