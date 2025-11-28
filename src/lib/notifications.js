import pool from '../database.js';

export function resolveNotificationTarget(session = {}) {
  if (!session) return null;
  if (session.rol === 'jefe_departamento') {
    return { key: 'JEFE', scope: 'jefe_departamento', homeUrl: '/admin/notificaciones' };
  }
  if (session.rol === 'admin') {
    return { key: 'ADMIN', scope: 'admin', homeUrl: '/admin/notificaciones' };
  }
  if (session.num_control) {
    return { key: session.num_control, scope: 'alumno', homeUrl: '/alumno/notificaciones' };
  }
  return null;
}

export async function countPendingNotifications(targetKey) {
  if (!targetKey) return 0;
  try {
    const [rows] = await pool.query('SELECT COUNT(*) AS total FROM notificaciones WHERE destinatario = ? AND COALESCE(leido, 0) = 0', [targetKey]);
    return rows?.[0]?.total || 0;
  } catch (err) {
    console.error('Error counting notifications for target', targetKey, err);
    return 0;
  }
}

export async function fetchNotificationsForTarget(targetKey) {
  if (!targetKey) return [];
  const [rows] = await pool.query(
    'SELECT id, solicitud_id, destinatario, tipo, mensaje, leido, created_at FROM notificaciones WHERE destinatario = ? ORDER BY created_at DESC',
    [targetKey]
  );
  return rows || [];
}

export async function insertNotificationForTarget({ solicitudId = null, destinatario, tipo = 'info', mensaje }) {
  if (!destinatario || !mensaje) return null;
  const [result] = await pool.query(
    'INSERT INTO notificaciones (solicitud_id, destinatario, tipo, mensaje) VALUES (?, ?, ?, ?)',
    [solicitudId || null, destinatario, tipo, mensaje]
  );
  return result?.insertId || null;
}

export async function deleteNotificationForTarget(targetKey, notificationId) {
  if (!targetKey || !notificationId) return false;
  const [result] = await pool.query('DELETE FROM notificaciones WHERE id = ? AND destinatario = ?', [notificationId, targetKey]);
  return (result?.affectedRows || 0) > 0;
}
