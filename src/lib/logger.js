import winston from 'winston';

const { combine, timestamp, printf, colorize, errors } = winston.format;

// Custom format for console output
const consoleFormat = printf(({ level, message, timestamp, stack }) => {
    if (stack) {
        return `${timestamp} [${level}]: ${message}\n${stack}`;
    }
    return `${timestamp} [${level}]: ${message}`;
});

// Create logger instance
const logger = winston.createLogger({
    level: process.env.NODE_ENV === 'production' ? 'info' : 'debug',
    format: combine(
        errors({ stack: true }),
        timestamp({ format: 'YYYY-MM-DD HH:mm:ss' })
    ),
    transports: [
        // Console transport
        new winston.transports.Console({
            format: combine(
                colorize(),
                consoleFormat
            )
        }),
        // File transport for errors
        new winston.transports.File({
            filename: 'error.log',
            level: 'error',
            format: combine(
                timestamp(),
                winston.format.json()
            )
        }),
        // File transport for all logs
        new winston.transports.File({
            filename: 'combined.log',
            format: combine(
                timestamp(),
                winston.format.json()
            )
        })
    ]
});

// Don't log sensitive data in production
logger.sanitize = (data) => {
    if (typeof data === 'object' && data !== null) {
        const sanitized = { ...data };
        const sensitiveFields = ['password', 'token', 'secret', 'authorization'];
        
        for (const field of sensitiveFields) {
            if (field in sanitized) {
                sanitized[field] = '[REDACTED]';
            }
        }
        return sanitized;
    }
    return data;
};

export default logger;
