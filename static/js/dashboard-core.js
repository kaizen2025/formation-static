/**
 * dashboard-core.js - Module principal et unique pour le tableau de bord
 * Version: 2.1.0 - Fusionné avec dashboard-init, dashboard-fix et dashboard.js
 */

document.addEventListener('DOMContentLoaded', function() {
    if (window.dashboardCoreInitialized) {
        if (window.dashboardConfig && window.dashboardConfig.debugMode) {
            console.log('Dashboard Core: Already initialized. Skipping.');
        }
        if (window.dashboardCore) {
            document.dispatchEvent(new CustomEvent('dashboardCoreFullyReady', { detail: { success: true, source: 'cached' } }));
        }
        return;
    }
    window.dashboardCoreInitialized = true;

    const defaultConfig = {
        debugMode: false,
        autoRefreshInterval: 60000,
        minRefreshDelay: 15000,
        debounceDelay: 500,
        baseApiUrl: '/api',
        fetchTimeoutDuration: 20000,
        maxErrorsBeforeThrottle: 5,
        errorThrottleDelay: 60000,
        useSimulatedDataOnError: true,
        pollingEnabled: true,
        activeMode: 'polling',
        themeColors: { /* ... (comme avant) ... */ },
        serviceColors: { /* ... (comme avant) ... */ }
    };
    // Remplir les couleurs par défaut si elles ne sont pas déjà là
    defaultConfig.themeColors = {
        'Communiquer avec Teams': '#464eb8',
        'Gérer les tâches (Planner)': '#038387',
        'Gérer mes fichiers (OneDrive/SharePoint)': '#0078d4',
        'Collaborer avec Teams': '#107c10',
        'default': '#6c757d',
        ...(defaultConfig.themeColors || {})
    };
    defaultConfig.serviceColors = {
        'Qualité': '#F44336',
        'Informatique': '#607D8B',
        'RH': '#FF9800',
        'Commerce Anecoop-Solagora': '#FFC107',
        'Marketing': '#9C27B0',
        'Florensud': '#4CAF50',
        'Comptabilité': '#2196F3',
        'default': '#7a7574',
        ...(defaultConfig.serviceColors || {})
    };


    const config = { ...defaultConfig, ...(window.dashboardConfig || {}) };

    if (config.debugMode) {
        console.log('Dashboard Core: Initializing (v2.1.0)');
        console.log('Dashboard Core: Effective Config', config);
    }

    const globalLoadingOverlay = document.getElementById('loading-overlay');
    const dashboardState = {
        lastSuccessfulRefresh: 0,
        isUpdating: false,
        dataHashes: { sessions: null, participants: null, activites: null },
        apiData: { sessions: [], participants: [], activites: [] },
        displayData: { sessions: [], participants: [], activites: [] },
        errorCount: 0,
        isErrorThrottleActive: false,
        pollingTimeoutId: null,
        themeChartInstance: null,
        serviceChartInstance: null,
        pollingActive: config.pollingEnabled && config.activeMode === 'polling',
        initialLoadComplete: false
    };

    const errorHandler = window.apiErrorHandler || { /* ... (comme avant) ... */ };
     // Fallback error handler si api-error-handler.js n'est pas chargé
    if (!window.apiErrorHandler) {
        errorHandler.handleApiError = (endpoint, errorData, statusCode) => {
            console.error(`[FallbackErrorHandler] API Error ${statusCode} on ${endpoint}:`, errorData);
            if (typeof showToast === 'function') showToast(`Erreur API (${statusCode}) lors du chargement de ${endpoint}.`, 'danger');
            return false;
        };
        errorHandler.checkAndFixBrokenElements = () => {
            if (config.debugMode) console.log("[FallbackErrorHandler] Checking and fixing UI elements.");
        };
    }


    // --- Fonctions Utilitaires ---
    // showGlobalLoading, debounce, simpleHash, getSimulatedData (comme avant)
    function showGlobalLoading(show) {
        if (globalLoadingOverlay) {
            globalLoadingOverlay.classList.toggle('hidden', !show);
        }
    }

    function debounce(func, delay) {
        let timeout;
        return function(...args) {
            const context = this;
            clearTimeout(timeout);
            timeout = setTimeout(() => func.apply(context, args), delay);
        };
    }

    function simpleHash(obj) {
        const str = JSON.stringify(obj);
        let hash = 0;
        for (let i = 0; i < str.length; i++) {
            const char = str.charCodeAt(i);
            hash = ((hash << 5) - hash) + char;
            hash |= 0; 
        }
        return hash;
    }

    function getSimulatedData() {
        // ... (contenu de getSimulatedData comme dans la v2.0.0)
        return {
            sessions: [
                { id: 1, date: "mardi 13 mai 2025", horaire: "09h00–10h30", theme: "Communiquer avec Teams", theme_id: 1, places_restantes: 0, inscrits: 10, max_participants: 10, liste_attente: 0, salle: "Salle Tramontane", salle_id: 1 },
                { id: 2, date: "mardi 13 mai 2025", horaire: "10h45–12h15", theme: "Communiquer avec Teams", theme_id: 1, places_restantes: 1, inscrits: 9, max_participants: 10, liste_attente: 0, salle: "Salle Tramontane", salle_id: 1 },
                { id: 3, date: "mardi 13 mai 2025", horaire: "14h00–15h30", theme: "Gérer les tâches (Planner)", theme_id: 2, places_restantes: 1, inscrits: 9, max_participants: 10, liste_attente: 0, salle: "Salle Tramontane", salle_id: 1 },
                { id: 4, date: "mardi 13 mai 2025", horaire: "15h45–17h15", theme: "Gérer les tâches (Planner)", theme_id: 2, places_restantes: 0, inscrits: 10, max_participants: 10, liste_attente: 0, salle: "Salle Tramontane", salle_id: 1 },
            ],
            participants: [
                { id: 1, nom: "PHILIBERT", prenom: "Elodie", email: "ephilibert@anecoop-france.com", service: "Qualité", service_id: "qualite", service_color: config.serviceColors['Qualité'] },
                { id: 2, nom: "SARRAZIN", prenom: "Enora", email: "esarrazin@anecoop-france.com", service: "Qualité", service_id: "qualite", service_color: config.serviceColors['Qualité'] },
                { id: 4, nom: "BIVIA", prenom: "Kevin", email: "kbivia@anecoop-france.com", service: "Informatique", service_id: "informatique", service_color: config.serviceColors['Informatique'] },
            ],
            activites: [
                { id: 1, type: "validation", description: "Validation inscription: Elodie PHILIBERT", details: "Session: Communiquer avec Teams (mardi 13 mai 2025)", date_relative: "il y a 32 minutes", user: "admin" },
                { id: 2, type: "ajout_participant", description: "Ajout: Kevin BIVIA", details: "Service: Informatique", date_relative: "il y a 2 heures", user: "admin" },
            ],
            status: "ok_simulated",
            timestamp: Date.now()
        };
    }

    // --- Fonctions de mise à jour de l'UI ---
    // updateStatisticsCounters, updateSessionTable, updateActivityFeed, updateCharts, updateThemeDistributionChart, updateServiceDistributionChart, initTooltips (comme avant)
    // ... (coller ici les fonctions UI de la v2.0.0)
    function updateStatisticsCounters(sessions) {
        try {
            let stats = { totalInscriptions: 0, totalEnAttente: 0, totalSessions: 0, totalSessionsCompletes: 0 };
            if (sessions && Array.isArray(sessions)) {
                stats.totalSessions = sessions.length;
                sessions.forEach(session => {
                    const inscrits = parseInt(session.inscrits, 10) || 0;
                    const maxParticipants = parseInt(session.max_participants, 10) || 0;
                    let placesRestantes = session.places_restantes;
                    if (typeof placesRestantes !== 'number' || isNaN(placesRestantes)) {
                        placesRestantes = Math.max(0, maxParticipants - inscrits);
                    }

                    stats.totalInscriptions += inscrits;
                    stats.totalEnAttente += parseInt(session.liste_attente, 10) || 0;
                    if (placesRestantes <= 0 && maxParticipants > 0) { 
                        stats.totalSessionsCompletes++;
                    }
                });
            } else {
                 if (config.debugMode) console.warn("updateStatisticsCounters: sessions data is invalid or empty. Using zeros.");
            }

            document.getElementById('total-inscriptions-confirmees')?.textContent = stats.totalInscriptions.toLocaleString() || '0';
            document.getElementById('total-en-attente')?.textContent = stats.totalEnAttente.toLocaleString() || '0';
            document.getElementById('total-sessions-programmes')?.textContent = stats.totalSessions.toLocaleString() || '0';
            document.getElementById('total-sessions-completes')?.textContent = stats.totalSessionsCompletes.toLocaleString() || '0';

        } catch (e) {
            console.error('Dashboard Core: Error in updateStatisticsCounters', e);
            document.getElementById('total-inscriptions-confirmees')?.textContent = 'N/A';
            document.getElementById('total-en-attente')?.textContent = 'N/A';
            document.getElementById('total-sessions-programmes')?.textContent = 'N/A';
            document.getElementById('total-sessions-completes')?.textContent = 'N/A';
        }
    }

    function updateSessionTable(sessions) {
        try {
            const sessionTableBody = document.querySelector('#sessions-a-venir-table tbody');
            if (!sessionTableBody) {
                if (config.debugMode) console.warn("updateSessionTable: Table body not found.");
                return;
            }
            sessionTableBody.innerHTML = ''; 

            if (!sessions || sessions.length === 0) {
                const cols = sessionTableBody.closest('table')?.querySelectorAll('thead th').length || 5;
                sessionTableBody.innerHTML = `<tr class="no-data-row"><td colspan="${cols}" class="text-center p-4 text-muted"><i class="fas fa-info-circle me-2"></i>Aucune session à venir à afficher.</td></tr>`;
                return;
            }

            sessions.forEach(session => {
                const inscrits = parseInt(session.inscrits, 10) || 0;
                const maxParticipants = parseInt(session.max_participants, 10) || 0;
                let placesRestantes = session.places_restantes;
                 if (typeof placesRestantes !== 'number' || isNaN(placesRestantes)) {
                    placesRestantes = Math.max(0, maxParticipants - inscrits);
                }

                let placesClass = 'text-success';
                let placesIcon = 'fa-check-circle';
                if (maxParticipants > 0) { 
                    if (placesRestantes <= 0) {
                        placesClass = 'text-danger fw-bold'; placesIcon = 'fa-times-circle';
                    } else if (placesRestantes <= Math.floor(maxParticipants * 0.25)) { 
                        placesClass = 'text-warning'; placesIcon = 'fa-exclamation-triangle';
                    }
                } else { 
                    placesClass = 'text-muted'; placesIcon = 'fa-minus-circle';
                }

                const themeName = session.theme || 'N/A';
                const themeColor = config.themeColors[themeName] || config.themeColors.default;

                const rowHtml = `
                    <tr class="session-row" data-session-id="${session.id}">
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
                            <button type="button" class="btn btn-sm btn-outline-secondary me-1 action-btn" data-bs-toggle="modal" data-bs-target="#participantsModal_${session.id}" title="Voir les participants (${inscrits})">
                                <i class="fas fa-users"></i> <span class="badge bg-secondary ms-1">${inscrits}</span>
                            </button>
                            <button type="button" class="btn btn-sm btn-primary action-btn" data-bs-toggle="modal" data-bs-target="#inscriptionModal_${session.id}" title="Inscrire un participant">
                                <i class="fas fa-plus"></i>
                            </button>
                        </td>
                    </tr>`;
                sessionTableBody.insertAdjacentHTML('beforeend', rowHtml);
            });
            initTooltips(sessionTableBody); 
        } catch (e) {
            console.error('Dashboard Core: Error in updateSessionTable', e);
            const sessionTableBody = document.querySelector('#sessions-a-venir-table tbody');
            if(sessionTableBody) {
                const cols = sessionTableBody.closest('table')?.querySelectorAll('thead th').length || 5;
                sessionTableBody.innerHTML = `<tr class="error-row"><td colspan="${cols}" class="text-center p-4 text-danger"><i class="fas fa-exclamation-triangle me-2"></i>Erreur lors du chargement des sessions.</td></tr>`;
            }
        }
    }

    function updateActivityFeed(activities) {
        try {
            const container = document.getElementById('recent-activity-list'); 
            if (!container) {
                if (config.debugMode) console.warn("updateActivityFeed: Activity container not found.");
                return;
            }
            const spinner = document.getElementById('activity-loading-spinner');
            if (spinner) spinner.classList.add('d-none');
            container.innerHTML = ''; 

            if (!activities || activities.length === 0) {
                container.innerHTML = `<li class="list-group-item text-center p-3 text-muted"><i class="fas fa-info-circle me-2"></i>Aucune activité récente à afficher.</li>`;
                return;
            }

            activities.forEach(activity => {
                const iconMap = { /* ... (comme avant) ... */ };
                 iconMap['connexion'] = 'fas fa-sign-in-alt text-success';
                 iconMap['deconnexion'] = 'fas fa-sign-out-alt text-warning';
                 iconMap['inscription'] = 'fas fa-user-plus text-primary';
                 iconMap['validation'] = 'fas fa-check-circle text-success';
                 iconMap['refus'] = 'fas fa-times-circle text-danger';
                 iconMap['annulation'] = 'fas fa-ban text-danger';
                 iconMap['ajout_participant'] = 'fas fa-user-tag text-info';
                 iconMap['suppression_participant'] = 'fas fa-user-slash text-danger';
                 iconMap['modification_participant'] = 'fas fa-user-edit text-warning';
                 iconMap['liste_attente'] = 'fas fa-clock text-warning';
                 iconMap['ajout_document'] = 'fas fa-file-medical text-info';
                 iconMap['suppression_document'] = 'fas fa-file-excel text-danger';
                 iconMap['systeme'] = 'fas fa-cogs text-secondary';
                 iconMap['default'] = 'fas fa-info-circle text-secondary';

                const icon = iconMap[activity.type] || iconMap.default;
                const userHtml = activity.user ? `<span class="text-primary fw-bold">${activity.user}</span>` : 'Système';
                const detailsHtml = activity.details ? `<p class="mb-1 activity-details text-muted small"><i class="fas fa-info-circle fa-fw me-1"></i>${activity.details}</p>` : '';

                const itemHtml = `
                    <li class="list-group-item activity-item type-${activity.type || 'default'}" data-activity-id="${activity.id}">
                        <div class="d-flex w-100 justify-content-between">
                            <h6 class="mb-1 activity-title"><i class="${icon} me-2 fa-fw"></i>${activity.description || 'Activité non spécifiée'}</h6>
                            <small class="text-muted activity-time text-nowrap ms-2">${activity.date_relative || ''}</small>
                        </div>
                        ${detailsHtml}
                        <small class="text-muted d-block mt-1"><i class="fas fa-user fa-fw me-1"></i>Par: ${userHtml}</small>
                    </li>`;
                container.insertAdjacentHTML('beforeend', itemHtml);
            });
        } catch (e) {
            console.error('Dashboard Core: Error in updateActivityFeed', e);
            const container = document.getElementById('recent-activity-list');
            if (container) {
                container.innerHTML = `<li class="list-group-item text-center p-3 text-danger"><i class="fas fa-exclamation-triangle me-2"></i>Erreur lors du chargement des activités.</li>`;
            }
        }
    }

    function updateCharts(sessions, participants) {
        try {
            updateThemeDistributionChart(sessions);
            updateServiceDistributionChart(participants);
        } catch (e) {
            console.error('Dashboard Core: Error in updateCharts', e);
        }
    }
    
    function updateThemeDistributionChart(sessions) {
        const canvas = document.getElementById('themeDistributionChart');
        if (!canvas) return;
        const ctx = canvas.getContext('2d');

        if (dashboardState.themeChartInstance) {
            dashboardState.themeChartInstance.destroy();
            dashboardState.themeChartInstance = null;
        }
        canvas.parentNode.querySelector('.no-data-message-chart')?.remove();

        if (!sessions || sessions.length === 0) {
            const noDataMsg = document.createElement('div');
            noDataMsg.className = 'no-data-message-chart text-center p-3 text-muted';
            noDataMsg.innerHTML = '<i class="fas fa-chart-pie fa-2x mb-2"></i><p>Aucune donnée d\'inscription par thème disponible.</p>';
            canvas.parentNode.appendChild(noDataMsg);
            return;
        }

        const themeCounts = {};
        sessions.forEach(session => {
            const theme = session.theme || 'Non défini';
            themeCounts[theme] = (themeCounts[theme] || 0) + (parseInt(session.inscrits, 10) || 0);
        });

        const labels = Object.keys(themeCounts).filter(k => themeCounts[k] > 0);
        const data = labels.map(l => themeCounts[l]);

        if (labels.length === 0) { 
            const noDataMsg = document.createElement('div');
            noDataMsg.className = 'no-data-message-chart text-center p-3 text-muted';
            noDataMsg.innerHTML = '<i class="fas fa-chart-pie fa-2x mb-2"></i><p>Aucune inscription enregistrée pour les thèmes.</p>';
            canvas.parentNode.appendChild(noDataMsg);
            return;
        }

        const backgroundColors = labels.map(label => config.themeColors[label] || config.themeColors.default);

        dashboardState.themeChartInstance = new Chart(ctx, {
            type: 'doughnut',
            data: { labels: labels, datasets: [{ data: data, backgroundColor: backgroundColors, borderWidth: 1 }] },
            options: { /* ... (options comme avant) ... */ }
        });
         dashboardState.themeChartInstance.options = {
            responsive: true, maintainAspectRatio: false,
            plugins: {
                legend: { position: 'bottom', labels: { font: { size: 11 }, boxWidth: 15, padding: 15 } },
                tooltip: {
                    callbacks: {
                        label: function(context) {
                            const total = context.dataset.data.reduce((a, b) => a + b, 0);
                            const value = context.raw;
                            const percentage = total > 0 ? Math.round((value / total) * 100) : 0;
                            return `${context.label}: ${value} (${percentage}%)`;
                        }
                    }
                }
            }
        };
        dashboardState.themeChartInstance.update();
    }

    function updateServiceDistributionChart(participants) {
        const canvas = document.getElementById('serviceDistributionChart');
        if (!canvas) return;
        const ctx = canvas.getContext('2d');

        if (dashboardState.serviceChartInstance) {
            dashboardState.serviceChartInstance.destroy();
            dashboardState.serviceChartInstance = null;
        }
        canvas.parentNode.querySelector('.no-data-message-chart')?.remove();

        if (!participants || participants.length === 0) {
            const noDataMsg = document.createElement('div');
            noDataMsg.className = 'no-data-message-chart text-center p-3 text-muted';
            noDataMsg.innerHTML = '<i class="fas fa-chart-bar fa-2x mb-2"></i><p>Aucune donnée de participant par service.</p>';
            canvas.parentNode.appendChild(noDataMsg);
            return;
        }

        const serviceCounts = {};
        participants.forEach(participant => {
            const service = participant.service || 'Non défini';
            serviceCounts[service] = (serviceCounts[service] || 0) + 1;
        });

        const labels = Object.keys(serviceCounts).filter(k => serviceCounts[k] > 0);
        const data = labels.map(l => serviceCounts[l]);

        if (labels.length === 0) {
             const noDataMsg = document.createElement('div');
            noDataMsg.className = 'no-data-message-chart text-center p-3 text-muted';
            noDataMsg.innerHTML = '<i class="fas fa-chart-bar fa-2x mb-2"></i><p>Aucun participant enregistré pour les services.</p>';
            canvas.parentNode.appendChild(noDataMsg);
            return;
        }

        const backgroundColors = labels.map(label => {
            const participantWithColor = participants.find(p => p.service === label && p.service_color);
            return participantWithColor ? participantWithColor.service_color : (config.serviceColors[label] || config.serviceColors.default);
        });

        dashboardState.serviceChartInstance = new Chart(ctx, {
            type: 'bar',
            data: { labels: labels, datasets: [{ label: 'Participants', data: data, backgroundColor: backgroundColors, borderWidth: 1 }] },
            options: { /* ... (options comme avant) ... */ }
        });
        dashboardState.serviceChartInstance.options = {
            indexAxis: 'y', responsive: true, maintainAspectRatio: false,
            plugins: { legend: { display: false } },
            scales: { x: { beginAtZero: true, ticks: { precision: 0 } } }
        };
        dashboardState.serviceChartInstance.update();
    }

    function initTooltips(parentElement = document) {
        if (typeof bootstrap !== 'undefined' && bootstrap.Tooltip) {
            const tooltipTriggerList = [].slice.call(parentElement.querySelectorAll('[data-bs-toggle="tooltip"]'));
            tooltipTriggerList.forEach(function(tooltipTriggerEl) {
                // Détruire l'ancien tooltip s'il existe pour éviter les doublons
                const existingTooltip = bootstrap.Tooltip.getInstance(tooltipTriggerEl);
                if (existingTooltip) {
                    existingTooltip.dispose();
                }
                new bootstrap.Tooltip(tooltipTriggerEl);
            });
        }
    }


    // --- Gestion des données et Polling ---
    // fetchAndProcessData, processAndRenderData, startPolling, stopPolling (comme avant)
    // ... (coller ici les fonctions de gestion des données de la v2.0.0)
    const debouncedFetchAndProcessData = debounce(fetchAndProcessData, config.debounceDelay);

    async function fetchAndProcessData(forceRefresh = false, isLightPoll = false) {
        if (dashboardState.isUpdating && !forceRefresh) {
            if (config.debugMode) console.log('Dashboard Core: Fetch skipped (update in progress).');
            return false; 
        }
        if (dashboardState.isErrorThrottleActive && !forceRefresh) {
            if (config.debugMode) console.log('Dashboard Core: Fetch skipped (error throttle active).');
            return false;
        }
        const now = Date.now();
        if (!forceRefresh && (now - dashboardState.lastSuccessfulRefresh < config.minRefreshDelay)) {
            if (config.debugMode) console.log(`Dashboard Core: Fetch skipped (too soon).`);
            return false;
        }

        dashboardState.isUpdating = true;
        if (forceRefresh && !isLightPoll && dashboardState.initialLoadComplete) showGlobalLoading(true);

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
            if (!data || typeof data !== 'object') {
                throw { message: "Format de données API invalide.", endpoint: apiUrl, isApiError: true };
            }

            if (config.debugMode) console.log('Dashboard Core: API Data received:', data);
            dashboardState.apiData = data; 
            dashboardState.displayData = data; 

            const hasChanged = processAndRenderData(dashboardState.displayData, forceRefresh);

            dashboardState.lastSuccessfulRefresh = Date.now();
            dashboardState.errorCount = 0;
            if (dashboardState.isErrorThrottleActive) {
                dashboardState.isErrorThrottleActive = false;
                if (config.debugMode) console.log("Dashboard Core: Error throttle deactivated.");
            }
            if (hasChanged && config.debugMode) {
                document.dispatchEvent(new CustomEvent('dashboardDataRefreshed', { detail: { data: dashboardState.displayData } }));
            }
            return true; 
        } catch (error) {
            console.error(`Dashboard Core: Error during fetchAndProcessData from ${error.endpoint || apiUrl}:`, error);
            const recovered = errorHandler.handleApiError(error.endpoint || apiUrl, error, error.status || 0);

            if (!recovered && config.useSimulatedDataOnError) {
                if (config.debugMode) console.warn("Dashboard Core: API error, attempting to use simulated data as fallback.");
                dashboardState.displayData = getSimulatedData();
                processAndRenderData(dashboardState.displayData, true); 
                if (typeof showToast === 'function') showToast("Affichage des données de démonstration suite à une erreur API.", "warning");
            }

            dashboardState.errorCount++;
            if (dashboardState.errorCount >= config.maxErrorsBeforeThrottle && !dashboardState.isErrorThrottleActive) {
                dashboardState.isErrorThrottleActive = true;
                console.warn(`Dashboard Core: Error throttle activated after ${dashboardState.errorCount} errors.`);
                setTimeout(() => {
                    dashboardState.isErrorThrottleActive = false;
                    if (config.debugMode) console.log("Dashboard Core: Error throttle period ended.");
                }, config.errorThrottleDelay);
            }
            return false; 
        } finally {
            dashboardState.isUpdating = false;
            if (forceRefresh && !isLightPoll && dashboardState.initialLoadComplete) showGlobalLoading(false);
            if (!dashboardState.initialLoadComplete) {
                dashboardState.initialLoadComplete = true;
                showGlobalLoading(false); 
                document.dispatchEvent(new CustomEvent('dashboardCoreFullyReady', { detail: { success: dashboardState.errorCount === 0 } }));
            }
            if (config.debugMode) console.log('Dashboard Core: Fetch cycle finished.');
        }
    }

    function processAndRenderData(dataToRender, forceRefresh) {
        if (config.debugMode) console.log('Dashboard Core: Starting processAndRenderData. Force refresh:', forceRefresh);
        let hasChangedOverall = forceRefresh;

        try {
            const sessionsHash = simpleHash(dataToRender.sessions);
            if (sessionsHash !== dashboardState.dataHashes.sessions || forceRefresh) {
                updateSessionTable(dataToRender.sessions || []);
                updateStatisticsCounters(dataToRender.sessions || []);
                dashboardState.dataHashes.sessions = sessionsHash;
                hasChangedOverall = true;
            }

            const participantsHash = simpleHash(dataToRender.participants);
            if (participantsHash !== dashboardState.dataHashes.participants || forceRefresh) {
                dashboardState.dataHashes.participants = participantsHash;
                hasChangedOverall = true; 
            }

            const activitiesHash = simpleHash(dataToRender.activites);
            if (activitiesHash !== dashboardState.dataHashes.activites || forceRefresh) {
                updateActivityFeed(dataToRender.activites || []);
                dashboardState.dataHashes.activites = activitiesHash;
                hasChangedOverall = true;
            }

            if (hasChangedOverall) {
                updateCharts(dataToRender.sessions || [], dataToRender.participants || []);
            }

        } catch (e) {
            console.error("Dashboard Core: Error in processAndRenderData:", e);
            if(typeof showToast === 'function') showToast("Erreur lors de la mise à jour de l'affichage.", "danger");
        }

        setTimeout(() => {
            errorHandler.checkAndFixBrokenElements?.();
            initTooltips();
            applyGlobalUiFixes(); // Appeler les correctifs globaux
        }, 150);

        if (config.debugMode) console.log('Dashboard Core: Finished processAndRenderData. Overall changes:', hasChangedOverall);
        return hasChangedOverall;
    }

    function startPolling() {
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

    function stopPolling() {
        dashboardState.pollingActive = false;
        clearTimeout(dashboardState.pollingTimeoutId);
        dashboardState.pollingTimeoutId = null;
        if (config.debugMode) console.log("Dashboard Core: Polling stopped.");
    }

    // --- Logique potentiellement issue de dashboard-fix.js ou dashboard.js ---
    function applyGlobalUiFixes() {
        if (config.debugMode) console.log("Dashboard Core: Applying global UI fixes.");
        // Exemple : S'assurer que les modales sont correctement configurées
        // Si vous aviez des correctifs spécifiques dans dashboard-fix.js, mettez-les ici.
        // Par exemple, forcer le recalcul de la hauteur de certains éléments, etc.

        // Exemple de correctif pour les badges de thème (si ce n'est pas déjà géré ailleurs)
        document.querySelectorAll('.theme-badge').forEach(badge => {
            const themeName = badge.dataset.theme || badge.textContent.trim();
            if (themeName && config.themeColors[themeName]) {
                badge.style.backgroundColor = config.themeColors[themeName];
                badge.style.color = 'white'; // Assurer la lisibilité
            } else if (themeName) {
                badge.style.backgroundColor = config.themeColors.default;
                badge.style.color = 'white';
            }
        });
    }

    // --- Event Listeners & Initialisation (potentiellement de dashboard-init.js) ---
    function setupEventListeners() {
        if (config.debugMode) console.log("Dashboard Core: Setting up event listeners.");

        const refreshButton = document.getElementById('refresh-dashboard-button');
        if (refreshButton) {
            refreshButton.addEventListener('click', () => {
                if (config.debugMode) console.log("Dashboard Core: Manual refresh triggered.");
                fetchAndProcessData(true);
            });
        }

        document.addEventListener('visibilitychange', () => {
            if (document.visibilityState === 'visible' && dashboardState.pollingActive) {
                if (config.debugMode) console.log("Dashboard Core: Page visible, immediate refresh and restarting poll.");
                fetchAndProcessData(false);
                // startPolling(); // Le poll se relance déjà lui-même s'il est actif
            }
        });

        // --- Logique potentiellement issue de dashboard.js ou dashboard-init.js ---
        // Exemple : Gestion des filtres de tableau
        const sessionFilterInput = document.getElementById('session-filter');
        if (sessionFilterInput) {
            sessionFilterInput.addEventListener('keyup', debounce(function(e) {
                const searchTerm = e.target.value.toLowerCase();
                document.querySelectorAll('#sessions-a-venir-table tbody tr.session-row').forEach(row => {
                    const themeCell = row.querySelector('.theme-cell .theme-badge');
                    const dateText = row.cells[0].textContent.toLowerCase();
                    const themeText = themeCell ? (themeCell.dataset.theme || themeCell.textContent).toLowerCase() : '';
                    row.style.display = (dateText.includes(searchTerm) || themeText.includes(searchTerm)) ? '' : 'none';
                });
            }, 300));
        }

        // Initialisation de composants UI spécifiques (ex: date pickers, select2, etc.)
        // if (typeof $ !== 'undefined' && $.fn.select2) {
        //     $('.select2-component').select2();
        // }
    }

    async function initializeDashboard() {
        if (config.debugMode) console.log('Dashboard Core: Starting main initialization sequence.');
        showGlobalLoading(true);
        setupEventListeners(); // Intègre la logique de dashboard-init.js
        applyGlobalUiFixes(); // Intègre la logique de dashboard-fix.js

        await fetchAndProcessData(true);

        if (dashboardState.pollingActive) {
            startPolling();
        }
    }

    // Exposer des fonctions pour un contrôle externe si nécessaire
    window.dashboardCore = {
        refreshData: (force = true) => fetchAndProcessData(force),
        startPolling: () => { dashboardState.pollingActive = true; startPolling(); },
        stopPolling: stopPolling,
        getState: () => dashboardState,
        getConfig: () => config,
        applyUiFixes: applyGlobalUiFixes // Exposer pour appel manuel si besoin
    };

    // Démarrer l'initialisation
    initializeDashboard();
});
