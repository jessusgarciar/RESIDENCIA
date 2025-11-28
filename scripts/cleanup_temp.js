/**
 * Script para limpiar archivos temporales antiguos de LibreOffice
 * Ejecutar con: node scripts/cleanup_temp.js
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.join(__dirname, '..');

async function cleanupTempFiles() {
    console.log('\n=== LIMPIEZA DE ARCHIVOS TEMPORALES ===\n');

    const tmpDir = path.join(projectRoot, 'tmp');
    
    if (!fs.existsSync(tmpDir)) {
        console.log('✓ No hay carpeta tmp para limpiar');
        return;
    }

    try {
        const files = fs.readdirSync(tmpDir);
        console.log(`Encontrados ${files.length} archivos en tmp/`);

        let cleaned = 0;
        let failed = 0;

        for (const file of files) {
            const filePath = path.join(tmpDir, file);
            
            try {
                const stats = fs.statSync(filePath);
                const ageMinutes = (Date.now() - stats.mtimeMs) / 1000 / 60;
                
                // Delete files older than 5 minutes
                if (ageMinutes > 5) {
                    try {
                        fs.unlinkSync(filePath);
                        console.log(`✓ Eliminado: ${file} (${Math.round(ageMinutes)} min)`);
                        cleaned++;
                    } catch (err) {
                        if (err.code === 'EBUSY' || err.code === 'EPERM') {
                            console.warn(`⚠️  Bloqueado: ${file} (en uso por LibreOffice)`);
                            failed++;
                        } else {
                            console.error(`❌ Error: ${file} - ${err.message}`);
                            failed++;
                        }
                    }
                } else {
                    console.log(`  Reciente: ${file} (${Math.round(ageMinutes)} min)`);
                }
            } catch (err) {
                console.error(`❌ Error al verificar ${file}:`, err.message);
            }
        }

        console.log(`\n=== RESUMEN ===`);
        console.log(`Archivos eliminados: ${cleaned}`);
        console.log(`Archivos bloqueados: ${failed}`);
        console.log(`Total procesados: ${files.length}`);

        if (failed > 0) {
            console.log('\n⚠️  Algunos archivos están bloqueados por LibreOffice.');
            console.log('   Esto es normal si hay conversiones en proceso.');
            console.log('   Ejecuta este script nuevamente más tarde.');
        }

    } catch (error) {
        console.error('\n❌ Error durante la limpieza:', error);
    }
}

cleanupTempFiles();
