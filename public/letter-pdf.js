/* Shared serif fonts and justified, selectable Unicode text. No AI call during export. */
(function(){
  'use strict';
  let fontPromise;
  async function fontData(){
    if(!fontPromise)fontPromise=Promise.all(['Regular','Bold','Italic'].map(async style=>{
      const response=await fetch('/vendor/letter-'+style+'.ttf');
      if(!response.ok)throw new Error('Police PDF introuvable. Vérifiez le dossier public/vendor.');
      const bytes=new Uint8Array(await response.arrayBuffer());let binary='';
      for(let i=0;i<bytes.length;i+=8192)binary+=String.fromCharCode.apply(null,bytes.subarray(i,i+8192));
      return btoa(binary);
    })).catch(error=>{fontPromise=null;throw error;});
    return fontPromise;
  }
  function clean(value){return String(value||'').normalize('NFC').replace(/[\u00a0\u202f]/g,' ').replace(/[\u200b\ufeff]/g,'').replace(/\r\n?/g,'\n').replace(/[ \t]+/g,' ').trim();}
  window.buildLetterPdf=async function(data){
    const JsPDF=await ensureJsPdfDirect(),fonts=await fontData();
    const doc=new JsPDF({orientation:'portrait',unit:'mm',format:'a4',putOnlyUsedFonts:true,compress:true});
    for(const [i,style]of ['normal','bold','italic'].entries()){
      const name='MYFLetter-'+style+'.ttf';doc.addFileToVFS(name,fonts[i]);doc.addFont(name,'MYFLetter',style);
    }
    const j=Object.fromEntries(Object.entries(data).map(([key,value])=>[key,clean(value)]));
    doc.setProperties({title:'Lettre de motivation',subject:j.subject,creator:'MYF'});
    const left=20,right=190,width=170,top=23,bottom=276,lineH=6,gap=7;
    let y=top;
    function font(style='normal',size=11){doc.setFont('MYFLetter',style);doc.setFontSize(size);doc.setTextColor(26,26,26);}
    function lines(text,w=width,style='normal'){font(style);return text?doc.splitTextToSize(text,w):[];}
    function newPage(){doc.addPage();y=top;}
    function ensure(h){if(y+h>bottom)newPage();}
    function block(text,style='normal',align='left',after=0){
      const rows=lines(text,width,style);font(style);
      for(const row of rows){ensure(lineH);doc.text(row,align==='right'?right:left,y,{align});y+=lineH;}
      y+=after;
    }
    function header(fields,x,align){let yy=top;
      for(const [text,style] of fields){for(const row of lines(text,78,style)){font(style);doc.text(row,x,yy,{align});yy+=lineH;}}
      return yy;
    }
    const sender=header([[j.sender_name,'bold'],...[j.sender_address,j.sender_phone,j.sender_email].filter(Boolean).map(t=>[t,'normal'])],left,'left');
    const recipient=header([[j.recipient_company,'bold'],...[[j.recipient_name,j.recipient_title].filter(Boolean).join(', '),j.recipient_address].filter(Boolean).map(t=>[t,'normal'])],right,'right');
    y=recipient+6;
    block([j.city,j.date].filter(Boolean).join(', '),'normal','right');
    y=Math.max(y,sender)+10;
    // Subject retains the preview's bold label and italic content, including wrapping.
    if(j.subject){
      let x=left;font('bold');doc.text('Objet : ',x,y);x+=doc.getTextWidth('Objet : ');font('italic');
      const space=doc.getTextWidth(' ');
      for(const word of j.subject.split(/\s+/)){
        const parts=doc.splitTextToSize(word,width);
        for(const part of parts){const w=doc.getTextWidth(part);if(x+w>right+0.01){y+=lineH;x=left;}doc.text(part,x,y);x+=w+space;}
      }
      y+=5;doc.setDrawColor(225,225,225);doc.setLineWidth(0.3);doc.line(left,y,right,y);y+=11;
    }
    block(j.salutation,'normal','left',5);
    // Same blank-line paragraph boundary as renderLetter. Explicit line breaks stay explicit.
    const paragraphs=j.body.split(/\n[ \t]*\n+/).map(clean).filter(Boolean).map(p=>p.split('\n').flatMap(part=>{
      const rows=lines(part);return rows.map((text,i)=>({text,justify:i<rows.length-1}));
    }));
    const endingHeight=(lines(j.closing).length+lines(j.signature||j.sender_name,width,'bold').length)*lineH+12;
    function justified(row){
      font();const words=row.text.trim().split(/\s+/);
      if(!row.justify||words.length<2){doc.text(row.text,left,y);return;}
      // Embedded font advances are also used for measuring: accents never change spacing.
      const widths=words.map(word=>doc.getTextWidth(word));
      const spacing=(width-widths.reduce((sum,w)=>sum+w,0))/(words.length-1);
      let x=left;words.forEach((word,i)=>{doc.text(word,x,y);x+=widths[i]+spacing;});
    }
    paragraphs.forEach((rows,index)=>{
      const height=rows.length*lineH;
      const last=index===paragraphs.length-1;
      // Keep normal paragraphs whole, but allow oversized paragraphs to flow safely.
      if(last&&height+gap+endingHeight<=bottom-top)ensure(height+gap+endingHeight);
      else if(height<=bottom-top)ensure(height);
      else ensure(2*lineH);
      rows.forEach((row,i)=>{
        if(rows.length-i===2)ensure(2*lineH);else ensure(lineH);
        justified(row);y+=lineH;
      });y+=gap;
    });
    ensure(endingHeight);block(j.closing,'normal','left',12);block(j.signature||j.sender_name,'bold','right');
    return doc;
  };
  window.dlLetterPdf=async function(){
    const j=typeof LAST_LETTER_JSON!=='undefined'&&LAST_LETTER_JSON?{...LAST_LETTER_JSON}:v36LetterData();
    if(!j||!clean(j.body)){alert('Générez une lettre avant de télécharger le PDF.');return;}
    try{const doc=await buildLetterPdf(j);doc.save('lettre_motivation.pdf');}
    catch(error){console.error('Export lettre',error);alert('Export PDF impossible : '+error.message);}
  };
})();
