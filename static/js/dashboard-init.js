/**
 * dashboard-init.js - Dashboard initialization and coordination
 * v1.1.2 - Robust event listening and component initialization
 */
document.addEventListener('DOMContentLoaded', function() {
    // Empêcher la double initialisation
    if (window.dashboardInitInitialized) {
        if (window.dashboardConfig && window.dashboardConfig.debugMode) {
            console.log('DashboardInit: Already initialized. Skipping.');
        }
        return;
    }
    window.dashboardInitInitialized = true;
    if (window.dashboardConfig && window.dashboardConfig.debugMode) {
         console.log('DashboardInit: Initializing (v1.1.2).');
    }


    /** @type {DashboardConfig} */
    window.dashboardConfig = window.dashboardConfig || {
        debugMode: false,
        socketEnabled: true,
        pollingEnabled: true,
        autoRefreshInterval: 30000,
        preferredMode: 'auto',
        errorResilience: true
    };

    const DASH_CONFIG = window.dashboardConfig;
    let initializationCompleted = false;
    let failedComponents = [];

    function detectWebSocketSupport() { /* ... (inchangé) ... */
        const hasWebSocket = typeof WebSocket !== 'undefined';
        const hasSocketIO = typeof io !== 'undefined';
        if (DASH_CONFIG.debugMode) {
            console.log(`DashboardInit: WebSocket Support: Native=${hasWebSocket}, Socket.IO=${hasSocketIO}`);
        }
        return hasWebSocket && hasSocketIO;
    }
    function showGlobalLoadingOverlay(isLoading) { /* ... (inchangé) ... */
        const overlay = document.getElementById('loading-overlay');
        if (overlay) {
            overlay.style.display = isLoading ? 'flex' : 'none';
            if(isLoading) overlay.classList.remove('hidden'); else overlay.classList.add('hidden');
        } else if (DASH_CONFIG.debugMode) {
            console.warn('DashboardInit: Global loading overlay (#loading-overlay) not found.');
        }
    }
    function setupCommunicationMode() { /* ... (inchangé) ... */
        const hasWebSocket = detectWebSocketSupport();
        let mode = 'polling';
        if (DASH_CONFIG.preferredMode === 'auto') {
            if (hasWebSocket && DASH_CONFIG.socketEnabled) mode = 'socket';
            else mode = 'polling';
        } else if (DASH_CONFIG.preferredMode === 'socket') {
            if (hasWebSocket && DASH_CONFIG.socketEnabled) mode = 'socket';
            else { mode = 'polling'; console.warn('DashboardInit: WebSocket preferred but unavailable/disabled. Falling back to polling.'); }
        } else if (DASH_CONFIG.preferredMode === 'polling') {
            if (DASH_CONFIG.pollingEnabled) mode = 'polling';
            else console.error('DashboardInit: Polling preferred but also disabled!');
        } else {
            mode = 'polling'; console.warn(`DashboardInit: Unknown preferredMode '${DASH_CONFIG.preferredMode}'. Defaulting to polling.`);
        }
        if (mode === 'polling' && !DASH_CONFIG.pollingEnabled) console.error('DashboardInit: Polling selected but polling is disabled!');
        DASH_CONFIG.activeMode = mode; // Stocker le mode actif
        console.log(`DashboardInit: Active communication mode set to: ${mode}`);
        return mode;
    }


    function initializeDashboardComponentsWhenReady() {
        if (DASH_CONFIG.debugMode) console.log('DashboardInit: Initializing dashboard components now that dashboardCore is ready.');
        showGlobalLoadingOverlay(true);

        const core = window.dashboardCore;
        if (!core || typeof core.fetchData !== 'function') { // Vérifier une fonction clé de core
            console.error("DashboardInit: window.dashboardCore or its methods are not available!");
            showGlobalLoadingOverlay(false);
            if(typeof showToast === 'function') showToast("Erreur critique: Le module principal du tableau de bord n'a pas pu se charger.", "danger");
            return;
        }

        let componentInitPromises = [];
        failedComponents = [];

        // 1. Premier fetch de données via dashboardCore.fetchData(true)
        // Cela mettra à jour les compteurs, les graphiques (via processData dans core), et le flux d'activité.
        if (DASH_CONFIG.debugMode) console.log('DashboardInit: Triggering initial data fetch via dashboardCore.fetchData(true).');
        componentInitPromises.push(
            core.fetchData(true) // true for forceRefresh and full data load
                .then(result => {
                    if (result === undefined) throw new Error("Initial data fetch failed or returned undefined.");
                    if (DASH_CONFIG.debugMode) console.log("DashboardInit: Initial data fetch successful:", result);
                })
                .catch(err => {
                    console.error('DashboardInit: Initial data fetch via dashboardCore failed:', err);
                    failedComponents.push('initial data load');
                    // Ne pas rejeter la promesse ici pour permettre aux autres de continuer si possible
                })
        );


        // Les fonctions spécifiques comme core.initializeCharts(), core.updateActivity()
        // sont maintenant appelées en interne par dashboardCore.processData après le fetch.
        // On s'assure juste que le premier fetch est fait.

        Promise.allSettled(componentInitPromises)
            .then(results => {
                // ... (logique de gestion des résultats et erreurs comme avant) ...
                if (failedComponents.length > 0) {
                    console.warn(`DashboardInit: The following components/steps had issues: ${failedComponents.join(', ')}`);
                    if (typeof showToast === 'function') showToast(`Certains éléments du tableau de bord n'ont pas pu charger (${failedComponents.join(', ')})`, 'warning');
                }
                if (DASH_CONFIG.debugMode) console.log('DashboardInit: Component initialization/first data load sequence complete.');
                initializationCompleted = true;

                // Démarrer le polling si configuré et géré par dashboardCore
                if (core.startPolling && DASH_CONFIG.activeMode === 'polling' && DASH_CONFIG.pollingEnabled) {
                    core.startPolling();
                }
            })
            .catch(error => console.error('DashboardInit: Error during Promise.allSettled for component init:', error))
            .finally(() => {
                showGlobalLoadingOverlay(false);
                if (typeof window.uiFixers !== 'undefined' && typeof window.uiFixers.applyAllFixes === 'function') {
                    setTimeout(() => {
                        try { window.uiFixers.applyAllFixes(); }
                        catch (e) { console.error('DashboardInit: Error applying UI fixes:', e); }
                    }, 500);
                }
            });
    }


    function setupRefreshButton() { /* ... (inchangé, mais utilise window.dashboardCore.fetchData) ... */
        const refreshButton = document.getElementById('refresh-dashboard');
        if (!refreshButton) {
            if (DASH_CONFIG.debugMode) console.log('DashboardInit: Refresh button (#refresh-dashboard) not found.');
            return;
        }
        refreshButton.addEventListener('click', function() {
            if (DASH_CONFIG.debugMode) console.log('DashboardInit: Manual refresh triggered.');
            this.disabled = true;
            this.innerHTML = '<i class="fas fa-sync-alt fa-spin me-1"></i>Actualisation...';
            showGlobalLoadingOverlay(true);

            if (window.dashboardCore && typeof window.dashboardCore.fetchData === 'function') {
                window.dashboardCore.fetchData(true) // true for forceRefresh
                    .then(result => {
                        if (DASH_CONFIG.debugMode) console.log('DashboardInit: Manual refresh via dashboardCore.fetchData completed.', result);
                        if (result === true) {
                            if (typeof showToast === 'function') showToast('Données du tableau de bord actualisées.', 'success');
                        } else if (result === false) {
                             if (typeof showToast === 'function') showToast('Aucune nouvelle donnée.', 'info');
                        } else { // undefined si erreur
                             if (typeof showToast === 'function') showToast('Erreur lors de l\'actualisation.', 'warning');
                        }
                    })
                    .catch(err => {
                        console.error("DashboardInit: Error during manual refresh (dashboardCore.fetchData):", err);
                        if (typeof showToast === 'function') showToast('Erreur critique lors de l\'actualisation.', 'danger');
                    })
                    .finally(() => {
                        this.disabled = false;
                        this.innerHTML = '<i class="fas fa-sync-alt me-1"></i>Actualiser';
                        showGlobalLoadingOverlay(false);
                    });
            } else {
                console.error("DashboardInit: window.dashboardCore.fetchData not available for refresh.");
                this.disabled = false;
                this.innerHTML = '<i class="fas fa-sync-alt me-1"></i>Actualiser';
                showGlobalLoadingOverlay(false);
                if (typeof showToast === 'function') showToast('Fonction d\'actualisation non disponible.', 'danger');
            }
        });
        if (DASH_CONFIG.debugMode) console.log('DashboardInit: Refresh button event listener attached.');
    }

    function setupErrorResilience() { /* ... (inchangé) ... */
        window.addEventListener('error', function(event) {
            if (event.filename && !event.filename.includes(window.location.origin)) return;
            console.warn('DashboardInit: Caught error event:', event.message);
            if (!initializationCompleted) return;
            if (event.message.includes('undefined') || event.message.includes('null') || event.message.includes('not a function') || event.message.includes('places_restantes')) {
                console.log('DashboardInit: Data error detected. Trying to recover UI...');
                if (typeof window.uiFixers !== 'undefined' && typeof window.uiFixers.applyAllFixes === 'function') {
                    setTimeout(() => {
                        try { window.uiFixers.applyAllFixes(); }
                        catch (e) { console.error('DashboardInit: Error applying UI fixes during recovery:', e); }
                    }, 500);
                }
            }
        });
        window.addEventListener('unhandledrejection', function(event) {
            console.warn('DashboardInit: Unhandled promise rejection:', event.reason);
            if (!initializationCompleted) return;
            if (event.reason && (String(event.reason).includes('fetch') || String(event.reason).includes('api') || String(event.reason).includes('500') || String(event.reason).includes('places_restantes'))) {
                console.log('DashboardInit: API error detected in unhandled rejection. Trying to recover UI...');
                if (typeof window.uiFixers !== 'undefined' && typeof window.uiFixers.applyAllFixes === 'function') {
                    setTimeout(() => {
                        try { window.uiFixers.applyAllFixes(); if (window.uiFixers.enhancePlacesRestantes) window.uiFixers.enhancePlacesRestantes(); }
                        catch (e) { console.error('DashboardInit: Error applying UI fixes during recovery:', e); }
                    }, 500);
                }
            }
        });
    }

    function initializePrimaryDashboardLogic() {
        if (DASH_CONFIG.debugMode) console.log('DashboardInit: Starting primary dashboard logic setup...');
        try {
            setupCommunicationMode();
            setupRefreshButton();
            if (DASH_CONFIG.errorResilience) {
                setupErrorResilience();
            }
            // Attendre que dashboardCore soit prêt avant d'initialiser les composants qui en dépendent
            if (window.dashboardCore) { // Si dashboardCore s'est chargé plus vite
                if (DASH_CONFIG.debugMode) console.log('DashboardInit: dashboardCore already available, proceeding.');
                initializeDashboardComponentsWhenReady();
            } else {
                if (DASH_CONFIG.debugMode) console.log('DashboardInit: Waiting for dashboardCoreReady event...');
                document.addEventListener('dashboardCoreReady', function onCoreReady(event) {
                    if (DASH_CONFIG.debugMode) console.log('DashboardInit: Received dashboardCoreReady event.');
                    document.removeEventListener('dashboardCoreReady', onCoreReady); // Nettoyer l'écouteur
                    if (event.detail && event.detail.dashboardCore) {
                        window.dashboardCore = event.detail.dashboardCore; // S'assurer qu'il est bien sur window
                    }
                    initializeDashboardComponentsWhenReady();
                }, { once: true }); // { once: true } pour que l'écouteur se retire après le premier événement
            }
            if (DASH_CONFIG.debugMode) console.log('DashboardInit: Primary logic setup complete.');
        } catch (error) {
            console.error('DashboardInit: Critical error during primary dashboard logic setup:', error);
            if (typeof showToast === 'function') showToast('Erreur fatale initialisation dashboard', 'danger');
            showGlobalLoadingOverlay(false);
        }
    }

    // Démarrer la logique principale d'initialisation du dashboard
    setTimeout(initializePrimaryDashboardLogic, 50);

});
