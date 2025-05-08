/**
 * dashboard-core.js - Fichier JavaScript optimisé pour le tableau de bord
 * Remplace: polling-updates.js, ui-fixers.js, charts-enhanced.js, static-charts.js
 * Version: 1.4.0 - Intégration des correctifs de chargement et robustesse API
 */

document.addEventListener('DOMContentLoaded', function() {
    console.log('Dashboard Core: Initializing (v1.4.0)');
    
    if (window.dashboardCoreInitialized) {
        console.log('Dashboard Core: Already initialized. Skipping.');
        return;
    }
    window.dashboardCoreInitialized = true;

    const globalLoadingOverlay = document.getElementById('loading-overlay'); // Référence au spinner global

    const dashInitConfig = window.dashboardConfig || {};
    
    const config = {
        debugMode: dashInitConfig.debugMode || false,
        refreshInterval: dashInitConfig.autoRefreshInterval || 
                        (window.dashboardConfig && window.dashboardConfig.refreshInterval) || 
                        300000, 
        minRefreshDelay: (window.dashboardConfig && window.dashboardConfig.minRefreshDelay) || 60000,
        debounceDelay: (window.dashboardConfig && window.dashboardConfig.debounceDelay) || 1500,
        baseApiUrl: (window.dashboardConfig && window.dashboardConfig.baseApiUrl) || '/api',
        chartRendering: (window.dashboardConfig && window.dashboardConfig.chartRendering) || 'auto',
        usingDashboardInit: !!dashInitConfig.autoRefreshInterval || !!dashInitConfig.preferredMode,
        socketEnabled: dashInitConfig.socketEnabled !== undefined ? dashInitConfig.socketEnabled : true,
        pollingEnabled: dashInitConfig.pollingEnabled !== undefined ? dashInitConfig.pollingEnabled : true,
        preferredMode: dashInitConfig.preferredMode || 'polling',
        errorThrottleMode: false
    };
    
    if (config.debugMode) console.log(`Dashboard Core: Configured with refreshInterval=${config.refreshInterval}ms, debounceDelay=${config.debounceDelay}ms, usingDashboardInit=${config.usingDashboardInit}`);

    let dashboardState = {
        lastRefresh: 0,
        updating: false,
        dataHashes: {},
        errorCount: 0,
        maxErrors: 5,
        pollingActive: true,
        pollingInterval: null, // Sera géré par scheduleNextPoll
        pollingTimeout: null,  // Timeout pour scheduleNextPoll
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
        
        if (!config.usingDashboardInit) {
            setupEventListeners();
            initializeCharts();
            debouncedFetchDashboardData(true); // Fetch initial forcé
            startPolling();
        } else {
            window.forcePollingUpdate = (forceRefresh) => debouncedFetchDashboardData(forceRefresh);
            window.updateStatsCounters = updateStatisticsCounters;
            window.refreshRecentActivity = () => updateActivityFeed(null);
            window.chartModule = { initialize: () => initializeCharts() };
            debouncedFetchDashboardData(true); // Fetch initial même si dashboard-init est utilisé
        }
        
        if (config.debugMode) console.log('Dashboard Core: Initialization complete.');
    }

    function startPolling() {
        if (config.usingDashboardInit && config.preferredMode !== 'polling') { // Respecter la config de dashboard-init
            if (config.debugMode) console.log("Dashboard Core: Polling not started by dashboard-core as dashboard-init is managing it or preferredMode is not polling.");
            return;
        }
        
        if (dashboardState.pollingTimeout) clearTimeout(dashboardState.pollingTimeout);
        
        function scheduleNextPoll() {
            // Si un timeout est déjà programmé, ne rien faire
            if (dashboardState.pollingTimeoutScheduled) return;
            dashboardState.pollingTimeoutScheduled = true;

            dashboardState.pollingTimeout = setTimeout(async () => {
                dashboardState.pollingTimeoutScheduled = false; // Réinitialiser pour la prochaine planification
                if (dashboardState.pollingActive && document.visibilityState === 'visible' && !dashboardState.updating) {
                    try {
                        await debouncedFetchDashboardData(false, true); // Non forcé, mode léger pour le polling
                    } catch (err) {
                        console.error("Dashboard Core: Error during scheduled poll:", err);
                    } finally {
                        if (dashboardState.pollingActive) { // Re-planifier seulement si toujours actif
                            scheduleNextPoll();
                        }
                    }
                } else {
                    if (dashboardState.pollingActive) { // Re-planifier même si conditions non remplies pour le moment
                         scheduleNextPoll();
                    }
                }
            }, config.refreshInterval);
        }
        
        scheduleNextPoll();
        if (config.debugMode) console.log(`Dashboard Core: Polling started (interval: ${config.refreshInterval}ms)`);
    }

    function setupEventListeners() {
        if (config.usingDashboardInit) {
            if (config.debugMode) console.log("Dashboard Core: Skipping event listener setup (dashboard-init manages it).");
            return;
        }
        
        document.addEventListener('visibilitychange', () => {
            if (document.visibilityState === 'visible' && dashboardState.pollingActive) {
                if (config.debugMode) console.log('Dashboard Core: Tab visible, triggering refresh');
                debouncedFetchDashboardData(false, true); // Non forcé, mode léger
            }
        });

        const refreshButton = document.getElementById('refresh-dashboard');
        if (refreshButton) {
            refreshButton.addEventListener('click', function() {
                this.disabled = true;
                this.innerHTML = '<i class="fas fa-sync-alt fa-spin me-1"></i>Actualisation...';
                if (globalLoadingOverlay) globalLoadingOverlay.style.display = 'flex';

                debouncedFetchDashboardData(true) // Forcer l'actualisation
                    .then((updated) => {
                        if (typeof showToast === 'function') {
                            if (updated) showToast('Données actualisées avec succès', 'success');
                            else showToast('Aucune nouvelle donnée détectée ou erreur lors de l\'actualisation.', 'info');
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
                        this.disabled = false;
                        this.innerHTML = '<i class="fas fa-sync-alt me-1"></i>Actualiser';
                        if (globalLoadingOverlay && !dashboardState.updating) globalLoadingOverlay.style.display = 'none';
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
        if (dashboardState.updating && !forceRefresh) { // Permettre le forçage même si updating est true
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
        // Ne mettez à jour lastRefresh que si le fetch est réellement effectué (pas seulement pour forcer)
        if (!forceRefresh || (forceRefresh && now - dashboardState.lastRefresh >= config.minRefreshDelay)) {
             dashboardState.lastRefresh = now;
        }
        
        let updateSucceeded = false;
        let currentUrl = ''; 
    
        if (globalLoadingOverlay && (forceRefresh || !lightMode)) {
            globalLoadingOverlay.style.display = 'flex';
        }
    
        try {
            currentUrl = lightMode ? 
                `${config.baseApiUrl}/dashboard_essential?light=1&_=${Date.now()}` : 
                `${config.baseApiUrl}/dashboard_essential?_=${Date.now()}`;
                
            if (config.debugMode) console.log(`Dashboard Core: Fetching data from ${currentUrl}${lightMode ? ' (light mode)' : ''}`);
            
            const controller = new AbortController();
            const timeoutId = setTimeout(() => {
                controller.abort();
                if (config.debugMode) console.warn(`Dashboard Core: Fetch to ${currentUrl} timed out after 15s.`);
            }, 15000); 
            
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
                dashboardState.pollingTimeoutScheduled = false; // S'assurer que le polling ne se relance pas
                showErrorWarning(true);
            }
            return false; 
        } finally {
            dashboardState.updating = false;
            if (globalLoadingOverlay && (forceRefresh || !lightMode)) {
                // Masquer le spinner seulement si aucune autre mise à jour n'est en cours
                // et si le spinner était pour ce fetch spécifique.
                setTimeout(() => {
                    if (!dashboardState.updating) { // Vérifier à nouveau avant de masquer
                         globalLoadingOverlay.style.display = 'none';
                    }
                }, 200); // Augmenter légèrement le délai pour la robustesse
            }
            if (config.debugMode) console.log('Dashboard Core: Fetch cycle finished.');
        }
    }
    
    function debouncedFetchDashboardData(forceRefresh = false, lightModeForDebounce = false) {
        if (forceRefresh) {
            if (dashboardState.fetchTimeoutId) {
                clearTimeout(dashboardState.fetchTimeoutId);
                dashboardState.fetchTimeoutId = null;
            }
            if (config.debugMode) console.log("Dashboard Core: Debounced fetch triggered (forced)");
            return _fetchDashboardData(true, false); // Forcer et non light mode
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
                    // Utiliser lightModeForDebounce pour les appels debounced non forcés
                    const result = await _fetchDashboardData(false, lightModeForDebounce); 
                    resolve(result);
                } catch (error) {
                    console.error("Dashboard Core: Error in debounced fetch execution:", error);
                    resolve(false); 
                }
            }, config.debounceDelay);
        });
    }

    function processData(data, forceRefresh = false) {
        if (!data) return false; 
        let hasChanged = forceRefresh;
        
        if (data.sessions && Array.isArray(data.sessions)) { 
            const validatedSessions = data.sessions.map(s => { 
                if (typeof s.places_restantes !== 'number' || isNaN(s.places_restantes)) 
                    s.places_restantes = Math.max(0, (s.max_participants || 0) - (s.inscrits || 0)); 
                return s; 
            }); 
            const sessionsHash = simpleHash(validatedSessions); 
            if (forceRefresh || sessionsHash !== dashboardState.dataHashes.sessions) { 
                updateSessionTable(validatedSessions); 
                updateCharts(validatedSessions, data.participants || []); 
                updateStatisticsCounters(validatedSessions); 
                dashboardState.dataHashes.sessions = sessionsHash; 
                hasChanged = true; 
            } 
        }
        
        if (data.activites && Array.isArray(data.activites)) { 
            const activitiesHash = simpleHash(data.activites); 
            if (forceRefresh || activitiesHash !== dashboardState.dataHashes.activites) { 
                updateActivityFeed(data.activites); 
                dashboardState.dataHashes.activites = activitiesHash; 
                hasChanged = true; 
            } 
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
    function updateSessionTable(sessions) {
        if (!sessions || !Array.isArray(sessions)) return; 
        const sessionTableBody = document.querySelector('.session-table tbody'); 
        if (!sessionTableBody) return; 
        
        sessions.forEach(session => { 
            const row = sessionTableBody.querySelector(`tr[data-session-id="${session.id}"]`); 
            if (!row) return; 
            
            const placesCell = row.querySelector('.places-dispo'); 
            if (placesCell) { 
                const maxP = session.max_participants || 0; 
                const placesR = session.places_restantes; 
                placesCell.textContent = `${placesR} / ${maxP}`; 
                placesCell.classList.remove('text-success', 'text-warning', 'text-danger', 'text-secondary'); 
                
                if (typeof placesR !== 'number' || isNaN(placesR)) { 
                    placesCell.classList.add('text-secondary'); 
                    placesCell.innerHTML = '<i class="fas fa-question-circle me-1"></i> ? / ?'; 
                } else if (placesR <= 0) 
                    placesCell.classList.add('text-danger'); 
                else if (placesR <= Math.floor(maxP * 0.3)) 
                    placesCell.classList.add('text-warning'); 
                else 
                    placesCell.classList.add('text-success'); 
            } 
            
            const participantsBadge = row.querySelector('.btn-outline-secondary .badge'); 
            if (participantsBadge) 
                participantsBadge.textContent = session.inscrits || 0; 
            
            row.dataset.full = (session.places_restantes <= 0) ? '1' : '0'; 
        });
    }
    
    function updateStatisticsCounters(sessions) {
        if (!sessions || !Array.isArray(sessions)) return {
            totalInscriptions: 0, totalEnAttente: 0, totalSessions: 0, totalSessionsCompletes: 0
        }; 
        
