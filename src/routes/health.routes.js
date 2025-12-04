/**
 * Health Check Routes
 * Proporciona endpoints para monitoreo del sistema
 */

import { Router } from 'express';
import pool from '../database.js';
import { ensureSofficeOnPath } from '../lib/docx.js';
import { getMetrics } from '../middleware/metrics.js';
import logger from '../lib/logger.js';

const router = Router();

/**
 * GET /health
 * Endpoint básico de health check
 */
router.get('/health', async (req, res) => {
  const health = {
    status: 'healthy',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    environment: process.env.NODE_ENV || 'development'
  };

  // Verificar conexión a base de datos
  try {
    const [rows] = await pool.query('SELECT 1 as health_check');
    health.database = {
      status: 'connected',
      responseTime: 'fast'
    };
  } catch (error) {
    health.database = {
      status: 'disconnected',
      error: error.message
    };
    health.status = 'degraded';
    logger.error('Database health check failed', error);
  }

  // Verificar LibreOffice
  try {
    const soffice = ensureSofficeOnPath();
    health.libreoffice = {
      status: soffice ? 'available' : 'not-found',
      path: soffice || 'N/A'
    };
    if (!soffice) {
      health.status = 'degraded';
    }
  } catch (error) {
    health.libreoffice = {
      status: 'error',
      error: error.message
    };
    health.status = 'degraded';
    logger.error('LibreOffice health check failed', error);
  }

  // Verificar memoria
  const memUsage = process.memoryUsage();
  const totalMemMB = memUsage.heapTotal / 1024 / 1024;
  const usedMemMB = memUsage.heapUsed / 1024 / 1024;
  const memoryUsagePercent = (usedMemMB / totalMemMB) * 100;

  health.memory = {
    used: `${usedMemMB.toFixed(2)} MB`,
    total: `${totalMemMB.toFixed(2)} MB`,
    percentage: `${memoryUsagePercent.toFixed(2)}%`
  };

  // Advertencia si el uso de memoria es alto
  if (memoryUsagePercent > 90) {
    health.status = 'warning';
    health.warnings = health.warnings || [];
    health.warnings.push('High memory usage detected');
  }

  const statusCode = health.status === 'healthy' ? 200 : 
                     health.status === 'degraded' ? 503 : 500;

  res.status(statusCode).json(health);
});

/**
 * GET /health/detailed
 * Información detallada del sistema (solo para administradores)
 */
router.get('/health/detailed', async (req, res) => {
  // Verificar autenticación
  if (!req.session.loggedin) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  // Solo jefe puede ver métricas detalladas
  if (req.session.tipo_usuario !== 'jefe') {
    return res.status(403).json({ error: 'Forbidden - Admin only' });
  }

  try {
    const metrics = getMetrics();
    
    // Información del sistema
    const systemInfo = {
      platform: process.platform,
      nodeVersion: process.version,
      pid: process.pid,
      uptime: process.uptime(),
      cpuUsage: process.cpuUsage(),
      memoryUsage: process.memoryUsage()
    };

    // Estadísticas de base de datos
    let dbStats = null;
    try {
      const [tables] = await pool.query(`
        SELECT 
          table_name as tableName,
          table_rows as rows,
          ROUND(((data_length + index_length) / 1024 / 1024), 2) as sizeMB
        FROM information_schema.tables
        WHERE table_schema = DATABASE()
        ORDER BY (data_length + index_length) DESC
      `);
      dbStats = tables;
    } catch (error) {
      logger.error('Error fetching database stats', error);
    }

    res.json({
      status: 'healthy',
      timestamp: new Date().toISOString(),
      system: systemInfo,
      metrics: metrics,
      database: {
        connected: true,
        tables: dbStats
      }
    });
  } catch (error) {
    logger.error('Error in detailed health check', error);
    res.status(500).json({
      status: 'error',
      error: error.message
    });
  }
});

/**
 * GET /metrics
 * Endpoint para obtener métricas de performance
 * Formato compatible con sistemas de monitoreo como Prometheus
 */
router.get('/metrics', (req, res) => {
  // Verificar autenticación
  if (!req.session.loggedin || req.session.tipo_usuario !== 'jefe') {
    return res.status(403).json({ error: 'Forbidden' });
  }

  try {
    const metrics = getMetrics();
    
    // Formato simple para visualización
    res.json({
      timestamp: new Date().toISOString(),
      requests: {
        total: metrics.requests.total,
        byRoute: metrics.requests.byRoute,
        byMethod: metrics.requests.byMethod
      },
      performance: {
        averageResponseTime: `${metrics.responseTime.average.toFixed(2)}ms`,
        maxResponseTime: `${metrics.responseTime.max}ms`,
        minResponseTime: `${metrics.responseTime.min === Infinity ? 'N/A' : metrics.responseTime.min + 'ms'}`,
        recentRequests: metrics.responseTime.recent.slice(-10) // últimas 10
      },
      pdfGeneration: {
        total: metrics.pdfGeneration.total,
        successful: metrics.pdfGeneration.successful,
        failed: metrics.pdfGeneration.failed,
        successRate: metrics.pdfGeneration.total > 0 
          ? `${((metrics.pdfGeneration.successful / metrics.pdfGeneration.total) * 100).toFixed(2)}%`
          : 'N/A',
        averageTime: `${metrics.pdfGeneration.averageTime.toFixed(2)}ms`,
        recent: metrics.pdfGeneration.recent.slice(-10)
      },
      errors: {
        total: metrics.errors.total,
        byType: metrics.errors.byType
      },
      system: {
        uptime: `${(metrics.uptime / 60).toFixed(2)} minutes`,
        memory: {
          rss: `${(metrics.memory.rss / 1024 / 1024).toFixed(2)} MB`,
          heapUsed: `${(metrics.memory.heapUsed / 1024 / 1024).toFixed(2)} MB`,
          heapTotal: `${(metrics.memory.heapTotal / 1024 / 1024).toFixed(2)} MB`
        }
      }
    });
  } catch (error) {
    logger.error('Error generating metrics', error);
    res.status(500).json({ error: 'Failed to generate metrics' });
  }
});

/**
 * GET /health/readiness
 * Endpoint para verificar si el sistema está listo para recibir tráfico
 * Útil para orquestadores como Kubernetes
 */
router.get('/health/readiness', async (req, res) => {
  try {
    // Verificar que la base de datos responda
    await pool.query('SELECT 1');
    
    res.status(200).json({
      ready: true,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    res.status(503).json({
      ready: false,
      error: error.message,
      timestamp: new Date().toISOString()
    });
  }
});

/**
 * GET /health/liveness
 * Endpoint para verificar que el proceso está vivo
 * Útil para orquestadores como Kubernetes
 */
router.get('/health/liveness', (req, res) => {
  res.status(200).json({
    alive: true,
    timestamp: new Date().toISOString(),
    uptime: process.uptime()
  });
});

export default router;
