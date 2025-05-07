/** 
 * dashboard-init.js - Dashboard initialization and coordination
 * v1.1.0 - Meilleure gestion des erreurs et initialisation robuste
 */
document.addEventListener('DOMContentLoaded', function() {
    console.log('Dashboard initialization script started (v1.1.0).');

    /** 
     * @typedef {object} DashboardConfig 
     * @property {boolean} debugMode - Enable verbose logging in console.
     * @property {boolean} socketEnabled - Allow WebSocket usage if available.
     * @property {boolean} pollingEnabled - Allow HTTP polling as fallback or primary.
     * @property {number} autoRefreshInterval - Interval for polling updates (in ms).
     * @property {'socket'|'polling'|'auto'} preferredMode - Preferred communication mode. 'auto' uses socket if available, else polling.
     * @property {'socket'|'polling'} [activeMode] - The actual communication mode being used (set by setupCommunicationMode).
     */
    
    // Use global config if available, otherwise provide defaults
    /** @type {DashboardConfig} */
    window.dashboardConfig = window.dashboardConfig || {
        debugMode: false,
        socketEnabled: true,
        pollingEnabled: true,
        autoRefreshInterval: 30000, // 30 seconds
        preferredMode: 'auto',
        errorResilience: true // Nouvelle option pour activer la récupération d'erreur avancée
    };
    
    const DASH_CONFIG = window.dashboardConfig; // Local alias

    // État de l'initialisation
    let initializationCompleted = false;
    let componentInitPromises = [];
    let failedComponents = [];

    /** 
     * Detects WebSocket support (native and Socket.IO library).
     * @returns {boolean} True if WebSocket and Socket.IO are available.
     */
    function detectWebSocketSupport() {
        const hasWebSocket = typeof WebSocket !== 'undefined';
        const hasSocketIO = typeof io !== 'undefined';
        
        if (DASH_CONFIG.debugMode) {
            console.log(`DashboardInit: WebSocket Support: Native=${hasWebSocket}, Socket.IO=${hasSocketIO}`);
        }
        
        return hasWebSocket && hasSocketIO;
    }

    /** 
     * Shows or hides a global loading overlay.
     * @param {boolean} isLoading - True to show, false to hide.
     */
    function showGlobalLoadingOverlay(isLoading) {
        const overlay = document.getElementById('loading-overlay');
        if (overlay) {
            overlay.style.display = isLoading ? 'flex' : 'none';
        } else if (DASH_CONFIG.debugMode) {
            console.warn('DashboardInit: Global loading overlay (#loading-overlay) not found.');
        }
    }

    /**
     * Configure la communication selon les préférences et disponibilité
     * @returns {string} Le mode choisi ('socket' ou 'polling')
     */
    function setupCommunicationMode() {
        const hasWebSocket = detectWebSocketSupport();
        let mode = 'polling'; // Default to polling
        
        if (DASH_CONFIG.preferredMode === 'auto') {
            if (hasWebSocket && DASH_CONFIG.socketEnabled) {
                mode = 'socket';
                console.log('DashboardInit: Communication Mode: Auto -> WebSocket selected.');
            } else {
                mode = 'polling';
                console.log('DashboardInit: Communication Mode: Auto -> Polling selected (WebSocket unavailable or disabled).');
            }
        } else if (DASH_CONFIG.preferredMode === 'socket') {
            if (hasWebSocket && DASH_CONFIG.socketEnabled) {
                mode = 'socket';
                console.log('DashboardInit: Communication Mode: Preferred -> WebSocket selected.');
            } else {
                mode = 'polling';
                console.warn('DashboardInit: Communication Mode: WebSocket preferred but unavailable/disabled. Falling back to polling.');
            }
        } else if (DASH_CONFIG.preferredMode === 'polling') {
            if (DASH_CONFIG.pollingEnabled) {
                mode = 'polling';
                console.log('DashboardInit: Communication Mode: Preferred -> Polling selected.');
            } else {
                console.error('DashboardInit: Communication Mode: Polling preferred but also disabled! Check configuration.');
            }
        } else {
            console.warn(`DashboardInit: Communication Mode: Unknown preferredMode '${DASH_CONFIG.preferredMode}'. Defaulting to polling.`);
            mode = 'polling';
        }
        
        if (mode === 'polling' && !DASH_CONFIG.pollingEnabled) {
            console.error('DashboardInit: Communication Mode: Polling selected but polling is disabled! Check configuration.');
        }
        
        DASH_CONFIG.activeMode = mode;
        console.log(`DashboardInit: Active communication mode set to: ${mode}`);
        return mode;
    }

    /**
     * Initialize all dashboard components with better error handling
     * Components are loaded in a specific sequence with proper error isolation
     */
    function initializeDashboardComponents() {
        if (DASH_CONFIG.debugMode) console.log('DashboardInit: Initializing dashboard components...');
        
        showGlobalLoadingOverlay(true); // Show global loader before starting component init
        
        try {
            // Clear any previous initialization state
            componentInitPromises = [];
            failedComponents = [];
            
            // Schedule initialization in sequential order with timing
            scheduleChartInitialization(200);
            scheduleActivityFeedInitialization(500);
            scheduleStatsCountersInitialization(300);
            
            // Process all scheduled initializations
            Promise.allSettled(componentInitPromises)
                .then(results => {
                    // Check results to determine what failed and what succeeded
                    results.forEach((result, index) => {
                        if (result.status === 'rejected') {
                            if (index === 0) failedComponents.push('charts');
                            else if (index === 1) failedComponents.push('activity feed');
                            else if (index === 2) failedComponents.push('stats counters');
                        }
                    });
                    
                    if (failedComponents.length > 0) {
                        console.warn(`DashboardInit: The following components failed to initialize: ${failedComponents.join(', ')}`);
                        if (typeof showToast === 'function') {
                            showToast(`Some dashboard components failed to load (${failedComponents.join(', ')})`, 'warning');
                        }
                    }
                    
                    if (DASH_CONFIG.debugMode) console.log('DashboardInit: All scheduled components initialized.');
                    
                    // Set initialization as completed
                    initializationCompleted = true;
                })
                .catch(error => {
                    console.error('DashboardInit: Error during Promise.allSettled processing:', error);
                })
                .finally(() => {
                    showGlobalLoadingOverlay(false); // Hide global loader after all attempts
                    
                    // Apply UI fixes if enabled and available
                    if (typeof window.uiFixers !== 'undefined' && typeof window.uiFixers.applyAllFixes === 'function') {
                        setTimeout(() => {
                            try {
                                window.uiFixers.applyAllFixes();
                            } catch (e) {
                                console.error('DashboardInit: Error applying UI fixes:', e);
                            }
                        }, 500);
                    }
                });
        } catch (error) {
            console.error('DashboardInit: Error during component initialization scheduling phase:', error);
            if (typeof showToast === 'function') {
                showToast('Error initializing dashboard components', 'danger');
            }
            showGlobalLoadingOverlay(false);
        }
    }

    /**
     * Schedule chart initialization with proper error handling 
     * @param {number} delay - Delay in milliseconds before initializing
     */
    function scheduleChartInitialization(delay) {
        if (typeof window.chartModule !== 'undefined' && typeof window.chartModule.initialize === 'function') {
            if (DASH_CONFIG.debugMode) console.log('DashboardInit: Scheduling chart initialization...');
            
            componentInitPromises.push(
                new Promise((resolve, reject) => {
                    setTimeout(() => {
                        try {
                            window.chartModule.initialize()
                                .then(resolve)
                                .catch(err => {
                                    console.error('DashboardInit: Chart initialization failed:', err);
                                    if (typeof showToast === 'function') showToast('Failed to load charts', 'danger');
                                    reject(err);
                                });
                        } catch (e) {
                            console.error('DashboardInit: Error calling chartModule.initialize():', e);
                            reject(e);
                        }
                    }, delay);
                })
            );
        } else {
            console.warn('DashboardInit: Chart module (window.chartModule.initialize) not found. Skipping chart initialization.');
        }
    }

    /**
     * Schedule activity feed initialization with proper error handling
     * @param {number} delay - Delay in milliseconds before initializing
     */
    function scheduleActivityFeedInitialization(delay) {
        if (typeof window.refreshRecentActivity === 'function') {
            if (DASH_CONFIG.debugMode) console.log('DashboardInit: Scheduling activity feed initialization...');
            
            componentInitPromises.push(
                new Promise((resolve, reject) => {
                    setTimeout(() => {
                        try {
                            const result = window.refreshRecentActivity();
                            // Handle both synchronous calls and potential promises
                            if (result instanceof Promise) {
                                result.then(resolve).catch(err => {
                                    console.error('DashboardInit: Activity feed initialization failed:', err);
                                    reject(err);
                                });
                            } else {
                                resolve();
                            }
                        } catch (e) {
                            console.error('DashboardInit: Error refreshing activity feed:', e);
                            reject(e);
                        }
                    }, delay);
                })
            );
        } else {
            console.warn('DashboardInit: Activity feed function (window.refreshRecentActivity) not found. Skipping.');
        }
    }

    /**
     * Schedule stats counters initialization with proper error handling
     * @param {number} delay - Delay in milliseconds before initializing
     */
    function scheduleStatsCountersInitialization(delay) {
        if (typeof window.updateStatsCounters === 'function') {
            if (DASH_CONFIG.debugMode) console.log('DashboardInit: Scheduling stats counters initialization...');
            
            componentInitPromises.push(
                new Promise((resolve, reject) => {
                    setTimeout(() => {
                        try {
                            const result = window.updateStatsCounters();
                            // Handle both synchronous calls and potential promises
                            if (result instanceof Promise) {
                                result.then(resolve).catch(err => {
                                    console.error('DashboardInit: Stats counters initialization failed:', err);
                                    reject(err);
                                });
                            } else {
                                resolve();
                            }
                        } catch (e) {
                            console.error('DashboardInit: Error updating stats counters:', e);
                            reject(e);
                        }
                    }, delay);
                })
            );
        } else {
            console.warn('DashboardInit: Stats counter function (window.updateStatsCounters) not found. Skipping.');
        }
    }

    /**
     * Set up refresh button with improved error handling
     */
    function setupRefreshButton() {
        const refreshButton = document.getElementById('refresh-dashboard');
        if (!refreshButton) {
            if (DASH_CONFIG.debugMode) {
                console.log('DashboardInit: Refresh button (#refresh-dashboard) not found. Skipping setup.');
            }
            return;
        }
        
        refreshButton.addEventListener('click', function() {
            if (DASH_CONFIG.debugMode) console.log('DashboardInit: Manual refresh triggered.');
            
            this.disabled = true;
            this.innerHTML = '<i class="fas fa-sync-alt fa-spin me-1"></i>Refreshing...';
            showGlobalLoadingOverlay(true);
            
            // Use forcePollingUpdate if available, as it's more comprehensive
            if (typeof window.forcePollingUpdate === 'function') {
                window.forcePollingUpdate(true) // true for importantChange, forces all data
                    .then(result => {
                        if (DASH_CONFIG.debugMode) console.log('DashboardInit: Manual refresh via forcePollingUpdate completed.', result);
                        
                        if (result && result.success === false) {
                            // L'actualisation a échoué mais sans erreur critique
                            if (typeof showToast === 'function') showToast('Partial data refresh - some components may be outdated', 'warning');
                        } else {
                            if (typeof showToast === 'function') showToast('Dashboard data refreshed', 'success');
                        }
                    })
                    .catch(err => {
                        console.error("DashboardInit: Error during manual refresh (forcePollingUpdate):", err);
                        
                        if (typeof showToast === 'function') {
                            const message = err.message ? `Refresh error: ${err.message}` : 'Error refreshing dashboard data';
                            showToast(message, 'danger');
                        }
                        
                        // En cas d'erreur, essayer de rafraîchir les composants individuels comme fallback
                        tryIndividualComponentsRefreshAsFallback();
                    })
                    .finally(() => {
                        this.disabled = false;
                        this.innerHTML = '<i class="fas fa-sync-alt me-1"></i>Refresh';
                        showGlobalLoadingOverlay(false);
                    });
            } else {
                // Fallback to individual component refresh
                console.warn("DashboardInit: forcePollingUpdate not found, attempting individual component refresh.");
                tryIndividualComponentsRefreshAsFallback()
                    .finally(() => {
                        this.disabled = false;
                        this.innerHTML = '<i class="fas fa-sync-alt me-1"></i>Refresh';
                        showGlobalLoadingOverlay(false);
                    });
            }
        });
        
        if (DASH_CONFIG.debugMode) console.log('DashboardInit: Refresh button event listener attached.');
    }

    /**
     * Tente la mise à jour des composants individuels comme solution de secours
     * @returns {Promise} Promesse qui se résout lorsque les tentatives sont terminées
     */
    function tryIndividualComponentsRefreshAsFallback() {
        console.log("DashboardInit: Attempting individual component refresh as fallback");
        
        const refreshPromises = [];
        
        if (typeof window.updateStatsCounters === 'function') {
            refreshPromises.push(Promise.resolve().then(() => {
                try {
                    return window.updateStatsCounters();
                } catch (e) {
                    console.error("Error refreshing stats:", e);
                    return Promise.reject(e);
                }
            }).catch(e => console.warn("Failed to refresh stats:", e)));
        }
        
        if (typeof window.refreshRecentActivity === 'function') {
            refreshPromises.push(Promise.resolve().then(() => {
                try {
                    return window.refreshRecentActivity();
                } catch (e) {
                    console.error("Error refreshing activity:", e);
                    return Promise.reject(e);
                }
            }).catch(e => console.warn("Failed to refresh activity:", e)));
        }
        
        if (typeof window.chartModule !== 'undefined' && typeof window.chartModule.initialize === 'function') {
            refreshPromises.push(Promise.resolve().then(() => {
                try {
                    return window.chartModule.initialize();
                } catch (e) {
                    console.error("Error refreshing charts:", e);
                    return Promise.reject(e);
                }
            }).catch(e => console.warn("Failed to refresh charts:", e)));
        }
        
        return Promise.allSettled(refreshPromises)
            .then(results => {
                const successCount = results.filter(r => r.status === 'fulfilled').length;
                const failCount = results.filter(r => r.status === 'rejected').length;
                
                if (DASH_CONFIG.debugMode) {
                    console.log(`DashboardInit: Individual refresh results: ${successCount} succeeded, ${failCount} failed`);
                }
                
                if (failCount === 0) {
                    if (typeof showToast === 'function') showToast('Dashboard data refreshed', 'success');
                } else if (successCount > 0) {
                    if (typeof showToast === 'function') {
                        showToast(`Partial refresh - ${failCount} component(s) failed to update`, 'warning');
                    }
                } else {
                    if (typeof showToast === 'function') {
                        showToast('Failed to refresh dashboard data', 'danger');
                    }
                }
                
                return { successCount, failCount };
            })
            .catch(err => {
                console.error("DashboardInit: Error during fallback refresh:", err);
                if (typeof showToast === 'function') {
                    showToast('Data refresh failed', 'danger');
                }
                return { successCount: 0, failCount: refreshPromises.length };
            });
    }

    /**
     * Initialize the dashboard with proper error handling
     */
    function initializeDashboard() {
        console.log('DashboardInit: Starting main dashboard initialization sequence...');
        
        try {
            // 1. Set up communication mode first 
            setupCommunicationMode();
            
            // 2. Initialize all components - a promise
            initializeDashboardComponents();
            
            // 3. Set up refresh button
            setupRefreshButton();
            
            // 4. Set up error resilience if enabled
            if (DASH_CONFIG.errorResilience) {
                setupErrorResilience();
            }
            
            console.log('DashboardInit: Dashboard initialization sequence complete.');
        } catch (error) {
            console.error('DashboardInit: Critical error during dashboard initialization sequence:', error);
            
            if (typeof showToast === 'function') {
                showToast('Fatal error initializing dashboard', 'danger');
            }
            
            showGlobalLoadingOverlay(false); // Ensure overlay is hidden on critical error
        }
    }

    /**
     * Configure le mécanisme de récupération d'erreur avancé
     * Surveille le chargement du tableau de bord et tente de corriger les problèmes
     */
    function setupErrorResilience() {
        // Surveiller les erreurs générales de la page
        window.addEventListener('error', function(event) {
            // Ignorer les erreurs de script externes ou les erreurs non liées au tableau de bord
            if (event.filename && !event.filename.includes(window.location.origin)) {
                return;
            }
            
            console.warn('DashboardInit: Caught error event:', event.message);
            
            // Ne pas tenter de récupérer si l'initialisation n'est pas terminée
            if (!initializationCompleted) return;
            
            // Vérifier les erreurs de données qui pourraient nécessiter une intervention
            if (event.message.includes('undefined') || 
                event.message.includes('null') || 
                event.message.includes('not a function') ||
                event.message.includes('places_restantes')) {
                
                console.log('DashboardInit: Data error detected. Trying to recover UI...');
                
                // Si ui-fixers est disponible, essayer de corriger l'interface
                if (typeof window.uiFixers !== 'undefined' && typeof window.uiFixers.applyAllFixes === 'function') {
                    setTimeout(() => {
                        try {
                            window.uiFixers.applyAllFixes();
                        } catch (e) {
                            console.error('DashboardInit: Error applying UI fixes during recovery:', e);
                        }
                    }, 500);
                }
            }
        });
        
        // Surveiller les rejets de promesses non gérés
        window.addEventListener('unhandledrejection', function(event) {
            console.warn('DashboardInit: Unhandled promise rejection:', event.reason);
            
            // Ne pas tenter de récupérer si l'initialisation n'est pas terminée
            if (!initializationCompleted) return;
            
            // Vérifier si l'erreur concerne l'API
            if (event.reason && 
                (String(event.reason).includes('fetch') || 
                 String(event.reason).includes('api') ||
                 String(event.reason).includes('500') ||
                 String(event.reason).includes('places_restantes'))) {
                
                console.log('DashboardInit: API error detected in unhandled rejection. Trying to recover UI...');
                
                // Si ui-fixers est disponible, essayer de corriger l'interface
                if (typeof window.uiFixers !== 'undefined' && typeof window.uiFixers.applyAllFixes === 'function') {
                    setTimeout(() => {
                        try {
                            window.uiFixers.applyAllFixes();
                            if (window.uiFixers.enhancePlacesRestantes) {
                                window.uiFixers.enhancePlacesRestantes();
                            }
                        } catch (e) {
                            console.error('DashboardInit: Error applying UI fixes during recovery:', e);
                        }
                    }, 500);
                }
            }
        });
    }

    // Démarrer l'initialisation avec un léger délai pour s'assurer que le DOM est prêt
    setTimeout(initializeDashboard, 150);
});
