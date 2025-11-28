import rateLimit from 'express-rate-limit';

// Rate limiter for login attempts
export const loginLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 15, // Limit each IP to 15 login requests per windowMs (increased for shared campus networks)
    message: 'Demasiados intentos de inicio de sesión desde esta red. Por favor, intente de nuevo más tarde.',
    standardHeaders: true,
    legacyHeaders: false,
});

// Rate limiter for API endpoints
export const apiLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 100, // Limit each IP to 100 requests per windowMs
    message: 'Demasiadas solicitudes. Por favor, intente de nuevo más tarde.',
    standardHeaders: true,
    legacyHeaders: false,
});

// Rate limiter for file uploads
export const uploadLimiter = rateLimit({
    windowMs: 60 * 60 * 1000, // 1 hour
    max: 20, // Limit each IP to 20 uploads per hour
    message: 'Demasiadas cargas de archivos. Por favor, intente de nuevo más tarde.',
    standardHeaders: true,
    legacyHeaders: false,
});
