const {test,after}=require('node:test');const assert=require('node:assert/strict');const fs=require('node:fs');const os=require('node:os');const path=require('node:path');const {Readable}=require('node:stream');const {DatabaseSync}=require('node:sqlite');const crypto=require('node:crypto');
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'myf-test-'));process.env.DATA_DIR=dir;process.env.ADMIN_PASSWORD='test-admin-long';process.env.GROQ_API_KEY='test-server-secret';
const old=new DatabaseSync(path.join(dir,'candidature.db'));old.exec('CREATE TABLE app_users(id TEXT,username TEXT,password TEXT,fullname TEXT,status TEXT,expires_at TEXT,created_at TEXT,role TEXT)');const salt='a'.repeat(32);const hash=crypto.scryptSync('old-password',salt,64).toString('hex');old.prepare('INSERT INTO app_users VALUES(?,?,?,?,?,?,?,?)').run('old-user','existing',salt+':'+hash,'Existing User','active',null,'2026-01-01','user');old.close();
let sent;require.cache[require.resolve('node-fetch')]={exports:async(url,options)=>{if(url==='https://example.com/demo')return {ok:true,headers:{get:()=> 'text/html'},text:async()=>'<title>Test &amp; lecture</title><p>Contenu &quot;lisible&quot;</p>'};sent={url,options,body:JSON.parse(options.body)};return {ok:true,body:Readable.from(['data: '+JSON.stringify({choices:[{delta:{content:'Bonjour'}}]})+'\n\n','data: '+JSON.stringify({choices:[{delta:{},finish_reason:'stop'}]})+'\n\ndata: [DONE]\n\n'])};}};
const {app,db}=require('../server');const server=app.listen(0,'127.0.0.1');after(async()=>{await new Promise(r=>server.close(r));db.close();fs.rmSync(dir,{recursive:true,force:true});});
async function api(route,body,token,method='POST'){const res=await fetch('http://127.0.0.1:'+server.address().port+'/api'+route,{method,headers:{'Content-Type':'application/json',...(token?{'x-session-token':token}:{})},...(method==='GET'?{}:{body:JSON.stringify(body||{})})});return {status:res.status,data:await res.json()};}
test('Original accounts, admin controls, Groq proxy, revocation and migration',async()=>{
 assert.equal((await api('/admin/login',{key:'arbitrary-provider-key'})).status,401);
 const admin=(await api('/admin/login',{key:process.env.ADMIN_PASSWORD})).data.data.session_token;assert.ok(admin);
 const existing=await api('/login',{username:'existing',password:'old-password'});assert.equal(existing.status,200);
 const created=await api('/admin/users',{username:'alice',password:'long-password',fullname:'Alice'},admin);assert.equal(created.status,200);
 const user=(await api('/login',{username:'alice',password:'long-password'})).data.data.session_token;assert.ok(user);
 const res=await fetch('http://127.0.0.1:'+server.address().port+'/api/ai-stream',{method:'POST',headers:{'content-type':'application/json','x-session-token':user},body:JSON.stringify({model:'mistral-large-latest',messages:[{role:'user',content:'Mon CV'}]})});assert.equal(res.status,200);assert.match(await res.text(),/Bonjour/);assert.equal(sent.url,'https://api.groq.com/openai/v1/chat/completions');assert.equal(sent.options.headers.Authorization,'Bearer test-server-secret');assert.equal(sent.body.model,'openai/gpt-oss-120b');assert.match(sent.body.messages[0].content,/ne jamais inventer/);
 assert.equal((await api('/live-time',{},user)).status,200);
 assert.equal((await api('/generate-image',{prompt:'chat'},user)).status,501);
 await api('/admin/users/'+created.data.data.id,{op:'pause'},admin,'PATCH');assert.equal((await api('/live-time',{},user)).status,401);
 await api('/logout',{},existing.data.data.session_token);assert.equal((await api('/live-time',{},existing.data.data.session_token)).status,401);
 const users=await api('/admin/users',{},admin,'GET');assert.equal(users.data.data.users.length,2);assert.ok(users.data.data.users.every(u=>!u.password));
});
test('private web addresses rejected',()=>{const {publicAddress}=require('../lib/public-fetch');for(const ip of ['127.0.0.1','169.254.169.254','10.0.0.1','192.168.0.1','::1','100.64.0.1'])assert.equal(publicAddress(ip),false);assert.equal(publicAddress('8.8.8.8'),true);});
test('every inline script parses',()=>{const vm=require('node:vm');const html=fs.readFileSync(path.join(__dirname,'../public/index.html'),'utf8');for(const m of html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi))if(m[1].trim())new vm.Script(m[1]);for(const name of ['app_v18.js','interface-1.js','interface-2.js','interface-events.js'])new vm.Script(fs.readFileSync(path.join(__dirname,'../public',name),'utf8'));});
test('truncated AI output is rejected by the original frontend adapter',async()=>{
 const vm=require('node:vm');const html=fs.readFileSync(path.join(__dirname,'../public/index.html'),'utf8');const js=fs.readFileSync(path.join(__dirname,'../public/interface-2.js'),'utf8');const start=js.indexOf('async function secureGroqStream(');const end=js.indexOf('// Génération CV/LM/recruteur',start);const source=js.slice(start,end);
 for(const reason of ['length',null,'stop']){
  const payload='data: '+JSON.stringify({choices:[{delta:{content:'Texte'},finish_reason:reason}]})+'\n\n';
  const context=vm.createContext({BASE:'',secureAuthHeaders:()=>({}),TextDecoder,fetch:async()=>new Response(payload),Response});vm.runInContext(source,context);
  if(reason==='stop')assert.equal(await context.secureGroqStream({}), 'Texte');else await assert.rejects(context.secureGroqStream({}),/incompl|interrompue/);
 }
});
test('migration marker prevents re-creating previously deleted accounts',()=>{
 db.prepare("DELETE FROM users WHERE id='old-user'").run();assert.equal(require('../lib/migrate')(db,dir),0);assert.equal(db.prepare("SELECT id FROM users WHERE id='old-user'").get(),undefined);
});

test('URL reading decodes entities without losing the web helper',async()=>{const admin=(await api('/admin/login',{key:process.env.ADMIN_PASSWORD})).data.data.session_token;const result=await api('/read-url',{url:'https://example.com/demo'},admin);assert.equal(result.status,200);assert.equal(result.data.data.title,'Test & lecture');assert.match(result.data.data.text,/Contenu "lisible"/);});
