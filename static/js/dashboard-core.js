/**
 * dashboard-core.js - Module principal et unique pour le tableau de bord
 * Version: 1.8.0 - Logique fusionnée, auto-initialisation robuste
 */

document.addEventListener('DOMContentLoaded', function() {
    if (window.dashboardCoreInitialized) {
        if (window.dashboardConfig && window.dashboardConfig.debugMode) {
            console.log('Dashboard Core: Already initialized. Skipping.');
        }
        return;
    }
    window.dashboardCoreInitialized = true;

    // Configuration par défaut, peut être surchargée par window.dashboardConfig défini dans layout.html
    const baseConfig = {
        debugMode: false,
        refreshInterval: 60000,
        minRefreshDelay: 15000,
        debounceDelay: 500,
        baseApiUrl: '/api', // Assurez-vous que c'est correct
        fetchTimeoutDuration: 20000,
        maxErrors: 5,
        errorThrottleDelay: 60000,
        chartRendering: 'auto'
    };
    const config = { ...baseConfig, ...(window.dashboardConfig || {}) };

    if (config.debugMode) {
        console.log('Dashboard Core: Initializing (v1.8.0)');
        console.log('Dashboard Core: Effective Config', config);
    }

    const globalLoadingOverlay = document.getElementById('loading-overlay');
    let dashboardState = {
        lastRefresh: 0,
        isUpdating: false,
        dataHashes: { sessions: null, participants: null, activites: null },
        rawData: { sessions: [], participants: [], activites: [] },
        errorCount: 0,
        isErrorThrottleActive: false,
        pollingTimeoutId: null,
        themeChartInstance: null,
        serviceChartInstance: null,
    };

    // S'assurer que apiErrorHandler est disponible
    const errorHandler = window.apiErrorHandler || {
        handleApiError: (endpoint, errorData, statusCode) => {
            console.error(`Fallback Error Handler: Erreur ${statusCode} sur ${endpoint}`, errorData);
            if (typeof showToast === 'function') showToast(`Erreur ${statusCode} lors du chargement de ${endpoint}`, 'danger');
        },
        checkAndFixBrokenElements: () => {
            if (config.debugMode) console.log("Dashboard Core: Fallback checkAndFixBrokenElements called.");
        }
    };

    // --- Fonctions principales ---
    async function initializeDashboard() {
        if (config.debugMode) console.log('Dashboard Core: Starting main initialization.');
        showGlobalLoading(true);

        setupStaticEventListeners();
        setupMutationObserver();
        initializeCharts(); // Prépare les canvas pour les graphiques

        try {
            const initialDataLoaded = await fetchAndProcessData(true); // Premier fetch forcé
            if (initialDataLoaded !== undefined) { // undefined signifie une erreur de fetch
                 startPolling();
            } else {
                if(config.debugMode) console.error("Dashboard Core: Initial data load failed, polling not started.");
                // Afficher un message d'erreur persistant si le chargement initial échoue
                const dashboardContent = document.getElementById('main-content'); // ou un conteneur plus spécifique
                if (dashboardContent && !dashboardContent.querySelector('.initial-load-error')) {
                    const errorMsgDiv = document.createElement('div');
                    errorMsgDiv.className = 'alert alert-danger initial-load-error';
                    errorMsgDiv.textContent = 'Impossible de charger les données initiales du tableau de bord. Veuillez vérifier votre connexion ou réessayer plus tard.';
                    dashboardContent.prepend(errorMsgDiv);
                }
            }
        } catch (error) {
            console.error('Dashboard Core: Critical error during initial data load.', error);
            if (typeof showToast === 'function') showToast("Erreur critique au chargement du tableau de bord.", "danger");
        } finally {
            showGlobalLoading(false);
            // Événement pour signaler que le core est prêt (même si le fetch a échoué, le core est "prêt")
            document.dispatchEvent(new CustomEvent('dashboardCoreFrameworkReady'));
            if (config.debugMode) console.log('Dashboard Core: Dispatched dashboardCoreFrameworkReady event.');
        }
    }

    const debouncedFetchAndProcessData = debounce(fetchAndProcessData, config.debounceDelay);

    async function fetchAndProcessData(forceRefresh = false, isLightPoll = false) {
        // ... (Code de fetchAndProcessData - identique à la version 1.7.1 que je vous ai fournie)
        // Assurez-vous qu'il appelle bien processData et gère les erreurs
        if (dashboardState.isUpdating && !forceRefresh) {
            if (config.debugMode) console.log('Dashboard Core: Fetch skipped (update in progress).');
            return false;
        }
        if (dashboardState.isErrorThrottleActive && !forceRefresh) {
            if (config.debugMode) console.log('Dashboard Core: Fetch skipped (error throttle active).');
            return false;
        }
        const now = Date.now();
        if (!forceRefresh && (now - dashboardState.lastRefresh < config.minRefreshDelay)) {
            if (config.debugMode) console.log('Dashboard Core: Fetch skipped (too soon).');
            return false;
        }

        dashboardState.isUpdating = true;
        dashboardState.lastRefresh = now;
        if (forceRefresh && !isLightPoll) showGlobalLoading(true);

        const apiUrl = `${config.baseApiUrl}/dashboard_essential?_=${Date.now()}${isLightPoll ? '&light=1' : ''}`;
        if (config.debugMode) console.log(`Dashboard Core: Fetching from ${apiUrl}`);

        try {
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), config.fetchTimeoutDuration);
            const response = await fetch(apiUrl, { signal: controller.signal, cache: "no-store" });
            clearTimeout(timeoutId);

            if (!response.ok) {
                const errorData = await response.json().catch(() => ({ message: `HTTP ${response.status} - ${response.statusText}` }));
                throw { ...errorData, status: response.status, endpoint: apiUrl };
            }
            const data = await response.json();
            if (!data || typeof data !== 'object') throw { message: "Invalid data format", endpoint: apiUrl };

            dashboardState.rawData = data; // Stocker les données brutes
            const hasChanged = processData(data, forceRefresh); // Traiter et rendre
            dashboardState.errorCount = 0; // Reset error count on success
            if (dashboardState.isErrorThrottleActive) {
                dashboardState.isErrorThrottleActive = false;
                if (config.debugMode) console.log("Dashboard Core: Error throttle deactivated.");
            }

            if (hasChanged) {
                document.dispatchEvent(new CustomEvent('dashboardDataRefreshed', { detail: { data } }));
            }
            return hasChanged;

        } catch (error) {
            console.error(`Dashboard Core: Error fetching data from ${error.endpoint || apiUrl}:`, error);
            errorHandler.handleApiError?.(error.endpoint || apiUrl, error, error.status || 0);
            dashboardState.errorCount++;
            if (dashboardState.errorCount >= config.maxErrors && !dashboardState.isErrorThrottleActive) {
                dashboardState.isErrorThrottleActive = true;
                console.warn(`Dashboard Core: Error throttle activated after ${dashboardState.errorCount} errors.`);
                setTimeout(() => {
                    dashboardState.isErrorThrottleActive = false;
                    if (config.debugMode) console.log("Dashboard Core: Error throttle period ended.");
                }, config.errorThrottleDelay);
            }
            return undefined; // Indique une erreur
        } finally {
            dashboardState.isUpdating = false;
            if (forceRefresh && !isLightPoll) showGlobalLoading(false);
        }
    }

    function processData(data, forceRefresh) {
        // ... (Code de processData - identique à la version 1.7.1)
        // S'assure d'appeler updateSessionTable, updateStatisticsCounters, updateActivityFeed, updateCharts
        let hasChangedOverall = forceRefresh;
        if (data.sessions) {
            const sessionsHash = simpleHash(data.sessions);
            if (sessionsHash !== dashboardState.dataHashes.sessions || forceRefresh) {
                updateSessionTable(data.sessions);
                updateStatisticsCounters(data.sessions);
                dashboardState.dataHashes.sessions = sessionsHash;
                hasChangedOverall = true;
            }
        }
        if (data.participants) {
            const participantsHash = simpleHash(data.participants);
            if (participantsHash !== dashboardState.dataHashes.participants || forceRefresh) {
                dashboardState.dataHashes.participants = participantsHash;
                hasChangedOverall = true;
            }
        }
        if (data.activites) {
            const activitiesHash = simpleHash(data.activites);
            if (activitiesHash !== dashboardState.dataHashes.activites || forceRefresh) {
                updateActivityFeed(data.activites);
                dashboardState.dataHashes.activites = activitiesHash;
                hasChangedOverall = true;
            }
        }
        if (hasChangedOverall) { // Mettre à jour les graphiques si quelque chose a changé
            updateCharts(data.sessions || [], data.participants || []);
        }
        setTimeout(() => { // Appliquer les corrections UI après le traitement
            fixDataIssues();
            enhanceBadgesAndLabels();
            initTooltips();
            errorHandler.checkAndFixBrokenElements?.();
        }, 150);
        return hasChangedOverall;
    }

    function startPolling() {
        // ... (Code de startPolling - identique à la version 1.7.1)
        if (!config.pollingEnabled) {
            if (config.debugMode) console.log("Dashboard Core: Polling disabled.");
            return;
        }
        clearTimeout(dashboardState.pollingTimeoutId);
        const poll = async () => {
            if (document.visibilityState === 'visible' && !dashboardState.isUpdating && !dashboardState.isErrorThrottleActive) {
                await fetchAndProcessData(false, true); // isLightPoll = true
            }
            if (config.pollingEnabled) { // Vérifier à nouveau
                 dashboardState.pollingTimeoutId = setTimeout(poll, config.refreshInterval);
            }
        };
        dashboardState.pollingTimeoutId = setTimeout(poll, config.refreshInterval);
        if (config.debugMode) console.log(`Dashboard Core: Polling started (interval: ${config.refreshInterval}ms).`);
    }

    function stopPolling() { /* ... (inchangé) ... */ }

    // --- Fonctions UI (updateSessionTable, updateStatisticsCounters, updateActivityFeed, etc.) ---
    // --- Collez ici les versions complètes de ces fonctions fournies précédemment ---
    function updateSessionTable(sessions) { /* ... (Code complet de la fonction) ... */ }
    function updateStatisticsCounters(sessions) { /* ... (Code complet de la fonction) ... */ }
    function updateActivityFeed(activities) { /* ... (Code complet de la fonction) ... */ }
    function getActivityIcon(type) { /* ... (Code complet de la fonction) ... */ }
    function enhanceUI() { initTooltips(); enhanceBadgesAndLabels(); fixDataIssues(); }
    function initTooltips() { if (typeof window.initializeGlobalTooltips === 'function') window.initializeGlobalTooltips(); }
    function enhanceBadgesAndLabels() { if (typeof window.enhanceThemeBadgesGlobally === 'function') window.enhanceThemeBadgesGlobally(); /* ... et pour .js-salle-cell ... */ }
    function fixDataIssues() { /* ... (Code complet de la fonction) ... */ }
    function setupValidationListeners() { /* ... (Code complet de la fonction pour .validation-ajax) ... */ }


    // --- Fonctions Graphiques (Chart.js) ---
    // --- Collez ici les versions complètes de ces fonctions fournies précédemment ---
    function initializeCharts() { /* ... (Code complet de la fonction) ... */ }
    function updateCharts(sessions, participants) { /* ... (Code complet de la fonction) ... */ }
    function renderThemeDistributionChartJS(sessionsData) { /* ... (Code complet de la fonction) ... */ }
    function renderServiceDistributionChartJS(participantsData) { /* ... (Code complet de la fonction) ... */ }
    function generateCustomLegend(container, labels, colors, values, configData, isServiceChart = false) { /* ... (Code complet de la fonction) ... */ }


    // --- Utilitaires ---
    function debounce(func, delay) { /* ... (inchangé) ... */ }
    function simpleHash(obj) { /* ... (inchangé) ... */ }
    function getRandomColor(index) { /* ... (inchangé) ... */ }
    function getCsrfToken() { /* ... (inchangé) ... */ }
    function showGlobalLoading(isLoading) {
        if (globalLoadingOverlay) {
            globalLoadingOverlay.style.display = isLoading ? 'flex' : 'none';
            if(isLoading) globalLoadingOverlay.classList.remove('hidden'); else globalLoadingOverlay.classList.add('hidden');
        }
    }
    function setupStaticEventListeners() {
        const refreshButton = document.getElementById('refresh-dashboard');
        if (refreshButton) {
            refreshButton.addEventListener('click', () => {
                if (config.debugMode) console.log('Dashboard Core: Manual refresh triggered via button.');
                refreshButton.disabled = true;
                const originalText = refreshButton.innerHTML; // Sauvegarder le texte original
                refreshButton.innerHTML = '<i class="fas fa-sync-alt fa-spin me-1"></i>Actualisation...';
                fetchAndProcessData(true).finally(() => { // true pour forceRefresh
                    refreshButton.disabled = false;
                    refreshButton.innerHTML = originalText; // Restaurer le texte original
                });
            });
        }
        setupValidationListeners(); // Attacher les écouteurs pour .validation-ajax
    }
    function setupMutationObserver() {
         if (!window.MutationObserver) return;
        let observerTimeout = null;
        const observer = new MutationObserver(function(mutations) {
            let importantChange = false;
            for (const mutation of mutations) {
                if (mutation.type === 'childList' && mutation.addedNodes.length > 0) {
                    for (const node of mutation.addedNodes) {
                        if (node.nodeType === 1 && (node.matches?.('.session-row, .activity-item, .stat-card, [data-bs-toggle="tooltip"]') || node.querySelector?.('.session-row, .activity-item, .stat-card, [data-bs-toggle="tooltip"]'))) {
                            importantChange = true; break;
                        }
                    }
                }
                if (importantChange) break;
            }
            if (importantChange) {
                clearTimeout(observerTimeout);
                observerTimeout = setTimeout(() => {
                    if (config.debugMode) console.log("MutationObserver: Triggering UI enhancements.");
                    enhanceUI(); // Appelle initTooltips, enhanceBadges, fixDataIssues
                }, 350);
            }
        });
        observer.observe(document.body, { childList: true, subtree: true });
        if (config.debugMode) console.log('Dashboard Core: Mutation observer initialized for UI enhancements.');
    }


    // --- Exposition des méthodes publiques (si nécessaire pour d'autres scripts) ---
    window.dashboardCore = {
        forceRefresh: () => fetchAndProcessData(true),
        startPolling: startPolling,
        stopPolling: stopPolling,
        // Ajoutez d'autres fonctions ici si elles doivent être appelables de l'extérieur
    };

    // --- Démarrage ---
    initializeDashboard(); // dashboard-core s'auto-initialise

}); // Fin du DOMContentLoaded pour dashboard-core.js

// Fonction showToast globale (si non définie ailleurs et nécessaire)
if (typeof window.showToast !== 'function') {
    window.showToast = function(message, type = 'info', duration = 5000) { /* ... (votre code showToast) ... */ };
}
