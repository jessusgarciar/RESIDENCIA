import logger from '../lib/logger.js';

/**
 * Middleware to check if user is authenticated
 */
export function requireAuth(req, res, next) {
    if (!req.session || !req.session.usuario) {
        logger.warn('Unauthorized access attempt', {
            ip: req.ip,
            path: req.path
        });
        return res.status(401).redirect('/login');
    }
    next();
}

/**
 * Middleware to check if user has specific role
 * @param {string[]} allowedRoles - Array of allowed roles
 */
export function requireRole(...allowedRoles) {
    return (req, res, next) => {
        if (!req.session || !req.session.rol) {
            logger.warn('Unauthorized access attempt - no role', {
                ip: req.ip,
                path: req.path
            });
            return res.status(401).redirect('/login');
        }

        if (!allowedRoles.includes(req.session.rol)) {
            logger.warn('Forbidden access attempt', {
                ip: req.ip,
                path: req.path,
                role: req.session.rol,
                requiredRoles: allowedRoles
            });
            return res.status(403).send('Acceso denegado');
        }

        next();
    };
}

/**
 * Middleware to check if user is admin or jefe_departamento
 */
export const requireAdmin = requireRole('admin', 'jefe_departamento');

/**
 * Middleware to check if user is alumno
 */
export const requireAlumno = requireRole('alumno');
