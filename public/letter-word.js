/* Genuine DOCX with the same licensed, embedded serif fonts as preview/PDF. */
(function(){
'use strict';
const W='http://schemas.openxmlformats.org/wordprocessingml/2006/main',R='http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const esc=s=>String(s||'').replace(/[^\u0009\u000A\u000D\u0020-\uFFFF]/g,'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&apos;'}[c]));
const xml=s=>'<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'+s;
function run(text,style=''){return '<w:r><w:rPr><w:rFonts w:ascii="Gelasio" w:hAnsi="Gelasio" w:eastAsia="Gelasio" w:cs="Gelasio"/><w:sz w:val="22"/><w:szCs w:val="22"/>'+style+'</w:rPr>'+String(text||'').split(/\r?\n/).map((s,i)=>(i?'<w:br/>':'')+'<w:t xml:space="preserve">'+esc(s)+'</w:t>').join('')+'</w:r>';}
function para(content,align='left',after=0,extra=''){return '<w:p><w:pPr>'+(extra.includes('<w:keepNext/>')?'<w:keepNext/>':'')+'<w:keepLines/><w:widowControl/>'+extra.replace('<w:keepNext/>','')+'<w:spacing w:after="'+after+'" w:line="340" w:lineRule="exact"/><w:jc w:val="'+align+'"/></w:pPr>'+content+'</w:p>';}
window.buildLetterDocx=async function(j){
 const zip=new JSZip();const relationships=items=>xml('<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'+items.map(([id,type,target])=>'<Relationship Id="'+id+'" Type="'+R+'/'+type+'" Target="'+target+'"/>').join('')+'</Relationships>');
 let embedded='';const fontRels=[];
 for(const style of ['Regular','Bold','Italic']){
  const response=await fetch('/vendor/letter-'+style+'.ttf');if(!response.ok)throw Error('Police Word introuvable : '+style);
  const bytes=new Uint8Array(await response.arrayBuffer());
  const guid=crypto.randomUUID().toUpperCase(),key=guid.replace(/-/g,'').match(/../g).map(h=>parseInt(h,16)).reverse();
  for(let i=0;i<32;i++)bytes[i]^=key[i%16];
  zip.file('word/fonts/'+style+'.odttf',bytes);
  embedded+='<w:embed'+style+' r:id="font'+style+'" w:fontKey="{'+guid+'}" w:subsetted="false"/>';
  fontRels.push(['font'+style,'font','fonts/'+style+'.odttf']);
 }
 zip.file('word/fontTable.xml',xml('<w:fonts xmlns:w="'+W+'" xmlns:r="'+R+'"><w:font w:name="Gelasio"><w:family w:val="roman"/><w:pitch w:val="variable"/>'+embedded+'</w:font></w:fonts>'));
 zip.file('word/_rels/fontTable.xml.rels',relationships(fontRels));
 const header=(fields,align)=>fields.filter(([t])=>t).map(([t,bold])=>para(run(t,bold?'<w:b/>':''),align)).join('');
 const sender=header([[j.sender_name,true],[j.sender_address],[j.sender_phone],[j.sender_email]],'left');
 const recipient=header([[j.recipient_company,true],[[j.recipient_name,j.recipient_title].filter(Boolean).join(', ')],[j.recipient_address]],'right');
 const cell=content=>'<w:tc><w:tcPr><w:tcW w:w="4819" w:type="dxa"/><w:vAlign w:val="top"/></w:tcPr>'+content+'</w:tc>';
 let body='<w:tbl><w:tblPr><w:tblW w:w="9638" w:type="dxa"/><w:tblLayout w:type="fixed"/><w:tblCellMar><w:top w:w="0" w:type="dxa"/><w:left w:w="0" w:type="dxa"/><w:bottom w:w="0" w:type="dxa"/><w:right w:w="0" w:type="dxa"/></w:tblCellMar></w:tblPr><w:tblGrid><w:gridCol w:w="4819"/><w:gridCol w:w="4819"/></w:tblGrid><w:tr><w:trPr><w:cantSplit/></w:trPr>'+cell(sender||para(run('')))+cell(recipient||para(run('')))+'</w:tr></w:tbl>';
 body+=para(run([j.city,j.date].filter(Boolean).join(', ')),'right',567);
 body+=para(run('Objet : ','<w:b/>')+run(j.subject,'<w:i/>'),'left',567,'<w:keepNext/><w:pBdr><w:bottom w:val="single" w:sz="4" w:space="8" w:color="E1E1E1"/></w:pBdr>');
 body+=para(run(j.salutation),'left',283,'<w:keepNext/>');
 const paragraphs=String(j.body||'').replace(/\r\n?/g,'\n').split(/\n[ \t]*\n+/).filter(s=>s.trim());
 paragraphs.forEach((p,i)=>{body+=para(run(p.trim()),'both',397,i===paragraphs.length-1?'<w:keepNext/>':'');});
 body+=para(run(j.closing),'left',680,'<w:keepNext/>');
 body+=para(run(j.signature||j.sender_name,'<w:b/>'),'right');
 body+='<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1304" w:right="1134" w:bottom="1191" w:left="1134" w:header="0" w:footer="0" w:gutter="0"/></w:sectPr>';
 zip.file('word/document.xml',xml('<w:document xmlns:w="'+W+'" xmlns:r="'+R+'"><w:body>'+body+'</w:body></w:document>'));
 zip.file('word/styles.xml',xml('<w:styles xmlns:w="'+W+'"><w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Gelasio" w:hAnsi="Gelasio" w:eastAsia="Gelasio" w:cs="Gelasio"/><w:sz w:val="22"/><w:szCs w:val="22"/></w:rPr></w:rPrDefault></w:docDefaults><w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/></w:style></w:styles>'));
 zip.file('word/settings.xml',xml('<w:settings xmlns:w="'+W+'"><w:embedTrueTypeFonts/><w:embedSystemFonts/><w:doNotAutoHyphenateCaps/></w:settings>'));
 zip.file('_rels/.rels',relationships([['rId1','officeDocument','word/document.xml']]));
 zip.file('word/_rels/document.xml.rels',relationships([['rId1','styles','styles.xml'],['rId2','fontTable','fontTable.xml'],['rId3','settings','settings.xml']]));
 zip.file('[Content_Types].xml',xml('<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Default Extension="odttf" ContentType="application/vnd.openxmlformats-officedocument.obfuscatedFont"/>'+[['document','document.main'],['styles','styles'],['settings','settings'],['fontTable','fontTable']].map(([name,type])=>'<Override PartName="/word/'+name+'.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.'+type+'+xml"/>').join('')+'</Types>'));
 return zip.generateAsync({type:'blob',mimeType:'application/vnd.openxmlformats-officedocument.wordprocessingml.document',compression:'DEFLATE'});
};
window.dlLetterDoc=async function(){
 const j=typeof LAST_LETTER_JSON!=='undefined'&&LAST_LETTER_JSON?{...LAST_LETTER_JSON}:v36LetterData();
 if(!j||!String(j.body||'').trim()){alert('Générez une lettre avant de télécharger le document Word.');return;}
 try{const blob=await buildLetterDocx(j),url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download='lettre_motivation.docx';a.click();setTimeout(()=>URL.revokeObjectURL(url),60000);}
 catch(error){console.error('Export Word',error);alert('Export Word impossible : '+error.message);}
};
})();
