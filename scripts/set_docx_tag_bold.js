import fs from 'fs';
import PizZip from 'pizzip';
import { join } from 'path';

const fileArg = process.argv[2] || 'ASIGNAR_ASESOR.docx';
const tagArg = process.argv[3] || '{nombre_asesor}';
const filePath = join(process.cwd(), fileArg);

if (!fs.existsSync(filePath)) {
  console.error('File not found:', filePath);
  process.exit(2);
}

const content = fs.readFileSync(filePath, 'binary');
let zip;
try {
  zip = new PizZip(content);
} catch (e) {
  console.error('Error opening DOCX zip:', e.message);
  process.exit(3);
}

const xmlPath = 'word/document.xml';
const docXml = zip.file(xmlPath)?.asText();
if (!docXml) {
  console.error('Cannot find', xmlPath, 'inside document');
  process.exit(4);
}

const tagIndex = docXml.indexOf(tagArg);
if (tagIndex === -1) {
  console.error('Tag not found in document.xml:', tagArg);
  process.exit(5);
}

function findRunOpenIndex(xml, startIdx) {
  for (let i = startIdx; i >= 0; i--) {
    if (xml[i] === '<' && xml.slice(i, i + 4) === '<w:r') {
      const nextChar = xml[i + 4] || '';
      if (nextChar === ' ' || nextChar === '>' || nextChar === '\n' || nextChar === '\r') {
        return i;
      }
    }
  }
  return -1;
}

const runOpenIndex = findRunOpenIndex(docXml, tagIndex);
const runCloseToken = '</w:r>';
const runCloseIndex = docXml.indexOf(runCloseToken, tagIndex);
if (runOpenIndex === -1 || runCloseIndex === -1) {
  console.error('Unable to isolate <w:r> block for tag:', tagArg);
  process.exit(6);
}

const runCloseEnd = runCloseIndex + runCloseToken.length;
const boldPattern = /<w:b(?=[^A-Za-z0-9])/;
let runXml = docXml.slice(runOpenIndex, runCloseEnd);
if (boldPattern.test(runXml)) {
  console.log('Run already contains bold formatting for', tagArg);
  process.exit(0);
}

if (/<w:rPr[\s\S]*?<\/w:rPr>/.test(runXml)) {
  runXml = runXml.replace(/<w:rPr([\s\S]*?)<\/w:rPr>/, (segment) => {
    if (boldPattern.test(segment)) return segment;
    return segment.replace('</w:rPr>', '<w:b/></w:rPr>');
  });
} else {
  runXml = runXml.replace(/(<w:r\b[^>]*>)/, `$1<w:rPr><w:b/></w:rPr>`);
}

const updatedXml = docXml.slice(0, runOpenIndex) + runXml + docXml.slice(runCloseEnd);
zip.file(xmlPath, updatedXml);
const outBuffer = zip.generate({ type: 'nodebuffer' });
fs.writeFileSync(filePath, outBuffer);
console.log('Applied bold formatting to', tagArg, 'in', fileArg);
