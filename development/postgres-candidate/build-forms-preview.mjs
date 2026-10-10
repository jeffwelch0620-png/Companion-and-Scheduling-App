import {build} from '../../node_modules/vite/dist/node/index.js';
import {verifyUiSourceBaseline} from './ui-source-baseline.mjs';
await verifyUiSourceBaseline();
import {fileURLToPath} from 'node:url';
import {readdir,readFile,writeFile} from 'node:fs/promises';import {createHash} from 'node:crypto';
await build({configFile:false,root:fileURLToPath(new URL('.',import.meta.url)),esbuild:{jsx:'automatic'},build:{outDir:'runtime/forms-dist',emptyOutDir:true,rollupOptions:{input:['forms-preview.html','overnight-preview.html','checkout-preview.html','schedule-preview.html'].map(f=>fileURLToPath(new URL(f,import.meta.url)))}}});
const assets=(await readdir(new URL('runtime/forms-dist/assets/',import.meta.url))).filter(f=>/\.(js|css)$/.test(f)).sort();const urls=['/checkout-forms',...assets.map(f=>'/assets/'+f)],version=createHash('sha256').update(JSON.stringify(urls)).digest('hex').slice(0,16);await writeFile(new URL('runtime/forms-dist/checkout-shell.json',import.meta.url),JSON.stringify({version,urls}));await writeFile(new URL('runtime/forms-dist/checkout-offline-worker.js',import.meta.url),(await readFile(new URL('checkout-offline-worker.js',import.meta.url),'utf8'))+'\n// Preview build: '+version+'\n');
