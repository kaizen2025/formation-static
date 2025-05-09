/**
 * dashboard-core.js - Module principal et unique pour le tableau de bord
 * Version: 1.8.2 - Correction de l'erreur 'config is not defined'
 */

document.addEventListener('DOMContentLoaded', function() {
    // Empêcher la double initialisation
    if (window.dashboardCoreInitialized) {
        // Utiliser window.dashboardConfig ici car 'config' n'est pas encore défini dans ce scope
        if (window.dashboardConfig && window.dashboardConfig.debugMode) {
            console.log('Dashboard Core: Already initialized. Skipping.');
        }
        // S'assurer que l'événement est quand même émis si un autre script l'attend
        if (window.dashboardCore) {
             document.dispatchEvent(new CustomEvent('dashboardCoreFullyReady', { detail: { success: true, source: 'cached' } }));
        }
        return;
    }
    window.dashboardCoreInitialized = true;

    const dashConfigGlobal = window.dashboardConfig || {}; // Utiliser la config globale si elle existe
    // Configuration par défaut et fusion avec la config globale
    const config = { // Déclaration de config AVANT son utilisation
        debugMode: dashConfigGlobal.debugMode || false,
        refreshInterval: dashConfigGlobal.autoRefreshInterval || 60000,
        minRefreshDelay: dashConfigGlobal.minRefreshDelay || 15000,
        debounceDelay: dashConfigGlobal.debounceDelay || 500,
        baseApiUrl: dashConfigGlobal.baseApiUrl || '/api',
        fetchTimeoutDuration: dashConfigGlobal.fetchTimeoutDuration || 20000,
        maxErrors: dashConfigGlobal.maxErrors || 5,
        errorThrottleDelay: dashConfigGlobal.errorThrottleDelay || 60000,
        chartRendering: dashConfigGlobal.chartRendering || 'auto',
        ...dashConfigGlobal // Surcharger avec les valeurs de window.dashboardConfig
    };

    // Maintenant, on peut utiliser config.debugMode
    if (config.debugMode) {
        console.log('Dashboard Core: Initializing (v1.8.2)');
        console.log('Dashboard Core: Effective Config', config);
    }

    const globalLoadingOverlay = document.getElementById('loading-overlay');
    let dashboardState = {
        lastRefresh: 0,
        isUpdating: false,
        dataHashes: { sessions: null, participants: null, activites: null },
        rawData: { sessions: [], participants: [], activites: [] },
        errorCount: 0,
        isErrorThrottleActive: false,
        pollingTimeoutId: null,
        themeChartInstance: null,
        serviceChartInstance: null,
    };

    const errorHandler = window.apiErrorHandler || {
        handleApiError: (endpoint, errorData, statusCode) => {
            console.error(`[FallbackErrorHandler] API Error ${statusCode} on ${endpoint}:`, errorData);
            if (typeof showToast === 'function') showToast(`Erreur API (${statusCode}) lors du chargement de ${endpoint}.`, 'danger');
        },
        checkAndFixBrokenElements: () => {
            if (config.debugMode) console.log("[FallbackErrorHandler] Checking and fixing UI elements.");
            fixDataIssues();
            enhanceBadgesAndLabels();
        }
    };

    // --- Fonctions principales ---
    async function initializeDashboard() {
        if (config.debugMode) console.log('Dashboard Core: Starting main initialization sequence.');
        showGlobalLoading(true);

        setupStaticEventListeners();
        setupMutationObserver();
        initializeCharts();

        try {
            if (config.debugMode) console.log('Dashboard Core: Attempting initial data fetch.');
            const initialDataLoaded = await fetchAndProcessData(true);
            if (initialDataLoaded !== undefined) {
                 if (config.debugMode) console.log('Dashboard Core: Initial data fetch processed. Starting polling if enabled.');
                 startPolling();
            } else {
                if(config.debugMode) console.error("Dashboard Core: Initial data load failed, polling will not start automatically.");
                const dashboardContent = document.getElementById('main-content');
                if (dashboardContent && !dashboardContent.querySelector('.initial-load-error')) {
                    const errorMsgDiv = document.createElement('div');
                    errorMsgDiv.className = 'alert alert-danger initial-load-error';
                    errorMsgDiv.innerHTML = '<i class="fas fa-exclamation-triangle me-2"></i>Impossible de charger les données initiales du tableau de bord. Certaines sections peuvent être vides. Veuillez vérifier votre connexion ou réessayer plus tard.';
                    const firstChild = dashboardContent.firstChild;
                    dashboardContent.insertBefore(errorMsgDiv, firstChild);
                }
            }
        } catch (error) {
            console.error('Dashboard Core: Critical error during initial data load sequence.', error);
            if (typeof showToast === 'function') showToast("Erreur critique au chargement du tableau de bord.", "danger");
        } finally {
            showGlobalLoading(false);
            document.dispatchEvent(new CustomEvent('dashboardCoreFullyReady', { detail: { success: dashboardState.errorCount === 0 } }));
            if (config.debugMode) console.log('Dashboard Core: Dispatched dashboardCoreFullyReady event.');
        }
    }

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
        if (!forceRefresh && (now - dashboardState.lastRefresh < config.minRefreshDelay)) {
            if (config.debugMode) console.log(`Dashboard Core: Fetch skipped (too soon, ${config.minRefreshDelay - (now - dashboardState.lastRefresh)}ms left).`);
            return false;
        }

        dashboardState.isUpdating = true;
        dashboardState.lastRefresh = now;
        if (forceRefresh && !isLightPoll) showGlobalLoading(true);

        const apiUrl = `${config.baseApiUrl}/dashboard_essential?_=${Date.now()}${isLightPoll ? '&light=1' : ''}`;
        if (config.debugMode) console.log(`Dashboard Core: Fetching from ${apiUrl} (force: ${forceRefresh}, lightPoll: ${isLightPoll})`);

        try {
            const controller = new AbortController();
            const timeoutId = setTimeout(() => {
                controller.abort();
                if (config.debugMode) console.warn(`Dashboard Core: Fetch to ${apiUrl} timed out after ${config.fetchTimeoutDuration}ms.`);
            }, config.fetchTimeoutDuration);

            const response = await fetch(apiUrl, { signal: controller.signal, cache: "no-store", headers: { 'Accept': 'application/json', 'X-Requested-With': 'XMLHttpRequest' }});
            clearTimeout(timeoutId);

            if (!response.ok) {
                const errorText = await response.text();
                let errorData;
                try { errorData = JSON.parse(errorText); }
                catch (e) { errorData = { message: errorText.substring(0, 200) || `HTTP error ${response.status}` }; }
                console.error(`Dashboard Core: API Error ${response.status} for ${apiUrl}. Response:`, errorText.substring(0, 500));
                throw { ...errorData, status: response.status, endpoint: apiUrl };
            }

            const data = await response.json();
            if (!data || typeof data !== 'object') {
                console.error('Dashboard Core: Invalid data format received from API.', data);
                throw { message: "Format de données invalide de l'API.", endpoint: apiUrl };
            }

            if (config.debugMode) console.log('Dashboard Core: Data received:', data);
            dashboardState.rawData = data;
            const hasChanged = processData(data, forceRefresh);

            dashboardState.errorCount = 0;
            if (dashboardState.isErrorThrottleActive) {
                dashboardState.isErrorThrottleActive = false;
                if (config.debugMode) console.log("Dashboard Core: Error throttle deactivated.");
            }
            if (hasChanged && config.debugMode) {
                console.log('Dashboard Core: Data processed, changes detected.');
                document.dispatchEvent(new CustomEvent('dashboardDataRefreshed', { detail: { data } }));
            } else if (config.debugMode) {
                console.log('Dashboard Core: Data processed, no significant changes detected.');
            }
            return hasChanged;
        } catch (error) {
            console.error(`Dashboard Core: Error during fetchAndProcessData from ${error.endpoint || apiUrl}:`, error);
            errorHandler.handleApiError?.(error.endpoint || apiUrl, error, error.status || 0);
            dashboardState.errorCount++;
            if (dashboardState.errorCount >= config.maxErrors && !dashboardState.isErrorThrottleActive) {
                dashboardState.isErrorThrottleActive = true;
                console.warn(`Dashboard Core: Error throttle activated after ${dashboardState.errorCount} errors.`);
                setTimeout(() => {
                    dashboardState.isErrorThrottleActive = false;
                    if (config.debugMode) console.log("Dashboard Core: Error throttle period ended.");
                }, config.errorThrottleDelay);
            }
            return undefined;
        } finally {
            dashboardState.isUpdating = false;
            if (forceRefresh && !isLightPoll) showGlobalLoading(false);
            if (config.debugMode) console.log('Dashboard Core: Fetch cycle finished.');
        }
    }

    function processData(data, forceRefresh) {
        if (config.debugMode) console.log('Dashboard Core: Starting processData. Force refresh:', forceRefresh);
        let hasChangedOverall = forceRefresh;

        try {
            if (data.sessions) {
                const sessionsHash = simpleHash(data.sessions);
                if (sessionsHash !== dashboardState.dataHashes.sessions || forceRefresh) {
                    if (config.debugMode) console.log('Dashboard Core: Updating session table and stats.');
                    updateSessionTable(data.sessions);
                    updateStatisticsCounters(data.sessions);
                    dashboardState.dataHashes.sessions = sessionsHash;
                    hasChangedOverall = true;
                }
            } else if (config.debugMode) console.warn("Dashboard Core: 'sessions' key missing in data for processData.");

            if (data.participants) {
                const participantsHash = simpleHash(data.participants);
                if (participantsHash !== dashboardState.dataHashes.participants || forceRefresh) {
                    if (config.debugMode) console.log('Dashboard Core: Updating participants hash.');
                    dashboardState.dataHashes.participants = participantsHash;
                    hasChangedOverall = true;
                }
            } else if (config.debugMode) console.warn("Dashboard Core: 'participants' key missing in data for processData.");

            if (data.activites) {
                const activitiesHash = simpleHash(data.activites);
                if (activitiesHash !== dashboardState.dataHashes.activites || forceRefresh) {
                    if (config.debugMode) console.log('Dashboard Core: Updating activity feed.');
                    updateActivityFeed(data.activites);
                    dashboardState.dataHashes.activites = activitiesHash;
                    hasChangedOverall = true;
                }
            } else if (config.debugMode) console.warn("Dashboard Core: 'activites' key missing in data for processData.");

            if (hasChangedOverall) {
                if (config.debugMode) console.log('Dashboard Core: Data changed, calling updateCharts.');
                updateCharts(data.sessions || [], data.participants || []);
            }
        } catch (e) {
            console.error("Dashboard Core: Error in processData:", e);
            if(typeof showToast === 'function') showToast("Erreur lors du traitement des données du tableau de bord.", "danger");
        }

        setTimeout(() => {
            if (config.debugMode) console.log('Dashboard Core: Applying post-process UI fixes.');
            fixDataIssues();
            enhanceBadgesAndLabels();
            initTooltips();
            errorHandler.checkAndFixBrokenElements?.();
        }, 150);

        if (config.debugMode) console.log('Dashboard Core: Finished processData. Overall changes:', hasChangedOverall);
        return hasChangedOverall;
    }

    function startPolling() {
        if (!config.pollingEnabled || (window.dashboardConfig && window.dashboardConfig.activeMode && window.dashboardConfig.activeMode !== 'polling')) {
            if (config.debugMode) console.log("Dashboard Core: Polling disabled or not the active mode.");
            return;
        }
        clearTimeout(dashboardState.pollingTimeoutId);
        const poll = async () => {
            if (document.visibilityState === 'visible' && !dashboardState.isUpdating && !dashboardState.isErrorThrottleActive) {
                if (config.debugMode) console.log("Dashboard Core: Polling - fetching light data.");
                await fetchAndProcessData(false, true);
            }
            if (config.pollingEnabled && dashboardState.pollingActive) {
                 dashboardState.pollingTimeoutId = setTimeout(poll, config.refreshInterval);
            } else if (config.debugMode) {
                console.log("Dashboard Core: Polling stopped or disabled during poll cycle.");
            }
        };
        dashboardState.pollingActive = true;
        dashboardState.pollingTimeoutId = setTimeout(poll, config.refreshInterval);
        if (config.debugMode) console.log(`Dashboard Core: Polling started (interval: ${config.refreshInterval}ms).`);
    }

    function stopPolling() {
        dashboardState.pollingActive = false;
        clearTimeout(dashboardState.pollingTimeoutId);
        dashboardState.pollingTimeoutId = null;
        if (config.debugMode) console.log("Dashboard Core: Polling explicitly stopped.");
    }

    // --- Fonctions UI ---
    function updateSessionTable(sessions) {
        if (config.debugMode) console.log(`Dashboard Core (Render UI): Starting updateSessionTable with ${sessions ? sessions.length : 'no'} sessions.`);
        const sessionTableBody = document.querySelector('.session-table tbody');
        if (!sessionTableBody) {
            if(config.debugMode) console.warn("updateSessionTable: Session table body not found.");
            return;
        }
        sessionTableBody.innerHTML = '';

        if (!sessions || sessions.length === 0) {
             const cols = sessionTableBody.closest('table')?.querySelectorAll('thead th').length || 5;
             sessionTableBody.innerHTML = `<tr class="no-data-row"><td colspan="${cols}" class="text-center p-4 text-muted"><i class="fas fa-info-circle me-2"></i>Aucune session programmée à afficher.</td></tr>`;
             if (config.debugMode) console.log('Dashboard Core (Render UI): No sessions to display in table.');
             return;
        }

        sessions.forEach(session => {
            const maxP = session.max_participants || 0;
            let placesR = session.places_restantes;
            if (typeof placesR !== 'number' || isNaN(placesR)) {
                placesR = Math.max(0, maxP - (session.inscrits || 0));
            }

            let placesClass = 'text-secondary', placesIcon = 'fa-question-circle';
            if (placesR <= 0) { placesClass = 'text-danger'; placesIcon = 'fa-times-circle'; }
            else if (maxP > 0 && placesR <= Math.floor(maxP * 0.3)) { placesClass = 'text-warning'; placesIcon = 'fa-exclamation-triangle'; }
            else { placesClass = 'text-success'; placesIcon = 'fa-check-circle'; }

            const themeName = session.theme || 'N/A';
            const themeDescription = (window.dashboardConfig?.themesDataForChart?.[themeName]?.description) || themeName;

            const rowHtml = `
                <tr class="session-row" data-session-id="${session.id}" data-theme="${themeName}" data-full="${placesR <= 0 ? '1' : '0'}">
                    <td>
                        <span class="fw-bold d-block">${session.date || 'N/A'}</span>
                        <small class="text-secondary">${session.horaire || 'N/A'}</small>
                    </td>
                    <td class="theme-cell">
                        <span class="theme-badge" data-theme="${themeName}" data-bs-toggle="tooltip" data-bs-placement="top" title="${themeDescription}">
                            ${themeName}
                        </span>
                    </td>
                    <td class="places-dispo text-nowrap ${placesClass}">
                        <i class="fas ${placesIcon} me-1"></i> ${placesR} / ${maxP}
                    </td>
                    <td class="js-salle-cell">
                        ${session.salle ? `<span class="badge bg-light text-dark border">${session.salle}</span>` : '<span class="badge bg-secondary">Non définie</span>'}
                    </td>
                    <td class="text-nowrap text-center">
                        <button type="button" class="btn btn-sm btn-outline-secondary me-1" data-bs-toggle="modal" data-bs-target="#participantsModal_${session.id}" title="Voir les participants"><i class="fas fa-users"></i> <span class="badge bg-secondary ms-1">${session.inscrits || 0}</span></button>
                        <button type="button" class="btn btn-sm btn-primary" data-bs-toggle="modal" data-bs-target="#inscriptionModal_${session.id}" title="Inscrire un participant"><i class="fas fa-plus"></i></button>
                    </td>
                </tr>`;
            sessionTableBody.insertAdjacentHTML('beforeend', rowHtml);
        });
        if (config.debugMode) console.log('Dashboard Core (Render UI): Finished updateSessionTable.');
    }

    function updateStatisticsCounters(sessions) {
        if (config.debugMode) console.log(`Dashboard Core (Render UI): Starting updateStatisticsCounters with ${sessions ? sessions.length : 'no'} sessions.`);
        let stats = { totalInscriptions: 0, totalEnAttente: 0, totalSessions: 0, totalSessionsCompletes: 0 };
        if (sessions && Array.isArray(sessions)) {
            stats.totalSessions = sessions.length;
            sessions.forEach(session => {
                stats.totalInscriptions += (session.inscrits || 0);
                stats.totalEnAttente += (session.liste_attente || 0);
                let placesR = session.places_restantes;
                if (typeof placesR !== 'number' || isNaN(placesR)) {
                    placesR = Math.max(0, (session.max_participants || 0) - (session.inscrits || 0));
                }
                if (placesR <= 0) stats.totalSessionsCompletes++;
            });
        }
        document.getElementById('total-inscriptions')?.textContent = stats.totalInscriptions.toLocaleString();
        document.getElementById('total-en-attente')?.textContent = stats.totalEnAttente.toLocaleString();
        document.getElementById('total-sessions')?.textContent = stats.totalSessions.toLocaleString();
        document.getElementById('total-sessions-completes')?.textContent = stats.totalSessionsCompletes.toLocaleString();
        if (config.debugMode) console.log('Dashboard Core (Render UI): Finished updateStatisticsCounters. Stats:', stats);
    }

    function updateActivityFeed(activities) {
        if (config.debugMode) console.log(`Dashboard Core (Render UI): Starting updateActivityFeed with ${activities ? activities.length : 'no'} activities.`);
        const container = document.getElementById('recent-activity');
        if (!container) {
            if(config.debugMode) console.warn("updateActivityFeed: Activity container not found.");
            return;
        }
        const spinner = container.querySelector('.loading-spinner');
        if (spinner) spinner.remove();

        if (!activities || activities.length === 0) {
            container.innerHTML = '<div class="list-group-item text-center p-3 text-muted"><i class="fas fa-info-circle me-2"></i>Aucune activité récente à afficher.</div>';
            if (config.debugMode) console.log('Dashboard Core (Render UI): No activities to display.');
            return;
        }
        let html = '';
        activities.forEach(activity => {
            const icon = getActivityIcon(activity.type);
            const userHtml = activity.user ? `<span class="text-primary fw-bold">${activity.user}</span>` : 'Système';
            const detailsHtml = activity.details ? `<p class="mb-1 activity-details text-muted small"><i class="fas fa-info-circle fa-fw me-1"></i>${activity.details}</p>` : '';
            html += `
                <div class="list-group-item list-group-item-action activity-item type-${activity.type || 'default'}" data-activity-id="${activity.id}">
                    <div class="d-flex w-100 justify-content-between">
                        <h6 class="mb-1 activity-title"><i class="${icon} me-2 fa-fw"></i>${activity.description || 'Activité non spécifiée'}</h6>
                        <small class="text-muted activity-time text-nowrap ms-2">${activity.date_relative || ''}</small>
                    </div>
                    ${detailsHtml}
                    <small class="text-muted d-block mt-1"><i class="fas fa-user fa-fw me-1"></i>Par: ${userHtml}</small>
                </div>`;
        });
        container.innerHTML = html;
        if (config.debugMode) console.log('Dashboard Core (Render UI): Finished updateActivityFeed.');
    }

    function getActivityIcon(type) {
         const iconMap = {
            'connexion': 'fas fa-sign-in-alt text-success', 'deconnexion': 'fas fa-sign-out-alt text-warning',
            'inscription': 'fas fa-user-plus text-primary', 'validation': 'fas fa-check-circle text-success',
            'refus': 'fas fa-times-circle text-danger', 'annulation': 'fas fa-ban text-danger',
            'ajout_participant': 'fas fa-user-plus text-primary', 'suppression_participant': 'fas fa-user-minus text-danger',
            'modification_participant': 'fas fa-user-edit text-warning', 'reinscription': 'fas fa-redo text-info',
            'liste_attente': 'fas fa-clock text-warning', 'ajout_theme': 'fas fa-folder-plus text-primary',
            'ajout_service': 'fas fa-building text-primary', 'ajout_salle': 'fas fa-door-open text-primary',
            'attribution_salle': 'fas fa-map-marker-alt text-info', 'systeme': 'fas fa-cog text-secondary',
            'notification': 'fas fa-bell text-warning', 'telecharger_invitation': 'fas fa-file-download text-info',
            'ajout_document': 'fas fa-file-upload text-info', 'suppression_document': 'fas fa-file-excel text-danger',
            'default': 'fas fa-info-circle text-secondary'
        };
        return iconMap[type] || iconMap.default;
    }

    function enhanceUI() {
        if (config.debugMode) console.log('Dashboard Core (UI Enhance): Running enhanceUI.');
        initTooltips();
        enhanceBadgesAndLabels();
        fixDataIssues();
    }

    function initTooltips() {
        if (typeof window.initializeGlobalTooltips === 'function') {
            window.initializeGlobalTooltips();
        } else if (typeof bootstrap !== 'undefined' && bootstrap.Tooltip) {
            if (config.debugMode) console.log('Dashboard Core (UI Enhance): Initializing tooltips (fallback).');
            const tooltipTriggerList = [].slice.call(document.querySelectorAll('[data-bs-toggle="tooltip"]'));
            tooltipTriggerList.map(function (tooltipTriggerEl) {
                let instance = bootstrap.Tooltip.getInstance(tooltipTriggerEl);
                if (instance) instance.dispose();
                try { return new bootstrap.Tooltip(tooltipTriggerEl); }
                catch(e) { if(config.debugMode) console.warn("Tooltip init error:", e, tooltipTriggerEl); return null;}
            });
        }
    }

    function enhanceBadgesAndLabels() {
        if (typeof window.enhanceThemeBadgesGlobally === 'function') {
            window.enhanceThemeBadgesGlobally();
        }
        document.querySelectorAll('.js-salle-cell').forEach(cell => {
            const textContent = cell.textContent.trim();
            if (!cell.querySelector('.salle-badge') && textContent) {
                if (textContent === 'Non définie' || textContent === 'N/A' || textContent === '') {
                    cell.innerHTML = '<span class="badge bg-secondary salle-badge">Non définie</span>';
                } else {
                    cell.innerHTML = `<span class="badge bg-info text-dark salle-badge">${textContent}</span>`;
                }
            }
        });
        if (config.debugMode) console.log('Dashboard Core (UI Enhance): Badges and labels enhanced.');
    }

    function fixDataIssues() {
        if (config.debugMode) console.log('Dashboard Core (UI Fix): Running fixDataIssues.');
        document.querySelectorAll('.places-dispo').forEach(el => {
            const text = el.textContent.trim();
            if (text.includes('/')) {
                const parts = text.split('/');
                const available = parseInt(parts[0].trim());
                const total = parseInt(parts[1].trim());
                if (isNaN(available) || isNaN(total)) {
                    el.classList.remove('text-success', 'text-warning', 'text-danger');
                    el.classList.add('text-secondary');
                    el.innerHTML = '<i class="fas fa-question-circle me-1"></i> ? / ?';
                    el.title = 'Données indisponibles'; return;
                }
                let icon, colorClass;
                if (available <= 0) { icon = 'fa-times-circle'; colorClass = 'text-danger'; }
                else if (total > 0 && available <= Math.floor(total * 0.2)) { icon = 'fa-exclamation-circle'; colorClass = 'text-danger'; }
                else if (total > 0 && available <= Math.floor(total * 0.4)) { icon = 'fa-exclamation-triangle'; colorClass = 'text-warning'; }
                else { icon = 'fa-check-circle'; colorClass = 'text-success'; }
                el.classList.remove('text-success', 'text-warning', 'text-danger', 'text-secondary');
                el.classList.add(colorClass);
                el.innerHTML = `<i class="fas ${icon} me-1"></i> ${available} / ${total}`;
            } else if (text === 'NaN / NaN' || text.includes('undefined') || text === '/ ' || text === ' / ' || text.includes('null') || text === '? / ?') {
                if (!el.innerHTML.includes('fa-question-circle')) {
                    el.classList.remove('text-success', 'text-warning', 'text-danger');
                    el.classList.add('text-secondary');
                    el.innerHTML = '<i class="fas fa-question-circle me-1"></i> ? / ?';
                    el.title = 'Données indisponibles';
                }
            }
        });
        document.querySelectorAll('.counter-value, .badge-count, .stat-value').forEach(counter => {
            const text = counter.textContent.trim();
            if (text === '' || text === 'undefined' || text === 'null' || text === 'NaN' || text === '—' || !/^\d+$/.test(text)) {
                if (counter.textContent !== '—') {
                    counter.textContent = '—';
                    counter.classList.add('text-muted');
                    counter.title = 'Valeur indisponible';
                }
            } else {
                 counter.classList.remove('text-muted');
            }
        });
        document.querySelectorAll('table tbody').forEach(tbody => {
            if (tbody.children.length === 0 || (tbody.children.length === 1 && tbody.firstElementChild.classList.contains('no-data-row'))) {
                 if (!tbody.querySelector('tr.no-data-row')) {
                    const cols = tbody.closest('table')?.querySelectorAll('thead th').length || 1;
                    tbody.innerHTML = `<tr class="no-data-row"><td colspan="${cols}" class="text-center p-3 text-muted"><i class="fas fa-info-circle me-2"></i>Aucune donnée à afficher.</td></tr>`;
                }
            } else if (tbody.querySelector('tr.no-data-row') && tbody.children.length > 1) {
                tbody.querySelector('tr.no-data-row').remove();
            }
        });
        if (config.debugMode) console.log('Dashboard Core (UI Fix): Finished fixDataIssues.');
    }

    function setupValidationListeners() {
         document.body.addEventListener('click', function(event) {
            const button = event.target.closest('.validation-ajax');
            if (!button) return;
            const inscriptionId = button.getAttribute('data-inscription-id');
            const action = button.getAttribute('data-action');
            if (!inscriptionId || !action) return;

            button.disabled = true;
            const originalHtml = button.innerHTML;
            button.innerHTML = '<span class="spinner-border spinner-border-sm" role="status" aria-hidden="true"></span>';

            fetch('/validation_inscription_ajax', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'X-CSRFToken': getCsrfToken() },
                body: JSON.stringify({ inscription_id: inscriptionId, action: action })
            })
            .then(response => response.json())
            .then(data => {
                if (data.success) {
                    if (typeof showToast === 'function') showToast(data.message, 'success');
                    debouncedFetchAndProcessData(true);
                    const modal = button.closest('.modal');
                    if (modal && bootstrap.Modal.getInstance(modal)) {
                        bootstrap.Modal.getInstance(modal).hide();
                    }
                } else {
                    if (typeof showToast === 'function') showToast(data.message || 'Erreur lors de la validation', 'danger');
                }
            })
            .catch(error => {
                console.error('Validation AJAX error:', error);
                if (typeof showToast === 'function') showToast('Erreur de communication.', 'danger');
            })
            .finally(() => {
                const currentButton = document.querySelector(`.validation-ajax[data-inscription-id="${inscriptionId}"][data-action="${action}"]`);
                if(currentButton) { currentButton.disabled = false; currentButton.innerHTML = originalHtml; }
            });
        });
        if (config.debugMode) console.log('Dashboard Core: Validation AJAX listeners set up.');
    }


    // --- Fonctions Graphiques (Chart.js) ---
    function initializeCharts() {
        if (config.chartRendering === 'none' || typeof Chart === 'undefined') {
            if(config.debugMode && typeof Chart === 'undefined') console.warn("Chart.js n'est pas chargé. Graphiques dynamiques désactivés.");
            return;
        }
        if (config.debugMode) console.log('Dashboard Core (Charts): Initializing chart structures.');
        renderThemeDistributionChartJS([]);
        renderServiceDistributionChartJS([]);
    }

    function updateCharts(sessions, participants) {
        if (config.chartRendering === 'none' || typeof Chart === 'undefined') return;
        if (config.debugMode) console.log(`Dashboard Core (Charts): Updating charts. Sessions: ${sessions?.length}, Participants: ${participants?.length}`);
        try {
            renderThemeDistributionChartJS(sessions || []);
            renderServiceDistributionChartJS(participants || []);
        } catch (e) {
            console.error("Dashboard Core (Charts): Error during updateCharts:", e);
            if(typeof showToast === 'function') showToast("Erreur lors de la mise à jour des graphiques.", "danger");
        }
    }

    function renderThemeDistributionChartJS(sessionsData) {
        if (config.debugMode) console.log(`Dashboard Core (Charts): Rendering Theme Distribution. Sessions count: ${sessionsData?.length}`);
        const ctxElement = document.getElementById('themeDistributionChart');
        if (!ctxElement) { if (config.debugMode) console.warn("Canvas 'themeDistributionChart' non trouvé."); return; }
        const ctx = ctxElement.getContext('2d');
        const legendContainer = document.getElementById('themeChartLegend');
        const parentDiv = ctxElement.parentNode;
        let noDataMsg = parentDiv.querySelector('.no-data-message-chart');

        if (!sessionsData || sessionsData.filter(s => (s.inscrits || 0) > 0).length === 0) {
            if (dashboardState.themeChartInstance) { dashboardState.themeChartInstance.destroy(); dashboardState.themeChartInstance = null; }
            ctx.clearRect(0, 0, ctxElement.width, ctxElement.height);
            if (!noDataMsg) { noDataMsg = document.createElement('div'); noDataMsg.className = 'no-data-message-chart'; parentDiv.appendChild(noDataMsg); }
            noDataMsg.innerHTML = '<i class="fas fa-chart-pie me-2"></i>Aucune inscription pour afficher la répartition par thème.';
            if(legendContainer) legendContainer.innerHTML = '';
            if (config.debugMode) console.log('Dashboard Core (Charts): No data for theme chart.');
            return;
        }
        if (noDataMsg) noDataMsg.remove();

        const themeCounts = sessionsData.reduce((acc, s) => { acc[s.theme] = (acc[s.theme] || 0) + (s.inscrits || 0); return acc; }, {});
        const labels = Object.keys(themeCounts).filter(k => themeCounts[k] > 0);
        const dataValues = labels.map(l => themeCounts[l]);
        const colors = labels.map((l, i) => (window.dashboardConfig?.themesDataForChart?.[l]?.color || getRandomColor(i)));
        const chartData = { labels, datasets: [{ label: 'Inscriptions', data: dataValues, backgroundColor: colors, borderColor: '#fff', borderWidth: 2, hoverOffset: 8 }] };
        const chartOptions = { responsive: true, maintainAspectRatio: false, animation: {animateScale: true, animateRotate: true, duration: 800}, plugins: { legend: {display: false}, tooltip: {callbacks: {label: c => `${c.label}: ${c.parsed} (${(c.parsed / c.dataset.data.reduce((a,b)=>a+b,0) * 100).toFixed(1)}%)`}}}};

        if (dashboardState.themeChartInstance) {
            dashboardState.themeChartInstance.data = chartData;
            dashboardState.themeChartInstance.update();
            if (config.debugMode) console.log('Dashboard Core (Charts): Theme chart updated.');
        } else {
            dashboardState.themeChartInstance = new Chart(ctx, {type: 'doughnut', data: chartData, options: chartOptions});
            if (config.debugMode) console.log('Dashboard Core (Charts): Theme chart created.');
        }
        if(legendContainer) generateCustomLegend(legendContainer, labels, colors, dataValues, window.dashboardConfig?.themesDataForChart || {});
    }

    function renderServiceDistributionChartJS(participantsData) {
        if (config.debugMode) console.log(`Dashboard Core (Charts): Rendering Service Distribution. Participants count: ${participantsData?.length}`);
        const ctxElement = document.getElementById('serviceDistributionChart');
        if (!ctxElement) { if (config.debugMode) console.warn("Canvas 'serviceDistributionChart' non trouvé."); return; }
        const ctx = ctxElement.getContext('2d');
        const legendContainer = document.getElementById('serviceChartLegend');
        const parentDiv = ctxElement.parentNode;
        let noDataMsg = parentDiv.querySelector('.no-data-message-chart');

        if (!participantsData || participantsData.length === 0) {
            if (dashboardState.serviceChartInstance) { dashboardState.serviceChartInstance.destroy(); dashboardState.serviceChartInstance = null; }
            ctx.clearRect(0, 0, ctxElement.width, ctxElement.height);
            if (!noDataMsg) { noDataMsg = document.createElement('div'); noDataMsg.className = 'no-data-message-chart'; parentDiv.appendChild(noDataMsg); }
            noDataMsg.innerHTML = '<i class="fas fa-users me-2"></i>Aucun participant pour afficher la répartition par service.';
            if(legendContainer) legendContainer.innerHTML = '';
            if (config.debugMode) console.log('Dashboard Core (Charts): No data for service chart.');
            return;
        }
        if (noDataMsg) noDataMsg.remove();

        const serviceCounts = participantsData.reduce((acc, p) => { acc[p.service] = (acc[p.service] || 0) + 1; return acc; }, {});
        const labels = Object.keys(serviceCounts).filter(k => serviceCounts[k] > 0);
        const dataValues = labels.map(l => serviceCounts[l]);
        const colors = labels.map((l, i) => (window.dashboardConfig?.servicesDataForChart?.[l]?.color || getRandomColor(i + labels.length)));
        const chartData = { labels, datasets: [{ label: 'Participants', data: dataValues, backgroundColor: colors, borderColor: colors.map(c => Chart.helpers.color(c).darken(0.2).rgbString()), borderWidth:1, borderRadius:4, barPercentage:0.7, categoryPercentage:0.8}]};
        const chartOptions = { indexAxis:'y', responsive:true, maintainAspectRatio:false, scales:{x:{beginAtZero:true, ticks:{precision:0}, grid:{color:'rgba(0,0,0,0.05)'}}, y:{grid:{display:false}}}, plugins:{legend:{display:false}, tooltip:{callbacks:{label:c=>`${c.label}: ${c.raw} participant(s)`}}}, animation:{duration:800}};

        if (dashboardState.serviceChartInstance) {
            dashboardState.serviceChartInstance.data = chartData;
            dashboardState.serviceChartInstance.update();
            if (config.debugMode) console.log('Dashboard Core (Charts): Service chart updated.');
        } else {
            dashboardState.serviceChartInstance = new Chart(ctx, {type:'bar', data:chartData, options:chartOptions});
            if (config.debugMode) console.log('Dashboard Core (Charts): Service chart created.');
        }
        if(legendContainer) generateCustomLegend(legendContainer, labels, colors, dataValues, window.dashboardConfig?.servicesDataForChart || {}, true);
    }

    function generateCustomLegend(container, labels, colors, values, configData, isServiceChart = false) {
        if (!container) return;
        let legendHtml = '';
        const total = values.reduce((sum, count) => sum + count, 0);
        labels.forEach((label, index) => {
            if (values[index] === 0 && !isServiceChart) return;
            const color = colors[index];
            const value = values[index];
            const percentage = total > 0 && !isServiceChart ? `(${(value / total * 100).toFixed(1)}%)` : '';
            const description = configData[label]?.description || label;
            legendHtml += `<div class="legend-item" title="${description}" style="opacity:0; animation: fadeInLegend 0.5s ease ${index * 0.1}s forwards;"><span class="legend-color" style="background-color: ${color};"></span><span class="legend-label">${label}</span><span class="legend-value">${value} ${percentage}</span></div>`;
        });
        container.innerHTML = legendHtml;
        if (!document.getElementById('fadeInLegendStyle')) {
            const styleSheet = document.createElement("style"); styleSheet.id = 'fadeInLegendStyle';
            styleSheet.innerText = "@keyframes fadeInLegend { to { opacity: 1; } }"; document.head.appendChild(styleSheet);
        }
    }

    // --- Utilitaires ---
    function debounce(func, delay) { let timeout; return function(...args) { const context = this; clearTimeout(timeout); timeout = setTimeout(() => func.apply(context, args), delay); }; }
    function simpleHash(obj) { const str = JSON.stringify(obj); let hash = 0; if (str.length === 0) return hash; for (let i = 0; i < str.length; i++) { const char = str.charCodeAt(i); hash = ((hash << 5) - hash) + char; hash |= 0; } return hash; }
    function getRandomColor(index) { const colors = ['#4e73df', '#1cc88a', '#36b9cc', '#f6c23e', '#e74a3b', '#858796', '#5a5c69', '#fd7e14', '#6f42c1', '#d63384', '#20c997', '#6610f2']; return colors[index % colors.length]; }
    function getCsrfToken() { return document.querySelector('meta[name="csrf-token"]')?.content || document.querySelector('input[name="csrf_token"]')?.value || ''; }
    function showGlobalLoading(isLoading) { if (globalLoadingOverlay) { globalLoadingOverlay.style.display = isLoading ? 'flex' : 'none'; if(isLoading) globalLoadingOverlay.classList.remove('hidden'); else globalLoadingOverlay.classList.add('hidden'); } }

    function setupStaticEventListeners() {
        const refreshButton = document.getElementById('refresh-dashboard');
        if (refreshButton) {
            refreshButton.addEventListener('click', () => {
                if (config.debugMode) console.log('Dashboard Core: Manual refresh triggered via button.');
                refreshButton.disabled = true;
                const originalText = refreshButton.innerHTML;
                refreshButton.innerHTML = '<i class="fas fa-sync-alt fa-spin me-1"></i>Actualisation...';
                fetchAndProcessData(true).finally(() => {
                    refreshButton.disabled = false;
                    refreshButton.innerHTML = originalText;
                });
            });
        }
        setupValidationListeners();
    }

    function setupMutationObserver() {
         if (!window.MutationObserver) return;
        let observerTimeout = null;
        const observer = new MutationObserver(function(mutations) {
            let importantChange = false;
            for (const mutation of mutations) {
                if (mutation.type === 'childList' && mutation.addedNodes.length > 0) {
                    for (const node of mutation.addedNodes) {
                        if (node.nodeType === 1 && (node.matches?.('.session-row, .activity-item, .stat-card, [data-bs-toggle="tooltip"]') || node.querySelector?.('.session-row, .activity-item, .stat-card, [data-bs-toggle="tooltip"]'))) {
                            importantChange = true; break;
                        }
                    }
                }
                if (importantChange) break;
            }
            if (importantChange) {
                clearTimeout(observerTimeout);
                observerTimeout = setTimeout(() => {
                    if (config.debugMode) console.log("MutationObserver: Triggering UI enhancements.");
                    enhanceUI();
                }, 350);
            }
        });
        observer.observe(document.body, { childList: true, subtree: true });
        if (config.debugMode) console.log('Dashboard Core: Mutation observer initialized for UI enhancements.');
    }


    // --- Exposition des méthodes publiques ---
    window.dashboardCore = {
        forceRefresh: () => fetchAndProcessData(true),
        startPolling: startPolling,
        stopPolling: stopPolling,
        initializeDashboard: initializeDashboard,
        fetchDataInternal: fetchAndProcessData,
        updateCharts: updateCharts,
        updateStatisticsCounters: updateStatisticsCounters,
        updateActivityFeed: updateActivityFeed,
        initializeCharts: initializeCharts,
        getState: () => dashboardState,
        getConfig: () => config
    };

    // --- Démarrage ---
    initializeDashboard();

}); // Fin du DOMContentLoaded pour dashboard-core.js

// Fonction showToast globale
if (typeof window.showToast !== 'function') {
    window.showToast = function(message, type = 'info', duration = 5000) {
         const toastContainer = document.getElementById('toast-container') || (() => {
            const container = document.createElement('div');
            container.id = 'toast-container';
            container.className = 'toast-container position-fixed top-0 end-0 p-3';
            document.body.appendChild(container);
            return container;
        })();
        const toastId = 'toast-' + Date.now();
        const toastElement = document.createElement('div');
        toastElement.id = toastId;
        const validTypes = ['primary', 'secondary', 'success', 'danger', 'warning', 'info', 'light', 'dark'];
        const bgType = validTypes.includes(type) ? type : 'info';
        const textClass = (bgType === 'light' || bgType === 'warning') ? 'text-dark' : 'text-white';
        toastElement.className = `toast align-items-center ${textClass} bg-${bgType} border-0 fade`;
        toastElement.setAttribute('role', 'alert');
        toastElement.setAttribute('aria-live', 'assertive');
        toastElement.setAttribute('aria-atomic', 'true');
        toastElement.innerHTML = `<div class="d-flex"><div class="toast-body">${message}</div><button type="button" class="btn-close ${textClass === 'text-white' ? 'btn-close-white' : ''} me-2 m-auto" data-bs-dismiss="toast" aria-label="Close"></button></div>`;
        toastContainer.appendChild(toastElement);
        const bsToast = new bootstrap.Toast(toastElement, { delay: duration, autohide: true });
        bsToast.show();
        toastElement.addEventListener('hidden.bs.toast', () => toastElement.remove());
    };
}
