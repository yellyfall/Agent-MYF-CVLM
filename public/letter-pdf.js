/* Letter PDF: embedded Unicode fonts, stable line metrics and grouped closing. */
(function(){
  'use strict';
  let fontPromise;
  async function fontData(){
    if(!fontPromise)fontPromise=Promise.all(['/vendor/font-a699af1dea30.woff2','/vendor/font-87e867b52640.woff2'].map(async url=>{
      const response=await fetch(url);if(!response.ok)throw new Error('Police PDF introuvable. Vérifiez le dossier public/vendor.');
      const bytes=new Uint8Array(await response.arrayBuffer());let binary='';for(let i=0;i<bytes.length;i+=8192)binary+=String.fromCharCode.apply(null,bytes.subarray(i,i+8192));return btoa(binary);
    })).catch(error=>{fontPromise=null;throw error;});
    return fontPromise;
  }
  function clean(value){return String(value||'').normalize('NFC').replace(/[\u00a0\u202f]/g,' ').replace(/[\u2010-\u2015\u2212]/g,'-').replace(/[\u200b\ufeff]/g,'').replace(/\r\n?/g,'\n').replace(/[ \t]+/g,' ').trim();}
  window.buildLetterPdf=async function(data){
    const JsPDF=await ensureJsPdfDirect(),fonts=await fontData();
    const doc=new JsPDF({orientation:'portrait',unit:'mm',format:'a4',putOnlyUsedFonts:true,compress:true});
    for(const [i,style]of ['normal','bold'].entries()){const name='InterLetter-'+style+'.ttf';doc.addFileToVFS(name,fonts[i]);doc.addFont(name,'InterLetter',style);}
    doc.setProperties({title:'Lettre de motivation',subject:clean(data.subject),creator:'MYF'});
    const j=Object.fromEntries(Object.entries(data).map(([key,value])=>[key,clean(value)]));
    const left=20,right=190,width=170,top=24,bottom=277;
    function font(size=11,style='normal'){doc.setFont('InterLetter',style);doc.setFontSize(size);doc.setTextColor(25,25,25);}
    function lines(text,w=width,size=11,style='normal'){font(size,style);return text?doc.splitTextToSize(text,w):[];}
    function headerRows(fields,w){return fields.flatMap(f=>lines(f.text,w,f.size,f.style).map(text=>({...f,text})));}
    const sender=headerRows([{text:j.sender_name,size:12,style:'bold'},...[j.sender_address,j.sender_phone,j.sender_email].filter(Boolean).map(text=>({text,size:9.5,style:'normal'}))],82);
    const recipient=headerRows([{text:j.recipient_company,size:10.5,style:'bold'},...[j.recipient_name,j.recipient_title,j.recipient_address].filter(Boolean).map(text=>({text,size:10,style:'normal'}))],76);
    function drawHeader(rows,x){let yy=top;for(const row of rows){font(row.size,row.style);doc.text(row.text,x,yy);yy+=row.size===12?5.5:4.25;}return yy;}
    let y=Math.max(drawHeader(sender,left),drawHeader(recipient,114))+5;
    const date=[j.city,j.date].filter(Boolean).join(', ');
    if(date){font(10);for(const line of lines(date,width,10)){doc.text(line,right,y,{align:'right'});y+=4.4;}y+=5;}else y+=5;
    const subject=lines(j.subject?'Objet : '+j.subject:'',width,11,'bold');
    const salutation=lines(j.salutation);
    const paragraphs=j.body.split(/\n\s*\n/).map(p=>clean(p.replace(/\n/g,' '))).filter(Boolean).map(p=>lines(p));
    const closing=lines(j.closing),signature=lines(j.signature||j.sender_name,width,11,'bold');
    let lineH=4.7,gap=3.3;
    const estimate=()=>y+subject.length*lineH+5+salutation.length*lineH+4+paragraphs.reduce((sum,p)=>sum+p.length*lineH+gap,0)+closing.length*lineH+6+signature.length*lineH;
    if(estimate()>bottom){lineH=4.5;gap=2.5;}
    function newPage(){doc.addPage();y=top;}
    function ensure(height){if(y+height>bottom)newPage();}
    function write(block,size=11,style='normal',after=0){font(size,style);for(const line of block){ensure(lineH);doc.text(line,left,y);y+=lineH;}y+=after;}
    ensure(subject.length*lineH+salutation.length*lineH+12);write(subject,11,'bold',5);write(salutation,11,'normal',4);
    const endingHeight=(closing.length+signature.length)*lineH+6;
    paragraphs.forEach((paragraph,index)=>{
      const last=index===paragraphs.length-1;
      if(last&&paragraph.length*lineH+gap+endingHeight<bottom-top)ensure(paragraph.length*lineH+gap+endingHeight);
      else ensure(Math.min(2,paragraph.length)*lineH);
      font();
      paragraph.forEach((line,i)=>{
        if(last&&paragraph.length-i<=2)ensure((paragraph.length-i)*lineH+gap+endingHeight);
        else ensure(lineH);
        doc.text(line,left,y);y+=lineH;
      });y+=gap;
    });
    ensure(endingHeight);write(closing,11,'normal',6);write(signature,11,'bold');
    return doc;
  };
  window.dlLetterPdf=async function(){
    const j=typeof LAST_LETTER_JSON!=='undefined'&&LAST_LETTER_JSON?{...LAST_LETTER_JSON}:v36LetterData();
    if(!j||!clean(j.body)){alert('Générez une lettre avant de télécharger le PDF.');return;}
    try{const doc=await buildLetterPdf(j);doc.save('lettre_motivation.pdf');}catch(error){console.error('Export lettre',error);alert('Export PDF impossible : '+error.message);}
  };
})();
