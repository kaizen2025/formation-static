/**
 * dashboard-init.js - Configuration et coordination légère du tableau de bord
 * Version: 1.1.4 - S'appuie sur dashboard-core pour l'initialisation principale
 */
document.addEventListener('DOMContentLoaded', function() {
    if (window.dashboardInitInitialized) {
        if (window.dashboardConfig && window.dashboardConfig.debugMode) {
            console.log('DashboardInit: Already initialized. Skipping.');
        }
        return;
    }
    window.dashboardInitInitialized = true;

    // Définir/Surcharger la configuration globale qui sera utilisée par dashboard-core.js
    window.dashboardConfig = {
        debugMode: false,       // Mettre à true pour les logs de débogage
        socketEnabled: false,   // Désactiver socket.io pour l'instant si non utilisé
        pollingEnabled: true,  // Activer le polling par défaut
        autoRefreshInterval: 60000, // Polling toutes les 60 secondes
        minRefreshDelay: 15000,
        debounceDelay: 500,
        fetchTimeoutDuration: 20000,
        maxErrors: 5,
        errorThrottleDelay: 60000,
        preferredMode: 'polling', // Forcer le polling pour commencer
        chartRendering: 'auto', // Ajouté pour la config des graphiques
        ...(window.dashboardConfig || {}) // Permet de surcharger depuis layout.html si besoin
    };

    const DASH_CONFIG = window.dashboardConfig; // Alias local pour la configuration
    if (DASH_CONFIG.debugMode) {
         console.log('DashboardInit: Initializing (v1.1.4). Effective Config:', DASH_CONFIG);
    }

    function setupRefreshButton() {
        const refreshButton = document.getElementById('refresh-dashboard');
        if (refreshButton) {
            // L'écouteur principal est dans dashboard-core.js (setupStaticEventListeners)
            // Cet écouteur est un fallback ou peut être retiré si celui de core suffit.
            refreshButton.addEventListener('click', function() {
                if (window.dashboardCore && typeof window.dashboardCore.forceRefresh === 'function') {
                    if (DASH_CONFIG.debugMode) console.log('DashboardInit: Manual refresh triggered via dashboardCore.forceRefresh() from init script.');
                    // window.dashboardCore.forceRefresh(); // Déjà géré par l'écouteur dans dashboard-core
                } else {
                    console.error('DashboardInit: dashboardCore.forceRefresh() not available.');
                    if(typeof showToast === 'function') showToast("Fonction d'actualisation indisponible.", "danger");
                }
            });
        } else if (DASH_CONFIG.debugMode) {
            console.warn('DashboardInit: Refresh button not found.');
        }
    }

    function initialize() {
        if (DASH_CONFIG.debugMode) console.log('DashboardInit: Starting primary initialization.');
        // Le mode de communication est maintenant géré dans dashboard-core.js
        setupRefreshButton(); // S'assurer que le bouton est configuré si dashboard-core ne le fait pas

        // dashboard-core.js va s'auto-initialiser et faire le premier fetch.
        // dashboard-init.js n'a plus besoin de déclencher explicitement les composants de core.
        // Il peut écouter 'dashboardCoreFullyReady' si des actions post-initialisation sont nécessaires.
        document.addEventListener('dashboardCoreFullyReady', function(event) {
            if (DASH_CONFIG.debugMode) {
                console.log('DashboardInit: Received dashboardCoreFullyReady event.', event.detail);
            }
            // Actions à faire après que dashboard-core ait fait son premier chargement
            if (typeof window.uiFixers !== 'undefined' && typeof window.uiFixers.applyAllFixes === 'function') {
                setTimeout(() => { try { window.uiFixers.applyAllFixes(); } catch (e) { console.error('DashboardInit: Error applying UI fixes post-core-ready:', e); } }, 50);
            }
            // Démarrer le polling via dashboardCore si ce n'est pas déjà fait et si c'est le mode actif
            // La logique de démarrage du polling est maintenant dans dashboard-core.js après le premier fetch réussi.
            // if (window.dashboardCore && window.dashboardCore.startPolling &&
            //     DASH_CONFIG.pollingEnabled && (!DASH_CONFIG.activeMode || DASH_CONFIG.activeMode === 'polling')) {
            //     if(DASH_CONFIG.debugMode) console.log("DashboardInit: Requesting dashboardCore to start polling.");
            //     window.dashboardCore.startPolling();
            // }

        }, { once: true });

        if (DASH_CONFIG.debugMode) console.log('DashboardInit: Primary initialization setup complete. dashboard-core will handle data loading and rendering.');
    }

    // Démarrer l'initialisation de dashboard-init
    // Ce script est maintenant très léger, il configure principalement et attend que core fasse le travail.
    setTimeout(initialize, 100); // Léger délai pour s'assurer que tout est là

});
