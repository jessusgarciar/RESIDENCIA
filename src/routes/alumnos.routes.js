import { Router } from "express";
import pool from "../database.js";
import logger from "../lib/logger.js";

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

export default router;