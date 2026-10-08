// Build reviewed source in a fresh ignored directory while an owner preview uses dist.
// No environment files, credentials, databases or existing output are copied.
import fs from 'node:fs';import path from 'node:path';import crypto from 'node:crypto';
const root=process.cwd(),target=path.join(root,'.sites-runtime','isolated-'+crypto.randomUUID());fs.mkdirSync(target,{recursive:true});
const files=['package.json','vite.config.ts','tsconfig.json','next.config.ts','postcss.config.mjs','worker-env.d.ts','.openai/hosting.json'];
for(const name of files){fs.mkdirSync(path.dirname(path.join(target,name)),{recursive:true});fs.copyFileSync(path.join(root,name),path.join(target,name));}
for(const name of ['app','build','db','drizzle','worker','public'])fs.cpSync(path.join(root,name),path.join(target,name),{recursive:true,filter:file=>!fs.lstatSync(file).isSymbolicLink()&&!path.basename(file).startsWith('.env')&&!path.basename(file).startsWith('.dev.vars')});
fs.writeFileSync('.sites-runtime/latest-isolated-build.json',JSON.stringify({root:target,dist:path.join(target,'dist'),createdAt:new Date().toISOString()},null,2));console.log(target);
