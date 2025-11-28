import { Router } from "express";
import pool from "../database.js";
import sanitizeData from "../lib/sanitize.js";
import logger from "../lib/logger.js";

const router = Router();

const isAutoIncrement = (column = {}) => String(column.Extra || '').toLowerCase().includes('auto_increment');

const prettifyLabel = (fieldName = '') => fieldName
    .split('_')
    .map(part => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');

const parseEnumOptions = (rawType = '') => {
    const match = rawType.match(/^enum\((.*)\)$/i);
    if (!match) return [];
    return match[1]
        .split(/,(?=(?:[^']*'[^']*')*[^']*$)/) // split on commas that are not inside quotes
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

const getAsesorFormColumns = async () => {
    const [columns] = await pool.query('SHOW FULL COLUMNS FROM asesores');
    return (columns || [])
        .filter((column) => !isAutoIncrement(column))
        .map(buildInputMeta);
};

router.get('/asesores', async (req, res) => {
    try {
        // Get asesores and aggregate distinct carreras from alumnos where they are listed as rfc_asesor
        const [asesores] = await pool.query(
            `SELECT a.rfc, a.nombre, COALESCE(a.carrera, GROUP_CONCAT(DISTINCT al.carrera SEPARATOR ', ')) AS carreras
             FROM asesores a
             LEFT JOIN alumnos al ON al.rfc_asesor = a.rfc
             GROUP BY a.rfc, a.nombre, a.carrera
             ORDER BY a.nombre`);

        const { created } = req.query;
        const successMessage = created ? 'Asesor agregado correctamente.' : null;

        res.render('asesores/asesores.hbs', {
            asesores,
            successMessage
        });
    } catch (error) {
        logger.error('Error listing asesores:', error);
        res.status(500).send('Error en el servidor');
    }
});

router.get('/asesores/nuevo', async (req, res) => {
    try {
        const formColumns = await getAsesorFormColumns();
        res.render('asesores/addasesor.hbs', {
            formColumns,
            formData: {},
            errorMessage: null
        });
    } catch (error) {
        logger.error('Error loading asesor form:', error);
        res.status(500).send('Error en el servidor');
    }
});

router.post('/asesores', async (req, res) => {
    try {
        const formColumns = await getAsesorFormColumns();
        const body = sanitizeData(req.body || {});

        const fields = [];
        const placeholders = [];
        const values = [];
        const missing = [];

        formColumns.forEach((column) => {
            let value = body[column.name];
            const empty = value === undefined || value === '';

            if (empty) {
                if (column.required) missing.push(column.label);
                return;
            }

            if (column.inputType === 'number' && value !== '') {
                const numericValue = Number(value);
                if (!Number.isNaN(numericValue)) {
                    value = numericValue;
                }
            }

            fields.push(`\`${column.name}\``);
            placeholders.push('?');
            values.push(value);
        });

        if (missing.length) {
            return res.status(400).render('asesores/addasesor.hbs', {
                formColumns,
                formData: body,
                errorMessage: `Completa los campos obligatorios: ${missing.join(', ')}`
            });
        }

        if (!fields.length) {
            return res.status(400).render('asesores/addasesor.hbs', {
                formColumns,
                formData: body,
                errorMessage: 'Debes proporcionar al menos un campo para registrar al asesor.'
            });
        }

        const sql = `INSERT INTO asesores (${fields.join(', ')}) VALUES (${placeholders.join(', ')})`;
        await pool.query(sql, values);

        res.redirect('/asesores?created=1');
    } catch (error) {
        logger.error('Error creating asesor:', error);
        if (error?.code === 'ER_DUP_ENTRY') {
            try {
                const formColumns = await getAsesorFormColumns();
                return res.status(400).render('asesores/addasesor.hbs', {
                    formColumns,
                    formData: sanitizeData(req.body || {}),
                    errorMessage: 'Ya existe un asesor con los datos proporcionados. Verifica el RFC y vuelve a intentar.'
                });
            } catch (innerErr) {
                logger.error('Error rendering duplicate entry form:', innerErr);
            }
        }
        res.status(500).send('Error en el servidor');
    }
});

export default router;