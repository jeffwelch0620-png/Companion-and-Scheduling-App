import {build} from '../../node_modules/vite/dist/node/index.js';
import {fileURLToPath} from 'node:url';
await build({configFile:false,root:fileURLToPath(new URL('.',import.meta.url)),esbuild:{jsx:'automatic'},build:{outDir:'runtime/forms-dist',emptyOutDir:true,rollupOptions:{input:['forms-preview.html','overnight-preview.html','checkout-preview.html'].map(f=>fileURLToPath(new URL(f,import.meta.url)))}}});
