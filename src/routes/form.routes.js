import { Router } from "express";
import pool from "../database.js";
import fs from 'fs';
import { join } from 'path';
import * as path from 'path';
import { renderDocxToPdf } from '../lib/docx.js';
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import PizZip from 'pizzip';
import Docxtemplater from 'docxtemplater';
import libre from 'libreoffice-convert';
import { execFile } from 'child_process';
import { promisify } from 'util';
const execFileAsync = promisify(execFile);
import sanitizeData from '../lib/sanitize.js';
import { formatDateLongSpanish, formatDatesDeep } from '../lib/date.js';
import { insertNotificationForTarget } from '../lib/notifications.js';

function normalizeUndefinedString(value) {
    if (value === null || value === undefined) return '';
    if (typeof value === 'string') {
        let trimmed = value.trim();
        if (!trimmed) return '';
        const toBlank = /^(?:undefined|null)$/i;
        if (toBlank.test(trimmed)) return '';
        // Remove leading "undefined" tokens that Word templates sometimes inject before actual text
        const leadingPlaceholder = /^(?:undefined|null)[\s:;.,-]+/i;
        while (leadingPlaceholder.test(trimmed)) {
            trimmed = trimmed.replace(leadingPlaceholder, '').trimStart();
        }
        return toBlank.test(trimmed) ? '' : trimmed;
    }
    return value;
}

// Remove any isolated or embedded placeholders like 'undefined' or 'null' and collapse whitespace
function removeUndefinedTokens(value) {
    if (value === null || value === undefined) return '';
    const s = String(value);
    // remove tokens 'undefined' or 'null' possibly followed/preceded by punctuation, keep other text
    // Normalize CRLF to LF so we preserve paragraph breaks
    const normalizedNewlines = s.replace(/\r\n?/g, '\n');
    // remove literal tokens but allow newline characters to remain
    let cleaned = normalizedNewlines.replace(/(?:\bundefined\b|\bnull\b)[ \t:;.,-]*/gi, '');
    // Collapse excessive whitespace on each line but preserve newline boundaries
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
    return String(text || '')
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase();
}

const GIRO_ALIAS = {
    industrial: 'giro_industrial_x',
    industria: 'giro_industrial_x',
    manufactura: 'giro_industrial_x',
    servicios: 'giro_servicios_x',
    servicio: 'giro_servicios_x',
    terciario: 'giro_servicios_x',
    publico: 'giro_publico_x',
    publica: 'giro_publico_x',
    gobierno: 'giro_publico_x',
    privado: 'giro_privado_x',
    privada: 'giro_privado_x'
};

function computeGiroFlags(...sources) {
    const flags = {
        giro_industrial_x: '',
        giro_servicios_x: '',
        giro_publico_x: '',
        giro_privado_x: '',
        giro_otro_x: ''
    };

    const normalizedSources = sources
        .filter((value) => value !== null && value !== undefined)
        .map((value) => stripAccents(String(value)));

    // Try exact token matches first so we respect a single, well-defined giro
    for (const src of normalizedSources) {
        const tokens = src.split(/[\s,;|\/\-]+/).map((token) => token.trim()).filter(Boolean);
        for (const token of tokens) {
            const flagKey = GIRO_ALIAS[token];
            if (flagKey) {
                flags[flagKey] = 'X';
                return flags;
            }
        }
    }

    // Fallback: look for substrings, but keep only the first match to avoid double checks
    const combined = normalizedSources.join(' ');
    const order = [
        { needle: 'industrial', key: 'giro_industrial_x' },
        { needle: 'industria', key: 'giro_industrial_x' },
        { needle: 'servicio', key: 'giro_servicios_x' },
        { needle: 'servicios', key: 'giro_servicios_x' },
        { needle: 'publico', key: 'giro_publico_x' },
        { needle: 'privado', key: 'giro_privado_x' }
    ];
    for (const item of order) {
        if (combined.includes(item.needle)) {
            flags[item.key] = 'X';
            return flags;
        }
    }

    if (combined.trim()) flags.giro_otro_x = 'X';
    return flags;
}

const MONTH_NAMES = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];
const MONTH_ALIASES = {
    ene: 'Enero', enero: 'Enero',
    feb: 'Febrero', febrero: 'Febrero',
    mar: 'Marzo', marzo: 'Marzo',
    abr: 'Abril', abril: 'Abril',
    may: 'Mayo', mayo: 'Mayo',
    jun: 'Junio', junio: 'Junio',
    jul: 'Julio', julio: 'Julio',
    ago: 'Agosto', agosto: 'Agosto',
    sep: 'Septiembre', sept: 'Septiembre', septiembre: 'Septiembre', set: 'Septiembre',
    oct: 'Octubre', octubre: 'Octubre',
    nov: 'Noviembre', noviembre: 'Noviembre',
    dic: 'Diciembre', diciembre: 'Diciembre'
};
const REPORT_MONTHS = MONTH_NAMES.slice(0, 6);
const REPORT_MONTH_TAGS = [
    { name: 'Enero', tag: 'enex' },
    { name: 'Febrero', tag: 'febx' },
    { name: 'Marzo', tag: 'marx' },
    { name: 'Abril', tag: 'abrx' },
    { name: 'Mayo', tag: 'mayx' },
    { name: 'Junio', tag: 'junx' }
];
const REPORT_MONTH_TAG_LOOKUP = Object.fromEntries(REPORT_MONTH_TAGS.map(({ name, tag }) => [name, tag]));
const REPORT_MONTH_NAME_BY_TAG = Object.fromEntries(REPORT_MONTH_TAGS.map(({ name, tag }) => [tag, name]));

const DEFAULT_PDF_STATUS = 'pendiente';

function stringifyPdfPayload(payload) {
    if (!payload || typeof payload !== 'object') return null;
    try {
        return JSON.stringify(payload, (key, value) => (key === '_debug' ? undefined : value));
    } catch (err) {
        console.error('Error serializando payload para pdf_info:', err);
        return null;
    }
}

function parsePdfInfoJson(value) {
    if (!value) return null;
    try {
        const parsed = typeof value === 'string' ? JSON.parse(value) : value;
        if (parsed && typeof parsed === 'object') return sanitizeData(parsed);
    } catch (err) {
        console.error('Error parseando JSON de pdf_info:', err);
    }
    return null;
}

async function fetchPdfInfoRow(num_control) {
    if (!num_control) return null;
    try {
        const [rows] = await pool.query('SELECT num_control, solicitud_json, preliminar_json, estatus FROM pdf_info WHERE num_control = ? LIMIT 1', [num_control]);
        if (rows && rows.length > 0) return rows[0];
    } catch (err) {
        console.error('Error obteniendo pdf_info:', err);
    }
    return null;
}

async function upsertPdfInfo(num_control, { solicitud, preliminar } = {}, options = {}) {
    if (!num_control) return;
    const solicitudJson = stringifyPdfPayload(solicitud);
    const preliminarJson = stringifyPdfPayload(preliminar);
    const estatus = options.estatus || DEFAULT_PDF_STATUS;
    const updatedBy = options.updatedBy || null;
    try {
        await pool.query(`
            INSERT INTO pdf_info (num_control, solicitud_json, preliminar_json, estatus, updated_by)
            VALUES (?, ?, ?, ?, ?)
            ON DUPLICATE KEY UPDATE
                solicitud_json = CASE WHEN VALUES(solicitud_json) IS NOT NULL THEN VALUES(solicitud_json) ELSE solicitud_json END,
                preliminar_json = CASE WHEN VALUES(preliminar_json) IS NOT NULL THEN VALUES(preliminar_json) ELSE preliminar_json END,
                estatus = VALUES(estatus),
                updated_by = VALUES(updated_by),
                updated_at = CURRENT_TIMESTAMP
        `, [num_control, solicitudJson, preliminarJson, estatus, updatedBy]);
    } catch (err) {
        console.error('Error guardando pdf_info:', err);
    }
}

// Archive existing solicitud_pdfs files for a given solicitud_id by moving files to an archive folder
async function archiveSolicitudPdfs(solicitudId, num_control, options = {}) {
    if (!solicitudId) return;
    const reason = options.reason || 'reenvio';
    const archivedBy = options.archivedBy || null;
    try {
        const [rows] = await pool.query('SELECT id, filename, filepath, uploaded_by, uploaded_at FROM solicitud_pdfs WHERE solicitud_id = ?', [solicitudId]);
        if (!rows || rows.length === 0) return;
        const archiveBase = join(process.cwd(), 'src', 'public', 'pdfs', 'archive', String(num_control || 'unknown'));
        if (!fs.existsSync(archiveBase)) fs.mkdirSync(archiveBase, { recursive: true });
        for (const row of rows) {
            try {
                const fallbackPath = row.filename ? join(process.cwd(), 'src', 'public', 'pdfs', row.filename) : null;
                const candidatePath = row.filepath && fs.existsSync(row.filepath) ? row.filepath : (fallbackPath && fs.existsSync(fallbackPath) ? fallbackPath : null);
                let finalPath = candidatePath || row.filepath || fallbackPath || '';
                let archivedFilename = row.filename || `archivo_${row.id || Date.now()}`;
                if (candidatePath) {
                    const ts = Date.now();
                    const safeName = archivedFilename.replace(/[^A-Za-z0-9_.-]/g, '_');
                    archivedFilename = `arch_${ts}_${safeName}`;
                    const destPath = join(archiveBase, archivedFilename);
                    try {
                        fs.renameSync(candidatePath, destPath);
                        finalPath = destPath;
                    } catch (moveErr) {
                        console.error('Error moviendo archivo a carpeta de archivo, conservando ruta original:', moveErr);
                        finalPath = candidatePath;
                    }
                } else {
                    console.warn('Archivo a archivar no encontrado para solicitud_pdf id=', row.id, 'ruta=', row.filepath);
                }

                await pool.query(
                    `INSERT INTO solicitud_pdfs_archive (solicitud_id, original_pdf_id, filename, filepath, uploaded_by, uploaded_at, archived_by, reason)
                     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
                    [
                        solicitudId,
                        row.id,
                        archivedFilename,
                        finalPath,
                        row.uploaded_by || null,
                        row.uploaded_at || null,
                        archivedBy,
                        reason
                    ]
                );

                await pool.query('DELETE FROM solicitud_pdfs WHERE id = ?', [row.id]);
            } catch (inner) {
                console.error('Error archivando solicitud_pdf id=' + row.id, inner);
            }
        }
    } catch (err) {
        console.error('Error al obtener solicitud_pdfs para archivar:', err);
    }
}

const OPTION_ALIASES = {
    'opcion1': 'banco de proyectos',
    'opcion2': 'propuesta propia',
    'opcion3': 'trabajador',
    'banco de proyectos': 'banco de proyectos',
    'banco de proyecto': 'banco de proyectos',
    'propuesta propia': 'propuesta propia',
    'trabajador': 'trabajador'
};

const PERIODO_ALIASES = {
    'ene': 'Enero-Junio',
    'enero-junio': 'Enero-Junio',
    'ene-jun': 'Enero-Junio',
    'agosto-diciembre': 'Agosto-Diciembre',
    'ago': 'Agosto-Diciembre',
    'ago-dic': 'Agosto-Diciembre',
    'agosto diciembre': 'Agosto-Diciembre'
};

function normalizeOptionValue(value) {
    const key = stripAccents(value || '').replace(/\s+/g, ' ').trim();
    return OPTION_ALIASES[key] || (value || '');
}

function normalizePeriodoValue(value) {
    const key = stripAccents(value || '').replace(/\s+/g, ' ').trim();
    return PERIODO_ALIASES[key] || (value || '');
}

function normalizeMonthToken(value) {
    if (value === null || value === undefined) return null;
    const raw = String(value).trim();
    if (!raw) return null;
    if (/^\d+$/.test(raw)) {
        const num = parseInt(raw, 10);
        if (!Number.isNaN(num) && num >= 1 && num <= MONTH_NAMES.length) return MONTH_NAMES[num - 1];
    }
    const normalized = stripAccents(raw);
    if (!normalized) return null;
    if (MONTH_ALIASES[normalized]) return MONTH_ALIASES[normalized];
    for (const name of MONTH_NAMES) {
        const key = stripAccents(name);
        if (key === normalized || key.startsWith(normalized) || normalized.startsWith(key)) return name;
    }
    return null;
}

function normalizeCronogramaEntries(entries) {
    if (!Array.isArray(entries)) return [];
    return entries
        .map((entry) => {
            const safe = (entry && typeof entry === 'object') ? { ...entry } : { descripcion: entry };
            const descripcion = removeUndefinedTokens(normalizeUndefinedString(safe.descripcion));
            const monthsSet = new Set();

            if (Array.isArray(safe.meses)) {
                safe.meses.forEach((token) => {
                    const canonical = normalizeMonthToken(normalizeUndefinedString(token));
                    if (canonical) monthsSet.add(canonical);
                });
            } else if (safe.meses) {
                String(safe.meses).split(/[;,|\/]+/).forEach((token) => {
                    const canonical = normalizeMonthToken(normalizeUndefinedString(token));
                    if (canonical) monthsSet.add(canonical);
                });
            }

            MONTH_NAMES.forEach((name) => {
                const key = `${name}Img`;
                const raw = normalizeUndefinedString(safe[key]);
                if (raw && String(raw).trim().toUpperCase().startsWith('X')) monthsSet.add(name);
            });

            REPORT_MONTH_TAGS.forEach(({ name, tag }) => {
                const raw = normalizeUndefinedString(safe[tag]);
                if (raw && String(raw).trim().toUpperCase().startsWith('X')) monthsSet.add(name);
            });

            const orderedMonths = Array.from(monthsSet).sort((a, b) => MONTH_NAMES.indexOf(a) - MONTH_NAMES.indexOf(b));
            const result = Object.assign({}, safe, {
                descripcion,
                meses: orderedMonths
            });
            // Update template tag fields to match ordered months (marks X or blank space)
            REPORT_MONTH_TAGS.forEach(({ name, tag }) => {
                result[tag] = orderedMonths.includes(name) ? 'X' : ' ';
            });
            return result;
        })
        .filter((item) => item.descripcion || (Array.isArray(item.meses) && item.meses.length > 0));
}

function computeOptionFlags(optionValue) {
    const normalized = stripAccents(optionValue || '').replace(/\s+/g, ' ').trim();
    const flags = { bx: '', px: '', tx: '' };
    if (!normalized) return flags;
    if (normalized === 'banco de proyectos' || normalized === 'banco de proyecto') flags.bx = 'X';
    else if (normalized === 'propuesta propia') flags.px = 'X';
    else if (normalized === 'trabajador') flags.tx = 'X';
    return flags;
}

function ensureFirmanteDefaults(data) {
    if (!data || typeof data !== 'object') return data;
    const empresa = data.empresa || {};
    const nombre = removeUndefinedTokens(normalizeUndefinedString(
        data.nombre_firmante || empresa.firmante_nombre || empresa.firmante ||
        data.empresa_firmante_nombre || data.empresa_titular_nombre || ''
    ));
    const puesto = removeUndefinedTokens(normalizeUndefinedString(
        data.puesto_firmante || data.cargo_firmante || empresa.firmante_puesto ||
        data.empresa_firmante_puesto || data.empresa_titular_puesto || ''
    ));
    data.nombre_firmante = nombre;
    data.puesto_firmante = puesto;
    data.cargo_firmante = puesto;
    return data;
}
// Try to locate soffice (LibreOffice) binary in common install locations and ensure it's on PATH
function ensureSofficeOnPath() {
    try {
        // Allow explicit override via env var for custom installs
        const envPath = process.env.LIBREOFFICE_PATH || process.env.LIBREOFFICE_HOME;
        if (envPath && typeof envPath === 'string') {
            // if user pointed to program folder or to root, normalize
            let candidate = envPath;
            try {
                // if envPath points to program folder, use it; else append program
                const sofficeCandidate1 = path.join(candidate, 'program', 'soffice.exe');
                const sofficeCandidate2 = path.join(candidate, 'program', 'soffice.com');
                const sofficeCandidate3 = path.join(candidate, 'program', 'soffice');
                if (fs.existsSync(sofficeCandidate1)) candidate = path.join(candidate, 'program');
                else if (fs.existsSync(sofficeCandidate2)) candidate = path.join(candidate, 'program');
                else if (fs.existsSync(sofficeCandidate3)) candidate = path.join(candidate, 'program');
                // prepend to PATH if not present
                const curPath = process.env.PATH || process.env.Path || '';
                if (!curPath.includes(candidate)) process.env.PATH = candidate + path.delimiter + curPath;
                console.log('Using LIBREOFFICE_PATH/LIBREOFFICE_HOME to set PATH:', candidate);
                return true;
            } catch (e) {
                console.error('Error normalizing LIBREOFFICE_PATH:', e);
            }
        }
        const isWin = process.platform === 'win32';
        const candidates = [];
        if (isWin) {
            const programFiles = process.env['ProgramFiles'] || 'C:\\Program Files';
            const programFilesX86 = process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)';
            candidates.push(join(programFiles, 'LibreOffice', 'program', 'soffice.exe'));
            candidates.push(join(programFilesX86, 'LibreOffice', 'program', 'soffice.exe'));
        } else {
            // common unix paths
            candidates.push('/usr/bin/soffice');
            candidates.push('/usr/lib/libreoffice/program/soffice');
            candidates.push('/snap/bin/soffice');
        }

        for (const p of candidates) {
            if (fs.existsSync(p)) {
                const dir = path.dirname(p);
                const curPath = process.env.PATH || process.env.Path || '';
                if (!curPath.includes(dir)) {
                    process.env.PATH = dir + path.delimiter + curPath;
                    console.log('Prepended LibreOffice program dir to PATH:', dir);
                }
                return p;
            }
        }
    } catch (e) {
        console.error('Error while trying to detect LibreOffice path:', e);
    }
    return null;
}

const router = Router();

// Using shared sanitizer from src/lib/sanitize.js

// Helper: create a minimal residencia + solicitud so the document appears under "solicitudes"
async function createSolicitudFromPrelim(data, num_control) {
    try {
        // Insert minimal residencia to satisfy FK (mimic /formulario behaviour)
        const [residResult] = await pool.query(
            `INSERT INTO residencias (tipo_proyecto, publica, giro, num_alumnos, num_control, empresa_id)
             VALUES (?, ?, ?, ?, ?, ?)`,
            [data.nombre_proyecto || 'Preliminar', false, data.giro || '', 1, num_control, data.empresa_id || null]
        );
        const residenciaId = residResult.insertId;

        // Use explicit placeholder for estatus too to avoid mismatches between columns and params
        const insertSql = `INSERT INTO solicitudes (num_control, residencia_id, nombre_proyecto, fecha_solicitud, estatus, nombre_asesor_externo, puesto_asesor_externo, domicilio, email, ciudad, telefono_fijo, coord_carrera, numero_residentes, opcion_elegida, periodo, anio, empresa_id)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;
        // normalize advisor field names (support both old and new keys)
        if (data.nombre_asesor_externo && !data.asesor_empresa) data.asesor_empresa = data.nombre_asesor_externo;
        if (data.puesto_asesor_externo && !data.puesto_asesor_empresa) data.puesto_asesor_empresa = data.puesto_asesor_externo;

        const params = [
            num_control,
            residenciaId,
            data.nombre_proyecto || 'Preliminar',
            new Date(),
            'enviado',
            data.asesor_empresa || '',
            data.puesto_asesor_empresa || '',
            data.domicilio_telefono || '',
            data.contacto_empresa || '',
            '', // ciudad
            '', // telefono_fijo
            '', // coord_carrera
            1,  // numero_residentes
            '', // opcion_elegida
            data.periodo_residencias || '',
            new Date().getFullYear(),
            data.empresa_id || null
        ];
        console.log('createSolicitudFromPrelim: executing SQL with params length=', params.length, 'params=', params.map(p => (p === null ? 'NULL' : typeof p === 'string' ? p : String(p))).slice(0,20));
        const [result] = await pool.query(insertSql, params);
        return result.insertId;
    } catch (e) {
        console.error('Error creando solicitud desde preliminar:', e);
        return null;
    }
}

router.get('/forms', async (req, res) => {
    try {
        // DEBUG: Log session info
        console.log('=== /forms route DEBUG ===');
        console.log('Session exists:', !!req.session);
        console.log('Session data:', {
            usuario: req.session?.usuario,
            rol: req.session?.rol,
            num_control: req.session?.num_control
        });

        // Consulta las carreras y las empresas
        const [carreras] = await pool.query('SELECT id, nombre FROM carreras');
        const [empresas] = await pool.query('SELECT id, nombre FROM empresas');
        const sessionNumControl = req.session?.num_control || null;

        console.log('sessionNumControl:', sessionNumControl);

        let pdfInfoRow = null;
        let pdfInfoDefaults = null;
        let pdfInfoStatus = null;
        if (sessionNumControl) {
            pdfInfoRow = await fetchPdfInfoRow(sessionNumControl);
            if (pdfInfoRow) {
                pdfInfoStatus = pdfInfoRow.estatus ? String(pdfInfoRow.estatus).toLowerCase().trim() : null;
                pdfInfoDefaults = parsePdfInfoJson(pdfInfoRow.solicitud_json);
            }
        }

        // Intentar obtener datos del alumno desde la sesión para prellenar el formulario
        let alumno = null;
        let effectiveNumControl = sessionNumControl;

        // FALLBACK: Si no hay num_control en sesión pero hay username, buscar en tabla usuarios
        if (!effectiveNumControl && req.session?.usuario && req.session?.rol === 'alumno') {
            console.log('⚠️ num_control not in session, attempting fallback lookup by username:', req.session.usuario);
            try {
                const [userRows] = await pool.query(
                    'SELECT num_control FROM usuarios WHERE username = ? AND rol = ?',
                    [req.session.usuario, 'alumno']
                );
                if (userRows.length > 0 && userRows[0].num_control) {
                    effectiveNumControl = userRows[0].num_control;
                    // Update session with the found num_control
                    req.session.num_control = effectiveNumControl;
                    console.log('✓ Found num_control from usuarios table:', effectiveNumControl);
                } else {
                    console.log('❌ No num_control found in usuarios table for username:', req.session.usuario);
                }
            } catch (err) {
                console.error('Error in fallback num_control lookup:', err);
            }
        }

        try {
            if (effectiveNumControl) {
                console.log('Querying alumnos with num_control:', effectiveNumControl);
                const [rows] = await pool.query('SELECT nombre, carrera, num_control, domicilio, email_alumno, institucion_salud, num_seguro_social, comentario_ciudad, telefono FROM alumnos WHERE num_control = ?', [effectiveNumControl]);
                console.log('Query result rows:', rows.length);
                if (rows.length > 0) {
                    alumno = rows[0];
                    console.log('Alumno found:', alumno.nombre);
                    if (alumno) alumno = sanitizeData(alumno);
                } else {
                    console.log('No alumno found for num_control:', effectiveNumControl);
                }
            } else {
                console.log('⚠️ No num_control available (session or fallback) - cannot query alumnos');
            }
        } catch (err) {
            console.error('Error al obtener datos del alumno para prellenar:', err);
        }

        // Build immutable defaults for templates using DB data
        let docDefaults = {};
        let carreraInfo = null;
        if (alumno) {
            docDefaults = {
                nombre_estudiante: alumno.nombre || '',
                num_control: alumno.num_control || '',
                carrera: alumno.carrera || '',
                estudiante_domicilio: alumno.domicilio || '',
                estudiante_email: alumno.email_alumno || '',
                estudiante_ciudad: alumno.comentario_ciudad || '',
                alumno_telefono: alumno.telefono || '',
                num_seguro_social: alumno.num_seguro_social || ''
            };

            // include raw institucion_salud so the form can display it directly
            docDefaults.institucion_salud = alumno.institucion_salud || '';

            const institucion = (alumno.institucion_salud || '').toUpperCase();
            docDefaults.imss_x = institucion === 'IMSS' ? 'X' : '';
            docDefaults.issste_x = institucion === 'ISSSTE' ? 'X' : '';
            docDefaults.otros_x = institucion && institucion !== 'IMSS' && institucion !== 'ISSSTE' ? 'X' : '';

            try {
                const [crow] = await pool.query('SELECT id, nombre, coordinador FROM carreras WHERE nombre = ? LIMIT 1', [alumno.carrera || '']);
                if (crow && crow.length > 0) carreraInfo = sanitizeData(crow[0]);
            } catch (err) {
                console.error('Error obteniendo datos de la carrera del alumno:', err);
            }
        }

        if (carreraInfo) {
            docDefaults.coordinador_persona_encargada = carreraInfo.coordinador || '';
            docDefaults.coordinador_carrera = carreraInfo.nombre || '';
            docDefaults.carrera_id = carreraInfo.id || null;
        }

        // If ?reenvio=<solicitud_id> is provided, fetch solicitud data to prefill the form
        let prefill = null;
        const reenvioId = req.query?.reenvio;
        if (reenvioId) {
            try {
                const [srows] = await pool.query('SELECT * FROM solicitudes WHERE id = ?', [reenvioId]);
                if (srows && srows.length > 0) {
                    const s = srows[0];
                    // Fetch residencia and empresa to get giro if available
                    let residencia = null;
                    if (s.residencia_id) {
                        const [rrows] = await pool.query('SELECT * FROM residencias WHERE id = ?', [s.residencia_id]);
                        residencia = (rrows && rrows.length > 0) ? rrows[0] : null;
                    }
                    let empresa = null;
                    if (s.empresa_id) {
                        const [erows] = await pool.query(
                            `SELECT id, nombre, giro_sector AS giro, empresa_sector, domicilio, colonia, ciudad, codigo_postal,
                                    telefono_empresa AS telefono, rfc_empresa, mision AS actividades,
                                    titular_nombre, titular_puesto, firmante_nombre, firmante_puesto, atencion_a
                             FROM empresas WHERE id = ?`,
                            [s.empresa_id]
                        );
                        empresa = (erows && erows.length > 0) ? erows[0] : null;
                    }

                    // Map DB fields into form field names used in the template
                    prefill = {
                        id: s.id,
                        nombre_proyecto: s.nombre_proyecto || '',
                        fecha_solicitud: s.fecha_solicitud ? new Date(s.fecha_solicitud).toISOString().slice(0,10) : '',
                        opcion_elegida: s.opcion_elegida || '',
                        periodo: s.periodo || '',
                        periodo_residencias: s.periodo ? `${s.periodo}${s.anio ? ` ${s.anio}` : ''}`.trim() : '',
                        anio: s.anio || '',
                        numero_residentes: s.numero_residentes || 1,
                        empresa_id: s.empresa_id || null,
                        nombre_asesor_externo: s.nombre_asesor_externo || '',
                        puesto_asesor_externo: s.puesto_asesor_externo || '',
                        domicilio: s.domicilio || (residencia ? residencia.domicilio : ''),
                        coord_carrera: s.coord_carrera || '',
                        giro: (residencia && residencia.giro) ? residencia.giro : (empresa ? empresa.giro : ''),
                        actividades_empresa: empresa ? empresa.actividades : '',
                        contacto_empresa: empresa ? empresa.atencion_a || '' : ''
                    };

                    if (empresa) {
                        const eSanitized = sanitizeData(empresa);
                        Object.assign(prefill, {
                            empresa_nombre: eSanitized.nombre || prefill.empresa_nombre || '',
                            empresa_rfc: eSanitized.rfc_empresa || prefill.empresa_rfc || '',
                            empresa_domicilio: eSanitized.domicilio || '',
                            empresa_colonia: eSanitized.colonia || '',
                            empresa_cp: eSanitized.codigo_postal || '',
                            empresa_ciudad: eSanitized.ciudad || '',
                            empresa_telefono: eSanitized.telefono || '',
                            empresa_mision: eSanitized.actividades || '',
                            empresa_titular_nombre: eSanitized.titular_nombre || '',
                            empresa_titular_puesto: eSanitized.titular_puesto || '',
                            empresa_sector: eSanitized.empresa_sector || '',
                            domicilio_telefono: [eSanitized.domicilio || '', eSanitized.telefono || ''].filter(Boolean).join(' | ')
                        });
                        prefill.actividades_empresa = prefill.actividades_empresa || eSanitized.actividades || '';
                        Object.assign(prefill, computeGiroFlags(eSanitized.empresa_sector, eSanitized.giro));
                    } else {
                        Object.assign(prefill, computeGiroFlags(prefill.giro));
                    }

                    Object.assign(prefill, computeOptionFlags(prefill.opcion_elegida));
                    if (prefill.coord_carrera) {
                        // Try to determine carrera_id from name for select default
                        try {
                            const [crow] = await pool.query('SELECT id, coordinador FROM carreras WHERE nombre = ? LIMIT 1', [prefill.coord_carrera]);
                            if (crow && crow.length > 0) {
                                prefill.carrera_id = crow[0].id;
                                prefill.coordinador_persona_encargada = crow[0].coordinador || '';
                            }
                        } catch (err) {
                            console.error('Error obteniendo carrera para prefill:', err);
                        }
                    }

                    // sanitize prefill to remove any literal 'undefined' strings from DB
                    prefill = sanitizeData(prefill);
                }
            } catch (e) {
                console.error('Error obteniendo datos para reenvio:', e);
            }
        }

        // Merge prefill data (from reenvio) without overriding immutable defaults
        let prefillSanitized = prefill ? sanitizeData(prefill) : null;
        const clientDefaults = Object.assign({}, docDefaults, pdfInfoDefaults || {}, prefillSanitized || {});

        // Ensure expected keys exist to avoid undefined values in templates
        const defaultKeys = [
            'actividades_empresa',
            'delimitacion',
            'justificacion',
            'descripcion_actividades',
            'empresa_mision',
            'empresa_sector',
            'coordinador_persona_encargada',
            'coord_carrera',
            'periodo_residencias',
            'bx',
            'px',
            'tx'
        ];
        defaultKeys.forEach((key) => {
            if (clientDefaults[key] === undefined) clientDefaults[key] = '';
        });
        if (!clientDefaults.carrera_id && clientDefaults.coordinador_carrera) {
            try {
                const [crow] = await pool.query('SELECT id FROM carreras WHERE nombre = ? LIMIT 1', [clientDefaults.coordinador_carrera]);
                if (crow && crow.length > 0) clientDefaults.carrera_id = crow[0].id;
            } catch (err) {
                console.error('Error determinando carrera_id para defaults:', err);
            }
        }
        if (!clientDefaults.periodo_residencias && clientDefaults.anio && clientDefaults.periodo) {
            clientDefaults.periodo_residencias = `${clientDefaults.periodo} ${clientDefaults.anio}`.trim();
        }
        Object.assign(clientDefaults, computeOptionFlags(clientDefaults.opcion_elegida));
        Object.assign(clientDefaults, computeGiroFlags(clientDefaults.empresa_sector, clientDefaults.giro));

        // Provide JSON strings for client-side scripts
        const defaultsJson = JSON.stringify(clientDefaults || {});
        const alumnoJson = JSON.stringify(alumno || {});

        res.render('form/form.hbs', {
            carreras,
            empresas,
            alumno,
            prefill: prefillSanitized,
            docDefaults: clientDefaults,
            docDefaultsJson: defaultsJson,
            alumnoJson,
            pdfInfoStatus
        });
    } catch (error) {
        console.error('Error al cargar las carreras o empresas:', error);
        res.status(500).send('Error al cargar las carreras o empresas');
    }
});

// Ruta para el documento preliminar
router.get('/documento-preliminar', async (req, res) => {
    try {
        // Consulta las carreras y las empresas (para select/prefill)
        const [carreras] = await pool.query('SELECT id, nombre FROM carreras');
        const [empresas] = await pool.query('SELECT id, nombre FROM empresas');
        const sessionNumControl = req.session?.num_control || null;

        let pdfInfoRow = null;
        let pdfInfoDefaults = null;
        let pdfInfoStatus = null;
        if (sessionNumControl) {
            pdfInfoRow = await fetchPdfInfoRow(sessionNumControl);
            if (pdfInfoRow) {
                pdfInfoStatus = pdfInfoRow.estatus ? String(pdfInfoRow.estatus).toLowerCase().trim() : null;
                pdfInfoDefaults = parsePdfInfoJson(pdfInfoRow.preliminar_json || pdfInfoRow.solicitud_json);
            }
        }

        // Intentar obtener datos del alumno desde la sesión para prellenar el formulario
        let alumno = null;
        try {
            if (sessionNumControl) {
                const [rows] = await pool.query('SELECT nombre, carrera, num_control, domicilio, email_alumno, telefono FROM alumnos WHERE num_control = ?', [sessionNumControl]);
                if (rows.length > 0) alumno = rows[0];
                    if (alumno) alumno = sanitizeData(alumno);
            }
        } catch (err) {
            console.error('Error al obtener datos del alumno para prellenar (preliminar):', err);
        }

        let prelimDefaults = Object.assign({}, pdfInfoDefaults || {});
        const prelimJson = JSON.stringify(prelimDefaults || {});

        res.render('form/preliminar.hbs', {
            carreras,
            empresas,
            alumno,
            usuario: req.session?.usuario,
            prelimDefaults,
            prelimDefaultsJson: prelimJson,
            pdfInfoStatus
        });
    } catch (error) {
        console.error('Error al cargar datos para documento preliminar:', error);
        res.status(500).send('Error al cargar datos para documento preliminar');
    }
});

// POST handler: recibe el formulario preliminar y genera un PDF usando la plantilla
router.post('/documento-preliminar', async (req, res) => {
    try {
        const num_control = req.session?.num_control;
            if (!num_control) return res.status(401).json({ error: 'No autenticado' });

        // Server-side enforcement: deny generation when a pdf_info row exists with blocked status
        try {
            const existingPdf = await fetchPdfInfoRow(num_control);
            if (existingPdf && existingPdf.estatus) {
                const st = String(existingPdf.estatus || '').toLowerCase();
                if (st === 'pendiente' || st === 'aprobado') {
                    return res.status(403).json({ error: `Generación denegada: existe un documento con estatus '${existingPdf.estatus}'. Contacta al jefe para autorización.` });
                }
            }
        } catch (e) {
            console.error('Error comprobando estatus de pdf_info antes de generar preliminar:', e);
            // if check fails, proceed conservatively (allow generation) or fail - choose to proceed
        }

        // Recoger y sanear datos del body
        let data = req.body || {};
        data = sanitizeData(data);
        data = formatDatesDeep(data);
        // TEMP DEBUG: print sanitized payload and key fields to help trace `undefined`
        try {
            console.log('DEBUG /solicitud/generar - sanitized data keys:', {
                nombre_estudiante: data.nombre_estudiante,
                num_control: data.num_control || num_control,
                carrera: data.carrera,
                carrera_id: data.carrera_id,
                empresa_id: data.empresa_id,
                empresa_nombre: data.empresa_nombre,
                asesor_empresa: data.asesor_empresa || data.nombre_asesor_externo,
                puesto_asesor_empresa: data.puesto_asesor_empresa || data.puesto_asesor_externo,
                opcion_elegida: data.opcion_elegida,
                periodo: data.periodo
            });
        } catch (e) { console.warn('DEBUG log failed', e); }
        // Normalize common option/period values (accept short codes or full text)
        data.opcion_elegida = normalizeOptionValue(data.opcion_elegida);
        data.periodo = normalizePeriodoValue(data.periodo);
        data.opcion_elegida = data.opcion_elegida || '';
        data.periodo = data.periodo || '';
        data.periodo_residencias = data.periodo_residencias || data.periodo || '';
        Object.assign(data, computeOptionFlags(data.opcion_elegida));

        // If student info is missing in the POST, fetch from DB using session num_control
        try {
            // Prefer explicit num_control if provided, else try session, else try lookup by nombre_estudiante
            let alumnoRow = null;
            const lookupNum = data.num_control || num_control;
            if (lookupNum) {
                const [arows] = await pool.query('SELECT * FROM alumnos WHERE num_control = ?', [lookupNum]);
                if (arows && arows.length > 0) alumnoRow = arows[0];
            }
            if (alumnoRow) console.log('DEBUG alumnoRow from DB (num_control):', sanitizeData(alumnoRow));
            if (!alumnoRow && data.nombre_estudiante) {
                // try to find by exact name (case-insensitive). If multiple match, take first.
                const [an] = await pool.query('SELECT * FROM alumnos WHERE LOWER(nombre) = LOWER(?) LIMIT 1', [data.nombre_estudiante]);
                if (an && an.length > 0) alumnoRow = an[0];
                if (alumnoRow) console.log('DEBUG alumnoRow from DB (by name):', sanitizeData(alumnoRow));
            }
            if (alumnoRow) {
                const a = sanitizeData(alumnoRow);
                data.alumno = {
                    num_control: a.num_control || '',
                    nombre: a.nombre || '',
                    carrera: a.carrera || '',
                    domicilio: a.domicilio || '',
                    email_alumno: a.email_alumno || a.email || '',
                    telefono: a.telefono || ''
                };
                data.nombre_estudiante = data.nombre_estudiante || data.alumno.nombre || '';
                data.num_control = data.num_control || data.alumno.num_control || '';
                data.carrera = data.carrera || data.alumno.carrera || '';
                data.domicilio = data.domicilio || data.alumno.domicilio || '';
                data.email = data.email || data.alumno.email_alumno || '';
                data.telefono_fijo = data.telefono_fijo || data.alumno.telefono || '';
            }
        } catch (e) {
            console.error('Error fetching alumno for generation:', e);
        }

        // Populate coordinator info from carreras table (prefer carrera_id if provided)
        try {
            let carreraRow = null;
            if (data.carrera_id) {
                const [crows] = await pool.query('SELECT id, nombre, coordinador FROM carreras WHERE id = ?', [data.carrera_id]);
                if (crows && crows.length > 0) carreraRow = crows[0];
            }
            if (!carreraRow && data.carrera) {
                const [crows2] = await pool.query('SELECT id, nombre, coordinador FROM carreras WHERE nombre = ?', [data.carrera]);
                if (crows2 && crows2.length > 0) carreraRow = crows2[0];
            }
            if (carreraRow) {
                const c = sanitizeData(carreraRow);
                data.coordinador = {
                    carrera_id: c.id || data.carrera_id || null,
                    nombre: c.coordinador || '',
                    carrera: c.nombre || data.carrera || ''
                };
                data.nombre_coordinador = c.coordinador || data.nombre_coordinador || '';
                data.coordinador_carrera = c.nombre || data.coordinador_carrera || '';
                // ensure carrera name is present
                data.carrera = data.carrera || c.nombre || '';
            }
        } catch (e) {
            console.error('Error fetching carrera/coordinator for generation:', e);
        }

        // Ensure empresa details are available for templates when empresa_id is provided
        try {
            // If the client provided empresa_id, fetch full empresa. If they provided only empresa_nombre, lookup by name (case-insensitive).
            if (data.empresa_id) {
                const [erows] = await pool.query('SELECT * FROM empresas WHERE id = ?', [data.empresa_id]);
                if (erows && erows.length > 0) {
                    const e = sanitizeData(erows[0]);
                    data.empresa_id = e.id;
                    data.empresa_nombre = data.empresa_nombre || e.nombre || '';
                    data.giro = data.giro || e.giro || e.giro_sector || e.empresa_sector || '';
                    data.empresa_sector = data.empresa_sector || e.empresa_sector || '';
                    data.domicilio_telefono = data.domicilio_telefono || [e.domicilio || '', e.telefono_empresa || e.telefono || ''].filter(Boolean).join(' | ');
                    data.actividades_empresa = data.actividades_empresa || e.mision || e.actividades || '';
                    data.empresa = {
                        id: e.id,
                        nombre: e.nombre || '',
                        domicilio: e.domicilio || '',
                        colonia: e.colonia || '',
                        ciudad: e.ciudad || '',
                        codigo_postal: e.codigo_postal || '',
                        rfc: e.rfc_empresa || '',
                        telefono: e.telefono_empresa || e.telefono || '',
                        actividad: e.mision || e.actividades || '',
                        sector: e.empresa_sector || '',
                        giro: e.giro || e.giro_sector || e.empresa_sector || '',
                        titular_nombre: e.titular_nombre || '',
                        titular_puesto: e.titular_puesto || '',
                        firmante_nombre: e.firmante_nombre || '',
                        firmante_puesto: e.firmante_puesto || ''
                    };
                    if (!data.contacto_empresa) data.contacto_empresa = e.atencion_a || '';
                }
            } else if (data.empresa_nombre) {
                // lookup empresa by name (case-insensitive)
                const [erows2] = await pool.query('SELECT * FROM empresas WHERE LOWER(nombre) = LOWER(?) LIMIT 1', [data.empresa_nombre]);
                if (erows2 && erows2.length > 0) {
                    const e = sanitizeData(erows2[0]);
                    data.empresa_id = e.id;
                    data.empresa_nombre = e.nombre || data.empresa_nombre || '';
                    data.giro = data.giro || e.giro || e.giro_sector || e.empresa_sector || '';
                    data.empresa_sector = data.empresa_sector || e.empresa_sector || '';
                    data.domicilio_telefono = data.domicilio_telefono || [e.domicilio || '', e.telefono_empresa || ''].filter(Boolean).join(' | ');
                    data.actividades_empresa = data.actividades_empresa || e.mision || '';
                    data.empresa = {
                        id: e.id,
                        nombre: e.nombre || '',
                        domicilio: e.domicilio || '',
                        colonia: e.colonia || '',
                        ciudad: e.ciudad || '',
                        codigo_postal: e.codigo_postal || '',
                        rfc: e.rfc_empresa || '',
                        telefono: e.telefono_empresa || '',
                        actividad: e.mision || '',
                        sector: e.empresa_sector || '',
                        giro: e.giro || e.giro_sector || e.empresa_sector || '',
                        titular_nombre: e.titular_nombre || '',
                        titular_puesto: e.titular_puesto || '',
                        firmante_nombre: e.firmante_nombre || '',
                        firmante_puesto: e.firmante_puesto || ''
                    };
                    if (!data.contacto_empresa) data.contacto_empresa = e.atencion_a || '';
                }
            }
        } catch (e) {
            console.error('Error fetching empresa for generación unificada:', e);
        }

        Object.assign(data, computeGiroFlags(data.empresa_sector, data.giro));

        const textKeys = ['delimitacion', 'justificacion', 'descripcion_actividades', 'actividades_empresa', 'objetivos', 'nombre_proyecto', 'giro', 'domicilio_telefono', 'nombre_firmante', 'puesto_firmante'];
        textKeys.forEach((key) => { data[key] = normalizeUndefinedString(data[key]); });
        if (!data.actividades_empresa) data.actividades_empresa = normalizeUndefinedString(data.empresa_mision || (data.empresa && data.empresa.actividad) || '');

        const periodoBase = data.periodo || data.periodo_residencias || '';
        data.periodo = periodoBase || '';
        data.periodo_residencias = periodoBase ? `${periodoBase}${data.anio ? ` ${data.anio}` : ''}`.trim() : '';

        data.coordinador_persona_encargada = normalizeUndefinedString(data.coordinador_persona_encargada || data.nombre_coordinador || (data.coordinador && data.coordinador.nombre) || '');
        data.coord_carrera = normalizeUndefinedString(data.coord_carrera || data.coordinador_carrera || (data.coordinador && data.coordinador.carrera) || data.carrera || '');
        ensureFirmanteDefaults(data);

        // Generación MULTIPLE: Solicitud y Reporte Preliminar
        // Usamos el nuevo generador v2 que soporta múltiples templates
        const { generateSolicitudDocuments } = await import('../lib/pdf_generator_v2.js');
        
        // Intentar crear/obtener solicitud ID primero
        const solicitudId = await createSolicitudFromPrelim(data, num_control).catch(err => {
            console.error('Error creando solicitud:', err);
            return null;
        });

        if (solicitudId) {
            // Archivar documentos anteriores para esta solicitud (limpieza previa)
            try {
                await archiveSolicitudPdfs(solicitudId, num_control, {
                    archivedBy: req.session.usuario || req.session.num_control || 'system',
                    reason: 'reenvio'
                });
            } catch (e) {
                console.error('Error archivando previos:', e);
            }
        }

        const generatedFiles = await generateSolicitudDocuments(data, num_control, req.session.usuario);
        
        if (generatedFiles.length > 0) {
            // Insertar en base de datos
            if (solicitudId) {
                for (const file of generatedFiles) {
                    try {
                        await pool.query('INSERT INTO solicitud_pdfs (solicitud_id, filename, filepath, uploaded_by) VALUES (?, ?, ?, ?)', 
                            [solicitudId, file.filename, file.filepath, req.session.usuario || req.session.num_control || 'system']);
                    } catch (e) {
                        console.error(`Error insertando PDF ${file.filename} en DB:`, e);
                    }
                }
            }

            // Actualizar pdf_info
            try {
                await upsertPdfInfo(num_control, { preliminar: data }, { estatus: 'pendiente', updatedBy: req.session.usuario || num_control });
            } catch (e) {
                console.error('Error upserting pdf_info:', e);
            }

            // Retornar el primer archivo generado para compatibilidad con la respuesta esperada por el frontend,
            // pero el frontend debería recargar o manejar la lista si se actualizara.
            // Por ahora, devolvemos el reporte (preliminar) como principal si existe, o el primero.
            const mainFile = generatedFiles.find(f => f.type === 'preliminar') || generatedFiles[0];
            return res.json({ ok: true, file: `/pdfs/${mainFile.filename}`, path: mainFile.filepath, method: 'docx-v2' });
        } else {
            console.error('No se generaron archivos PDF (v2)');
            // Fallback a lógica antigua o error?
            // Por ahora retornamos error para no complicar más
            return res.status(500).json({ error: 'Error generando documentos PDF. Por favor contacte al administrador.' });
        }

    } catch (error) {
        console.error('Error creando PDF preliminar:', error);
        res.status(500).json({ error: 'Error creando PDF preliminar' });
    }
});

// Endpoint unificado: generar ambos documentos (preliminar y solicitud) desde plantillas DOCX
router.post('/solicitud/generar', async (req, res) => {
    try {
        const num_control = req.session?.num_control;
        if (!num_control) return res.status(401).json({ error: 'No autenticado' });

        // Server-side enforcement: deny generation when a pdf_info row exists with blocked status
        try {
            const existingPdf = await fetchPdfInfoRow(num_control);
            if (existingPdf && existingPdf.estatus) {
                const st = String(existingPdf.estatus || '').toLowerCase();
                if (st === 'pendiente' || st === 'aprobado') {
                    return res.status(403).json({ error: `Generación denegada: existe un documento con estatus '${existingPdf.estatus}'. Contacta al jefe para autorización.` });
                }
            }
        } catch (e) {
            console.error('Error comprobando estatus de pdf_info antes de generar solicitud:', e);
            // proceed: allow generation if the check fails unexpectedly
        }

        let data = req.body || {};
        data = sanitizeData(data);
        // solicitud_id puede venir del cliente (si ya se creó previamente)
        let solicitudId = data.solicitud_id || null;
        if (!solicitudId) {
            // crear una solicitud mínima si no existe
            solicitudId = await createSolicitudFromPrelim(data, num_control);
        }

        if (!solicitudId) return res.status(500).json({ error: 'No se pudo crear o determinar solicitud_id' });

        const timestamp = Date.now();
        const outDir = join(process.cwd(), 'src', 'public', 'pdfs');
        if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });

        data.opcion_elegida = normalizeOptionValue(data.opcion_elegida);
        data.periodo = normalizePeriodoValue(data.periodo);
        data.periodo_residencias = data.periodo_residencias || data.periodo || '';
        Object.assign(data, computeOptionFlags(data.opcion_elegida));

        const textKeysSolicitud = ['delimitacion', 'justificacion', 'descripcion_actividades', 'actividades_empresa', 'objetivos', 'nombre_proyecto', 'giro', 'domicilio_telefono', 'nombre_firmante', 'puesto_firmante'];
        textKeysSolicitud.forEach((key) => { data[key] = normalizeUndefinedString(data[key]); });
        if (!data.actividades_empresa) data.actividades_empresa = normalizeUndefinedString(data.empresa_mision || (data.empresa && data.empresa.actividad) || '');

        const periodoSolicitud = data.periodo || data.periodo_residencias || '';
        data.periodo = periodoSolicitud || '';
        data.periodo_residencias = periodoSolicitud ? `${periodoSolicitud}${data.anio ? ` ${data.anio}` : ''}`.trim() : data.periodo_residencias;

        data.coordinador_persona_encargada = normalizeUndefinedString(data.coordinador_persona_encargada || data.nombre_coordinador || (data.coordinador && data.coordinador.nombre) || '');
        data.coord_carrera = normalizeUndefinedString(data.coord_carrera || data.coordinador_carrera || (data.coordinador && data.coordinador.carrera) || data.carrera || '');
        ensureFirmanteDefaults(data);

        try {
            let cronograma = [];
            if (data.cronograma_json) cronograma = typeof data.cronograma_json === 'string' ? JSON.parse(data.cronograma_json) : data.cronograma_json;
            else if (Array.isArray(data.cronograma)) cronograma = data.cronograma;
            cronograma = normalizeCronogramaEntries(cronograma);
            data.cronograma = cronograma;
            data.cronograma_json = JSON.stringify(cronograma);
        } catch (e) {
            console.error('Error normalizando cronograma en /solicitud/generar:', e);
            data.cronograma = [];
            data.cronograma_json = JSON.stringify([]);
        }

        // Normalize some alias keys for templates
        if (!data.asesor_empresa && data.nombre_asesor_externo) data.asesor_empresa = data.nombre_asesor_externo;
        if (!data.puesto_asesor_empresa && data.puesto_asesor_externo) data.puesto_asesor_empresa = data.puesto_asesor_externo;
        if (!data.nombre_estudiante && data.nombre) data.nombre_estudiante = data.nombre;

        const results = [];

        // Templates to render
        const templates = [
            { tpl: join(process.cwd(), 'REPORTE_PRELIMINAR.docx'), prefix: `${num_control}_preliminar_${timestamp}` },
            { tpl: join(process.cwd(), 'SOLICITUD_RESIDENCIAS.docx'), prefix: `${num_control}_solicitud_${timestamp}` }
        ];

        const baseTemplateData = cleanUndefinedTokensDeep(formatDatesDeep({
            ...data,
            fecha_actual: new Date(),
            fecha_generacion: new Date()
        }));

        if (solicitudId) {
            try {
                await archiveSolicitudPdfs(solicitudId, num_control, {
                    archivedBy: req.session.usuario || req.session.num_control || 'system',
                    reason: 'reenvio'
                });
            } catch (archiveErr) {
                console.error('Error archivando PDFs previos antes de generar nuevos documentos:', archiveErr);
            }
        }

        for (const t of templates) {
            if (!fs.existsSync(t.tpl)) {
                results.push({ ok: false, template: t.tpl, error: 'template-not-found' });
                continue;
            }
            const outPdf = join(outDir, `${t.prefix}.pdf`);
            const r = await renderDocxToPdf(t.tpl, baseTemplateData, outPdf);
            if (r && r.ok) {
                const filepath = r.path;
                const filename = path.basename(filepath);
                try {
                    await pool.query('INSERT INTO solicitud_pdfs (solicitud_id, filename, filepath, uploaded_by) VALUES (?, ?, ?, ?)', [solicitudId, filename, filepath, req.session.usuario || req.session.num_control || 'system']);
                } catch (e) {
                    console.error('Error registrando solicitud_pdf:', e);
                }
                results.push({ ok: true, template: t.tpl, path: filepath, method: r.method });
            } else {
                results.push({ ok: false, template: t.tpl, error: r ? r.error : 'unknown' });
            }
        }

        // Persist combined solicitud/preliminar JSON to pdf_info so further loads can detect generated documents
        try {
            await upsertPdfInfo(num_control, { solicitud: data, preliminar: data }, { estatus: 'pendiente', updatedBy: req.session.usuario || num_control });
        } catch (e) {
            console.error('Error upserting pdf_info after /solicitud/generar:', e);
        }

        const reviewTargets = ['JEFE', 'ADMIN'];
        const notificationMessage = `El usuario ${num_control} envió documentos, revísalo en solicitudes.`;
        for (const target of reviewTargets) {
            try {
                await insertNotificationForTarget({
                    solicitudId,
                    destinatario: target,
                    tipo: 'info',
                    mensaje: notificationMessage
                });
            } catch (err) {
                console.error(`Error generando notificación para ${target}:`, err);
            }
        }

        // If client requested debug, include sanitized data and resolved objects for inspection
        if (data && data._debug) {
            const debugInfo = {
                sanitized_data: data,
                alumno: data.alumno || null,
                empresa: data.empresa || null
            };
            return res.json({ ok: true, solicitud_id: solicitudId, results, debug: debugInfo });
        }

        return res.json({ ok: true, solicitud_id: solicitudId, results });
    } catch (error) {
        console.error('Error en /solicitud/generar:', error);
        res.status(500).json({ error: 'Error generando documentos' });
    }
});

// Crear una nueva solicitud (se usa desde el cliente antes de generar el PDF)
router.post('/formulario', async (req, res) => {
    try {
        const num_control = req.session?.num_control;
        if (!num_control) return res.status(401).json({ error: 'No autenticado' });

        // Sanitize body first to avoid undefined showing up in downstream processing
        let body = req.body || {};
        body = sanitizeData(body);

        const {
            nombre_proyecto,
            fecha_solicitud,
            opcion_elegida,
            periodo,
            anio,
            numero_residentes,
            empresa_id,
            nombre_asesor_externo,
            puesto_asesor_externo,
            domicilio,
            email,
            ciudad,
            telefono_fijo,
            coord_carrera
        } = body;

        // Buscar si ya existe una solicitud pendiente similar para este alumno/proyecto/empresa
        const [found] = await pool.query(
            `SELECT id FROM solicitudes WHERE num_control = ? AND nombre_proyecto = ? AND empresa_id <=> ? AND estatus = 'pendiente' ORDER BY fecha_solicitud DESC LIMIT 1`,
            [num_control, nombre_proyecto, empresa_id || null]
        );
        if (found && found.length > 0) {
            // Reutilizar la solicitud existente
            const existingId = found[0].id;
            return res.json({ ok: true, id: existingId, reused: true });
        }

        // Insertar una fila mínima en residencias para cumplir la FK (si no hay lógica previa)
        const [residResult] = await pool.query(
            `INSERT INTO residencias (tipo_proyecto, publica, giro, num_alumnos, num_control, empresa_id)
             VALUES (?, ?, ?, ?, ?, ?)`,
            [nombre_proyecto || 'N/A', false, '', numero_residentes || 1, num_control, empresa_id || null]
        );
        const residenciaId = residResult.insertId;

        const [result] = await pool.query(
            `INSERT INTO solicitudes (num_control, residencia_id, nombre_proyecto, fecha_solicitud, estatus, nombre_asesor_externo, puesto_asesor_externo, domicilio, email, ciudad, telefono_fijo, coord_carrera, numero_residentes, opcion_elegida, periodo, anio, empresa_id)
             VALUES (?, ?, ?, ?, 'pendiente', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [num_control, residenciaId, nombre_proyecto, fecha_solicitud || new Date(), nombre_asesor_externo, puesto_asesor_externo, domicilio || '', email || '', ciudad || '', telefono_fijo || '', coord_carrera || '', numero_residentes || 1, opcion_elegida || '', periodo || '', anio || new Date().getFullYear(), empresa_id || null]
        );

        const insertId = result.insertId;
        res.json({ ok: true, id: insertId });
    } catch (error) {
        console.error('Error creando solicitud:', error);
        res.status(500).json({ error: 'Error creando solicitud' });
    }
});

// Endpoint para que el jefe/aprobador cambie el estatus de pdf_info (aprobar / rechazar)
router.post('/pdf-info/estatus', async (req, res) => {
    try {
        const role = req.session?.rol;
        const usuario = req.session?.usuario || req.session?.num_control || 'system';
        if (!role || (role !== 'jefe_departamento' && role !== 'admin')) return res.status(403).json({ error: 'No autorizado' });

        const { num_control, estatus, comentario } = req.body || {};
        if (!num_control) return res.status(400).json({ error: 'Falta num_control' });
        const allowed = ['pendiente', 'aprobada', 'rechazada'];
        if (!estatus || !allowed.includes(String(estatus))) return res.status(400).json({ error: 'Estatus inválido' });

        // Update pdf_info row
        try {
            await upsertPdfInfo(num_control, {}, { estatus: String(estatus), updatedBy: usuario });
        } catch (e) {
            console.error('Error actualizando pdf_info desde /pdf-info/estatus:', e);
            return res.status(500).json({ error: 'No se pudo actualizar estatus' });
        }

        // Optionally add a comentario to latest solicitud (if exists)
        try {
            const [srows] = await pool.query('SELECT id FROM solicitudes WHERE num_control = ? ORDER BY fecha_solicitud DESC LIMIT 1', [num_control]);
            const solicitudRow = (srows && srows.length > 0) ? srows[0] : null;
            if (comentario && solicitudRow) {
                await pool.query('INSERT INTO solicitud_comentarios (solicitud_id, comentario, autor) VALUES (?, ?, ?)', [solicitudRow.id, comentario, usuario]);
            }
            // Insert a notification for the alumno when the jefe rechaza
            if (String(estatus) === 'rechazada') {
                const mensaje = comentario ? String(comentario) : 'Su documento ha sido rechazado por el jefe de departamento. Revise y reenvíe con correcciones.';
                const solicitudId = solicitudRow ? solicitudRow.id : null;
                await pool.query('INSERT INTO notificaciones (solicitud_id, destinatario, tipo, mensaje) VALUES (?, ?, ?, ?)', [solicitudId, num_control, 'denegacion', mensaje]);
            }
        } catch (e) {
            console.error('Error registrando comentario/nota tras cambio de estatus:', e);
        }

        return res.json({ ok: true, num_control, estatus });
    } catch (error) {
        console.error('Error en /pdf-info/estatus:', error);
        res.status(500).json({ error: 'Error procesando petición' });
    }
});

router.get('/empresa/:id', async (req, res) => {
    try {
        const { id } = req.params;
        // Select specific columns and normalize keys expected by the client
        const [rows] = await pool.query(
            `SELECT id, nombre, giro_sector AS giro, empresa_sector, atencion_a,
                    domicilio, colonia, ciudad, codigo_postal,
                    telefono_empresa AS telefono, rfc_empresa AS rfc, mision AS actividades,
                    titular_nombre, titular_puesto, firmante_nombre, firmante_puesto
             FROM empresas WHERE id = ?`,
            [id]
        );
        if (rows.length > 0) {
            res.json(sanitizeData(rows[0]));
        } else {
            res.status(404).json({ error: 'Empresa no encontrada' });
        }
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Error al obtener los datos de la empresa' });
    }
});

router.get('/carreras/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const [rows] = await pool.query('SELECT * FROM carreras WHERE id = ?', [id]);
        if (rows.length > 0) {
            res.json(sanitizeData(rows[0]));
        } else {
            res.status(404).json({ error: 'Carrera no encontrada' });
        }
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Error al obtener los datos de la carrera' });
    }
});



export default router;