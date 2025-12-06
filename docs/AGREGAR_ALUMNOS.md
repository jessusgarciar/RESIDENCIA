# Agregar Alumnos y Gestión de Usuarios

## Resumen de funcionalidad

Sistema para crear usuarios/alumnos con las siguientes características:

### 1. Carrera con coordinador

- **Carreras disponibles:**
  - Ingenieria en Tecnologias de la Informacion y Comunicacion
  - Ingenieria en Mecatronica
  - Ingenieria en Logistica


### 2. Control de acceso

- **Solo administradores** pueden:
  - Crear usuarios individuales
  - Importar alumnos desde CSV
  - Exportar CSV con credenciales

### 3. Crear usuario individual

**Endpoint:** `POST /alumnos/create-user`

**Acceso:** Solo `admin`

**Flujo UI:**
1. Ir a `/alumnos`
2. Clic en "Agregar usuario"
3. Rellenar formulario:
   - Número de control (requerido)
   - Username (requerido)
   - Contraseña (requerido - usar botón "Generar")
   - Rol (alumno/jefe_departamento/admin)
   - Información del alumno:
     - Nombre completo
     - Carrera (selector)
     - Institución de salud (IMSS/ISSSTE/OTRO)
     - Número de seguro social
     - Domicilio
     - Comentario ciudad
     - Email
     - Teléfono
4. Clic en "Crear usuario"
5. El sistema muestra un alert con usuario y contraseña generada (guardar en lugar seguro)

**Comportamiento:**
- Si el alumno ya existe en la BD, actualiza los campos provistos
- Si no existe y se proveen todos los campos obligatorios, crea el registro
- La contraseña se hashea con bcrypt antes de guardar

### 4. Importar alumnos desde CSV

**Endpoint:** `POST /alumnos/import-csv`

**Acceso:** Solo `admin`

**Formato CSV esperado:**
```csv
num_control,username,nombre,carrera,telefono,email_alumno,domicilio,institucion_salud,num_seguro_social,comentario_ciudad
181050063,alumno181,Juan Perez,Ingenieria en Tecnologias de la Informacion y Comunicacion,4491234567,juan@ejemplo.com,Calle 123,IMSS,12345678901,Aguascalientes
221050153,alumno221,Maria Lopez,Ingenieria en Mecatronica,4499876543,maria@ejemplo.com,Av. Principal 456,ISSSTE,98765432109,Pabellón
```

**Flujo UI:**
1. Ir a `/alumnos`
2. Clic en "Importar CSV"
3. Seleccionar archivo CSV
4. Clic en "Importar"
5. El sistema:
   - Lee el CSV línea por línea
   - Para cada registro:
     - Verifica que no exista el usuario/num_control
     - Genera contraseña automáticamente (12 caracteres aleatorios)
     - Hashea la contraseña con bcrypt
     - Crea el usuario en tabla `usuarios`
     - Crea/actualiza el registro en tabla `alumnos`
   - Genera un CSV con credenciales en `tmp/credenciales_[timestamp].csv`
   - Devuelve mensaje con número de usuarios creados

**Notas importantes:**
- Las contraseñas se generan automáticamente (no se envían en el CSV de entrada)
- El CSV de salida contiene: num_control, username, password (en texto plano - descargar y guardar de forma segura)
- Usuarios duplicados se saltan automáticamente

### 5. Exportar CSV con credenciales

**Endpoint:** `GET /alumnos/export-csv`

**Acceso:** Solo `admin`

**Flujo UI:**
1. Ir a `/alumnos`
2. Clic en "Exportar CSV"
3. Se descarga archivo `alumnos_credenciales_[timestamp].csv`

**Formato de salida:**
```csv
num_control,username,password
181050063,alumno181,(ya hasheada - no recuperable)
221050153,alumno221,(ya hasheada - no recuperable)
```

**Nota:** Las contraseñas hasheadas no son recuperables. Este CSV sirve para auditoría de usuarios existentes, no para recuperar contraseñas.

## Seguridad

### Restricciones implementadas:

1. **Middleware de autenticación:**
   - Todos los endpoints de creación/importación/exportación requieren `requireRole('admin')`
   - Solo usuarios con `req.session.rol === 'admin'` pueden acceder

2. **Generación de contraseñas:**
   - 12 caracteres mínimo
   - Caracteres seguros: mayúsculas, minúsculas, números, símbolos
   - Usa `crypto.getRandomValues()` cuando está disponible

3. **Almacenamiento:**
   - Todas las contraseñas se hashean con bcrypt (SALT_ROUNDS=10)
   - No se almacenan contraseñas en texto plano en la BD

### Recomendaciones adicionales:

1. **Producción:**
   - Forzar cambio de contraseña en primer login
   - Implementar envío automático de credenciales por correo (en lugar de mostrar en alert)
   - Eliminar CSV de credenciales después de descargar

2. **Auditoría:**
   - Los logs registran cada creación de usuario con `logger.info()`
   - Revisar logs en `combined.log` y `error.log`

## Pruebas locales

```powershell
# Levantar servidor
npm run dev

# Acceder como admin
# http://localhost:3000/login
# Usuario: admin / Contraseña: (según tu BD)

# Ir a gestión de alumnos
# http://localhost:3000/alumnos
```

### Prueba crear usuario individual:
1. Clic en "Agregar usuario"
2. Rellenar num_control: `999050001`
3. Rellenar username: `prueba999`
4. Clic "Generar" contraseña
5. Seleccionar carrera
6. Rellenar datos opcionales
7. Clic "Crear usuario"
8. Copiar contraseña del alert

### Prueba importar CSV:
1. Crear archivo `alumnos_prueba.csv`:
```csv
num_control,username,nombre,carrera,telefono,email_alumno,domicilio,institucion_salud,num_seguro_social,comentario_ciudad
999050002,prueba002,Test User 2,Ingenieria en Tecnologias de la Informacion y Comunicacion,4491111111,test2@test.com,Calle Test,IMSS,11111111111,Test City
999050003,prueba003,Test User 3,Ingenieria en Mecatronica,4492222222,test3@test.com,Av Test,ISSSTE,22222222222,Test City
```

2. Clic en "Importar CSV"
3. Seleccionar archivo
4. Clic "Importar"
5. Verificar mensaje de éxito
6. Buscar archivo en `tmp/credenciales_*.csv` con las contraseñas generadas

### Prueba exportar CSV:
1. Clic en "Exportar CSV"
2. Se descarga `alumnos_credenciales_[timestamp].csv`
3. Abrir con Excel/editor de texto
4. Verificar lista de usuarios (contraseñas marcadas como hasheadas)

## Troubleshooting

### Error: "Usuario ya existe"
- Verificar que el num_control o username no estén duplicados en la BD
- Consultar: `SELECT * FROM usuarios WHERE num_control = '...' OR username = '...'`

### Error: "Acceso denegado" al crear usuario
- Verificar que el usuario logueado tenga `rol = 'admin'`
- Verificar sesión activa: `req.session.rol`

### Error al importar CSV
- Verificar formato del CSV (columnas en orden correcto)
- Verificar encoding UTF-8
- Verificar que el archivo no supere 5MB
- Revisar logs en `error.log`

### Dependencias faltantes
```powershell
npm install multer csv-parse csv-stringify
```
