import { Router } from "express";
import pool from "../database.js";
import path from "path";
import fs from 'fs';
import sanitizeData from "../lib/sanitize.js";
import { renderDocxToPdf } from "../lib/docx.js";
import { formatDateLongSpanish, formatDatesDeep } from "../lib/date.js";
import { resolveNotificationTarget, fetchNotificationsForTarget, deleteNotificationForTarget } from "../lib/notifications.js";

const router = Router();

// Middleware sencillo para proteger rutas de admin
function requireAdmin(req, res, next) {
    if (req.session && (req.session.rol === 'admin' || req.session.rol === 'jefe_departamento')) return next();
    return res.status(403).send('Acceso denegado');
}

function requireJefe(req, res, next) {
    if (req.session && req.session.rol === 'jefe_departamento') return next();
    return res.status(403).send('Acceso exclusivo para jefe de departamento');
}

// Middleware simple para alumnos autenticados
function requireAlumno(req, res, next) {
    if (req.session && req.session.num_control) return next();
    return res.status(403).send('Acceso denegado - alumno');
}

const NOTIFICATION_STREAM_INTERVAL_MS = 4000;

function streamNotificationsForTarget(req, res, targetKey) {
    if (!targetKey) {
        return res.status(404).end();
    }

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    if (typeof res.flushHeaders === 'function') res.flushHeaders();

    const sentIds = new Set();

    const interval = setInterval(async () => {
        try {
            const [rows] = await pool.query(
                `SELECT id, tipo, mensaje, solicitud_id, created_at
                 FROM notificaciones
                 WHERE destinatario = ? AND COALESCE(leido, 0) = 0
                 ORDER BY created_at ASC
                 LIMIT 20`,
                [targetKey]
            );
            if (!rows || rows.length === 0) return;
            for (const notif of rows) {
                if (sentIds.has(notif.id)) continue;
                sentIds.add(notif.id);
                res.write('event: notification\n');
                res.write(`data: ${JSON.stringify(notif)}\n\n`);
            }
        } catch (err) {
            console.error('SSE polling error:', err);
        }
    }, NOTIFICATION_STREAM_INTERVAL_MS);

    req.on('close', () => {
        clearInterval(interval);
    });
}

async function fetchAsignacionSolicitudData(solicitudId) {
    const [rows] = await pool.query(`
        SELECT s.id,
               s.nombre_proyecto,
               s.periodo,
               s.anio,
               s.estatus,
               s.num_control,
               a.nombre AS alumno_nombre,
               a.carrera AS carrera_usuario,
               e.nombre AS empresa_nombre
        FROM solicitudes s
        JOIN alumnos a ON a.num_control = s.num_control
        JOIN empresas e ON e.id = s.empresa_id
        WHERE s.id = ?
    `, [solicitudId]);
    if (!rows || rows.length === 0) return null;
    return rows[0];
}

async function fetchAsesoresCatalog() {
    const [rows] = await pool.query('SELECT rfc, nombre, carrera FROM asesores ORDER BY nombre ASC');
    return rows || [];
}

function formatFechaLarga(value) {
    if (!value) return '';
    const dt = new Date(value);
    if (Number.isNaN(dt.getTime())) return String(value);
    const months = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
    const day = String(dt.getDate()).padStart(2, '0');
    const monthLabel = months[dt.getMonth()] || '';
    return `${day} de ${monthLabel} de ${dt.getFullYear()}`;
}

function formatDateShort(value) {
    if (!value) return '';
    try {
        const dt = new Date(value);
        if (Number.isNaN(dt.getTime())) return String(value);
        const dd = String(dt.getDate()).padStart(2, '0');
        const mm = String(dt.getMonth() + 1).padStart(2, '0');
        const yyyy = dt.getFullYear();
        return `${dd}/${mm}/${yyyy}`;
    } catch (e) {
        return String(value);
    }
}

async function buildAsignacionViewPayload(solicitudId) {
    const solicitudRow = await fetchAsignacionSolicitudData(solicitudId);
    if (!solicitudRow) return null;
    const asesores = await fetchAsesoresCatalog();
    const periodoLabel = [solicitudRow.periodo, solicitudRow.anio].filter(Boolean).join(' ').trim();
    const solicitudView = {
        id: solicitudRow.id,
        nombre_proyecto: solicitudRow.nombre_proyecto,
        periodo_label: periodoLabel,
        periodo: solicitudRow.periodo,
        anio: solicitudRow.anio,
        alumno_nombre: solicitudRow.alumno_nombre,
        carrera_usuario: solicitudRow.carrera_usuario,
        empresa_nombre: solicitudRow.empresa_nombre,
        estatus: solicitudRow.estatus
    };
    return { solicitudRow, solicitudView, asesores };
}

function buildAsignacionFormValues(overrides = {}) {
    const today = new Date();
    const isoDate = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
    return {
        departamento: '',
        num_oficio: '',
        fecha: isoDate,
        nombre_jefe_departamento: '',
        asesor_rfc: '',
        ...overrides
    };
}

async function archiveSolicitudPdfsForSolicitud(solicitudId, numControl, options = {}) {
    if (!solicitudId) return;
    const reason = options.reason || 'otro';
    const archivedBy = options.archivedBy || null;
    try {
        const [rows] = await pool.query('SELECT id, filename, filepath, uploaded_by, uploaded_at FROM solicitud_pdfs WHERE solicitud_id = ?', [solicitudId]);
        if (!rows || rows.length === 0) return;
        const archiveDir = path.join(process.cwd(), 'src', 'public', 'pdfs', 'archive', String(numControl || 'unknown'));
        if (!fs.existsSync(archiveDir)) fs.mkdirSync(archiveDir, { recursive: true });

        for (const row of rows) {
            const fallbackPath = row.filename ? path.join(process.cwd(), 'src', 'public', 'pdfs', row.filename) : null;
            const candidatePath = row.filepath && fs.existsSync(row.filepath)
                ? row.filepath
                : (fallbackPath && fs.existsSync(fallbackPath) ? fallbackPath : null);
            let finalPath = row.filepath || fallbackPath || '';
            let archivedFilename = row.filename || `archivo_${row.id || Date.now()}`;

            if (candidatePath) {
                const ts = Date.now();
                const safeName = archivedFilename.replace(/[^A-Za-z0-9_.-]/g, '_');
                archivedFilename = `arch_${ts}_${safeName}`;
                const destPath = path.join(archiveDir, archivedFilename);
                try {
                    fs.renameSync(candidatePath, destPath);
                    finalPath = destPath;
                } catch (moveErr) {
                    console.error('Error moviendo archivo al archivar solicitud:', moveErr);
                    finalPath = candidatePath;
                }
            } else {
                console.warn('Archivo no encontrado para archivar, solicitud_pdf id=', row.id);
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
        }
    } catch (err) {
        console.error('Error archivando PDFs para solicitud', solicitudId, err);
    }
}

// Lista de solicitudes
router.get('/admin/solicitudes', requireAdmin, async (req, res) => {
    try {
        const [rows] = await pool.query(`
            SELECT s.id AS solicitud_id,
                   s.nombre_proyecto,
                   s.fecha_solicitud,
                   s.estatus AS solicitud_estatus,
                   s.num_control,
                   a.nombre AS alumno_nombre,
                   a.carrera,
                   p.id AS pdf_id,
                   p.filename,
                   p.filepath,
                   p.uploaded_by,
                   p.uploaded_at,
                   pi.estatus AS pdf_info_estatus
            FROM solicitudes s
            JOIN alumnos a ON a.num_control = s.num_control
            LEFT JOIN solicitud_pdfs p ON p.solicitud_id = s.id
            LEFT JOIN pdf_info pi ON pi.num_control = s.num_control
            ORDER BY COALESCE(p.uploaded_at, s.fecha_solicitud) DESC
        `);

        const [commentCounts] = await pool.query('SELECT solicitud_id, COUNT(*) AS total FROM solicitud_comentarios GROUP BY solicitud_id');
        const commentMap = new Map((commentCounts || []).map((row) => [row.solicitud_id, row.total]));

        const [archiveRows] = await pool.query(`
            SELECT id,
                   solicitud_id,
                   filename,
                   filepath,
                   uploaded_by,
                   uploaded_at,
                   archived_by,
                   archived_at,
                   reason
            FROM solicitud_pdfs_archive
            ORDER BY archived_at DESC
        `);
        const archiveMap = new Map();
        (archiveRows || []).forEach((row) => {
            if (!archiveMap.has(row.solicitud_id)) archiveMap.set(row.solicitud_id, []);
            archiveMap.get(row.solicitud_id).push(row);
        });

        const formatDateTime = (value) => {
            if (!value) return '';
            try {
                const dt = new Date(value);
                const pad = (n) => String(n).padStart(2, '0');
                return `${pad(dt.getDate())}/${pad(dt.getMonth() + 1)}/${dt.getFullYear()} ${pad(dt.getHours())}:${pad(dt.getMinutes())}`;
            } catch (e) {
                return String(value);
            }
        };

        const formatDateOnly = (value) => {
            if (!value) return '';
            try {
                const dt = new Date(value);
                const pad = (n) => String(n).padStart(2, '0');
                return `${pad(dt.getDate())}/${pad(dt.getMonth() + 1)}/${dt.getFullYear()}`;
            } catch (e) {
                return String(value);
            }
        };

        const statusBadgeClass = (status) => {
            const normalized = String(status || '').trim().toLowerCase();
            switch (normalized) {
                case 'aprobada':
                    return 'bg-success';
                case 'rechazada':
                    return 'bg-danger';
                case 'pendiente':
                    return 'bg-primary';
                default:
                    return 'bg-secondary';
            }
        };

        const reasonLabel = (reason) => {
            switch (reason) {
                case 'reenvio':
                    return 'Reenvío';
                case 'denegacion':
                    return 'Denegación';
                case 'admin_delete':
                    return 'Eliminado por admin';
                case 'admin_replace':
                    return 'Reemplazo admin';
                default:
                    return 'Otro';
            }
        };

        const docTimestampValue = (doc) => {
            if (!doc) return 0;
            const raw = doc.uploaded_at_raw || doc.archived_at_raw || doc.archived_at || doc.uploaded_at;
            if (!raw) return 0;
            const parsed = new Date(raw);
            return Number.isNaN(parsed.getTime()) ? 0 : parsed.getTime();
        };

        const solicitudesMap = new Map();
        (rows || []).forEach((r) => {
            if (!solicitudesMap.has(r.solicitud_id)) {
                solicitudesMap.set(r.solicitud_id, {
                    solicitud_id: r.solicitud_id,
                    nombre_proyecto: r.nombre_proyecto,
                    fecha_solicitud: formatDateOnly(r.fecha_solicitud),
                    fecha_solicitud_raw: r.fecha_solicitud,
                    alumno_nombre: r.alumno_nombre,
                    num_control: r.num_control,
                    carrera: r.carrera,
                    solicitud_estatus: r.solicitud_estatus,
                    solicitud_badge_class: statusBadgeClass(r.solicitud_estatus),
                    pdf_info_estatus: r.pdf_info_estatus,
                    pdf_info_badge_class: statusBadgeClass(r.pdf_info_estatus),
                    docs: [],
                    comments_count: commentMap.get(r.solicitud_id) || 0,
                    last_uploaded_at_raw: null,
                    last_uploaded_at: '',
                    archive_docs: [],
                    reenvios_count: 0,
                    documents_overview: [],
                    documents_overview_json: '[]'
                });
            }
            if (r.pdf_id) {
                const entry = solicitudesMap.get(r.solicitud_id);
                const uploadedAtFormatted = formatDateTime(r.uploaded_at);
                const doc = {
                    id: r.pdf_id,
                    filename: r.filename,
                    filepath: r.filepath,
                    uploaded_by: r.uploaded_by,
                    uploaded_at: uploadedAtFormatted,
                    uploaded_at_raw: r.uploaded_at,
                    type_label: r.filename && r.filename.toLowerCase().includes('preliminar') ? 'Reporte preliminar' : 'Solicitud',
                    status: 'activo',
                    source: 'active'
                };
                entry.docs.push(doc);
                entry.documents_overview.push(doc);
                if (!entry.last_uploaded_at_raw || (r.uploaded_at && new Date(r.uploaded_at) > new Date(entry.last_uploaded_at_raw))) {
                    entry.last_uploaded_at_raw = r.uploaded_at;
                    entry.last_uploaded_at = uploadedAtFormatted;
                }
            }
        });

        // Adjuntar historial de versiones archivadas y conteo de reenvíos
        solicitudesMap.forEach((entry, solicitudId) => {
            const historyRows = archiveMap.get(solicitudId) || [];
            let archiveDocs = historyRows.map((row) => ({
                id: row.id,
                filename: row.filename,
                filepath: row.filepath,
                uploaded_by: row.uploaded_by,
                uploaded_at: formatDateTime(row.uploaded_at),
                uploaded_at_raw: row.uploaded_at,
                archived_by: row.archived_by,
                archived_at: formatDateTime(row.archived_at),
                archived_at_raw: row.archived_at,
                reason: reasonLabel(row.reason),
                type_label: row.filename && row.filename.toLowerCase().includes('preliminar') ? 'Reporte preliminar' : 'Solicitud',
                status: 'archivado',
                source: 'archive'
            }));

            const hasPrelimActive = entry.docs.some((doc) => doc.type_label === 'Reporte preliminar');
            if (!hasPrelimActive) {
                const prelimIndex = archiveDocs.findIndex((doc) => doc.type_label === 'Reporte preliminar');
                if (prelimIndex !== -1) {
                    const promotedDoc = { ...archiveDocs[prelimIndex], from_archive: true };
                    entry.docs.push(promotedDoc);
                    entry.documents_overview.push(promotedDoc);
                    archiveDocs = archiveDocs.filter((_, idx) => idx !== prelimIndex);
                }
            }

            entry.archive_docs = archiveDocs;
            entry.reenvios_count = historyRows.filter((row) => row.reason === 'denegacion' || row.reason === 'reenvio').length;
            entry.documents_overview.push(...archiveDocs);
        });

        const solicitudesByAlumno = new Map();
        solicitudesMap.forEach((entry) => {
            if (!solicitudesByAlumno.has(entry.num_control)) solicitudesByAlumno.set(entry.num_control, []);
            solicitudesByAlumno.get(entry.num_control).push(entry);
        });

        const docKey = (doc = {}) => `${doc.source || 'unknown'}::${doc.id || ''}::${doc.filename || ''}`;

        const finalSolicitudes = [];

        solicitudesByAlumno.forEach((entries) => {
            if (!entries || entries.length === 0) return;
            entries.sort((a, b) => {
                const aTime = a.last_uploaded_at_raw ? new Date(a.last_uploaded_at_raw).getTime() : (a.fecha_solicitud_raw ? new Date(a.fecha_solicitud_raw).getTime() : 0);
                const bTime = b.last_uploaded_at_raw ? new Date(b.last_uploaded_at_raw).getTime() : (b.fecha_solicitud_raw ? new Date(b.fecha_solicitud_raw).getTime() : 0);
                return bTime - aTime;
            });

            const primary = entries[0];
            const mergedDocs = [];
            const mergedDocKeys = new Set();
            let latestDocMeta = { doc: null, time: -Infinity };

            const ensureDoc = (doc, meta = {}) => {
                if (!doc) return;
                const merged = {
                    id: doc.id,
                    filename: doc.filename,
                    uploaded_by: doc.uploaded_by,
                    uploaded_at: doc.uploaded_at,
                    uploaded_at_raw: doc.uploaded_at_raw,
                    type_label: doc.type_label,
                    status: doc.status,
                    source: doc.source,
                    reason: doc.reason,
                    archived_at: doc.archived_at,
                    solicitud_id: meta.solicitud_id || doc.solicitud_id || primary.solicitud_id,
                    solicitud_estatus: meta.solicitud_estatus || doc.solicitud_estatus || primary.solicitud_estatus,
                    solicitud_fecha: meta.solicitud_fecha || doc.solicitud_fecha || primary.fecha_solicitud,
                    solicitud_nombre: meta.solicitud_nombre || doc.solicitud_nombre || primary.nombre_proyecto
                };

                merged.status = meta.status || merged.status || 'historial';
                merged.source = meta.source || merged.source || 'archive';
                merged.reason = meta.reason || merged.reason || '';
                merged.archived_at = meta.archived_at || merged.archived_at || merged.uploaded_at || '';
                merged.archived_at_raw = meta.archived_at_raw || merged.archived_at_raw || doc.archived_at_raw || '';
                merged.uploaded_at_raw = merged.uploaded_at_raw || meta.uploaded_at_raw || '';
                merged.uploaded_at = merged.uploaded_at || meta.uploaded_at || '';
                merged.type_label = merged.type_label || meta.type_label || '';

                const key = docKey(merged);
                if (mergedDocKeys.has(key)) return;
                mergedDocKeys.add(key);
                mergedDocs.push(merged);

                const candidateTime = docTimestampValue(merged);
                if (candidateTime > latestDocMeta.time) {
                    latestDocMeta = { doc: merged, time: candidateTime };
                }
            };

            (primary.docs || []).forEach((doc) => ensureDoc(doc, { status: doc.status || 'activo', source: doc.source || 'active' }));
            (primary.archive_docs || []).forEach((doc) => ensureDoc(doc, { status: doc.status || 'archivado', source: doc.source || 'archive', reason: doc.reason, archived_at: doc.archived_at }));

            entries.slice(1).forEach((historic) => {
                if (!historic) return;
                const statusLabel = (historic.solicitud_estatus || '').trim().toLowerCase();
                if (statusLabel === 'rechazada') {
                    primary.reenvios_count = (primary.reenvios_count || 0) + 1;
                }
                const baseMeta = {
                    solicitud_id: historic.solicitud_id,
                    solicitud_estatus: historic.solicitud_estatus,
                    solicitud_fecha: historic.fecha_solicitud,
                    solicitud_nombre: historic.nombre_proyecto
                };

                (historic.docs || []).forEach((doc) => {
                    ensureDoc(doc, {
                        ...baseMeta,
                        status: historic.solicitud_estatus || doc.status || 'historial',
                        source: 'archive'
                    });
                });

                (historic.archive_docs || []).forEach((doc) => {
                    ensureDoc(doc, {
                        ...baseMeta,
                        status: doc.status || historic.solicitud_estatus || 'historial',
                        source: doc.source || 'archive',
                        reason: doc.reason,
                        archived_at: doc.archived_at
                    });
                });
            });

            mergedDocs.sort((a, b) => docTimestampValue(b) - docTimestampValue(a));

            const activeDocs = mergedDocs.filter((doc) => (doc.source || 'archive') === 'active');
            const latestActiveByType = new Map();

            activeDocs.forEach((doc) => {
                const key = (doc.type_label || 'Documento').toLowerCase();
                const current = latestActiveByType.get(key);
                const currentTime = current ? current.time : -Infinity;
                const docTime = docTimestampValue(doc);
                if (!current || docTime > currentTime) {
                    latestActiveByType.set(key, { doc, time: docTime });
                }
            });

            const activeSolicitudFallback = latestDocMeta.doc?.solicitud_id || primary.solicitud_id;
            const activeEntry = entries.find((entryCandidate) => entryCandidate?.solicitud_id === activeSolicitudFallback) || entries[0] || primary;

            primary.solicitud_id = activeEntry.solicitud_id;
            primary.nombre_proyecto = activeEntry.nombre_proyecto;
            primary.fecha_solicitud = activeEntry.fecha_solicitud;
            primary.fecha_solicitud_raw = activeEntry.fecha_solicitud_raw;
            primary.comments_count = activeEntry.comments_count;
            primary.last_uploaded_at_raw = primary.last_uploaded_at_raw || activeEntry.last_uploaded_at_raw;
            primary.last_uploaded_at = primary.last_uploaded_at || activeEntry.last_uploaded_at;
            primary.pdf_info_estatus = activeEntry.pdf_info_estatus || primary.pdf_info_estatus;
            primary.pdf_info_badge_class = statusBadgeClass(primary.pdf_info_estatus);

            let currentDocs = Array.isArray(activeEntry.docs)
                ? activeEntry.docs.map((doc) => ({
                    ...doc,
                    status: doc.status || 'activo',
                    source: doc.source || 'active'
                }))
                : [];

            if (!currentDocs.length && latestActiveByType.size) {
                currentDocs = Array.from(latestActiveByType.values())
                    .map(({ doc }) => ({
                        ...doc,
                        status: doc.status || 'activo',
                        source: doc.source || 'active'
                    }));
            }

            currentDocs.sort((a, b) => docTimestampValue(b) - docTimestampValue(a));
            primary.docs = currentDocs;

            if (primary.docs.length) {
                const mostRecentDoc = primary.docs.reduce((acc, doc) => {
                    const ts = docTimestampValue(doc);
                    return ts > (acc?.time || -Infinity) ? { time: ts, doc } : acc;
                }, null);
                if (mostRecentDoc?.doc) {
                    const rawTs = mostRecentDoc.doc.uploaded_at_raw || mostRecentDoc.doc.archived_at_raw || '';
                    primary.last_uploaded_at_raw = rawTs || primary.last_uploaded_at_raw;
                    primary.last_uploaded_at = rawTs ? formatDateTime(rawTs) : (mostRecentDoc.doc.uploaded_at || primary.last_uploaded_at);
                }
            }

            const preferredStatus = activeEntry.solicitud_estatus || primary.pdf_info_estatus || primary.solicitud_estatus || 'pendiente';
            const normalizedPreferredStatus = String(preferredStatus || '').trim().toLowerCase();
            let resolvedStatus = preferredStatus;
            if (normalizedPreferredStatus === 'rechazada' && primary.docs.length > 0) {
                const pdfStatusNormalized = String(primary.pdf_info_estatus || '').trim().toLowerCase();
                resolvedStatus = pdfStatusNormalized ? primary.pdf_info_estatus : 'pendiente';
            }
            primary.solicitud_estatus = resolvedStatus || 'pendiente';
            primary.solicitud_badge_class = statusBadgeClass(primary.solicitud_estatus);
            const normalizedFinalStatus = String(primary.solicitud_estatus || '').trim().toLowerCase();
            primary.can_assign = normalizedFinalStatus === 'aprobada';

            primary.documents_overview = mergedDocs;
            primary.archive_docs = mergedDocs
                .filter((doc) => (doc.source || 'archive') !== 'active')
                .map((doc) => ({
                    id: doc.id,
                    filename: doc.filename,
                    type_label: doc.type_label,
                    archived_at: doc.archived_at || doc.uploaded_at || '',
                    archived_at_raw: doc.archived_at_raw || doc.uploaded_at_raw || '',
                    reason: doc.reason || '',
                    source: doc.source || 'archive'
                }));

            finalSolicitudes.push(primary);
        });

        finalSolicitudes.forEach((entry) => {
            const overview = (entry.documents_overview || []).map((doc) => ({
                id: doc.id,
                filename: doc.filename,
                uploaded_by: doc.uploaded_by,
                uploaded_at: doc.uploaded_at,
                uploaded_at_raw: doc.uploaded_at_raw || '',
                type_label: doc.type_label,
                status: doc.status,
                source: doc.source,
                solicitud_id: doc.solicitud_id,
                solicitud_estatus: doc.solicitud_estatus,
                solicitud_fecha: doc.solicitud_fecha,
                solicitud_nombre: doc.solicitud_nombre
            }));
            entry.documents_overview = overview;
            entry.documents_overview_json = encodeURIComponent(JSON.stringify(overview));
        });

        const solicitudes = finalSolicitudes.map((entry) => ({
            ...entry,
            docs_count: entry.docs.length
        })).sort((a, b) => {
            const aDate = a.last_uploaded_at_raw ? new Date(a.last_uploaded_at_raw).getTime() : 0;
            const bDate = b.last_uploaded_at_raw ? new Date(b.last_uploaded_at_raw).getTime() : 0;
            return bDate - aDate;
        });

        const solicitudesJson = JSON.stringify(solicitudes);
        const isJefe = req.session.rol === 'jefe_departamento';

        res.render('admin/solicitudes.hbs', {
            solicitudes,
            solicitudesJson,
            usuario: req.session.usuario,
            rol: req.session.rol,
            isJefe
        });
    } catch (error) {
        console.error('Error listando PDFs de solicitudes:', error);
        res.status(500).send('Error al listar PDFs');
    }
});

router.get('/admin/solicitudes/:id/asignar-asesor', requireJefe, async (req, res) => {
    const { id } = req.params;
    try {
        const payload = await buildAsignacionViewPayload(id);
        if (!payload) return res.status(404).send('Solicitud no encontrada');
        const statusNormalized = String(payload.solicitudRow.estatus || '').trim().toLowerCase();
        const errorMessage = statusNormalized === 'aprobada' ? null : 'La solicitud debe estar aprobada para generar la asignación.';
        res.render('admin/asignacion_asesor.hbs', {
            solicitud: payload.solicitudView,
            asesores: payload.asesores,
            formValues: buildAsignacionFormValues(),
            errorMessage,
            usuario: req.session.usuario,
            rol: req.session.rol,
            isJefe: true
        });
    } catch (error) {
        console.error('Error mostrando formulario de asignación:', error);
        res.status(500).send('Error preparando la asignación');
    }
});

router.post('/admin/solicitudes/:id/asignar-asesor', requireJefe, async (req, res) => {
    const { id } = req.params;
    let formValues = buildAsignacionFormValues(req.body || {});
    formValues = sanitizeData(formValues);
    try {
        const payload = await buildAsignacionViewPayload(id);
        if (!payload) return res.status(404).send('Solicitud no encontrada');
        const statusNormalized = String(payload.solicitudRow.estatus || '').trim().toLowerCase();
        if (statusNormalized !== 'aprobada') {
            return res.render('admin/asignacion_asesor.hbs', {
                solicitud: payload.solicitudView,
                asesores: payload.asesores,
                formValues,
                errorMessage: 'La solicitud aún no ha sido aprobada.',
                usuario: req.session.usuario,
                rol: req.session.rol,
                isJefe: true
            });
        }

        const errors = [];
        if (!formValues.departamento) errors.push('El campo departamento es obligatorio.');
        if (!formValues.num_oficio) errors.push('El número de oficio es obligatorio.');
        if (!formValues.fecha) errors.push('La fecha es obligatoria.');
        if (!formValues.nombre_jefe_departamento) errors.push('El nombre del jefe de departamento es obligatorio.');
        if (!formValues.asesor_rfc) errors.push('Debes seleccionar un asesor.');

        if (errors.length) {
            return res.render('admin/asignacion_asesor.hbs', {
                solicitud: payload.solicitudView,
                asesores: payload.asesores,
                formValues,
                errorMessage: errors.join(' '),
                usuario: req.session.usuario,
                rol: req.session.rol,
                isJefe: true
            });
        }

        const [asesorRows] = await pool.query('SELECT rfc, nombre FROM asesores WHERE rfc = ? LIMIT 1', [formValues.asesor_rfc]);
        if (!asesorRows || asesorRows.length === 0) {
            return res.render('admin/asignacion_asesor.hbs', {
                solicitud: payload.solicitudView,
                asesores: payload.asesores,
                formValues,
                errorMessage: 'El asesor seleccionado no existe.',
                usuario: req.session.usuario,
                rol: req.session.rol,
                isJefe: true
            });
        }

        const templatePath = path.join(process.cwd(), 'ASIGNAR_ASESOR.docx');
        if (!fs.existsSync(templatePath)) {
            return res.render('admin/asignacion_asesor.hbs', {
                solicitud: payload.solicitudView,
                asesores: payload.asesores,
                formValues,
                errorMessage: 'No se encontró la plantilla ASIGNAR_ASESOR.docx en la raíz del proyecto.',
                usuario: req.session.usuario,
                rol: req.session.rol,
                isJefe: true
            });
        }

        const outDir = path.join(process.cwd(), 'tmp', 'asignaciones');
        if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
        const outPdfPath = path.join(outDir, `asignacion_${id}_${Date.now()}.pdf`);

        const docData = formatDatesDeep({
            departamento: formValues.departamento,
            num_oficio: formValues.num_oficio,
            fecha: formatFechaLarga(formValues.fecha),
            nombre_jefe_departamento: formValues.nombre_jefe_departamento,
            nombre_asesor: asesorRows[0].nombre,
            nombre_usuario: payload.solicitudRow.alumno_nombre,
            carrera_usuario: payload.solicitudRow.carrera_usuario,
            nombre_proyecto: payload.solicitudRow.nombre_proyecto,
            periodo: [payload.solicitudRow.periodo, payload.solicitudRow.anio].filter(Boolean).join(' ').trim(),
            nombre_empresa: payload.solicitudRow.empresa_nombre,
            fecha_generacion: new Date(),
            fecha_actual: new Date()
        });

        const result = await renderDocxToPdf(templatePath, docData, outPdfPath);
        if (!result || !result.ok) {
            const errorLabel = result && result.error ? result.error : 'No se pudo generar el documento.';
            return res.render('admin/asignacion_asesor.hbs', {
                solicitud: payload.solicitudView,
                asesores: payload.asesores,
                formValues,
                errorMessage: errorLabel,
                usuario: req.session.usuario,
                rol: req.session.rol,
                isJefe: true
            });
        }

        const downloadPath = result.path;
        const downloadName = path.basename(downloadPath);
        return res.download(downloadPath, downloadName, (err) => {
            if (err) {
                console.error('Error enviando asignación de asesor:', err);
            }
            try {
                if (fs.existsSync(downloadPath)) fs.unlinkSync(downloadPath);
            } catch (cleanupErr) {
                console.warn('No se pudo eliminar archivo temporal de asignación:', cleanupErr);
            }
        });
    } catch (error) {
        console.error('Error generando asignación de asesor:', error);
        res.status(500).send('Error generando asignación de asesor');
    }
});

// Descargar PDF (envía archivo si existe)
// Descargar PDF por id de registro en solicitud_pdfs
router.get('/admin/solicitudes/download/:id', requireAdmin, async (req, res) => {
    const { id } = req.params;
    try {
        const [rows] = await pool.query('SELECT filepath, filename FROM solicitud_pdfs WHERE id = ?', [id]);
        if (!rows || rows.length === 0) return res.status(404).send('Archivo no registrado');
        const { filepath, filename } = rows[0];
        const filePath = path.isAbsolute(filepath) ? filepath : path.join(process.cwd(), 'src', 'public', filepath.replace(/^\//, ''));
        res.download(filePath, filename, (err) => {
            if (err) {
                console.error('Error descargando PDF:', err);
                res.status(404).send('Archivo no encontrado');
            }
        });
    } catch (error) {
        console.error('Error descargando registro PDF:', error);
        res.status(500).send('Error descargando archivo');
    }
});

// Ver PDF en iframe: devolvemos la URL segura que llama al stream endpoint
router.get('/admin/solicitudes/view/:id', requireAdmin, async (req, res) => {
    const { id } = req.params;
    try {
        const [rows] = await pool.query('SELECT id FROM solicitud_pdfs WHERE id = ?', [id]);
        if (!rows || rows.length === 0) return res.status(404).send('Archivo no registrado');
        res.json({ ok: true, url: `/admin/solicitudes/stream/${id}` });
    } catch (error) {
        console.error('Error obteniendo URL de visualización:', error);
        res.status(500).json({ error: 'Error obteniendo URL' });
    }
});

// Stream seguro del PDF (no en /public) — requiere admin
router.get('/admin/solicitudes/stream/:id', requireAdmin, async (req, res) => {
    const { id } = req.params;
    try {
        const [rows] = await pool.query('SELECT filepath, filename FROM solicitud_pdfs WHERE id = ?', [id]);
        if (!rows || rows.length === 0) return res.status(404).send('Archivo no registrado');
        const { filepath, filename } = rows[0];
        const target = path.isAbsolute(filepath) ? filepath : path.join(process.cwd(), filepath);
        if (!fs.existsSync(target)) return res.status(404).send('Archivo no encontrado');
        res.setHeader('Content-Type', 'application/pdf');
        // For inline viewing in the browser
        res.setHeader('Content-Disposition', `inline; filename="${filename}"`);
        res.sendFile(target);
    } catch (error) {
        console.error('Error enviando stream del PDF:', error);
        res.status(500).send('Error enviando archivo');
    }
});

// Endpoints para PDFs archivados
router.get('/admin/solicitudes/archive/view/:id', requireAdmin, async (req, res) => {
    const { id } = req.params;
    try {
        const [rows] = await pool.query('SELECT id FROM solicitud_pdfs_archive WHERE id = ?', [id]);
        if (!rows || rows.length === 0) return res.status(404).send('Archivo no registrado');
        res.json({ ok: true, url: `/admin/solicitudes/archive/stream/${id}` });
    } catch (error) {
        console.error('Error obteniendo URL de visualización archivada:', error);
        res.status(500).json({ error: 'Error obteniendo URL' });
    }
});

router.get('/admin/solicitudes/archive/stream/:id', requireAdmin, async (req, res) => {
    const { id } = req.params;
    try {
        const [rows] = await pool.query('SELECT filepath, filename FROM solicitud_pdfs_archive WHERE id = ?', [id]);
        if (!rows || rows.length === 0) return res.status(404).send('Archivo no registrado');
        const { filepath, filename } = rows[0];
        const target = path.isAbsolute(filepath) ? filepath : path.join(process.cwd(), filepath);
        if (!fs.existsSync(target)) return res.status(404).send('Archivo no encontrado');
        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', `inline; filename="${filename}"`);
        res.sendFile(target);
    } catch (error) {
        console.error('Error enviando stream del PDF archivado:', error);
        res.status(500).send('Error enviando archivo');
    }
});

router.get('/admin/solicitudes/archive/download/:id', requireAdmin, async (req, res) => {
    const { id } = req.params;
    try {
        const [rows] = await pool.query('SELECT filepath, filename FROM solicitud_pdfs_archive WHERE id = ?', [id]);
        if (!rows || rows.length === 0) return res.status(404).send('Archivo no registrado');
        const { filepath, filename } = rows[0];
        const target = path.isAbsolute(filepath) ? filepath : path.join(process.cwd(), filepath);
        if (!fs.existsSync(target)) return res.status(404).send('Archivo no encontrado');
        res.download(target, filename, (err) => {
            if (err) {
                console.error('Error descargando PDF archivado:', err);
                res.status(404).send('Archivo no encontrado');
            }
        });
    } catch (error) {
        console.error('Error descargando PDF archivado:', error);
        res.status(500).send('Error descargando archivo');
    }
});

// Eliminar registro de PDF (y opcionalmente el archivo)
router.delete('/admin/solicitudes/pdf/:id', requireAdmin, async (req, res) => {
    const { id } = req.params;
    try {
        const [rows] = await pool.query('SELECT id, solicitud_id, filename, filepath, uploaded_by, uploaded_at FROM solicitud_pdfs WHERE id = ?', [id]);
        if (!rows || rows.length === 0) return res.status(404).json({ error: 'Registro no encontrado' });
        const pdfRow = rows[0];

        let numControl = null;
        try {
            const [sRows] = await pool.query('SELECT num_control FROM solicitudes WHERE id = ?', [pdfRow.solicitud_id]);
            if (sRows && sRows.length > 0) numControl = sRows[0].num_control;
        } catch (lookupErr) {
            console.error('No se pudo obtener num_control para archivar PDF eliminado:', lookupErr);
        }

        const archiveDir = path.join(process.cwd(), 'src', 'public', 'pdfs', 'archive', String(numControl || 'admin'));
        if (!fs.existsSync(archiveDir)) fs.mkdirSync(archiveDir, { recursive: true });

        const fallbackPath = pdfRow.filename ? path.join(process.cwd(), 'src', 'public', 'pdfs', pdfRow.filename) : null;
        const candidatePath = pdfRow.filepath && fs.existsSync(pdfRow.filepath)
            ? pdfRow.filepath
            : (fallbackPath && fs.existsSync(fallbackPath) ? fallbackPath : null);
        let finalPath = pdfRow.filepath;
        let archivedFilename = pdfRow.filename || `archivo_${pdfRow.id || Date.now()}`;

        if (candidatePath) {
            const ts = Date.now();
            const safeName = archivedFilename.replace(/[^A-Za-z0-9_.-]/g, '_');
            archivedFilename = `arch_${ts}_${safeName}`;
            const destPath = path.join(archiveDir, archivedFilename);
            try {
                fs.renameSync(candidatePath, destPath);
                finalPath = destPath;
            } catch (moveErr) {
                console.error('Error moviendo archivo a archivo (eliminación admin), se mantiene ruta original:', moveErr);
                finalPath = candidatePath;
            }
        }

        await pool.query(
            `INSERT INTO solicitud_pdfs_archive (solicitud_id, original_pdf_id, filename, filepath, uploaded_by, uploaded_at, archived_by, reason)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
            [
                pdfRow.solicitud_id,
                pdfRow.id,
                archivedFilename,
                finalPath,
                pdfRow.uploaded_by || null,
                pdfRow.uploaded_at || null,
                req.session.usuario || req.session.num_control || 'admin',
                'admin_delete'
            ]
        );

        await pool.query('DELETE FROM solicitud_pdfs WHERE id = ?', [id]);
        res.json({ ok: true });
    } catch (error) {
        console.error('Error eliminando PDF:', error);
        res.status(500).json({ error: 'Error eliminando' });
    }
});

// Obtener historial de comentarios para una solicitud
router.get('/admin/solicitudes/comments/:solicitud_id', requireAdmin, async (req, res) => {
    const { solicitud_id } = req.params;
    try {
        const [rows] = await pool.query('SELECT id, comentario, autor, created_at FROM solicitud_comentarios WHERE solicitud_id = ? ORDER BY created_at DESC', [solicitud_id]);
        res.json({ ok: true, comments: rows });
    } catch (error) {
        console.error('Error obteniendo comentarios:', error);
        res.status(500).json({ error: 'Error obteniendo comentarios' });
    }
});

// Enviar comentario al alumno (guardar en tabla solicitud_comentarios)
router.post('/admin/solicitudes/comment', requireAdmin, async (req, res) => {
    try {
        const body = sanitizeData(req.body || {});
        const { solicitud_id, comentario } = body;
        if (!solicitud_id || !comentario) return res.status(400).json({ error: 'Faltan datos' });
        await pool.query('INSERT INTO solicitud_comentarios (solicitud_id, comentario, autor) VALUES (?, ?, ?)', [solicitud_id, comentario, req.session.usuario || 'admin']);
        // Crear notificación para el alumno
        const [srows] = await pool.query('SELECT num_control FROM solicitudes WHERE id = ?', [solicitud_id]);
        if (srows && srows.length > 0) {
            const num_control = srows[0].num_control;
            await pool.query('INSERT INTO notificaciones (solicitud_id, destinatario, tipo, mensaje) VALUES (?, ?, ?, ?)', [solicitud_id, num_control, 'comentario', comentario]);
        }
        res.json({ ok: true });
    } catch (error) {
        console.error('Error guardando comentario:', error);
        res.status(500).json({ error: 'Error guardando comentario' });
    }
});

// Subir PDF generado por cliente y registrar en solicitud_pdfs
router.post('/admin/solicitudes/upload', requireAdmin, async (req, res) => {
    try {
        const body = sanitizeData(req.body || {});
        const { solicitud_id, filename, data } = body;
        if (!solicitud_id || !data) return res.status(400).json({ error: 'Faltan datos: solicitud_id o data' });

        // data is expected to be a data URI like 'data:application/pdf;base64,....'
        const match = String(data).match(/^data:([\w\-\/]+);base64,(.*)$/);
        if (!match) return res.status(400).json({ error: 'Data URI inválida' });
        const base64 = match[2];
        const buffer = Buffer.from(base64, 'base64');

        const safeFilename = filename && filename.trim() ? filename.trim() : `solicitud_${solicitud_id}_${Date.now()}.pdf`;
        const storageDir = path.join(process.cwd(), 'storage', 'pdfs');
        if (!fs.existsSync(storageDir)) fs.mkdirSync(storageDir, { recursive: true });
        const targetPath = path.join(storageDir, safeFilename);
        fs.writeFileSync(targetPath, buffer);

        const filepath = targetPath; // guardamos ruta absoluta al archivo fuera de public

        // Si ya existe un registro para esta solicitud, reemplazamos el archivo y actualizamos
        const [existing] = await pool.query('SELECT id, filepath FROM solicitud_pdfs WHERE solicitud_id = ?', [solicitud_id]);
        if (existing && existing.length > 0) {
            const ex = existing[0];
            // borrar archivo anterior si existe
            try {
                if (ex.filepath && fs.existsSync(ex.filepath)) fs.unlinkSync(ex.filepath);
            } catch (e) {
                console.warn('No se pudo borrar archivo anterior:', e.message || e);
            }
            await pool.query('UPDATE solicitud_pdfs SET filename = ?, filepath = ?, uploaded_by = ?, uploaded_at = NOW() WHERE id = ?', [safeFilename, filepath, req.session.usuario || req.session.num_control || 'unknown', ex.id]);
            return res.json({ ok: true, id: ex.id, filepath });
        }

        const [result] = await pool.query('INSERT INTO solicitud_pdfs (solicitud_id, filename, filepath, uploaded_by) VALUES (?, ?, ?, ?)', [solicitud_id, safeFilename, filepath, req.session.usuario || req.session.num_control || 'unknown']);

        res.json({ ok: true, id: result.insertId, filepath });
    } catch (error) {
        console.error('Error subiendo PDF:', error);
        res.status(500).json({ error: 'Error subiendo PDF' });
    }
});

// Owner (alumno) upload: permite al alumno actualizar el PDF de su propia solicitud
router.post('/solicitudes/upload', requireAlumno, async (req, res) => {
    try {
        const body = sanitizeData(req.body || {});
        const { solicitud_id, filename, data } = body;
        if (!solicitud_id || !data) return res.status(400).json({ error: 'Faltan datos: solicitud_id o data' });

        // Verificar que la solicitud pertenece al alumno
        const [rowsS] = await pool.query('SELECT num_control FROM solicitudes WHERE id = ?', [solicitud_id]);
        if (!rowsS || rowsS.length === 0) return res.status(404).json({ error: 'Solicitud no encontrada' });
        if (rowsS[0].num_control !== req.session.num_control) return res.status(403).json({ error: 'No autorizado' });

        // Reusar la misma lógica que el upload admin (reemplazo)
        const match = String(data).match(/^data:([\w\-\/]+);base64,(.*)$/);
        if (!match) return res.status(400).json({ error: 'Data URI inválida' });
        const base64 = match[2];
        const buffer = Buffer.from(base64, 'base64');

        const safeFilename = filename && filename.trim() ? filename.trim() : `solicitud_${solicitud_id}_${Date.now()}.pdf`;
        const storageDir = path.join(process.cwd(), 'storage', 'pdfs');
        if (!fs.existsSync(storageDir)) fs.mkdirSync(storageDir, { recursive: true });
        const targetPath = path.join(storageDir, safeFilename);
        fs.writeFileSync(targetPath, buffer);

        const filepath = targetPath;

        const [existing] = await pool.query('SELECT id, filepath FROM solicitud_pdfs WHERE solicitud_id = ?', [solicitud_id]);
        if (existing && existing.length > 0) {
            const ex = existing[0];
            try { if (ex.filepath && fs.existsSync(ex.filepath)) fs.unlinkSync(ex.filepath); } catch (e) { /* ignore */ }
            await pool.query('UPDATE solicitud_pdfs SET filename = ?, filepath = ?, uploaded_by = ?, uploaded_at = NOW() WHERE id = ?', [safeFilename, filepath, req.session.num_control || 'alumno', ex.id]);
            return res.json({ ok: true, id: ex.id, filepath });
        }

        const [result] = await pool.query('INSERT INTO solicitud_pdfs (solicitud_id, filename, filepath, uploaded_by) VALUES (?, ?, ?, ?)', [solicitud_id, safeFilename, filepath, req.session.num_control || 'alumno']);
        res.json({ ok: true, id: result.insertId, filepath });
    } catch (error) {
        console.error('Error subiendo PDF por alumno:', error);
        res.status(500).json({ error: 'Error subiendo PDF' });
    }
});

// Stream seguro para owner o admin
router.get('/solicitudes/stream/:id', requireAlumno, async (req, res) => {
    const { id } = req.params;
    try {
        const [rows] = await pool.query('SELECT filepath, filename, solicitud_id FROM solicitud_pdfs WHERE id = ?', [id]);
        if (!rows || rows.length === 0) return res.status(404).send('Archivo no registrado');
        const { filepath, filename, solicitud_id } = rows[0];
        const [solRows] = await pool.query('SELECT num_control FROM solicitudes WHERE id = ?', [solicitud_id]);
        if (!solRows || solRows.length === 0) return res.status(404).send('Solicitud no encontrada');
        const num_control = solRows[0].num_control;
        // Permitir si es admin/jefe_departamento o propietario
        if (req.session.rol === 'admin' || req.session.rol === 'jefe_departamento') {
            // admin/jefe OK
        } else if (req.session.num_control === num_control) {
            // allow only if solicitud approved
            const [sRows] = await pool.query('SELECT estatus FROM solicitudes WHERE id = ?', [solicitud_id]);
            if (!sRows || sRows.length === 0) return res.status(404).send('Solicitud no encontrada');
            if (sRows[0].estatus !== 'aprobada') return res.status(403).send('El documento aún no está aprobado');
        } else {
            return res.status(403).send('No autorizado');
        }
        const target = path.isAbsolute(filepath) ? filepath : path.join(process.cwd(), filepath);
        if (!fs.existsSync(target)) return res.status(404).send('Archivo no encontrado');
        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', `inline; filename="${filename}"`);
        res.sendFile(target);
    } catch (error) {
        console.error('Error enviando stream del PDF (owner):', error);
        res.status(500).send('Error enviando archivo');
    }
});

// Admin acepta una solicitud (cambia estatus a 'aprobada')
router.post('/admin/solicitudes/accept', requireAdmin, async (req, res) => {
    try {
        const body = sanitizeData(req.body || {});
        const { solicitud_id } = body;
        if (!solicitud_id) return res.status(400).json({ error: 'Falta solicitud_id' });
        await pool.query('UPDATE solicitudes SET estatus = ? WHERE id = ?', ['aprobada', solicitud_id]);
        // notify alumno y actualizar pdf_info
        const [srows] = await pool.query('SELECT num_control FROM solicitudes WHERE id = ?', [solicitud_id]);
        if (srows && srows.length > 0) {
            const numControl = srows[0].num_control;
            await pool.query('UPDATE pdf_info SET estatus = ?, updated_by = ?, updated_at = NOW() WHERE num_control = ?', ['aprobado', req.session.usuario || 'admin', numControl]);
            await pool.query('INSERT INTO notificaciones (solicitud_id, destinatario, tipo, mensaje) VALUES (?, ?, ?, ?)', [solicitud_id, numControl, 'aprobacion', 'Tu solicitud ha sido aprobada. Puedes descargar el documento.']);
        }
        res.json({ ok: true });
    } catch (error) {
        console.error('Error aceptando solicitud:', error);
        res.status(500).json({ error: 'Error' });
    }
});

// Admin rechaza una solicitud (cambia estatus a 'rechazada')
router.post('/admin/solicitudes/deny', requireAdmin, async (req, res) => {
    try {
        const body = sanitizeData(req.body || {});
        const { solicitud_id } = body;
        if (!solicitud_id) return res.status(400).json({ error: 'Falta solicitud_id' });
        await pool.query('UPDATE solicitudes SET estatus = ? WHERE id = ?', ['rechazada', solicitud_id]);
        // notify alumno y alinear pdf_info
        const [srows] = await pool.query('SELECT num_control FROM solicitudes WHERE id = ?', [solicitud_id]);
        if (srows && srows.length > 0) {
            const numControl = srows[0].num_control;
            await archiveSolicitudPdfsForSolicitud(
                solicitud_id,
                numControl,
                {
                    reason: 'denegacion',
                    archivedBy: req.session.usuario || req.session.num_control || 'admin'
                }
            );
            await pool.query('UPDATE pdf_info SET estatus = ?, updated_by = ?, updated_at = NOW() WHERE num_control = ?', ['rechazada', req.session.usuario || 'admin', numControl]);
            await pool.query('INSERT INTO notificaciones (solicitud_id, destinatario, tipo, mensaje) VALUES (?, ?, ?, ?)', [solicitud_id, numControl, 'denegacion', 'Tu solicitud fue denegada. Por favor revisa los comentarios y reenvía.']);
        }
        res.json({ ok: true });
    } catch (error) {
        console.error('Error rechazando solicitud:', error);
        res.status(500).json({ error: 'Error' });
    }
});

// SSE endpoint para cualquier rol con destino de notificaciones
router.get('/notifications/stream', (req, res) => {
    const targetInfo = resolveNotificationTarget(req.session || {});
    if (!targetInfo?.key) return res.status(401).end();
    streamNotificationsForTarget(req, res, targetInfo.key);
});

// Ruta legada para alumnos (mantiene compatibilidad con scripts antiguos)
router.get('/alumno/notifications/stream', requireAlumno, (req, res) => {
    streamNotificationsForTarget(req, res, req.session.num_control);
});

router.get('/notifications/list', async (req, res) => {
    try {
        const targetInfo = resolveNotificationTarget(req.session || {});
        if (!targetInfo?.key) return res.status(401).json({ ok: false, error: 'No autenticado' });
        const notifications = await fetchNotificationsForTarget(targetInfo.key);
        const pending = notifications.filter((n) => !n.leido).length;
        const formatted = notifications.map((n) => ({
            ...n,
            created_label: formatFechaLarga(n.created_at)
        }));
        res.json({ ok: true, notifications: formatted, pending });
    } catch (error) {
        console.error('Error obteniendo lista de notificaciones:', error);
        res.status(500).json({ ok: false, error: 'Error' });
    }
});

router.delete('/notifications/:id', async (req, res) => {
    try {
        const targetInfo = resolveNotificationTarget(req.session || {});
        if (!targetInfo?.key) return res.status(401).json({ ok: false, error: 'No autenticado' });
        const notifId = Number(req.params.id);
        if (!Number.isInteger(notifId) || notifId <= 0) return res.status(400).json({ ok: false, error: 'ID de notificación inválido' });
        const removed = await deleteNotificationForTarget(targetInfo.key, notifId);
        if (!removed) return res.status(404).json({ ok: false, error: 'Notificación no encontrada' });
        res.json({ ok: true });
    } catch (error) {
        console.error('Error eliminando notificación:', error);
        res.status(500).json({ ok: false, error: 'Error' });
    }
});

// Página de notificaciones (alumno)
router.get('/alumno/notificaciones', requireAlumno, async (req, res) => {
    try {
        res.render('alumno/notificaciones.hbs');
    } catch (error) {
        console.error('Error renderizando notificaciones:', error);
        res.status(500).send('Error');
    }
});

router.get('/admin/notificaciones', requireAdmin, async (req, res) => {
    try {
        res.render('admin/notificaciones.hbs');
    } catch (error) {
        console.error('Error renderizando notificaciones admin:', error);
        res.status(500).send('Error');
    }
});

// Datos JSON para notificaciones del alumno
router.get('/alumno/notificaciones/data', requireAlumno, async (req, res) => {
    try {
        const num_control = req.session.num_control;
        const [rows] = await pool.query(`
            SELECT s.id, s.nombre_proyecto, s.fecha_solicitud, s.estatus,
                   (SELECT COUNT(1) FROM solicitud_comentarios c WHERE c.solicitud_id = s.id) as comments_count,
                   (SELECT GROUP_CONCAT(CONCAT(c.autor, ': ', c.comentario) SEPARATOR '||') FROM solicitud_comentarios c WHERE c.solicitud_id = s.id ORDER BY c.created_at DESC) as comments_text,
                   (SELECT id FROM solicitud_pdfs WHERE solicitud_id = s.id AND filename LIKE '%_solicitud_%' ORDER BY id DESC LIMIT 1) as pdf_solicitud_id,
                   (SELECT id FROM solicitud_pdfs WHERE solicitud_id = s.id AND filename LIKE '%_preliminar_%' ORDER BY id DESC LIMIT 1) as pdf_reporte_id,
                   (SELECT id FROM solicitud_pdfs WHERE solicitud_id = s.id ORDER BY id DESC LIMIT 1) as pdf_generic_id,
                   pi.estatus as pdf_info_estatus
            FROM solicitudes s
            LEFT JOIN pdf_info pi ON pi.num_control = s.num_control
            WHERE s.num_control = ?
            ORDER BY s.id DESC
        `, [num_control]);

        const solicitudes = rows.map(r => {
            const orderTs = Number(r.id) || 0;
            // Determine IDs. If old system (only generic), map generic to reporte/solicitud as fallback if needed, 
            // but ideally we want distinct buttons.
            // If we have specific IDs, use them. If we only have generic, maybe it's an old record.
            const solId = r.pdf_solicitud_id;
            const repId = r.pdf_reporte_id || r.pdf_generic_id; // Fallback generic to reporte usually

            return {
                id: r.id,
                nombre_proyecto: r.nombre_proyecto,
                fecha_solicitud: r.fecha_solicitud,
                fecha_solicitud_fmt: formatDateShort(r.fecha_solicitud),
                estatus: r.estatus,
                comments_count: r.comments_count,
                comments_html: r.comments_text ? r.comments_text.split('||').map(x => `<div>${x}</div>`).join('') : '',
                has_pdf: !!(solId || repId),
                pdf_solicitud_id: solId,
                pdf_reporte_id: repId,
                pdf_info_estatus: r.pdf_info_estatus || null,
                order_ts: orderTs
            };
        });

        const alertsRaw = await fetchNotificationsForTarget(num_control);
        const alerts = alertsRaw.map((n) => ({
            id: n.id,
            solicitud_id: n.solicitud_id,
            tipo: n.tipo,
            mensaje: n.mensaje,
            leido: n.leido,
            created_at: n.created_at,
            created_label: formatFechaLarga(n.created_at)
        }));

        res.json({ ok: true, solicitudes, alerts });
    } catch (error) {
        console.error('Error obteniendo notificaciones data:', error);
        res.status(500).json({ ok: false, error: 'Error' });
    }
});

export default router;

