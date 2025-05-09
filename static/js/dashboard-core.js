/**
 * dashboard-core.js - Module principal et unique pour le tableau de bord
 * Version: 2.2.3 - Version complète et intégrée finale.
 */

document.addEventListener('DOMContentLoaded', function() {
    if (window.dashboardCoreInitialized) {
        if (window.dashboardConfig && window.dashboardConfig.debugMode) {
            console.log('Dashboard Core (v2.2.3): Already initialized. Skipping.');
        }
        if (window.dashboardCore) {
            document.dispatchEvent(new CustomEvent('dashboardCoreFullyReady', { detail: { success: true, source: 'cached' } }));
        }
        return;
    }
    window.dashboardCoreInitialized = true;

    // --- Configuration ---
    const defaultConfig = {
        debugMode: false,
        autoRefreshInterval: 60000,
        minRefreshDelay: 15000,
        debounceDelay: 500,
        baseApiUrl: '/api', 
        fetchTimeoutDuration: 20000,
        maxErrorsBeforeThrottle: 3,
        errorThrottleDelay: 60000,
        useSimulatedDataOnError: true,
        pollingEnabled: true,
        activeMode: 'polling',
        themeColors: {
            'Communiquer avec Teams': '#464eb8',
            'Gérer les tâches (Planner)': '#038387',
            'Gérer mes fichiers (OneDrive/SharePoint)': '#0078d4',
            'Collaborer avec Teams': '#107c10',
            'default': '#6c757d'
        },
        serviceColors: {
            'Qualité': '#F44336',
            'Informatique': '#607D8B',
            'RH': '#FF9800',
            'Commerce Anecoop-Solagora': '#FFC107',
            'Marketing': '#9C27B0',
            'Florensud': '#4CAF50',
            'Comptabilité': '#2196F3',
            'default': '#7a7574'
        }
    };
    const baseAppUrlFromWindow = (window.dashboardConfig && typeof window.dashboardConfig.baseAppUrl === 'string') 
                               ? window.dashboardConfig.baseAppUrl 
                               : '';
    let effectiveApiUrl = (baseAppUrlFromWindow.endsWith('/') ? baseAppUrlFromWindow.slice(0, -1) : baseAppUrlFromWindow) + 
                          (defaultConfig.baseApiUrl.startsWith('/') ? defaultConfig.baseApiUrl : '/' + defaultConfig.baseApiUrl);
    if (effectiveApiUrl.startsWith('//')) { effectiveApiUrl = effectiveApiUrl.substring(1); }
    if (!effectiveApiUrl.startsWith('/') && !effectiveApiUrl.startsWith('http')) { effectiveApiUrl = '/' + effectiveApiUrl; }
    
    const config = { ...defaultConfig, ...(window.dashboardConfig || {}), baseApiUrl: effectiveApiUrl };
    if (window.dashboardConfig && typeof window.dashboardConfig.baseApiUrl === 'string') { config.baseApiUrl = window.dashboardConfig.baseApiUrl; }

    if (config.debugMode) { console.log('Dashboard Core (v2.2.3): Initializing.'); console.log('Dashboard Core: Effective Config', config); }

    // --- État de l'Application ---
    const globalLoadingOverlay = document.getElementById('loading-overlay');
    const dashboardState = {
        lastSuccessfulRefresh: 0, isUpdating: false,
        dataHashes: { sessions: null, participants: null, activites: null, services: null, salles: null },
        apiData: null, displayData: null, errorCount: 0, isErrorThrottleActive: false,
        pollingTimeoutId: null, themeChartInstance: null, serviceChartInstance: null,
        pollingActive: config.pollingEnabled && config.activeMode === 'polling',
        initialLoadComplete: false
    };

    // --- Gestionnaire d'Erreurs ---
    const errorHandler = window.apiErrorHandler || {
        handleApiError: (endpoint, errorData, statusCode) => { console.error(`[FallbackErrorHandler] API Error ${statusCode} on ${endpoint}:`, errorData); if (typeof showToast === 'function') showToast(`Erreur API (${statusCode}) chargement ${endpoint}.`, 'danger'); return false; },
        checkAndFixBrokenElements: () => { if (config.debugMode) console.log("[FallbackErrorHandler] Checking UI elements."); }
    };

    // --- Fonctions Utilitaires ---
    function showGlobalLoading(show) { if (globalLoadingOverlay) globalLoadingOverlay.classList.toggle('hidden', !show); }
    function debounce(func, delay) { let timeout; return function(...args) { clearTimeout(timeout); timeout = setTimeout(() => func.apply(this, args), delay); }; }
    function simpleHash(obj) { if (obj === null || typeof obj === 'undefined') return Math.random().toString(); const str = JSON.stringify(obj); let hash = 0; for (let i = 0; i < str.length; i++) { hash = ((hash << 5) - hash) + str.charCodeAt(i); hash |= 0; } return hash; }
    function getSimulatedData() { 
        if (config.debugMode) console.log("Dashboard Core: Providing simulated data.");
        return {
            sessions: [ { id: 1, date: "mardi 13 mai 2025", horaire: "09h00–10h30", theme: "Communiquer avec Teams", theme_id: 1, places_restantes: 0, inscrits: 10, max_participants: 10, liste_attente: 0, pending_validation_count: 1, salle: "Salle Tramontane", salle_id: 1 }, { id: 2, date: "mardi 13 mai 2025", horaire: "10h45–12h15", theme: "Communiquer avec Teams", theme_id: 1, places_restantes: 1, inscrits: 9, max_participants: 10, liste_attente: 0, pending_validation_count: 0, salle: "Salle Tramontane", salle_id: 1 }, ],
            participants: [ { id: 1, nom: "PHILIBERT", prenom: "Elodie", email: "e.philibert@example.com", service: "Qualité", service_id: "qualite", service_color: config.serviceColors['Qualité'] }, { id: 4, nom: "BIVIA", prenom: "Kevin", email: "k.bivia@example.com", service: "Informatique", service_id: "informatique", service_color: config.serviceColors['Informatique'] }, ],
            activites: [ { id: 1, type: "validation", description: "Validation inscription: Elodie PHILIBERT", details: "Session: Communiquer avec Teams", date_relative: "il y a 10 minutes", user: "admin" }, ],
            services: [ {id: "qualite", nom: "Qualité"}, {id: "informatique", nom: "Informatique"} ],
            salles: [ {id: 1, nom: "Salle Tramontane", capacite: 10} ],
            status: "ok_simulated", timestamp: Date.now()
        };
    }

    // --- Fonctions de Mise à Jour de l'UI ---
    function updateElementText(elementId, value, defaultValue = '0') { const element = document.getElementById(elementId); if (element) { const spinner = element.querySelector('.spinner-border'); if (spinner) spinner.remove(); element.textContent = (typeof value === 'number' ? value.toLocaleString() : value) || defaultValue; } }
    function updateStatisticsCounters(sessions = []) { try { let stats = { totalInscriptions: 0, totalEnAttente: 0, totalSessions: 0, totalSessionsCompletes: 0 }; if (Array.isArray(sessions)) { stats.totalSessions = sessions.length; sessions.forEach(session => { const inscrits = parseInt(session.inscrits, 10) || 0; const maxParticipants = parseInt(session.max_participants, 10) || 0; let placesRestantes = session.places_restantes; if (typeof placesRestantes !== 'number' || isNaN(placesRestantes)) { placesRestantes = (maxParticipants > 0) ? Math.max(0, maxParticipants - inscrits) : 0; } stats.totalInscriptions += inscrits; stats.totalEnAttente += parseInt(session.liste_attente, 10) || 0; if (maxParticipants > 0 && placesRestantes <= 0) { stats.totalSessionsCompletes++; } }); } updateElementText('total-sessions-programmes', stats.totalSessions); updateElementText('total-inscriptions-confirmees', stats.totalInscriptions); updateElementText('total-en-attente', stats.totalEnAttente); updateElementText('total-sessions-completes', stats.totalSessionsCompletes); } catch (e) { console.error('Dashboard Core: Error in updateStatisticsCounters', e); ['total-sessions-programmes', 'total-inscriptions-confirmees', 'total-en-attente', 'total-sessions-completes'].forEach(id => updateElementText(id, 'N/A')); } }
    function updateSessionTable(sessions = []) { const sessionTableBody = document.querySelector('#sessions-a-venir-table tbody'); if (!sessionTableBody) { if (config.debugMode) console.warn("updateSessionTable: Table body '#sessions-a-venir-table tbody' not found."); return; } sessionTableBody.innerHTML = ''; if (!Array.isArray(sessions) || sessions.length === 0) { const cols = sessionTableBody.closest('table')?.querySelectorAll('thead th').length || 5; sessionTableBody.innerHTML = `<tr class="no-data-row"><td colspan="${cols}" class="text-center p-4 text-muted"><i class="fas fa-info-circle me-2"></i>Aucune session à venir.</td></tr>`; return; } sessions.forEach(session => { const inscrits = parseInt(session.inscrits, 10) || 0; const maxParticipants = parseInt(session.max_participants, 10) || 0; let placesRestantes = session.places_restantes; if (typeof placesRestantes !== 'number' || isNaN(placesRestantes)) { placesRestantes = (maxParticipants > 0) ? Math.max(0, maxParticipants - inscrits) : 0; } let placesClass = 'text-success'; let placesIcon = 'fa-check-circle'; if (maxParticipants > 0) { if (placesRestantes <= 0) { placesClass = 'text-danger fw-bold'; placesIcon = 'fa-times-circle'; } else if (placesRestantes <= Math.floor(maxParticipants * 0.25)) { placesClass = 'text-warning'; placesIcon = 'fa-exclamation-triangle';} } else { placesClass = 'text-muted'; placesIcon = 'fa-minus-circle'; } const themeName = session.theme || 'N/A'; const themeColor = config.themeColors[themeName] || config.themeColors.default; const rowHtml = `<tr class="session-row" data-session-id="${session.id || ''}"><td><span class="fw-bold d-block">${session.date || 'N/A'}</span><small class="text-secondary">${session.horaire || 'N/A'}</small></td><td class="theme-cell"><span class="theme-badge" style="background-color: ${themeColor}; color: white;" data-bs-toggle="tooltip" title="${themeName}">${themeName}</span></td><td class="places-dispo text-nowrap ${placesClass} text-center"><i class="fas ${placesIcon} me-1"></i> ${placesRestantes} / ${maxParticipants || '∞'}</td><td class="js-salle-cell">${session.salle ? `<span class="badge bg-light text-dark border">${session.salle}</span>` : '<span class="badge bg-secondary">Non définie</span>'}</td><td class="text-nowrap text-center"><button type="button" class="btn btn-sm btn-outline-secondary me-1 action-btn btn-view-session-participants" data-bs-toggle="modal" data-bs-target="#genericParticipantsModal" data-session-id="${session.id || ''}" title="Voir les participants (${inscrits})"><i class="fas fa-users"></i> <span class="badge bg-secondary ms-1">${inscrits}</span></button><button type="button" class="btn btn-sm btn-primary me-1 action-btn btn-inscrire-session" data-bs-toggle="modal" data-bs-target="#genericInscriptionModal" data-session-id="${session.id || ''}" title="Inscrire un participant"><i class="fas fa-plus"></i></button>${(window.dashboardConfig && window.dashboardConfig.isAdmin) ? `<button type="button" class="btn btn-sm btn-outline-info action-btn btn-attribuer-salle" data-bs-toggle="modal" data-bs-target="#genericAttribuerSalleModal" data-session-id="${session.id || ''}" title="Attribuer Salle"><i class="fas fa-building"></i></button>` : ''}</td></tr>`; sessionTableBody.insertAdjacentHTML('beforeend', rowHtml); }); initTooltips(sessionTableBody); }
    function updateActivityFeed(activities = []) { const container = document.getElementById('recent-activity-list'); if (!container) { if (config.debugMode) console.warn("updateActivityFeed: Activity container '#recent-activity-list' not found."); return; } const spinner = document.getElementById('activity-loading-spinner'); if (spinner) spinner.style.display = 'none'; container.innerHTML = ''; if (!Array.isArray(activities) || activities.length === 0) { container.innerHTML = `<li class="list-group-item text-center p-3 text-muted"><i class="fas fa-info-circle me-2"></i>Aucune activité récente.</li>`; return; } activities.forEach(activity => { const iconMap = { 'connexion': 'fas fa-sign-in-alt text-success', 'deconnexion': 'fas fa-sign-out-alt text-warning', 'inscription': 'fas fa-user-plus text-primary', 'validation': 'fas fa-check-circle text-success', 'refus': 'fas fa-times-circle text-danger', 'annulation': 'fas fa-ban text-danger', 'ajout_participant': 'fas fa-user-tag text-info', 'suppression_participant': 'fas fa-user-slash text-danger', 'modification_participant': 'fas fa-user-edit text-warning', 'liste_attente': 'fas fa-clock text-warning', 'ajout_document': 'fas fa-file-medical text-info', 'suppression_document': 'fas fa-file-excel text-danger', 'systeme': 'fas fa-cogs text-secondary', 'default': 'fas fa-info-circle text-secondary' }; const icon = iconMap[activity.type] || iconMap.default; const userHtml = activity.user ? `<span class="text-primary fw-bold">${activity.user}</span>` : 'Système'; const detailsHtml = activity.details ? `<p class="mb-1 activity-details text-muted small"><i class="fas fa-info-circle fa-fw me-1"></i>${activity.details}</p>` : ''; const itemHtml = `<li class="list-group-item activity-item type-${activity.type || 'default'}" data-activity-id="${activity.id || ''}"><div class="d-flex w-100 justify-content-between"><h6 class="mb-1 activity-title"><i class="${icon} me-2 fa-fw"></i>${activity.description || 'N/A'}</h6><small class="text-muted activity-time text-nowrap ms-2">${activity.date_relative || ''}</small></div>${detailsHtml}<small class="text-muted d-block mt-1"><i class="fas fa-user fa-fw me-1"></i>Par: ${userHtml}</small></li>`; container.insertAdjacentHTML('beforeend', itemHtml); }); }
    function updateCharts(sessions = [], participants = []) { try { updateThemeDistributionChart(sessions); updateServiceDistributionChart(participants); } catch (e) { console.error('Dashboard Core: Error in updateCharts', e); } }
    function createChart(canvasId, type, data, options) { const canvas = document.getElementById(canvasId); if (!canvas) { if (config.debugMode) console.warn(`createChart: Canvas with ID '${canvasId}' not found.`); return null; } const ctx = canvas.getContext('2d'); const parentContainer = canvas.parentNode; parentContainer.querySelector('.no-data-message-chart')?.remove(); if (!data || !data.labels || data.labels.length === 0 || !data.datasets || data.datasets.some(ds => !ds.data || ds.data.length === 0 || ds.data.every(val => val === 0) )) { const noDataMsg = document.createElement('div'); noDataMsg.className = 'no-data-message-chart text-center p-3 text-muted d-flex flex-column justify-content-center align-items-center h-100'; noDataMsg.innerHTML = `<i class="fas ${type === 'doughnut' ? 'fa-chart-pie' : 'fa-chart-bar'} fa-2x mb-2 text-gray-300"></i><p class="mb-0">Aucune donnée à afficher.</p>`; parentContainer.appendChild(noDataMsg); return null; } return new Chart(ctx, { type, data, options }); }
    function updateThemeDistributionChart(sessions = []) { if (dashboardState.themeChartInstance) dashboardState.themeChartInstance.destroy(); const themeCounts = {}; if (Array.isArray(sessions)) { sessions.forEach(session => { const theme = session.theme || 'Non défini'; themeCounts[theme] = (themeCounts[theme] || 0) + (parseInt(session.inscrits, 10) || 0); }); } const labels = Object.keys(themeCounts).filter(k => themeCounts[k] > 0); const dataValues = labels.map(l => themeCounts[l]); const backgroundColors = labels.map(label => config.themeColors[label] || config.themeColors.default); dashboardState.themeChartInstance = createChart('themeDistributionChart', 'doughnut', { labels: labels, datasets: [{ data: dataValues, backgroundColor: backgroundColors, borderWidth: 1, hoverOffset: 4 }] }, { responsive: true, maintainAspectRatio: false, cutout: '65%', plugins: { legend: { position: 'bottom', labels: { font: { size: 11 }, boxWidth: 12, padding: 10, usePointStyle: true } }, tooltip: { callbacks: { label: (c) => { const total = c.dataset.data.reduce((a,b)=>a+b,0); return ` ${c.label}: ${c.raw} (${(total > 0 ? (c.raw / total * 100) : 0).toFixed(0)}%)`;} } } } }); }
    function updateServiceDistributionChart(participants = []) { if (dashboardState.serviceChartInstance) dashboardState.serviceChartInstance.destroy(); const serviceCounts = {}; if (Array.isArray(participants)) { participants.forEach(participant => { const service = participant.service || 'Non défini'; serviceCounts[service] = (serviceCounts[service] || 0) + 1; }); } const labels = Object.keys(serviceCounts).filter(k => serviceCounts[k] > 0); const dataValues = labels.map(l => serviceCounts[l]); const backgroundColors = labels.map(label => { const pWithColor = Array.isArray(participants) ? participants.find(p => p.service === label && p.service_color) : null; return pWithColor ? pWithColor.service_color : (config.serviceColors[label] || config.serviceColors.default); }); dashboardState.serviceChartInstance = createChart('serviceDistributionChart', 'bar', { labels: labels, datasets: [{ label: 'Participants', data: dataValues, backgroundColor: backgroundColors, borderWidth: 0, barThickness: 'flex', maxBarThickness: 30 }] }, { indexAxis: 'y', responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } }, scales: { x: { beginAtZero: true, ticks: { precision: 0, stepSize: 1 } }, y: { ticks: { font: {size: 10 }}}} }); }
    function initTooltips(parentElement = document) { if (typeof bootstrap !== 'undefined' && bootstrap.Tooltip) { const tooltipTriggerList = Array.from(parentElement.querySelectorAll('[data-bs-toggle="tooltip"]')); tooltipTriggerList.forEach(el => { const existingTooltip = bootstrap.Tooltip.getInstance(el); if (existingTooltip) existingTooltip.dispose(); new bootstrap.Tooltip(el); }); } }

    // --- Gestion des Modales Génériques ---
    function populateSelectWithOptions(selectElement, optionsArray, valueField, textField, placeholder = "-- Choisir --", currentVal = null) { if (!selectElement || !Array.isArray(optionsArray)) { if(config.debugMode && !selectElement) console.warn("populateSelect: selectElement not found for placeholder:", placeholder); if(config.debugMode && !Array.isArray(optionsArray)) console.warn("populateSelect: optionsArray is not an array", optionsArray); if(selectElement) selectElement.innerHTML = `<option value="">${placeholder} (Erreur chargement)</option>`; return; } selectElement.innerHTML = `<option value="">${placeholder}</option>`; optionsArray.forEach(option => { const opt = document.createElement('option'); opt.value = option[valueField]; opt.textContent = typeof textField === 'function' ? textField(option) : option[textField]; if (currentVal !== null && String(option[valueField]) === String(currentVal)) { opt.selected = true; } selectElement.appendChild(opt); }); }
    function setupGenericModals() {
        const participantsModalEl = document.getElementById('genericParticipantsModal');
        if (participantsModalEl) {
            participantsModalEl.addEventListener('show.bs.modal', async function(event) {
                const button = event.relatedTarget; const sessionId = button.dataset.sessionId; if (!sessionId) return;
                const session = dashboardState.apiData?.sessions?.find(s => String(s.id) === String(sessionId));
                if (!session) { showToast("Données de session introuvables.", "danger"); return; }
                document.getElementById('genericParticipantsModalSessionTheme').textContent = session.theme;
                document.getElementById('genericParticipantsModalSessionDate').textContent = session.date;
                document.getElementById('genericParticipantsModalSessionHoraire').textContent = session.horaire;
                document.getElementById('genericParticipantsModalSessionSalle').textContent = session.salle || "Non définie";
                const placesBadge = document.getElementById('genericParticipantsModalPlacesBadge');
                if(placesBadge){ placesBadge.textContent = `${session.places_restantes} / ${session.max_participants} places dispo.`; placesBadge.className = `badge fs-6 ${session.places_restantes === 0 ? 'bg-danger' : (session.places_restantes <= 3 ? 'bg-warning text-dark' : 'bg-success')}`; }
                const btnInscrire = participantsModalEl.querySelector('.btn-inscrire-depuis-participants');
                if(btnInscrire) { btnInscrire.dataset.sessionId = sessionId; btnInscrire.style.display = session.places_restantes > 0 ? 'inline-block' : 'none'; }
                const spinner = document.getElementById('genericParticipantsModalSpinner'); const tabContent = document.getElementById('genericParticipantsTabsContent');
                if (spinner) spinner.style.display = 'flex'; if (tabContent) tabContent.style.display = 'none'; // flex pour centrer
                ['gConfirmesTableContainer', 'gEnAttenteTableContainer', 'gListeAttenteTableContainer'].forEach(id => { const el = document.getElementById(id); if(el) el.innerHTML = ''; });
                ['gConfirmesNoData', 'gEnAttenteNoData', 'gListeAttenteNoData'].forEach(id => { const el = document.getElementById(id); if(el) el.style.display = 'none'; });
                try {
                    const response = await fetch(`${config.baseApiUrl}/session/${sessionId}/participants_details`);
                    if (!response.ok) throw new Error(`Erreur ${response.status} chargement détails participants`);
                    const details = await response.json(); if (details.status !== 'ok') throw new Error(details.message || "Erreur API détails participants");
                    document.getElementById('gConfirmesCount').textContent = details.confirmes?.length || 0;
                    document.getElementById('gEnAttenteCount').textContent = details.en_attente_validation?.length || 0;
                    document.getElementById('gListeAttenteCount').textContent = details.liste_attente?.length || 0;
                    populateGenericParticipantsTable(document.getElementById('gConfirmesTableContainer'), details.confirmes, 'confirmes', document.getElementById('gConfirmesNoData'));
                    populateGenericParticipantsTable(document.getElementById('gEnAttenteTableContainer'), details.en_attente_validation, 'en_attente_validation', document.getElementById('gEnAttenteNoData'));
                    populateGenericParticipantsTable(document.getElementById('gListeAttenteTableContainer'), details.liste_attente, 'liste_attente', document.getElementById('gListeAttenteNoData'));
                } catch (err) { console.error("Erreur modale participants:", err); showToast(err.message || "Erreur chargement détails.", "danger"); ['gConfirmesTableContainer', 'gEnAttenteTableContainer', 'gListeAttenteTableContainer'].forEach(id => { const el = document.getElementById(id); if(el) el.innerHTML = `<tr><td colspan="5" class="text-center text-danger p-3"><i class="fas fa-exclamation-triangle me-2"></i>${err.message || 'Erreur.'}</td></tr>`; });
                } finally { if (spinner) spinner.style.display = 'none'; if (tabContent) tabContent.style.display = 'block'; }
            });
            const btnInscrireDepuisParticipants = participantsModalEl.querySelector('.btn-inscrire-depuis-participants');
            if (btnInscrireDepuisParticipants) {
                btnInscrireDepuisParticipants.addEventListener('click', function() {
                    const sessionId = this.dataset.sessionId; const inscriptionModalElToOpen = document.getElementById('genericInscriptionModal'); if (!inscriptionModalElToOpen) return;
                    const inscriptionModal = bootstrap.Modal.getOrCreateInstance(inscriptionModalElToOpen); prepareGenericInscriptionModal(sessionId);
                    const bsParticipantsModal = bootstrap.Modal.getInstance(participantsModalEl); if(bsParticipantsModal) bsParticipantsModal.hide(); inscriptionModal.show();
                });
            }
        }
        const inscriptionModalEl = document.getElementById('genericInscriptionModal');
        if (inscriptionModalEl) {
            inscriptionModalEl.addEventListener('show.bs.modal', function(event) {
                const button = event.relatedTarget; const sessionIdFromButton = button ? button.dataset.sessionId : null;
                const sessionId = sessionIdFromButton || inscriptionModalEl.dataset.currentSessionId;
                if (!sessionId) { console.warn("ID session manquant pour modale inscription."); return; }
                inscriptionModalEl.dataset.currentSessionId = sessionId; prepareGenericInscriptionModal(sessionId);
            });
            const existantForm = document.getElementById('genericInscriptionExistantForm'); if (existantForm) { existantForm.action = `${baseAppUrl}/inscription`; existantForm.addEventListener('submit', handleGenericFormSubmit); }
            const nouveauForm = document.getElementById('genericInscriptionNouveauForm'); if (nouveauForm) { nouveauForm.action = `${baseAppUrl}/participant/add`; nouveauForm.addEventListener('submit', handleGenericFormSubmit); }
        }
        const attribuerSalleModalEl = document.getElementById('genericAttribuerSalleModal');
        if (attribuerSalleModalEl && window.dashboardConfig && window.dashboardConfig.isAdmin) {
            attribuerSalleModalEl.addEventListener('show.bs.modal', function(event) {
                const button = event.relatedTarget; const sessionId = button.dataset.sessionId; if (!sessionId) return;
                const session = dashboardState.apiData?.sessions?.find(s => String(s.id) === String(sessionId)); if (!session) return;
                document.getElementById('genericAttribuerSalleModalSessionTheme').textContent = session.theme;
                document.getElementById('genericAttribuerSalleModalSessionDate').textContent = session.date;
                document.getElementById('genericAttribuerSalleModalSessionHoraire').textContent = session.horaire;
                document.getElementById('gAttribuerSalleSessionId').value = sessionId;
                const salleSelect = document.getElementById('gSalleIdSelect');
                populateSelectWithOptions(salleSelect, dashboardState.apiData?.salles || [], 'id', (salle) => `${salle.nom} (${salle.capacite} places)`, "-- Aucune salle --", session.salle_id);
                const currentInfo = document.getElementById('gAttribuerSalleCurrentInfo'); currentInfo.innerHTML = session.salle ? `<i class="fas fa-check-circle text-success me-1"></i>Salle actuelle: <strong>${session.salle}</strong>` : `<i class="fas fa-exclamation-triangle text-warning me-1"></i>Aucune salle attribuée.`;
                const form = document.getElementById('genericAttribuerSalleForm'); form.action = `${baseAppUrl}/attribuer_salle`;
            });
            const attribuerSalleForm = document.getElementById('genericAttribuerSalleForm'); if (attribuerSalleForm) { attribuerSalleForm.addEventListener('submit', handleGenericFormSubmit); }
        }
    }
    function prepareGenericInscriptionModal(sessionId) {
        const session = dashboardState.apiData?.sessions?.find(s => String(s.id) === String(sessionId));
        if (!session) { showToast("Données session introuvables pour inscription.", "danger"); return; }
        document.getElementById('genericInscriptionModalSessionTheme').textContent = session.theme;
        document.getElementById('genericInscriptionModalSessionDate').textContent = session.date;
        document.getElementById('genericInscriptionModalSessionHoraire').textContent = session.horaire;
        document.getElementById('genericInscriptionModalSessionSalle').textContent = session.salle || "Non définie";
        const placesBadge = document.getElementById('genericInscriptionModalPlacesBadge');
        if(placesBadge){ placesBadge.textContent = `${session.places_restantes} / ${session.max_participants}`; placesBadge.className = `badge ${session.places_restantes === 0 ? 'bg-danger' : (session.places_restantes <= 3 ? 'bg-warning text-dark' : 'bg-success')}`; }
        document.getElementById('gInscriptionSessionIdExistant').value = sessionId;
        document.getElementById('gInscriptionSessionIdNouveau').value = sessionId;
        const participantSelect = document.getElementById('gParticipantIdSelect'); populateSelectWithOptions(participantSelect, dashboardState.apiData?.participants || [], 'id', (p) => `${p.prenom} ${p.nom} (${p.service || 'N/A'})`);
        const serviceSelect = document.getElementById('gServiceIdNouveau'); populateSelectWithOptions(serviceSelect, dashboardState.apiData?.services || [], 'id', 'nom');
        const listeAttenteLink = document.getElementById('gListeAttenteLink');
        if(listeAttenteLink){ listeAttenteLink.href = `${baseAppUrl}/liste_attente?session_id=${sessionId}`; listeAttenteLink.style.display = session.places_restantes <= 0 ? 'inline-block' : 'none'; }
        document.getElementById('genericInscriptionExistantForm')?.classList.remove('was-validated'); document.getElementById('genericInscriptionExistantForm')?.reset();
        document.getElementById('genericInscriptionNouveauForm')?.classList.remove('was-validated'); document.getElementById('genericInscriptionNouveauForm')?.reset();
    }
    function populateGenericParticipantsTable(tableContainer, items, type, noDataElement) {
        if (!tableContainer || !noDataElement) return; tableContainer.innerHTML = ''; noDataElement.style.display = 'none';
        if (!items || items.length === 0) { noDataElement.style.display = 'block'; return; }
        const table = document.createElement('table'); table.className = 'table table-sm table-hover table-striped'; let headers = '';
        if (type === 'confirmes') headers = '<tr><th>Participant</th><th>Service</th><th>Inscrit le</th><th class="text-center">Actions</th></tr>';
        else if (type === 'en_attente_validation') headers = '<tr><th>Participant</th><th>Service</th><th>Demandé le</th><th class="text-center">Actions</th></tr>';
        else if (type === 'liste_attente') headers = '<tr><th class="text-center">Pos.</th><th>Participant</th><th>Service</th><th>Inscrit le</th></tr>';
        table.innerHTML = `<thead class="table-light small">${headers}</thead><tbody></tbody>`; const tbody = table.querySelector('tbody');
        items.forEach(item => {
            let rowHtml = '<tr>';
            if (type === 'confirmes') { rowHtml += `<td>${item.nom_complet}</td><td><span class="badge" style="background-color:${item.service_couleur || config.serviceColors.default}; color:white;">${item.service_nom}</span></td><td><small>${item.date_inscription}</small></td><td class="text-center"><a href="${baseAppUrl}/generer_invitation/${item.id}" class="btn btn-sm btn-outline-primary" title="Invitation .ics"><i class="far fa-calendar-plus"></i></a></td>`; }
            else if (type === 'en_attente_validation') { rowHtml += `<td>${item.nom_complet}</td><td><span class="badge" style="background-color:${item.service_couleur || config.serviceColors.default}; color:white;">${item.service_nom}</span></td><td><small>${item.date_demande}</small></td><td class="text-center">${ (window.dashboardConfig && (window.dashboardConfig.isAdmin || window.dashboardConfig.isResponsable)) ? `<div class="btn-group btn-group-sm"><form action="${baseAppUrl}/validation_inscription/${item.id}" method="post" class="d-inline"><input type="hidden" name="action" value="valider"><button type="submit" class="btn btn-outline-success btn-sm" title="Valider"><i class="fas fa-check"></i></button></form><form action="${baseAppUrl}/validation_inscription/${item.id}" method="post" class="d-inline ms-1"><input type="hidden" name="action" value="refuser"><button type="submit" class="btn btn-outline-danger btn-sm" title="Refuser"><i class="fas fa-times"></i></button></form></div>` : '<span class="badge bg-secondary">En attente</span>'}</td>`; }
            else if (type === 'liste_attente') { rowHtml += `<td class="text-center"><span class="badge bg-info">${item.position}</span></td><td>${item.nom_complet}</td><td><span class="badge" style="background-color:${item.service_couleur || config.serviceColors.default}; color:white;">${item.service_nom}</span></td><td><small>${item.date_inscription}</small></td>`; }
            rowHtml += '</tr>'; tbody.insertAdjacentHTML('beforeend', rowHtml);
        }); tableContainer.appendChild(table);
    }
    async function handleGenericFormSubmit(event) {
        event.preventDefault(); const form = event.target; if (!form.checkValidity()) { form.classList.add('was-validated'); return; }
        const formData = new FormData(form); const actionUrl = form.action;
        const modalEl = form.closest('.modal'); const modalInstance = modalEl ? bootstrap.Modal.getInstance(modalEl) : null;
        try {
            const response = await fetch(actionUrl, { method: 'POST', body: new URLSearchParams(formData) });
            if (response.ok || response.redirected) { showToast(form.id.includes('Nouveau') || form.id.includes('nouveau') ? 'Opération réussie! Le participant a été ajouté et la demande d\'inscription enregistrée.' : 'Action enregistrée avec succès!', 'success'); if(modalInstance) modalInstance.hide(); fetchAndProcessData(true); }
            else { const errorText = await response.text(); let errorData; try { errorData = JSON.parse(errorText); } catch (e) { errorData = { message: errorText.substring(0, 200) || `Erreur ${response.status}` }; } showToast(errorData.message || `Erreur lors de la soumission. Code: ${response.status}`, 'danger'); }
        } catch (error) { console.error("Erreur soumission formulaire modale:", error); showToast("Erreur réseau ou serveur lors de la soumission.", 'danger'); }
    }

    // --- Gestion des Données et Polling ---
    async function fetchAndProcessData(forceRefresh = false) {
        if (dashboardState.isUpdating && !forceRefresh) { if (config.debugMode) console.log('Dashboard Core: Fetch skipped (update in progress).'); return false; }
        if (dashboardState.isErrorThrottleActive && !forceRefresh) { if (config.debugMode) console.log('Dashboard Core: Fetch skipped (error throttle active).'); return false; }
        const now = Date.now();
        if (!forceRefresh && (now - dashboardState.lastSuccessfulRefresh < config.minRefreshDelay)) { if (config.debugMode) console.log(`Dashboard Core: Fetch skipped (too soon).`); return false; }

        dashboardState.isUpdating = true;
        if (forceRefresh && dashboardState.initialLoadComplete) showGlobalLoading(true);
        else if (!dashboardState.initialLoadComplete) showGlobalLoading(true);

        const apiUrl = `${config.baseApiUrl}/dashboard_essential?_=${Date.now()}`;
        if (config.debugMode) console.log(`Dashboard Core: Fetching from ${apiUrl}`);

        try {
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), config.fetchTimeoutDuration);
            const response = await fetch(apiUrl, { signal: controller.signal, cache: "no-store", headers: { 'Accept': 'application/json', 'X-Requested-With': 'XMLHttpRequest' }});
            clearTimeout(timeoutId);

            if (!response.ok) {
                let errorData = { message: `Erreur HTTP ${response.status}` };
                try { errorData = await response.json(); } catch (e) { /* ignore */ }
                throw { ...errorData, status: response.status, endpoint: apiUrl, isApiError: true };
            }
            const data = await response.json();
            if (!data || typeof data !== 'object' || !data.sessions || !data.participants || !data.activites || !data.services || !data.salles) {
                throw { message: "Format de données API invalide ou données essentielles manquantes.", dataReceived: data, endpoint: apiUrl, isApiError: true };
            }

            dashboardState.apiData = data;
            dashboardState.displayData = data;
            const hasChanged = processAndRenderData(dashboardState.displayData, forceRefresh);

            dashboardState.lastSuccessfulRefresh = now;
            dashboardState.errorCount = 0;
            if (dashboardState.isErrorThrottleActive) {
                dashboardState.isErrorThrottleActive = false;
                if (config.debugMode) console.log("Dashboard Core: Error throttle deactivated.");
            }
            if (hasChanged) document.dispatchEvent(new CustomEvent('dashboardDataRefreshed', { detail: { data: dashboardState.displayData } }));
            return true;
        } catch (error) {
            console.error(`Dashboard Core: Error during fetchAndProcessData from ${error.endpoint || apiUrl}:`, error);
            const recovered = errorHandler.handleApiError(error.endpoint || apiUrl, error, error.status || 0);

            if (!recovered && config.useSimulatedDataOnError) {
                if (config.debugMode) console.warn("Dashboard Core: API error, using simulated data as fallback.");
                dashboardState.displayData = getSimulatedData();
                processAndRenderData(dashboardState.displayData, true);
                if (typeof showToast === 'function') showToast("Affichage des données de démonstration suite à une erreur API.", "warning");
            } else if (!recovered) {
                processAndRenderData(getSimulatedData(), true); 
            }

            dashboardState.errorCount++;
            if (dashboardState.errorCount >= config.maxErrorsBeforeThrottle && !dashboardState.isErrorThrottleActive) {
                dashboardState.isErrorThrottleActive = true;
                console.warn(`Dashboard Core: Error throttle activated after ${dashboardState.errorCount} errors.`);
                setTimeout(() => { dashboardState.isErrorThrottleActive = false; if (config.debugMode) console.log("Dashboard Core: Error throttle period ended."); }, config.errorThrottleDelay);
            }
            return false;
        } finally {
            dashboardState.isUpdating = false;
            if (!dashboardState.initialLoadComplete) {
                dashboardState.initialLoadComplete = true;
                showGlobalLoading(false);
                document.dispatchEvent(new CustomEvent('dashboardCoreFullyReady', { detail: { success: dashboardState.errorCount === 0 && dashboardState.apiData !== null } }));
            } else if (forceRefresh) {
                 showGlobalLoading(false);
            }
        }
    }

    function processAndRenderData(dataToRender, forceRefresh) {
        if (!dataToRender) {
            if (config.debugMode) console.warn("processAndRenderData: dataToRender is null or undefined. Using empty fallbacks.");
            dataToRender = { sessions: [], participants: [], activites: [], services: [], salles: [] };
        }
        const sessions = dataToRender.sessions || [];
        const participants = dataToRender.participants || [];
        const activites = dataToRender.activites || [];

        let hasChangedOverall = forceRefresh;

        const sessionsHash = simpleHash(sessions);
        if (sessionsHash !== dashboardState.dataHashes.sessions || forceRefresh) {
            updateSessionTable(sessions);
            updateStatisticsCounters(sessions);
            dashboardState.dataHashes.sessions = sessionsHash;
            hasChangedOverall = true;
        }

        const participantsHash = simpleHash(participants);
        if (participantsHash !== dashboardState.dataHashes.participants || forceRefresh) {
            dashboardState.dataHashes.participants = participantsHash;
            hasChangedOverall = true;
        }
        const servicesHash = simpleHash(dataToRender.services);
        if (servicesHash !== dashboardState.dataHashes.services || forceRefresh) {
            dashboardState.dataHashes.services = servicesHash;
        }
        const sallesHash = simpleHash(dataToRender.salles);
        if (sallesHash !== dashboardState.dataHashes.salles || forceRefresh) {
            dashboardState.dataHashes.salles = sallesHash;
        }

        const activitiesHash = simpleHash(activites);
        if (activitiesHash !== dashboardState.dataHashes.activites || forceRefresh) {
            updateActivityFeed(activites);
            dashboardState.dataHashes.activites = activitiesHash;
            hasChangedOverall = true;
        }

        if (hasChangedOverall) {
            updateCharts(sessions, participants);
        }

        setTimeout(() => {
            errorHandler.checkAndFixBrokenElements?.();
            initTooltips();
            applyGlobalUiFixes();
        }, 250);
        return hasChangedOverall;
    }

    function startPolling() {
        if (!dashboardState.pollingActive) { if (config.debugMode) console.log("Dashboard Core: Polling is not active or disabled."); return; }
        clearTimeout(dashboardState.pollingTimeoutId);
        const poll = async () => {
            if (document.visibilityState === 'visible' && !dashboardState.isUpdating && !dashboardState.isErrorThrottleActive) {
                if (config.debugMode) console.log("Dashboard Core: Polling - fetching data.");
                await fetchAndProcessData(false);
            }
            if (dashboardState.pollingActive) { dashboardState.pollingTimeoutId = setTimeout(poll, config.autoRefreshInterval); }
        };
        dashboardState.pollingTimeoutId = setTimeout(poll, config.autoRefreshInterval);
        if (config.debugMode) console.log(`Dashboard Core: Polling started (interval: ${config.autoRefreshInterval}ms).`);
    }
    function stopPolling() { dashboardState.pollingActive = false; clearTimeout(dashboardState.pollingTimeoutId); dashboardState.pollingTimeoutId = null; if (config.debugMode) console.log("Dashboard Core: Polling stopped."); }

    // --- Logique d'Initialisation et Correctifs Globaux ---
    function applyGlobalUiFixes() {
        if (config.debugMode) console.log("Dashboard Core: Applying global UI fixes.");
        document.querySelectorAll('.theme-badge').forEach(badge => {
            const themeName = badge.dataset.theme || badge.textContent.trim();
            const color = config.themeColors[themeName] || config.themeColors.default;
            if (color) { badge.style.backgroundColor = color; badge.style.color = 'white'; }
        });
    }

    function setupEventListeners() {
        if (config.debugMode) console.log("Dashboard Core: Setting up event listeners.");
        const refreshButton = document.getElementById('refresh-dashboard-button');
        if (refreshButton) { refreshButton.addEventListener('click', () => { if (config.debugMode) console.log("Dashboard Core: Manual refresh triggered."); fetchAndProcessData(true); }); }
        
        document.addEventListener('visibilitychange', () => {
            if (document.visibilityState === 'visible' && dashboardState.pollingActive && !dashboardState.isUpdating) {
                if (config.debugMode) console.log("Dashboard Core: Page visible, attempting immediate refresh.");
                fetchAndProcessData(false);
            }
        });

        const sessionFilterInput = document.getElementById('session-filter');
        if (sessionFilterInput) {
            sessionFilterInput.addEventListener('input', debounce(function(e) {
                const searchTerm = e.target.value.toLowerCase().trim();
                document.querySelectorAll('#sessions-a-venir-table tbody tr.session-row').forEach(row => {
                    const dateText = row.cells[0]?.textContent.toLowerCase() || '';
                    const themeCell = row.querySelector('.theme-cell .theme-badge');
                    const themeText = themeCell ? (themeCell.dataset.theme || themeCell.textContent).toLowerCase() : '';
                    const salleText = row.querySelector('.js-salle-cell')?.textContent.toLowerCase() || '';
                    const isVisible = !searchTerm || dateText.includes(searchTerm) || themeText.includes(searchTerm) || salleText.includes(searchTerm);
                    row.style.display = isVisible ? '' : 'none';
                });
            }, 300));
        }
        setupGenericModals();
    }

    async function initializeDashboard() {
        if (config.debugMode) console.log('Dashboard Core: Starting main initialization sequence.');
        showGlobalLoading(true);
        setupEventListeners();
        applyGlobalUiFixes();
        await fetchAndProcessData(true);
        if (dashboardState.pollingActive && dashboardState.apiData !== null) {
            startPolling();
        } else if (dashboardState.apiData === null && config.debugMode) {
            console.warn("Dashboard Core: Initial data load failed, polling not started.");
        }
    }

    // --- Exposition Globale et Démarrage ---
    window.dashboardCore = {
        refreshData: (force = true) => fetchAndProcessData(force),
        startPolling: () => { dashboardState.pollingActive = true; startPolling(); },
        stopPolling: stopPolling,
        getState: () => ({ ...dashboardState }),
        getConfig: () => ({ ...config })
    };

    initializeDashboard();
});
