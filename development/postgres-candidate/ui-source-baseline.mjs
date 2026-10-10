import {readFile} from 'node:fs/promises';import {createHash} from 'node:crypto';
export async function verifyUiSourceBaseline() {
 const files=JSON.parse(await readFile(new URL('./ui-source-baseline.json',import.meta.url),'utf8'));
 for(const [path,expected] of Object.entries(files)) {
  if(!/^app\/(team|shared)\/[a-z-]+\.tsx?$/.test(path))throw Error('Invalid UI source baseline path');
  const source=(await readFile(new URL('../../'+path,import.meta.url),'utf8')).replace(/\r\n?/g,'\n');
  if(createHash('sha256').update(source).digest('hex')!==expected)throw Error('Review candidate UI adoption against the changed shared source: '+path);
 }
}
