import fs from 'fs';
import PizZip from 'pizzip';
import { join } from 'path';

const fileArg = process.argv[2] || 'src/public/pdfs/221050153_preliminar_1762295955308.docx';
const pathFile = join(process.cwd(), fileArg);
if (!fs.existsSync(pathFile)) { console.error('File not found:', pathFile); process.exit(2); }
const content = fs.readFileSync(pathFile, 'binary');
const zip = new PizZip(content);
const docXml = zip.file('word/document.xml')?.asText();
if (!docXml) { console.error('document.xml not found'); process.exit(3); }

const hasPlaceholders = /\{EneroImg\}|\{FebreroImg\}|\{MarzoImg\}|\{AbrilImg\}|\{MayoImg\}|\{JunioImg\}/.test(docXml);
const hasDrawing = /<w:drawing[\s>]/.test(docXml);
const hasImageRel = !!zip.file('word/_rels/document.xml.rels');

console.log('File:', pathFile);
console.log('Contains month placeholders (literal {EneroImg} etc):', hasPlaceholders);
console.log('Contains <w:drawing> tags:', hasDrawing);
console.log('Has relationships file (document.xml.rels):', hasImageRel);
if (hasImageRel) {
  const relFiles = zip.file(/word\/_rels\/.*\.rels/g) || [];
  console.log('Found rel files:', relFiles.map(f => f.name));
  for (const f of relFiles) {
    console.log(`--- ${f.name} content start ---`);
    const txt = f.asText();
    console.log(txt);
    console.log(`--- ${f.name} content end ---`);
  }
}

// Print snippet around first occurrence of EneroImg if present
const idx = docXml.indexOf('{EneroImg}');
if (idx >= 0) console.log('Snippet around {EneroImg}:', docXml.substring(Math.max(0, idx-40), idx+40));

// Also list files under word/media
const mediaFiles = zip.file(/word\/media\/.*/g).map(f => f.name);
console.log('Media files:', mediaFiles);

// Find r:embed references in document.xml
const embedRe = /r:embed="([^"]+)"/g;
const embeds = [];
let mm;
while ((mm = embedRe.exec(docXml)) !== null) embeds.push(mm[1]);
console.log('r:embed ids found in document.xml:', embeds);

// For completeness print a small snippet of the document.xml where drawings occur
const drawingIdx = docXml.search(/<w:drawing/);
if (drawingIdx >= 0) console.log('Snippet around first <w:drawing>:', docXml.substring(Math.max(0, drawingIdx-80), drawingIdx+200));
