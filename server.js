import http from 'node:http';
import {readFile, stat} from 'node:fs/promises';
import {createReadStream} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {randomUUID} from 'node:crypto';
import {openStore} from './src/store.js';
import {hashPassword,checkPassword,signSession,verifySession,activeUser} from './src/auth.js';
import {schema,validateInput,validateOutput,buildMessages} from './src/generation.js';
const ROOT=path.dirname(fileURLToPath(import.meta.url));
const error=(message,status=400)=>Object.assign(new Error(message),{status});
const integer=(value,fallback,min,max)=>Math.min(max,Math.max(min,Number.parseInt(value,10)||fallback));
function json(res,status,data) { if(!res.destroyed && !res.writableEnded){ res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'}); res.end(JSON.stringify(data)); } }
async function body(req,limit=96*1024) {
  const declared=Number(req.headers['content-length']);
  if(declared>limit) {req.resume();throw error('Requête trop volumineuse.',413);}
  let size=0; const chunks=[];
  for await (const chunk of req) {size+=chunk.length;if(size>limit)throw error('Requête trop volumineuse.',413);chunks.push(chunk);}
  try {const value=JSON.parse(Buffer.concat(chunks).toString('utf8'));if(!value||typeof value!=='object'||Array.isArray(value))throw 0;return value;} catch {throw error('JSON invalide.');}
}
async function boundedResponse(response,limit=512*1024) {
  const reader=response.body.getReader();const chunks=[];let size=0;
  try {for(;;){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>limit)throw error('Réponse Groq trop volumineuse.',502);chunks.push(Buffer.from(value));}}finally{await reader.cancel().catch(()=>{});}
  try{return JSON.parse(Buffer.concat(chunks).toString());}catch{throw error('Réponse Groq illisible.',502);}
}
export async function createApplication(env=process.env,fetchImpl=fetch) {
  if(!env.APP_SECRET || env.APP_SECRET.length<32 || env.APP_SECRET.startsWith('remplacer-'))throw new Error('APP_SECRET doit contenir au moins 32 caractères.');
  if(!env.ADMIN_PASSWORD || env.ADMIN_PASSWORD.length<12 || env.ADMIN_PASSWORD.startsWith('remplacer-'))throw new Error('ADMIN_PASSWORD doit contenir au moins 12 caractères.');
  if(env.API_ONLY==='true') {
    let origin;
    try {origin=new URL(env.APP_ORIGIN);}catch {throw new Error('APP_ORIGIN requise : URL exacte du frontend Render.');}
    if(origin.origin!==env.APP_ORIGIN || (env.NODE_ENV==='production' && origin.protocol!=='https:') || !['http:','https:'].includes(origin.protocol))throw new Error('APP_ORIGIN doit être une origine HTTPS sans chemin ni slash final.');
  }
  const store=await openStore(env);
  const adminName=(env.ADMIN_USERNAME||'admin').toLowerCase();
  let admin=await store.byName(adminName);
  if(!admin){await store.query('INSERT INTO app_users(id,username,fullname,password,role,created_at) VALUES($1,$2,$3,$4,$5,$6)',[randomUUID(),adminName,'Administrateur',await hashPassword(env.ADMIN_PASSWORD),'admin',new Date().toISOString()]);}
  else if(admin.role!=='admin')throw new Error('ADMIN_USERNAME correspond à un compte utilisateur existant. Choisissez un autre nom.');
  else if(!await checkPassword(env.ADMIN_PASSWORD,admin.password))await store.query('UPDATE app_users SET password=$1,version=version+1 WHERE id=$2',[await hashPassword(env.ADMIN_PASSWORD),admin.id]);
  const production=env.NODE_ENV==='production', maxAI=integer(env.MAX_CONCURRENT_GENERATIONS,2,1,4), dailyLimit=integer(env.DAILY_GENERATION_LIMIT,20,1,200);
  let requests=0, ai=0, loginActive=0; const perUser=new Set(),loginAttempts=new Map();
  const cleanup=setInterval(()=>{const now=Date.now();for(const [key,item] of loginAttempts)if(item.until<now)loginAttempts.delete(key);store.query('DELETE FROM app_usage WHERE day < $1',[new Date(now-30*86400000).toISOString().slice(0,10)]).catch(()=>{});},60000);cleanup.unref();
  const cookie=(token,clear=false)=>`session=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${clear?0:28800}${production?'; Secure':''}`;
  async function current(req) {
    const token=(req.headers.cookie||'').split(';').map(x=>x.trim()).find(x=>x.startsWith('session='))?.slice(8)||'';
    const session=verifySession(token,env.APP_SECRET);
    const user=session?await store.byId(session.id):null;
    if(!session||!activeUser(user)||user.version!==session.version)throw error('Session expirée ou accès suspendu. Reconnectez-vous.',401);
    return user;
  }
  const publicUser=({id,username,fullname,role,status,expires_at})=>({id,username,fullname,role,status,expires_at});
  const server=http.createServer(async(req,res)=>{
    res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Referrer-Policy','same-origin');
    res.setHeader('Content-Security-Policy',"default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; worker-src 'self' blob:; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'");
    if(production)res.setHeader('Strict-Transport-Security','max-age=31536000');
    if(requests>=16){req.resume();return json(res,503,{error:'Serveur occupé. Réessayez dans quelques instants.'});}
    requests++;let released=false;const release=()=>{if(!released){released=true;requests--;}};res.once('finish',release);res.once('close',release);
    try {
      const url=new URL(req.url,'http://localhost');
      if(url.pathname==='/api/health'&&req.method==='GET')return json(res,200,{ok:true});
      if(url.pathname.startsWith('/api/')) {
        if(['POST','PATCH','DELETE'].includes(req.method)) {
          if(!String(req.headers['content-type']||'').startsWith('application/json'))throw error('Content-Type application/json requis.',415);
          const origin=req.headers.origin;
          if(origin && origin!==(env.APP_ORIGIN||`${production?'https':'http'}://${req.headers.host}`))throw error('Origine non autorisée.',403);
          if(req.headers['sec-fetch-site']==='cross-site')throw error('Requête intersite refusée.',403);
        }
        if(url.pathname==='/api/login'&&req.method==='POST') {
          // No trust in arbitrary forwarded headers: a global rolling limit also bounds proxy traffic.
          const key='global';const now=Date.now();let entry=loginAttempts.get(key);
          if(!entry||entry.until<now){entry={count:0,until:now+60000};loginAttempts.set(key,entry);}
          if(++entry.count>30 || loginActive>=2)throw error('Trop de connexions. Réessayez dans une minute.',429);
          loginActive++;
          try {
            const input=await body(req,4096);
            if(typeof input.username!=='string'||typeof input.password!=='string'||input.password.length>256)throw error('Identifiants invalides.');
            const user=await store.byName(input.username.toLowerCase().trim());
            const valid=await checkPassword(input.password,user?.password||dummyHash);
            if(!valid||!activeUser(user))throw error('Identifiants incorrects ou compte inactif.',401);
            res.setHeader('Set-Cookie',cookie(signSession(user,env.APP_SECRET)));return json(res,200,{user:publicUser(user)});
          } finally {loginActive--;}
        }
        const user=await current(req);
        if(url.pathname==='/api/me'&&req.method==='GET')return json(res,200,{user:publicUser(user),configured:!!env.GROQ_API_KEY,dailyLimit});
        if(url.pathname==='/api/logout'&&req.method==='POST'){await store.query('UPDATE app_users SET version=version+1 WHERE id=$1',[user.id]);res.setHeader('Set-Cookie',cookie('',true));return json(res,200,{ok:true});}
        if(url.pathname.startsWith('/api/admin/')) {
          if(user.role!=='admin')throw error('Accès administrateur requis.',403);
          if(url.pathname==='/api/admin/users'&&req.method==='GET')return json(res,200,{users:(await store.query('SELECT id,username,fullname,role,status,expires_at FROM app_users ORDER BY username')).map(publicUser)});
          if(url.pathname==='/api/admin/metrics'&&req.method==='GET')return json(res,200,{rssMB:Math.round(process.memoryUsage().rss/1048576),heapMB:Math.round(process.memoryUsage().heapUsed/1048576),activeGenerations:ai,maxAI,storage:env.DATABASE_URL?'PostgreSQL':'SQLite'});
          if(url.pathname==='/api/admin/users'&&req.method==='POST') {
            const input=await body(req,4096);const username=String(input.username||'').trim().toLowerCase();
            if(!/^[a-z0-9_.-]{3,50}$/.test(username))throw error('Identifiant : 3 à 50 lettres, chiffres, points, tirets ou underscores.');
            if(typeof input.password!=='string'||input.password.length<12||input.password.length>256)throw error('Mot de passe : 12 à 256 caractères.');
            if(await store.byName(username))throw error('Cet identifiant existe déjà.',409);
            const count=(await store.query('SELECT COUNT(*) AS n FROM app_users'))[0];if(Number(count.n)>=500)throw error('Limite de 500 comptes atteinte.',409);
            await store.query('INSERT INTO app_users(id,username,fullname,password,created_at) VALUES($1,$2,$3,$4,$5)',[randomUUID(),username,String(input.fullname||username).slice(0,100),await hashPassword(input.password),new Date().toISOString()]);
            return json(res,201,{ok:true});
          }
          const match=url.pathname.match(/^\/api\/admin\/users\/([a-zA-Z0-9-]+)$/);
          if(match&&['PATCH','DELETE'].includes(req.method)) {
            const target=await store.byId(match[1]);if(!target)throw error('Compte introuvable.',404);if(target.role==='admin')throw error('Le compte administrateur se configure par variables serveur.',403);
            if(req.method==='DELETE'){await store.query('DELETE FROM app_users WHERE id=$1',[target.id]);await store.query('DELETE FROM app_usage WHERE user_id=$1',[target.id]);return json(res,200,{ok:true});}
            const input=await body(req,4096);
            if(input.op==='pause'||input.op==='resume')await store.query('UPDATE app_users SET status=$1,version=version+1 WHERE id=$2',[input.op==='pause'?'paused':'active',target.id]);
            else if(input.op==='expiry') {
              const value=input.date||null;
              if(value&&(!/^\d{4}-\d{2}-\d{2}$/.test(value)||Number.isNaN(Date.parse(value))||new Date(value).toISOString().slice(0,10)!==value))throw error('Date invalide.');
              await store.query('UPDATE app_users SET expires_at=$1,version=version+1 WHERE id=$2',[value,target.id]);
            } else if(input.op==='password') {
              if(typeof input.password!=='string'||input.password.length<12||input.password.length>256)throw error('Mot de passe : 12 à 256 caractères.');
              await store.query('UPDATE app_users SET password=$1,version=version+1 WHERE id=$2',[await hashPassword(input.password),target.id]);
            } else throw error('Opération inconnue.');return json(res,200,{ok:true});
          }
        }
        if(url.pathname==='/api/generate'&&req.method==='POST') {
          if(!env.GROQ_API_KEY)throw error('L’administrateur doit configurer GROQ_API_KEY sur le serveur.',503);
          if(ai>=maxAI||perUser.has(user.id)){res.setHeader('Retry-After','10');throw error('Une génération est déjà en cours. Réessayez dans quelques instants.',429);}
          ai++;perUser.add(user.id);
          const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),90000);timer.unref();
          const disconnect=()=>{if(!res.writableEnded)controller.abort();};res.once('close',disconnect);
          try {
            const input=validateInput(await body(req));
            if(!await store.consume(user.id,dailyLimit))throw error(`Limite quotidienne atteinte (${dailyLimit} tentatives). Réessayez demain.`,429);
            const response=await fetchImpl('https://api.groq.com/openai/v1/chat/completions',{
              method:'POST',signal:controller.signal,headers:{Authorization:`Bearer ${env.GROQ_API_KEY}`,'Content-Type':'application/json'},
              body:JSON.stringify({model:env.GROQ_MODEL||'openai/gpt-oss-120b',messages:buildMessages(input),temperature:0.2,max_completion_tokens:6500,...(/^openai\/gpt-oss-(20|120)b$/.test(env.GROQ_MODEL||'openai/gpt-oss-120b')?{reasoning_effort:'low'}:{}),stream:false,response_format:{type:'json_schema',json_schema:{name:'candidature',schema,strict:true}}})
            });
            if(!response.ok){await response.body?.cancel();throw error(response.status===429?'Quota Groq atteint. Réessayez plus tard.':response.status===401?'Clé Groq invalide : contactez l’administrateur.':'Groq est indisponible ou le modèle est incompatible. Contactez l’administrateur.',response.status===429?429:502);}
            const payload=await boundedResponse(response);const choice=payload.choices?.[0];
            if(choice?.finish_reason!=='stop')throw error('La réponse IA est incomplète. Réduisez le CV ou l’offre et réessayez.',502);
            let data;try{data=JSON.parse(choice.message.content);}catch{throw error('Format de réponse IA invalide. Réessayez.',502);}
            return json(res,200,{result:validateOutput(data,input)});
          } catch(e) {if(controller.signal.aborted)throw error('Génération interrompue ou délai de 90 secondes dépassé. Réessayez.',504);throw e;}
          finally {clearTimeout(timer);res.off('close',disconnect);ai--;perUser.delete(user.id);}
        }
        throw error('Route introuvable.',404);
      }
      if(env.API_ONLY==='true')throw error('Backend uniquement : ouvrez le frontend sur Render.',404);
      if(!['GET','HEAD'].includes(req.method))throw error('Méthode non autorisée.',405);
      const relative=url.pathname==='/'?'index.html':decodeURIComponent(url.pathname.slice(1));
      const file=path.resolve(ROOT,'public',relative);if(!file.startsWith(path.join(ROOT,'public')+path.sep))throw error('Introuvable.',404);
      let info;try{info=await stat(file);}catch{throw error('Introuvable.',404);}if(!info.isFile())throw error('Introuvable.',404);
      const types={'.html':'text/html; charset=utf-8','.css':'text/css; charset=utf-8','.js':'text/javascript; charset=utf-8','.mjs':'text/javascript; charset=utf-8','.svg':'image/svg+xml'};
      res.writeHead(200,{'Content-Type':types[path.extname(file)]||'application/octet-stream','Content-Length':info.size,'Cache-Control':'no-cache'});
      if(req.method==='HEAD')res.end();else createReadStream(file).on('error',()=>res.destroy()).pipe(res);
    }catch(e){json(res,e.status||500,{error:e.status?e.message:'Erreur du serveur. Réessayez ou contactez l’administrateur.'});if(!e.status)console.error('Erreur interne:',e.code||e.name);}
  });
  const dummyHash=await hashPassword(randomUUID());
  server.requestTimeout=100000;server.headersTimeout=15000;server.keepAliveTimeout=5000;server.maxConnections=40;
  return {server,store,async close(){clearInterval(cleanup);server.closeAllConnections();await new Promise(r=>server.close(r));await store.close();}};
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  const app=await createApplication();const port=Number(process.env.PORT||3000);
  app.server.listen(port,'0.0.0.0',()=>console.log(`MYF Candidature disponible sur le port ${port}`));
  for(const signal of ['SIGTERM','SIGINT'])process.once(signal,()=>app.close().then(()=>process.exit(0)));
}




