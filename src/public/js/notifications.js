(() => {
  const ctx = window.__APP_CTX || {};
  const target = ctx.notificationTarget;
  if (!target) return;

  const toastContainer = document.getElementById('globalToastContainer');
  if (!toastContainer) return;

  const badgeEl = document.querySelector('[data-role="nav-notifications-badge"]');
  const linkEl = document.querySelector('[data-role="nav-notifications-link"]');
  let badgeCount = Number(ctx.notificationCount || 0);

  const storageKey = `notif_shown_${target}`;
  const displayedIds = (() => {
    try {
      const raw = localStorage.getItem(storageKey);
      if (!raw) return new Set();
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? new Set(parsed) : new Set();
    } catch (err) {
      console.warn('No se pudo leer cache de notificaciones mostradas', err);
      return new Set();
    }
  })();

  const persistDisplayed = () => {
    try {
      localStorage.setItem(storageKey, JSON.stringify([...displayedIds]));
    } catch (err) {
      console.warn('No se pudo guardar cache de notificaciones mostradas', err);
    }
  };

  const formatElapsed = (value) => {
    if (!value) return 'ahora';
    const ts = new Date(value).getTime();
    if (Number.isNaN(ts)) return 'ahora';
    const diff = Math.max(0, Date.now() - ts);
    const minutes = Math.floor(diff / 60000);
    if (minutes < 1) return 'ahora';
    if (minutes < 60) return `${minutes} min`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours} h`;
    const days = Math.floor(hours / 24);
    return `${days} d`;
  };

  const updateBadgeValue = (nextValue) => {
    badgeCount = Math.max(0, Number(nextValue) || 0);
    if (badgeEl) {
      badgeEl.textContent = badgeCount;
      badgeEl.classList.toggle('d-none', badgeCount === 0);
    }
    if (linkEl) {
      linkEl.classList.toggle('has-pending', badgeCount > 0);
    }
  };

  const toneClasses = (tipo = 'info') => {
    const normalized = String(tipo).toLowerCase();
    switch (normalized) {
      case 'aprobacion':
        return { icon: 'fa-circle-check', badge: 'bg-success-subtle text-success', border: 'toast-success', actions: 'btn-outline-success' };
      case 'denegacion':
        return { icon: 'fa-triangle-exclamation', badge: 'bg-warning-subtle text-warning', border: 'toast-warning', actions: 'btn-outline-warning' };
      case 'comentario':
        return { icon: 'fa-message', badge: 'bg-info-subtle text-info', border: 'toast-info', actions: 'btn-outline-info' };
      default:
        return { icon: 'fa-bell', badge: 'bg-primary-subtle text-primary', border: 'toast-default', actions: 'btn-outline-primary' };
    }
  };

  const attachToastActions = (toastEl, notif) => {
    const deleteBtn = toastEl.querySelector('[data-action="delete-notification"]');
    if (deleteBtn) {
      deleteBtn.addEventListener('click', async () => {
        deleteBtn.disabled = true;
        await deleteNotification(notif.id);
      });
    }
    toastEl.addEventListener('hidden.bs.toast', () => {
      toastEl.remove();
    });
  };

  const showToast = (notif) => {
    if (!notif || !notif.id) return false;
    const numericId = Number(notif.id);
    const cacheKey = Number.isNaN(numericId) ? String(notif.id) : numericId;
    if (displayedIds.has(cacheKey)) return false;
    displayedIds.add(cacheKey);
    persistDisplayed();

    const tone = toneClasses(notif.tipo);
    const toastId = `notif-${notif.id}`;
    const message = notif.mensaje || 'Tienes una nueva notificación.';
    const createdLabel = formatElapsed(notif.created_at);
    const homeHref = (window.__APP_CTX && window.__APP_CTX.notificationHome) || '/alumno/notificaciones';

    const html = `
      <div class="toast toast-modern ${tone.border}" id="${toastId}" role="alert" aria-live="assertive" aria-atomic="true" data-notification-id="${notif.id}" data-bs-delay="9000">
        <div class="toast-modern__header">
          <div class="d-flex align-items-center gap-2">
            <span class="badge rounded-pill ${tone.badge}"><i class="fa-solid ${tone.icon} me-1"></i>${(notif.tipo || 'Notificación').toUpperCase()}</span>
            <small class="text-muted">${createdLabel}</small>
          </div>
          <button type="button" class="btn-close" data-bs-dismiss="toast" aria-label="Cerrar"></button>
        </div>
        <div class="toast-modern__body">
          <p class="mb-3">${message}</p>
          <div class="d-flex flex-wrap gap-2">
            <button class="btn btn-sm ${tone.actions}" data-action="delete-notification"><i class="fa-solid fa-trash-can me-1"></i>Eliminar</button>
            <a class="btn btn-sm btn-link px-2" href="${homeHref}">Ver detalle</a>
          </div>
        </div>
      </div>`;

    toastContainer.insertAdjacentHTML('beforeend', html);
    const toastEl = document.getElementById(toastId);
    attachToastActions(toastEl, notif);
    const toast = new bootstrap.Toast(toastEl);
    toast.show();
    return true;
  };

  const deleteNotification = async (notificationId) => {
    if (!notificationId) return;
    try {
      const resp = await fetch(`/notifications/${notificationId}`, { method: 'DELETE' });
      const data = await resp.json().catch(() => ({}));
      if (!resp.ok || !data.ok) throw new Error(data.error || 'No se pudo eliminar la notificación');
      const numericId = Number(notificationId);
      const cacheKey = Number.isNaN(numericId) ? String(notificationId) : numericId;
      displayedIds.delete(cacheKey);
      persistDisplayed();
      updateBadgeValue(Math.max(0, badgeCount - 1));
      document.querySelectorAll(`[data-notification-id="${notificationId}"]`).forEach((el) => el.remove());
    } catch (err) {
      console.error('Error eliminando notificación:', err);
      alert(err.message || 'Error eliminando la notificación');
    }
  };

  const loadNotifications = async () => {
    try {
      const resp = await fetch('/notifications/list');
      const data = await resp.json();
      if (!resp.ok || !data.ok) throw new Error(data.error || 'Error obteniendo notificaciones');
      const pending = typeof data.pending === 'number'
        ? data.pending
        : (data.notifications || []).filter((n) => !n.leido).length;
      updateBadgeValue(pending);
      (data.notifications || [])
        .filter((notif) => !notif.leido)
        .forEach((notif) => showToast(notif));
      window.NotificationCenter = Object.assign(window.NotificationCenter || {}, {
        deleteNotification,
        refreshNotifications: loadNotifications
      });
    } catch (err) {
      console.error('Error cargando notificaciones iniciales:', err);
    }
  };

  const connectStream = () => {
    if (!window.EventSource) return;
    try {
      const source = new EventSource('/notifications/stream');
      const sentIds = new Set();
      source.addEventListener('notification', (event) => {
        try {
          const payload = JSON.parse(event.data);
          if (!payload || sentIds.has(payload.id)) return;
          sentIds.add(payload.id);
          if (showToast(payload)) {
            updateBadgeValue(badgeCount + 1);
          }
        } catch (err) {
          console.error('Error procesando notificación SSE:', err);
        }
      });
      source.addEventListener('error', () => {
        source.close();
        setTimeout(connectStream, 5000);
      });
    } catch (err) {
      console.warn('No se pudo iniciar SSE de notificaciones', err);
    }
  };

  loadNotifications();
  connectStream();
})();
