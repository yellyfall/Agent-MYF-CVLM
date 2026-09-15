import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {createApplication} from '../server.js';
import {hashPassword,checkPassword,signSession,verifySession,activeUser} from '../src/auth.js';
import {validateOutput,buildMessages} from '../src/generation.js';
const input={cv:'Alice Martin\nalice@example.com\nIngénieure solaire\nExpérience professionnelle\nIngénieure chez Soleil SAS - 2022 à 2025\n- Dimensionnement photovoltaïque avec PVsyst.\nFormation\nMaster énergie - Université de Lyon - 2022',offer:'Soleil Conseil recherche une ingénieure solaire pour le dimensionnement photovoltaïque. Maîtrise de PVsyst et AutoCAD demandée. Gestion de projets et suivi des études.',instructions:'Ton professionnel.',language:'fr',length:'équilibré'};
const output={cv:input.cv,letter:'Alice Martin\nalice@example.com\nSoleil Conseil\nObjet : candidature au poste d’ingénieure solaire\nMadame, Monsieur,\nMon expérience en dimensionnement photovoltaïque chez Soleil SAS correspond aux missions de votre offre. Je souhaite contribuer à vos études.\nCordialement,\nAlice Martin',keywords:[{term:'PVsyst',evidence:'Dimensionnement photovoltaïque avec PVsyst.'},{term:'AutoCAD',evidence:''},{term:'Python',evidence:'citation inventée'}],warnings:['Vérifier la maîtrise d’AutoCAD avant de la mentionner.']};
const mock=async(url,options)=>{
 if(url){assert.equal(url,'https://api.groq.com/openai/v1/chat/completions');assert.equal(options.headers.Authorization,'Bearer mock');const payload=JSON.parse(options.body);assert.equal(payload.model,'openai/gpt-oss-120b');assert.equal(payload.max_completion_tokens,6500);assert.equal(payload.max_tokens,undefined);assert.equal(payload.response_format.type,'json_schema');assert.equal(payload.response_format.json_schema.strict,true);assert.equal(payload.reasoning_effort,'low');}
 return new Response(JSON.stringify({choices:[{finish_reason:'stop',message:{content:JSON.stringify(output)}}]}),{headers:{'Content-Type':'application/json'}});
};
test('mots de passe, signature, expiration et preuves',async()=>{
 const hash=await hashPassword('une phrase vraiment longue');assert(await checkPassword('une phrase vraiment longue',hash));assert(!await checkPassword('incorrect',hash));
 const token=signSession({id:'x',version:1},'secret',1000);assert.equal(verifySession(token,'secret',1001).id,'x');assert.equal(verifySession(token+'x','secret',1001),null);assert.equal(verifySession(token,'autre',1001),null);assert.equal(verifySession(token,'secret',99999999),null);
 assert(!activeUser({status:'paused'}));assert(!activeUser({status:'active',expires_at:'2020-01-01'}));
 const result=validateOutput(output,input);assert.equal(result.keywords.length,2);assert(result.keywords[0].sourceVerified);assert(!result.keywords[1].sourceVerified);
 assert(buildMessages(input)[0].content.includes('DOCUMENTS NON FIABLES'));assert.deepEqual(JSON.parse(buildMessages(input)[1].content).cv,input.cv);
});
test('parcours comptes, générations, contrôle des accès et persistance',async()=>{
 const dir=await mkdtemp(path.join(os.tmpdir(),'myf-test-'));const env={APP_SECRET:'a'.repeat(64),ADMIN_PASSWORD:'admin-long-password',DATA_DIR:dir,GROQ_API_KEY:'mock',DAILY_GENERATION_LIMIT:'2'};
 let app=await createApplication(env,mock);await new Promise(r=>app.server.listen(0,'127.0.0.1',r));let base=`http://127.0.0.1:${app.server.address().port}`;
 async function request(route,method='GET',data,cookie,headers={}){const response=await fetch(base+route,{method,headers:{'Content-Type':'application/json',...(cookie?{Cookie:cookie}:{}),...headers},...(data===undefined?{}:{body:JSON.stringify(data)})});return {status:response.status,body:await response.json(),cookie:response.headers.get('set-cookie')?.split(';')[0]};}
 try{
 assert.equal((await request('/api/health')).status,200);assert.equal((await request('/api/me')).status,401);
 assert.equal((await request('/api/login','POST',{username:'admin',password:'any-valid-groq-key'})).status,401);
 const admin=await request('/api/login','POST',{username:'admin',password:env.ADMIN_PASSWORD});assert.equal(admin.status,200);const adminCookie=admin.cookie;
 assert.equal((await request('/api/admin/users','POST',{username:'alice',password:'alice-password-strong',fullname:'Alice Martin'},adminCookie)).status,201);
 const login=await request('/api/login','POST',{username:'alice',password:'alice-password-strong'});const cookie=login.cookie;assert.equal(login.status,200);
 assert.equal((await request('/api/admin/users','GET',undefined,cookie)).status,403);
 assert.equal((await request('/api/generate','POST',input,cookie,{Origin:'https://evil.example'})).status,403);
 assert.equal((await request('/api/generate','POST',{...input,cv:'court'},cookie)).status,400);
 assert.equal((await request('/api/generate','POST',{...input,cv:'a'.repeat(110000)},cookie)).status,413);
 const generation=await request('/api/generate','POST',input,cookie);assert.equal(generation.status,200);assert.equal(generation.body.result.cv,input.cv);
 assert.equal((await request('/api/generate','POST',input,cookie)).status,200);assert.equal((await request('/api/generate','POST',input,cookie)).status,429);
 const users=(await request('/api/admin/users','GET',undefined,adminCookie)).body.users;const alice=users.find(u=>u.username==='alice');assert(!JSON.stringify(users).includes('password'));
 assert.equal((await request('/api/admin/users/'+alice.id,'PATCH',{op:'pause'},adminCookie)).status,200);assert.equal((await request('/api/me','GET',undefined,cookie)).status,401);
 await request('/api/admin/users/'+alice.id,'PATCH',{op:'resume'},adminCookie);await request('/api/admin/users/'+alice.id,'PATCH',{op:'password',password:'new-password-long'},adminCookie);
 assert.equal((await request('/api/login','POST',{username:'alice',password:'alice-password-strong'})).status,401);
 assert.equal((await request('/api/login','POST',{username:'alice',password:'new-password-long'})).status,200);
 assert.equal((await request('/api/admin/users/'+alice.id,'PATCH',{op:'expiry',date:'2026-02-30'},adminCookie)).status,400);
 await request('/api/admin/users/'+alice.id,'PATCH',{op:'expiry',date:'2020-01-01'},adminCookie);assert.equal((await request('/api/login','POST',{username:'alice',password:'new-password-long'})).status,401);
 await request('/api/admin/users/'+alice.id,'PATCH',{op:'expiry',date:''},adminCookie);
 await app.close();app=await createApplication(env,mock);await new Promise(r=>app.server.listen(0,'127.0.0.1',r));base=`http://127.0.0.1:${app.server.address().port}`;
 const persisted=await request('/api/login','POST',{username:'alice',password:'new-password-long'});assert.equal(persisted.status,200);assert.equal((await request('/api/generate','POST',input,persisted.cookie)).status,429);
 await request('/api/logout','POST',{},persisted.cookie);assert.equal((await request('/api/me','GET',undefined,persisted.cookie)).status,401);
 const adminAgain=await request('/api/login','POST',{username:'admin',password:env.ADMIN_PASSWORD});await request('/api/admin/users/'+alice.id,'DELETE',{},adminAgain.cookie);assert.equal((await request('/api/login','POST',{username:'alice',password:'new-password-long'})).status,401);
 }finally{await app.close();await rm(dir,{recursive:true,force:true});}
});
test('une génération par utilisateur et annulation libérant la place',async()=>{
 const dir=await mkdtemp(path.join(os.tmpdir(),'myf-concurrency-'));
 let calls=0;const delayed=async(_url,options)=>{calls++;await new Promise((resolve,reject)=>{const timer=setTimeout(resolve,300);options.signal.addEventListener('abort',()=>{clearTimeout(timer);reject(new Error('aborted'));},{once:true});});return mock();};
 const app=await createApplication({APP_SECRET:'b'.repeat(64),ADMIN_PASSWORD:'admin-long-password',DATA_DIR:dir,GROQ_API_KEY:'mock'},delayed);await new Promise(r=>app.server.listen(0,'127.0.0.1',r));const base=`http://127.0.0.1:${app.server.address().port}`;
 try{const login=await fetch(base+'/api/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username:'admin',password:'admin-long-password'})});const headers={'Content-Type':'application/json',Cookie:login.headers.get('set-cookie').split(';')[0]};const first=fetch(base+'/api/generate',{method:'POST',headers,body:JSON.stringify(input)});await new Promise(r=>setTimeout(r,60));const second=await fetch(base+'/api/generate',{method:'POST',headers,body:JSON.stringify(input)});assert.equal(second.status,429);assert.equal((await first).status,200);assert.equal(calls,1);
 const abort=new AbortController();const pending=fetch(base+'/api/generate',{method:'POST',headers,body:JSON.stringify(input),signal:abort.signal}).catch(()=>null);await new Promise(r=>setTimeout(r,60));abort.abort();await pending;await new Promise(r=>setTimeout(r,60));const next=await fetch(base+'/api/generate',{method:'POST',headers,body:JSON.stringify(input)});assert.equal(next.status,200);
 }finally{await app.close();await rm(dir,{recursive:true,force:true});}
});
test('Render refuse SQLite éphémère et ne démarre pas sans secrets',async()=>{
 await assert.rejects(createApplication({}),/APP_SECRET/);
 await assert.rejects(createApplication({APP_SECRET:'c'.repeat(64),ADMIN_PASSWORD:'admin-long-password',RENDER:'true'}),/DATABASE_URL/);
});


