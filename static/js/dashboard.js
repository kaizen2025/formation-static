/**
 * dashboard-core.js - Fichier JavaScript optimisé pour le tableau de bord
 * Version: 1.6.2 - Intégration Chart.js pour graphiques dynamiques
 */

document.addEventListener('DOMContentLoaded', function() {
    console.log('Dashboard Core: Initializing (v1.6.2)');

    if (window.dashboardCoreInitialized) {
        console.log('Dashboard Core: Already initialized. Skipping.');
        return;
    }
    window.dashboardCoreInitialized = true;

    const globalLoadingOverlay = document.getElementById('loading-overlay');
    const dashInitConfig = window.dashboardConfig || {};

    const config = {
        debugMode: dashInitConfig.debugMode || false,
        refreshInterval: dashInitConfig.autoRefreshInterval || 120000, // Augmenté pour moins de requêtes
        minRefreshDelay: dashInitConfig.minRefreshDelay || 30000,
        debounceDelay: dashInitConfig.debounceDelay || 1000,
        baseApiUrl: dashInitConfig.baseApiUrl || '/api',
        chartRendering: dashInitConfig.chartRendering || 'auto', // 'auto', 'canvas', 'none'
        usingDashboardInit: !!dashInitConfig.autoRefreshInterval || !!dashInitConfig.preferredMode,
        socketEnabled: dashInitConfig.socketEnabled !== undefined ? dashInitConfig.socketEnabled : true,
        pollingEnabled: dashInitConfig.pollingEnabled !== undefined ? dashInitConfig.pollingEnabled : true,
        preferredMode: dashInitConfig.preferredMode || 'auto',
        errorThrottleMode: false,
        fetchTimeoutDuration: 15000
    };

    if (config.debugMode) console.log(`Dashboard Core: Configured`, config);

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
        themeChartInstance: null,      // Renommé pour clarté
        serviceChartInstance: null,    // Renommé pour clarté
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

        if (!config.usingDashboardInit) {
            setupEventListeners();
            startPolling();
        } else {
            // Exposer les fonctions pour dashboard-init.js
            window.forcePollingUpdate = (forceRefresh) => debouncedFetchDashboardData(forceRefresh);
            window.updateStatsCounters = (sessions) => updateStatisticsCounters(sessions || dashboardState.rawData.sessions);
            window.refreshRecentActivity = () => updateActivityFeed(null); // Forcera un fetch
            window.chartModule = {
                initialize: initializeCharts,
                update: (sessions, participants) => updateCharts(sessions || dashboardState.rawData.sessions, participants || dashboardState.rawData.participants)
            };
        }

        debouncedFetchDashboardData(true); // Premier chargement des données

        if (config.debugMode) console.log('Dashboard Core: Initialization sequence complete.');
    }

    // ... (startPolling, setupEventListeners, setupMutationObserver - peuvent rester les mêmes) ...

    // ====== COMMUNICATION AVEC L'API ======
    async function _fetchDashboardData(forceRefresh = false, lightMode = false) {
        // ... (logique de fetch existante, s'assurer qu'elle récupère bien les participants) ...
        // Le endpoint /api/dashboard_essential devrait déjà renvoyer sessions, participants, activites
        if (dashboardState.updating && !forceRefresh) {
            if (config.debugMode) console.log('Dashboard Core: Skipping fetch (update in progress, not forced)');
            return Promise.resolve(false);
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
        if (!forceRefresh || (forceRefresh && now - dashboardState.lastRefresh >= config.minRefreshDelay)) {
             dashboardState.lastRefresh = now;
        }

        let updateSucceeded = false;
        let currentUrl = '';

        if (globalLoadingOverlay && (forceRefresh || !lightMode)) {
            globalLoadingOverlay.style.display = 'flex';
            globalLoadingOverlay.classList.remove('hidden');
        }

        try {
            currentUrl = `${config.baseApiUrl}/dashboard_essential?_=${Date.now()}`;

            if (config.debugMode) console.log(`Dashboard Core: Fetching data from ${currentUrl}`);

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
                try {
                    const clonedResponse = response.clone();
                    errorData = await clonedResponse.json();
                } catch (e) {
                    if (config.debugMode) console.warn('Dashboard Core: Failed to parse error response as JSON.', e);
                }

                if (response.status >= 500 && !config.errorThrottleMode) {
                    config.errorThrottleMode = true;
                    if (config.debugMode) console.warn('Dashboard Core: Error throttle mode activated due to server error.');
                    setTimeout(() => {
                        config.errorThrottleMode = false;
                        if (config.debugMode) console.log('Dashboard Core: Error throttle mode deactivated');
                    }, 60000);
                }

                errorHandler.handleApiError(currentUrl, errorData, response.status);
                return false;
            }

            const data = await response.json();
            if (!data || typeof data !== 'object') {
                console.error('Dashboard Core: Invalid data received from API', data);
                errorHandler.handleApiError(currentUrl, { message: "Invalid data format from API" }, response.status);
                return false;
            }

            dashboardState.rawData = data; // Stocker les données brutes

            const hasChanged = processData(data, forceRefresh);
            dashboardState.errorCount = 0;
            showErrorWarning(false);
            updateSucceeded = true;

            if (hasChanged) {
                if (config.debugMode) console.log('Dashboard Core: Data updated, triggering dashboardDataRefreshed event');
                document.dispatchEvent(new CustomEvent('dashboardDataRefreshed', { detail: { data: data } }));
            } else {
                if (config.debugMode) console.log('Dashboard Core: No significant data changes detected');
            }

            return hasChanged;

        } catch (error) {
            console.error(`Dashboard Core: Error fetching dashboard data from ${currentUrl}:`, error.name, error.message);
            errorHandler.handleApiError(currentUrl, { message: error.message, name: error.name }, 0);

            dashboardState.errorCount++;
            if (dashboardState.errorCount >= 3 && !config.errorThrottleMode) {
                config.errorThrottleMode = true;
                console.warn('Dashboard Core: Error throttle mode activated due to multiple errors.');
                setTimeout(() => {
                    config.errorThrottleMode = false;
                    if (config.debugMode) console.log('Dashboard Core: Error throttle mode deactivated');
                }, 120000);
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
        if (!data || typeof data !== 'object') {
             console.error("ProcessData: Invalid data received", data);
             return false;
        }
        let hasChanged = forceRefresh;

        // Traiter les sessions
        if (data.sessions && Array.isArray(data.sessions)) {
            const validatedSessions = data.sessions.map(s => {
                s.places_restantes = s.places_restantes ?? Math.max(0, (s.max_participants || 0) - (s.inscrits || 0));
                return s;
            });
            const sessionsHash = simpleHash(validatedSessions);
            if (sessionsHash !== dashboardState.dataHashes.sessions || forceRefresh) {
                if (typeof window.updateSessionTable === 'function') { // Si dashboard.js est séparé
                    window.updateSessionTable(validatedSessions);
                } else {
                    updateSessionTable(validatedSessions); // Si c'est dans ce fichier
                }
                updateStatisticsCounters(validatedSessions);
                dashboardState.dataHashes.sessions = sessionsHash;
                hasChanged = true;
            }
        } else if (dashboardState.dataHashes.sessions !== null || forceRefresh) { // Forcer la mise à jour si les données sont manquantes
             if (typeof window.updateSessionTable === 'function') window.updateSessionTable([]); else updateSessionTable([]);
             updateStatisticsCounters([]);
             dashboardState.dataHashes.sessions = null;
             hasChanged = true;
        }

        // Traiter les participants
        if (data.participants && Array.isArray(data.participants)) {
             const participantsHash = simpleHash(data.participants);
             if (participantsHash !== dashboardState.dataHashes.participants || forceRefresh) {
                 dashboardState.dataHashes.participants = participantsHash;
                 hasChanged = true; // Marquer comme changé, les graphiques seront mis à jour
             }
        } else if (dashboardState.dataHashes.participants !== null || forceRefresh) {
             dashboardState.dataHashes.participants = null;
             hasChanged = true;
        }

        // Mettre à jour les graphiques si les données de session OU de participant ont changé
        if (hasChanged) {
            updateCharts(data.sessions || [], data.participants || []);
        }


        // Traiter les activités
        if (data.activites && Array.isArray(data.activites)) {
            const activitiesHash = simpleHash(data.activites);
            if (activitiesHash !== dashboardState.dataHashes.activites || forceRefresh) {
                updateActivityFeed(data.activites);
                dashboardState.dataHashes.activites = activitiesHash;
                hasChanged = true;
            }
        } else if (dashboardState.dataHashes.activites !== null || forceRefresh) {
             updateActivityFeed([]);
             dashboardState.dataHashes.activites = null;
             hasChanged = true;
        }

        if (hasChanged) {
            setTimeout(() => {
                fixDataIssues();
                enhanceBadgesAndLabels();
                initTooltips();
                errorHandler.checkAndFixBrokenElements();
            }, 100);
        }
        return hasChanged;
    }


    // ... (updateSessionTable, updateStatisticsCounters, updateCounter, updateActivityFeed, getActivityIcon - peuvent rester les mêmes) ...
    // ... (enhanceUI, initTooltips, enhanceBadgesAndLabels, fixDataIssues, etc. - peuvent rester les mêmes) ...

    // ====== GRAPHIQUES (MODIFIÉ POUR CHART.JS) ======
    // Les fonctions renderThemeDistributionChartJS, renderServiceDistributionChartJS, generateCustomLegend
    // et getRandomColor sont celles fournies dans la réponse précédente.
    // Assurez-vous qu'elles utilisent dashboardState.themeChartInstance et dashboardState.serviceChartInstance

    function renderThemeDistributionChartJS(sessionsData) {
        const ctx = document.getElementById('themeDistributionChart')?.getContext('2d');
        const legendContainer = document.getElementById('themeChartLegend');
        if (!ctx) {
            if (config.debugMode) console.warn("Canvas 'themeDistributionChart' non trouvé.");
            return;
        }

        const parentDiv = ctx.canvas.parentNode;
        const existingNoDataMsg = parentDiv.querySelector('.no-data-message-chart');
        if (existingNoDataMsg) existingNoDataMsg.remove();


        if (!sessionsData || sessionsData.filter(s => (s.inscrits || 0) > 0).length === 0) { // Vérifier s'il y a des inscrits
            if (dashboardState.themeChartInstance) {
                dashboardState.themeChartInstance.destroy();
                dashboardState.themeChartInstance = null;
            }
            ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);
            if (!parentDiv.querySelector('.no-data-message-chart')) {
                 parentDiv.insertAdjacentHTML('beforeend', '<div class="no-data-message-chart"><i class="fas fa-info-circle me-2"></i>Aucune inscription pour afficher la répartition.</div>');
            }
            if(legendContainer) legendContainer.innerHTML = '';
            return;
        }

        const themeInscriptionCounts = sessionsData.reduce((acc, session) => {
            const themeName = session.theme || 'Non défini';
            acc[themeName] = (acc[themeName] || 0) + (session.inscrits || 0);
            return acc;
        }, {});

        const labels = Object.keys(themeInscriptionCounts).filter(key => themeInscriptionCounts[key] > 0); // Filtrer thèmes sans inscrits
        const dataValues = labels.map(label => themeInscriptionCounts[label]);
        const themeColorsConfig = window.themesDataForChart || {};
        const backgroundColors = labels.map((label, index) => themeColorsConfig[label]?.color || getRandomColor(index));

        const chartData = {
            labels: labels,
            datasets: [{
                label: 'Inscriptions par Thème',
                data: dataValues,
                backgroundColor: backgroundColors,
                borderColor: '#fff',
                borderWidth: 2,
                hoverOffset: 8
            }]
        };

        const chartOptions = {
            responsive: true,
            maintainAspectRatio: false,
            animation: {
                animateScale: true,
                animateRotate: true,
                duration: 800
            },
            plugins: {
                legend: {
                    display: false,
                },
                tooltip: {
                    backgroundColor: 'rgba(0,0,0,0.8)',
                    titleFont: { size: 14 },
                    bodyFont: { size: 12 },
                    padding: 10,
                    callbacks: {
                        label: function(context) {
                            let label = context.label || '';
                            if (label) { label += ': '; }
                            if (context.parsed !== null) { label += context.parsed; }
                            const total = context.dataset.data.reduce((a, b) => a + b, 0);
                            const percentage = total > 0 ? ((context.parsed / total) * 100).toFixed(1) + '%' : '0%';
                            label += ` (${percentage})`;
                            return label;
                        }
                    }
                }
            },
            onClick: (event, elements) => {
                // ... (logique de clic si nécessaire) ...
            }
        };

        if (dashboardState.themeChartInstance) {
            dashboardState.themeChartInstance.data = chartData;
            dashboardState.themeChartInstance.update();
        } else {
            dashboardState.themeChartInstance = new Chart(ctx, {
                type: 'doughnut',
                data: chartData,
                options: chartOptions
            });
        }
        generateCustomLegend(legendContainer, labels, backgroundColors, dataValues, themeColorsConfig);
    }

    function renderServiceDistributionChartJS(participantsData) {
        const ctx = document.getElementById('serviceDistributionChart')?.getContext('2d');
        const legendContainer = document.getElementById('serviceChartLegend'); // Optionnel pour bar chart
        if (!ctx) {
            if (config.debugMode) console.warn("Canvas 'serviceDistributionChart' non trouvé.");
            return;
        }

        const parentDiv = ctx.canvas.parentNode;
        const existingNoDataMsg = parentDiv.querySelector('.no-data-message-chart');
        if (existingNoDataMsg) existingNoDataMsg.remove();

        if (!participantsData || participantsData.length === 0) {
            if (dashboardState.serviceChartInstance) {
                dashboardState.serviceChartInstance.destroy();
                dashboardState.serviceChartInstance = null;
            }
            ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);
             if (!parentDiv.querySelector('.no-data-message-chart')) {
                parentDiv.insertAdjacentHTML('beforeend','<div class="no-data-message-chart"><i class="fas fa-info-circle me-2"></i>Aucun participant pour afficher la répartition.</div>');
            }
            if(legendContainer) legendContainer.innerHTML = '';
            return;
        }

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
                label: 'Participants par Service',
                data: dataValues,
                backgroundColor: backgroundColors,
                borderColor: backgroundColors.map(color => Chart.helpers.color(color).darken(0.2).rgbString()),
                borderWidth: 1,
                borderRadius: 4,
                barPercentage: 0.7,
                categoryPercentage: 0.8
            }]
        };

        const chartOptions = {
            indexAxis: 'y',
            responsive: true,
            maintainAspectRatio: false,
            scales: {
                x: {
                    beginAtZero: true,
                    ticks: { precision: 0 },
                    grid: { display: true, color: 'rgba(0,0,0,0.05)' }
                },
                y: {
                    grid: { display: false }
                }
            },
            plugins: {
                legend: { display: false },
                tooltip: {
                    backgroundColor: 'rgba(0,0,0,0.8)',
                    callbacks: {
                        label: function(context) {
                            return `${context.label}: ${context.raw} participant(s)`;
                        }
                    }
                }
            },
            animation: { duration: 800 }
        };

        if (dashboardState.serviceChartInstance) {
            dashboardState.serviceChartInstance.data = chartData;
            dashboardState.serviceChartInstance.update();
        } else {
            dashboardState.serviceChartInstance = new Chart(ctx, {
                type: 'bar',
                data: chartData,
                options: chartOptions
            });
        }
        // La légende pour le bar chart est souvent moins utile ou intégrée
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
            const percentage = total > 0 && !isServiceChart ? ((value / total) * 100).toFixed(1) + '%' : ''; // Pourcentage pour donut
            const description = configData[label]?.description || label;

            legendHtml += `
                <div class="legend-item" title="${description}" style="opacity:0; animation: fadeInLegend 0.5s ease ${index * 0.1}s forwards;">
                    <span class="legend-color" style="background-color: ${color};"></span>
                    <span class="legend-label">${label}</span>
                    <span class="legend-value">${value} ${percentage ? `(${percentage})` : ''}</span>
                </div>`;
        });
        container.innerHTML = legendHtml;
    }
    // Ajouter une keyframe pour la légende
    const styleSheet = document.createElement("style");
    styleSheet.type = "text/css";
    styleSheet.innerText = "@keyframes fadeInLegend { to { opacity: 1; } }";
    document.head.appendChild(styleSheet);


    // ... (debounce, simpleHash, getCsrfToken, etc.) ...
    function debounce(func, delay) {
        let timeout;
        return function(...args) {
            const context = this;
            clearTimeout(timeout);
            timeout = setTimeout(() => func.apply(context, args), delay);
        };
    }


    // Exposer des fonctions si nécessaire
    window.dashboardCore = {
        initialize: initializeDashboard,
        fetchData: debouncedFetchDashboardData,
        updateCharts: updateCharts,
        updateStatistics: updateStatisticsCounters,
        updateActivity: updateActivityFeed,
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

    // Démarrer le tableau de bord
    initializeDashboard();
});

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
        const textClass = (bgType === 'light' || bgType === 'warning') ? 'text-dark' : 'text-white'; // Ajustement pour warning

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
