import {createApplication} from '../server.js';
import {mkdtemp,rm,writeFile,mkdir} from 'node:fs/promises';
import os from 'node:os';import path from 'node:path';
await mkdir('qa',{recursive:true});
const temp=await mkdtemp(path.join(os.tmpdir(),'myf-memory-'));
const response={cv:'Alice Martin\n'+('Expérience professionnelle photovoltaïque.\n'.repeat(120)),letter:'Madame, Monsieur,\n'+('Mon expérience correspond aux études photovoltaïques. '.repeat(40)),keywords:[],warnings:[]};
const app=await createApplication({APP_SECRET:'m'.repeat(64),ADMIN_PASSWORD:'memory-test-password',DATA_DIR:temp,GROQ_API_KEY:'mock'},async()=>{await new Promise(r=>setTimeout(r,150));return new Response(JSON.stringify({choices:[{finish_reason:'stop',message:{content:JSON.stringify(response)}}]}));});
await new Promise(r=>app.server.listen(0,'127.0.0.1',r));const base=`http://127.0.0.1:${app.server.address().port}`;let peak=process.memoryUsage().rss;const sample=setInterval(()=>peak=Math.max(peak,process.memoryUsage().rss),10);
const call=(route,data,cookie)=>fetch(base+route,{method:'POST',headers:{'Content-Type':'application/json',...(cookie?{Cookie:cookie}:{})},body:JSON.stringify(data)});
try{const login=await call('/api/login',{username:'admin',password:'memory-test-password'});const cookie=login.headers.get('set-cookie').split(';')[0];await login.text();await call('/api/admin/users',{username:'second',password:'second-test-password'},cookie);const second=await call('/api/login',{username:'second',password:'second-test-password'});const cookie2=second.headers.get('set-cookie').split(';')[0];await second.text();const idle=process.memoryUsage().rss;const input={cv:'Expérience en études photovoltaïques. '.repeat(500),offer:'Offre ingénieure photovoltaïque. '.repeat(450),instructions:'',language:'fr',length:'équilibré'};const statuses={};for(let wave=0;wave<5;wave++){const codes=await Promise.all(Array.from({length:12},async(_,i)=>{const r=await call('/api/generate',input,i%2?cookie:cookie2);await r.text();return r.status;}));for(const code of codes)statuses[code]=(statuses[code]||0)+1;}
const report={platform:process.platform,node:process.version,idleRssMB:Math.round(idle/1048576),peakRssMB:Math.round(peak/1048576),requests:60,statuses,note:'Essai local Node isolé : 5 vagues de 12 requêtes, 2 comptes, réponses Groq simulées. Ce n’est pas une garantie de mémoire sur Render.'};await writeFile('qa/memory-report.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report));
}finally{clearInterval(sample);await app.close();await rm(temp,{recursive:true,force:true});}


