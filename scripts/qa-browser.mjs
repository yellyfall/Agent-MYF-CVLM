import {createRequire} from 'node:module';
import {writeFile,mkdtemp,rm,mkdir} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import {createApplication} from '../server.js';
const require=createRequire(import.meta.url);
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const sampleCV=`Alice Martin
Ingénieure études photovoltaïques
Lyon | alice.martin@example.com | 06 12 34 56 78

Profil
Ingénieure spécialisée en dimensionnement photovoltaïque et en études de production. Expérience de la coordination technique de projets solaires.

Expérience professionnelle
Ingénieure études | Soleil SAS | Lyon
Septembre 2022 - août 2025
- Dimensionnement photovoltaïque avec PVsyst.
- Analyse des contraintes techniques et préparation des dossiers d’études.
- Coordination des échanges avec les équipes de chantier.

Formation
Université de Lyon | 2020 - 2022
Master Énergie

Compétences
PVsyst, dimensionnement photovoltaïque, études de production

Langues
Français : langue maternelle
Anglais : B2`;
const sampleLetter=`Alice Martin
Lyon | alice.martin@example.com | 06 12 34 56 78

Soleil Conseil
Lyon, le 8 septembre 2026

Objet : candidature au poste d’ingénieure études photovoltaïques

Madame, Monsieur,

Votre recherche d’une ingénieure chargée du dimensionnement photovoltaïque correspond à mon expérience chez Soleil SAS. Je souhaite mettre mes compétences en études de production au service de vos projets.

De septembre 2022 à août 2025, j’ai réalisé des dimensionnements avec PVsyst et préparé les dossiers d’études associés. La coordination avec les équipes de chantier m’a appris à prendre en compte les contraintes de mise en œuvre dès la conception.

Titulaire d’un master Énergie de l’Université de Lyon, je souhaite échanger avec vous sur les besoins de Soleil Conseil et sur ma contribution à vos études photovoltaïques.

Je vous prie d’agréer, Madame, Monsieur, mes salutations distinguées.

Alice Martin`;
const offer='Soleil Conseil recherche une ingénieure études photovoltaïques. Les missions comprennent le dimensionnement photovoltaïque, les études de production et la coordination de projets. Compétences demandées : PVsyst et AutoCAD.';
const fixture={cv:sampleCV,letter:sampleLetter,keywords:[{term:'PVsyst',evidence:'Dimensionnement photovoltaïque avec PVsyst.'},{term:'AutoCAD',evidence:''}],warnings:['AutoCAD n’est pas attesté par le CV source. Ne pas l’ajouter sans validation.']};
await mkdir('qa',{recursive:true});
const temp=await mkdtemp(path.join(os.tmpdir(),'myf-browser-'));
const env={APP_SECRET:'q'.repeat(64),ADMIN_PASSWORD:'demo-test-password',DATA_DIR:temp,GROQ_API_KEY:'test-not-a-real-key'};
const app=await createApplication(env,async()=>new Response(JSON.stringify({choices:[{finish_reason:'stop',message:{content:JSON.stringify(fixture)}}]})));
await new Promise(r=>app.server.listen(0,'127.0.0.1',r));const origin=`http://127.0.0.1:${app.server.address().port}`;
const browser=await chromium.launch({...(process.env.CHROME_PATH?{executablePath:process.env.CHROME_PATH}:{}),headless:true});
const context=await browser.newContext({viewport:{width:1440,height:1100}});const page=await context.newPage();
const errors=[];page.on('pageerror',e=>errors.push(e.message));
try {
 await page.goto(origin);await page.locator('#username').fill('admin');await page.locator('#password').fill(env.ADMIN_PASSWORD);await page.locator('#loginForm button').click();await page.locator('#workspace').waitFor({state:'visible'});
 await page.locator('#cv').fill(sampleCV);await page.locator('#offer').fill(offer);await page.locator('#consent').check();
 await page.screenshot({path:'qa/interface-desktop.png',fullPage:true});
 await page.locator('#generate').click();await page.locator('#results').waitFor({state:'visible'});assert.equal(await page.locator('#output').inputValue(),sampleCV);
 await page.screenshot({path:'qa/resultats-desktop.png',fullPage:true});
 const downloadPromise=page.waitForEvent('download');await page.locator('#exportDocx').click();const download=await downloadPromise;await download.saveAs('qa/cv-test.docx');
 const popupPromise=context.waitForEvent('page');await page.locator('#exportPdf').click();const popup=await popupPromise;await popup.waitForSelector('main p');await popup.waitForTimeout(300);await popup.pdf({path:'qa/cv-test.pdf',preferCSSPageSize:true,printBackground:true});await popup.close();
 await page.locator('#letterTab').click();assert.equal(await page.locator('#output').inputValue(),sampleLetter);
 const letterPromise=context.waitForEvent('page');await page.locator('#exportPdf').click();const letter=await letterPromise;await letter.waitForSelector('main p');await letter.waitForTimeout(300);await letter.pdf({path:'qa/lettre-test.pdf',preferCSSPageSize:true});await letter.close();
 await page.locator('#cvFile').setInputFiles('qa/cv-test.pdf');await page.waitForFunction(()=>document.querySelector('#fileStatus').textContent.includes('importé'));assert((await page.locator('#cv').inputValue()).includes('alice.martin@example.com'));
 await page.locator('#cvFile').setInputFiles('qa/cv-test.docx');await page.waitForFunction(()=>document.querySelector('#fileStatus').textContent.includes('cv-test.docx'));assert((await page.locator('#cv').inputValue()).includes('PVsyst'));
 const draftPromise=page.waitForEvent('download');await page.locator('#saveDraft').click();await (await draftPromise).saveAs('qa/brouillon-test.json');await page.locator('#cv').fill('');await page.locator('#draftFile').setInputFiles('qa/brouillon-test.json');await page.waitForFunction(()=>document.querySelector('#cv').value.includes('Alice Martin'));
 await page.locator('#adminToggle').click();await page.locator('#newName').fill('testeur');await page.locator('#newFullname').fill('Compte de test');await page.locator('#newPassword').fill('testeur-password-long');await page.locator('#userForm button').click();await page.getByText('testeur · Compte de test · Actif').waitFor();
 await page.setViewportSize({width:390,height:844});await page.locator('#adminToggle').click();await page.screenshot({path:'qa/interface-mobile.png',fullPage:true});assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
 assert.deepEqual(errors,[]);
 const metric=await page.evaluate(async()=>fetch('/api/admin/metrics').then(r=>r.json()));await writeFile('qa/browser-report.json',JSON.stringify({passed:true,checks:['login','generation mocked','Word download','PDF text rendering','PDF import','DOCX import','local draft roundtrip','account creation','responsive no overflow','no JS exceptions'],metrics:metric},null,2));
 console.log('Parcours navigateur complet : OK',JSON.stringify(metric));
}finally{await browser.close();await app.close();await rm(temp,{recursive:true,force:true});}



