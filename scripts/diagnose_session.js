/**
 * Script de diagnóstico para verificar el estado de la sesión y datos del formulario
 * 
 * Ejecutar con: node scripts/diagnose_session.js
 */

import pool from '../src/database.js';
import dotenv from 'dotenv';

dotenv.config();

async function diagnoseSession() {
    console.log('\n=== DIAGNÓSTICO DE SESIÓN Y FORMULARIO ===\n');

    try {
        // 1. Verificar tabla de usuarios
        console.log('1. Verificando tabla de usuarios...');
        const [usuarios] = await pool.query('SELECT username, rol, num_control FROM usuarios LIMIT 10');
        console.log(`   ✓ Encontrados ${usuarios.length} usuarios`);
        usuarios.forEach(u => {
            console.log(`   - ${u.username} (${u.rol}) - num_control: ${u.num_control || 'N/A'}`);
        });

        // 2. Verificar tabla de alumnos
        console.log('\n2. Verificando tabla de alumnos...');
        const [alumnos] = await pool.query('SELECT num_control, nombre, carrera, email_alumno FROM alumnos LIMIT 5');
        console.log(`   ✓ Encontrados ${alumnos.length} alumnos`);
        alumnos.forEach(a => {
            console.log(`   - ${a.num_control}: ${a.nombre} (${a.carrera})`);
        });

        // 3. Verificar relación usuarios-alumnos
        console.log('\n3. Verificando relación usuarios-alumnos...');
        const [relacion] = await pool.query(`
            SELECT u.username, u.rol, u.num_control, a.nombre, a.carrera
            FROM usuarios u
            LEFT JOIN alumnos a ON u.num_control = a.num_control
            WHERE u.rol = 'alumno'
            LIMIT 5
        `);
        console.log(`   ✓ Encontradas ${relacion.length} relaciones`);
        relacion.forEach(r => {
            if (r.nombre) {
                console.log(`   ✓ ${r.username} → ${r.nombre} (${r.carrera})`);
            } else {
                console.log(`   ⚠️  ${r.username} - NO TIENE DATOS EN TABLA ALUMNOS`);
            }
        });

        // 4. Verificar tabla de carreras
        console.log('\n4. Verificando tabla de carreras...');
        const [carreras] = await pool.query('SELECT id, nombre, coordinador FROM carreras');
        console.log(`   ✓ Encontradas ${carreras.length} carreras`);
        carreras.forEach(c => {
            console.log(`   - ${c.nombre}: ${c.coordinador || 'Sin coordinador'}`);
        });

        // 5. Verificar tabla de empresas
        console.log('\n5. Verificando tabla de empresas...');
        const [empresas] = await pool.query('SELECT id, nombre FROM empresas LIMIT 5');
        console.log(`   ✓ Encontradas ${empresas.length} empresas`);
        empresas.forEach(e => {
            console.log(`   - ${e.id}: ${e.nombre}`);
        });

        // 6. Verificar intentos de login recientes
        console.log('\n6. Verificando intentos de login recientes...');
        const [intentos] = await pool.query(`
            SELECT username, ip_address, attempt_time
            FROM login_attempts
            WHERE attempt_time > DATE_SUB(NOW(), INTERVAL 1 HOUR)
            ORDER BY attempt_time DESC
            LIMIT 10
        `);
        console.log(`   ✓ Encontrados ${intentos.length} intentos en la última hora`);
        intentos.forEach(i => {
            console.log(`   - ${i.username} desde ${i.ip_address} a las ${i.attempt_time}`);
        });

        console.log('\n=== DIAGNÓSTICO COMPLETADO ===\n');
        console.log('SOLUCIÓN RECOMENDADA:');
        console.log('Si el formulario no muestra datos:');
        console.log('1. Cerrar sesión en el navegador');
        console.log('2. Volver a iniciar sesión');
        console.log('3. La sesión nueva tendrá el num_control correcto\n');

    } catch (error) {
        console.error('\n❌ Error durante el diagnóstico:', error);
    } finally {
        await pool.end();
    }
}

diagnoseSession();
