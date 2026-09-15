const $=id=>document.getElementById(id);
let user=null,result=null,selected='cv',controller=null,importing=false,previousUserId=null,sourceSnapshot=null;
let exportModule;
const exporter=()=>exportModule ||= import('/vendor/export.js');
function notice(text,isError=false){$('notice').textContent=text;$('notice').hidden=!text;$('notice').classList.toggle('error',isError);}
async function api(url,options={}) {
  const response=await fetch(url,{credentials:'same-origin',...options,headers:{'Content-Type':'application/json',...options.headers}});
  let data;try{data=await response.json();}catch{throw new Error('Le serveur redémarre peut-être. Patientez puis réessayez.');}
  if(!response.ok){if(response.status===401&&url!='/api/login')showLogin();throw new Error(data.error||'Requête impossible.');}return data;
}
function showLogin(){user=null;$('workspace').hidden=true;$('loginPanel').hidden=false;$('logout').hidden=true;$('adminToggle').hidden=true;$('accountName').textContent='';}
function showApp(next){if(previousUserId && previousUserId!==next.id){$('generateForm').reset();result=null;$('results').hidden=true;$('adminPanel').hidden=true;$('users').replaceChildren();counts();}previousUserId=next.id;user=next;$('loginPanel').hidden=true;$('workspace').hidden=false;$('logout').hidden=false;$('adminToggle').hidden=user.role!=='admin';$('accountName').textContent=user.fullname||user.username;}
function freshness(){if(!result || !sourceSnapshot)return;$('resultFreshness').hidden=sourceSnapshot===JSON.stringify(formData());}
function counts(){freshness();$('cvCount').textContent=`${$('cv').value.length.toLocaleString('fr')} / 24 000`;$('offerCount').textContent=`${$('offer').value.length.toLocaleString('fr')} / 16 000`;}
function syncOutput(){if(result)result[selected]=$('output').value;}
function setTab(kind){syncOutput();selected=kind;$('cvTab').setAttribute('aria-selected',kind==='cv');$('letterTab').setAttribute('aria-selected',kind==='letter');$('output').value=result?.[kind]||'';}
function renderAudit(){
  $('keywords').replaceChildren();$('warnings').replaceChildren();
  for(const keyword of result.keywords||[]){const row=document.createElement('div');row.className='keyword';const term=document.createElement('strong');term.textContent=keyword.term;const proof=document.createElement('p');proof.textContent=keyword.sourceVerified?`Citation retrouvée dans le CV : « ${keyword.evidence} »`:'Aucune citation vérifiée dans le CV source. Ne pas ajouter cette compétence sans la posséder.';const status=document.createElement('small');status.textContent=keyword.inOutput?'Expression présente dans le CV généré.':'Expression absente du CV généré.';row.append(term,proof,status);$('keywords').append(row);}
  if(!result.keywords?.length)$('keywords').textContent='Aucune expression vérifiable renvoyée par l’IA.';
  for(const warning of result.warnings||[]){const li=document.createElement('li');li.textContent=warning;$('warnings').append(li);}
  if(!result.warnings?.length){const li=document.createElement('li');li.textContent='Relire les informations personnelles, les dates et toutes les formulations proposées.';$('warnings').append(li);}
}
function setResult(data){result=data;sourceSnapshot=JSON.stringify(formData());$('resultFreshness').hidden=true;selected='cv';$('output').value=result.cv;$('cvTab').setAttribute('aria-selected','true');$('letterTab').setAttribute('aria-selected','false');renderAudit();$('results').hidden=false;}
$('loginForm').addEventListener('submit',async e=>{e.preventDefault();const button=e.submitter;button.disabled=true;try{const data=await api('/api/login',{method:'POST',body:JSON.stringify({username:$('username').value,password:$('password').value})});$('password').value='';showApp(data.user);notice('');}catch(e){notice(e.message,true);}finally{button.disabled=false;}});
$('logout').addEventListener('click',async()=>{controller?.abort();try{await api('/api/logout',{method:'POST',body:'{}'});location.reload();}catch(e){notice(e.message,true);}});
for(const id of ['language','length','instructions'])$(id).addEventListener('input',freshness);
for(const id of ['cv','offer'])$(id).addEventListener('input',counts);
$('cvTab').onclick=()=>setTab('cv');$('letterTab').onclick=()=>setTab('letter');$('output').addEventListener('input',()=>{syncOutput();if(selected==='cv'){for(const keyword of result.keywords){keyword.inOutput=result.cv.toLowerCase().includes(keyword.term.toLowerCase());}renderAudit();}});
async function loadScript(src){return new Promise((resolve,reject)=>{const script=document.createElement('script');script.src=src;script.onload=resolve;script.onerror=()=>{script.remove();reject(new Error('Bibliothèque d’import indisponible. Réessayez.'));};document.head.append(script);});}
async function readCv(file){
  if(file.size>5*1024*1024)throw new Error('Fichier trop volumineux : maximum 5 Mo.');
  const extension=file.name.split('.').pop().toLowerCase();
  if(extension==='txt')return file.text();
  if(extension==='docx'){if(!window.mammoth)await loadScript('/vendor/mammoth.js');const value=await mammoth.extractRawText({arrayBuffer:await file.arrayBuffer()});return value.value;}
  if(extension==='pdf'){
    const pdfjs=await import('/vendor/pdf.mjs');pdfjs.GlobalWorkerOptions.workerSrc='/vendor/pdf.worker.mjs';
    const task=pdfjs.getDocument({data:new Uint8Array(await file.arrayBuffer()),isEvalSupported:false,useSystemFonts:true});
    try{const pdf=await task.promise;if(pdf.numPages>15)throw new Error('Maximum 15 pages. Importez uniquement votre CV.');let text='';for(let n=1;n<=pdf.numPages;n++){const page=await pdf.getPage(n),content=await page.getTextContent();let previousY=null;for(const item of content.items){if(!('str' in item))continue;const y=item.transform?.[5];if(previousY!==null&&Math.abs(y-previousY)>3)text+='\n';text+=item.str+(item.hasEOL?'\n':' ');previousY=y;}text+='\n\n';page.cleanup();if(text.length>24000)throw new Error('CV trop long : maximum 24 000 caractères.');}if(text.trim().length<80)throw new Error('Ce PDF contient trop peu de texte lisible. Faites une reconnaissance OCR ou collez le texte manuellement.');return text;}finally{await task.destroy();}
  }
  throw new Error('Formats acceptés : PDF texte, DOCX et TXT.');
}
$('cvFile').addEventListener('change',async()=>{const file=$('cvFile').files[0];if(!file||importing)return;importing=true;$('generate').disabled=true;$('fileStatus').textContent='Lecture du fichier…';try{const text=(await readCv(file)).trim();if(text.length>24000)throw new Error('CV trop long : maximum 24 000 caractères.');if(text.length<80)throw new Error('Texte insuffisant. Vérifiez le fichier ou collez le CV.');$('cv').value=text;counts();$('fileStatus').textContent=file.name+' · importé';notice('CV importé. Vérifiez l’ordre du texte, notamment si l’original comportait plusieurs colonnes.');}catch(e){notice(e.message,true);$('fileStatus').textContent='Import non effectué.';}finally{importing=false;$('generate').disabled=!!controller;$('cvFile').value='';}});
function formData(){return {cv:$('cv').value,offer:$('offer').value,instructions:$('instructions').value,language:$('language').value,length:$('length').value};}
$('generateForm').addEventListener('submit',async e=>{e.preventDefault();if(controller||importing)return;syncOutput();controller=new AbortController();$('generate').disabled=true;$('cancel').hidden=false;notice('Groq prépare le CV et la lettre. Cela peut prendre jusqu’à 90 secondes…');
try{const data=await api('/api/generate',{method:'POST',body:JSON.stringify(formData()),signal:controller.signal});setResult(data.result);notice('Documents prêts. Relisez et corrigez avant de les exporter.');$('results').scrollIntoView({behavior:'smooth',block:'start'});}catch(e){notice(e.name==='AbortError'?'Génération annulée. Vos textes ont été conservés.':e.message,e.name!=='AbortError');}finally{controller=null;$('generate').disabled=false;$('cancel').hidden=true;}});
$('cancel').onclick=()=>controller?.abort();
function download(blob,filename){const url=URL.createObjectURL(blob);const a=document.createElement('a');a.href=url;a.download=filename;a.click();setTimeout(()=>URL.revokeObjectURL(url),10000);}
$('exportTxt').onclick=()=>{syncOutput();download(new Blob([result[selected]],{type:'text/plain;charset=utf-8'}),`${selected==='cv'?'CV':'Lettre'}-candidature.txt`);};
$('exportDocx').onclick=async()=>{syncOutput();const button=$('exportDocx');button.disabled=true;try{const {makeDocx}=await exporter();download(await makeDocx(result[selected],selected),`${selected==='cv'?'CV':'Lettre'}-candidature.docx`);}catch(e){notice('Export Word impossible : '+e.message,true);}finally{button.disabled=false;}};
$('exportPdf').onclick=async()=>{
  syncOutput();const popup=window.open('about:blank','_blank');if(!popup){notice('Autorisez l’ouverture de la fenêtre d’impression pour exporter le PDF.',true);return;}
  try{const {classify}=await exporter();const doc=popup.document;doc.documentElement.lang=$('language').value;doc.title=selected==='cv'?'CV':'Lettre de motivation';const style=doc.createElement('link');style.rel='stylesheet';style.href=location.origin+'/print.css';const ready=new Promise(resolve=>{style.onload=resolve;style.onerror=resolve;});doc.head.append(style);const main=doc.createElement('main');
    result[selected].trim().split('\n').forEach((line,i)=>{const type=classify(line,i,selected);const node=doc.createElement(type==='title'?'h1':type==='heading'?'h2':'p');node.textContent=line||'\u00a0';if(type==='bullet')node.className='bullet';main.append(node);});doc.body.append(main);await ready;popup.focus();popup.print();
  }catch(e){popup.close();notice('Export PDF impossible : '+e.message,true);}
};
$('saveDraft').onclick=()=>{syncOutput();download(new Blob([JSON.stringify({version:1,input:formData(),result},null,2)],{type:'application/json'}),'candidature-brouillon.json');notice('Brouillon téléchargé sur votre appareil. Conservez-le dans un dossier privé.');};
$('draftFile').onchange=async()=>{const file=$('draftFile').files[0];if(!file)return;try{if(file.size>256*1024)throw new Error('Brouillon trop volumineux.');const draft=JSON.parse(await file.text());if(draft.version!==1||!draft.input)throw new Error('Format de brouillon invalide.');for(const [key,max] of [['cv',24000],['offer',16000],['instructions',2000]]){if(typeof draft.input[key]!=='string'||draft.input[key].length>max)throw new Error('Contenu du brouillon invalide.');}
  if(!['fr','en','es','de','it'].includes(draft.input.language)||!['concis','équilibré','détaillé'].includes(draft.input.length))throw new Error('Options invalides.');
  let importedResult=null;if(draft.result){if(typeof draft.result.cv!=='string'||typeof draft.result.letter!=='string'||draft.result.cv.length>30000||draft.result.letter.length>30000)throw new Error('Documents du brouillon invalides.');importedResult={cv:draft.result.cv,letter:draft.result.letter,keywords:[],warnings:['Documents restaurés depuis un fichier local. Vérifiez les faits et la correspondance avec le CV source.']};}
  for(const key of ['cv','offer','instructions','language','length'])$(key).value=draft.input[key];counts();result=null;$('results').hidden=true;if(importedResult)setResult(importedResult);notice('Brouillon restauré.');
}catch(e){notice(e.message,true);}finally{$('draftFile').value='';}};
$('adminToggle').onclick=()=>{$('adminPanel').hidden=!$('adminPanel').hidden;if(!$('adminPanel').hidden){loadUsers();$('adminPanel').scrollIntoView({behavior:'smooth'});}};
$('refreshUsers').onclick=loadUsers;
async function loadUsers(){try{const [data,metrics]=await Promise.all([api('/api/admin/users'),api('/api/admin/metrics')]);$('metrics').textContent=`Mémoire serveur : ${metrics.rssMB} Mo · Générations en cours : ${metrics.activeGenerations}/${metrics.maxAI} · Comptes : ${metrics.storage}`;$('users').replaceChildren();
for(const item of data.users){const row=document.createElement('div');row.className='user-row';const title=document.createElement('strong');title.textContent=`${item.username} · ${item.fullname} · ${item.status==='active'?'Actif':'Suspendu'}`;row.append(title);if(item.role!=='admin'){
const action=(label,fn)=>{const b=document.createElement('button');b.textContent=label;b.onclick=async()=>{b.disabled=true;try{await fn();await loadUsers();}catch(e){notice(e.message,true);}finally{b.disabled=false;}};row.append(b);};
const update=payload=>api('/api/admin/users/'+item.id,{method:'PATCH',body:JSON.stringify(payload)});
action(item.status==='active'?'Suspendre':'Réactiver',()=>update({op:item.status==='active'?'pause':'resume'}));
const expiry=document.createElement('input');expiry.type='date';expiry.value=item.expires_at||'';expiry.setAttribute('aria-label','Expiration du compte '+item.username);row.append(expiry);action('Fixer l’expiration',()=>update({op:'expiry',date:expiry.value}));
action('Nouveau mot de passe',async()=>{const password=prompt('Nouveau mot de passe pour '+item.username+' (12 caractères minimum)');if(password!==null)await update({op:'password',password});});
action('Supprimer',async()=>{if(confirm('Supprimer définitivement le compte '+item.username+' ?'))await api('/api/admin/users/'+item.id,{method:'DELETE',body:'{}'});});
}else{const label=document.createElement('span');label.textContent='Administrateur · configuration serveur';row.append(label);}$('users').append(row);}
}catch(e){notice(e.message,true);}}
$('userForm').onsubmit=async e=>{e.preventDefault();const button=e.submitter;button.disabled=true;try{await api('/api/admin/users',{method:'POST',body:JSON.stringify({username:$('newName').value,fullname:$('newFullname').value,password:$('newPassword').value})});$('userForm').reset();await loadUsers();notice('Compte créé. Communiquez les identifiants au destinataire par un canal privé.');}catch(e){notice(e.message,true);}finally{button.disabled=false;}};
api('/api/me').then(data=>{showApp(data.user);if(!data.configured)notice('GROQ_API_KEY doit être configurée sur le serveur avant de générer.',true);}).catch(()=>showLogin());



