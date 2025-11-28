import fs from 'fs';
import PizZip from 'pizzip';
import { join } from 'path';

const fileArg = process.argv[2] || 'REPORTE_PRELIMINAR.docx';
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
  console.error('Error reading DOCX zip:', e);
  process.exit(3);
}

const docXml = zip.file('word/document.xml')?.asText();
if (!docXml) {
  console.error('word/document.xml not found inside the docx');
  process.exit(4);
}

// Extract all <w:t> text nodes in order
const re = /<w:t[^>]*>([\s\S]*?)<\/w:t>/g;
const runs = [];
let m;
while ((m = re.exec(docXml)) !== null) {
  runs.push(m[1]);
}

if (runs.length === 0) {
  console.log('No text runs found in document.xml');
  process.exit(0);
}

// Build concatenated text and keep run offsets
let concat = '';
const runOffsets = [];
for (let i = 0; i < runs.length; i++) {
  runOffsets.push(concat.length);
  concat += runs[i];
}
runOffsets.push(concat.length);

// Find tags like {#name}, {/name}, {name}
const tagRe = /\{[#\/]?[^\}]+\}/g;
const tags = [];
while ((m = tagRe.exec(concat)) !== null) {
  const start = m.index;
  const end = tagRe.lastIndex - 1;
  // map start and end to run indices
  let startRun = runOffsets.findIndex((off, idx) => start >= off && start < runOffsets[idx+1]);
  if (startRun === -1) startRun = runOffsets.length-2;
  let endRun = runOffsets.findIndex((off, idx) => end >= off && end < runOffsets[idx+1]);
  if (endRun === -1) endRun = runOffsets.length-2;
  tags.push({text: m[0], start, end, startRun, endRun});
}

if (tags.length === 0) {
  console.log('No docxtemplater-style tags found (e.g. {name} or {#cronograma}).');
  console.log('Note: tags might be split across runs; this script will try to detect split tags by looking at run boundaries.');
} else {
  console.log('Found', tags.length, 'tags:');
  for (const t of tags) {
    const split = t.startRun !== t.endRun;
    console.log(`- ${t.text}  (runs: ${t.startRun}..${t.endRun})${split ? '  <-- SPLIT across runs' : ''}`);
    if (split) {
      console.log('  snippet of runs around tag:');
      const from = Math.max(0, t.startRun - 2);
      const to = Math.min(runs.length -1, t.endRun + 2);
      for (let r = from; r <= to; r++) {
        const marker = (r === t.startRun || r === t.endRun) ? '>>' : '  ';
        console.log(`   ${marker} run[${r}] = "${runs[r].replace(/\s+/g,' ')}"`);
      }
    }
  }
}

// Extra: check for unclosed loops by scanning open/close pairs
const loopRe = /\{#([^\}]+)\}|\{\/([^\}]+)\}/g;
const stack = [];
const issues = [];
while ((m = loopRe.exec(concat)) !== null) {
  if (m[1]) {
    // opening
    stack.push({name: m[1], pos: m.index});
  } else if (m[2]) {
    const name = m[2];
    if (stack.length === 0) {
      issues.push({type:'unexpected_close', name, pos: m.index});
    } else {
      const last = stack[stack.length-1];
      if (last.name === name) stack.pop();
      else {
        // mismatched
        issues.push({type:'mismatch', expected: last.name, got: name, pos: m.index});
      }
    }
  }
}
if (stack.length > 0) {
  issues.push({type:'unclosed_open', remaining: stack.map(s => s.name)});
}

if (issues.length === 0) {
  console.log('No loop pairing issues detected in the flattened text.');
} else {
  console.log('Loop issues detected:');
  console.log(JSON.stringify(issues, null, 2));
}

console.log('\nHint: If tags are split across multiple runs (SPLIT across runs), open the DOCX in Word, retype the tag in a single continuous run (e.g. type {#cronograma} and {/cronograma}) and save.');
console.log('You can run this script as:');
console.log('  node scripts/check_docx_tags.js REPORTE_PRELIMINAR.docx');
