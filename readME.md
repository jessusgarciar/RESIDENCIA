# 📚 Sistema de Gestión de Residencias Profesionales

Sistema web para la gestión integral de residencias profesionales en instituciones educativas. Automatiza el proceso de solicitud, seguimiento y generación de documentos oficiales.

![Node.js](https://img.shields.io/badge/Node.js-v18+-green.svg)
![Express](https://img.shields.io/badge/Express-v5.1-blue.svg)
![License](https://img.shields.io/badge/license-ISC-orange.svg)

## 🎯 Características Principales

- ✅ **Gestión de Usuarios**: Alumnos, asesores y jefes de departamento
- 🏢 **Administración de Empresas**: Registro y control de empresas receptoras
- 📝 **Solicitudes de Residencia**: Formulario dinámico y validación automática
- 📄 **Generación Automática de Documentos**: PDFs personalizados desde templates DOCX
- 🔔 **Sistema de Notificaciones**: Alertas en tiempo real para usuarios
- 🔐 **Seguridad**: Rate limiting, sanitización de inputs y sesiones seguras
- 📊 **Reportes y Seguimiento**: Panel de control para administradores
- 🎨 **Interfaz Responsive**: Diseño adaptable a dispositivos móviles

## 🚀 Tecnologías Utilizadas

### Backend
- **Node.js** + **Express.js** - Framework web
- **MySQL2** - Base de datos relacional
- **Express Handlebars** - Motor de plantillas
- **Express Session** - Manejo de sesiones
- **Helmet** - Seguridad HTTP headers
- **Winston** - Logging avanzado
- **Morgan** - Logging de peticiones HTTP

### Procesamiento de Documentos
- **Docxtemplater** - Generación de documentos desde templates
- **LibreOffice Convert** - Conversión DOCX a PDF
- **PDF-Lib** - Manipulación de PDFs

### Seguridad
- **Bcrypt** - Hash de contraseñas
- **Express Rate Limit** - Protección contra ataques de fuerza bruta
- **Helmet** - Headers de seguridad HTTP

### Testing
- **Jest** - Framework de testing
- Tests unitarios e integración

## 📋 Requisitos Previos

- **Node.js** v18 o superior
- **MySQL** v8.0 o superior
- **LibreOffice** (para conversión de documentos a PDF)
- **Git**

## 🔧 Instalación

### 1. Clonar el repositorio
```bash
git clone https://github.com/jessusgarciar/RESIDENCIA.git
cd RESIDENCIA
```

### 2. Instalar dependencias
```bash
npm install
```

### 3. Configurar variables de entorno
Crea un archivo `.env` en la raíz del proyecto:

```env
# Database Configuration
DB_HOST=localhost
DB_USER=root
DB_PASSWORD=tu_password
DB_NAME=residencias_db
DB_PORT=3306

# Server Configuration
PORT=3000
NODE_ENV=development

# Session Secret (cambiar en producción)
SESSION_SECRET=tu_secreto_super_seguro_aqui

# LibreOffice Path (Windows)
LIBREOFFICE_PATH=C:\Program Files\LibreOffice
```

### 4. Configurar la base de datos
Ejecuta el script SQL para crear la base de datos y tablas:
```bash
mysql -u root -p < src/database/query.sql
```

O ejecuta las migraciones:
```bash
node migrations/create_login_attempts_table.js
node migrations/hash_passwords.js
```

### 5. Verificar LibreOffice
```bash
npm run check:libreoffice
```

## 🎮 Uso

### Modo Desarrollo
```bash
npm run dev
```
El servidor se iniciará en `http://localhost:3000`

### Modo Producción
```bash
node src/index.js
```

### Ejecutar Tests
```bash
# Todos los tests
npm test

# Tests con coverage
npm run test:coverage

# Tests en modo watch
npm run test:watch
```

## 📁 Estructura del Proyecto

```
RESIDENCIA/
├── src/
│   ├── index.js              # Punto de entrada principal
│   ├── database.js           # Configuración de MySQL
│   ├── lib/                  # Librerías utilitarias
│   │   ├── docx.js          # Generación de documentos
│   │   ├── date.js          # Formateo de fechas
│   │   ├── logger.js        # Sistema de logging
│   │   ├── notifications.js # Notificaciones
│   │   ├── password.js      # Hash de contraseñas
│   │   └── sanitize.js      # Sanitización de inputs
│   ├── middleware/          # Middlewares
│   │   ├── auth.js         # Autenticación
│   │   └── rateLimiter.js  # Rate limiting
│   ├── routes/             # Rutas de la aplicación
│   │   ├── login.routes.js
│   │   ├── form.routes.js
│   │   ├── empresas.routes.js
│   │   ├── alumnos.routes.js
│   │   ├── asesores.routes.js
│   │   └── solicitudes.routes.js
│   ├── views/              # Vistas Handlebars
│   └── public/             # Archivos estáticos
├── migrations/             # Migraciones de BD
├── scripts/               # Scripts utilitarios
├── templates/            # Templates DOCX
├── storage/             # Almacenamiento de archivos
├── __tests__/          # Tests
└── tmp/               # Archivos temporales
```

## 🔐 Roles de Usuario

### Alumno
- Registrar solicitud de residencia
- Seleccionar empresa
- Subir documentos
- Ver notificaciones

### Asesor
- Revisar solicitudes asignadas
- Aprobar/rechazar proyectos
- Generar reportes

### Jefe de Departamento
- Asignar asesores
- Gestionar empresas
- Administrar usuarios
- Generar documentos oficiales

## 📄 Generación de Documentos

El sistema genera automáticamente los siguientes documentos:

1. **Solicitud de Residencia** (`SOLICITUD_RESIDENCIAS.docx`)
2. **Reporte Preliminar** (`REPORTE_PRELIMINAR.docx`)
3. **Asignación de Asesor** (`ASIGNAR_ASESOR.docx`)

Los documentos se generan desde templates DOCX usando `docxtemplater` y se convierten a PDF automáticamente con LibreOffice.

### Ejemplo de uso:
```javascript
import { renderDocxToPdf } from './lib/docx.js';

const data = {
  nombre: 'Juan Pérez',
  num_control: '221050123',
  carrera: 'Ingeniería en Sistemas',
  empresa: 'Tech Solutions SA',
  proyecto: 'Sistema de Gestión Web'
};

const result = await renderDocxToPdf(
  './templates/SOLICITUD_RESIDENCIAS.docx',
  data,
  './output/solicitud.pdf'
);
```

## 🔒 Seguridad

- **Passwords**: Hash con bcrypt (10 rounds)
- **Rate Limiting**: Protección contra ataques de fuerza bruta
- **SQL Injection**: Uso de prepared statements
- **XSS**: Sanitización de inputs
- **CSRF**: Tokens de sesión
- **Headers**: Helmet.js para headers de seguridad

## 📊 Health Check y Monitoreo

El sistema incluye un endpoint de health check en `/health` que retorna:
- Estado del servidor
- Conexión a base de datos
- Disponibilidad de LibreOffice
- Métricas de performance

```json
{
  "status": "healthy",
  "timestamp": "2024-12-03T10:30:00.000Z",
  "uptime": 3600,
  "database": "connected",
  "libreoffice": "available"
}
```

## 🧪 Testing

El proyecto incluye tests completos:

- **Unit Tests**: `lib/docx.js`, `lib/date.js`
- **Integration Tests**: Flujos completos de solicitudes
- **Coverage**: >80% de cobertura de código

## 📝 Scripts Disponibles

```bash
npm run dev              # Desarrollo con nodemon
npm test                # Ejecutar tests
npm run test:coverage   # Tests con coverage
npm run check:libreoffice  # Verificar LibreOffice
```

## 🐛 Troubleshooting

### Error: "LibreOffice not found"
- Instala LibreOffice desde https://www.libreoffice.org/
- Configura `LIBREOFFICE_PATH` en `.env`

### Error: "Cannot connect to database"
- Verifica que MySQL esté corriendo
- Revisa las credenciales en `.env`
- Verifica que la base de datos existe

### Error: "Session secret not set"
- Define `SESSION_SECRET` en `.env`

## 🤝 Contribuir

1. Fork el proyecto
2. Crea una rama para tu feature (`git checkout -b feature/AmazingFeature`)
3. Commit tus cambios (`git commit -m 'Add some AmazingFeature'`)
4. Push a la rama (`git push origin feature/AmazingFeature`)
5. Abre un Pull Request

## 📈 Roadmap

- [ ] Frontend moderno con React/Vue
- [ ] API REST documentada con Swagger
- [ ] Drag & drop para archivos PDF
- [ ] Validación en tiempo real
- [ ] Dashboard con métricas avanzadas
- [ ] Integración con servicios externos (email, SMS)

## 👥 Autor

**Jesús García**
- GitHub: [@jessusgarciar](https://github.com/jessusgarciar)
