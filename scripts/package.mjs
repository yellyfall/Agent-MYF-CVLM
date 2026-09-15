import {mkdir,copyFile,readdir,stat} from 'node:fs/promises';
import path from 'node:path';
// Copy only deliverable files; exclude credentials, databases and QA artifacts.
const source=process.cwd(),destination=process.argv[2];
if(!destination)throw new Error('Usage: node scripts/package.mjs <new-empty-directory>');
const allowed=['package.json','package-lock.json','server.js','README.md','render.yaml','Dockerfile','compose.yaml','Caddyfile','.env.example','.gitignore','.dockerignore','src','public','test','scripts'];
async function copy(from,to){const info=await stat(from);if(info.isDirectory()){await mkdir(to,{recursive:true});for(const name of await readdir(from))await copy(path.join(from,name),path.join(to,name));}else await copyFile(from,to);}
await mkdir(destination,{recursive:false});for(const name of allowed)await copy(path.join(source,name),path.join(destination,name));console.log(destination);

