/**
 * dashboard-core.js - Fichier JavaScript optimisé pour le tableau de bord
 * Version: 1.6.3 - Finalisation de l'initialisation événementielle et robustesse
 */

document.addEventListener('DOMContentLoaded', function() {
    // Empêcher la double initialisation
    if (window.dashboardCoreInitialized) {
        if (window.dashboardConfig && window.dashboardConfig.debugMode) {
            console.log('Dashboard Core: Already initialized. Skipping.');
        }
        // S'assurer que l'événement est quand même émis si un autre script l'attend
        if (window.dashboardCore) {
             document.dispatchEvent(new CustomEvent('dashboardCoreReady', { detail: { dashboardCore: window.dashboardCore } }));
        }
        return;
    }
    window.dashboardCoreInitialized = true;
    if (window.dashboardConfig && window.dashboardConfig.debugMode) {
        console.log('Dashboard Core: Initializing (v1.6.3)');
    }


    const globalLoadingOverlay = document.getElementById('loading-overlay');
    const dashInitConfig = window.dashboardConfig || {}; // Utiliser la config globale si elle existe

    // Configuration par défaut et fusion avec la config globale
    const config = {
        debugMode: dashInitConfig.debugMode || false,
        refreshInterval: dashInitConfig.autoRefreshInterval || 120000,
        minRefreshDelay: dashInitConfig.minRefreshDelay || 30000,
        debounceDelay: dashInitConfig.debounceDelay || 1000,
        baseApiUrl: dashInitConfig.baseApiUrl || '/api',
        chartRendering: dashInitConfig.chartRendering || 'auto',
        usingDashboardInit: !!dashInitConfig.autoRefreshInterval || !!dashInitConfig.preferredMode,
        socketEnabled: dashInitConfig.socketEnabled !== undefined ? dashInitConfig.socketEnabled : true,
        pollingEnabled: dashInitConfig.pollingEnabled !== undefined ? dashInitConfig.pollingEnabled : true,
        preferredMode: dashInitConfig.preferredMode || 'auto',
        errorThrottleMode: false,
        fetchTimeoutDuration: 15000,
        ...dashInitConfig // Surcharger avec les valeurs de window.dashboardConfig
    };

    if (config.debugMode) console.log(`Dashboard Core: Effective Config`, config);

    let dashboardState = {
        lastRefresh: 0,
        updating: false,
        dataHashes: { sessions: null, participants: null, activites: null },
        rawData: { sessions: [], participants: [], activites: [] },
        errorCount: 0,
        maxErrors: 5,
        pollingActive: true,
        pollingTimeout: null,
        pollingTimeoutScheduled: false,
        themeChartInstance: null,
        serviceChartInstance: null,
        fetchTimeoutId: null
    };

    const errorHandler = window.apiErrorHandler || {
        handleApiError: (endpoint, errorData, statusCode) => {
            console.error(`Fallback Error Handler: Erreur ${statusCode} sur ${endpoint}`, errorData);
            if (typeof showToast === 'function') showToast(`Erreur ${statusCode} lors du chargement de ${endpoint}`, 'danger');
            return false;
        },
        checkAndFixBrokenElements: () => {
            if (config.debugMode) console.log("Dashboard Core: Fixing UI elements with fallback handler");
            fixDataIssues();
            enhanceBadgesAndLabels();
        }
    };

    // ====== INITIALISATION ET CYCLE DE VIE ======
    function initializeDashboard() {
        enhanceUI();
        initializeCharts(); // Initialise les structures des graphiques

        // Le premier fetch de données est maintenant géré par dashboard-init.js
        // ou par un appel direct à debouncedFetchDashboardData si dashboard-init.js n'est pas utilisé.
        // Si dashboard-init.js n'est pas là, on fait un premier fetch.
        if (!config.usingDashboardInit) {
            setupEventListeners(); // Seulement si non géré par dashboard-init
            startPolling();      // Seulement si non géré par dashboard-init
            debouncedFetchDashboardData(true); // Premier chargement
        }


        if (config.debugMode) console.log('Dashboard Core: Initialization sequence complete.');
    }

    function startPolling() {
        if (config.usingDashboardInit && config.preferredMode !== 'polling' && DASH_CONFIG.activeMode !== 'polling') {
            if (config.debugMode) console.log("Dashboard Core: Polling not started (managed by dashboard-init or mode is not polling).");
            return;
        }
        if (!config.pollingEnabled) {
             if (config.debugMode) console.log("Dashboard Core: Polling is disabled.");
             return;
        }

        if (dashboardState.pollingTimeout) clearTimeout(dashboardState.pollingTimeout);
        dashboardState.pollingTimeoutScheduled = false;

        function scheduleNextPoll() {
            if (dashboardState.pollingTimeoutScheduled || !dashboardState.pollingActive) return;
            dashboardState.pollingTimeoutScheduled = true;

            dashboardState.pollingTimeout = setTimeout(async () => {
                dashboardState.pollingTimeoutScheduled = false;
                if (dashboardState.pollingActive && document.visibilityState === 'visible' && !dashboardState.updating) {
                    try {
                        await debouncedFetchDashboardData(false, true); // lightMode = true pour les polls réguliers
                    } catch (err) {
                        console.error("Dashboard Core: Error during scheduled poll:", err);
                    } finally {
                        if (dashboardState.pollingActive) scheduleNextPoll();
                    }
                } else {
                    if (dashboardState.pollingActive) scheduleNextPoll();
                }
            }, config.refreshInterval);
        }
        scheduleNextPoll();
        if (config.debugMode) console.log(`Dashboard Core: Polling started (interval: ${config.refreshInterval}ms)`);
    }

    function setupEventListeners() {
        document.addEventListener('visibilitychange', () => {
            if (document.visibilityState === 'visible' && dashboardState.pollingActive) {
                if (config.debugMode) console.log('Dashboard Core: Tab visible, triggering refresh');
                debouncedFetchDashboardData(false, true); // lightMode = true
            } else if (document.visibilityState === 'hidden') {
                if (dashboardState.pollingTimeout) {
                    clearTimeout(dashboardState.pollingTimeout);
                    dashboardState.pollingTimeoutScheduled = false;
                    if(config.debugMode) console.log('Dashboard Core: Tab hidden, polling paused.');
                }
            }
        });
        // Le bouton refresh est géré par dashboard-init.js s'il est présent
        // Sinon, on peut l'attacher ici.
        if (!config.usingDashboardInit) {
            const refreshButton = document.getElementById('refresh-dashboard');
            if (refreshButton) {
                refreshButton.addEventListener('click', function() {
                    this.disabled = true;
                    this.innerHTML = '<i class="fas fa-sync-alt fa-spin me-1"></i>Actualisation...';
                    if (globalLoadingOverlay) globalLoadingOverlay.style.display = 'flex';
                    debouncedFetchDashboardData(true)
                        .finally(() => {
                            this.disabled = false;
                            this.innerHTML = '<i class="fas fa-sync-alt me-1"></i>Actualiser';
                            if (globalLoadingOverlay && !dashboardState.updating) globalLoadingOverlay.style.display = 'none';
                        });
                });
            }
        }
        setupValidationListeners();
        setupMutationObserver();
    }

    function setupMutationObserver() { /* ... (inchangé) ... */
         if (!window.MutationObserver) return;
        let observerTimeout = null;
        const observer = new MutationObserver(function(mutations) {
            let important = false;
            for (const mutation of mutations) {
                if (mutation.type === 'childList' && mutation.addedNodes.length > 0) {
                    for (const node of mutation.addedNodes) {
                        if (node.nodeType === 1 && node.classList && (
                            node.classList.contains('places-dispo') ||
                            node.classList.contains('theme-badge') ||
                            node.classList.contains('counter-value') ||
                            node.querySelector('.places-dispo, .theme-badge, .counter-value')
                        )) {
                            important = true;
                            break;
                        }
                    }
                }
                if (important) break;
            }
            if (important) {
                clearTimeout(observerTimeout);
                observerTimeout = setTimeout(() => {
                    fixDataIssues();
                    enhanceBadgesAndLabels();
                }, 300);
            }
        });
        observer.observe(document.body, { childList: true, subtree: true });
        if (config.debugMode) console.log('Dashboard Core: Mutation observer initialized');
    }


    // ====== COMMUNICATION AVEC L'API ======
    async function _fetchDashboardData(forceRefresh = false, lightMode = false) {
        // ... (logique de fetch existante, s'assurer qu'elle récupère bien les participants) ...
        if (dashboardState.updating && !forceRefresh) {
            if (config.debugMode) console.log('Dashboard Core: Skipping fetch (update in progress, not forced)');
            return Promise.resolve(false); // false = pas de changement
        }

        if (config.errorThrottleMode && !forceRefresh) {
            if (config.debugMode) console.log('Dashboard Core: Skipping fetch (error throttle mode active)');
            return Promise.resolve(false);
        }

        const now = Date.now();
        if (!forceRefresh && now - dashboardState.lastRefresh < config.minRefreshDelay) {
            if (config.debugMode) console.log(`Dashboard Core: Skipping fetch (too soon, ${config.minRefreshDelay - (now - dashboardState.lastRefresh)}ms remaining)`);
            return Promise.resolve(false);
        }

        dashboardState.updating = true;
        if (forceRefresh || now - dashboardState.lastRefresh >= config.minRefreshDelay) { // Mettre à jour lastRefresh seulement si on fetch vraiment
             dashboardState.lastRefresh = now;
        }


        let currentUrl = `${config.baseApiUrl}/dashboard_essential?_=${Date.now()}`;
        if (lightMode && !forceRefresh) { // lightMode pour les polls réguliers
            currentUrl += '&light=1';
        }


        if (globalLoadingOverlay && (forceRefresh || !lightMode)) { // Afficher loader pour fetchs importants
            globalLoadingOverlay.style.display = 'flex';
            globalLoadingOverlay.classList.remove('hidden');
        }

        try {
            if (config.debugMode) console.log(`Dashboard Core: Fetching data from ${currentUrl} (force: ${forceRefresh}, light: ${lightMode})`);

            const controller = new AbortController();
            const timeoutId = setTimeout(() => {
                controller.abort();
                if (config.debugMode) console.warn(`Dashboard Core: Fetch to ${currentUrl} timed out after ${config.fetchTimeoutDuration}ms.`);
            }, config.fetchTimeoutDuration);

            const response = await fetch(currentUrl, {
                method: 'GET',
                headers: {
                    'Accept': 'application/json',
                    'X-Requested-With': 'XMLHttpRequest',
                    'Cache-Control': 'no-cache, no-store, must-revalidate',
                    'Pragma': 'no-cache',
                    'Expires': '0'
                },
                signal: controller.signal
            });

            clearTimeout(timeoutId);

            if (!response.ok) {
                let errorData = { message: `HTTP error ${response.status}`, status: response.status };
                try { errorData = await response.clone().json(); }
                catch (e) { try { errorData.message = await response.clone().text(); } catch (textErr) { /* ignore */ } }

                if (response.status >= 500 && !config.errorThrottleMode) {
                    config.errorThrottleMode = true;
                    if (config.debugMode) console.warn('Dashboard Core: Error throttle mode activated due to server error.');
                    setTimeout(() => { config.errorThrottleMode = false; if (config.debugMode) console.log('Dashboard Core: Error throttle mode deactivated'); }, 60000);
                }
                errorHandler.handleApiError(currentUrl, errorData, response.status);
                return undefined; // Indiquer une erreur
            }

            const data = await response.json();
            if (!data || typeof data !== 'object') {
                console.error('Dashboard Core: Invalid data received from API', data);
                errorHandler.handleApiError(currentUrl, { message: "Invalid data format from API" }, response.status);
                return undefined;
            }

            dashboardState.rawData = data;
            const hasChanged = processData(data, forceRefresh);
            dashboardState.errorCount = 0;
            showErrorWarning(false);

            if (hasChanged) {
                if (config.debugMode) console.log('Dashboard Core: Data updated, triggering dashboardDataRefreshed event');
                document.dispatchEvent(new CustomEvent('dashboardDataRefreshed', { detail: { data: data, source: 'fetch' } }));
            } else {
                if (config.debugMode) console.log('Dashboard Core: No significant data changes detected from fetch.');
            }
            return hasChanged; // true si changé, false sinon

        } catch (error) {
            console.error(`Dashboard Core: Error fetching dashboard data from ${currentUrl}:`, error.name, error.message);
            errorHandler.handleApiError(currentUrl, { message: error.message, name: error.name }, 0); // 0 pour erreur réseau/timeout
            dashboardState.errorCount++;
            if (dashboardState.errorCount >= 3 && !config.errorThrottleMode) {
                config.errorThrottleMode = true;
                console.warn('Dashboard Core: Error throttle mode activated due to multiple errors.');
                setTimeout(() => { config.errorThrottleMode = false; if (config.debugMode) console.log('Dashboard Core: Error throttle mode deactivated'); }, 120000);
            }
            if (dashboardState.errorCount >= dashboardState.maxErrors && dashboardState.pollingActive) {
                console.warn(`Dashboard Core: Too many errors (${dashboardState.errorCount}), pausing polling`);
                dashboardState.pollingActive = false;
                if (dashboardState.pollingTimeout) clearTimeout(dashboardState.pollingTimeout);
                dashboardState.pollingTimeoutScheduled = false;
                showErrorWarning(true);
            }
            return undefined; // Indiquer une erreur
        } finally {
            dashboardState.updating = false;
            if (globalLoadingOverlay && (forceRefresh || !lightMode)) {
                setTimeout(() => {
                    if (!dashboardState.updating) {
                         globalLoadingOverlay.style.display = 'none';
                         globalLoadingOverlay.classList.add('hidden');
                    }
                }, 200);
            }
            if (config.debugMode) console.log('Dashboard Core: Fetch cycle finished.');
        }
    }

    const debouncedFetchDashboardData = debounce(_fetchDashboardData, config.debounceDelay);

    function processData(data, forceRefresh = false) {
        // ... (logique de processData existante, s'assurer qu'elle appelle updateCharts avec les bonnes données) ...
        // Exemple:
        // if (hasChanged || forceRefresh) {
        //    updateCharts(data.sessions || [], data.participants || []);
        // }
        // Cette logique est déjà dans la version précédente de processData.
        if (!data || typeof data !== 'object') {
             console.error("ProcessData: Invalid data received", data);
             return false;
        }
        let hasChangedOverall = forceRefresh; // Commence par true si forceRefresh

        // Traiter les sessions
        if (data.sessions && Array.isArray(data.sessions)) {
            const validatedSessions = data.sessions.map(s => {
                s.places_restantes = s.places_restantes ?? Math.max(0, (s.max_participants || 0) - (s.inscrits || 0));
                return s;
            });
            const sessionsHash = simpleHash(validatedSessions);
            if (sessionsHash !== dashboardState.dataHashes.sessions || forceRefresh) {
                if (typeof window.updateSessionTable === 'function') {
                    window.updateSessionTable(validatedSessions);
                } else {
                    updateSessionTable(validatedSessions);
                }
                updateStatisticsCounters(validatedSessions); // Mettre à jour les compteurs globaux
                dashboardState.dataHashes.sessions = sessionsHash;
                hasChangedOverall = true;
            }
        } else if (dashboardState.dataHashes.sessions !== null || forceRefresh) {
             if (typeof window.updateSessionTable === 'function') window.updateSessionTable([]); else updateSessionTable([]);
             updateStatisticsCounters([]);
             dashboardState.dataHashes.sessions = null;
             hasChangedOverall = true;
        }

        // Traiter les participants
        let participantsChanged = false;
        if (data.participants && Array.isArray(data.participants)) {
             const participantsHash = simpleHash(data.participants);
             if (participantsHash !== dashboardState.dataHashes.participants || forceRefresh) {
                 dashboardState.dataHashes.participants = participantsHash;
                 participantsChanged = true;
                 hasChangedOverall = true;
             }
        } else if (dashboardState.dataHashes.participants !== null || forceRefresh) {
             dashboardState.dataHashes.participants = null;
             participantsChanged = true;
             hasChangedOverall = true;
        }

        // Mettre à jour les graphiques si les données de session OU de participant ont changé
        if (hasChangedOverall) { // Utiliser hasChangedOverall pour décider de mettre à jour les graphiques
            updateCharts(data.sessions || [], data.participants || []);
        }


        // Traiter les activités
        if (data.activites && Array.isArray(data.activites)) {
            const activitiesHash = simpleHash(data.activites);
            if (activitiesHash !== dashboardState.dataHashes.activites || forceRefresh) {
                updateActivityFeed(data.activites);
                dashboardState.dataHashes.activites = activitiesHash;
                hasChangedOverall = true;
            }
        } else if (dashboardState.dataHashes.activites !== null || forceRefresh) {
             updateActivityFeed([]);
             dashboardState.dataHashes.activites = null;
             hasChangedOverall = true;
        }

        if (hasChangedOverall) {
            setTimeout(() => {
                fixDataIssues();
                enhanceBadgesAndLabels();
                initTooltips();
                if (errorHandler && typeof errorHandler.checkAndFixBrokenElements === 'function') {
                    errorHandler.checkAndFixBrokenElements();
                }
            }, 150); // Léger délai pour laisser le DOM se mettre à jour
        }
        return hasChangedOverall;
    }


    // ====== MISE À JOUR DES COMPOSANTS UI ======
    // updateSessionTable, updateStatisticsCounters, updateCounter, updateActivityFeed, getActivityIcon
    // enhanceUI, initTooltips, enhanceBadgesAndLabels, fixDataIssues, checkAndFixHangingModals,
    // enhanceAccessibility, showErrorWarning, setupValidationListeners
    // SONT IDENTIQUES à la version précédente.

    // ====== GRAPHIQUES (Chart.js) ======
    // renderThemeDistributionChartJS, renderServiceDistributionChartJS, generateCustomLegend
    // SONT IDENTIQUES à la version précédente.

    // ====== UTILITAIRES ======
    // simpleHash, getCsrfToken, getRandomColor
    // SONT IDENTIQUES à la version précédente.
    function debounce(func, delay) { /* ... (inchangé) ... */
        let timeout;
        return function(...args) {
            const context = this;
            clearTimeout(timeout);
            timeout = setTimeout(() => func.apply(context, args), delay);
        };
    }
    function simpleHash(obj) { /* ... (inchangé) ... */
         const str = JSON.stringify(obj);
        let hash = 0;
        if (str.length === 0) return hash;
        for (let i = 0; i < str.length; i++) {
            const char = str.charCodeAt(i);
            hash = ((hash << 5) - hash) + char;
            hash |= 0; // Convert to 32bit integer
        }
        return hash;
    }
    function getCsrfToken() { /* ... (inchangé) ... */
         const meta = document.querySelector('meta[name="csrf-token"]');
        if (meta) return meta.content;
        const input = document.querySelector('input[name="csrf_token"]');
        if (input) return input.value;
        return '';
    }
    // Les fonctions de rendu UI (updateSessionTable, etc.) et les helpers (getRandomColor, etc.)
    // sont supposés être définis comme dans les versions précédentes.
    // Je vais inclure les fonctions de rendu des graphiques pour la complétude.

    function initializeCharts() {
        if (config.chartRendering === 'none' || typeof Chart === 'undefined') {
            if(config.debugMode && typeof Chart === 'undefined') console.warn("Chart.js n'est pas chargé. Graphiques dynamiques désactivés.");
            return;
        }
        // Initialiser avec des structures vides, les données viendront plus tard
        renderThemeDistributionChartJS([]);
        renderServiceDistributionChartJS([]);
    }

    function updateCharts(sessions, participants) {
        if (config.chartRendering === 'none' || typeof Chart === 'undefined') return;
        renderThemeDistributionChartJS(sessions || []);
        renderServiceDistributionChartJS(participants || []);
    }

    function renderThemeDistributionChartJS(sessionsData) {
        const ctx = document.getElementById('themeDistributionChart')?.getContext('2d');
        const legendContainer = document.getElementById('themeChartLegend');
        if (!ctx) return;

        const parentDiv = ctx.canvas.parentNode;
        let noDataMsg = parentDiv.querySelector('.no-data-message-chart');

        if (!sessionsData || sessionsData.filter(s => (s.inscrits || 0) > 0).length === 0) {
            if (dashboardState.themeChartInstance) {
                dashboardState.themeChartInstance.destroy();
                dashboardState.themeChartInstance = null;
            }
            ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);
            if (!noDataMsg) {
                 noDataMsg = document.createElement('div');
                 noDataMsg.className = 'no-data-message-chart';
                 parentDiv.appendChild(noDataMsg);
            }
            noDataMsg.innerHTML = '<i class="fas fa-info-circle me-2"></i>Aucune inscription pour afficher la répartition.';
            if(legendContainer) legendContainer.innerHTML = '';
            return;
        }
        if (noDataMsg) noDataMsg.remove();

        const themeInscriptionCounts = sessionsData.reduce((acc, session) => {
            const themeName = session.theme || 'Non défini';
            acc[themeName] = (acc[themeName] || 0) + (session.inscrits || 0);
            return acc;
        }, {});

        const labels = Object.keys(themeInscriptionCounts).filter(key => themeInscriptionCounts[key] > 0);
        const dataValues = labels.map(label => themeInscriptionCounts[label]);
        const themeColorsConfig = window.themesDataForChart || {};
        const backgroundColors = labels.map((label, index) => themeColorsConfig[label]?.color || getRandomColor(index));

        const chartData = {
            labels: labels,
            datasets: [{
                label: 'Inscriptions par Thème', data: dataValues, backgroundColor: backgroundColors,
                borderColor: '#fff', borderWidth: 2, hoverOffset: 8
            }]
        };
        const chartOptions = {
            responsive: true, maintainAspectRatio: false, animation: { animateScale: true, animateRotate: true, duration: 800 },
            plugins: {
                legend: { display: false },
                tooltip: {
                    backgroundColor: 'rgba(0,0,0,0.8)', titleFont: { size: 14 }, bodyFont: { size: 12 }, padding: 10,
                    callbacks: {
                        label: function(context) {
                            let label = context.label || '';
                            if (label) label += ': ';
                            if (context.parsed !== null) label += context.parsed;
                            const total = context.dataset.data.reduce((a, b) => a + b, 0);
                            const percentage = total > 0 ? ((context.parsed / total) * 100).toFixed(1) + '%' : '0%';
                            label += ` (${percentage})`;
                            return label;
                        }
                    }
                }
            }
        };
        if (dashboardState.themeChartInstance) {
            dashboardState.themeChartInstance.data = chartData;
            dashboardState.themeChartInstance.update();
        } else {
            dashboardState.themeChartInstance = new Chart(ctx, { type: 'doughnut', data: chartData, options: chartOptions });
        }
        generateCustomLegend(legendContainer, labels, backgroundColors, dataValues, themeColorsConfig);
    }

    function renderServiceDistributionChartJS(participantsData) {
        const ctx = document.getElementById('serviceDistributionChart')?.getContext('2d');
        const legendContainer = document.getElementById('serviceChartLegend');
        if (!ctx) return;

        const parentDiv = ctx.canvas.parentNode;
        let noDataMsg = parentDiv.querySelector('.no-data-message-chart');

        if (!participantsData || participantsData.length === 0) {
            if (dashboardState.serviceChartInstance) {
                dashboardState.serviceChartInstance.destroy();
                dashboardState.serviceChartInstance = null;
            }
            ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);
            if (!noDataMsg) {
                noDataMsg = document.createElement('div');
                noDataMsg.className = 'no-data-message-chart';
                parentDiv.appendChild(noDataMsg);
            }
            noDataMsg.innerHTML = '<i class="fas fa-info-circle me-2"></i>Aucun participant pour afficher la répartition.';
            if(legendContainer) legendContainer.innerHTML = '';
            return;
        }
        if (noDataMsg) noDataMsg.remove();

        const serviceCounts = participantsData.reduce((acc, participant) => {
            const serviceName = participant.service || 'Non défini';
            acc[serviceName] = (acc[serviceName] || 0) + 1;
            return acc;
        }, {});

        const labels = Object.keys(serviceCounts).filter(key => serviceCounts[key] > 0);
        const dataValues = labels.map(label => serviceCounts[label]);
        const serviceColorsConfig = window.servicesDataForChart || {};
        const backgroundColors = labels.map((label, index) => serviceColorsConfig[label]?.color || getRandomColor(index + labels.length));

        const chartData = {
            labels: labels,
            datasets: [{
                label: 'Participants par Service', data: dataValues, backgroundColor: backgroundColors,
                borderColor: backgroundColors.map(color => Chart.helpers.color(color).darken(0.2).rgbString()),
                borderWidth: 1, borderRadius: 4, barPercentage: 0.7, categoryPercentage: 0.8
            }]
        };
        const chartOptions = {
            indexAxis: 'y', responsive: true, maintainAspectRatio: false,
            scales: { x: { beginAtZero: true, ticks: { precision: 0 }, grid: { display: true, color: 'rgba(0,0,0,0.05)' } }, y: { grid: { display: false } } },
            plugins: { legend: { display: false }, tooltip: { backgroundColor: 'rgba(0,0,0,0.8)', callbacks: { label: function(context) { return `${context.label}: ${context.raw} participant(s)`; } } } },
            animation: { duration: 800 }
        };
        if (dashboardState.serviceChartInstance) {
            dashboardState.serviceChartInstance.data = chartData;
            dashboardState.serviceChartInstance.update();
        } else {
            dashboardState.serviceChartInstance = new Chart(ctx, { type: 'bar', data: chartData, options: chartOptions });
        }
        if(legendContainer) generateCustomLegend(legendContainer, labels, backgroundColors, dataValues, serviceColorsConfig, true);
    }

    function generateCustomLegend(container, labels, colors, values, configData, isServiceChart = false) {
        if (!container) return;
        let legendHtml = '';
        const total = values.reduce((sum, count) => sum + count, 0);
        labels.forEach((label, index) => {
            if (values[index] === 0 && !isServiceChart) return;
            const color = colors[index];
            const value = values[index];
            const percentage = total > 0 && !isServiceChart ? `(${(value / total * 100).toFixed(1)}%)` : '';
            const description = configData[label]?.description || label;
            legendHtml += `<div class="legend-item" title="${description}" style="opacity:0; animation: fadeInLegend 0.5s ease ${index * 0.1}s forwards;"><span class="legend-color" style="background-color: ${color};"></span><span class="legend-label">${label}</span><span class="legend-value">${value} ${percentage}</span></div>`;
        });
        container.innerHTML = legendHtml;
    }
    if (!document.getElementById('fadeInLegendStyle')) {
        const styleSheet = document.createElement("style");
        styleSheet.id = 'fadeInLegendStyle';
        styleSheet.innerText = "@keyframes fadeInLegend { to { opacity: 1; } }";
        document.head.appendChild(styleSheet);
    }


    // Exposer les fonctions nécessaires à dashboard-init.js
    window.dashboardCore = {
        initialize: initializeDashboard, // dashboard-init peut appeler ceci si besoin, mais core s'auto-initialise
        fetchData: debouncedFetchDashboardData, // Pour le bouton refresh
        // Les fonctions suivantes sont appelées en interne par processData ou initializeCharts
        updateCharts: updateCharts,
        updateStatisticsCounters: updateStatisticsCounters,
        updateActivityFeed: updateActivityFeed,
        initializeCharts: initializeCharts, // Exposer pour dashboard-init
        // Fonctions utilitaires si dashboard-init en a besoin
        getState: () => dashboardState,
        getConfig: () => config,
        startPolling: startPolling,
        stopPolling: () => {
             dashboardState.pollingActive = false;
             if(dashboardState.pollingTimeout) clearTimeout(dashboardState.pollingTimeout);
             dashboardState.pollingTimeoutScheduled = false;
             if(config.debugMode) console.log("Dashboard Core: Polling stopped manually.");
        }
    };

    // Démarrer l'initialisation de dashboard-core
    initializeDashboard();

    // Émettre l'événement dashboardCoreReady une fois que tout est défini et initialisé
    if (config.debugMode) console.log('Dashboard Core: Dispatching dashboardCoreReady event.');
    document.dispatchEvent(new CustomEvent('dashboardCoreReady', { detail: { dashboardCore: window.dashboardCore } }));

}); // Fin du DOMContentLoaded pour dashboard-core.js

// Fonction showToast globale (si non définie ailleurs)
if (typeof window.showToast !== 'function') {
    window.showToast = function(message, type = 'info', duration = 5000) {
         const toastContainer = document.getElementById('toast-container') || (() => {
            const container = document.createElement('div');
            container.id = 'toast-container';
            container.className = 'toast-container position-fixed top-0 end-0 p-3';
            document.body.appendChild(container);
            return container;
        })();

        const toastId = 'toast-' + Date.now();
        const toastElement = document.createElement('div');
        toastElement.id = toastId;
        const validTypes = ['primary', 'secondary', 'success', 'danger', 'warning', 'info', 'light', 'dark'];
        const bgType = validTypes.includes(type) ? type : 'info';
        const textClass = (bgType === 'light' || bgType === 'warning') ? 'text-dark' : 'text-white';

        toastElement.className = `toast align-items-center ${textClass} bg-${bgType} border-0 fade`;
        toastElement.setAttribute('role', 'alert');
        toastElement.setAttribute('aria-live', 'assertive');
        toastElement.setAttribute('aria-atomic', 'true');

        toastElement.innerHTML = `
            <div class="d-flex">
                <div class="toast-body">
                    ${message}
                </div>
                <button type="button" class="btn-close ${textClass === 'text-white' ? 'btn-close-white' : ''} me-2 m-auto" data-bs-dismiss="toast" aria-label="Close"></button>
            </div>
        `;
        toastContainer.appendChild(toastElement);

        const bsToast = new bootstrap.Toast(toastElement, { delay: duration, autohide: true });
        bsToast.show();
        toastElement.addEventListener('hidden.bs.toast', () => {
            toastElement.remove();
        });
    };
}
