#!/usr/bin/env node
import { join } from 'path';
import fs from 'fs';
import { renderDocxToPdf } from '../src/lib/docx.js';

(async () => {
  try {
    const timestamp = Date.now();
    const outDir = join(process.cwd(), 'src', 'public', 'pdfs');
    if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });

    const data = {
      nombre_estudiante: 'Alumno Prueba',
      num_control: 'TEST123',
      carrera: 'Ingeniería en Sistemas',
      periodo_residencias: 'enero-agosto',
      nombre_proyecto: 'Proyecto de Prueba',
      empresa_nombre: 'Empresa Demo',
      giro: 'Sistemas',
      domicilio_telefono: 'Calle Falsa 123 | 555-0101',
      actividades_empresa: 'Desarrollo de software',
      asesor_empresa: 'Asesor Demo',
      puesto_asesor_empresa: 'Gerente',
      contacto_empresa: 'contacto@demo.com',
      descripcion_actividades: 'Descripción de actividades de prueba para el cronograma.',
      cronograma_json: [{ descripcion: 'Actividad 1', meses: [1, 2] }, { descripcion: 'Actividad 2', meses: [6,7,8] }]
    };

    const templates = [
      { tpl: join(process.cwd(), 'REPORTE_PRELIMINAR.docx'), out: join(outDir, `${data.num_control}_preliminar_${timestamp}.pdf`) },
      { tpl: join(process.cwd(), 'SOLICITUD_RESIDENCIAS.docx'), out: join(outDir, `${data.num_control}_solicitud_${timestamp}.pdf`) }
    ];

    for (const t of templates) {
      console.log('Rendering template:', t.tpl);
      if (!fs.existsSync(t.tpl)) {
        console.warn('Template not found:', t.tpl);
        continue;
      }
      const r = await renderDocxToPdf(t.tpl, data, t.out);
      console.log('Result:', r);
    }

    console.log('Done. Check src/public/pdfs for output.');
  } catch (e) {
    console.error('Error generating sample docs:', e);
    process.exitCode = 1;
  }
})();
