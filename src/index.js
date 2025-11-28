import express from 'express';
import session from 'express-session';
import {join, dirname} from 'path';
import { fileURLToPath } from 'url';
import { engine } from 'express-handlebars';
import morgan from 'morgan';
import dotenv from 'dotenv';
import helmet from 'helmet';
import loginroutes from './routes/login.routes.js';
import formroutes from './routes/form.routes.js';
import empresasroutes from './routes/empresas.routes.js';
import alumnosroutes from './routes/alumnos.routes.js';
import asesoresroutes from './routes/asesores.routes.js';
import solicitudesroutes from './routes/solicitudes.routes.js';
import { ensureSofficeOnPath } from './lib/docx.js';
import { resolveNotificationTarget, countPendingNotifications } from './lib/notifications.js';
import logger from './lib/logger.js';

// Load environment variables
dotenv.config();

// INICIALIZACION
const app = express();
const __dirname = dirname(fileURLToPath(import.meta.url));
const PORT = process.env.PORT || 3000;

// CONFIGURACION
app.set('port', PORT);
app.set('views',join(__dirname, 'views'));
app.engine('.hbs', engine({
    defaultLayout: 'main',
    layoutsDir: join(app.get('views'), 'layouts'),
    partialsDir: join(app.get('views'), 'partials'),
    extname: '.hbs',
    helpers: {
        equals: (a, b) => a === b,
        json: (value) => {
            try {
                return JSON.stringify(value || {});
            } catch (err) {
                return '{}';
            }
        },
        fieldShouldRender: (columns, name) => {
            try {
                if (!name) return true;
                const nm = String(name);
                // always hide attention field
                if (nm === 'atencion_a') return false;

                // Prefer 'empresa_sector' when present. If present, hide 'giro' and 'giro_sector'.
                const cols = Array.isArray(columns) ? columns.map(c => String(c && c.name)) : [];
                const hasEmpresaSector = cols.includes('empresa_sector');
                const hasGiroSector = cols.includes('giro_sector');
                const hasGiro = cols.includes('giro');

                if (hasEmpresaSector) {
                    if (nm === 'giro' || nm === 'giro_sector') return false;
                    return true;
                }

                // If empresa_sector absent but giro_sector exists, prefer giro_sector and hide giro
                if (hasGiroSector) {
                    if (nm === 'giro') return false;
                    return true;
                }

                // Otherwise render normally (no empresa_sector nor giro_sector present)
                return true;
            } catch (e) { return true; }
        }
    }
}));
app.set('view engine', '.hbs');

// MIDDLEWARES
// Security headers
app.use(helmet({
    contentSecurityPolicy: false, // Disable for now to avoid breaking existing functionality
    crossOriginEmbedderPolicy: false
}));

app.use(morgan('dev'));
// Allow larger payloads for PDF uploads (base64 in JSON)
app.use(express.urlencoded({ extended: false, limit: '20mb' }));
app.use(express.json({ limit: '20mb' }));

// Session configuration with security
if (!process.env.SESSION_SECRET) {
    logger.warn('SESSION_SECRET not set in environment variables. Using default (INSECURE)');
}

app.use(session({
    secret: process.env.SESSION_SECRET || 'dev-secret-change-in-production',
    resave: false,
    saveUninitialized: false,
    cookie: {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production', // Only use secure cookies in production
        maxAge: 24 * 60 * 60 * 1000, // 24 hours
        sameSite: 'lax'
    }
}));

app.use((req, res, next) => {
    res.locals.usuario = req.session.usuario || null;
    res.locals.rol = req.session.rol || null;
    next();
});

app.use(async (req, res, next) => {
    try {
        const targetInfo = resolveNotificationTarget(req.session || {});
        const pendingCount = targetInfo?.key ? await countPendingNotifications(targetInfo.key) : 0;
        res.locals.notificationTarget = targetInfo?.key || null;
        res.locals.navNotifications = {
            count: pendingCount,
            hasPending: pendingCount > 0,
            homeUrl: targetInfo?.homeUrl || '/alumno/notificaciones'
        };
        res.locals.appContext = {
            rol: res.locals.rol,
            usuario: res.locals.usuario,
            num_control: req.session?.num_control || null,
            notificationTarget: targetInfo?.key || null,
            notificationHome: targetInfo?.homeUrl || '/alumno/notificaciones',
            notificationCount: pendingCount
        };
    } catch (err) {
        console.error('Error building notification context:', err);
        res.locals.navNotifications = res.locals.navNotifications || { count: 0, hasPending: false, homeUrl: '/alumno/notificaciones' };
        res.locals.appContext = res.locals.appContext || {
            rol: res.locals.rol,
            usuario: res.locals.usuario,
            num_control: req.session?.num_control || null,
            notificationTarget: null,
            notificationHome: '/alumno/notificaciones',
            notificationCount: 0
        };
    }
    next();
});

// RUTAS
app.get('/', async (req, res) => {
    let userStatus = null;
    
    // If user is logged in as alumno, fetch their status
    if (req.session?.num_control || (req.session?.rol === 'alumno' && req.session?.usuario)) {
        try {
            const pool = (await import('./database.js')).default;
            
            // Get num_control from session or lookup by username
            let numControl = req.session.num_control;
            if (!numControl && req.session.usuario) {
                const [userRows] = await pool.query(
                    'SELECT num_control FROM usuarios WHERE username = ? AND rol = ?',
                    [req.session.usuario, 'alumno']
                );
                if (userRows.length > 0) {
                    numControl = userRows[0].num_control;
                }
            }
            
            if (numControl) {
                // Check if alumno data exists
                const [alumnoRows] = await pool.query(
                    'SELECT nombre FROM alumnos WHERE num_control = ?',
                    [numControl]
                );
                
                // Check if there's a solicitud
                const [solicitudRows] = await pool.query(
                    'SELECT id, estatus FROM solicitudes WHERE num_control = ? ORDER BY fecha_solicitud DESC LIMIT 1',
                    [numControl]
                );
                
                // Check if there's pdf_info
                const [pdfRows] = await pool.query(
                    'SELECT estatus FROM pdf_info WHERE num_control = ?',
                    [numControl]
                );
                
                const solicitudStatus = solicitudRows.length > 0 ? solicitudRows[0].estatus : null;
                let pdfStatus = pdfRows.length > 0 ? pdfRows[0].estatus : null;

                if (!pdfStatus && solicitudStatus) {
                    const normalized = String(solicitudStatus).trim().toLowerCase();
                    if (normalized === 'aprobada') pdfStatus = 'aprobado';
                    else if (normalized === 'rechazada') pdfStatus = 'rechazado';
                    else if (normalized === 'pendiente') pdfStatus = 'pendiente';
                }

                userStatus = {
                    hasPersonalData: alumnoRows.length > 0,
                    hasSolicitud: solicitudRows.length > 0,
                    solicitudStatus,
                    pdfStatus
                };
            }
        } catch (error) {
            logger.error('Error fetching user status for index:', error);
        }
    }
    
    res.render('index', { userStatus });
});


app.use(loginroutes);

app.use(formroutes);

app.use(empresasroutes);

app.use(alumnosroutes);

app.use(asesoresroutes);
app.use(solicitudesroutes);



// ARCHIVOS PUBLICOS
app.use(express.static(join(__dirname, 'public')));
app.use(express.static('src/public'));

// DEV helper: set session num_control quickly (only when not in production)
if (process.env.NODE_ENV !== 'production') {
    logger.warn('Development mode: /dev-login endpoint is enabled');
    app.get('/dev-login', (req, res) => {
        const { num_control } = req.query;
        if (!num_control) return res.status(400).send('Provide num_control query param');
        req.session.num_control = num_control;
        logger.debug(`Dev login: num_control set to ${num_control}`);
        res.send(`Session num_control set to ${num_control}`);
    });
}

// SERVER

// Ensure LibreOffice is discoverable and warn if not
try {
    const soffice = ensureSofficeOnPath();
    if (!soffice) {
        logger.warn('LibreOffice (soffice) not found on PATH. DOCX->PDF conversion may fail.');
        logger.warn('Install LibreOffice or set the LIBREOFFICE_PATH environment variable.');
    } else {
        logger.info('Using LibreOffice binary at: ' + soffice);
    }
} catch (e) {
    logger.error('Error while checking LibreOffice availability:', e);
}

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Servidor escuchando en puerto ${PORT}`);
});