function loadImage(url) {
    return new Promise((resolve) => {
        const xhr = new XMLHttpRequest();
        xhr.open('GET', url, true);
        xhr.responseType = 'blob';
        xhr.onload = function () {
            const reader = new FileReader();
            reader.onload = function (event) {
                resolve(event.target.result);
            };
            const file = this.response;
            reader.readAsDataURL(file);
        };
        xhr.send();
    });
}


window.addEventListener('load', async () => {
    // The download button is handled in the form page to use server-side generation.
    // Keep other UI bindings below.

    // When empresa changes, fetch and display details
    const empresaSelect = document.querySelector('#empresa_id');
    if (empresaSelect) {
        empresaSelect.addEventListener('change', async () => {
            const id = empresaSelect.value;
            const container = document.querySelector('#empresa-datos');
            if (!id) {
                if (container) container.style.display = 'none';
                return;
            }
            try {
                const resp = await fetch(`/empresa/${id}`);
                if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
                const data = await resp.json();
                const apply = (selector, value) => {
                    const el = document.querySelector(selector);
                    if (!el) return;
                    if ('value' in el) el.value = value != null ? value : '';
                    else el.textContent = value != null ? value : '';
                };
                const domicileCombo = [data.domicilio || '', data.telefono || data.telefono_empresa || ''].filter(Boolean).join(' | ');
                apply('#empresa_nombre', data.nombre || '');
                apply('#giro', data.giro || '');
                apply('#empresa_rfc', data.rfc || data.rfc_empresa || '');
                apply('#domicilio_telefono', domicileCombo);
                apply('#empresa_domicilio', data.domicilio || '');
                apply('#empresa_colonia', data.colonia || '');
                apply('#empresa_cp', data.codigo_postal || '');
                apply('#empresa_ciudad', data.ciudad || '');
                apply('#empresa_telefono', data.telefono || data.telefono_empresa || '');
                apply('#empresa_mision', data.actividades || data.mision || '');
                apply('#empresa_titular_nombre', data.titular_nombre || '');
                apply('#empresa_titular_puesto', data.titular_puesto || '');

                const contactoInput = document.querySelector('#contacto_empresa');
                if (contactoInput && !contactoInput.value) contactoInput.value = data.atencion_a || data.contacto || '';

                if (typeof window.__docDefaults === 'object' && window.__docDefaults !== null) {
                    Object.assign(window.__docDefaults, {
                        empresa_id: data.id || id,
                        empresa_nombre: data.nombre || '',
                        giro: data.giro || '',
                        empresa_rfc: data.rfc || data.rfc_empresa || '',
                        domicilio_telefono: domicileCombo,
                        empresa_domicilio: data.domicilio || '',
                        empresa_colonia: data.colonia || '',
                        empresa_cp: data.codigo_postal || '',
                        empresa_ciudad: data.ciudad || '',
                        empresa_telefono: data.telefono || data.telefono_empresa || '',
                        empresa_mision: data.actividades || data.mision || '',
                        empresa_titular_nombre: data.titular_nombre || '',
                        empresa_titular_puesto: data.titular_puesto || ''
                    });
                }

                if (container) container.style.display = '';
            } catch (err) {
                console.error('Error fetching empresa:', err);
            }
        });
    }

    // Prefill alumno data if provided in hidden inputs
    const alumnoNombre = document.querySelector('#_alumno_nombre');
    if (alumnoNombre) {
        const nombre = alumnoNombre.value || '';
        const carreraHidden = document.querySelector('#_alumno_carrera');
        if (carreraHidden) {
            const carreraName = carreraHidden.value || '';
            // try to select the option whose text matches carreraName
            const carreraSelect = document.querySelector('#carreras');
            if (carreraSelect) {
                for (const opt of carreraSelect.options) {
                    if ((opt.text || '').trim() === carreraName.trim()) {
                        opt.selected = true;
                        break;
                    }
                }
            }
        }
        // You can also show alumno basic info in console for debugging
        console.log('Alumno prefill:', nombre);
    }
});
