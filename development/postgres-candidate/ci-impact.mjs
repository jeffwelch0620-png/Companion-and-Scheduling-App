import {spawnSync} from 'node:child_process';
import {pathToFileURL} from 'node:url';
// Include both candidate files and every class of source/configuration consumed by its checks.
export function candidateAffected(paths){
 return paths.some(p=>/^(development\/|app\/|db\/|scripts\/|shared-ui\/|public\/|docs\/|\.github\/workflows\/postgres-candidate\.yml$)/.test(p)
  || /^(package(?:-lock)?\.json|tsconfig[^/]*\.json|eslint\.config\.[^/]+|[^/]*(?:vite|vinext|postcss|tailwind)[^/]*|AGENTS\.md|README\.md|\.gitattributes)$/.test(p));
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 const {CANDIDATE_DIFF_BASE:base,CANDIDATE_DIFF_HEAD:head}=process.env;
 if(!base||/^0+$/.test(base)){console.log('required=true');}
 else{
  if(!/^[0-9a-f]{40}$/.test(base)||!head||!/^[0-9a-f]{40}$/.test(head))throw Error('Expected commit IDs');
  const diff=spawnSync('git',['diff','--name-only','-z',base,head],{encoding:'utf8'});
  if(diff.status!==0)throw Error('Unable to determine candidate dependencies: '+diff.stderr);
  console.log('required='+candidateAffected(diff.stdout.split('\0').filter(Boolean)));
 }
}
