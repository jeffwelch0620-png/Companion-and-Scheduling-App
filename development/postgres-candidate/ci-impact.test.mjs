import test from 'node:test';import assert from 'node:assert/strict';import {candidateAffected} from './ci-impact.mjs';
test('CI validates candidate and all source/configuration dependencies',()=>{
 for(const path of ['development/postgres-candidate/035.sql','app/shared/types.ts','app/team/ShiftEditor.tsx','app/api/example/route.ts','db/schema.ts','shared-ui/theme.css','scripts/build.mjs','package-lock.json','tsconfig.json','eslint.config.mjs','vite.config.ts','.github/workflows/postgres-candidate.yml'])assert.equal(candidateAffected([path]),true,path);
});
test('CI can skip unrelated files but never a mixed dependency change',()=>{
 assert.equal(candidateAffected(['.gitattributes']),true);
 assert.equal(candidateAffected(['notes/example.txt','.github/ISSUE_TEMPLATE/question.md']),false);
 assert.equal(candidateAffected(['notes/example.txt','development/postgres-candidate/task-http.ts']),true);
});
