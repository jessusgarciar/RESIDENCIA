import { Router } from "express";
import pool from "../database.js";
import sanitizeData from "../lib/sanitize.js";
import logger from "../lib/logger.js";

const router = Router();

const isAutoIncrement = (column = {}) => String(column.Extra || '').toLowerCase().includes('auto_increment');
const prettifyLabel = (fieldName = '') => fieldName.split('_').map(part => part.charAt(0).toUpperCase() + part.slice(1)).join(' ');
const parseEnumOptions = (rawType = '') => {
    const match = rawType.match(/^enum\((.*)\)$/i);
    if (!match) return [];
    return match[1]
        .split(/,(?=(?:[^']*'[^']*')*[^']*$)/)
        .map(opt => opt.trim().replace(/^'(.*)'$/, '$1'))
        .filter(Boolean);
};

const buildInputMeta = (column) => {
    const rawType = String(column.Type || '').toLowerCase();
    const required = column.Null === 'NO' && column.Default === null && !isAutoIncrement(column);
    const meta = {
        name: column.Field,
        label: prettifyLabel(column.Field),
        required,
        rawType,
        inputType: 'text',
        maxLength: null,
        step: null,
        options: null,
        isTextArea: false
    };

    if (rawType.startsWith('enum(')) {
        meta.options = parseEnumOptions(rawType);
        meta.inputType = 'select';
    } else if (rawType.includes('text') || rawType.includes('json') || rawType.includes('blob')) {
        meta.isTextArea = true;
    } else if (rawType.includes('int') || rawType.includes('decimal') || rawType.includes('float') || rawType.includes('double')) {
        meta.inputType = 'number';
        if (rawType.includes('decimal') || rawType.includes('float') || rawType.includes('double')) meta.step = '0.01';
    } else if (rawType.startsWith('date')) {
        meta.inputType = 'date';
    } else if (rawType.startsWith('datetime') || rawType.startsWith('timestamp')) {
        meta.inputType = 'datetime-local';
    } else if (rawType.startsWith('time')) {
        meta.inputType = 'time';
    } else if (rawType.includes('char')) {
        meta.inputType = 'text';
        const lengthMatch = rawType.match(/\((\d+)\)/);
        if (lengthMatch) meta.maxLength = Number(lengthMatch[1]);
    }

    return meta;
};

const getEmpresaFormColumns = async () => {
    const [columns] = await pool.query('SHOW FULL COLUMNS FROM empresas');
    return (columns || []).filter(c => !isAutoIncrement(c)).map(buildInputMeta);
};

router.get('/empresas/insertar', async (req, res) => {
    try {
        const formColumns = await getEmpresaFormColumns();
        res.render('empresas/addempresa_dynamic.hbs', { formColumns, formData: {}, errorMessage: null });
    } catch (error) {
        console.log(error);
        res.status(500).send('Error en el servidor');
    }
});

router.post('/empresas/insertar', async (req, res) => {
    try {
        const formColumns = await getEmpresaFormColumns();
        const body = sanitizeData(req.body || {});

        const fields = [];
        const placeholders = [];
        const values = [];
        const missing = [];

        formColumns.forEach((col) => {
            const raw = body[col.name];
            const empty = raw === undefined || raw === '';
            if (empty) {
                if (col.required) missing.push(col.label);
                return;
            }
            let value = raw;
            if (col.inputType === 'number') {
                const n = Number(value);
                value = Number.isNaN(n) ? value : n;
            }
            fields.push(`\`${col.name}\``);
            placeholders.push('?');
            values.push(value);
        });

        if (missing.length) {
            return res.status(400).render('empresas/addempresa_dynamic.hbs', { formColumns, formData: body, errorMessage: `Completa los campos obligatorios: ${missing.join(', ')}` });
        }

        if (!fields.length) return res.status(400).render('empresas/addempresa_dynamic.hbs', { formColumns, formData: body, errorMessage: 'Proporciona al menos un campo' });

        const sql = `INSERT INTO empresas (${fields.join(',')}) VALUES (${placeholders.join(',')})`;
        await pool.query(sql, values);
        res.redirect('/empresas?created=1');
    } catch (error) {
        logger.error('Error inserting empresa:', error);
        if (error?.code === 'ER_DUP_ENTRY') {
            const formColumns = await getEmpresaFormColumns();
            return res.status(400).render('empresas/addempresa_dynamic.hbs', { formColumns, formData: sanitizeData(req.body || {}), errorMessage: 'Ya existe un registro duplicado. Verifica y vuelve a intentar.' });
        }
        res.status(500).send('Error en el servidor');
    }
});

router.get('/empresas' , async (req, res) => {
    try {
        const [rows] = await pool.query('SELECT * FROM empresas');
        res.render('empresas/empresas.hbs', { empresas: rows });
    } catch (error) {
        logger.error('Error listing empresas:', error);
        res.status(500).send('Error en el servidor');
    }
});

// Dynamic edit route: renders the dynamic edit form using formColumns and formData
router.get('/empresas/edit_dynamic/:id' , async (req, res) => {
    try {
        const { id } = req.params;
        const [rows] = await pool.query('SELECT * FROM empresas WHERE id = ?', [id]);
        const empresa = rows[0];
        if (!empresa) return res.status(404).send('Empresa no encontrada');
        // Build formColumns metadata
        const formColumns = await getEmpresaFormColumns();
        // Prepare formData: prefer empresa_sector if available, fallback to giro_sector
        const formData = Object.assign({}, empresa);
        if (!formData.empresa_sector && formData.giro_sector) formData.empresa_sector = formData.giro_sector;
        res.render('empresas/editempresa_dynamic.hbs', { formColumns, formData, errorMessage: null });
    } catch (error) {
        logger.error('Error loading empresa for edit:', error);
        res.status(500).send('Error en el servidor');
    }
});

router.get('/empresas/edit/:id' , async (req, res) => {
    try {
        const { id } = req.params;
        const [rows] = await pool.query('SELECT * FROM empresas WHERE id = ?', [id]);
        const empresaEditar = rows[0];
        res.render('empresas/editempresa.hbs', { rows: empresaEditar });
    } catch (error) {
        logger.error('Error loading empresa for edit (legacy):', error);
        res.status(500).send('Error en el servidor');
    }
});

router.post('/empresas/edit/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const body = sanitizeData(req.body || {});
        // Accept empresa_sector (from dynamic forms) but keep compatibility with giro_sector/giro fields
        const nombre = body.nombre;
        const atencion_a = body.atencion_a;
        const giroVal = body.empresa_sector || body.giro_sector || body.giro || '';
        const domicilio = body.domicilio;
        const colonia = body.colonia;
        const ciudad = body.ciudad;
        const mision = body.mision;
        const codigo_postal = body.codigo_postal;
        const titular_nombre = body.titular_nombre;
        const titular_puesto = body.titular_puesto;
        const firmante_nombre = body.firmante_nombre;
        const firmante_puesto = body.firmante_puesto;

        await pool.query('UPDATE empresas SET nombre = ?, atencion_a = ?, giro_sector = ?, domicilio = ?, colonia = ?, ciudad = ?, mision = ?, codigo_postal = ?, titular_nombre = ?, titular_puesto = ?, firmante_nombre = ?, firmante_puesto = ? WHERE id = ?', [nombre, atencion_a, giroVal, domicilio, colonia, ciudad, mision, codigo_postal, titular_nombre, titular_puesto, firmante_nombre, firmante_puesto, id]);
        // Also attempt to write to empresa_sector column (if present) for compatibility with dynamic forms
        try {
            await pool.query('UPDATE empresas SET empresa_sector = ? WHERE id = ?', [giroVal, id]);
        } catch (e) {
            // ignore if column doesn't exist
        }
        res.redirect('/empresas');
    } catch (error) {
        logger.error('Error updating empresa:', error);
        res.status(500).send('Error en el servidor');
    }
});

router.get('/empresas/delete/:id' , async (req, res) => {
    try {
        const { id } = req.params;
        await pool.query('DELETE FROM empresas WHERE id = ?', [id]);
        res.redirect('/empresas');
    } catch (error) {
        logger.error('Error deleting empresa:', error);
        res.status(500).send('Error en el servidor');
    }
});



export default router;