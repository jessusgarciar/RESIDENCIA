/**
 * Script rápido para verificar si un usuario puede ver el formulario
 * Simula lo que hace la ruta /forms
 */

import pool from '../src/database.js';
import dotenv from 'dotenv';

dotenv.config();

async function testFormData(username) {
    console.log(`\n=== PROBANDO CARGA DE DATOS PARA: ${username} ===\n`);

    try {
        // 1. Buscar usuario
        console.log('1. Buscando usuario...');
        const [usuarios] = await pool.query(
            'SELECT username, rol, num_control FROM usuarios WHERE username = ?',
            [username]
        );

        if (usuarios.length === 0) {
            console.log(`   ❌ Usuario "${username}" no encontrado`);
            return;
        }

        const usuario = usuarios[0];
        console.log(`   ✓ Usuario encontrado: ${usuario.username} (${usuario.rol})`);
        console.log(`   num_control en tabla usuarios: ${usuario.num_control || 'NULL'}`);

        // 2. Simular sesión
        const sessionNumControl = usuario.num_control;
        let effectiveNumControl = sessionNumControl;

        // 3. Fallback si no hay num_control
        if (!effectiveNumControl && usuario.rol === 'alumno') {
            console.log('\n2. num_control no encontrado, usando fallback...');
            const [userRows] = await pool.query(
                'SELECT num_control FROM usuarios WHERE username = ? AND rol = ?',
                [username, 'alumno']
            );
            if (userRows.length > 0 && userRows[0].num_control) {
                effectiveNumControl = userRows[0].num_control;
                console.log(`   ✓ Encontrado via fallback: ${effectiveNumControl}`);
            }
        } else {
            console.log(`\n2. num_control en sesión: ${effectiveNumControl}`);
        }

        // 4. Buscar datos del alumno
        if (effectiveNumControl) {
            console.log('\n3. Buscando datos del alumno...');
            const [alumnos] = await pool.query(
                'SELECT nombre, carrera, num_control, domicilio, email_alumno, telefono FROM alumnos WHERE num_control = ?',
                [effectiveNumControl]
            );

            if (alumnos.length > 0) {
                const alumno = alumnos[0];
                console.log(`   ✓ Alumno encontrado:`);
                console.log(`      Nombre: ${alumno.nombre}`);
                console.log(`      Carrera: ${alumno.carrera}`);
                console.log(`      Email: ${alumno.email_alumno || 'N/A'}`);
                console.log(`      Teléfono: ${alumno.telefono || 'N/A'}`);
                console.log(`      Domicilio: ${alumno.domicilio || 'N/A'}`);
                
                console.log('\n✅ EL FORMULARIO DEBERÍA MOSTRAR ESTOS DATOS');
            } else {
                console.log(`   ❌ No se encontró alumno con num_control: ${effectiveNumControl}`);
            }
        } else {
            console.log('\n❌ No se pudo obtener num_control - el formulario estará vacío');
        }

        // 5. Verificar carreras y empresas
        console.log('\n4. Verificando datos adicionales...');
        const [carreras] = await pool.query('SELECT COUNT(*) as total FROM carreras');
        const [empresas] = await pool.query('SELECT COUNT(*) as total FROM empresas');
        console.log(`   Carreras disponibles: ${carreras[0].total}`);
        console.log(`   Empresas disponibles: ${empresas[0].total}`);

        console.log('\n=== FIN DE LA PRUEBA ===\n');

    } catch (error) {
        console.error('\n❌ Error:', error);
    } finally {
        await pool.end();
    }
}

// Obtener username del argumento o usar default
const username = process.argv[2] || 'alumno1';
testFormData(username);
