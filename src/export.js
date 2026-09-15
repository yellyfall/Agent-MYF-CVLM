import {Document,Packer,Paragraph,TextRun,HeadingLevel} from 'docx';
export function classify(line,index,kind) {
  if(index===0 && kind==='cv')return 'title';
  const normalized=line.trim().toLowerCase().replace(/[:：]$/,'');
  if(/^(profil|profil professionnel|résumé|expérience(s)?( professionnelle(s)?)?|formation(s)?|compétences( techniques)?|langues|certifications?|projets|centres d'intérêt|professional (summary|experience)|summary|profile|work experience|experience|education|skills|languages|certifications|projects|perfil|experiencia( profesional)?|formación|competencias|idiomas|berufserfahrung|ausbildung|kenntnisse|sprachen|profilo|esperienza( professionale)?|formazione|competenze|lingue)$/.test(normalized))return 'heading';
  return line.startsWith('- ')?'bullet':'paragraph';
}
export async function makeDocx(text,kind='cv') {
  const lines=text.trim().split('\n');
  const children=lines.map((line,i)=>{const type=classify(line,i,kind);return new Paragraph({
    heading:type==='title'?HeadingLevel.TITLE:type==='heading'?HeadingLevel.HEADING_1:undefined,
    style:type==='title'?'Title':type==='heading'?'Heading1':'Normal',
    keepNext:type==='title'||type==='heading',widowControl:true,
    spacing:{after:line.trim()?80:40,before:type==='heading'?180:0},
    children:[new TextRun({text:line,italics:false,color:'000000',size:type==='title'?42:type==='heading'?24:22,bold:type==='title'||type==='heading',font:'Calibri'})]
  });});
  const doc=new Document({creator:'MYF Candidature',title:kind==='cv'?'Curriculum vitae':'Lettre de motivation',styles:{paragraphStyles:[{id:'Normal',name:'Normal',run:{font:'Calibri',size:22,color:'000000',italics:false},paragraph:{spacing:{line:276}}}],default:{title:{run:{color:'000000',italics:false}},heading1:{run:{color:'000000',italics:false}},document:{run:{font:'Calibri',size:22,color:'000000'},paragraph:{spacing:{line:276}}}}},sections:[{properties:{page:{size:{width:11906,height:16838},margin:{top:1020,right:1020,bottom:1020,left:1020}}},children}]});
  return Packer.toBlob(doc);
}


