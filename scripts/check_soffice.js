#!/usr/bin/env node
import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';

function checkSoffice() {
  try {
    const envPath = process.env.LIBREOFFICE_PATH || process.env.LIBREOFFICE_HOME;
    if (envPath && typeof envPath === 'string') {
      const candidate = path.join(envPath, 'program', process.platform === 'win32' ? 'soffice.exe' : 'soffice');
      if (fs.existsSync(candidate)) {
        console.log('Found LibreOffice at (from LIBREOFFICE_PATH):', candidate);
        return candidate;
      }
    }

    // Check PATH for soffice command
    const which = process.platform === 'win32' ? 'where' : 'which';
    try {
      const out = execSync(`${which} soffice`, { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim();
      if (out) {
        console.log('Found soffice in PATH:', out.split(/\r?\n/)[0]);
        return out.split(/\r?\n/)[0];
      }
    } catch (e) {
      // not found via which/where
    }

    // Common Windows locations
    if (process.platform === 'win32') {
      const pf = process.env['ProgramFiles'] || 'C:\\Program Files';
      const pf86 = process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)';
      const candidates = [
        path.join(pf, 'LibreOffice', 'program', 'soffice.exe'),
        path.join(pf86, 'LibreOffice', 'program', 'soffice.exe')
      ];
      for (const c of candidates) {
        if (fs.existsSync(c)) {
          console.log('Found LibreOffice at:', c);
          return c;
        }
      }
    }

    // Common Unix locations
    const unixCandidates = ['/usr/bin/soffice', '/usr/lib/libreoffice/program/soffice', '/snap/bin/soffice'];
    for (const c of unixCandidates) {
      if (fs.existsSync(c)) {
        console.log('Found LibreOffice at:', c);
        return c;
      }
    }
  } catch (e) {
    // ignore
  }
  return null;
}

const found = checkSoffice();
if (found) {
  console.log('\nLibreOffice detected. DOCX -> PDF conversion should work.');
  process.exitCode = 0;
} else {
  console.error('\nLibreOffice (soffice) not detected.');
  console.error('Install LibreOffice and ensure `soffice` is on your PATH, or set the environment variable LIBREOFFICE_PATH to the installation root.');
  console.error('\nWindows example (PowerShell):');
  console.error("  setx LIBREOFFICE_PATH \"C:\\Program Files\\LibreOffice\" ");
  console.error('\nAfter installing, re-open your terminal or restart your shell so that PATH changes take effect.');
  process.exitCode = 2;
}
