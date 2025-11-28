import fs from 'fs';
import { join } from 'path';
import PizZip from 'pizzip';
import Docxtemplater from 'docxtemplater';
import libre from 'libreoffice-convert';
import { execFile } from 'child_process';
import { promisify } from 'util';
const execFileAsync = promisify(execFile);

function convertDocxBufferToPdf(buf) {
  return new Promise((resolve, reject) => {
    try {
      libre.convert(buf, '.pdf', undefined, (err, done) => {
        if (err) return reject(err);
        resolve(done);
      });
    } catch (e) {
      reject(e);
    }
  });
}

function ensureSofficeOnPath() {
  try {
    const envPath = process.env.LIBREOFFICE_PATH || process.env.LIBREOFFICE_HOME;
    if (envPath && typeof envPath === 'string') {
      let candidate = envPath;
      try {
        const sofficeCandidate1 = join(candidate, 'program', 'soffice.exe');
        const sofficeCandidate2 = join(candidate, 'program', 'soffice.com');
        const sofficeCandidate3 = join(candidate, 'program', 'soffice');
        if (fs.existsSync(sofficeCandidate1) || fs.existsSync(sofficeCandidate2) || fs.existsSync(sofficeCandidate3)) {
          const dir = join(candidate, 'program');
          const curPath = process.env.PATH || process.env.Path || '';
          if (!curPath.includes(dir)) process.env.PATH = dir + (process.platform === 'win32' ? ';' : ':') + curPath;
          return true;
        }
      } catch (e) {
        // ignore
      }
    }
    // try common locations
    const isWin = process.platform === 'win32';
    const candidates = [];
    if (isWin) {
      const programFiles = process.env['ProgramFiles'] || 'C:\\Program Files';
      const programFilesX86 = process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)';
      candidates.push(join(programFiles, 'LibreOffice', 'program', 'soffice.exe'));
      candidates.push(join(programFilesX86, 'LibreOffice', 'program', 'soffice.exe'));
    } else {
      candidates.push('/usr/bin/soffice');
      candidates.push('/usr/lib/libreoffice/program/soffice');
      candidates.push('/snap/bin/soffice');
    }
    for (const p of candidates) {
      if (fs.existsSync(p)) {
        const dir = (p.indexOf('program') >= 0) ? join(p, '..') : p;
        const curPath = process.env.PATH || process.env.Path || '';
        const d = require('path').dirname(p);
        if (!curPath.includes(d)) process.env.PATH = d + (process.platform === 'win32' ? ';' : ':') + curPath;
        return p;
      }
    }
  } catch (e) {
    // ignore
  }
  return null;
}

export async function renderDocxToPdf(templatePath, data, outPdfPath) {
  // Returns an object { ok: true, path, method: 'docx'|'docx-only'|'pdf-overlay' }
  let tmpDocx = null;
  let tmpPdf = null;
  
  try {
    if (!fs.existsSync(templatePath)) return { ok: false, error: 'template-not-found' };
    const content = fs.readFileSync(templatePath, 'binary');
    const zip = new PizZip(content);

    let imageModuleInstance = null;
    try {
      const imgMod = await import('docxtemplater-image-module-free');
      const ImageModule = imgMod.default || imgMod;
      imageModuleInstance = new ImageModule({
        getImage: function(tagValue) {
          try {
            if (!tagValue) return null;
            if (String(tagValue).startsWith('data:')) {
              const parts = String(tagValue).split(',');
              return Buffer.from(parts[1], 'base64');
            }
            try { return fs.readFileSync(String(tagValue)); } catch (e) { return null; }
          } catch (e) { return null; }
        },
        getSize: function() { return [24,24]; }
      });
    } catch (e) {
      // optional
    }

    const docOptions = {
      paragraphLoop: true,
      linebreaks: true,
      nullGetter: () => '' // avoid literal "undefined"/"null" inside templates
    };
    if (imageModuleInstance) docOptions.modules = [imageModuleInstance];
    const doc = new Docxtemplater(zip, docOptions);
    doc.render(data || {});
    const buf = doc.getZip().generate({ type: 'nodebuffer' });

    // temp docx path with unique name
    const tmpDir = join(process.cwd(), 'tmp');
    if (!fs.existsSync(tmpDir)) fs.mkdirSync(tmpDir, { recursive: true });
    const timestamp = Date.now();
    const randomSuffix = Math.random().toString(36).substring(7);
    tmpDocx = join(tmpDir, `${timestamp}_${randomSuffix}_render.docx`);
    fs.writeFileSync(tmpDocx, buf);

    // Try conversion via libreoffice-convert
    let pdfBuf = null;
    try {
      const docBuf = fs.readFileSync(tmpDocx);
      pdfBuf = await convertDocxBufferToPdf(docBuf);
    } catch (e) {
      console.warn('libreoffice-convert failed, trying soffice CLI:', e.message);
      // try soffice CLI fallback
      try {
        const sofficeCmd = 'soffice';
        const outDir = tmpDir;
        
        // Use --norestore to avoid lock issues
        await execFileAsync(sofficeCmd, [
          '--headless',
          '--norestore',
          '--nolockcheck',
          '--convert-to', 'pdf',
          '--outdir', outDir,
          tmpDocx
        ], { 
          windowsHide: true,
          timeout: 30000 // 30 second timeout
        });
        
        tmpPdf = tmpDocx.replace(/\.docx$/i, '.pdf');
        if (fs.existsSync(tmpPdf)) {
          pdfBuf = fs.readFileSync(tmpPdf);
        }
      } catch (ee) {
        console.error('soffice CLI also failed:', ee.message);
      }
    }

    if (pdfBuf) {
      fs.writeFileSync(outPdfPath, pdfBuf);
      
      // Cleanup temp files (with retry for locked files)
      await cleanupTempFile(tmpDocx);
      if (tmpPdf && tmpPdf !== tmpDocx) {
        await cleanupTempFile(tmpPdf);
      }
      
      return { ok: true, path: outPdfPath, method: 'docx' };
    }

    // conversion failed: publish docx as fallback next to outPdfPath replacing extension
    try {
      const fallbackDocxName = outPdfPath.replace(/\.pdf$/i, '.docx');
      fs.copyFileSync(tmpDocx, fallbackDocxName);
      
      // Cleanup temp file
      await cleanupTempFile(tmpDocx);
      
      return { ok: true, path: fallbackDocxName, method: 'docx-only' };
    } catch (e) {
      return { ok: false, error: 'conversion-failed' };
    }
  } catch (err) {
    // Cleanup on error
    if (tmpDocx) await cleanupTempFile(tmpDocx);
    if (tmpPdf && tmpPdf !== tmpDocx) await cleanupTempFile(tmpPdf);
    
    return { ok: false, error: String(err) };
  }
}

// Helper function to cleanup temp files with retry
async function cleanupTempFile(filePath, maxRetries = 3) {
  if (!filePath || !fs.existsSync(filePath)) return;
  
  for (let i = 0; i < maxRetries; i++) {
    try {
      fs.unlinkSync(filePath);
      return; // Success
    } catch (err) {
      if (err.code === 'EBUSY' || err.code === 'EPERM') {
        // File is locked, wait and retry
        console.warn(`File locked (${filePath}), retry ${i + 1}/${maxRetries}...`);
        await new Promise(resolve => setTimeout(resolve, 500 * (i + 1))); // Exponential backoff
      } else {
        // Other error, log and give up
        console.error(`Failed to cleanup temp file ${filePath}:`, err.message);
        return;
      }
    }
  }
  
  // If we get here, all retries failed - schedule cleanup for later
  console.warn(`Could not delete ${filePath} after ${maxRetries} retries. Will be cleaned on next run.`);
}

export { convertDocxBufferToPdf, ensureSofficeOnPath };
