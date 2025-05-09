/**
 * dashboard-init.js - Configuration pour le tableau de bord
 * Version: 1.1.5 - Rôle de configuration uniquement
 */
document.addEventListener('DOMContentLoaded', function() {
    // Définir ou surcharger la configuration globale pour dashboard-core.js
    // dashboard-core.js utilisera ces valeurs si elles sont présentes.
    window.dashboardConfig = {
        debugMode: false,       // Mettre à true pour les logs de débogage détaillés
        // refreshInterval: 30000, // Exemple: changer l'intervalle de polling
        // baseApiUrl: '/custom_api_path', // Exemple: si votre API a un préfixe différent
        // pollingEnabled: false, // Exemple: pour désactiver le polling
        ...(window.dashboardConfig || {}) // Conserver les configs déjà définies (ex: par layout.html)
    };

    if (window.dashboardConfig.debugMode) {
        console.log('DashboardInit: Configuration applied (v1.1.5). Effective Config:', window.dashboardConfig);
    }

    // dashboard-core.js s'occupe de sa propre initialisation et du reste.
    // Ce script a maintenant un rôle de configuration.
    // Si vous avez des écouteurs d'événements spécifiques qui ne dépendent pas de dashboard-core,
    // vous pouvez les mettre ici.
});
