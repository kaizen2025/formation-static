// static/js/dashboard-core.js (Version complète, avec ajouts de logs)

document.addEventListener('DOMContentLoaded', function() {
    // ... (config et dashboardState comme avant) ...
    if (config.debugMode) {
        console.log('Dashboard Core: Initializing (v1.8.0 - FULL with RENDER DEBUG)');
    }

    // --- Fonctions principales ---
    async function initializeDashboard() {
        if (config.debugMode) console.log('Dashboard Core: Starting main initialization.');
        showGlobalLoading(true);
        setupStaticEventListeners();
        setupMutationObserver();
        initializeCharts(); // Prépare les canvas

        try {
            console.log('Dashboard Core (DEBUG RENDER): About to call fetchAndProcessData(true)');
            await fetchAndProcessData(true);
            console.log('Dashboard Core (DEBUG RENDER): fetchAndProcessData(true) completed.');
            startPolling();
        } catch (error) { /* ... */ }
        finally { /* ... */ }
    }

    async function fetchAndProcessData(forceRefresh = false, isLightPoll = false) {
        // ... (début de la fonction inchangé) ...
        try {
            // ... (logique de fetch inchangée) ...
            const data = await response.json();
            // ...
            console.log('Dashboard Core (DEBUG RENDER): Data received, calling processData.');
            dashboardState.rawData = data;
            const hasChanged = processData(data, forceRefresh); // Traiter et rendre
            // ... (reste de la fonction inchangé) ...
        } catch (error) { /* ... */ }
        finally { /* ... */ }
    }

    function processData(data, forceRefresh) {
        if (config.debugMode) console.log('Dashboard Core (DEBUG RENDER): Starting processData.');
        let hasChangedOverall = forceRefresh;
        // Sessions
        if (data.sessions) {
            console.log('Dashboard Core (DEBUG RENDER): Processing sessions data.');
            // ... (logique existante pour sessions) ...
            if (sessionsHash !== dashboardState.dataHashes.sessions || forceRefresh) {
                updateSessionTable(data.sessions); // Appel à la fonction de rendu
                updateStatisticsCounters(data.sessions);
                // ...
            }
        }
        // Participants
        if (data.participants) {
            console.log('Dashboard Core (DEBUG RENDER): Processing participants data.');
            // ... (logique existante pour participants) ...
        }
        // Activités
        if (data.activites) {
            console.log('Dashboard Core (DEBUG RENDER): Processing activities data.');
            // ... (logique existante pour activités) ...
            if (activitiesHash !== dashboardState.dataHashes.activites || forceRefresh) {
                updateActivityFeed(data.activites); // Appel à la fonction de rendu
                // ...
            }
        }
        if (hasChangedOverall) {
            console.log('Dashboard Core (DEBUG RENDER): Data changed, calling updateCharts.');
            updateCharts(data.sessions || [], data.participants || []); // Appel à la fonction de rendu
        }
        // ... (setTimeout pour UI fixes inchangé) ...
        if (config.debugMode) console.log('Dashboard Core (DEBUG RENDER): Finished processData.');
        return hasChangedOverall;
    }

    // --- Fonctions UI ---
    function updateSessionTable(sessions) {
        if (config.debugMode) console.log('Dashboard Core (DEBUG RENDER): Starting updateSessionTable.');
        // ... (VOTRE CODE COMPLET pour updateSessionTable) ...
        if (config.debugMode) console.log('Dashboard Core (DEBUG RENDER): Finished updateSessionTable.');
    }
    function updateStatisticsCounters(sessions) {
        if (config.debugMode) console.log('Dashboard Core (DEBUG RENDER): Starting updateStatisticsCounters.');
        // ... (VOTRE CODE COMPLET pour updateStatisticsCounters) ...
        if (config.debugMode) console.log('Dashboard Core (DEBUG RENDER): Finished updateStatisticsCounters.');
    }
    function updateActivityFeed(activities) {
        if (config.debugMode) console.log('Dashboard Core (DEBUG RENDER): Starting updateActivityFeed.');
        // ... (VOTRE CODE COMPLET pour updateActivityFeed) ...
        if (config.debugMode) console.log('Dashboard Core (DEBUG RENDER): Finished updateActivityFeed.');
    }

    // --- Fonctions Graphiques (Chart.js) ---
    function initializeCharts() {
        if (config.debugMode) console.log('Dashboard Core (DEBUG RENDER): Starting initializeCharts.');
        // ... (VOTRE CODE COMPLET pour initializeCharts) ...
        if (config.debugMode) console.log('Dashboard Core (DEBUG RENDER): Finished initializeCharts.');
    }
    function updateCharts(sessions, participants) {
        if (config.debugMode) console.log('Dashboard Core (DEBUG RENDER): Starting updateCharts.');
        // ... (VOTRE CODE COMPLET pour updateCharts) ...
        if (config.debugMode) console.log('Dashboard Core (DEBUG RENDER): Finished updateCharts.');
    }
    function renderThemeDistributionChartJS(sessionsData) {
        if (config.debugMode) console.log('Dashboard Core (DEBUG RENDER): Starting renderThemeDistributionChartJS.');
        // ... (VOTRE CODE COMPLET pour renderThemeDistributionChartJS) ...
        // Ajoutez des logs avant et après `new Chart(...)` et `dashboardState.themeChartInstance.update()`
        if (config.debugMode) console.log('Dashboard Core (DEBUG RENDER): Finished renderThemeDistributionChartJS.');
    }
    function renderServiceDistributionChartJS(participantsData) {
        if (config.debugMode) console.log('Dashboard Core (DEBUG RENDER): Starting renderServiceDistributionChartJS.');
        // ... (VOTRE CODE COMPLET pour renderServiceDistributionChartJS) ...
        if (config.debugMode) console.log('Dashboard Core (DEBUG RENDER): Finished renderServiceDistributionChartJS.');
    }

    // ... (toutes les autres fonctions : generateCustomLegend, enhanceUI, etc. doivent être présentes) ...

    // --- Démarrage ---
    initializeDashboard(); // dashboard-core s'auto-initialise

    // Émettre l'événement dashboardCoreFullyReady une fois que tout est défini et initialisé
    // (déplacé à la fin de initializeDashboard pour s'assurer qu'il est émis après le premier fetch)
    // document.dispatchEvent(new CustomEvent('dashboardCoreFullyReady', { detail: { dashboardCore: window.dashboardCore } }));
});
