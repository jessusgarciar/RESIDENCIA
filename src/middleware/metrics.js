/**
 * Middleware para tracking de métricas de performance
 * Mide el tiempo de respuesta de las peticiones y registra estadísticas
 */

import logger from '../lib/logger.js';

// Almacenamiento en memoria de métricas (en producción usar Redis o similar)
const metrics = {
  requests: {
    total: 0,
    byRoute: {},
    byMethod: {}
  },
  responseTime: {
    total: 0,
    average: 0,
    max: 0,
    min: Infinity,
    recent: [] // últimas 100 peticiones
  },
  pdfGeneration: {
    total: 0,
    successful: 0,
    failed: 0,
    averageTime: 0,
    totalTime: 0,
    recent: []
  },
  errors: {
    total: 0,
    byType: {}
  }
};

// Middleware de performance tracking
export function performanceTracker(req, res, next) {
  const startTime = Date.now();
  
  // Interceptar el método res.send para capturar el tiempo de respuesta
  const originalSend = res.send;
  res.send = function(data) {
    const responseTime = Date.now() - startTime;
    
    // Actualizar métricas
    metrics.requests.total++;
    
    // Por ruta
    const route = req.route?.path || req.path || 'unknown';
    metrics.requests.byRoute[route] = (metrics.requests.byRoute[route] || 0) + 1;
    
    // Por método HTTP
    const method = req.method;
    metrics.requests.byMethod[method] = (metrics.requests.byMethod[method] || 0) + 1;
    
    // Tiempo de respuesta
    metrics.responseTime.total += responseTime;
    metrics.responseTime.average = metrics.responseTime.total / metrics.requests.total;
    metrics.responseTime.max = Math.max(metrics.responseTime.max, responseTime);
    metrics.responseTime.min = Math.min(metrics.responseTime.min, responseTime);
    
    // Mantener solo las últimas 100 peticiones
    metrics.responseTime.recent.push({
      route,
      method,
      time: responseTime,
      timestamp: new Date().toISOString(),
      statusCode: res.statusCode
    });
    if (metrics.responseTime.recent.length > 100) {
      metrics.responseTime.recent.shift();
    }
    
    // Log de peticiones lentas (> 1 segundo)
    if (responseTime > 1000) {
      logger.warn(`Slow request detected: ${method} ${route} took ${responseTime}ms`);
    }
    
    originalSend.call(this, data);
  };
  
  next();
}

// Función para registrar generación de PDF
export function trackPdfGeneration(success, timeMs, details = {}) {
  metrics.pdfGeneration.total++;
  
  if (success) {
    metrics.pdfGeneration.successful++;
  } else {
    metrics.pdfGeneration.failed++;
  }
  
  metrics.pdfGeneration.totalTime += timeMs;
  metrics.pdfGeneration.averageTime = 
    metrics.pdfGeneration.totalTime / metrics.pdfGeneration.total;
  
  // Registrar detalles recientes
  metrics.pdfGeneration.recent.push({
    success,
    time: timeMs,
    timestamp: new Date().toISOString(),
    ...details
  });
  
  if (metrics.pdfGeneration.recent.length > 50) {
    metrics.pdfGeneration.recent.shift();
  }
  
  logger.info(`PDF generation ${success ? 'succeeded' : 'failed'} in ${timeMs}ms`, details);
}

// Función para registrar errores
export function trackError(error, context = {}) {
  metrics.errors.total++;
  
  const errorType = error.name || 'Unknown';
  metrics.errors.byType[errorType] = (metrics.errors.byType[errorType] || 0) + 1;
  
  logger.error(`Error tracked: ${errorType}`, {
    message: error.message,
    stack: error.stack,
    ...context
  });
}

// Obtener métricas actuales
export function getMetrics() {
  return {
    ...metrics,
    uptime: process.uptime(),
    memory: process.memoryUsage(),
    timestamp: new Date().toISOString()
  };
}

// Resetear métricas (útil para testing o debugging)
export function resetMetrics() {
  metrics.requests.total = 0;
  metrics.requests.byRoute = {};
  metrics.requests.byMethod = {};
  metrics.responseTime.total = 0;
  metrics.responseTime.average = 0;
  metrics.responseTime.max = 0;
  metrics.responseTime.min = Infinity;
  metrics.responseTime.recent = [];
  metrics.pdfGeneration.total = 0;
  metrics.pdfGeneration.successful = 0;
  metrics.pdfGeneration.failed = 0;
  metrics.pdfGeneration.averageTime = 0;
  metrics.pdfGeneration.totalTime = 0;
  metrics.pdfGeneration.recent = [];
  metrics.errors.total = 0;
  metrics.errors.byType = {};
  
  logger.info('Metrics reset');
}

export default {
  performanceTracker,
  trackPdfGeneration,
  trackError,
  getMetrics,
  resetMetrics
};
