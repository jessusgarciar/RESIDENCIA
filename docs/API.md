# 📡 API Documentation

## Endpoints del Sistema de Residencias

### 🔐 Autenticación

#### `POST /login`
Autenticación de usuarios.

**Request Body:**
```json
{
  "num_control": "221050123",
  "password": "password123"
}
```

**Response (Success):**
```json
{
  "success": true,
  "message": "Login exitoso",
  "tipo_usuario": "alumno",
  "redirect": "/form"
}
```

**Response (Error):**
```json
{
  "success": false,
  "message": "Credenciales inválidas"
}
```

**Rate Limiting:** 5 intentos por minuto por IP

---

#### `POST /logout`
Cerrar sesión del usuario actual.

**Response:**
```json
{
  "success": true,
  "message": "Sesión cerrada exitosamente"
}
```

---

### 👨‍🎓 Alumnos

#### `GET /alumnos`
Listar todos los alumnos (requiere autenticación como jefe).

**Query Parameters:**
- `search` (opcional): Búsqueda por nombre o número de control

**Response:**
```json
{
  "alumnos": [
    {
      "num_control": "221050123",
      "nombre": "Juan Pérez García",
      "carrera": "Ingeniería en Sistemas",
      "semestre": 8,
      "email": "juan@example.com"
    }
  ]
}
```

---

#### `GET /alumnos/:num_control`
Obtener información detallada de un alumno.

**Response:**
```json
{
  "num_control": "221050123",
  "nombre": "Juan Pérez García",
  "apellidos": "Pérez García",
  "carrera": "Ingeniería en Sistemas",
  "semestre": 8,
  "email": "juan@example.com",
  "telefono": "6141234567",
  "solicitudes": [
    {
      "id": 1,
      "proyecto": "Sistema Web",
      "empresa": "Tech Solutions",
      "estado": "pendiente"
    }
  ]
}
```

---

### 🏢 Empresas

#### `GET /empresas`
Listar todas las empresas registradas.

**Response:**
```json
{
  "empresas": [
    {
      "id": 1,
      "nombre": "Tech Solutions SA",
      "direccion": "Av. Principal 123",
      "ciudad": "Chihuahua",
      "estado": "Chihuahua",
      "telefono": "6141234567",
      "giro": "Tecnología",
      "sector": "Privado"
    }
  ]
}
```

---

#### `POST /empresas`
Crear nueva empresa (requiere autenticación como jefe).

**Request Body:**
```json
{
  "nombre": "Nueva Empresa SA",
  "direccion": "Calle 123",
  "ciudad": "Chihuahua",
  "estado": "Chihuahua",
  "telefono": "6141234567",
  "giro": "Manufactura",
  "sector": "Privado",
  "atencion_a": "Juan Pérez",
  "puesto_atencion": "Gerente de RH"
}
```

**Response:**
```json
{
  "success": true,
  "message": "Empresa creada exitosamente",
  "id": 5
}
```

---

#### `PUT /empresas/:id`
Actualizar información de empresa.

**Request Body:** (mismo formato que POST, campos opcionales)

**Response:**
```json
{
  "success": true,
  "message": "Empresa actualizada exitosamente"
}
```

---

#### `DELETE /empresas/:id`
Eliminar empresa (solo si no tiene solicitudes asociadas).

**Response:**
```json
{
  "success": true,
  "message": "Empresa eliminada exitosamente"
}
```

---

### 📝 Solicitudes

#### `GET /solicitudes`
Listar solicitudes (filtradas según tipo de usuario).

**Query Parameters:**
- `estado` (opcional): Filtrar por estado (pendiente, aprobada, rechazada)
- `num_control` (opcional): Filtrar por alumno

**Response:**
```json
{
  "solicitudes": [
    {
      "id": 1,
      "num_control": "221050123",
      "alumno_nombre": "Juan Pérez",
      "empresa": "Tech Solutions",
      "proyecto": "Sistema de Gestión",
      "fecha_inicio": "2024-01-15",
      "fecha_fin": "2024-05-15",
      "estado": "pendiente",
      "asesor": "Dr. García López",
      "created_at": "2024-01-01T10:00:00.000Z"
    }
  ]
}
```

---

#### `POST /solicitudes`
Crear nueva solicitud de residencia.

**Request Body:**
```json
{
  "num_control": "221050123",
  "empresa_id": 1,
  "proyecto": "Sistema de Gestión Web",
  "descripcion": "Desarrollo de sistema...",
  "fecha_inicio": "2024-01-15",
  "fecha_fin": "2024-05-15",
  "objetivos": "Implementar funcionalidades..."
}
```

**Response:**
```json
{
  "success": true,
  "message": "Solicitud creada exitosamente",
  "id": 10,
  "pdf_path": "/storage/221050123/SOLICITUD_10.pdf"
}
```

---

#### `PUT /solicitudes/:id`
Actualizar estado de solicitud (requiere autenticación como jefe o asesor).

**Request Body:**
```json
{
  "estado": "aprobada",
  "comentarios": "Proyecto aprobado",
  "asesor_id": 3
}
```

**Response:**
```json
{
  "success": true,
  "message": "Solicitud actualizada exitosamente"
}
```

---

### 👨‍🏫 Asesores

#### `GET /asesores`
Listar todos los asesores.

**Response:**
```json
{
  "asesores": [
    {
      "id": 1,
      "nombre": "Dr. García López",
      "especialidad": "Desarrollo de Software",
      "email": "garcia@itchii.edu.mx",
      "activo": true,
      "solicitudes_asignadas": 5
    }
  ]
}
```

---

#### `POST /asesores`
Crear nuevo asesor (requiere autenticación como jefe).

**Request Body:**
```json
{
  "nombre": "Dr. Juan García",
  "apellidos": "García López",
  "email": "garcia@example.com",
  "especialidad": "Desarrollo de Software",
  "activo": true
}
```

---

### 📄 Documentos

#### `POST /generar-documento`
Generar documento PDF desde template.

**Request Body:**
```json
{
  "template": "SOLICITUD_RESIDENCIAS",
  "solicitud_id": 10,
  "data": {
    "nombre": "Juan Pérez",
    "num_control": "221050123",
    "empresa": "Tech Solutions",
    "proyecto": "Sistema Web"
  }
}
```

**Response:**
```json
{
  "success": true,
  "message": "Documento generado exitosamente",
  "path": "/storage/221050123/SOLICITUD_10.pdf",
  "format": "pdf",
  "generation_time": "1250ms"
}
```

---

### 🔔 Notificaciones

#### `GET /notificaciones`
Obtener notificaciones del usuario actual.

**Query Parameters:**
- `leidas` (opcional): Filtrar por estado (true/false)

**Response:**
```json
{
  "notificaciones": [
    {
      "id": 1,
      "tipo": "solicitud_aprobada",
      "mensaje": "Tu solicitud ha sido aprobada",
      "leida": false,
      "created_at": "2024-01-15T10:30:00.000Z",
      "solicitud_id": 10
    }
  ],
  "pendientes": 3
}
```

---

#### `PUT /notificaciones/:id/leer`
Marcar notificación como leída.

**Response:**
```json
{
  "success": true,
  "message": "Notificación marcada como leída"
}
```

---

### 📊 Health Check y Métricas

#### `GET /health`
Verificar estado del sistema (público).

**Response:**
```json
{
  "status": "healthy",
  "timestamp": "2024-12-03T10:30:00.000Z",
  "uptime": 3600,
  "environment": "production",
  "database": {
    "status": "connected",
    "responseTime": "fast"
  },
  "libreoffice": {
    "status": "available",
    "path": "C:\\Program Files\\LibreOffice\\program\\soffice.exe"
  },
  "memory": {
    "used": "125.45 MB",
    "total": "512.00 MB",
    "percentage": "24.50%"
  }
}
```

---

#### `GET /health/detailed`
Información detallada del sistema (solo jefe).

**Response:**
```json
{
  "status": "healthy",
  "timestamp": "2024-12-03T10:30:00.000Z",
  "system": {
    "platform": "win32",
    "nodeVersion": "v18.17.0",
    "uptime": 3600,
    "cpuUsage": { "user": 1000000, "system": 500000 },
    "memoryUsage": { "rss": 131072000, "heapUsed": 52428800 }
  },
  "metrics": {
    "requests": { "total": 1234, "byRoute": {...}, "byMethod": {...} },
    "pdfGeneration": { "total": 45, "successful": 43, "failed": 2 }
  }
}
```

---

#### `GET /metrics`
Métricas de performance (solo jefe).

**Response:**
```json
{
  "timestamp": "2024-12-03T10:30:00.000Z",
  "requests": {
    "total": 1234,
    "byRoute": {
      "/login": 150,
      "/solicitudes": 300
    },
    "byMethod": {
      "GET": 800,
      "POST": 400,
      "PUT": 30,
      "DELETE": 4
    }
  },
  "performance": {
    "averageResponseTime": "125.50ms",
    "maxResponseTime": "3500ms",
    "minResponseTime": "15ms",
    "recentRequests": [...]
  },
  "pdfGeneration": {
    "total": 45,
    "successful": 43,
    "failed": 2,
    "successRate": "95.56%",
    "averageTime": "1250.50ms",
    "recent": [...]
  },
  "errors": {
    "total": 5,
    "byType": {
      "ValidationError": 3,
      "DatabaseError": 2
    }
  },
  "system": {
    "uptime": "60.00 minutes",
    "memory": {
      "rss": "125.00 MB",
      "heapUsed": "50.00 MB",
      "heapTotal": "100.00 MB"
    }
  }
}
```

---

#### `GET /health/readiness`
Verificar si el sistema está listo para recibir tráfico.

**Response:**
```json
{
  "ready": true,
  "timestamp": "2024-12-03T10:30:00.000Z"
}
```

---

#### `GET /health/liveness`
Verificar que el proceso está vivo.

**Response:**
```json
{
  "alive": true,
  "timestamp": "2024-12-03T10:30:00.000Z",
  "uptime": 3600
}
```

---

## Códigos de Estado HTTP

- **200 OK**: Operación exitosa
- **201 Created**: Recurso creado exitosamente
- **400 Bad Request**: Datos inválidos en la petición
- **401 Unauthorized**: No autenticado
- **403 Forbidden**: No autorizado (autenticado pero sin permisos)
- **404 Not Found**: Recurso no encontrado
- **429 Too Many Requests**: Rate limit excedido
- **500 Internal Server Error**: Error del servidor
- **503 Service Unavailable**: Servicio temporalmente no disponible

---

## Autenticación

La API utiliza sesiones basadas en cookies. Después del login exitoso, la cookie de sesión se incluye automáticamente en las peticiones subsecuentes.

**Cookie Name:** `connect.sid`  
**Security:** HttpOnly, Secure (en producción)  
**Expiration:** 24 horas

---

## Rate Limiting

### Login Endpoint
- **Límite:** 5 intentos por minuto por IP
- **Ventana:** 1 minuto
- **Bloqueo:** 5 minutos después de exceder el límite

### API General
- **Límite:** 100 peticiones por minuto por IP
- **Ventana:** 1 minuto

---

## Ejemplos con cURL

### Login
```bash
curl -X POST http://localhost:3000/login \
  -H "Content-Type: application/json" \
  -d '{"num_control":"221050123","password":"password123"}' \
  -c cookies.txt
```

### Crear Solicitud
```bash
curl -X POST http://localhost:3000/solicitudes \
  -H "Content-Type: application/json" \
  -b cookies.txt \
  -d '{
    "num_control": "221050123",
    "empresa_id": 1,
    "proyecto": "Sistema Web",
    "fecha_inicio": "2024-01-15",
    "fecha_fin": "2024-05-15"
  }'
```

### Health Check
```bash
curl http://localhost:3000/health
```

### Métricas (requiere autenticación)
```bash
curl http://localhost:3000/metrics \
  -b cookies.txt
```

---

## Changelog

### v1.1.0 (2024-12-03)
- ✅ Agregado sistema de métricas
- ✅ Endpoints de health check
- ✅ Tracking de generación de PDFs
- ✅ Tests unitarios e integración

### v1.0.0 (2024-01-01)
- 🎉 Release inicial
- ✅ Sistema de autenticación
- ✅ CRUD de empresas, alumnos, asesores
- ✅ Generación de documentos PDF
- ✅ Sistema de notificaciones
