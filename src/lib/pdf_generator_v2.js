import fs from 'fs';
import { join } from 'path';
import PizZip from 'pizzip';
import Docxtemplater from 'docxtemplater';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import pool from '../database.js';
import sanitizeData from './sanitize.js';
import { formatDatesDeep } from './date.js';

const execFileAsync = promisify(execFile);

// Helper to normalize strings
function normalizeUndefinedString(value) {
    if (value === null || value === undefined) return '';
    if (typeof value === 'string') {
        let trimmed = value.trim();
        if (!trimmed) return '';
        const toBlank = /^(?:undefined|null)$/i;
        if (toBlank.test(trimmed)) return '';
        const leadingPlaceholder = /^(?:undefined|null)[\s:;.,-]+/i;
        while (leadingPlaceholder.test(trimmed)) {
            trimmed = trimmed.replace(leadingPlaceholder, '').trimStart();
        }
        return toBlank.test(trimmed) ? '' : trimmed;
    }
    return value;
}

function removeUndefinedTokens(value) {
    if (value === null || value === undefined) return '';
    const s = String(value);
    const normalizedNewlines = s.replace(/\r\n?/g, '\n');
    let cleaned = normalizedNewlines.replace(/(?:\bundefined\b|\bnull\b)[ \t:;.,-]*/gi, '');
    cleaned = cleaned.split('\n').map((line) => line.replace(/\s+/g, ' ').trim()).join('\n').trim();
    return cleaned;
}

function cleanUndefinedTokensDeep(input) {
    if (input === null || input === undefined) return '';
    if (input instanceof Date) return input;
    if (typeof Buffer !== 'undefined' && Buffer.isBuffer && Buffer.isBuffer(input)) return input;
    if (Array.isArray(input)) return input.map((item) => cleanUndefinedTokensDeep(item));
    if (typeof input === 'object') {
        const result = {};
        Object.entries(input).forEach(([key, val]) => {
            result[key] = cleanUndefinedTokensDeep(val);
        });
        return result;
    }
    if (typeof input === 'string') {
        return removeUndefinedTokens(normalizeUndefinedString(input));
    }
    return input;
}

function stripAccents(text) {
    return String(text || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
}

function computeGiroFlags(...sources) {
    const flags = { giro_industrial_x: '', giro_servicios_x: '', giro_publico_x: '', giro_privado_x: '', giro_otro_x: '' };
    const normalizedSources = sources.filter((value) => value !== null && value !== undefined).map((value) => stripAccents(String(value)));
    for (const s of normalizedSources) {
        if (s.includes('industrial') || s.includes('manufactura')) flags.giro_industrial_x = 'X';
        if (s.includes('servicio') || s.includes('terciario')) flags.giro_servicios_x = 'X';
        if (s.includes('public')) flags.giro_publico_x = 'X';
        if (s.includes('privad')) flags.giro_privado_x = 'X';
    }
    if (!flags.giro_industrial_x && !flags.giro_servicios_x && !flags.giro_publico_x && !flags.giro_privado_x) flags.giro_otro_x = 'X';
    return flags;
}

const REPORT_MONTHS = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];
const REPORT_MONTH_TAG_LOOKUP = {};
REPORT_MONTHS.forEach(m => REPORT_MONTH_TAG_LOOKUP[m] = `${m}Img`);

function normalizeCronogramaEntries(cronograma) {
    if (!Array.isArray(cronograma)) return [];
    return cronograma.map((entry, idx) => {
        return {
            actividad: entry.actividad || entry.descripcion || '',
            descripcion: entry.descripcion || entry.actividad || '',
            fecha_inicio: entry.fecha_inicio || '',
            fecha_fin: entry.fecha_fin || '',
            meses: entry.meses || []
        };
    });
}

function ensureSofficeOnPath() {
    try {
        const envPath = process.env.LIBREOFFICE_PATH || process.env.LIBREOFFICE_HOME;
        if (envPath && typeof envPath === 'string') {
            const dir = join(envPath, 'program');
            const curPath = process.env.PATH || process.env.Path || '';
            if (!curPath.includes(dir)) process.env.PATH = dir + (process.platform === 'win32' ? ';' : ':') + curPath;
            return true;
        }
        const isWin = process.platform === 'win32';
        if (isWin) {
            const programFiles = process.env['ProgramFiles'] || 'C:\\Program Files';
            const programFilesX86 = process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)';
            const candidates = [
                join(programFiles, 'LibreOffice', 'program', 'soffice.exe'),
                join(programFilesX86, 'LibreOffice', 'program', 'soffice.exe')
            ];
            for (const c of candidates) {
                if (fs.existsSync(c)) return true;
            }
        }
    } catch (e) {}
    return false;
}

export async function generateSolicitudDocuments(data, num_control, sessionUser) {
    const templatesToProcess = [
        { path: join(process.cwd(), 'SOLICITUD_RESIDENCIAS.docx'), suffix: 'solicitud', label: 'Solicitud' },
        { path: join(process.cwd(), 'REPORTE_PRELIMINAR.docx'), suffix: 'preliminar', label: 'Reporte Preliminar' }
    ];

    const timestamp = Date.now();
    const generatedFiles = [];
    
    // Ensure soffice is discoverable
    ensureSofficeOnPath();

    for (const tpl of templatesToProcess) {
        if (!fs.existsSync(tpl.path)) {
            console.warn(`Template no encontrado: ${tpl.path}`);
            continue;
        }

        try {
            // Prepare data
            let cronograma = [];
            try {
                if (data.cronograma_json) cronograma = typeof data.cronograma_json === 'string' ? JSON.parse(data.cronograma_json) : data.cronograma_json;
                else if (Array.isArray(data.cronograma)) cronograma = data.cronograma;
            } catch (e) { cronograma = []; }
            cronograma = normalizeCronogramaEntries(cronograma);
            
            const content = fs.readFileSync(tpl.path, 'binary');
            const zip = new PizZip(content);

            // Image Module Setup
            let imageModuleInstance = null;
            try {
                const imgMod = await import('docxtemplater-image-module-free');
                const ImageModule = imgMod.default || imgMod;
                imageModuleInstance = new ImageModule({
                    getImage: function(tagValue) {
                        if (!tagValue) return null;
                        if (String(tagValue).startsWith('data:')) {
                            return Buffer.from(String(tagValue).split(',')[1], 'base64');
                        }
                        try { return fs.readFileSync(String(tagValue)); } catch (e) { return null; }
                    },
                    getSize: () => [24, 24]
                });
            } catch (e) { console.warn('Image module not available'); }

            const docOptions = { paragraphLoop: true, linebreaks: true };
            if (imageModuleInstance) docOptions.modules = [imageModuleInstance];
            const doc = new Docxtemplater(zip, docOptions);

            // Prepare render data
            const monthNames = REPORT_MONTHS;
            const normalizeMonths = (raw) => {
                const set = new Set();
                if (!raw) return set;
                const arr = Array.isArray(raw) ? raw : String(raw).split(/[;,|]+/).map(s => s.trim()).filter(Boolean);
                for (const v of arr) {
                    const num = parseInt(v, 10);
                    if (!isNaN(num) && num >= 1 && num <= monthNames.length) { set.add(num); continue; }
                    const low = String(v).toLowerCase();
                    const idx = monthNames.findIndex(m => m.toLowerCase().startsWith(low) || low.startsWith(m.toLowerCase()));
                    if (idx >= 0) set.add(idx + 1);
                }
                return set;
            };

            const docRenderData = cleanUndefinedTokensDeep(formatDatesDeep({
                ...data,
                fecha_actual: new Date(),
                fecha_generacion: new Date(),
                cronograma: (cronograma || []).map((c, idx) => {
                    const selected = normalizeMonths(c.meses);
                    const monthsObj = {};
                    const mesesList = Array.from(selected).sort((a, b) => a - b).map((n) => monthNames[n - 1]).filter(Boolean);
                    for (let m = 1; m <= monthNames.length; m++) {
                        const monthName = monthNames[m - 1];
                        const tag = REPORT_MONTH_TAG_LOOKUP[monthName] || `${monthName}Img`;
                        monthsObj[tag] = selected.has(m) ? 'X' : ' ';
                    }
                    return Object.assign({
                        index: idx + 1,
                        descripcion: removeUndefinedTokens(normalizeUndefinedString(c.descripcion || '')),
                        meses: mesesList.join(', ')
                    }, monthsObj);
                })
            }));

            doc.render(docRenderData);

            const buf = doc.getZip().generate({ type: 'nodebuffer' });
            const tmpDir = join(process.cwd(), 'tmp');
            if (!fs.existsSync(tmpDir)) fs.mkdirSync(tmpDir, { recursive: true });
            const outDocxPath = join(tmpDir, `${num_control}_${tpl.suffix}_${timestamp}.docx`);
            fs.writeFileSync(outDocxPath, buf);

            // Convert to PDF
            const outDir = tmpDir;
            const sofficeCmd = 'soffice';
            const args = ['--headless', '--convert-to', 'pdf', '--outdir', outDir, outDocxPath];
            await execFileAsync(sofficeCmd, args, { windowsHide: true });
            
            const expectedPdf = join(outDir, `${num_control}_${tpl.suffix}_${timestamp}.pdf`);
            
            if (fs.existsSync(expectedPdf)) {
                let pdfBuf = fs.readFileSync(expectedPdf);
                const filename = `${num_control}_${tpl.suffix}_${timestamp}.pdf`;
                const publicPath = join(process.cwd(), 'src', 'public', 'pdfs', filename);

                // Post-processing: Append Cronograma if it's the Reporte Preliminar and we have data
                if (tpl.suffix === 'preliminar' && cronograma && cronograma.length > 0) {
                    try {
                        const pdfDoc = await PDFDocument.load(pdfBuf);
                        const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
                        let page = pdfDoc.addPage();
                        let { width, height } = page.getSize();
                        const marginLeft = 40;
                        let y = height - 40;
                        
                        page.drawText('Cronograma de actividades:', { x: marginLeft, y: y, size: 12, font, color: rgb(0,0,0) });
                        y -= 18;

                        cronograma.forEach((item) => {
                            // Re-use normalizeMonths logic to get names
                            const selected = normalizeMonths(item.meses);
                            const mesesList = Array.from(selected).sort((a, b) => a - b).map((n) => REPORT_MONTHS[n - 1]).filter(Boolean);
                            const mesesStr = mesesList.join(', ');
                            
                            const desc = removeUndefinedTokens(normalizeUndefinedString(item.descripcion || ''));
                            const text = `${desc || ''} [Meses: ${mesesStr}]`;
                            
                            // Simple wrapping logic
                            const lines = text.match(/(.|\n){1,100}/g) || [text];
                            lines.forEach((ln) => {
                                page.drawText(ln, { x: marginLeft + 6, y: y, size: 10, font, color: rgb(0,0,0) });
                                y -= 12;
                                if (y < 40) {
                                    page = pdfDoc.addPage();
                                    y = height - 40;
                                }
                            });
                            y -= 6;
                        });
                        
                        pdfBuf = await pdfDoc.save(); // Update buffer with modified PDF
                        // We can also save it back to expectedPdf if we wanted, but we'll write to publicPath directly
                    } catch (postErr) {
                        console.error('Error appending cronograma page:', postErr);
                    }
                }

                fs.writeFileSync(publicPath, pdfBuf);
                
                generatedFiles.push({
                    filename: filename,
                    filepath: publicPath,
                    type: tpl.suffix
                });
            } else {
                console.error(`Failed to generate PDF for ${tpl.label}`);
            }

        } catch (err) {
            console.error(`Error generating ${tpl.label}:`, err);
        }
    }

    return generatedFiles;
}
