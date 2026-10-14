import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
export const copyBatchSourcePaths=['app/team/schedule-copy.tsx','app/team/schedule-draft-editor.tsx'];
export const copyBatchFingerprint=source=>createHash('sha256').update(source.replace(/\r\n?/g,'\n')).digest('hex');
// Separate gate for the two adapted forms; the existing three-component/domain gate remains unchanged.
export async function verifyCopyBatchSourceBaseline({baseline,readSource=path=>readFile(new URL('../../'+path,import.meta.url),'utf8')}={}){
 baseline??=JSON.parse(await readFile(new URL('copy-batch-source-baseline.json',import.meta.url),'utf8'));
 if(Object.keys(baseline).length!==2||!copyBatchSourcePaths.every(p=>Object.hasOwn(baseline,p)))throw Error('Expected only the two adapted copy/batch sources');
 for(const path of copyBatchSourcePaths)if(copyBatchFingerprint(await readSource(path))!==baseline[path])throw Error('Copy/batch form source changed: '+path+'. Reconcile ui-copy-batch.tsx, then update copy-batch-source-baseline.json in the same PR.');
}
