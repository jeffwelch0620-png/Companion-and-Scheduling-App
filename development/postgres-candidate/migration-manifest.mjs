import {readFile,readdir} from 'node:fs/promises';import {createHash} from 'node:crypto';
export async function verifyMigrationManifest(){
 const root=new URL('.',import.meta.url),manifest=JSON.parse(await readFile(new URL('migrations.json',root),'utf8'));
 const files=(await readdir(root)).filter(f=>/^\d{3}_.*\.sql$/.test(f)).sort();
 if(JSON.stringify(files)!==JSON.stringify(manifest.migrations.map(m=>m.file)))throw Error('Migration manifest order/file mismatch');
 for(const m of manifest.migrations){const digest=createHash('sha256').update(await readFile(new URL(m.file,root))).digest('hex');if(digest!==m.sha256)throw Error('Shared migration changed: '+m.file+'; add a corrective migration instead');}
 return files;
}
