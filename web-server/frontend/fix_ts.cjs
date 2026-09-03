const fs = require('fs');

function replaceStr(path, search, replace) {
    let content = fs.readFileSync(path, 'utf8');
    content = content.split(search).join(replace);
    fs.writeFileSync(path, content);
}

replaceStr('src/hooks/useFileUpload.ts', "export interface UploadItem { id: string; filePath?: string; filename: string; size: number; folderId: number | null; status: 'pending' | 'uploading' | 'success' | 'error' | 'cancelled'; error?: string; progress?: number; }", "import { QueueItem as UploadItem } from '../types';");

replaceStr('src/hooks/useFileUpload.ts', 'item.filename', 'item.path');

replaceStr('src/hooks/useFileUpload.ts', 'filePath: file.name, // Web uses file name as mock path\r\n                    filename: file.name,', 'path: file.name,');
replaceStr('src/hooks/useFileUpload.ts', 'filePath: file.name, // Web uses file name as mock path\n                    filename: file.name,', 'path: file.name,');

replaceStr('src/hooks/useFileUpload.ts', 'filePath: file.webkitRelativePath || file.name,\r\n                    filename: file.name,', 'path: file.webkitRelativePath || file.name,');
replaceStr('src/hooks/useFileUpload.ts', 'filePath: file.webkitRelativePath || file.name,\n                    filename: file.name,', 'path: file.webkitRelativePath || file.name,');
