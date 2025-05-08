/**
 * dashboard-core.js - Fichier JavaScript optimisé pour le tableau de bord
 * Version: 1.6.1 - Suppression commentaire Jinja dans le rendu JS
 */

document.addEventListener('DOMContentLoaded', function() {
    console.log('Dashboard Core: Initializing (v1.6.1)');

    if (window.dashboardCoreInitialized) {
        console.log('Dashboard Core: Already initialized. Skipping.');
        return;
    }
    window.dashboardCoreInitialized = true;

    const globalLoadingOverlay = document.getElementById('loading-overlay');

    const dashInitConfig = window.dashboardConfig || {};

    const config = {
        debugMode: dashInitConfig.debugMode || false,
        refreshInterval: dashInitConfig.autoRefreshInterval || 120000,
        minRefreshDelay: dashInitConfig.minRefreshDelay || 30000,
        debounceDelay: dashInitConfig.debounceDelay || 1000,
        baseApiUrl: dashInitConfig.baseApiUrl || '/api',
        chartRendering: dashInitConfig.chartRendering || 'auto',
        usingDashboardInit: !!dashInitConfig.autoRefreshInterval || !!dashInitConfig.preferredMode,
        socketEnabled: dashInitConfig.socketEnabled !== undefined ? dashInitConfig.socketEnabled : true,
        pollingEnabled: dashInitConfig.pollingEnabled !== undefined ? dashInitConfig.pollingEnabled : true,
        preferredMode: dashInitConfig.preferredMode || 'auto',
        errorThrottleMode: false,
        fetchTimeoutDuration: 15000
    };

    if (config.debugMode) console.log(`Dashboard Core: Configured`, config);

    let dashboardState = {
        lastRefresh: 0,
        updating: false,
        dataHashes: { sessions: null, participants: null, activites: null },
        rawData: { sessions: [], participants: [], activites: [] },
        errorCount: 0,
        maxErrors: 5,
        pollingActive: true,
        pollingTimeout: null,
        pollingTimeoutScheduled: false,
        themeChart: null,
        serviceChart: null,
        fetchTimeoutId: null
    };

    const errorHandler = window.apiErrorHandler || {
        handleApiError: (endpoint, errorData, statusCode) => {
            console.error(`Fallback Error Handler: Erreur ${statusCode} sur ${endpoint}`, errorData);
            if (typeof showToast === 'function') showToast(`Erreur ${statusCode} lors du chargement de ${endpoint}`, 'danger');
            return false;
        },
        checkAndFixBrokenElements: () => {
            if (config.debugMode) console.log("Dashboard Core: Fixing UI elements with fallback handler");
            fixDataIssues();
            enhanceBadgesAndLabels();
        }
    };

    // ====== INITIALISATION ET CYCLE DE VIE ======
    function initializeDashboard() {
        enhanceUI();
        initializeCharts();

        if (!config.usingDashboardInit) {
            setupEventListeners();
            startPolling();
        } else {
            window.forcePollingUpdate = (forceRefresh) => debouncedFetchDashboardData(forceRefresh);
            window.updateStatsCounters = updateStatisticsCounters;
            window.refreshRecentActivity = () => updateActivityFeed(null);
            window.chartModule = { initialize: initializeCharts, update: updateCharts };
        }

        debouncedFetchDashboardData(true);

        if (config.debugMode) console.log('Dashboard Core: Initialization sequence complete.');
    }

    // ... (startPolling, setupEventListeners, setupMutationObserver identiques) ...
     function startPolling() {
        if (config.usingDashboardInit && config.preferredMode !== 'polling') {
            if (config.debugMode) console.log("Dashboard Core: Polling not started (managed by dashboard-init or mode is not polling).");
            return;
        }
        if (!config.pollingEnabled) {
             if (config.debugMode) console.log("Dashboard Core: Polling is disabled.");
             return;
        }

        if (dashboardState.pollingTimeout) clearTimeout(dashboardState.pollingTimeout);
        dashboardState.pollingTimeoutScheduled = false;

        function scheduleNextPoll() {
            if (dashboardState.pollingTimeoutScheduled || !dashboardState.pollingActive) return;
            dashboardState.pollingTimeoutScheduled = true;

            dashboardState.pollingTimeout = setTimeout(async () => {
                dashboardState.pollingTimeoutScheduled = false;
                if (dashboardState.pollingActive && document.visibilityState === 'visible' && !dashboardState.updating) {
                    try {
                        await debouncedFetchDashboardData(false, true);
                    } catch (err) {
                        console.error("Dashboard Core: Error during scheduled poll:", err);
                    } finally {
                        if (dashboardState.pollingActive) {
                            scheduleNextPoll();
                        }
                    }
                } else {
                    if (dashboardState.pollingActive) {
                         scheduleNextPoll();
                    }
                }
            }, config.refreshInterval);
        }

        scheduleNextPoll();
        if (config.debugMode) console.log(`Dashboard Core: Polling started (interval: ${config.refreshInterval}ms)`);
    }

    function setupEventListeners() {
        document.addEventListener('visibilitychange', () => {
            if (document.visibilityState === 'visible' && dashboardState.pollingActive) {
                if (config.debugMode) console.log('Dashboard Core: Tab visible, triggering refresh');
                debouncedFetchDashboardData(false, true);
            } else if (document.visibilityState === 'hidden') {
                if (dashboardState.pollingTimeout) {
                    clearTimeout(dashboardState.pollingTimeout);
                    dashboardState.pollingTimeoutScheduled = false;
                    if(config.debugMode) console.log('Dashboard Core: Tab hidden, polling paused.');
                }
            }
        });

        const refreshButton = document.getElementById('refresh-dashboard');
        if (refreshButton) {
            refreshButton.addEventListener('click', function() {
                this.disabled = true;
                this.innerHTML = '<i class="fas fa-sync-alt fa-spin me-1"></i>Actualisation...';
                if (globalLoadingOverlay) globalLoadingOverlay.style.display = 'flex';

                debouncedFetchDashboardData(true)
                    .then((updated) => {
                        if (typeof showToast === 'function') {
                            if (updated === true) showToast('Données actualisées avec succès', 'success');
                            else if (updated === false) showToast('Aucune nouvelle donnée ou erreur lors de l\'actualisation.', 'info');
                        }
                        if (!dashboardState.pollingActive) {
                            dashboardState.pollingActive = true;
                            dashboardState.errorCount = 0;
                            showErrorWarning(false);
                            startPolling();
                        }
                    })
                    .catch(err => {
                        console.error('Dashboard Core: Error during manual refresh:', err);
                        if (typeof showToast === 'function') showToast('Erreur lors de l\'actualisation manuelle', 'danger');
                    })
                    .finally(() => {
                        const currentRefreshButton = document.getElementById('refresh-dashboard');
                        if(currentRefreshButton) {
                            currentRefreshButton.disabled = false;
                            currentRefreshButton.innerHTML = '<i class="fas fa-sync-alt me-1"></i>Actualiser';
                        }
                        if (globalLoadingOverlay && !dashboardState.updating) {
                             globalLoadingOverlay.style.display = 'none';
                             globalLoadingOverlay.classList.add('hidden');
                        }
                    });
            });
        }
        setupValidationListeners();
        setupMutationObserver();
    }

     function setupMutationObserver() {
         if (!window.MutationObserver) return;
        let observerTimeout = null;
        const observer = new MutationObserver(function(mutations) {
            let important = false;
            for (const mutation of mutations) {
                if (mutation.type === 'childList' && mutation.addedNodes.length > 0) {
                    for (const node of mutation.addedNodes) {
                        if (node.nodeType === 1 && node.classList && (
                            node.classList.contains('places-dispo') ||
                            node.classList.contains('theme-badge') ||
                            node.classList.contains('counter-value') ||
                            node.querySelector('.places-dispo, .theme-badge, .counter-value')
                        )) {
                            important = true;
                            break;
                        }
                    }
                }
                if (important) break;
            }
            if (important) {
                clearTimeout(observerTimeout);
                observerTimeout = setTimeout(() => {
                    fixDataIssues();
                    enhanceBadgesAndLabels();
                }, 300);
            }
        });
        observer.observe(document.body, { childList: true, subtree: true });
        if (config.debugMode) console.log('Dashboard Core: Mutation observer initialized');
    }

    // ====== COMMUNICATION AVEC L'API ======
    async function _fetchDashboardData(forceRefresh = false, lightMode = false) {
        // ... (code identique à la version précédente) ...
        if (dashboardState.updating && !forceRefresh) {
            if (config.debugMode) console.log('Dashboard Core: Skipping fetch (update in progress, not forced)');
            return Promise.resolve(false);
        }

        if (config.errorThrottleMode && !forceRefresh) {
            if (config.debugMode) console.log('Dashboard Core: Skipping fetch (error throttle mode active)');
            return Promise.resolve(false);
        }

        const now = Date.now();
        if (!forceRefresh && now - dashboardState.lastRefresh < config.minRefreshDelay) {
            if (config.debugMode) console.log(`Dashboard Core: Skipping fetch (too soon, ${config.minRefreshDelay - (now - dashboardState.lastRefresh)}ms remaining)`);
            return Promise.resolve(false);
        }

        dashboardState.updating = true;
        if (!forceRefresh || (forceRefresh && now - dashboardState.lastRefresh >= config.minRefreshDelay)) {
             dashboardState.lastRefresh = now;
        }

        let updateSucceeded = false;
        let currentUrl = '';

        if (globalLoadingOverlay && (forceRefresh || !lightMode)) {
            globalLoadingOverlay.style.display = 'flex';
            globalLoadingOverlay.classList.remove('hidden');
        }

        try {
            currentUrl = `${config.baseApiUrl}/dashboard_essential?_=${Date.now()}`; // Toujours fetch complet

            if (config.debugMode) console.log(`Dashboard Core: Fetching data from ${currentUrl}`);

            const controller = new AbortController();
            const timeoutId = setTimeout(() => {
                controller.abort();
                if (config.debugMode) console.warn(`Dashboard Core: Fetch to ${currentUrl} timed out after ${config.fetchTimeoutDuration}ms.`);
            }, config.fetchTimeoutDuration);

            const response = await fetch(currentUrl, {
                method: 'GET',
                headers: {
                    'Accept': 'application/json',
                    'X-Requested-With': 'XMLHttpRequest',
                    'Cache-Control': 'no-cache, no-store, must-revalidate',
                    'Pragma': 'no-cache',
                    'Expires': '0'
                },
                signal: controller.signal
            });

            clearTimeout(timeoutId);

            if (!response.ok) {
                let errorData = { message: `HTTP error ${response.status}`, status: response.status };
                try {
                    const clonedResponse = response.clone();
                    errorData = await clonedResponse.json();
                } catch (e) {
                    if (config.debugMode) console.warn('Dashboard Core: Failed to parse error response as JSON.', e);
                }

                if (response.status >= 500 && !config.errorThrottleMode) {
                    config.errorThrottleMode = true;
                    if (config.debugMode) console.warn('Dashboard Core: Error throttle mode activated due to server error.');
                    setTimeout(() => {
                        config.errorThrottleMode = false;
                        if (config.debugMode) console.log('Dashboard Core: Error throttle mode deactivated');
                    }, 60000);
                }

                errorHandler.handleApiError(currentUrl, errorData, response.status);
                return false;
            }

            const data = await response.json();
            if (!data || typeof data !== 'object') {
                console.error('Dashboard Core: Invalid data received from API', data);
                errorHandler.handleApiError(currentUrl, { message: "Invalid data format from API" }, response.status);
                return false;
            }

            dashboardState.rawData = data; // Stocker les données brutes

            const hasChanged = processData(data, forceRefresh);
            dashboardState.errorCount = 0;
            showErrorWarning(false);
            updateSucceeded = true;

            if (hasChanged) {
                if (config.debugMode) console.log('Dashboard Core: Data updated, triggering dashboardDataRefreshed event');
                document.dispatchEvent(new CustomEvent('dashboardDataRefreshed', { detail: { data: data } }));
            } else {
                if (config.debugMode) console.log('Dashboard Core: No significant data changes detected');
            }

            return hasChanged;

        } catch (error) {
            console.error(`Dashboard Core: Error fetching dashboard data from ${currentUrl}:`, error.name, error.message);
            errorHandler.handleApiError(currentUrl, { message: error.message, name: error.name }, 0);

            dashboardState.errorCount++;
            if (dashboardState.errorCount >= 3 && !config.errorThrottleMode) {
                config.errorThrottleMode = true;
                console.warn('Dashboard Core: Error throttle mode activated due to multiple errors.');
                setTimeout(() => {
                    config.errorThrottleMode = false;
                    if (config.debugMode) console.log('Dashboard Core: Error throttle mode deactivated');
                }, 120000);
            }

            if (dashboardState.errorCount >= dashboardState.maxErrors && dashboardState.pollingActive) {
                console.warn(`Dashboard Core: Too many errors (${dashboardState.errorCount}), pausing polling`);
                dashboardState.pollingActive = false;
                if (dashboardState.pollingTimeout) clearTimeout(dashboardState.pollingTimeout);
                dashboardState.pollingTimeoutScheduled = false;
                showErrorWarning(true);
            }
            return undefined; // Indiquer une erreur
        } finally {
            dashboardState.updating = false;
            if (globalLoadingOverlay && (forceRefresh || !lightMode)) {
                setTimeout(() => {
                    if (!dashboardState.updating) {
                         globalLoadingOverlay.style.display = 'none';
                         globalLoadingOverlay.classList.add('hidden');
                    }
                }, 200);
            }
            if (config.debugMode) console.log('Dashboard Core: Fetch cycle finished.');
        }
    }

    function debouncedFetchDashboardData(forceRefresh = false, lightModeForDebounce = false) {
        // ... (code identique, mais appelle _fetchDashboardData avec lightMode=false) ...
         if (forceRefresh) {
            if (dashboardState.fetchTimeoutId) {
                clearTimeout(dashboardState.fetchTimeoutId);
                dashboardState.fetchTimeoutId = null;
            }
            if (config.debugMode) console.log("Dashboard Core: Debounced fetch triggered (forced)");
            // Forcer un fetch complet (non-light)
            return _fetchDashboardData(true, false);
        }

        if (dashboardState.fetchTimeoutId) {
            if (config.debugMode) console.log("Dashboard Core: Debounced fetch skipped (timeout active)");
            return Promise.resolve(false);
        }

        if (config.debugMode) console.log(`Dashboard Core: Debounced fetch scheduled (delay: ${config.debounceDelay}ms)`);

        return new Promise((resolve) => {
            dashboardState.fetchTimeoutId = setTimeout(async () => {
                dashboardState.fetchTimeoutId = null;
                try {
                    // Toujours fetch complet pour avoir les participants pour les graphiques
                    const result = await _fetchDashboardData(false, false);
                    resolve(result);
                } catch (error) {
                    console.error("Dashboard Core: Error in debounced fetch execution:", error);
                    resolve(undefined); // Indiquer une erreur
                }
            }, config.debounceDelay);
        });
    }

    function processData(data, forceRefresh = false) {
        // ... (code identique à la version précédente) ...
         if (!data || typeof data !== 'object') {
             console.error("ProcessData: Invalid data received", data);
             return false;
        }
        let hasChanged = forceRefresh;

        if (data.sessions && Array.isArray(data.sessions)) {
            const validatedSessions = data.sessions.map(s => {
                s.places_restantes = s.places_restantes ?? Math.max(0, (s.max_participants || 0) - (s.inscrits || 0));
                return s;
            });
            const sessionsHash = simpleHash(validatedSessions);
            if (sessionsHash !== dashboardState.dataHashes.sessions) {
                updateSessionTable(validatedSessions);
                updateStatisticsCounters(validatedSessions);
                dashboardState.dataHashes.sessions = sessionsHash;
                hasChanged = true;
            }
        } else if (dashboardState.dataHashes.sessions !== null) {
             updateSessionTable([]);
             updateStatisticsCounters([]);
             dashboardState.dataHashes.sessions = null;
             hasChanged = true;
        }

        if (data.participants && Array.isArray(data.participants)) {
             const participantsHash = simpleHash(data.participants);
             if (participantsHash !== dashboardState.dataHashes.participants) {
                 dashboardState.dataHashes.participants = participantsHash;
                 if (dashboardState.dataHashes.sessions !== null) {
                     updateCharts(data.sessions, data.participants);
                 }
                 hasChanged = true;
             }
        } else if (dashboardState.dataHashes.participants !== null) {
             dashboardState.dataHashes.participants = null;
             updateCharts(data.sessions, []);
             hasChanged = true;
        }

        if (data.activites && Array.isArray(data.activites)) {
            const activitiesHash = simpleHash(data.activites);
            if (activitiesHash !== dashboardState.dataHashes.activites) {
                updateActivityFeed(data.activites);
                dashboardState.dataHashes.activites = activitiesHash;
                hasChanged = true;
            }
        } else if (dashboardState.dataHashes.activites !== null) {
             updateActivityFeed([]);
             dashboardState.dataHashes.activites = null;
             hasChanged = true;
        }

        if (hasChanged) {
            setTimeout(() => {
                fixDataIssues();
                enhanceBadgesAndLabels();
                initTooltips();
                errorHandler.checkAndFixBrokenElements();
            }, 100);
        }

        return hasChanged;
    }


    // ====== MISE À JOUR DES COMPOSANTS UI ======
    // ... (updateSessionTable, updateStatisticsCounters, updateCounter, updateActivityFeed, getActivityIcon identiques) ...
     function updateSessionTable(sessions) {
        if (!sessions || !Array.isArray(sessions)) return;
        const sessionTableBody = document.querySelector('.session-table tbody, #sessions-table tbody');
        if (!sessionTableBody) return;

        sessionTableBody.innerHTML = ''; // Vider avant de remplir

        if (sessions.length === 0) {
             const cols = sessionTableBody.closest('table')?.querySelectorAll('thead th').length || 5;
             sessionTableBody.innerHTML = `<tr class="no-data-row"><td colspan="${cols}" class="text-center p-4 text-muted">Aucune session à afficher.</td></tr>`;
             return;
        }

        sessions.forEach(session => {
            const maxP = session.max_participants || 0;
            const placesR = session.places_restantes;
            let placesClass = 'text-secondary';
            let placesIcon = 'fa-question-circle';

            if (typeof placesR === 'number' && !isNaN(placesR)) {
                if (placesR <= 0) { placesClass = 'text-danger'; placesIcon = 'fa-times-circle'; }
                else if (placesR <= Math.floor(maxP * 0.3)) { placesClass = 'text-warning'; placesIcon = 'fa-exclamation-triangle'; }
                else { placesClass = 'text-success'; placesIcon = 'fa-check-circle'; }
            }

            const rowHtml = `
                <tr class="session-row" data-session-id="${session.id}" data-theme="${session.theme || 'N/A'}" data-full="${placesR <= 0 ? '1' : '0'}">
                    <td>
                        <span class="fw-bold d-block">${session.date || 'N/A'}</span>
                        <small class="text-secondary">${session.horaire || 'N/A'}</small>
                    </td>
                    <td class="theme-cell">
                        <span class="theme-badge" data-theme="${session.theme || 'N/A'}"
                              title="${window.themesDataForChart?.[session.theme]?.description || ''}"
                              data-bs-toggle="tooltip" data-bs-placement="top">
                            ${session.theme || 'N/A'}
                        </span>
                    </td>
                    <td class="places-dispo text-nowrap ${placesClass}">
                        <i class="fas ${placesIcon} me-1"></i> ${placesR} / ${maxP}
                    </td>
                    <td class="js-salle-cell">
                        ${session.salle || 'Non définie'}
                    </td>
                    <td class="text-nowrap text-center">
                        <button type="button" class="btn btn-sm btn-outline-secondary me-1"
                                data-bs-toggle="modal" data-bs-target="#participantsModal_${session.id}"
                                title="Voir les participants" data-bs-placement="top">
                            <i class="fas fa-users"></i> <span class="badge bg-secondary ms-1">${session.inscrits || 0}</span>
                        </button>
                        <button type="button" class="btn btn-sm btn-primary"
                                data-bs-toggle="modal" data-bs-target="#inscriptionModal_${session.id}"
                                title="Inscrire un participant" data-bs-placement="top">
                            <i class="fas fa-plus"></i>
                        </button>
                    </td>
                </tr>`;
            sessionTableBody.insertAdjacentHTML('beforeend', rowHtml);
        });
         enhanceBadgesAndLabels();
         initTooltips();
    }

    function updateStatisticsCounters(sessions) {
         let stats = { totalInscriptions: 0, totalEnAttente: 0, totalSessions: 0, totalSessionsCompletes: 0 };
        if (!sessions || !Array.isArray(sessions)) {
            updateCounter('total-inscriptions', stats.totalInscriptions);
            updateCounter('total-en-attente', stats.totalEnAttente);
            updateCounter('total-sessions', stats.totalSessions);
            updateCounter('total-sessions-completes', stats.totalSessionsCompletes);
            return stats;
        }

        stats.totalSessions = sessions.length;
        sessions.forEach(session => {
            stats.totalInscriptions += (session.inscrits || 0);
            stats.totalEnAttente += (session.liste_attente || 0);
            if (session.places_restantes <= 0)
                stats.totalSessionsCompletes++;
        });

        updateCounter('total-inscriptions', stats.totalInscriptions);
        updateCounter('total-en-attente', stats.totalEnAttente);
        updateCounter('total-sessions', stats.totalSessions);
        updateCounter('total-sessions-completes', stats.totalSessionsCompletes);
        return stats;
    }

    function updateCounter(elementId, newValue) {
         const element = document.getElementById(elementId);
        if (!element) return;

        const currentValue = parseInt(element.textContent.replace(/[^\d]/g, '')) || 0;
        if (currentValue !== newValue || element.textContent === '—') {
            element.textContent = newValue.toLocaleString();
            element.classList.remove('text-muted');
            element.classList.add('updated');
            setTimeout(() => element.classList.remove('updated'), 500);
        }
    }

    function updateActivityFeed(activities) {
         if (activities === null) {
            fetch(`${config.baseApiUrl}/activites?limit=5`)
                .then(response => {
                    if (!response.ok) throw new Error(`API Error: ${response.status}`);
                    return response.json();
                })
                .then(data => {
                    updateActivityFeed(data);
                })
                .catch(error => {
                    console.error("Error fetching activities:", error);
                    const container = document.getElementById('recent-activity');
                    if (container) container.innerHTML = '<div class="list-group-item text-center p-3 text-danger"><i class="fas fa-exclamation-triangle me-1"></i> Erreur de chargement des activités.</div>';
                });
            return Promise.reject("Fetching activities");
        }

        if (!activities || !Array.isArray(activities)) return Promise.resolve(false);

        const container = document.getElementById('recent-activity');
        if (!container) return Promise.resolve(false);

        const spinner = container.querySelector('.loading-spinner');
        if (spinner) spinner.remove();

        if (activities.length === 0) {
            container.innerHTML = '<div class="list-group-item text-center p-3 text-muted">Aucune activité récente</div>';
            return Promise.resolve(true);
        }

        let html = '';
        activities.forEach(activity => {
            const icon = getActivityIcon(activity.type);
            const userInfo = activity.user ? `<span class="text-primary fw-bold">${activity.user}</span>` : '';
            html += `<a href="#" class="list-group-item list-group-item-action activity-item type-${activity.type || 'default'}" data-activity-id="${activity.id}">
                        <div class="d-flex w-100 justify-content-between">
                            <h6 class="mb-1 activity-title"><i class="${icon} me-2"></i>${activity.description || 'Activité'} ${userInfo}</h6>
                            <small class="text-muted activity-time">${activity.date_relative || ''}</small>
                        </div>
                        ${activity.details ? `<p class="mb-1 activity-details"><small>${activity.details}</small></p>` : ''}
                    </a>`;
        });

        container.innerHTML = html;
        return Promise.resolve(true);
    }

    function getActivityIcon(type) {
         const iconMap = {
            'connexion': 'fas fa-sign-in-alt text-success',
            'deconnexion': 'fas fa-sign-out-alt text-warning',
            'inscription': 'fas fa-user-plus text-primary',
            'validation': 'fas fa-check-circle text-success',
            'refus': 'fas fa-times-circle text-danger',
            'annulation': 'fas fa-ban text-danger',
            'ajout_participant': 'fas fa-user-plus text-primary',
            'suppression_participant': 'fas fa-user-minus text-danger',
            'modification_participant': 'fas fa-user-edit text-warning',
            'reinscription': 'fas fa-redo text-info',
            'liste_attente': 'fas fa-clock text-warning',
            'ajout_theme': 'fas fa-folder-plus text-primary',
            'ajout_service': 'fas fa-building text-primary',
            'ajout_salle': 'fas fa-door-open text-primary',
            'attribution_salle': 'fas fa-map-marker-alt text-info',
            'systeme': 'fas fa-cog text-secondary',
            'notification': 'fas fa-bell text-warning',
            'telecharger_invitation': 'fas fa-file-download text-info',
            'default': 'fas fa-info-circle text-secondary'
        };
        return iconMap[type] || iconMap.default;
    }

    // ====== AMÉLIORATION ET CORRECTION UI ======
    // ... (enhanceUI, initTooltips, enhanceBadgesAndLabels, fixDataIssues, checkAndFixHangingModals, enhanceAccessibility, showErrorWarning, setupValidationListeners identiques) ...
     function enhanceUI() {
         initTooltips();
        enhanceBadgesAndLabels();
        fixDataIssues();
        enhanceAccessibility();
    }

    function initTooltips() {
         if (typeof bootstrap === 'undefined' || typeof bootstrap.Tooltip !== 'function') return;
        const existingTooltips = document.querySelectorAll('.tooltip');
        existingTooltips.forEach(tt => tt.remove());
        const tooltipTriggerList = document.querySelectorAll('[data-bs-toggle="tooltip"], [title]:not(iframe):not(script):not(style)');
        [...tooltipTriggerList].map(tooltipTriggerEl => {
             const existingInstance = bootstrap.Tooltip.getInstance(tooltipTriggerEl);
             if (existingInstance) { existingInstance.dispose(); }
             try { return new bootstrap.Tooltip(tooltipTriggerEl, { container: 'body', boundary: document.body }); }
             catch (e) { if (config.debugMode) console.warn('Tooltip Error:', e, tooltipTriggerEl); return null; }
        });
    }

    function enhanceBadgesAndLabels() {
         if (typeof window.enhanceThemeBadgesGlobally === 'function') {
            window.enhanceThemeBadgesGlobally();
        } else {
            document.querySelectorAll('.theme-badge').forEach(badge => {
                if (badge.dataset.enhanced === 'true') return;
                const themeName = badge.dataset.theme || badge.textContent.trim();
                badge.textContent = themeName;
                badge.classList.remove('theme-comm', 'theme-planner', 'theme-onedrive', 'theme-sharepoint');

                if (themeName.includes('Teams') && themeName.includes('Communiquer')) badge.classList.add('theme-comm');
                else if (themeName.includes('Planner')) badge.classList.add('theme-planner');
                else if (themeName.includes('OneDrive') || themeName.includes('fichiers')) badge.classList.add('theme-onedrive');
                else if (themeName.includes('Collaborer')) badge.classList.add('theme-sharepoint');

                if (!badge.querySelector('i.fas')) {
                     let iconClass = '';
                     if (themeName.includes('Teams') && themeName.includes('Communiquer')) iconClass = 'fa-comments';
                     else if (themeName.includes('Planner')) iconClass = 'fa-tasks';
                     else if (themeName.includes('OneDrive') || themeName.includes('fichiers')) iconClass = 'fa-file-alt';
                     else if (themeName.includes('Collaborer')) iconClass = 'fa-users';
                     if (iconClass) badge.insertAdjacentHTML('afterbegin', `<i class="fas ${iconClass} me-1"></i>`);
                }
                badge.dataset.enhanced = 'true';
            });
        }

        document.querySelectorAll('.js-salle-cell').forEach(cell => {
            const textContent = cell.textContent.trim();
            if (!cell.querySelector('.salle-badge') && textContent) {
                if (textContent === 'Non définie' || textContent === 'N/A') cell.innerHTML = '<span class="badge bg-secondary salle-badge">Non définie</span>';
                else cell.innerHTML = `<span class="badge bg-info salle-badge">${textContent}</span>`;
            }
        });
    }

    function fixDataIssues() {
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
                    el.title = 'Données temporairement indisponibles';
                    return;
                }

                let icon, colorClass;
                if (available <= 0) { icon = 'fa-times-circle'; colorClass = 'text-danger'; }
                else if (available <= 0.2 * total) { icon = 'fa-exclamation-circle'; colorClass = 'text-danger'; }
                else if (available <= 0.4 * total) { icon = 'fa-exclamation-triangle'; colorClass = 'text-warning'; }
                else { icon = 'fa-check-circle'; colorClass = 'text-success'; }

                const currentIcon = el.querySelector('.fas');
                const needsUpdate = !currentIcon || !currentIcon.classList.contains(icon) || !el.classList.contains(colorClass);

                if (needsUpdate) {
                    el.classList.remove('text-success', 'text-warning', 'text-danger', 'text-secondary');
                    el.classList.add(colorClass);
                    el.innerHTML = `<i class="fas ${icon} me-1"></i> ${available} / ${total}`;
                }
            } else if (text === 'NaN / NaN' || text.includes('undefined') || text === '/ ' || text === ' / ' || text.includes('null') || text === '? / ?') {
                if (!el.innerHTML.includes('fa-question-circle')) {
                    el.classList.remove('text-success', 'text-warning', 'text-danger');
                    el.classList.add('text-secondary');
                    el.innerHTML = '<i class="fas fa-question-circle me-1"></i> ? / ?';
                    el.title = 'Données temporairement indisponibles';
                }
            }
        });

        document.querySelectorAll('.counter-value, .badge-count').forEach(counter => {
            const text = counter.textContent.trim();
            if (text === '' || text === 'undefined' || text === 'null' || text === 'NaN' || text === '—') {
                counter.textContent = '—';
                counter.classList.add('text-muted');
                counter.title = 'Valeur temporairement indisponible';
            }
        });

        document.querySelectorAll('table tbody').forEach(tbody => {
            if (!tbody.querySelector('tr') || (tbody.children.length === 1 && tbody.firstElementChild.classList.contains('no-data-row'))) {
                 if (!tbody.querySelector('tr.no-data-row')) {
                    const cols = tbody.closest('table')?.querySelectorAll('thead th').length || 5;
                    const emptyMessage = '<tr class="no-data-row"><td colspan="' + cols + '" class="text-center p-3 text-muted">' +
                        '<i class="fas fa-info-circle me-2"></i>Aucune donnée disponible pour le moment.' +
                        (typeof window.forcePollingUpdate === 'function' ?
                            '<button class="btn btn-sm btn-outline-secondary ms-3" onclick="window.forcePollingUpdate(true);">' +
                            '<i class="fas fa-sync me-1"></i>Actualiser</button>' : '') +
                        '</td></tr>';
                    tbody.innerHTML = emptyMessage;
                }
            } else if (tbody.querySelector('tr.no-data-row') && tbody.children.length > 1) {
                const noDataRow = tbody.querySelector('tr.no-data-row');
                if (noDataRow) noDataRow.remove();
            }
        });

        checkAndFixHangingModals();
    }

    function checkAndFixHangingModals() {
         const backdrop = document.querySelector('.modal-backdrop');
        const visibleModal = document.querySelector('.modal.show');

        if (backdrop && !visibleModal) {
            backdrop.remove();
            document.body.classList.remove('modal-open');
            document.body.style.overflow = '';
            document.body.style.paddingRight = '';
        }

        const visibleModals = document.querySelectorAll('.modal.show');
        if (visibleModals.length > 0 && !document.querySelector('.modal-backdrop')) {
            const newBackdrop = document.createElement('div');
            newBackdrop.className = 'modal-backdrop fade show';
            document.body.appendChild(newBackdrop);
            document.body.classList.add('modal-open');
        }
    }

    function enhanceAccessibility() {
         document.querySelectorAll('img:not([alt])').forEach(img => {
            const filename = img.src.split('/').pop().split('?')[0];
            const name = filename.split('.')[0].replace(/[_-]/g, ' ');
            img.setAttribute('alt', name || 'Image');
        });

        document.querySelectorAll('button:not([type])').forEach(button => {
            button.setAttribute('type', button.closest('form') ? 'submit' : 'button');
        });
    }

    function showErrorWarning(show) {
         let errorDiv = document.getElementById('backend-error-warning');

        if (show && !errorDiv) {
            errorDiv = document.createElement('div');
            errorDiv.id = 'backend-error-warning';
            errorDiv.className = 'alert alert-warning alert-dismissible fade show small p-2 mt-2 mx-auto text-center';
            errorDiv.style.maxWidth = '800px';
            errorDiv.innerHTML = `<i class="fas fa-exclamation-triangle me-2"></i> Problème de communication avec le serveur. Le rafraîchissement automatique est en pause. Veuillez actualiser manuellement. <button type="button" class="btn-close p-2" data-bs-dismiss="alert" aria-label="Close"></button>`;

            const mainContentArea = document.querySelector('.container-fluid, #main-content, main');
            if (mainContentArea) {
                mainContentArea.insertBefore(errorDiv, mainContentArea.firstChild);
            } else {
                document.body.insertBefore(errorDiv, document.body.firstChild);
            }
        } else if (!show && errorDiv) {
            errorDiv.remove();
        }
    }

    function setupValidationListeners() {
        // ... (code identique) ...
         document.body.addEventListener('click', function(event) {
            const button = event.target.closest('.validation-ajax');
            if (!button) return;

            const inscriptionId = button.getAttribute('data-inscription-id');
            const action = button.getAttribute('data-action');

            if (!inscriptionId || !action) return;

            button.disabled = true;
            const originalText = button.innerHTML;
            button.innerHTML = '<span class="spinner-border spinner-border-sm" role="status" aria-hidden="true"></span>'; // Spinner seul

            fetch('/validation_inscription_ajax', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'X-CSRFToken': getCsrfToken() },
                body: JSON.stringify({ inscription_id: inscriptionId, action: action })
            })
            .then(response => response.json())
            .then(data => {
                if (data.success) {
                    if (typeof showToast === 'function') showToast(data.message, 'success');
                    debouncedFetchDashboardData(true);

                    setTimeout(() => {
                        const modal = button.closest('.modal');
                        if (modal && typeof bootstrap !== 'undefined') {
                            const modalInstance = bootstrap.Modal.getInstance(modal);
                            if (modalInstance) modalInstance.hide();
                        }
                    }, 1000);
                } else {
                    if (typeof showToast === 'function') showToast(data.message || 'Erreur lors de la validation', 'danger');
                }
            })
            .catch(error => {
                console.error('Validation AJAX error:', error);
                if (typeof showToast === 'function') showToast('Erreur de communication lors de la validation.', 'danger');
            })
            .finally(() => {
                const currentButton = document.querySelector(`.validation-ajax[data-inscription-id="${inscriptionId}"][data-action="${action}"]`);
                if(currentButton) {
                    currentButton.disabled = false;
                    currentButton.innerHTML = originalText;
                }
            });
        });
    }

    // ====== GRAPHIQUES ======
    function initializeCharts() {
        if (config.chartRendering === 'none') return;
        // Afficher les placeholders de chargement
        renderStaticCharts(null, null);
    }

    function updateCharts(sessions, participants) {
        if (config.chartRendering === 'none') return;
        // Toujours rendre les graphiques statiques avec les données reçues
        renderStaticCharts(sessions, participants);
    }

    function renderStaticCharts(sessions, participants) {
        // Rendre le graphique Thème si les données sessions sont valides
        if (sessions && Array.isArray(sessions)) {
            renderThemeDistributionChart(sessions);
        } else {
            const themeContainer = document.getElementById('themeChartStatic');
            if (themeContainer && !themeContainer.querySelector('.static-chart-donut')) {
                themeContainer.innerHTML = '<div class="no-data-message text-center p-3"><i class="fas fa-info-circle me-2"></i>Données des thèmes non disponibles.</div>';
            }
        }

        // Rendre le graphique Service si les données participants sont valides
        if (participants && Array.isArray(participants)) {
            renderParticipantByServiceChart(participants);
        } else {
             const serviceContainer = document.getElementById('serviceChartStatic');
             if (serviceContainer && !serviceContainer.querySelector('.static-chart-bars')) {
                 serviceContainer.innerHTML = '<div class="no-data-message text-center p-3"><i class="fas fa-info-circle me-2"></i>Données des participants non disponibles.</div>';
             }
        }
    }

    // CORRECTION: Calculer les inscriptions par thème
    function renderThemeDistributionChart(sessionsData) {
        const container = document.getElementById('themeChartStatic');
        if (!container) return;

        const themeInscriptionCounts = sessionsData.reduce((acc, session) => {
            const themeName = session.theme || 'Non défini';
            acc[themeName] = (acc[themeName] || 0) + (session.inscrits || 0); // *** SOMME DES INSCRITS ***
            return acc;
        }, {});

        const totalInscriptions = Object.values(themeInscriptionCounts).reduce((sum, count) => sum + count, 0); // *** TOTAL INSCRIPTIONS ***

        if (totalInscriptions === 0) {
            container.innerHTML = '<div class="no-data-message text-center p-3"><i class="fas fa-info-circle me-2"></i>Aucune inscription confirmée pour afficher la répartition par thème.</div>';
            return;
        }

        let legendHtml = '';
        const themeColors = window.themesDataForChart || {};
        const sortedThemes = Object.entries(themeInscriptionCounts).sort(([, countA], [, countB]) => countB - countA);

        sortedThemes.forEach(([theme, count], index) => {
            if (count === 0) return;
            const themeInfo = themeColors[theme] || {};
            const color = themeInfo.color || getRandomColor(index);

            legendHtml += `
                <div class="legend-item" title="${themeInfo.description || theme}">
                    <span class="legend-color" style="background-color: ${color};"></span>
                    <span class="legend-label">${theme}</span>
                    <span class="legend-value">${count}</span>
                </div>`;
        });

        container.innerHTML = `
            <div class="static-chart-title">Inscriptions par Thème</div>
            <div class="static-chart-donut">
                 <div class="donut-center">
                    <div class="donut-total">${totalInscriptions}</div> {# *** AFFICHE TOTAL INSCRIPTIONS *** #}
                    <div class="donut-label">Inscrits</div>
                </div>
                {# Le visuel donut reste simplifié #}
            </div>
            <div class="static-chart-legend">${legendHtml}</div>`;
    }

    // CORRECTION: Implémentation complète du graphique par service
    function renderParticipantByServiceChart(participantsData) {
         const container = document.getElementById('serviceChartStatic');
        if (!container) return;

        if (!participantsData || !Array.isArray(participantsData)) {
             container.innerHTML = '<div class="no-data-message text-center p-3"><i class="fas fa-exclamation-triangle me-2"></i>Données participants invalides reçues.</div>';
             console.error("RenderServiceChart: Invalid participantsData received", participantsData);
             return;
        }

        const serviceCounts = participantsData.reduce((acc, participant) => {
            const serviceName = participant.service || 'Non défini';
            const serviceColor = participant.service_color || (window.servicesDataForChart?.[serviceName]?.color) || '#6c757d';
            if (!acc[serviceName]) {
                acc[serviceName] = { count: 0, color: serviceColor };
            }
            acc[serviceName].count++;
            return acc;
        }, {});

        const totalParticipants = participantsData.length;

        if (totalParticipants === 0) {
            container.innerHTML = '<div class="no-data-message text-center p-3"><i class="fas fa-info-circle me-2"></i>Aucun participant trouvé pour afficher la distribution par service.</div>';
            return;
        }

        const sortedServices = Object.entries(serviceCounts).sort(([, dataA], [, dataB]) => dataB.count - dataA.count);
        let barsHtml = '';
        const maxCount = Math.max(1, ...sortedServices.map(([, data]) => data.count));

        sortedServices.forEach(([service, data], index) => {
            if (data.count === 0) return;
            const percentage = (data.count / maxCount) * 100;
            const serviceClass = service.toLowerCase().replace(/[^a-z0-9]/g, '-') || 'non-defini';

            barsHtml += `
                <div class="bar-item animate" style="--index: ${index};">
                    <div class="bar-header">
                        <span class="bar-label" title="${service} (${data.count} participant(s))">
                           <span class="service-badge me-2" style="background-color: ${data.color};"></span>
                           ${service}
                        </span>
                        <span class="bar-total">${data.count}</span>
                    </div>
                    <div class="bar-container">
                        <div class="bar-value ${serviceClass}" style="width: ${percentage}%; background-color: ${data.color}; --percent: ${percentage}%;">
                        </div>
                    </div>
                </div>
            `;
        });

        container.innerHTML = `
            <div class="static-chart-title">Distribution par Service</div>
            <div class="static-chart-bars">${barsHtml}</div>`;
    }


    // ====== UTILITAIRES ======
    function simpleHash(obj) {
        // ... (code identique) ...
         const str = JSON.stringify(obj);
        let hash = 0;
        if (str.length === 0) return hash;
        for (let i = 0; i < str.length; i++) {
            const char = str.charCodeAt(i);
            hash = ((hash << 5) - hash) + char;
            hash |= 0; // Convert to 32bit integer
        }
        return hash;
    }

    function getCsrfToken() {
        // ... (code identique) ...
         const meta = document.querySelector('meta[name="csrf-token"]');
        if (meta) return meta.content;
        const input = document.querySelector('input[name="csrf_token"]');
        if (input) return input.value;
        return '';
    }

    function getRandomColor(index) {
        // ... (code identique) ...
         const colors = ['#4e73df', '#1cc88a', '#36b9cc', '#f6c23e', '#e74a3b', '#858796', '#5a5c69', '#fd7e14', '#6f42c1', '#d63384'];
        return colors[index % colors.length];
    }

    // Exposer des fonctions si nécessaire
    window.dashboardCore = {
        initialize: initializeDashboard,
        fetchData: debouncedFetchDashboardData,
        updateCharts: updateCharts,
        updateStatistics: updateStatisticsCounters,
        updateActivity: updateActivityFeed,
        getState: () => dashboardState,
        getConfig: () => config,
        renderThemeChart: renderThemeDistributionChart,
        renderServiceChart: renderParticipantByServiceChart,
        initializeCharts: initializeCharts,
        startPolling: startPolling,
        stopPolling: () => {
             dashboardState.pollingActive = false;
             if(dashboardState.pollingTimeout) clearTimeout(dashboardState.pollingTimeout);
             dashboardState.pollingTimeoutScheduled = false;
             if(config.debugMode) console.log("Dashboard Core: Polling stopped manually.");
        }
    };

    // Démarrer le tableau de bord
    initializeDashboard();
});

// Fonction showToast globale (si non définie ailleurs)
if (typeof window.showToast !== 'function') {
    window.showToast = function(message, type = 'info', duration = 5000) {
        // ... (code identique) ...
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
        const textClass = (bgType === 'light') ? 'text-dark' : 'text-white';

        toastElement.className = `toast align-items-center ${textClass} bg-${bgType} border-0 fade`;
        toastElement.setAttribute('role', 'alert');
        toastElement.setAttribute('aria-live', 'assertive');
        toastElement.setAttribute('aria-atomic', 'true');

        toastElement.innerHTML = `
            <div class="d-flex">
                <div class="toast-body">
                    ${message}
                </div>
                <button type="button" class="btn-close ${textClass === 'text-white' ? 'btn-close-white' : ''} me-2 m-auto" data-bs-dismiss="toast" aria-label="Close"></button>
            </div>
        `;
        toastContainer.appendChild(toastElement);

        const bsToast = new bootstrap.Toast(toastElement, { delay: duration, autohide: true });
        bsToast.show();
        toastElement.addEventListener('hidden.bs.toast', () => {
            toastElement.remove();
        });
    };
}
