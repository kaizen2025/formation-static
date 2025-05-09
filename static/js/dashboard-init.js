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
        chartRendering: 'auto',
        ...(window.dashboardConfig || {}) // Permet de surcharger depuis layout.html si besoin
    };

    const DASH_CONFIG = window.dashboardConfig; // Alias local pour la configuration
    if (DASH_CONFIG.debugMode) {
         console.log('DashboardInit: Initializing (v1.1.4). Effective Config:', DASH_CONFIG);
    }

    function setupRefreshButton() {
        const refreshButton = document.getElementById('refresh-dashboard');
        if (refreshButton) {
            // L'écouteur principal est maintenant dans dashboard-core.js (setupStaticEventListeners)
            // Cet écouteur est un fallback ou peut être retiré si celui de core suffit.
            // Si dashboard-core gère déjà le bouton, cet écouteur peut être simplifié ou supprimé.
            refreshButton.addEventListener('click', function() {
                if (window.dashboardCore && typeof window.dashboardCore.forceRefresh === 'function') {
                    if (DASH_CONFIG.debugMode) console.log('DashboardInit: Manual refresh triggered via dashboardCore.forceRefresh() (from init script, possibly redundant).');
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
        // Le mode de communication est géré dans dashboard-core.js
        setupRefreshButton(); // S'assurer que le bouton est configuré

        document.addEventListener('dashboardCoreFullyReady', function(event) {
            if (DASH_CONFIG.debugMode) {
                console.log('DashboardInit: Received dashboardCoreFullyReady event.', event.detail);
            }
            if (typeof window.uiFixers !== 'undefined' && typeof window.uiFixers.applyAllFixes === 'function') {
                setTimeout(() => { try { window.uiFixers.applyAllFixes(); } catch (e) { console.error('DashboardInit: Error applying UI fixes post-core-ready:', e); } }, 50);
            }
            // Le polling est démarré par dashboard-core.js après son premier fetch réussi.
        }, { once: true });

        if (DASH_CONFIG.debugMode) console.log('DashboardInit: Primary initialization setup complete. dashboard-core will handle data loading and rendering.');
    }

    // Démarrer l'initialisation de dashboard-init
    setTimeout(initialize, 100);

});
