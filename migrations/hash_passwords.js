import pool from '../src/database.js';
import { hashPassword } from '../src/lib/password.js';
import logger from '../src/lib/logger.js';

/**
 * Migration script to hash all existing plain-text passwords
 * 
 * WARNING: This is a one-way migration. Make sure you have a database backup!
 * 
 * Usage: node migrations/hash_passwords.js
 */

async function migratePasswords() {
    let connection;
    
    try {
        logger.info('Starting password migration...');
        
        connection = await pool.getConnection();
        
        // Start transaction
        await connection.beginTransaction();
        
        // Get all users
        const [users] = await connection.query('SELECT id, username, password FROM usuarios');
        
        logger.info(`Found ${users.length} users to migrate`);
        
        let migratedCount = 0;
        let skippedCount = 0;
        
        for (const user of users) {
            // Check if password is already hashed (bcrypt hashes start with $2a$, $2b$, or $2y$)
            if (user.password && user.password.match(/^\$2[aby]\$/)) {
                logger.debug(`Skipping user ${user.username} - password already hashed`);
                skippedCount++;
                continue;
            }
            
            // Hash the password
            const hashedPassword = await hashPassword(user.password);
            
            // Update the user
            await connection.query(
                'UPDATE usuarios SET password = ? WHERE id = ?',
                [hashedPassword, user.id]
            );
            
            logger.debug(`Migrated password for user: ${user.username}`);
            migratedCount++;
        }
        
        // Commit transaction
        await connection.commit();
        
        logger.info('Password migration completed successfully!');
        logger.info(`Migrated: ${migratedCount} users`);
        logger.info(`Skipped: ${skippedCount} users (already hashed)`);
        
        return { success: true, migrated: migratedCount, skipped: skippedCount };
        
    } catch (error) {
        // Rollback on error
        if (connection) {
            await connection.rollback();
        }
        
        logger.error('Password migration failed:', error);
        throw error;
        
    } finally {
        if (connection) {
            connection.release();
        }
        // Close the pool to allow the script to exit
        await pool.end();
    }
}

// Run migration
migratePasswords()
    .then((result) => {
        console.log('✅ Migration completed successfully!');
        console.log(`   Migrated: ${result.migrated} users`);
        console.log(`   Skipped: ${result.skipped} users`);
        process.exit(0);
    })
    .catch((error) => {
        console.error('❌ Migration failed:', error.message);
        process.exit(1);
    });
