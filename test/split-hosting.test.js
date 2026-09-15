import {test} from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {mkdtemp,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {createApplication} from '../server.js';

test('frontend séparé : proxy API, cookie, contrôle origine, compte et génération',async()=>{
  const dir=await mkdtemp(path.join(os.tmpdir(),'myf-split-'));
  const origin='https://candidature.example.com';
  const input={cv:'Alice Martin\nIngénieure solaire chez Soleil SAS de 2022 à 2025. Dimensionnement photovoltaïque avec PVsyst et études de production.',offer:'Soleil Conseil recherche une ingénieure solaire pour réaliser les études et le dimensionnement photovoltaïque avec PVsyst.',instructions:'',language:'fr',length:'équilibré'};
  const result={cv:input.cv,letter:'Madame, Monsieur, mon expérience en dimensionnement photovoltaïque chez Soleil SAS correspond aux missions de votre offre. Je souhaite vous présenter ma candidature. Cordialement, Alice Martin.',keywords:[],warnings:[]};
  const app=await createApplication({DATA_DIR:dir,APP_SECRET:'s'.repeat(64),ADMIN_PASSWORD:'test-password-long',API_ONLY:'true',NODE_ENV:'production',APP_ORIGIN:origin,GROQ_API_KEY:'mock'},async()=>new Response(JSON.stringify({choices:[{finish_reason:'stop',message:{content:JSON.stringify(result)}}]})));
  await new Promise(r=>app.server.listen(0,'127.0.0.1',r));
  const backendPort=app.server.address().port;
  // Emulates Render's external rewrite, preserving method/body/cookies/Origin.
  const proxy=http.createServer((req,res)=>{
    if(!req.url.startsWith('/api/')){res.writeHead(200,{'Content-Type':'text/html'});return res.end('<!doctype html><title>Frontend</title>');}
    const upstream=http.request({hostname:'127.0.0.1',port:backendPort,path:req.url,method:req.method,headers:{...req.headers,host:`127.0.0.1:${backendPort}`}},remote=>{res.writeHead(remote.statusCode,remote.headers);remote.pipe(res);});
    upstream.on('error',()=>{res.writeHead(502);res.end();});req.pipe(upstream);
  });
  await new Promise(r=>proxy.listen(0,'127.0.0.1',r));
  const base=`http://127.0.0.1:${proxy.address().port}`;
  async function request(route,method='GET',data,cookie,from=origin){const response=await fetch(base+route,{method,headers:{'Content-Type':'application/json',Origin:from,'Sec-Fetch-Site':'same-origin',...(cookie?{Cookie:cookie}:{})},...(data?{body:JSON.stringify(data)}:{})});return {response,data:await response.json()};}
  try{
    assert.equal((await fetch(`http://127.0.0.1:${backendPort}/`)).status,404);
    assert.equal((await request('/api/health')).response.status,200);
    const login=await request('/api/login','POST',{username:'admin',password:'test-password-long'});
    assert.equal(login.response.status,200);const setCookie=login.response.headers.get('set-cookie');assert.match(setCookie,/HttpOnly/);assert.match(setCookie,/Secure/);assert.match(setCookie,/SameSite=Strict/);assert(!/Domain=/i.test(setCookie));
    const cookie=setCookie.split(';')[0];assert.equal((await request('/api/me','GET',undefined,cookie)).data.user.role,'admin');
    assert.equal((await request('/api/admin/users','POST',{username:'alice',password:'alice-password-long'},cookie)).response.status,201);
    const userLogin=await request('/api/login','POST',{username:'alice',password:'alice-password-long'});const userCookie=userLogin.response.headers.get('set-cookie').split(';')[0];
    const generation=await request('/api/generate','POST',input,userCookie);assert.equal(generation.response.status,200);assert.equal(generation.data.result.cv,input.cv);assert.equal(generation.response.headers.get('cache-control'),'no-store');
    assert.equal((await request('/api/generate','POST',input,userCookie,'https://evil.example')).response.status,403);
    assert.equal((await request('/api/admin/users','GET',undefined,userCookie)).response.status,403);
    await request('/api/logout','POST',{},userCookie);assert.equal((await request('/api/me','GET',undefined,userCookie)).response.status,401);
  }finally{proxy.closeAllConnections();await new Promise(r=>proxy.close(r));await app.close();await rm(dir,{recursive:true,force:true});}
});
test('backend séparé : URL frontend explicite obligatoire',async()=>{
  const common={APP_SECRET:'s'.repeat(64),ADMIN_PASSWORD:'test-password-long',API_ONLY:'true',NODE_ENV:'production'};
  for(const APP_ORIGIN of [undefined,'https://front.example/','http://front.example','https://front.example/path'])await assert.rejects(createApplication({...common,APP_ORIGIN}),/APP_ORIGIN/);
});

