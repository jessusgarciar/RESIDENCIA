import { Router } from "express";
import pool from "../database.js";
import sanitizeData from "../lib/sanitize.js";
import { comparePassword } from "../lib/password.js";
import { loginLimiter } from "../middleware/rateLimiter.js";
import { usernameRateLimiter, recordLoginAttempt, clearLoginAttempts } from "../middleware/usernameRateLimiter.js";
import logger from "../lib/logger.js";

const router = Router();

router.get('/login', (req, res) => {
    try {
        res.render('login.hbs');
    } catch (error) {
        logger.error('Error rendering login page:', error);
        res.status(500).send('Error en el servidor');
    }
});

router.post('/login', loginLimiter, usernameRateLimiter, async (req, res) => {
    try {
        const body = sanitizeData(req.body || {});
        const { username, password } = body;

        if (!username || !password) {
            return res.render('login.hbs', { error: 'Usuario y contraseña son requeridos' });
        }

        // Query user by username only
        const [rows] = await pool.query('SELECT * FROM usuarios WHERE username = ?', [username]);
        
        if (rows.length === 0) {
            logger.warn('Login attempt with non-existent username', { username, ip: req.ip });
            // Record failed attempt
            await recordLoginAttempt(username, req.ip);
            return res.render('login.hbs', { error: 'Usuario o contraseña incorrectos' });
        }

        const user = rows[0];
        
        // Compare password with hash
        const isPasswordValid = await comparePassword(password, user.password);
        
        if (!isPasswordValid) {
            logger.warn('Login attempt with incorrect password', { username, ip: req.ip });
            // Record failed attempt
            await recordLoginAttempt(username, req.ip);
            return res.render('login.hbs', { error: 'Usuario o contraseña incorrectos' });
        }

        // Successful login - clear any previous failed attempts
        await clearLoginAttempts(username);
        logger.info('Successful login', { username, rol: user.rol });

        // Only set num_control on session for alumnos
        if (user.rol === 'alumno' && user.num_control) {
            req.session.num_control = user.num_control;
        } else {
            // Ensure we don't carry a previous alumno num_control when logging in as admin/jefe
            delete req.session.num_control;
        }
        
        req.session.usuario = user.username;
        req.session.rol = user.rol;
        
        // Redirect based on role
        if (user.rol === 'jefe_departamento' || user.rol === 'admin') {
            return res.redirect('/admin/solicitudes');
        }
        
        // Default for alumnos and others
        return res.redirect('/');
        
    } catch (error) {
        logger.error('Error during login:', error);
        res.status(500).send('Error en el servidor');
    }
});

router.get('/logout', (req, res) => {
    const username = req.session?.usuario;
    req.session.destroy((err) => {
        if (err) {
            logger.error('Error during logout:', err);
            return res.status(500).send('Error al cerrar sesión');
        }
        logger.info('User logged out', { username });
        res.redirect('/');
    });
});


export default router;