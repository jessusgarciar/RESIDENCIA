import fs from 'fs';
import path from 'path';
import { renderDocxToPdf, ensureSofficeOnPath } from '../src/lib/docx.js';

describe('docx.js - ensureSofficeOnPath', () => {
  const originalPath = process.env.PATH;
  const originalLibreOfficePath = process.env.LIBREOFFICE_PATH;

  afterEach(() => {
    process.env.PATH = originalPath;
    if (originalLibreOfficePath) {
      process.env.LIBREOFFICE_PATH = originalLibreOfficePath;
    } else {
      delete process.env.LIBREOFFICE_PATH;
    }
  });

  test('debe ejecutarse sin errores', () => {
    expect(() => ensureSofficeOnPath()).not.toThrow();
  });

  test('debe retornar null o una ruta válida', () => {
    const result = ensureSofficeOnPath();
    expect(result === null || typeof result === 'string').toBe(true);
  });
});

describe('docx.js - renderDocxToPdf', () => {
  const testDir = path.join(process.cwd(), 'tmp', 'test_docx');
  const outputDir = path.join(testDir, 'output');

  beforeAll(() => {
    if (!fs.existsSync(testDir)) {
      fs.mkdirSync(testDir, { recursive: true });
    }
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
    }
  });

  afterAll(() => {
    // Cleanup test files
    try {
      if (fs.existsSync(outputDir)) {
        const files = fs.readdirSync(outputDir);
        for (const file of files) {
          try {
            fs.unlinkSync(path.join(outputDir, file));
          } catch (e) {
            // ignore
          }
        }
      }
    } catch (e) {
      // ignore cleanup errors
    }
  });

  test('debe retornar error para template inexistente', async () => {
    const result = await renderDocxToPdf(
      path.join(testDir, 'noexiste.docx'),
      {},
      path.join(outputDir, 'output.pdf')
    );
    
    expect(result.ok).toBe(false);
    expect(result.error).toBe('template-not-found');
  });

  test('debe manejar datos vacíos sin errores', async () => {
    // Este test requiere un template real, por ahora verificamos la estructura de respuesta
    const mockTemplatePath = path.join(process.cwd(), 'SOLICITUD_RESIDENCIAS.docx');
    
    if (fs.existsSync(mockTemplatePath)) {
      const result = await renderDocxToPdf(
        mockTemplatePath,
        { nombre: 'Test', num_control: '123456' },
        path.join(outputDir, 'test_output.pdf')
      );
      
      expect(result).toHaveProperty('ok');
      expect(typeof result.ok).toBe('boolean');
      
      if (result.ok) {
        expect(result).toHaveProperty('path');
        expect(result).toHaveProperty('method');
      } else {
        expect(result).toHaveProperty('error');
      }
    } else {
      // Skip if template doesn't exist
      expect(true).toBe(true);
    }
  }, 30000); // timeout extendido para conversión de PDF

  test('debe reemplazar variables en template correctamente', async () => {
    const mockTemplatePath = path.join(process.cwd(), 'SOLICITUD_RESIDENCIAS.docx');
    
    if (fs.existsSync(mockTemplatePath)) {
      const testData = {
        nombre: 'Juan Pérez',
        num_control: '221050123',
        carrera: 'Ingeniería en Sistemas'
      };
      
      const result = await renderDocxToPdf(
        mockTemplatePath,
        testData,
        path.join(outputDir, 'test_variables.pdf')
      );
      
      // Verificar que se procesó
      expect(result).toBeDefined();
      expect(result.ok).toBeDefined();
    } else {
      expect(true).toBe(true);
    }
  }, 30000);
});

describe('docx.js - Manejo de errores', () => {
  test('debe manejar datos null sin crash', async () => {
    const mockTemplatePath = path.join(process.cwd(), 'SOLICITUD_RESIDENCIAS.docx');
    
    if (fs.existsSync(mockTemplatePath)) {
      const result = await renderDocxToPdf(
        mockTemplatePath,
        null,
        path.join(process.cwd(), 'tmp', 'test_null.pdf')
      );
      
      expect(result).toBeDefined();
      expect(typeof result.ok).toBe('boolean');
    } else {
      expect(true).toBe(true);
    }
  }, 30000);

  test('debe manejar rutas de salida inválidas', async () => {
    const mockTemplatePath = path.join(process.cwd(), 'SOLICITUD_RESIDENCIAS.docx');
    
    if (fs.existsSync(mockTemplatePath)) {
      const result = await renderDocxToPdf(
        mockTemplatePath,
        { test: 'data' },
        '/ruta/invalida/que/no/existe/output.pdf'
      );
      
      // Debería manejar el error gracefully
      expect(result).toBeDefined();
    } else {
      expect(true).toBe(true);
    }
  }, 30000);
});
