const fs = require('fs');
const path = require('path');

function walk(dir) {
    let results = [];
    const list = fs.readdirSync(dir);
    list.forEach(function(file) {
        file = dir + '/' + file;
        const stat = fs.statSync(file);
        if (stat && stat.isDirectory()) { 
            results = results.concat(walk(file));
        } else { 
            if(file.endsWith('.ts') || file.endsWith('.tsx')) {
                results.push(file);
            }
        }
    });
    return results;
}

const dir = 'c:/Users/sk143/Downloads/telegram drive/Telegram-Drive/web-server/frontend/src';
const files = walk(dir);

files.forEach(file => {
    let content = fs.readFileSync(file, 'utf8');
    let original = content;
    
    // Calculate relative path to services/apiBridge
    const fileDir = path.dirname(file);
    let relativePath = path.relative(fileDir, 'c:/Users/sk143/Downloads/telegram drive/Telegram-Drive/web-server/frontend/src/services/apiBridge');
    relativePath = relativePath.replace(/\\/g, '/');
    if (!relativePath.startsWith('.')) relativePath = './' + relativePath;
    
    content = content.replace(/import \{.*?invoke.*?\} from '@tauri-apps\/api\/core';/g, 'import { callApi } from \'' + relativePath + '\';');
    content = content.replace(/invoke\(/g, 'callApi(');
    content = content.replace(/invoke</g, 'callApi<');
    
    if(content !== original) {
        fs.writeFileSync(file, content);
        console.log('Updated: ' + file);
    }
});

