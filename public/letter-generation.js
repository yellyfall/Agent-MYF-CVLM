/* Explicit letter length and tone contract, with one bounded corrective pass. */
(function(){
'use strict';
const profiles={
 concise:{label:'Concise',min:150,max:220,paragraphs:[3,3],detail:'Three focused paragraphs: motivation for this exact role; strongest relevant evidence; contribution and invitation to discuss. About 50–70 words per paragraph. Remove secondary examples.'},
 standard:{label:'Standard',min:300,max:400,paragraphs:[4,5],detail:'Four or five developed paragraphs: targeted opening; relevant experience with evidence; skills applied to the advertised responsibilities; employer-specific motivation and contribution. About 65–90 words per paragraph.'},
 detailed:{label:'Détaillée',min:550,max:700,paragraphs:[6,7],detail:'Six or seven substantial paragraphs, generally 80–110 words each. Develop distinct relevant experiences and responsibilities. Each evidence paragraph must explain the context, the candidate’s actual actions or methods, the supported outcome or learning, and its relevance to this role. Discuss employer-specific motivation and a realistic contribution. Expand reasoning and links to the offer, not repetition, filler or fabricated achievements.'}
};
const tones={
 'professionnel':'Use precise, measured professional language, clear transitions and credible claims. Avoid pompous formulas.',
 'dynamique':'Use active verbs, direct sentence openings and varied rhythm. Express initiative through supported actions, not exclamation marks.',
 'académique':'Build a structured argument with careful terminology and connections between training, analytical methods and the role.',
 'enthousiaste':'Express specific enthusiasm for the actual missions and employer, linking each motivation to a concrete reason. Avoid generic praise.',
 'sobre et direct':'Prefer plain vocabulary and direct sentences. Remove flattery and ornamental introductions. Maintain the requested total length by adding relevant substance.',
 'recherche scientifique':'Discuss research questions, methods, rigor and critical reasoning only where supported by the candidate’s background. Never invent publications or results.',
 'startup / innovant':'Emphasize experimentation, initiative, adaptability and useful innovation through actual projects. Avoid buzzwords.',
 'convaincant':'Connect each important claim to evidence from the CV and then to a benefit for the employer. Build a persuasive argument without exaggeration.',
 'humain et naturel':'Use a natural first-person voice, concrete motivations and varied sentences. Avoid stock cover-letter formulas and robotic lists.',
 'technique':'Explain relevant tools, methods, constraints and implementation choices from the CV, and how they apply to the job. Never add unverified expertise.',
 'commercial':'Frame supported experience around client needs, service, negotiation or value delivered when relevant. Never invent sales figures.',
 'institutionnel':'Use measured formal wording, respect for the organization’s missions and attention to collective responsibility. Avoid overfamiliarity.',
 'assertif mais respectueux':'State supported strengths and proposed contributions confidently, without apologetic wording, arrogance or demands.'
};
window.myfLetterProfile=function(value){const s=String(value).toLowerCase();return s.includes('concise')?profiles.concise:s.includes('détaillée')?profiles.detailed:profiles.standard;};
window.myfLetterInstructions=function(length,selected){const p=myfLetterProfile(length);return '\nMANDATORY BODY LENGTH: '+p.min+'–'+p.max+' words, in '+p.paragraphs.join('–')+' paragraphs separated by \\n\\n. Count only body, excluding addresses, subject, salutation, closing and signature.\n'+p.detail+'\nSELECTED STYLE DIRECTIONS:\n'+String(selected).split(',').map(t=>t.trim().toLowerCase()).filter(Boolean).map(t=>'- '+t+': '+(tones[t]||'Apply this requested style consistently.')).join('\n')+'\nBlend all selected tones across every paragraph. Professional remains the baseline, not a reason to ignore the other styles. Style must not override the requested length. Preserve truthfulness: use only supplied facts, no invented numbers, responsibilities or achievements. If source material is limited, explain relevant connections without inventing evidence. Before returning JSON, check body word count, paragraph count and application of every selected tone.\n';};
window.myfLetterMeasure=function(body,length){const p=myfLetterProfile(length),text=String(body||'').trim();const words=(text.match(/[\p{L}\p{N}]+(?:[’'\-][\p{L}\p{N}]+)*/gu)||[]).length;const paragraphs=text?text.split(/\n\s*\n/).filter(s=>s.trim()).length:0;return {words,paragraphs,ok:words>=p.min&&words<=p.max&&paragraphs>=p.paragraphs[0]&&paragraphs<=p.paragraphs[1],profile:p};};
window.myfLetterQualityNote=function(message){let el=document.getElementById('letterQualityNote');if(!el){el=document.createElement('div');el.id='letterQualityNote';el.className='hint';el.setAttribute('role','status');document.getElementById('letterRender').before(el);}el.textContent=message||'';el.style.display=message?'block':'none';};
window.myfGenerateLetter=async function(system,user,model,onChunk,length,selected){
 myfLetterQualityNote('');const contract=myfLetterInstructions(length,selected);
 let raw=await streamCall(system+contract,user,model,onChunk);
 const parse=text=>normalizeGeneratedLetter(text,extractJsonObject(text));
 const first=parse(raw);if(!first||!first.body)return raw;
 const measurement=myfLetterMeasure(first.body,length);if(measurement.ok)return raw;
 // One corrective request at most. Keep the completed first result if the provider refuses.
 try{
  const revised=await streamCall(system+contract,user+'\nREVISION REQUIRED: The previous draft had '+measurement.words+' body words and '+measurement.paragraphs+' paragraphs. Rewrite to meet the body length and selected styles. Keep all factual information unchanged. Return the complete JSON object. Previous draft:\n'+JSON.stringify(first),model,function(){});
  const next=parse(revised);
  if(next&&next.body){const m=myfLetterMeasure(next.body,length);if(m.ok){const result=JSON.stringify({...first,body:next.body});onChunk(result);return result;}}
 }catch(error){console.warn('Letter length revision unavailable; completed draft preserved.');}
 myfLetterQualityNote('Lettre conservée : '+measurement.words+' mots dans le corps et '+measurement.paragraphs+' paragraphes. Le format demandé ('+measurement.profile.min+'–'+measurement.profile.max+' mots, '+measurement.profile.paragraphs.join('–')+' paragraphes) n’a pas pu être obtenu après une tentative de correction.');
 onChunk(raw);return raw;
};
})();
