document.addEventListener('DOMContentLoaded', async () => {
    // ── Auth ──────────────────────────────────────────────────────────────────
    if (!sessionStorage.getItem('flexitrack_token')) {
        window.location.href = 'index.html'; return;
    }

    // ── Helper API ────────────────────────────────────────────────────────────
    async function api(method, path, body) {
        try {
            const tk   = sessionStorage.getItem('flexitrack_token');
            const opts = { method, headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${tk}` } };
            if (body !== undefined) opts.body = JSON.stringify(body);
            const res  = await fetch('/api' + path, opts);
            if (res.status === 401) {
                sessionStorage.removeItem('flexitrack_token');
                sessionStorage.removeItem('flexitrack_username');
                window.location.href = 'index.html';
                return null;
            }
            const data = await res.json();
            if (!res.ok) { toast(data.error || 'Erreur serveur.', 'error'); return null; }
            return data;
        } catch {
            toast('Impossible de contacter le serveur.', 'error');
            return null;
        }
    }

    // ── Données ───────────────────────────────────────────────────────────────
    let patients     = [];
    let appointments = [];

    async function loadData() {
        const [p, a] = await Promise.all([api('GET', '/patients'), api('GET', '/appointments')]);
        if (p) patients     = p;
        if (a) appointments = a;
    }

    await loadData();

    // ── Paramètres (localStorage) ─────────────────────────────────────────────
    const DEFAULT_SETTINGS = { clinicName: '', alertThreshold: 75, baudRate: 115200 };

    function loadSettings() {
        try { return { ...DEFAULT_SETTINGS, ...JSON.parse(localStorage.getItem('flexitrack_settings') || '{}') }; }
        catch { return { ...DEFAULT_SETTINGS }; }
    }

    function saveSettings(s) { localStorage.setItem('flexitrack_settings', JSON.stringify(s)); }

    function applyClinicName(name) {
        const el = document.getElementById('clinicNameDisplay');
        if (el) el.textContent = name || 'Administrateur';
    }

    applyClinicName(loadSettings().clinicName);

    const adminNameEl = document.getElementById('adminName');
    if (adminNameEl) adminNameEl.textContent = sessionStorage.getItem('flexitrack_username') || 'Admin';

    document.getElementById('logoutBtn').addEventListener('click', () => {
        sessionStorage.removeItem('flexitrack_token');
        sessionStorage.removeItem('flexitrack_username');
        window.location.href = 'index.html';
    });

    // ── Helpers ───────────────────────────────────────────────────────────────
    const fmtDate = d => {
        const [y, m, day] = d.slice(0, 10).split('-');
        return new Date(parseInt(y), parseInt(m) - 1, parseInt(day))
            .toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric' });
    };
    const calcAge  = d => Math.floor((Date.now() - new Date(d + 'T12:00:00').getTime()) / (1000 * 60 * 60 * 24 * 365.25));
    const initials = (n, p) => `${n.charAt(0)}${p.charAt(0)}`.toUpperCase();
    const today    = new Date().toISOString().split('T')[0];

    // ── Toast ─────────────────────────────────────────────────────────────────
    function toast(message, type = 'success') {
        const container = document.getElementById('toastContainer');
        const icons = { success: 'fa-circle-check', error: 'fa-circle-xmark', info: 'fa-circle-info' };
        const el = document.createElement('div');
        el.className = `toast toast-${type}`;
        el.innerHTML = `<i class="fa-solid ${icons[type] || icons.success}"></i><span>${message}</span>`;
        container.appendChild(el);
        requestAnimationFrame(() => el.classList.add('show'));
        setTimeout(() => { el.classList.remove('show'); setTimeout(() => el.remove(), 300); }, 3500);
    }

    function showFormError(el, msg) {
        el.textContent = msg;
        el.classList.remove('hidden');
        el.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }

    // ── Navigation ────────────────────────────────────────────────────────────
    const views    = document.querySelectorAll('.view');
    const navItems = document.querySelectorAll('.nav-item');

    function switchView(viewName) {
        views.forEach(v => v.classList.remove('active-view'));
        navItems.forEach(n => n.classList.remove('active'));
        document.getElementById('view-' + viewName).classList.add('active-view');
        document.querySelector(`[data-view="${viewName}"]`).classList.add('active');
        if (viewName === 'appointments') { renderStats(); renderAppointments(); }
        if (viewName === 'patients')     { renderPatients(); showPatientList(); }
        if (viewName === 'emg')          { populateEmgPatientSelect(); initEmgCharts(); loadEmgProgress(); loadEmgThresholdInline(); updateEmgAvgBal(); }
        if (viewName === 'settings')     { loadSettingsView(); }
        if (viewName === 'anatomy') {
            if (window.initAnatomy3D)   window.initAnatomy3D();
            if (window.resumeAnatomy3D) window.resumeAnatomy3D();
        }
        if (viewName !== 'anatomy' && window.stopAnatomy3D) window.stopAnatomy3D();
    }
    navItems.forEach(n => n.addEventListener('click', e => { e.preventDefault(); switchView(n.dataset.view); }));

    // ── CSV / Sauvegarde ──────────────────────────────────────────────────────
    function downloadCSV(filename, rows) {
        const content = rows.map(r => r.map(c => `"${String(c).replace(/"/g, '""')}"`).join(',')).join('\r\n');
        const blob = new Blob(['﻿' + content], { type: 'text/csv;charset=utf-8;' });
        const url  = URL.createObjectURL(blob);
        const a    = document.createElement('a');
        a.href = url; a.download = filename; a.click();
        URL.revokeObjectURL(url);
    }

    // ── PDF helpers ──────────────────────────────────────────────────────────
    function buildPatientReportPage(p, clinic, dateStr) {
        const seuil = p.seuilAlerte ?? 75;
        const sess  = p.sessions || [];
        const valid = sess.filter(s => s.duration >= 10);
        const n     = valid.length;

        let avgL = '—', avgR = '—', avgBal = '—';
        let etatHTML = '<span class="badge-nd">—</span>';
        let tendHTML = '<span class="t-st">—</span>';
        if (n > 0) {
            avgL   = (valid.reduce((a, s) => a + parseFloat(s.rmsLeft),  0) / n).toFixed(1);
            avgR   = (valid.reduce((a, s) => a + parseFloat(s.rmsRight), 0) / n).toFixed(1);
            avgBal = (valid.reduce((a, s) => a + parseFloat(s.balance),  0) / n).toFixed(1);
            etatHTML = parseFloat(avgBal) >= seuil
                ? '<span class="badge-ok">Équilibré ✓</span>'
                : '<span class="badge-ko">Déséquilibré ✗</span>';
            if (n >= 3) {
                const half   = Math.ceil(n / 2);
                const bFirst = valid.slice(0, half).reduce((a, s) => a + parseFloat(s.balance), 0) / half;
                const bLast  = valid.slice(-half).reduce((a, s) => a + parseFloat(s.balance), 0) / half;
                tendHTML = bLast - bFirst > 5  ? '<span class="t-up">En amélioration ↑</span>'
                         : bLast - bFirst < -5 ? '<span class="t-dn">En régression ↓</span>'
                         : '<span class="t-st">Stable →</span>';
            } else {
                tendHTML = '<span class="t-st">Données insuffisantes</span>';
            }
        }

        const rowsHTML = sess.length === 0
            ? `<tr><td colspan="8" style="text-align:center;color:#999;padding:12px;">Aucune séance</td></tr>`
            : sess.map(s => {
                const bal  = parseFloat(s.balance);
                const dur  = s.duration;
                const diff = Math.abs(parseFloat(s.rmsLeft) - parseFloat(s.rmsRight)).toFixed(1);
                const cls  = dur < 10 ? 'test' : bal >= seuil ? 'ok' : 'ko';
                const lbl  = dur < 10 ? 'Test (&lt;10s)' : bal >= seuil ? 'Équilibré ✓' : 'Déséquilibré ✗';
                return `<tr>
                    <td>${fmtDate(s.date)}</td>
                    <td>${Math.floor(dur/60)}min ${dur%60}s</td>
                    <td>${parseFloat(s.rmsLeft).toFixed(1)}</td>
                    <td>${parseFloat(s.rmsRight).toFixed(1)}</td>
                    <td>${bal.toFixed(1)}%</td>
                    <td>${diff} mV</td>
                    <td class="${cls}">${lbl}</td>
                    <td style="color:#555">${(s.notes||'').slice(0,50)}</td>
                </tr>`;
            }).join('');

        return `<div class="page">
            <div class="hdr">
                <div>
                    <div class="hdr-clinic">${clinic}</div>
                    <div class="hdr-sub">Rapport de suivi — Électromyographie (EMG)</div>
                </div>
                <div class="hdr-date">Exporté le ${dateStr}<br><span style="opacity:.6">FlexiTrack v2</span></div>
            </div>
            <div class="pat-card">
                <div class="pat-name">${p.nom.toUpperCase()} ${p.prenom}</div>
                <div class="pat-grid">
                    <div class="pat-row"><b>Genre :</b> ${p.genre || '—'}</div>
                    <div class="pat-row"><b>Date de naissance :</b> ${fmtDate(p.dateNaissance)}</div>
                    <div class="pat-row"><b>Âge :</b> ${calcAge(p.dateNaissance)} ans</div>
                    <div class="pat-row"><b>Téléphone :</b> ${p.telephone || '—'}</div>
                    <div class="pat-row"><b>Seuil d'alerte :</b> ${seuil}%</div>
                    ${p.notes ? `<div class="pat-row" style="grid-column:1/-1"><b>Notes :</b> ${p.notes}</div>` : ''}
                </div>
            </div>
            <div class="sec-title">Séances — ${sess.length} au total · ${n} valides (≥ 10 s)</div>
            <table>
                <thead><tr>
                    <th>Date</th><th>Durée</th><th>RMS G (mV)</th><th>RMS D (mV)</th>
                    <th>Balance</th><th>Déséquilibre</th><th>Statut</th><th>Notes</th>
                </tr></thead>
                <tbody>${rowsHTML}</tbody>
            </table>
            <div class="sec-title">Récapitulatif</div>
            <div class="recap">
                <div><div class="rv">${avgL}</div><div class="rl">Moy. RMS Gauche (mV)</div></div>
                <div><div class="rv">${avgR}</div><div class="rl">Moy. RMS Droit (mV)</div></div>
                <div><div class="rv">${avgBal}${avgBal !== '—' ? '%' : ''}</div><div class="rl">Moy. Balance</div></div>
                <div class="etats">
                    <div><span class="lbl">État général : </span>${etatHTML}</div>
                    <div><span class="lbl">Tendance : </span>${tendHTML}</div>
                </div>
            </div>
            <div class="ft">
                <span>${clinic}</span>
                <span>Document confidentiel — usage médical</span>
                <span>${dateStr}</span>
            </div>
        </div>`;
    }

    function openPrintWindow(pagesHTML) {
        const CSS = `
* { margin:0; padding:0; box-sizing:border-box; }
@page { size:A4 portrait; margin:12mm 12mm; }
body { font-family:Arial,Helvetica,sans-serif; font-size:10px; color:#1a1a2e; background:#fff; print-color-adjust:exact; -webkit-print-color-adjust:exact; }
.page { page-break-after:always; max-width:186mm; margin:0 auto 8mm; }
.page:last-child { page-break-after:avoid; }
.hdr { background:#1a3a6b; color:#fff; padding:13px 18px; display:flex; justify-content:space-between; align-items:center; border-radius:6px 6px 0 0; margin-bottom:12px; }
.hdr-clinic { font-size:16px; font-weight:700; }
.hdr-sub { font-size:9px; opacity:.8; margin-top:3px; }
.hdr-date { font-size:9px; opacity:.8; text-align:right; line-height:1.6; }
.pat-card { background:#eef3ff; border-left:4px solid #1a3a6b; padding:10px 14px; margin-bottom:12px; border-radius:0 4px 4px 0; }
.pat-name { font-size:14px; font-weight:700; color:#1a3a6b; margin-bottom:7px; }
.pat-grid { display:grid; grid-template-columns:1fr 1fr; gap:4px 20px; }
.pat-row { font-size:9.5px; line-height:1.5; }
.pat-row b { color:#444; }
.sec-title { font-size:11px; font-weight:700; color:#1a3a6b; padding:5px 0; border-bottom:2px solid #1a3a6b; margin-bottom:8px; margin-top:14px; }
table { width:100%; border-collapse:collapse; font-size:8.5px; }
th { background:#2a5298; color:#fff; padding:5px 6px; text-align:left; font-weight:600; font-size:8px; white-space:nowrap; }
td { padding:4px 6px; border-bottom:1px solid #e4e8f8; vertical-align:middle; }
tr:nth-child(even) td { background:#f5f7ff; }
.ok { color:#0a7c42; font-weight:700; }
.ko { color:#c0392b; font-weight:700; }
.test { color:#e67e22; font-weight:700; }
.recap { margin-top:12px; background:#f5f7ff; border-radius:4px; padding:12px 16px; display:grid; grid-template-columns:1fr 1fr 1fr; gap:10px; text-align:center; }
.rv { font-size:22px; font-weight:700; color:#1a3a6b; }
.rl { font-size:8px; color:#666; margin-top:2px; }
.etats { grid-column:1/-1; display:flex; gap:20px; justify-content:center; align-items:center; flex-wrap:wrap; padding-top:8px; border-top:1px solid #dde4f8; margin-top:4px; }
.lbl { font-size:9px; color:#555; font-weight:600; }
.badge-ok { background:#e6f9ef; border:1px solid #0a7c42; color:#0a7c42; padding:3px 10px; border-radius:20px; font-weight:700; font-size:9px; }
.badge-ko { background:#fdecea; border:1px solid #c0392b; color:#c0392b; padding:3px 10px; border-radius:20px; font-weight:700; font-size:9px; }
.badge-nd { background:#f0f4ff; border:1px solid #aab4d8; color:#556; padding:3px 10px; border-radius:20px; font-size:9px; }
.t-up { color:#0a7c42; font-weight:700; font-size:9px; }
.t-dn { color:#c0392b; font-weight:700; font-size:9px; }
.t-st { color:#d97706; font-weight:700; font-size:9px; }
.ft { margin-top:14px; padding-top:7px; border-top:1px solid #dde; font-size:8px; color:#999; display:flex; justify-content:space-between; }
@media screen { body { padding:8mm; background:#c8cdd8; } .page { background:#fff; padding:10mm; box-shadow:0 2px 14px #0003; } }`;
        const html = `<!DOCTYPE html><html lang="fr"><head><meta charset="UTF-8"><title>Rapport FlexiTrack</title><style>${CSS}</style></head><body>${pagesHTML}</body></html>`;
        const win = window.open('', '_blank', 'width=920,height=760');
        if (!win) { toast('Autorisez les pop-ups pour exporter en PDF.', 'info'); return; }
        win.document.write(html);
        win.document.close();
        win.addEventListener('load', () => { win.focus(); win.print(); });
    }

    // ── Rapport complet — tous les patients, 1 page par patient ─────────────
    document.getElementById('exportEmgReportBtn').addEventListener('click', () => {
        const withSess = patients.filter(p => (p.sessions || []).length > 0);
        if (!withSess.length) { toast('Aucune séance enregistrée.', 'info'); return; }
        const clinic  = loadSettings().clinicName || 'FlexiTrack';
        const dateStr = new Date().toLocaleDateString('fr-FR');
        openPrintWindow(withSess.map(p => buildPatientReportPage(p, clinic, dateStr)).join(''));
        toast(`PDF généré — ${withSess.length} patient(s).`);
    });

    // ── Rapport individuel — patient courant ─────────────────────────────────
    document.getElementById('exportSessionsBtn').addEventListener('click', () => {
        const p = patients.find(x => x.id === currentDetailPatientId);
        if (!p || !(p.sessions || []).length) { toast('Aucune séance à exporter.', 'info'); return; }
        const clinic  = loadSettings().clinicName || 'FlexiTrack';
        const dateStr = new Date().toLocaleDateString('fr-FR');
        openPrintWindow(buildPatientReportPage(p, clinic, dateStr));
        toast('Rapport PDF généré.');
    });

    document.getElementById('backupBtn').addEventListener('click', async () => {
        const data = await api('GET', '/backup');
        if (!data) return;
        const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
        const url  = URL.createObjectURL(blob);
        const a    = document.createElement('a');
        a.href = url; a.download = `flexitrack_backup_${today}.json`; a.click();
        URL.revokeObjectURL(url);
        toast('Sauvegarde exportée avec succès.');
    });

    document.getElementById('restoreInput').addEventListener('change', e => {
        const file = e.target.files[0]; if (!file) return;
        const reader = new FileReader();
        reader.onload = async ev => {
            try {
                const data = JSON.parse(ev.target.result);
                if (!Array.isArray(data.patients) || !Array.isArray(data.appointments)) throw new Error();
                const dateStr = data.exportDate ? fmtDate(data.exportDate.slice(0, 10)) : 'inconnue';
                if (!confirm(`Restaurer la sauvegarde du ${dateStr} ?\nToutes les données actuelles seront remplacées.`)) return;
                const result = await api('POST', '/restore', { patients: data.patients, appointments: data.appointments });
                if (!result) return;
                await loadData();
                renderStats(); renderAppointments();
                renderPatients(document.getElementById('searchPatient').value);
                toast('Données restaurées avec succès.');
            } catch { toast('Fichier de sauvegarde invalide.', 'error'); }
        };
        reader.readAsText(file);
        e.target.value = '';
    });

    // ── Paramètres ────────────────────────────────────────────────────────────
    function loadSettingsView() {
        const s = loadSettings();
        document.getElementById('settingClinicName').value = s.clinicName || '';
        document.getElementById('settingBaudRate').value   = s.baudRate;
    }

    document.getElementById('saveSettingsBtn').addEventListener('click', () => {
        const s = {
            clinicName: document.getElementById('settingClinicName').value.trim(),
            baudRate:   parseInt(document.getElementById('settingBaudRate').value)
        };
        saveSettings(s);
        applyClinicName(s.clinicName);
        const msg = document.getElementById('settingsSavedMsg');
        msg.classList.remove('hidden');
        setTimeout(() => msg.classList.add('hidden'), 2500);
        toast('Paramètres enregistrés.');
    });

    // ── Statistiques ──────────────────────────────────────────────────────────
    function renderStats() {
        const todayCount  = appointments.filter(a => a.date === today).length;
        const allSessions = patients.flatMap(p => p.sessions || []);
        document.getElementById('statsBar').innerHTML = `
            <div class="stat-card">
                <div class="stat-card-icon"><i class="fa-solid fa-users"></i></div>
                <div class="stat-card-body"><div class="stat-card-value">${patients.length}</div><div class="stat-card-label">Patients suivis</div></div>
            </div>
            <div class="stat-card">
                <div class="stat-card-icon"><i class="fa-solid fa-calendar-day"></i></div>
                <div class="stat-card-body"><div class="stat-card-value">${todayCount}</div><div class="stat-card-label">RDV aujourd'hui</div></div>
            </div>
            <div class="stat-card">
                <div class="stat-card-icon"><i class="fa-solid fa-wave-square"></i></div>
                <div class="stat-card-body"><div class="stat-card-value">${allSessions.length}</div><div class="stat-card-label">Séances totales</div></div>
            </div>`;
    }

    // ── Rendez-vous ───────────────────────────────────────────────────────────
    document.getElementById('todayDate').textContent = new Date().toLocaleDateString('fr-FR', {
        weekday: 'long', day: 'numeric', month: 'long', year: 'numeric'
    });

    let apptFilter = 'today';
    document.querySelectorAll('.filter-tab').forEach(btn => {
        btn.addEventListener('click', () => {
            document.querySelectorAll('.filter-tab').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            apptFilter = btn.dataset.filter;
            renderAppointments();
        });
    });

    function renderAppointments() {
        const list  = document.getElementById('appointmentsList');
        const empty = document.getElementById('emptyAppointments');
        const wkEnd = new Date(); wkEnd.setDate(wkEnd.getDate() + 6);
        const moEnd = new Date(); moEnd.setDate(moEnd.getDate() + 30);
        const wkStr = wkEnd.toISOString().split('T')[0];
        const moStr = moEnd.toISOString().split('T')[0];

        let filtered = appointments.filter(a => {
            if (apptFilter === 'today') return a.date === today;
            if (apptFilter === 'week')  return a.date >= today && a.date <= wkStr;
            return a.date >= today && a.date <= moStr;
        }).sort((a, b) => a.date.localeCompare(b.date) || a.time.localeCompare(b.time));

        if (!filtered.length) { list.innerHTML = ''; empty.classList.remove('hidden'); return; }
        empty.classList.add('hidden');

        list.innerHTML = filtered.map(a => {
            const p    = patients.find(pt => pt.id === a.patientId);
            const name = p ? `${p.nom.toUpperCase()} ${p.prenom}` : 'Patient inconnu';
            const lbl  = a.status === 'confirmed' ? 'Confirmé' : a.status === 'pending' ? 'En attente' : 'Terminé';
            const dateRow = apptFilter !== 'today'
                ? `<div class="appt-date"><i class="fa-solid fa-calendar-day"></i> ${fmtDate(a.date)}</div>` : '';
            return `<div class="appt-card">
                <div class="appt-top"><span class="appt-time">${a.time}</span><span class="appt-badge ${a.status}">${lbl}</span></div>
                ${dateRow}
                <div class="appt-patient">${name}</div>
                <div class="appt-type"><i class="fa-solid fa-stethoscope"></i> ${a.type}</div>
                <div class="appt-actions">
                    <button class="btn-icon" onclick="markComplete('${a.id}')" title="Marquer terminé"><i class="fa-solid fa-check"></i></button>
                    <button class="btn-icon" onclick="editAppt('${a.id}')" title="Modifier"><i class="fa-solid fa-pen"></i></button>
                    <button class="btn-icon danger" onclick="deleteAppt('${a.id}')" title="Supprimer"><i class="fa-solid fa-trash"></i></button>
                </div>
            </div>`;
        }).join('');
    }

    window.markComplete = async id => {
        const a = appointments.find(x => x.id === id);
        if (!a) return;
        const updated = await api('PUT', `/appointments/${id}`, { ...a, status: 'completed' });
        if (!updated) return;
        a.status = 'completed';
        renderAppointments(); renderStats();
        toast('Rendez-vous marqué comme terminé.');
    };

    window.deleteAppt = async id => {
        if (!confirm('Supprimer ce rendez-vous ?')) return;
        const result = await api('DELETE', `/appointments/${id}`);
        if (!result) return;
        appointments = appointments.filter(x => x.id !== id);
        renderAppointments(); renderStats();
        toast('Rendez-vous supprimé.', 'info');
    };

    const apptModal = document.getElementById('appointmentModal');

    function openApptModal(appt = null) {
        document.getElementById('apptFormError').classList.add('hidden');
        document.getElementById('apptId').value              = appt ? appt.id : '';
        document.getElementById('apptModalTitle').textContent = appt ? 'Modifier le Rendez-vous' : 'Nouveau Rendez-vous';
        document.getElementById('apptSubmitBtn').textContent  = appt ? 'Enregistrer' : 'Ajouter';
        document.getElementById('apptDate').value             = appt ? appt.date : today;
        document.getElementById('apptTime').value             = appt ? appt.time : '';
        document.getElementById('apptType').value             = appt ? appt.type : 'Bilan initial';
        const sel = document.getElementById('apptPatient');
        sel.innerHTML = '<option value="" disabled>Sélectionnez...</option>' +
            patients.map(p => `<option value="${p.id}"${appt && appt.patientId === p.id ? ' selected' : ''}>${p.nom} ${p.prenom}</option>`).join('');
        if (!appt) sel.value = '';
        apptModal.classList.add('show');
    }

    document.getElementById('addAppointmentBtn').addEventListener('click', () => openApptModal());
    document.getElementById('closeApptModal').addEventListener('click', () => apptModal.classList.remove('show'));
    document.getElementById('cancelApptModal').addEventListener('click', () => apptModal.classList.remove('show'));
    apptModal.addEventListener('click', e => { if (e.target === apptModal) apptModal.classList.remove('show'); });

    window.editAppt = id => { const a = appointments.find(x => x.id === id); if (a) openApptModal(a); };

    document.getElementById('appointmentForm').addEventListener('submit', async e => {
        e.preventDefault();
        const errEl     = document.getElementById('apptFormError');
        const patientId = document.getElementById('apptPatient').value;
        const date      = document.getElementById('apptDate').value;
        const time      = document.getElementById('apptTime').value;
        if (!patientId) { showFormError(errEl, 'Veuillez sélectionner un patient.'); return; }
        if (!date)      { showFormError(errEl, 'La date est requise.'); return; }
        if (!time)      { showFormError(errEl, "L'heure est requise."); return; }
        errEl.classList.add('hidden');

        const id   = document.getElementById('apptId').value;
        const type = document.getElementById('apptType').value;

        if (id) {
            const existing = appointments.find(a => a.id === id);
            const updated  = await api('PUT', `/appointments/${id}`, { patientId, date, time, type, status: existing?.status || 'confirmed' });
            if (!updated) return;
            const idx = appointments.findIndex(a => a.id === id);
            if (idx !== -1) appointments[idx] = updated;
            toast('Rendez-vous modifié.');
        } else {
            const created = await api('POST', '/appointments', { patientId, date, time, type });
            if (!created) return;
            appointments.push(created);
            toast('Rendez-vous ajouté avec succès.');
        }
        apptModal.classList.remove('show'); e.target.reset();
        renderAppointments(); renderStats();
    });

    // ── Patients ──────────────────────────────────────────────────────────────
    let currentDetailPatientId = null;

    function showPatientList() {
        document.getElementById('patientListContainer').classList.remove('hidden');
        document.getElementById('patientDetailView').classList.add('hidden');
    }

    function renderPatients(filter = '') {
        const body  = document.getElementById('patientsBody');
        const empty = document.getElementById('emptyPatients');
        const q     = filter.toLowerCase();
        const filtered = patients.filter(p =>
            `${p.nom} ${p.prenom}`.toLowerCase().includes(q) || p.telephone.includes(filter)
        );
        if (!filtered.length) {
            body.innerHTML = '';
            document.querySelector('.table-card').style.display = 'none';
            empty.classList.remove('hidden'); return;
        }
        document.querySelector('.table-card').style.display = '';
        empty.classList.add('hidden');
        body.innerHTML = filtered.map(p => `<tr onclick="showPatientDetail('${p.id}')">
            <td><div class="patient-cell">
                <div class="patient-avatar">${initials(p.nom, p.prenom)}</div>
                <span class="patient-name">${p.nom.toUpperCase()} ${p.prenom}</span>
            </div></td>
            <td>${fmtDate(p.dateNaissance)} <small style="color:var(--text-muted)">(${calcAge(p.dateNaissance)} ans)</small></td>
            <td>${p.telephone}</td>
            <td><span class="badge ${p.genre === 'Homme' ? 'badge-male' : 'badge-female'}">${p.genre}</span></td>
            <td><span class="sessions-count"><i class="fa-solid fa-wave-square" style="color:var(--primary);font-size:0.8rem"></i> ${(p.sessions || []).length}</span></td>
            <td class="actions-col"><div class="action-buttons">
                <button class="btn-icon" onclick="event.stopPropagation();editPatient('${p.id}')" title="Modifier"><i class="fa-solid fa-pen"></i></button>
                <button class="btn-icon danger" onclick="event.stopPropagation();deletePatient('${p.id}')" title="Supprimer"><i class="fa-solid fa-trash"></i></button>
            </div></td>
        </tr>`).join('');
    }

    document.getElementById('searchPatient').addEventListener('input', e => renderPatients(e.target.value));

    const pModal = document.getElementById('patientModal');
    const pForm  = document.getElementById('patientForm');

    function openPatientModal(p = null) {
        document.getElementById('patientModalTitle').textContent = p ? 'Modifier le Patient' : 'Ajouter un Patient';
        document.getElementById('patientId').value   = p ? p.id : '';
        document.getElementById('pNom').value        = p ? p.nom    : '';
        document.getElementById('pPrenom').value     = p ? p.prenom : '';
        document.getElementById('pDate').value       = p ? p.dateNaissance : '';
        document.getElementById('pDate').max         = today;
        document.getElementById('pTel').value        = p ? p.telephone : '';
        document.getElementById('pGenre').value      = p ? p.genre  : '';
        document.getElementById('pNotes').value      = p ? (p.notes || '') : '';
        document.getElementById('patientFormError').classList.add('hidden');
        pModal.classList.add('show');
    }

    document.getElementById('addPatientBtn').addEventListener('click', () => openPatientModal());
    document.getElementById('closePatientModal').addEventListener('click', () => pModal.classList.remove('show'));
    document.getElementById('cancelPatientModal').addEventListener('click', () => pModal.classList.remove('show'));
    pModal.addEventListener('click', e => { if (e.target === pModal) pModal.classList.remove('show'); });

    function validatePatient() {
        const nom    = document.getElementById('pNom').value.trim();
        const prenom = document.getElementById('pPrenom').value.trim();
        const date   = document.getElementById('pDate').value;
        const tel    = document.getElementById('pTel').value.trim();
        const genre  = document.getElementById('pGenre').value;
        if (nom.length < 2)    return 'Le nom doit contenir au moins 2 caractères.';
        if (prenom.length < 2) return 'Le prénom doit contenir au moins 2 caractères.';
        if (!date)             return 'La date de naissance est requise.';
        const dob = new Date(date + 'T12:00:00');
        if (dob > new Date())  return 'La date de naissance doit être dans le passé.';
        if ((Date.now() - dob) / (1000 * 60 * 60 * 24 * 365.25) > 120) return 'Date de naissance invalide.';
        if (!tel)              return 'Le numéro de téléphone est requis.';
        if (!genre)            return 'Veuillez sélectionner le genre.';
        return null;
    }

    pForm.addEventListener('submit', async e => {
        e.preventDefault();
        const errEl = document.getElementById('patientFormError');
        const err   = validatePatient();
        if (err) { showFormError(errEl, err); return; }
        errEl.classList.add('hidden');

        const data = {
            nom:           document.getElementById('pNom').value.trim(),
            prenom:        document.getElementById('pPrenom').value.trim(),
            dateNaissance: document.getElementById('pDate').value,
            telephone:     document.getElementById('pTel').value.trim(),
            genre:         document.getElementById('pGenre').value,
            notes:         document.getElementById('pNotes').value.trim()
        };

        const id = document.getElementById('patientId').value;
        if (id) {
            const updated = await api('PUT', `/patients/${id}`, data);
            if (!updated) return;
            const idx = patients.findIndex(p => p.id === id);
            if (idx !== -1) patients[idx] = updated;
            toast('Patient modifié avec succès.');
        } else {
            const created = await api('POST', '/patients', data);
            if (!created) return;
            patients.push(created);
            toast('Nouveau patient ajouté.');
        }
        pModal.classList.remove('show'); pForm.reset();
        renderPatients(document.getElementById('searchPatient').value);
        renderStats();
    });

    window.editPatient = id => { const p = patients.find(x => x.id === id); if (p) openPatientModal(p); };

    window.deletePatient = async id => {
        if (!confirm('Supprimer ce patient et tout son historique ?')) return;
        const result = await api('DELETE', `/patients/${id}`);
        if (!result) return;
        patients     = patients.filter(p => p.id !== id);
        appointments = appointments.filter(a => a.patientId !== id);
        renderPatients(document.getElementById('searchPatient').value);
        renderStats();
        toast('Patient supprimé.', 'info');
    };

    // Détail patient
    let progressChartInstance = null;

    function renderPatientDetail() {
        const p = patients.find(x => x.id === currentDetailPatientId); if (!p) return;
        document.getElementById('detailAvatar').textContent = initials(p.nom, p.prenom);
        document.getElementById('detailName').textContent   = `${p.nom.toUpperCase()} ${p.prenom}`;
        document.getElementById('detailMeta').textContent   = `${p.genre} • ${calcAge(p.dateNaissance)} ans • ${p.telephone}`;
        const notesEl = document.getElementById('detailNotes');
        if (p.notes) { notesEl.textContent = p.notes; notesEl.classList.remove('hidden'); }
        else { notesEl.classList.add('hidden'); }

        const sessions      = p.sessions || [];
        const histList      = document.getElementById('sessionHistoryList');
        const emptyH        = document.getElementById('emptyHistory');
        const progContainer = document.getElementById('progressChartContainer');

        if (!sessions.length) {
            histList.innerHTML = ''; emptyH.classList.remove('hidden'); progContainer.style.display = 'none'; return;
        }
        emptyH.classList.add('hidden');
        histList.innerHTML = sessions.map((s, i) => {
            const balClass  = s.balance >= 90 ? 'good' : s.balance >= 75 ? 'ok' : 'bad';
            const notesHtml = s.notes ? `<div class="session-notes"><i class="fa-solid fa-note-sticky"></i> ${s.notes}</div>` : '';
            return `<div class="session-card">
                <div class="session-left">
                    <div class="session-date"><i class="fa-solid fa-calendar"></i> ${fmtDate(s.date)} — Séance ${i + 1}</div>
                    ${notesHtml}
                </div>
                <div class="session-stats">
                    <div class="stat"><div class="stat-label">RMS G</div><div class="stat-value">${s.rmsLeft.toFixed(0)} mV</div></div>
                    <div class="stat"><div class="stat-label">RMS D</div><div class="stat-value">${s.rmsRight.toFixed(0)} mV</div></div>
                    <div class="stat"><div class="stat-label">Balance</div><div class="stat-value ${balClass}">${s.balance.toFixed(1)}%</div></div>
                    <div class="stat"><div class="stat-label">Durée</div><div class="stat-value">${Math.floor(s.duration / 60)}:${(s.duration % 60).toString().padStart(2, '0')}</div></div>
                </div>
                <button class="btn-icon danger" style="align-self:center;flex-shrink:0" onclick="deleteSession('${p.id}','${s.id}')" title="Supprimer cette séance"><i class="fa-solid fa-trash"></i></button>
            </div>`;
        }).join('');

        progContainer.style.display = 'block';
        if (progressChartInstance) progressChartInstance.destroy();
        progressChartInstance = new Chart(document.getElementById('progressChart'), {
            type: 'line',
            data: {
                labels: sessions.map((s, i) => `S${i + 1}`),
                datasets: [{ label: 'Balance (%)', data: sessions.map(s => s.balance), borderColor: '#06b6d4', backgroundColor: 'rgba(6,182,212,0.15)', fill: true, tension: 0.4, pointRadius: 5, pointBackgroundColor: '#06b6d4' }]
            },
            options: {
                responsive: true, plugins: { legend: { display: false } },
                scales: {
                    y: { min: 0, max: 100, grid: { color: 'rgba(148,163,184,0.08)' }, ticks: { color: '#94a3b8', font: { family: 'Inter' } } },
                    x: { grid: { display: false }, ticks: { color: '#94a3b8', font: { family: 'Inter' } } }
                }
            }
        });
    }

    window.showPatientDetail = id => {
        currentDetailPatientId = id;
        document.getElementById('patientListContainer').classList.add('hidden');
        document.getElementById('patientDetailView').classList.remove('hidden');
        renderPatientDetail();
    };

    window.deleteSession = async (patientId, sessionId) => {
        if (!confirm('Supprimer cette séance ?')) return;
        const result = await api('DELETE', `/patients/${patientId}/sessions/${sessionId}`);
        if (!result) return;
        const p = patients.find(x => x.id === patientId); if (!p) return;
        p.sessions = p.sessions.filter(s => s.id !== sessionId);
        renderPatientDetail(); renderStats();
        toast('Séance supprimée.', 'info');
    };

    document.getElementById('backToListBtn').addEventListener('click', showPatientList);

    // ── EMG : Balance Moyenne & Seuil par patient ─────────────────────────────
    let currentEmgThreshold = loadSettings().alertThreshold;

    function updateEmgAvgBal() {
        const pid = document.getElementById('emgPatientSelect').value;
        let val = '—';
        if (pid) {
            const p = patients.find(x => x.id === pid);
            const sessions = p ? (p.sessions || []) : [];
            if (sessions.length)
                val = (sessions.reduce((s, x) => s + x.balance, 0) / sessions.length).toFixed(1) + '%';
        } else {
            const all = patients.flatMap(p => p.sessions || []);
            if (all.length)
                val = (all.reduce((s, x) => s + x.balance, 0) / all.length).toFixed(1) + '%';
        }
        document.getElementById('emgAvgBal').textContent = val;
    }

    function loadEmgThresholdInline() {
        const pid = document.getElementById('emgPatientSelect').value;
        const p = pid ? patients.find(x => x.id === pid) : null;
        currentEmgThreshold = p ? (p.seuilAlerte ?? loadSettings().alertThreshold) : loadSettings().alertThreshold;
        document.getElementById('emgThreshold').value = currentEmgThreshold;
        document.getElementById('emgThresholdVal').textContent = currentEmgThreshold + '%';
    }

    document.getElementById('emgThreshold').addEventListener('input', function () {
        const val = parseInt(this.value);
        currentEmgThreshold = val;
        document.getElementById('emgThresholdVal').textContent = val + '%';
        const pid = document.getElementById('emgPatientSelect').value;
        if (pid) {
            api('PATCH', `/patients/${pid}/seuil`, { seuilAlerte: val });
            const p = patients.find(x => x.id === pid);
            if (p) p.seuilAlerte = val;
        } else {
            const s = loadSettings();
            s.alertThreshold = val;
            saveSettings(s);
        }
    });

    // ── EMG Live ──────────────────────────────────────────────────────────────
    let emgChart = null, emgProgressChart = null;
    let emgRunning = false, emgInterval = null, timerInterval = null;
    let emgSeconds = 0, emgTick = 0;
    let rmsLeftSamples = [], rmsRightSamples = [];

    let emgSource        = 'simulation';
    let arduinoConnected = false;
    let esp32Connected   = false;

    // ── WebSocket (données Arduino depuis le serveur) ─────────────────────────
    let ws = null;

    function connectWebSocket() {
        const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
        ws = new WebSocket(`${proto}//${location.host}`);

        ws.addEventListener('open', () => {
            console.log('[WS] Connecté au serveur');
        });

        ws.addEventListener('message', e => {
            try {
                const msg = JSON.parse(e.data);
                if (msg.type === 'emg' && emgRunning && (emgSource === 'arduino' || emgSource === 'esp32')) {
                    processEmgValues(msg.vL, msg.vR);
                }
                if (msg.type === 'status') {
                    arduinoConnected = msg.connected;
                    updateArduinoStatus(msg.connected, msg.port, msg.error);
                    if (msg.esp32) { esp32Connected = true; updateEsp32Status(true); }
                }
                if (msg.type === 'esp32') {
                    esp32Connected = msg.connected;
                    updateEsp32Status(msg.connected);
                }
            } catch (_) {}
        });

        ws.addEventListener('close', () => {
            setTimeout(connectWebSocket, 3000);
        });

        ws.addEventListener('error', () => ws.close());
    }

    connectWebSocket();

    // ── Gestion Arduino (port série côté serveur) ─────────────────────────────
    async function loadArduinoPorts() {
        const ports = await api('GET', '/arduino/ports');
        if (!ports) return;
        const sel = document.getElementById('arduinoPortSelect');
        const current = sel.value;
        sel.innerHTML = '<option value="">— Port COM —</option>' +
            ports.map(p => `<option value="${p.path}">${p.path}${p.manufacturer ? ' · ' + p.manufacturer : ''}</option>`).join('');
        if (current) sel.value = current;
        if (!ports.length) toast('Aucun port COM détecté. Vérifiez la connexion USB.', 'info');
    }

    function updateEsp32Status(connected) {
        document.getElementById('esp32Dot').className = 'status-dot ' + (connected ? 'connected' : 'disconnected');
        document.getElementById('esp32StatusText').textContent = connected ? 'ESP32 connecté' : 'En attente ESP32...';
    }

    async function loadEsp32Panel() {
        const info = await api('GET', '/server-ip');
        if (info) {
            document.getElementById('esp32Url').textContent = `ws://${info.ip}:${info.port}/esp32`;
        }
        updateEsp32Status(esp32Connected);
    }

    function updateArduinoStatus(connected, port, error) {
        document.getElementById('statusDot').className = 'status-dot ' + (connected ? 'connected' : 'disconnected');
        document.getElementById('serialStatusText').textContent = connected
            ? `Connecté · ${port}`
            : (error ? 'Erreur : ' + error : 'Déconnecté');
        document.getElementById('arduinoConnectBtn').innerHTML = connected
            ? '<i class="fa-solid fa-link-slash"></i> Déconnecter'
            : '<i class="fa-solid fa-link"></i> Connecter';
    }

    document.getElementById('dismissAlertBtn').addEventListener('click', () => {
        document.getElementById('balanceAlert').classList.add('hidden');
        alertFrames = 0;
    });

    document.querySelectorAll('.source-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            if (emgRunning) return;
            document.querySelectorAll('.source-btn').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            emgSource = btn.dataset.source;
            document.getElementById('arduinoPanel').classList.add('hidden');
            document.getElementById('esp32Panel').classList.add('hidden');
            if (emgSource === 'arduino') {
                document.getElementById('arduinoPanel').classList.remove('hidden');
                loadArduinoPorts();
            } else if (emgSource === 'esp32') {
                document.getElementById('esp32Panel').classList.remove('hidden');
                loadEsp32Panel();
            }
        });
    });

    document.getElementById('arduinoRefreshBtn').addEventListener('click', loadArduinoPorts);

    document.getElementById('arduinoConnectBtn').addEventListener('click', async () => {
        if (arduinoConnected) {
            await api('POST', '/arduino/disconnect');
        } else {
            const port = document.getElementById('arduinoPortSelect').value;
            if (!port) { toast('Sélectionnez un port COM.', 'error'); return; }
            const { baudRate } = loadSettings();
            const result = await api('POST', '/arduino/connect', { port, baudRate });
            if (result) toast(`Arduino connecté sur ${port}.`);
        }
    });

    // ── Traitement signal EMG ─────────────────────────────────────────────────
    function processEmgValues(valL, valR) {
        if (!emgRunning) return;

        emgChart.data.labels.push(emgChart.data.labels.length);
        emgChart.data.datasets[0].data.push(valL);
        emgChart.data.datasets[1].data.push(valR);
        if (emgChart.data.labels.length > 80) {
            emgChart.data.labels.shift();
            emgChart.data.datasets[0].data.shift();
            emgChart.data.datasets[1].data.shift();
        }
        emgChart.update();

        rmsLeftSamples.push(valL); rmsRightSamples.push(valR);
        const win    = 20;
        const sliceL = rmsLeftSamples.slice(-win);
        const sliceR = rmsRightSamples.slice(-win);
        const rmsL   = Math.sqrt(sliceL.reduce((s, v) => s + v * v, 0) / sliceL.length);
        const rmsR   = Math.sqrt(sliceR.reduce((s, v) => s + v * v, 0) / sliceR.length);

        document.getElementById('rmsLeftVal').innerHTML  = `${rmsL.toFixed(0)} <span>mV</span>`;
        document.getElementById('rmsRightVal').innerHTML = `${rmsR.toFixed(0)} <span>mV</span>`;
        document.getElementById('rmsLeftBar').style.width  = Math.min(rmsL / 5, 100) + '%';
        document.getElementById('rmsRightBar').style.width = Math.min(rmsR / 5, 100) + '%';

        // Signal progress bars (max scale: 500 mV)
        const sigMax = 500;
        document.getElementById('sigBarLeft').style.width  = Math.min(rmsL / sigMax * 100, 100) + '%';
        document.getElementById('sigBarRight').style.width = Math.min(rmsR / sigMax * 100, 100) + '%';
        document.getElementById('sigValLeft').textContent  = rmsL.toFixed(0) + ' mV';
        document.getElementById('sigValRight').textContent = rmsR.toFixed(0) + ' mV';

        const balance = Math.max(rmsL, rmsR) > 0 ? (Math.min(rmsL, rmsR) / Math.max(rmsL, rmsR)) * 100 : 0;
        document.getElementById('balanceVal').textContent = balance.toFixed(1) + '%';
        const circ = 2 * Math.PI * 52;
        document.getElementById('balanceArc').style.strokeDashoffset = circ - (circ * balance / 100);
        document.getElementById('balanceArc').style.stroke = balance >= 90 ? '#10b981' : balance >= 75 ? '#f59e0b' : '#ef4444';


        if (rmsLeftSamples.length >= win) {
            const combined = [...sliceL, ...sliceR];
            const mean  = combined.reduce((s, v) => s + v, 0) / combined.length;
            const sd    = Math.sqrt(combined.reduce((s, v) => s + (v - mean) ** 2, 0) / combined.length);
            const cv    = mean > 0 ? sd / mean : 1;
            const dot   = document.getElementById('sqDot');
            const lbl   = document.getElementById('sqLabel');
            const badge = document.getElementById('signalQualityBadge');
            badge.classList.remove('hidden');
            if (cv < 0.22)      { dot.className = 'sq-dot sq-good'; lbl.textContent = 'Signal excellent'; }
            else if (cv < 0.40) { dot.className = 'sq-dot sq-ok';   lbl.textContent = 'Signal acceptable'; }
            else                { dot.className = 'sq-dot sq-bad';  lbl.textContent = 'Bruit élevé'; }
        }
    }

    function populateEmgPatientSelect() {
        const sel     = document.getElementById('emgPatientSelect');
        const current = sel.value;
        sel.innerHTML = '<option value="">— Sélectionnez —</option>' +
            patients.map(p => `<option value="${p.id}">${p.nom} ${p.prenom}</option>`).join('');
        if (current) sel.value = current;
    }

    document.getElementById('emgPatientSelect').addEventListener('change', e => {
        document.getElementById('startEmgBtn').disabled = !e.target.value;
        loadEmgProgress();
        loadEmgThresholdInline();
        updateEmgAvgBal();
    });

    function initEmgCharts() {
        if (emgChart) return;
        const n = 80;
        emgChart = new Chart(document.getElementById('emgLiveChart').getContext('2d'), {
            type: 'line',
            data: {
                labels: Array.from({ length: n }, (_, i) => i),
                datasets: [
                    { label: 'Gauche', data: Array(n).fill(0), borderColor: '#06b6d4', backgroundColor: 'rgba(6,182,212,0.08)', borderWidth: 2, pointRadius: 0, tension: 0.3, fill: true },
                    { label: 'Droite', data: Array(n).fill(0), borderColor: '#8b5cf6', backgroundColor: 'rgba(139,92,246,0.08)', borderWidth: 2, pointRadius: 0, tension: 0.3, fill: true }
                ]
            },
            options: {
                responsive: true, maintainAspectRatio: false, animation: { duration: 0 },
                plugins: { legend: { display: false } },
                scales: {
                    y: { min: 0, max: 600, grid: { color: 'rgba(148,163,184,0.08)' }, ticks: { color: '#94a3b8', font: { family: 'Inter' } }, title: { display: true, text: 'mV', color: '#64748b', font: { family: 'Inter' } } },
                    x: { display: false }
                }
            }
        });
    }

    function loadEmgProgress() {
        const pid  = document.getElementById('emgPatientSelect').value;
        const card = document.getElementById('emgProgressCard');
        if (!pid) { card.style.display = 'none'; return; }
        const p = patients.find(x => x.id === pid);
        if (!p || !(p.sessions || []).length) { card.style.display = 'none'; return; }
        card.style.display = 'block';
        if (emgProgressChart) emgProgressChart.destroy();
        emgProgressChart = new Chart(document.getElementById('emgProgressChart'), {
            type: 'bar',
            data: {
                labels: p.sessions.map((s, i) => `Séance ${i + 1}`),
                datasets: [
                    { label: 'RMS Gauche', data: p.sessions.map(s => s.rmsLeft),  backgroundColor: 'rgba(6,182,212,0.6)', borderRadius: 6 },
                    { label: 'RMS Droite', data: p.sessions.map(s => s.rmsRight), backgroundColor: 'rgba(139,92,246,0.6)', borderRadius: 6 }
                ]
            },
            options: {
                responsive: true,
                plugins: { legend: { labels: { color: '#94a3b8', font: { family: 'Inter' } } } },
                scales: {
                    y: { grid: { color: 'rgba(148,163,184,0.08)' }, ticks: { color: '#94a3b8' } },
                    x: { grid: { display: false }, ticks: { color: '#94a3b8' } }
                }
            }
        });
    }

    document.getElementById('startEmgBtn').addEventListener('click', startEmg);
    document.getElementById('stopEmgBtn').addEventListener('click', stopEmg);

    function startEmg() {
        if (!document.getElementById('emgPatientSelect').value) return;
        if (emgSource === 'arduino' && !arduinoConnected) { toast("Connectez l'Arduino avant de démarrer.", 'error'); return; }
        if (emgSource === 'esp32'   && !esp32Connected)   { toast("Aucun ESP32 connecté. Vérifiez la connexion WiFi.", 'error'); return; }
        emgRunning = true; emgSeconds = 0; emgTick = 0;
        rmsLeftSamples = []; rmsRightSamples = [];
        document.getElementById('startEmgBtn').classList.add('hidden');
        document.getElementById('stopEmgBtn').classList.remove('hidden');
        document.getElementById('emgPatientSelect').disabled = true;
        document.querySelectorAll('.source-btn').forEach(b => b.disabled = true);
        document.getElementById('emgStatus').textContent = 'Enregistrement...';
        document.getElementById('emgStatus').classList.add('running');
        document.getElementById('balanceAlert').classList.add('hidden');
        document.getElementById('signalQualityBadge').classList.add('hidden');

        timerInterval = setInterval(() => {
            emgSeconds++;
            document.getElementById('emgTimer').textContent =
                `${Math.floor(emgSeconds / 60).toString().padStart(2, '0')}:${(emgSeconds % 60).toString().padStart(2, '0')}`;
        }, 1000);

        if (emgSource === 'simulation') {
            emgInterval = setInterval(() => {
                emgTick += 0.1;
                const bL = Math.abs(Math.sin(emgTick * 1.8)) * 280 + 50;
                const bR = Math.abs(Math.sin(emgTick * 1.8 + 0.3)) * 240 + 50;
                processEmgValues(bL + (Math.random() - 0.5) * 80, bR + (Math.random() - 0.5) * 70);
            }, 100);
        }
    }

    async function stopEmg() {
        clearInterval(emgInterval); clearInterval(timerInterval);
        emgRunning = false;
        document.getElementById('startEmgBtn').classList.remove('hidden');
        document.getElementById('stopEmgBtn').classList.add('hidden');
        document.getElementById('emgPatientSelect').disabled = false;
        document.querySelectorAll('.source-btn').forEach(b => b.disabled = false);
        document.getElementById('emgStatus').textContent = 'Terminé';
        document.getElementById('emgStatus').classList.remove('running');
        document.getElementById('balanceAlert').classList.add('hidden');

        const pid = document.getElementById('emgPatientSelect').value;
        const p   = patients.find(x => x.id === pid);
        if (p && rmsLeftSamples.length > 0) {
            // Limiter à 6000 échantillons max (≈ 10 min à 10 Hz)
            const MAX_SAMPLES = 6000;
            const samplesL = rmsLeftSamples.slice(-MAX_SAMPLES);
            const samplesR = rmsRightSamples.slice(-MAX_SAMPLES);

            const avgL = Math.sqrt(samplesL.reduce((s, v) => s + v * v, 0) / samplesL.length);
            const avgR = Math.sqrt(samplesR.reduce((s, v) => s + v * v, 0) / samplesR.length);
            const bal  = Math.max(avgL, avgR) > 0 ? (Math.min(avgL, avgR) / Math.max(avgL, avgR)) * 100 : 0;

            const session = await api('POST', `/patients/${pid}/sessions`, {
                rmsLeft:    avgL,
                rmsRight:   avgR,
                balance:    bal,
                duration:   emgSeconds,
                notes:      document.getElementById('emgNotes').value.trim(),
                date:       today,
                signalData: { left: samplesL, right: samplesR }
            });
            if (session) {
                if (!p.sessions) p.sessions = [];
                p.sessions.push(session);
                document.getElementById('emgNotes').value = '';
                loadEmgProgress(); renderStats(); updateEmgAvgBal();
                toast(`Séance sauvegardée — Balance : ${bal.toFixed(1)}%`);

                if (bal < currentEmgThreshold) {
                    const alertEl = document.getElementById('balanceAlert');
                    alertEl.classList.remove('hidden');
                    document.getElementById('balanceAlertMsg').textContent =
                        `Balance finale ${bal.toFixed(1)}% — seuil du patient : ${currentEmgThreshold}%`;
                }
            }
        }
    }

    // ── Init ──────────────────────────────────────────────────────────────────
    renderStats();
    renderAppointments();
});
