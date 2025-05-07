document.addEventListener('DOMContentLoaded', function() {
    const DASH_CONFIG = window.dashboardConfig || { debugMode: false };
    if (DASH_CONFIG.debugMode) {
        console.log("Static charts loader initialized (v2.1.1 - Primarily stubs)");
    }

    // Define global theme/service data structures if not already defined by charts-enhanced.js
    // These are used by polling-updates.js to pass color info.
    if (typeof window.themesDataForChart === 'undefined') {
        window.themesDataForChart = {
            'Communiquer avec Teams': { color: 'var(--theme-teams, #0078d4)' },
            'Gérer les tâches (Planner)': { color: 'var(--theme-planner, #7719aa)' },
            'Gérer mes fichiers (OneDrive/SharePoint)': { color: 'var(--theme-onedrive, #0364b8)' },
            'Collaborer avec Teams': { color: 'var(--theme-sharepoint, #038387)' },
        };
    }
    if (typeof window.servicesDataForChart === 'undefined') {
        window.servicesDataForChart = {
            'Commerce Anecoop-Solagora': { color: 'var(--service-commerce, #FFC107)' },
            'Comptabilité': { color: 'var(--service-comptabilite, #2196F3)' },
            'Florensud': { color: 'var(--service-florensud, #4CAF50)' },
            'Informatique': { color: 'var(--service-informatique, #607D8B)' },
            // ... other services
        };
    }


    // Module definition
    window.staticChartsModule = {
        initialize: function() {
            if (DASH_CONFIG.debugMode) console.log("StaticCharts: initialize() called. No rendering if charts-enhanced.js is active.");
            // If charts-enhanced.js is NOT used, actual static chart rendering logic would go here.
            // For now, it's assumed charts-enhanced.js handles the canvas elements.

            // Call global theme badge enhancement, as it's a general UI improvement.
            if (typeof window.enhanceThemeBadgesGlobally === 'function') {
                window.enhanceThemeBadgesGlobally();
            }
            return Promise.resolve({ success: true, message: "Static chart module initialized (stubs only)." });
        },
        updateThemeChart: function(data) { // data is an array of {label, value, color}
            if (DASH_CONFIG.debugMode) {
                // console.log("StaticCharts: updateThemeChart called. Chart.js rendering is handled by charts-enhanced.js.", data);
            }
            // This function would render a basic HTML/CSS chart if #themeChartCanvas was not present
            // or if Chart.js failed. Since charts-enhanced.js targets #themeChartCanvas, this does nothing.
            // However, it might update the legend or total if the static HTML structure is used as a fallback.
            const donutTotalEl = document.getElementById('chart-theme-total');
            if (donutTotalEl && data && Array.isArray(data)) {
                const totalInscrits = data.reduce((sum, item) => sum + (item.value || 0), 0);
                donutTotalEl.textContent = totalInscrits;
            }
        },
        updateServiceChart: function(data) { // data is an array of {label, value, color}
            if (DASH_CONFIG.debugMode) {
                // console.log("StaticCharts: updateServiceChart called. Chart.js rendering is handled by charts-enhanced.js.", data);
            }
            // Similar to updateThemeChart, this would render a basic bar chart if needed.
        }
    };

    // Ensure chartModule is an alias to staticChartsModule if charts-enhanced doesn't replace it.
    // This helps dashboard-init.js call .initialize() without error.
    if (typeof window.chartModule === 'undefined') {
        window.chartModule = window.staticChartsModule;
    }

    // Initial call for global badge enhancements.
    if (typeof window.enhanceThemeBadgesGlobally === 'function') {
        setTimeout(window.enhanceThemeBadgesGlobally, 450); // Delay for other scripts
    }
});
