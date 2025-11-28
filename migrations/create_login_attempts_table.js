import mysql from 'mysql2/promise';
import dotenv from 'dotenv';

dotenv.config();

async function createLoginAttemptsTable() {
    const connection = await mysql.createConnection({
        host: process.env.DB_HOST,
        user: process.env.DB_USER,
        password: process.env.DB_PASSWORD,
        database: process.env.DB_NAME
    });

    try {
        console.log('Creating login_attempts table...');

        // Create the login_attempts table
        await connection.query(`
            CREATE TABLE IF NOT EXISTS login_attempts (
                id INT AUTO_INCREMENT PRIMARY KEY,
                username VARCHAR(50) NOT NULL,
                ip_address VARCHAR(45) NOT NULL,
                attempt_time TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                INDEX idx_username_time (username, attempt_time),
                INDEX idx_attempt_time (attempt_time)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
        `);

        console.log('✓ login_attempts table created successfully');

        // Create a cleanup event to automatically delete old attempts
        await connection.query(`
            CREATE EVENT IF NOT EXISTS cleanup_old_login_attempts
            ON SCHEDULE EVERY 1 HOUR
            DO
                DELETE FROM login_attempts 
                WHERE attempt_time < DATE_SUB(NOW(), INTERVAL 15 MINUTE)
        `);

        console.log('✓ Cleanup event created successfully');
        console.log('✓ Migration completed successfully!');

    } catch (error) {
        console.error('Error creating login_attempts table:', error);
        throw error;
    } finally {
        await connection.end();
    }
}

// Run the migration
createLoginAttemptsTable()
    .then(() => {
        console.log('Migration finished');
        process.exit(0);
    })
    .catch((error) => {
        console.error('Migration failed:', error);
        process.exit(1);
    });
