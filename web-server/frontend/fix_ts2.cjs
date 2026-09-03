const fs = require('fs');

function replaceStr(path, search, replace) {
    let content = fs.readFileSync(path, 'utf8');
    content = content.split(search).join(replace);
    fs.writeFileSync(path, content);
}

replaceStr('src/components/AuthWizard.tsx', "import { callApi } from '../services/apiBridge';\r\nimport { callApi } from '../services/apiBridge';\r\nimport { getStore } from '../services/apiBridge';", "import { callApi, getStore } from '../services/apiBridge';");
replaceStr('src/components/AuthWizard.tsx', "import { callApi } from '../services/apiBridge';\nimport { callApi } from '../services/apiBridge';\nimport { getStore } from '../services/apiBridge';", "import { callApi, getStore } from '../services/apiBridge';");

replaceStr('src/components/AuthWizard.tsx', "import { callApi } from '../services/apiBridge';\r\nimport { callApi, getStore } from '../services/apiBridge';", "import { callApi, getStore } from '../services/apiBridge';");
replaceStr('src/components/AuthWizard.tsx', "import { callApi } from '../services/apiBridge';\nimport { callApi, getStore } from '../services/apiBridge';", "import { callApi, getStore } from '../services/apiBridge';");

replaceStr('src/components/Dashboard.tsx', "import { DragDropOverlay } from './dashboard/DragDropOverlay';\r\n", "");
replaceStr('src/components/Dashboard.tsx', "import { DragDropOverlay } from './dashboard/DragDropOverlay';\n", "");

replaceStr('src/components/Dashboard.tsx', "const setInternalDragFileId = (id: number | null) => {\r\n        internalDragRef.current = id;\r\n        _setInternalDragFileId(id);\r\n    };", "const setInternalDragFileId = (id: number | null) => { internalDragRef.current = id; };");
replaceStr('src/components/Dashboard.tsx', "const setInternalDragFileId = (id: number | null) => {\n        internalDragRef.current = id;\n        _setInternalDragFileId(id);\n    };", "const setInternalDragFileId = (id: number | null) => { internalDragRef.current = id; };");
