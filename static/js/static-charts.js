// static/js/static-charts.js
// Version: 2.1.0 - Rôle réduit, ne dessine plus les graphiques principaux si charts-enhanced.js est actif.
// S'assure que les fonctions sont disponibles pour polling-updates.js si ce dernier les appelle.

document.addEventListener('DOMContentLoaded', function() {
    const config = window.dashboardConfig || { debugMode: false };
    if (config.debugMode) {
        console.log("Static charts loader initialized (v2.1.0 - Rôle réduit)");
    }
    
    // Fonctions vides pour que polling-updates.js ne plante pas s'il les appelle
    // et que charts-enhanced.js n'est pas là pour les remplacer.
    // Idéalement, polling-updates.js devrait vérifier l'existence de ces fonctions
    // ou s'abonner à un événement de charts-enhanced.js.
    
    window.staticChartsModule = {
        initialize: function() {
            if (config.debugMode) console.log("StaticCharts: initialize() called, mais ne fait rien si charts-enhanced.js est actif.");
            // Si charts-enhanced.js n'est PAS utilisé, vous pourriez mettre la logique de fetch et render ici.
            // Pour l'instant, on suppose que charts-enhanced.js s'en charge.
            
            // Appeler l'amélioration globale des badges au cas où
            if (typeof window.enhanceThemeBadgesGlobally === 'function') {
                window.enhanceThemeBadgesGlobally();
            }
            return Promise.resolve({ success: true }); // Retourner une promesse résolue
        },
        updateThemeChart: function(data) {
            if (config.debugMode) {
                // console.log("StaticCharts: updateThemeChart called with data. Laissé à charts-enhanced.js.", data);
            }
            // Ne fait rien si charts-enhanced.js gère le canvas #themeChartCanvas
        },
        updateServiceChart: function(data) {
            if (config.debugMode) {
                // console.log("StaticCharts: updateServiceChart called with data. Laissé à charts-enhanced.js.", data);
            }
            // Ne fait rien si charts-enhanced.js gère le canvas #serviceChartCanvas
        }
    };

    // Appel initial pour les badges, au cas où.
    if (typeof window.enhanceThemeBadgesGlobally === 'function') {
        setTimeout(window.enhanceThemeBadgesGlobally, 400); // Délai pour laisser les autres scripts s'initialiser
    }
});
