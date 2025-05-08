/**
 * dashboard-core.js - Fichier JavaScript optimisé pour le tableau de bord
 * Remplace: polling-updates.js, ui-fixers.js, charts-enhanced.js, static-charts.js
 * Version: 1.4.1 - Intégration des correctifs de chargement et robustesse API
 */

document.addEventListener('DOMContentLoaded', function() {
    console.log('Dashboard Core: Initializing (v1.4.1)');
    
    if (window.dashboardCoreInitialized) {
        console.log('Dashboard Core: Already initialized. Skipping.');
        return;
    }
    window.dashboardCoreInitialized = true;

    const globalLoadingOverlay = document.getElementById('loading-overlay'); 

    const dashInitConfig = window.dashboardConfig || {};
    
    const config = {
        debugMode: dashInitConfig.debugMode || false,
        refreshInterval: dashInitConfig.autoRefreshInterval || 
                        (window.dashboardConfig && window.dashboardConfig.refreshInterval) || 
                        120000, // Intervalle de polling par défaut (2 minutes)
        minRefreshDelay: (window.dashboardConfig && window.dashboardConfig.minRefreshDelay) || 30000, // Délai minimum entre les fetchs (30s)
        debounceDelay: (window.dashboardConfig && window.dashboardConfig.debounceDelay) || 1000, // Délai pour debounce (1s)
        baseApiUrl: (window.dashboardConfig && window.dashboardConfig.baseApiUrl) || '/api',
        chartRendering: (window.dashboardConfig && window.dashboardConfig.chartRendering) || 'auto',
        usingDashboardInit: !!dashInitConfig.autoRefreshInterval || !!dashInitConfig.preferredMode,
        socketEnabled: dashInitConfig.socketEnabled !== undefined ? dashInitConfig.socketEnabled : true,
        pollingEnabled: dashInitConfig.pollingEnabled !== undefined ? dashInitConfig.pollingEnabled : true,
        preferredMode: dashInitConfig.preferredMode || 'polling',
        errorThrottleMode: false,
        fetchTimeoutDuration: 15000 // 15 secondes pour le timeout des requêtes fetch
    };
    
    if (config.debugMode) console.log(`Dashboard Core: Configured with refreshInterval=${config.refreshInterval}ms, debounceDelay=${config.debounceDelay}ms, usingDashboardInit=${config.usingDashboardInit}`);

    let dashboardState = {
        lastRefresh: 0,
        updating: false,
        dataHashes: {},
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
        
        if (!config.usingDashboardInit) {
            setupEventListeners();
            initializeCharts();
            debouncedFetchDashboardData(true); 
            startPolling();
        } else {
            window.forcePollingUpdate = (forceRefresh) => debouncedFetchDashboardData(forceRefresh);
            window.updateStatsCounters = updateStatisticsCounters;
            window.refreshRecentActivity = () => updateActivityFeed(null);
            window.chartModule = { initialize: () => initializeCharts() };
            debouncedFetchDashboardData(true); 
        }
        
        if (config.debugMode) console.log('Dashboard Core: Initialization complete.');
    }

    function startPolling() {
        if (config.usingDashboardInit && config.preferredMode !== 'polling') { 
            if (config.debugMode) console.log("Dashboard Core: Polling not started by dashboard-core as dashboard-init is managing it or preferredMode is not polling.");
            return;
        }
        
        if (dashboardState.pollingTimeout) clearTimeout(dashboardState.pollingTimeout);
        dashboardState.pollingTimeoutScheduled = false; // S'assurer qu'il est réinitialisé
        
        function scheduleNextPoll() {
            if (dashboardState.pollingTimeoutScheduled) return;
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
        if (config.usingDashboardInit) {
            if (config.debugMode) console.log("Dashboard Core: Skipping event listener setup (dashboard-init manages it).");
            return;
        }
        
        document.addEventListener('visibilitychange', () => {
            if (document.visibilityState === 'visible' && dashboardState.pollingActive) {
                if (config.debugMode) console.log('Dashboard Core: Tab visible, triggering refresh');
                debouncedFetchDashboardData(false, true); 
            } else if (document.visibilityState === 'hidden') {
                // Optionnel: Annuler le timeout de polling si la page devient invisible pour économiser ressources
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
                            if (updated) showToast('Données actualisées avec succès', 'success');
                            else showToast('Aucune nouvelle donnée ou erreur lors de l\'actualisation.', 'info');
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
        }
    
        try {
            currentUrl = lightMode ? 
                `${config.baseApiUrl}/dashboard_essential?light=1&_=${Date.now()}` : 
                `${config.baseApiUrl}/dashboard_essential?_=${Date.now()}`;
                
            if (config.debugMode) console.log(`Dashboard Core: Fetching data from ${currentUrl}${lightMode ? ' (light mode)' : ''}`);
            
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
            return false; 
        } finally {
            dashboardState.updating = false;
            if (globalLoadingOverlay && (forceRefresh || !lightMode)) {
                setTimeout(() => {
                    if (!dashboardState.updating) { 
                         globalLoadingOverlay.style.display = 'none';
                    }
                }, 200); 
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
        const sessionTableBody = document.querySelector('.session-table tbody, #sessions-table tbody'); 
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
            
            const participantsBadge = row.querySelector('.btn-outline-secondary .badge, .participants-count .badge'); 
            if (participantsBadge) 
                participantsBadge.textContent = session.inscrits || 0; 
            
            row.dataset.full = (session.places_restantes <= 0) ? '1' : '0'; 
        });
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
        if (currentValue !== newValue || element.textContent === '—') { // Mettre à jour si la valeur est '—'
            element.textContent = newValue.toLocaleString(); 
            element.classList.remove('text-muted'); // Retirer la classe muted si elle était là
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
                    if (container) container.innerHTML = '<div class="text-center p-3 text-danger"><i class="fas fa-exclamation-triangle me-1"></i> Erreur de chargement des activités.</div>';
                });
            return;
        }
        
        if (!activities || !Array.isArray(activities)) return; 
        
        const container = document.getElementById('recent-activity'); 
        if (!container) return; 
        
        const spinner = container.querySelector('.loading-spinner'); 
        if (spinner) spinner.remove(); 
        
        if (activities.length === 0) { 
            container.innerHTML = '<div class="text-center p-3 text-muted">Aucune activité récente</div>'; 
            return; 
        } 
        
        let html = ''; 
        activities.forEach(activity => { 
            const icon = getActivityIcon(activity.type); 
            const userInfo = activity.user ? `<span class="text-primary">${activity.user}</span>` : ''; 
            html += `<div class="activity-item fade-in" data-activity-id="${activity.id}">
                        <div class="activity-icon"><i class="${icon}"></i></div>
                        <div class="activity-content">
                            <div class="activity-title">${activity.description || 'Activité'} ${userInfo}</div>
                            <div class="activity-subtitle">
                                ${activity.details ? `<small>${activity.details}</small><br>` : ''}
                                <small class="text-muted">${activity.date_relative || ''}</small>
                            </div>
                        </div>
                    </div>`; 
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
            'default': 'fas fa-info-circle text-secondary' 
        }; 
        return iconMap[type] || iconMap.default;
    }

    // ====== AMÉLIORATION ET CORRECTION UI ======
    function enhanceUI() { 
        initTooltips(); 
        enhanceBadgesAndLabels(); 
        fixDataIssues(); 
        enhanceAccessibility(); 
    }
    
    function initTooltips() { 
        if (typeof bootstrap === 'undefined' || typeof bootstrap.Tooltip !== 'function') return; 
        
        const tooltipTriggerList = document.querySelectorAll('[data-bs-toggle="tooltip"], [title]:not(iframe):not(script):not(style)'); 
        tooltipTriggerList.forEach(el => { 
            if (!bootstrap.Tooltip.getInstance(el)) { 
                try { 
                    new bootstrap.Tooltip(el, { container: 'body', boundary: document.body }); 
                } catch (e) { 
                    if (config.debugMode) console.warn('Dashboard Core: Error creating tooltip', e); 
                } 
            } 
        }); 
    }
    
    function enhanceBadgesAndLabels() { 
        if (typeof window.enhanceThemeBadgesGlobally === 'function') { 
            window.enhanceThemeBadgesGlobally(); 
        } else { 
            document.querySelectorAll('.theme-badge').forEach(badge => { 
                if (badge.dataset.enhanced === 'true') return; 
                const themeName = badge.textContent.trim(); 
                if (themeName.includes('Teams') && themeName.includes('Communiquer')) 
                    badge.classList.add('theme-comm'); 
                else if (themeName.includes('Planner')) 
                    badge.classList.add('theme-planner'); 
                else if (themeName.includes('OneDrive') || themeName.includes('fichiers')) 
                    badge.classList.add('theme-onedrive'); 
                else if (themeName.includes('Collaborer')) 
                    badge.classList.add('theme-sharepoint'); 
                badge.dataset.enhanced = 'true'; 
            }); 
        } 
        
        document.querySelectorAll('.js-salle-cell').forEach(cell => { 
            const textContent = cell.textContent.trim(); 
            if (!cell.querySelector('.salle-badge') && textContent) { 
                if (textContent === 'Non définie' || textContent === 'N/A') 
                    cell.innerHTML = '<span class="badge bg-secondary salle-badge">Non définie</span>'; 
                else 
                    cell.innerHTML = `<span class="badge bg-info salle-badge">${textContent}</span>`; 
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
                if (available <= 0) { 
                    icon = 'fa-times-circle'; 
                    colorClass = 'text-danger'; 
                } else if (available <= 0.2 * total) { 
                    icon = 'fa-exclamation-circle'; 
                    colorClass = 'text-danger'; 
                } else if (available <= 0.4 * total) { 
                    icon = 'fa-exclamation-triangle'; 
                    colorClass = 'text-warning'; 
                } else { 
                    icon = 'fa-check-circle'; 
                    colorClass = 'text-success'; 
                } 
                
                if (!el.querySelector('.fas') || !el.classList.contains(colorClass)) { 
                    el.classList.remove('text-success', 'text-warning', 'text-danger', 'text-secondary'); 
                    el.classList.add(colorClass); 
                    el.innerHTML = `<i class="fas ${icon} me-1"></i> ${available} / ${total}`; 
                } 
            } else if (text === 'NaN / NaN' || text.includes('undefined') || text === '/ ' || text === ' / ' || text.includes('null')) { 
                el.classList.remove('text-success', 'text-warning', 'text-danger'); 
                el.classList.add('text-secondary'); 
                el.innerHTML = '<i class="fas fa-question-circle me-1"></i> ? / ?'; 
                el.title = 'Données temporairement indisponibles'; 
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
            if (!tbody.querySelector('tr') || (tbody.children.length === 1 && tbody.firstElementChild.textContent.includes("Aucune donnée disponible"))) {
                // Si tbody est vide ou contient seulement le message "Aucune donnée"
                // Ne rien faire si le message est déjà là, sinon l'ajouter.
                if (!tbody.querySelector('tr.no-data-row')) { // Ajouter une classe pour identifier ce message
                    const cols = tbody.closest('table').querySelectorAll('thead th').length || 3;
                    const emptyMessage = '<tr class="no-data-row"><td colspan="' + cols + '" class="text-center p-3 text-muted">' +
                        '<i class="fas fa-info-circle me-2"></i>Aucune donnée disponible pour le moment.' +
                        (typeof window.forcePollingUpdate === 'function' ? 
                            '<button class="btn btn-sm btn-outline-secondary ms-3" onclick="window.forcePollingUpdate(true);">' +
                            '<i class="fas fa-sync me-1"></i>Actualiser</button>' : '') +
                        '</td></tr>';
                    tbody.innerHTML = emptyMessage;
                }
            } else if (tbody.querySelector('tr.no-data-row') && tbody.children.length > 1) {
                // Si le message "Aucune donnée" est là mais qu'il y a d'autres lignes, le supprimer.
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
            
            const mainContentArea = document.querySelector('.container-fluid, #main-content, main'); // Essayer plusieurs sélecteurs
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
        document.body.addEventListener('click', function(event) {
            const button = event.target.closest('.validation-ajax');
            if (!button) return;

            const inscriptionId = button.getAttribute('data-inscription-id'); 
            const action = button.getAttribute('data-action'); 
            
            if (!inscriptionId || !action) return; 
            
            button.disabled = true; 
            const originalText = button.innerHTML;
            button.innerHTML = '<span class="spinner-border spinner-border-sm" role="status" aria-hidden="true"></span> Chargement...';
            
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
                button.disabled = false;
                button.innerHTML = originalText;
            });
        });
    }

    // ====== GRAPHIQUES ======
    function initializeCharts() {
        if (config.chartRendering === 'none') return;
        // Logique pour initialiser Chart.js ou les graphiques statiques
        // Cette partie peut être étendue pour choisir dynamiquement
        if (config.chartRendering === 'chartjs' && typeof Chart !== 'undefined') {
            // Initialiser les graphiques Chart.js
        } else {
            // Initialiser les graphiques statiques (ou par défaut si 'auto' et Chart.js non dispo)
            renderStaticCharts();
        }
    }

    function updateCharts(sessions, participants) {
        if (config.chartRendering === 'none') return;
        if (config.chartRendering === 'chartjs' && typeof Chart !== 'undefined' && dashboardState.themeChart && dashboardState.serviceChart) {
            // Mettre à jour les graphiques Chart.js
            // updateThemeChartJS(sessions);
            // updateServiceChartJS(participants);
        } else {
            renderStaticCharts(sessions, participants);
        }
    }
    
    function renderStaticCharts(sessions, participants) {
        // S'assurer que les données sont disponibles
        if (!sessions && !participants) {
            // Essayer de récupérer les données si elles ne sont pas passées
            // Ceci est un fallback, idéalement les données sont passées par processData
            if (config.debugMode) console.log("Static Charts: No data provided, attempting fetch.");
            _fetchDashboardData(false, false).then(dataFetched => { // Fetch complet, non-light
                if (dataFetched && dashboardState.dataHashes.sessions && dashboardState.dataHashes.participants) {
                     // Les données sont maintenant dans dataHashes, mais il faut les extraire ou les passer
                     // Pour l'instant, on ne fait rien de plus ici, car processData devrait avoir appelé updateCharts
                }
            });
            return; 
        }
    
        if (sessions && Array.isArray(sessions)) renderThemeDistributionChart(sessions);
        if (participants && Array.isArray(participants)) renderParticipantByServiceChart(participants);
    }

    function renderThemeDistributionChart(sessionsData) {
        const container = document.getElementById('themeChartStatic');
        if (!container) return;
    
        const themeCounts = sessionsData.reduce((acc, session) => {
            const themeName = session.theme || 'Non défini';
            acc[themeName] = (acc[themeName] || 0) + 1; // Compter les sessions par thème
            return acc;
        }, {});
    
        const totalSessions = sessionsData.length;
        if (totalSessions === 0) {
            container.innerHTML = '<p class="text-center text-muted my-5">Aucune session pour afficher la répartition par thème.</p>';
            return;
        }
    
        let segmentsHtml = '';
        let legendHtml = '';
        let currentRotation = 0;
        const themeColors = { /* Définir des couleurs pour les thèmes si nécessaire */
            'Communiquer avec Teams': 'var(--theme-teams, #0078d4)',
            'Gérer les tâches (Planner)': 'var(--theme-planner, #7719aa)',
            'Gérer mes fichiers (OneDrive/SharePoint)': 'var(--theme-onedrive, #0364b8)',
            'Collaborer avec Teams': 'var(--theme-sharepoint, #038387)',
            'Non défini': '#6c757d'
        };
    
        Object.entries(themeCounts).forEach(([theme, count], index) => {
            const percentage = (count / totalSessions) * 100;
            const segmentRotation = (percentage / 100) * 360;
            const color = themeColors[theme] || getRandomColor(index);
    
            segmentsHtml += `<div class="donut-segment" style="--rotation: ${currentRotation}deg; --fill: ${color}; clip-path: polygon(50% 50%, 100% 0, ${percentage > 50 ? '100% 100%, 0% 100%, 0% 0%, 50% 0%)' : `calc(50% + 50% * tan(${percentage * 3.6 - 90}deg)) 0%, 50% 0%)`};"></div>`;
            // Simplification du clip-path pour le donut, une approche plus robuste serait SVG ou une lib de graphiques
            // Le clip-path ci-dessus est une tentative, peut nécessiter ajustement ou une approche différente pour un vrai donut.
            // Pour une solution simple, on peut juste colorer des arcs.
            // Alternative simple pour le segment (nécessite plus de CSS pour positionner les arcs)
            // segmentsHtml += `<div class="donut-segment" style="transform: rotate(${currentRotation}deg); background-image: conic-gradient(${color} ${percentage}%, transparent ${percentage}%); --index: ${index};"></div>`;


            legendHtml += `
                <div class="legend-item">
                    <span class="legend-color" style="background-color: ${color};"></span>
                    <span class="legend-label">${theme}</span>
                    <span class="legend-value">${count}</span>
                </div>`;
            currentRotation += segmentRotation;
        });
    
        container.innerHTML = `
            <div class="static-chart-title">Répartition par Thème</div>
            <div class="static-chart-donut animate">
                ${segmentsHtml}
                <div class="donut-center">
                    <div class="donut-total">${totalSessions}</div>
                    <div class="donut-label">Sessions</div>
                </div>
            </div>
            <div class="static-chart-legend">${legendHtml}</div>`;
    }
    
    function renderParticipantByServiceChart(participantsData) {
        // Cette fonction est un placeholder, car les données des participants ne sont pas toujours dans dashboard_essential
        // Si vous avez besoin de ce graphique, assurez-vous que l'API /api/participants est appelée
        // et que les données sont traitées ici.
        const container = document.getElementById('serviceChartStatic');
        if (!container) return;
        container.innerHTML = '<p class="text-center text-muted my-5">Graphique des services non implémenté dans cette version (nécessite API participants).</p>';
    }


    // ====== UTILITAIRES ======
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

    function getCsrfToken() {
        const tokenElement = document.querySelector('meta[name="csrf-token"]');
        return tokenElement ? tokenElement.getAttribute('content') : '';
    }

    function getRandomColor(index) {
        const colors = ['#4e73df', '#1cc88a', '#36b9cc', '#f6c23e', '#e74a3b', '#858796', '#5a5c69'];
        return colors[index % colors.length];
    }

    // Exposer des fonctions si nécessaire pour dashboard-init.js ou debug
    window.dashboardCore = {
        initialize: initializeDashboard,
        fetchData: debouncedFetchDashboardData,
        updateCharts: updateCharts,
        updateStatistics: updateStatisticsCounters,
        updateActivity: updateActivityFeed,
        getState: () => dashboardState,
        getConfig: () => config
    };
    
    // Démarrer le tableau de bord
    initializeDashboard();
});

// Fonction showToast globale (si non définie ailleurs)
if (typeof window.showToast !== 'function') {
    window.showToast = function(message, type = 'info', duration = 3000) {
        const toastContainer = document.getElementById('toast-container') || (() => {
            const container = document.createElement('div');
            container.id = 'toast-container';
            container.style.position = 'fixed';
            container.style.top = '20px';
            container.style.right = '20px';
            container.style.zIndex = '1090'; // Au-dessus des modales
            document.body.appendChild(container);
            return container;
        })();

        const toastId = 'toast-' + Date.now();
        const toastElement = document.createElement('div');
        toastElement.id = toastId;
        toastElement.className = `toast align-items-center text-white bg-${type} border-0 fade`;
        toastElement.setAttribute('role', 'alert');
        toastElement.setAttribute('aria-live', 'assertive');
        toastElement.setAttribute('aria-atomic', 'true');

        toastElement.innerHTML = `
            <div class="d-flex">
                <div class="toast-body">
                    ${message}
                </div>
                <button type="button" class="btn-close btn-close-white me-2 m-auto" data-bs-dismiss="toast" aria-label="Close"></button>
            </div>
        `;
        toastContainer.appendChild(toastElement);

        const bsToast = new bootstrap.Toast(toastElement, { delay: duration });
        bsToast.show();
        toastElement.addEventListener('hidden.bs.toast', () => {
            toastElement.remove();
        });
    };
}
