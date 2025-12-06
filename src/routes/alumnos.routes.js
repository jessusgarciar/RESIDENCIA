import { Router } from "express";
import pool from "../database.js";
import logger from "../lib/logger.js";
import { hashPassword } from "../lib/password.js";
import { requireRole } from "../middleware/auth.js";
import multer from "multer";
import { parse } from "csv-parse/sync";
import { stringify } from "csv-stringify/sync";

const router = Router();

router.get('/alumnos', async (req, res) => {
    try {
        const [alumnos] = await pool.query('SELECT * FROM alumnos');
        res.render('alumnos/alumnos.hbs', { alumnos: alumnos });
    } catch (error) {
        logger.error('Error listing alumnos:', error);
        res.status(500).send('Error en el servidor');
    }
});

router.get('/alumno', async (req, res) => {
    try {
        const num_control = req.session.num_control; // Obtén el num_control de la sesión
        if (!num_control) {
            return res.status(401).json({ error: 'No autorizado' });
        }

        const [rows] = await pool.query('SELECT * FROM alumnos WHERE num_control = ?', [num_control]);
        if (rows.length > 0) {
            res.json(rows[0]); // Devuelve los datos del alumno como JSON
        } else {
            res.status(404).json({ error: 'Alumno no encontrado' });
        }
    } catch (error) {
        logger.error('Error getting alumno data:', error);
        res.status(500).json({ error: 'Error al obtener los datos del alumno' });
    }
});

// Crear usuario asociado a un alumno (solo admin)
router.post('/alumnos/create-user', requireRole('admin'), async (req, res) => {
    try {
        const {
            num_control,
            username,
            password,
            rol = 'alumno',
            nombre,
            email_alumno,
            telefono,
            carrera,
            institucion_salud,
            num_seguro_social,
            comentario_ciudad,
            domicilio
        } = req.body;

        if (!num_control || !username || !password) {
            return res.status(400).json({ error: 'Faltan campos requeridos (num_control, username, password)' });
        }

        // Verificar que no exista usuario con ese username o num_control
        const [existing] = await pool.query('SELECT id FROM usuarios WHERE username = ? OR num_control = ?', [username, num_control]);
        if (existing.length > 0) {
            return res.status(409).json({ error: 'Usuario ya existe para ese username o num_control' });
        }

        // Hashear contraseña y crear usuario
        const hashed = await hashPassword(password);
        await pool.query('INSERT INTO usuarios (username, password, rol, num_control) VALUES (?, ?, ?, ?)', [username, hashed, rol, num_control]);

        // Intentar actualizar o crear registro en tabla alumnos con la información provista
        const [alumnoRows] = await pool.query('SELECT num_control FROM alumnos WHERE num_control = ?', [num_control]);
        if (alumnoRows.length > 0) {
            // Actualizar sólo los campos provistos (si son cadena vacía, no sobreescribimos)
            await pool.query(
                `UPDATE alumnos SET
                    nombre = COALESCE(NULLIF(?,''), nombre),
                    carrera = COALESCE(NULLIF(?,''), carrera),
                    telefono = COALESCE(NULLIF(?,''), telefono),
                    institucion_salud = COALESCE(NULLIF(?,''), institucion_salud),
                    num_seguro_social = COALESCE(NULLIF(?,''), num_seguro_social),
                    comentario_ciudad = COALESCE(NULLIF(?,''), comentario_ciudad),
                    domicilio = COALESCE(NULLIF(?,''), domicilio),
                    email_alumno = COALESCE(NULLIF(?,''), email_alumno)
                 WHERE num_control = ?`,
                [nombre || '', carrera || '', telefono || '', institucion_salud || '', num_seguro_social || '', comentario_ciudad || '', domicilio || '', email_alumno || '', num_control]
            );
            logger.info(`Alumno actualizado: ${num_control}`);
        } else {
            // Si no existe y se proveyeron los campos obligatorios, crear registro
            if (nombre && carrera && telefono && domicilio && email_alumno && institucion_salud) {
                await pool.query(
                    `INSERT INTO alumnos (num_control, nombre, carrera, telefono, domicilio, email_alumno, institucion_salud, num_seguro_social, comentario_ciudad)
                     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                    [num_control, nombre, carrera, telefono, domicilio, email_alumno, institucion_salud, num_seguro_social || null, comentario_ciudad || null]
                );
                logger.info(`Alumno creado: ${num_control}`);
            } else {
                logger.debug(`Alumno con num_control=${num_control} no existe y no se proveyeron todos los campos para crearlo`);
            }
        }

        logger.info(`Usuario creado: ${username} (num_control=${num_control})`);
        res.json({ ok: true, username });
    } catch (error) {
        logger.error('Error creating usuario:', error);
        res.status(500).json({ error: 'Error en el servidor al crear usuario' });
    }
});

// Helper: generar contraseña aleatoria
function generatePassword(len = 12) {
    const chars = 'ABCDEFGHJKMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789!@#$%&*()-_=+';
    let pwd = '';
    const array = new Uint8Array(len);
    if (typeof crypto !== 'undefined' && crypto.getRandomValues) {
        crypto.getRandomValues(array);
        for (let i = 0; i < len; i++) pwd += chars[array[i] % chars.length];
    } else {
        for (let i = 0; i < len; i++) pwd += chars[Math.floor(Math.random() * chars.length)];
    }
    return pwd;
}

// Exportar CSV con num_control, username y contraseña (solo admin)
router.get('/alumnos/export-csv', requireRole('admin'), async (req, res) => {
    try {
        const [usuarios] = await pool.query('SELECT num_control, username FROM usuarios WHERE rol = "alumno" ORDER BY num_control');
        const rows = usuarios.map(u => ({
            num_control: u.num_control,
            username: u.username,
            password: '(ya hasheada - no recuperable)'
        }));
        const csv = stringify(rows, { header: true });
        res.setHeader('Content-Type', 'text/csv');
        res.setHeader('Content-Disposition', 'attachment; filename="alumnos_credenciales.csv"');
        res.send(csv);
    } catch (error) {
        logger.error('Error exporting CSV:', error);
        res.status(500).json({ error: 'Error exportando CSV' });
    }
});

// Configurar multer para subida de archivo CSV
const upload = multer({ dest: 'tmp/', limits: { fileSize: 5 * 1024 * 1024 } });

// Importar CSV masivo (solo admin)
router.post('/alumnos/import-csv', requireRole('admin'), upload.single('csv'), async (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({ error: 'No se subió archivo CSV' });
        }
        const fs = await import('fs');
        const content = fs.default.readFileSync(req.file.path, 'utf-8');
        const records = parse(content, { columns: true, skip_empty_lines: true, trim: true });

        let created = 0;
        const credentials = [];

        for (const rec of records) {
            const { num_control, username, nombre, carrera, telefono, email_alumno, domicilio, institucion_salud, num_seguro_social, comentario_ciudad } = rec;
            if (!num_control || !username) continue;

            // Verificar si usuario ya existe
            const [existing] = await pool.query('SELECT id FROM usuarios WHERE username = ? OR num_control = ?', [username, num_control]);
            if (existing.length > 0) {
                logger.debug(`Usuario ya existe: ${username}`);
                continue;
            }

            // PRIMERO: Crear/actualizar alumno (requerido por FK constraint)
            const [alumnoRows] = await pool.query('SELECT num_control FROM alumnos WHERE num_control = ?', [num_control]);
            if (alumnoRows.length > 0) {
                // Actualizar alumno existente
                await pool.query(
                    `UPDATE alumnos SET
                        nombre = COALESCE(NULLIF(?,''), nombre),
                        carrera = COALESCE(NULLIF(?,''), carrera),
                        telefono = COALESCE(NULLIF(?,''), telefono),
                        institucion_salud = COALESCE(NULLIF(?,''), institucion_salud),
                        num_seguro_social = COALESCE(NULLIF(?,''), num_seguro_social),
                        comentario_ciudad = COALESCE(NULLIF(?,''), comentario_ciudad),
                        domicilio = COALESCE(NULLIF(?,''), domicilio),
                        email_alumno = COALESCE(NULLIF(?,''), email_alumno)
                     WHERE num_control = ?`,
                    [nombre || '', carrera || '', telefono || '', institucion_salud || '', num_seguro_social || '', comentario_ciudad || '', domicilio || '', email_alumno || '', num_control]
                );
            } else if (nombre && carrera && telefono && domicilio && email_alumno && institucion_salud) {
                // Crear nuevo alumno con todos los campos requeridos
                await pool.query(
                    `INSERT INTO alumnos (num_control, nombre, carrera, telefono, domicilio, email_alumno, institucion_salud, num_seguro_social, comentario_ciudad)
                     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                    [num_control, nombre, carrera, telefono, domicilio, email_alumno, institucion_salud, num_seguro_social || null, comentario_ciudad || null]
                );
            } else {
                // Faltan campos requeridos para crear alumno
                logger.warn(`Saltando ${num_control}: faltan campos requeridos para crear alumno`);
                continue;
            }

            // SEGUNDO: Crear usuario (ahora el FK de num_control existe)
            const password = generatePassword(12);
            const hashed = await hashPassword(password);
            await pool.query('INSERT INTO usuarios (username, password, rol, num_control) VALUES (?, ?, ?, ?)', [username, hashed, 'alumno', num_control]);

            credentials.push({ num_control, username, password });
            created++;
        }

        // Eliminar archivo temporal
        fs.default.unlinkSync(req.file.path);

        // Generar CSV con credenciales en texto plano
        const csvOut = stringify(credentials, { header: true });

        logger.info(`CSV importado: ${created} usuarios creados`);
        
        // Devolver CSV con credenciales para descarga
        res.setHeader('Content-Type', 'text/csv; charset=utf-8');
        res.setHeader('Content-Disposition', `attachment; filename="credenciales_${Date.now()}.csv"`);
        res.send(csvOut);
    } catch (error) {
        logger.error('Error importing CSV:', error);
        res.status(500).json({ error: 'Error importando CSV' });
    }
});

export default router;