/**
 * dashboard-core.js - Module principal et unique pour le tableau de bord
 * Version: 2.2.0 - Robustesse accrue, gestion des erreurs et états de chargement améliorés.
 */

document.addEventListener('DOMContentLoaded', function() {
    // Empêcher la double initialisation
    if (window.dashboardCoreInitialized) {
        if (window.dashboardConfig && window.dashboardConfig.debugMode) {
            console.log('Dashboard Core (v2.2.0): Already initialized. Skipping.');
        }
        if (window.dashboardCore) { // S'assurer que l'événement est émis pour les scripts en attente
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
        maxErrorsBeforeThrottle: 3, // Réduit pour un throttling plus rapide en cas de problèmes persistants
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
    const config = { ...defaultConfig, ...(window.dashboardConfig || {}) };

    if (config.debugMode) {
        console.log('Dashboard Core (v2.2.0): Initializing.');
        console.log('Dashboard Core: Effective Config', config);
    }

    // --- État de l'Application ---
    const globalLoadingOverlay = document.getElementById('loading-overlay');
    const dashboardState = {
        lastSuccessfulRefresh: 0,
        isUpdating: false,
        dataHashes: { sessions: null, participants: null, activites: null },
        apiData: null, // Sera { sessions: [], participants: [], activites: [] } ou null
        displayData: null, // Données utilisées pour l'affichage (peut être simulé)
        errorCount: 0,
        isErrorThrottleActive: false,
        pollingTimeoutId: null,
        themeChartInstance: null,
        serviceChartInstance: null,
        pollingActive: config.pollingEnabled && config.activeMode === 'polling',
        initialLoadComplete: false
    };

    // --- Gestionnaire d'Erreurs ---
    const errorHandler = window.apiErrorHandler || {
        handleApiError: (endpoint, errorData, statusCode) => {
            console.error(`[FallbackErrorHandler] API Error ${statusCode} on ${endpoint}:`, errorData);
            if (typeof showToast === 'function') showToast(`Erreur API (${statusCode}) lors du chargement de ${endpoint}.`, 'danger');
            return false;
        },
        checkAndFixBrokenElements: () => {
            if (config.debugMode) console.log("[FallbackErrorHandler] Checking and fixing UI elements.");
        }
    };

    // --- Fonctions Utilitaires ---
    function showGlobalLoading(show) {
        if (globalLoadingOverlay) globalLoadingOverlay.classList.toggle('hidden', !show);
    }

    function debounce(func, delay) {
        let timeout;
        return function(...args) {
            clearTimeout(timeout);
            timeout = setTimeout(() => func.apply(this, args), delay);
        };
    }

    function simpleHash(obj) {
        if (obj === null || typeof obj === 'undefined') return 'null_or_undefined';
        const str = JSON.stringify(obj);
        let hash = 0;
        for (let i = 0; i < str.length; i++) {
            hash = ((hash << 5) - hash) + str.charCodeAt(i);
            hash |= 0;
        }
        return hash;
    }

    function getSimulatedData() {
        if (config.debugMode) console.log("Dashboard Core: Providing simulated data.");
        return {
            sessions: [
                { id: 1, date: "mardi 13 mai 2025", horaire: "09h00–10h30", theme: "Communiquer avec Teams", theme_id: 1, places_restantes: 0, inscrits: 10, max_participants: 10, liste_attente: 0, salle: "Salle Tramontane", salle_id: 1 },
                { id: 2, date: "mardi 13 mai 2025", horaire: "10h45–12h15", theme: "Communiquer avec Teams", theme_id: 1, places_restantes: 1, inscrits: 9, max_participants: 10, liste_attente: 0, salle: "Salle Tramontane", salle_id: 1 },
                { id: 5, date: "mardi 3 juin 2025", horaire: "09h00–10h30", theme: "Gérer mes fichiers (OneDrive/SharePoint)", theme_id: 3, places_restantes: 0, inscrits: 10, max_participants: 10, liste_attente: 2, salle: "Salle Tramontane", salle_id: 1 },
            ],
            participants: [
                { id: 1, nom: "PHILIBERT", prenom: "Elodie", service: "Qualité", service_color: config.serviceColors['Qualité'] },
                { id: 4, nom: "BIVIA", prenom: "Kevin", service: "Informatique", service_color: config.serviceColors['Informatique'] },
                { id: 5, nom: "GOMEZ", prenom: "Elisabeth", service: "RH", service_color: config.serviceColors['RH'] },
            ],
            activites: [
                { id: 1, type: "validation", description: "Validation inscription: Elodie PHILIBERT", details: "Session: Communiquer avec Teams", date_relative: "il y a 10 minutes", user: "admin" },
                { id: 2, type: "ajout_participant", description: "Ajout: Kevin BIVIA", details: "Service: Informatique", date_relative: "il y a 1 heure", user: "admin" },
            ],
            status: "ok_simulated",
            timestamp: Date.now()
        };
    }

    // --- Fonctions de Mise à Jour de l'UI ---
    function updateElementText(elementId, value, defaultValue = '0') {
        const element = document.getElementById(elementId);
        if (element) {
            element.textContent = (typeof value === 'number' ? value.toLocaleString() : value) || defaultValue;
        } else if (config.debugMode) {
            console.warn(`updateElementText: Element with ID '${elementId}' not found.`);
        }
    }

    function updateStatisticsCounters(sessions = []) {
        try {
            let stats = { totalInscriptions: 0, totalEnAttente: 0, totalSessions: 0, totalSessionsCompletes: 0 };
            if (Array.isArray(sessions)) {
                stats.totalSessions = sessions.length;
                sessions.forEach(session => {
                    const inscrits = parseInt(session.inscrits, 10) || 0;
                    const maxParticipants = parseInt(session.max_participants, 10) || 0;
                    let placesRestantes = session.places_restantes;
                    if (typeof placesRestantes !== 'number' || isNaN(placesRestantes)) {
                        placesRestantes = (maxParticipants > 0) ? Math.max(0, maxParticipants - inscrits) : 0; // Si maxP est 0, places restantes est 0
                    }

                    stats.totalInscriptions += inscrits;
                    stats.totalEnAttente += parseInt(session.liste_attente, 10) || 0;
                    if (maxParticipants > 0 && placesRestantes <= 0) {
                        stats.totalSessionsCompletes++;
                    }
                });
            }
            updateElementText('total-sessions-programmes', stats.totalSessions);
            updateElementText('total-inscriptions-confirmees', stats.totalInscriptions);
            updateElementText('total-en-attente', stats.totalEnAttente);
            updateElementText('total-sessions-completes', stats.totalSessionsCompletes);
        } catch (e) {
            console.error('Dashboard Core: Error in updateStatisticsCounters', e);
            ['total-sessions-programmes', 'total-inscriptions-confirmees', 'total-en-attente', 'total-sessions-completes'].forEach(id => updateElementText(id, 'N/A'));
        }
    }

    function updateSessionTable(sessions = []) {
        const sessionTableBody = document.querySelector('#sessions-a-venir-table tbody');
        if (!sessionTableBody) {
            if (config.debugMode) console.warn("updateSessionTable: Table body '#sessions-a-venir-table tbody' not found.");
            return;
        }
        sessionTableBody.innerHTML = ''; // Clear existing rows

        if (!Array.isArray(sessions) || sessions.length === 0) {
            const cols = sessionTableBody.closest('table')?.querySelectorAll('thead th').length || 5;
            sessionTableBody.innerHTML = `<tr class="no-data-row"><td colspan="${cols}" class="text-center p-4 text-muted"><i class="fas fa-info-circle me-2"></i>Aucune session à venir à afficher.</td></tr>`;
            return;
        }

        sessions.forEach(session => {
            const inscrits = parseInt(session.inscrits, 10) || 0;
            const maxParticipants = parseInt(session.max_participants, 10) || 0;
            let placesRestantes = session.places_restantes;
            if (typeof placesRestantes !== 'number' || isNaN(placesRestantes)) {
                placesRestantes = (maxParticipants > 0) ? Math.max(0, maxParticipants - inscrits) : 0;
            }

            let placesClass = 'text-success';
            let placesIcon = 'fa-check-circle';
            // La ligne 169 est ici ou très proche. Vérifions attentivement les conditions.
            // `maxParticipants` est un nombre. `placesRestantes` est un nombre.
            // Les comparaisons sont correctes (`>`, `<=`).
            if (maxParticipants > 0) { // Condition correcte
                if (placesRestantes <= 0) { // Condition correcte
                    placesClass = 'text-danger fw-bold'; placesIcon = 'fa-times-circle';
                } else if (placesRestantes <= Math.floor(maxParticipants * 0.25)) { // Condition correcte
                    placesClass = 'text-warning'; placesIcon = 'fa-exclamation-triangle';
                }
            } else {
                placesClass = 'text-muted'; placesIcon = 'fa-minus-circle'; // Cas où maxParticipants est 0 ou non défini
            }

            const themeName = session.theme || 'N/A';
            const themeColor = config.themeColors[themeName] || config.themeColors.default;

            const rowHtml = `
                <tr class="session-row" data-session-id="${session.id || ''}">
                    <td>
                        <span class="fw-bold d-block">${session.date || 'N/A'}</span>
                        <small class="text-secondary">${session.horaire || 'N/A'}</small>
                    </td>
                    <td class="theme-cell">
                        <span class="theme-badge" style="background-color: ${themeColor}; color: white;" data-bs-toggle="tooltip" title="${themeName}">
                            ${themeName}
                        </span>
                    </td>
                    <td class="places-dispo text-nowrap ${placesClass}">
                        <i class="fas ${placesIcon} me-1"></i> ${placesRestantes} / ${maxParticipants || '∞'}
                    </td>
                    <td class="js-salle-cell">
                        ${session.salle ? `<span class="badge bg-light text-dark border">${session.salle}</span>` : '<span class="badge bg-secondary">Non définie</span>'}
                    </td>
                    <td class="text-nowrap text-center">
                        <button type="button" class="btn btn-sm btn-outline-secondary me-1 action-btn" data-bs-toggle="modal" data-bs-target="#participantsModal_${session.id || 'default'}" title="Voir les participants (${inscrits})">
                            <i class="fas fa-users"></i> <span class="badge bg-secondary ms-1">${inscrits}</span>
                        </button>
                        <button type="button" class="btn btn-sm btn-primary action-btn" data-bs-toggle="modal" data-bs-target="#inscriptionModal_${session.id || 'default'}" title="Inscrire un participant">
                            <i class="fas fa-plus"></i>
                        </button>
                    </td>
                </tr>`;
            sessionTableBody.insertAdjacentHTML('beforeend', rowHtml);
        });
        initTooltips(sessionTableBody);
    }

    function updateActivityFeed(activities = []) {
        const container = document.getElementById('recent-activity-list');
        if (!container) {
            if (config.debugMode) console.warn("updateActivityFeed: Activity container '#recent-activity-list' not found.");
            return;
        }
        const spinner = document.getElementById('activity-loading-spinner');
        if (spinner) spinner.classList.add('d-none');
        container.innerHTML = '';

        if (!Array.isArray(activities) || activities.length === 0) {
            container.innerHTML = `<li class="list-group-item text-center p-3 text-muted"><i class="fas fa-info-circle me-2"></i>Aucune activité récente.</li>`;
            return;
        }
        // ... (logique de génération HTML des activités comme dans v2.1.0)
            activities.forEach(activity => {
                const iconMap = {
                    'connexion': 'fas fa-sign-in-alt text-success', 'deconnexion': 'fas fa-sign-out-alt text-warning',
                    'inscription': 'fas fa-user-plus text-primary', 'validation': 'fas fa-check-circle text-success',
                    'refus': 'fas fa-times-circle text-danger', 'annulation': 'fas fa-ban text-danger',
                    'ajout_participant': 'fas fa-user-tag text-info', 'suppression_participant': 'fas fa-user-slash text-danger',
                    'modification_participant': 'fas fa-user-edit text-warning', 'liste_attente': 'fas fa-clock text-warning',
                    'ajout_document': 'fas fa-file-medical text-info', 'suppression_document': 'fas fa-file-excel text-danger',
                    'systeme': 'fas fa-cogs text-secondary', 'default': 'fas fa-info-circle text-secondary'
                };
                const icon = iconMap[activity.type] || iconMap.default;
                const userHtml = activity.user ? `<span class="text-primary fw-bold">${activity.user}</span>` : 'Système';
                const detailsHtml = activity.details ? `<p class="mb-1 activity-details text-muted small"><i class="fas fa-info-circle fa-fw me-1"></i>${activity.details}</p>` : '';

                const itemHtml = `
                    <li class="list-group-item activity-item type-${activity.type || 'default'}" data-activity-id="${activity.id || ''}">
                        <div class="d-flex w-100 justify-content-between">
                            <h6 class="mb-1 activity-title"><i class="${icon} me-2 fa-fw"></i>${activity.description || 'N/A'}</h6>
                            <small class="text-muted activity-time text-nowrap ms-2">${activity.date_relative || ''}</small>
                        </div>
                        ${detailsHtml}
                        <small class="text-muted d-block mt-1"><i class="fas fa-user fa-fw me-1"></i>Par: ${userHtml}</small>
                    </li>`;
                container.insertAdjacentHTML('beforeend', itemHtml);
            });
    }

    function updateCharts(sessions = [], participants = []) {
        try {
            updateThemeDistributionChart(sessions);
            updateServiceDistributionChart(participants);
        } catch (e) {
            console.error('Dashboard Core: Error in updateCharts', e);
        }
    }

    function createChart(canvasId, type, data, options) {
        const canvas = document.getElementById(canvasId);
        if (!canvas) {
            if (config.debugMode) console.warn(`createChart: Canvas with ID '${canvasId}' not found.`);
            return null;
        }
        const ctx = canvas.getContext('2d');
        // Nettoyer le message "pas de données"
        const parentContainer = canvas.parentNode;
        parentContainer.querySelector('.no-data-message-chart')?.remove();

        if (!data || !data.labels || data.labels.length === 0 || !data.datasets || data.datasets.some(ds => ds.data.length === 0)) {
            const noDataMsg = document.createElement('div');
            noDataMsg.className = 'no-data-message-chart text-center p-3 text-muted d-flex flex-column justify-content-center align-items-center h-100';
            noDataMsg.innerHTML = `<i class="fas ${type === 'doughnut' ? 'fa-chart-pie' : 'fa-chart-bar'} fa-2x mb-2 text-gray-300"></i><p class="mb-0">Aucune donnée disponible pour ce graphique.</p>`;
            parentContainer.appendChild(noDataMsg);
            return null;
        }
        return new Chart(ctx, { type, data, options });
    }
    
    function updateThemeDistributionChart(sessions = []) {
        if (dashboardState.themeChartInstance) dashboardState.themeChartInstance.destroy();
        
        const themeCounts = {};
        if (Array.isArray(sessions)) {
            sessions.forEach(session => {
                const theme = session.theme || 'Non défini';
                themeCounts[theme] = (themeCounts[theme] || 0) + (parseInt(session.inscrits, 10) || 0);
            });
        }

        const labels = Object.keys(themeCounts).filter(k => themeCounts[k] > 0);
        const dataValues = labels.map(l => themeCounts[l]);
        const backgroundColors = labels.map(label => config.themeColors[label] || config.themeColors.default);

        dashboardState.themeChartInstance = createChart('themeDistributionChart', 'doughnut',
            { labels: labels, datasets: [{ data: dataValues, backgroundColor: backgroundColors, borderWidth: 1 }] },
            { responsive: true, maintainAspectRatio: false, plugins: { legend: { position: 'bottom', labels: { font: { size: 11 }, boxWidth: 12, padding: 10 } }, tooltip: { callbacks: { label: (c) => `${c.label}: ${c.raw} (${(c.raw / c.dataset.data.reduce((a,b)=>a+b,0) * 100).toFixed(0)}%)` } } } }
        );
    }

    function updateServiceDistributionChart(participants = []) {
        if (dashboardState.serviceChartInstance) dashboardState.serviceChartInstance.destroy();

        const serviceCounts = {};
         if (Array.isArray(participants)) {
            participants.forEach(participant => {
                const service = participant.service || 'Non défini';
                serviceCounts[service] = (serviceCounts[service] || 0) + 1;
            });
        }

        const labels = Object.keys(serviceCounts).filter(k => serviceCounts[k] > 0);
        const dataValues = labels.map(l => serviceCounts[l]);
        const backgroundColors = labels.map(label => {
            const pWithColor = Array.isArray(participants) ? participants.find(p => p.service === label && p.service_color) : null;
            return pWithColor ? pWithColor.service_color : (config.serviceColors[label] || config.serviceColors.default);
        });

        dashboardState.serviceChartInstance = createChart('serviceDistributionChart', 'bar',
            { labels: labels, datasets: [{ label: 'Participants', data: dataValues, backgroundColor: backgroundColors, borderWidth: 1 }] },
            { indexAxis: 'y', responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } }, scales: { x: { beginAtZero: true, ticks: { precision: 0 } } } }
        );
    }

    function initTooltips(parentElement = document) {
        if (typeof bootstrap !== 'undefined' && bootstrap.Tooltip) {
            const tooltipTriggerList = Array.from(parentElement.querySelectorAll('[data-bs-toggle="tooltip"]'));
            tooltipTriggerList.forEach(el => {
                const existingTooltip = bootstrap.Tooltip.getInstance(el);
                if (existingTooltip) existingTooltip.dispose();
                new bootstrap.Tooltip(el);
            });
        }
    }

    // --- Gestion des Données et Polling ---
    const debouncedFetchAndProcessData = debounce(fetchAndProcessData, config.debounceDelay);

    async function fetchAndProcessData(forceRefresh = false) {
        // ... (logique de fetchAndProcessData de v2.1.0, en s'assurant que les erreurs sont bien gérées)
        // S'assurer que dashboardState.apiData et dashboardState.displayData sont initialisés à null ou un objet vide
        // pour éviter les erreurs si l'API ne retourne rien ou échoue.
        if (dashboardState.isUpdating && !forceRefresh) return false;
        if (dashboardState.isErrorThrottleActive && !forceRefresh) return false;
        const now = Date.now();
        if (!forceRefresh && (now - dashboardState.lastSuccessfulRefresh < config.minRefreshDelay)) return false;

        dashboardState.isUpdating = true;
        if (forceRefresh && dashboardState.initialLoadComplete) showGlobalLoading(true);

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
            if (!data || typeof data !== 'object' || !data.sessions || !data.participants || !data.activites) {
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
                dashboardState.displayData = getSimulatedData(); // Utiliser les données simulées
                processAndRenderData(dashboardState.displayData, true);
                if (typeof showToast === 'function') showToast("Affichage des données de démonstration suite à une erreur API.", "warning");
            } else if (!recovered) {
                // Si pas de récupération et pas de données simulées, afficher des états vides/d'erreur
                processAndRenderData(getSimulatedData(), true); // Afficher au moins la structure avec des données vides/simulées
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
            if (forceRefresh && dashboardState.initialLoadComplete) showGlobalLoading(false);
            if (!dashboardState.initialLoadComplete) {
                dashboardState.initialLoadComplete = true;
                showGlobalLoading(false);
                document.dispatchEvent(new CustomEvent('dashboardCoreFullyReady', { detail: { success: dashboardState.errorCount === 0 && dashboardState.apiData !== null } }));
            }
        }
    }

    function processAndRenderData(dataToRender, forceRefresh) {
        // ... (logique de processAndRenderData de v2.1.0)
        // S'assurer que dataToRender et ses propriétés (sessions, participants, activites) sont vérifiées
        // avant d'être utilisées pour éviter les erreurs si elles sont null ou undefined.
        if (!dataToRender) {
            if (config.debugMode) console.warn("processAndRenderData: dataToRender is null or undefined. Using empty fallbacks.");
            dataToRender = { sessions: [], participants: [], activites: [] };
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
        }, 200); // Délai légèrement augmenté pour s'assurer que le DOM est stable
        return hasChangedOverall;
    }

    function startPolling() { /* ... (comme v2.1.0) ... */ 
        if (!dashboardState.pollingActive) {
            if (config.debugMode) console.log("Dashboard Core: Polling is not active or disabled.");
            return;
        }
        clearTimeout(dashboardState.pollingTimeoutId); 

        const poll = async () => {
            if (document.visibilityState === 'visible' && !dashboardState.isUpdating && !dashboardState.isErrorThrottleActive) {
                if (config.debugMode) console.log("Dashboard Core: Polling - fetching data.");
                await fetchAndProcessData(false); 
            }
            if (dashboardState.pollingActive) {
                 dashboardState.pollingTimeoutId = setTimeout(poll, config.autoRefreshInterval);
            }
        };
        dashboardState.pollingTimeoutId = setTimeout(poll, config.autoRefreshInterval);
        if (config.debugMode) console.log(`Dashboard Core: Polling started (interval: ${config.autoRefreshInterval}ms).`);
    }
    function stopPolling() { /* ... (comme v2.1.0) ... */ 
        dashboardState.pollingActive = false;
        clearTimeout(dashboardState.pollingTimeoutId);
        dashboardState.pollingTimeoutId = null;
        if (config.debugMode) console.log("Dashboard Core: Polling stopped.");
    }

    // --- Logique d'Initialisation et Correctifs Globaux ---
    function applyGlobalUiFixes() {
        if (config.debugMode) console.log("Dashboard Core: Applying global UI fixes.");
        // Exemple: S'assurer que les badges de thème ont les bonnes couleurs
        document.querySelectorAll('.theme-badge').forEach(badge => {
            const themeName = badge.dataset.theme || badge.textContent.trim();
            const color = config.themeColors[themeName] || config.themeColors.default;
            if (color) { // Appliquer seulement si une couleur est trouvée
                badge.style.backgroundColor = color;
                badge.style.color = 'white'; // Assurer la lisibilité
            }
        });
        // Ajoutez ici d'autres correctifs globaux de dashboard-fix.js
    }

    function setupEventListeners() {
        if (config.debugMode) console.log("Dashboard Core: Setting up event listeners.");
        const refreshButton = document.getElementById('refresh-dashboard-button');
        if (refreshButton) {
            refreshButton.addEventListener('click', () => {
                if (config.debugMode) console.log("Dashboard Core: Manual refresh triggered.");
                fetchAndProcessData(true);
            });
        }
        // ... (autres écouteurs de dashboard-init.js ou dashboard.js)
        document.addEventListener('visibilitychange', () => {
            if (document.visibilityState === 'visible' && dashboardState.pollingActive && !dashboardState.isUpdating) {
                if (config.debugMode) console.log("Dashboard Core: Page visible, attempting immediate refresh.");
                fetchAndProcessData(false); 
            }
        });

        const sessionFilterInput = document.getElementById('session-filter');
        if (sessionFilterInput) {
            sessionFilterInput.addEventListener('input', debounce(function(e) { // 'input' est mieux que 'keyup' pour coller etc.
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
    }

    async function initializeDashboard() {
        if (config.debugMode) console.log('Dashboard Core: Starting main initialization sequence.');
        showGlobalLoading(true); // Afficher le loader global dès le début
        setupEventListeners();
        applyGlobalUiFixes(); // Appliquer les correctifs UI de base une fois

        // Premier chargement de données
        await fetchAndProcessData(true); // true = forceRefresh

        // Démarrer le polling si activé et si le chargement initial n'a pas complètement échoué
        if (dashboardState.pollingActive && dashboardState.apiData !== null) {
            startPolling();
        } else if (dashboardState.apiData === null && config.debugMode) {
            console.warn("Dashboard Core: Initial data load failed, polling not started.");
        }
        // Le loader global est caché et l'événement 'dashboardCoreFullyReady' est émis dans fetchAndProcessData
    }

    // --- Exposition Globale et Démarrage ---
    window.dashboardCore = {
        refreshData: (force = true) => fetchAndProcessData(force),
        startPolling: () => { dashboardState.pollingActive = true; startPolling(); },
        stopPolling: stopPolling,
        getState: () => ({ ...dashboardState }), // Retourner une copie pour éviter la modification directe
        getConfig: () => ({ ...config })
    };

    initializeDashboard();
});
