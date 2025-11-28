/**
 * Script para verificar y corregir num_control en tabla usuarios
 * Ejecutar con: node scripts/fix_num_control.js
 */

import pool from '../src/database.js';
import dotenv from 'dotenv';

dotenv.config();

async function fixNumControl() {
    console.log('\n=== VERIFICACIÓN Y CORRECCIÓN DE NUM_CONTROL ===\n');

    try {
        // 1. Verificar usuarios sin num_control
        console.log('1. Buscando usuarios sin num_control...');
        const [usuariosSinNumControl] = await pool.query(`
            SELECT u.id, u.username, u.rol
            FROM usuarios u
            WHERE u.rol = 'alumno' AND (u.num_control IS NULL OR u.num_control = '')
        `);

        if (usuariosSinNumControl.length > 0) {
            console.log(`   ⚠️  Encontrados ${usuariosSinNumControl.length} usuarios alumno sin num_control:`);
            usuariosSinNumControl.forEach(u => {
                console.log(`   - ${u.username} (ID: ${u.id})`);
            });

            // 2. Intentar encontrar num_control en tabla alumnos por username
            console.log('\n2. Intentando encontrar num_control en tabla alumnos...');
            for (const usuario of usuariosSinNumControl) {
                // Buscar por username (asumiendo que username podría ser el num_control)
                const [alumnoByUsername] = await pool.query(
                    'SELECT num_control, nombre FROM alumnos WHERE num_control = ?',
                    [usuario.username]
                );

                if (alumnoByUsername.length > 0) {
                    const alumno = alumnoByUsername[0];
                    console.log(`   ✓ Encontrado: ${usuario.username} → ${alumno.nombre}`);
                    
                    // Actualizar usuario con num_control
                    await pool.query(
                        'UPDATE usuarios SET num_control = ? WHERE id = ?',
                        [alumno.num_control, usuario.id]
                    );
                    console.log(`   ✅ Actualizado num_control para ${usuario.username}`);
                } else {
                    console.log(`   ❌ No se encontró alumno para username: ${usuario.username}`);
                    console.log(`      Necesitas crear el registro en tabla alumnos o verificar el username`);
                }
            }
        } else {
            console.log('   ✓ Todos los usuarios alumno tienen num_control');
        }

        // 3. Verificar que todos los alumnos tengan usuario
        console.log('\n3. Verificando alumnos sin usuario...');
        const [alumnosSinUsuario] = await pool.query(`
            SELECT a.num_control, a.nombre
            FROM alumnos a
            LEFT JOIN usuarios u ON u.num_control = a.num_control
            WHERE u.id IS NULL
            LIMIT 10
        `);

        if (alumnosSinUsuario.length > 0) {
            console.log(`   ⚠️  Encontrados ${alumnosSinUsuario.length} alumnos sin usuario:`);
            alumnosSinUsuario.forEach(a => {
                console.log(`   - ${a.num_control}: ${a.nombre}`);
            });
            console.log('\n   Estos alumnos necesitan que se les cree un usuario.');
        } else {
            console.log('   ✓ Todos los alumnos tienen usuario');
        }

        // 4. Mostrar resumen final
        console.log('\n4. Resumen final:');
        const [resumen] = await pool.query(`
            SELECT 
                u.username,
                u.rol,
                u.num_control,
                a.nombre,
                a.carrera
            FROM usuarios u
            LEFT JOIN alumnos a ON u.num_control = a.num_control
            WHERE u.rol = 'alumno'
            LIMIT 10
        `);

        console.log('\n   Usuarios alumno en el sistema:');
        resumen.forEach(r => {
            if (r.nombre) {
                console.log(`   ✓ ${r.username} (${r.num_control}) → ${r.nombre} - ${r.carrera}`);
            } else {
                console.log(`   ⚠️  ${r.username} - SIN DATOS EN TABLA ALUMNOS`);
            }
        });

        console.log('\n=== VERIFICACIÓN COMPLETADA ===\n');

    } catch (error) {
        console.error('\n❌ Error:', error);
    } finally {
        await pool.end();
    }
}

fixNumControl();
