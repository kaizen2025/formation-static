/**
 * dashboard-init.js - Configuration pour le tableau de bord
 * Version: 1.1.5 - Rôle de configuration uniquement, s'appuie sur dashboard-core
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

    // Définir ou surcharger la configuration globale qui sera utilisée par dashboard-core.js
    // dashboard-core.js lira ces valeurs si elles sont présentes.
    window.dashboardConfig = {
        debugMode: false,       // Mettre à true pour les logs de débogage détaillés
        // refreshInterval: 30000, // Exemple: changer l'intervalle de polling
        // baseApiUrl: '/custom_api_path', // Exemple: si votre API a un préfixe différent
        pollingEnabled: true,  // S'assurer que le polling est activé par défaut si dashboard-core le gère
        preferredMode: 'polling', // Peut être 'auto', 'polling', 'socket'
        // chartRendering: 'canvas', // Forcer Chart.js si 'auto' ne fonctionne pas
        ...(window.dashboardConfig || {}) // Conserver les configs déjà définies (ex: par layout.html)
    };

    const DASH_CONFIG = window.dashboardConfig; // Alias local pour la configuration
    if (DASH_CONFIG.debugMode) {
         console.log('DashboardInit: Initializing (v1.1.5). Effective Config:', DASH_CONFIG);
    }

    // Le bouton refresh est maintenant géré dans dashboard-core.js via setupStaticEventListeners.
    // Si vous aviez une logique spécifique pour le bouton refresh ici, elle peut être retirée
    // ou adaptée pour appeler window.dashboardCore.forceRefresh() si dashboardCore est prêt.

    // dashboard-core.js s'occupe de sa propre initialisation et du reste.
    // Ce script a maintenant un rôle de configuration.
    // Si des actions post-initialisation de dashboard-core sont nécessaires,
    // elles peuvent écouter l'événement 'dashboardCoreFullyReady'.
    document.addEventListener('dashboardCoreFullyReady', function(event) {
        if (DASH_CONFIG.debugMode) {
            console.log('DashboardInit: Received dashboardCoreFullyReady event.', event.detail);
        }
        // Exemple d'action post-initialisation:
        if (typeof window.uiFixers !== 'undefined' && typeof window.uiFixers.applyAllFixes === 'function') {
            setTimeout(() => {
                try {
                    window.uiFixers.applyAllFixes();
                    if (DASH_CONFIG.debugMode) console.log('DashboardInit: UI Fixers applied post core ready.');
                } catch (e) {
                    console.error('DashboardInit: Error applying UI fixes post-core-ready:', e);
                }
            }, 50); // Léger délai pour s'assurer que le DOM est stable
        }
    }, { once: true });

    if (DASH_CONFIG.debugMode) console.log('DashboardInit: Setup complete. dashboard-core.js will handle main operations.');

});
