import { formatDateLongSpanish, formatDatesDeep } from '../src/lib/date.js';

describe('date.js - formatDateLongSpanish', () => {
  test('debe formatear fecha válida en español', () => {
    const fecha = new Date(2024, 0, 15); // 15 de enero de 2024
    expect(formatDateLongSpanish(fecha)).toBe('15 de enero de 2024');
  });

  test('debe manejar string en formato ISO', () => {
    const resultado = formatDateLongSpanish('2024-03-25');
    expect(resultado).toBe('25 de marzo de 2024');
  });

  test('debe manejar diferentes meses correctamente', () => {
    expect(formatDateLongSpanish(new Date(2024, 11, 31))).toBe('31 de diciembre de 2024');
    expect(formatDateLongSpanish(new Date(2024, 5, 1))).toBe('01 de junio de 2024');
  });

  test('debe retornar string vacío para null o undefined', () => {
    expect(formatDateLongSpanish(null)).toBe('');
    expect(formatDateLongSpanish(undefined)).toBe('');
  });

  test('debe retornar el string original si no puede parsearlo', () => {
    expect(formatDateLongSpanish('fecha-invalida')).toBe('fecha-invalida');
  });

  test('debe manejar timestamp numérico', () => {
    const timestamp = new Date(2024, 6, 4).getTime();
    expect(formatDateLongSpanish(timestamp)).toBe('04 de julio de 2024');
  });

  test('debe agregar ceros a días de un dígito', () => {
    const fecha = new Date(2024, 2, 5);
    expect(formatDateLongSpanish(fecha)).toBe('05 de marzo de 2024');
  });
});

describe('date.js - formatDatesDeep', () => {
  test('debe formatear objeto con fechas', () => {
    const input = {
      fecha_inicio: new Date(2024, 0, 10),
      nombre: 'Juan',
      fecha_fin: new Date(2024, 5, 30)
    };
    
    const resultado = formatDatesDeep(input);
    expect(resultado.fecha_inicio).toBe('10 de enero de 2024');
    expect(resultado.nombre).toBe('Juan');
    expect(resultado.fecha_fin).toBe('30 de junio de 2024');
  });

  test('debe formatear objetos anidados', () => {
    const input = {
      datos: {
        fecha_nacimiento: new Date(2000, 11, 25)
      }
    };
    
    const resultado = formatDatesDeep(input);
    expect(resultado.datos.fecha_nacimiento).toBe('25 de diciembre de 2000');
  });

  test('debe formatear arrays', () => {
    const input = [
      new Date(2024, 0, 1),
      new Date(2024, 1, 1),
      new Date(2024, 2, 1)
    ];
    
    const resultado = formatDatesDeep(input);
    expect(resultado[0]).toBe('01 de enero de 2024');
    expect(resultado[1]).toBe('01 de febrero de 2024');
    expect(resultado[2]).toBe('01 de marzo de 2024');
  });

  test('debe manejar valores no-fecha', () => {
    const input = {
      numero: 42,
      texto: 'hola',
      booleano: true,
      nulo: null
    };
    
    const resultado = formatDatesDeep(input);
    expect(resultado.numero).toBe(42);
    expect(resultado.texto).toBe('hola');
    expect(resultado.booleano).toBe(true);
    expect(resultado.nulo).toBe(null);
  });

  test('debe detectar campo con "fecha" en el nombre', () => {
    const input = {
      fecha_solicitud: '2024-04-15',
      normal_campo: '2024-04-15'
    };
    
    const resultado = formatDatesDeep(input);
    expect(resultado.fecha_solicitud).toBe('15 de abril de 2024');
    expect(resultado.normal_campo).toBe('2024-04-15'); // no se formatea si no tiene "fecha" en el nombre
  });
});
