import pool from '../database.js';
import logger from '../lib/logger.js';

/**
 * Middleware to check username-based rate limiting
 * Limits login attempts per username to prevent credential stuffing
 */
export async function usernameRateLimiter(req, res, next) {
    const { username } = req.body;

    // Skip if no username provided (will be caught by validation later)
    if (!username) {
        return next();
    }

    try {
        // Check attempts in last 15 minutes for this username
        const [rows] = await pool.query(
            `SELECT COUNT(*) as attempt_count 
             FROM login_attempts 
             WHERE username = ? 
             AND attempt_time > DATE_SUB(NOW(), INTERVAL 15 MINUTE)`,
            [username]
        );

        const attemptCount = rows[0].attempt_count;

        // If 5 or more attempts, block the request
        if (attemptCount >= 5) {
            logger.warn('Username rate limit exceeded', {
                username,
                ip: req.ip,
                attempts: attemptCount
            });

            return res.status(429).render('login.hbs', {
                error: `Demasiados intentos de inicio de sesión para este usuario. Por favor, intente de nuevo en 15 minutos.`
            });
        }

        // Allow the request to proceed
        next();

    } catch (error) {
        logger.error('Error checking username rate limit:', error);
        // On error, allow the request (fail open to avoid blocking legitimate users)
        next();
    }
}

/**
 * Record a failed login attempt for rate limiting
 * @param {string} username - Username that failed login
 * @param {string} ipAddress - IP address of the attempt
 */
export async function recordLoginAttempt(username, ipAddress) {
    try {
        await pool.query(
            'INSERT INTO login_attempts (username, ip_address) VALUES (?, ?)',
            [username, ipAddress]
        );

        logger.debug('Recorded login attempt', { username, ip: ipAddress });

    } catch (error) {
        logger.error('Error recording login attempt:', error);
        // Don't throw - this is a non-critical operation
    }
}

/**
 * Clear login attempts for a username (called on successful login)
 * @param {string} username - Username to clear attempts for
 */
export async function clearLoginAttempts(username) {
    try {
        await pool.query(
            'DELETE FROM login_attempts WHERE username = ?',
            [username]
        );

        logger.debug('Cleared login attempts', { username });

    } catch (error) {
        logger.error('Error clearing login attempts:', error);
        // Don't throw - this is a non-critical operation
    }
}
