/* Event bindings for the original interface, compatible with script-src 'self'. No eval. */
(function(){
 'use strict';
 const allowed=new Set('analyzeRecruiterMatch backToIface chatSuggest clearChat clearChatFile clearCV clearOf clearRecCV clearRecOffer closeModal cpLmText cpText createUser delUser dlCVPdf dlDoc dlLetterDoc dlLetterPdf dlTxt generateAll genPw loadUsers loginAdmin loginUser logout openModal resetPw selectInterface sendChat setExp setTheme switchCVView switchLetterView switchLTab switchRecOfferTab switchRTab switchTab tChip toggleWeb tpw updUser loadChatFile updateModelHelp uploadCV uploadOf uploadRecCV uploadRecOffer autoGrow updPipeline chatKey'.split(' '));
 function args(text,element,event){
  const values=[];let rest=text.trim();
  while(rest){const m=/^(?:'((?:\\.|[^'\\])*)'|"((?:\\.|[^"\\])*)"|(this|event|true|false|null|-?\d+(?:\.\d+)?))\s*(,|$)/.exec(rest);if(!m)throw new Error('Invalid interface action arguments');
   if(m[1]!==undefined||m[2]!==undefined)values.push((m[1]??m[2]).replace(/\\([\\'"nrt])/g,(_,v)=>({n:'\n',r:'\r',t:'\t'}[v]??v)));
   else values.push(m[3]==='this'?element:m[3]==='event'?event:m[3]==='true'?true:m[3]==='false'?false:m[3]==='null'?null:Number(m[3]));
   rest=rest.slice(m[0].length).trim();
  }return values;
 }
 for(const type of ['click','change','input','keydown'])document.addEventListener(type,function(event){
  const element=event.target.closest?.('[data-myf-'+type+']');if(!element||element.disabled)return;
  const action=element.getAttribute('data-myf-'+type);
  if(type==='input'&&element.id==='recThreshold'){document.getElementById('recThresholdVal').textContent=element.value+'%';updateRecContactPanel();return;}
  const m=/^([A-Za-z_$][\w$]*)\(([\s\S]*)\);?$/.exec(action||'');
  if(!m||!allowed.has(m[1])||typeof window[m[1]]!=='function'){console.error('Unknown interface action',action);return;}
  try{const result=window[m[1]].apply(element,args(m[2],element,event));if(result&&typeof result.catch==='function')result.catch(error=>console.error('Interface action failed',error));}catch(error){console.error('Interface action failed',error);}
 });
})();
