/**
 * dashboard-core.js - Module principal du tableau de bord
 * Version: 1.7.1 - Fichier complet avec toutes les fonctions internes
 */

document.addEventListener('DOMContentLoaded', function() {
    if (window.dashboardCoreInitialized) {
        if (window.dashboardConfig && window.dashboardConfig.debugMode) {
            console.log('Dashboard Core: Already initialized. Skipping.');
        }
        if (window.dashboardCore) {
             document.dispatchEvent(new CustomEvent('dashboardCoreFullyReady', { detail: { success: true, source: 'cached' } }));
        }
        return;
    }
    window.dashboardCoreInitialized = true;

    const dashConfigGlobal = window.dashboardConfig || {};
    const config = {
        debugMode: dashConfigGlobal.debugMode || false,
        refreshInterval: dashConfigGlobal.autoRefreshInterval || 60000,
        minRefreshDelay: dashConfigGlobal.minRefreshDelay || 15000,
        debounceDelay: dashConfigGlobal.debounceDelay || 500,
        baseApiUrl: dashConfigGlobal.baseApiUrl || '/api',
        fetchTimeoutDuration: dashConfigGlobal.fetchTimeoutDuration || 20000,
        maxErrors: dashConfigGlobal.maxErrors || 5,
        errorThrottleDelay: dashConfigGlobal.errorThrottleDelay || 60000,
        chartRendering: dashConfigGlobal.chartRendering || 'auto', // Ajouté pour la config des graphiques
        ...dashConfigGlobal
    };

    if (config.debugMode) {
        console.log('Dashboard Core: Initializing (v1.7.1)');
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

    const errorHandler = window.apiErrorHandler || {
        handleApiError: (endpoint, errorData, statusCode) => {
            console.error(`Fallback Error Handler: Erreur ${statusCode} sur ${endpoint}`, errorData);
            if (typeof showToast === 'function') showToast(`Erreur ${statusCode} lors du chargement de ${endpoint}`, 'danger');
        },
        checkAndFixBrokenElements: () => {
            if (config.debugMode) console.log("Dashboard Core: Fallback checkAndFixBrokenElements called.");
            fixDataIssues();
            enhanceBadgesAndLabels();
        }
    };

    // --- Fonctions principales ---
    async function initializeDashboard() {
        if (config.debugMode) console.log('Dashboard Core: Starting main initialization.');
        showGlobalLoading(true);
        setupStaticEventListeners();
        setupMutationObserver();
        initializeCharts(); // Initialiser la structure des graphiques

        try {
            await fetchAndProcessData(true); // Premier fetch forcé
            startPolling();
        } catch (error) {
            console.error('Dashboard Core: Critical error during initial data load.', error);
            if (typeof showToast === 'function') showToast("Erreur critique au chargement du tableau de bord.", "danger");
        } finally {
            showGlobalLoading(false);
            document.dispatchEvent(new CustomEvent('dashboardCoreFullyReady', { detail: { success: dashboardState.errorCount === 0 } }));
            if (config.debugMode) console.log('Dashboard Core: Dispatched dashboardCoreFullyReady event.');
        }
    }

    const debouncedFetchAndProcessData = debounce(fetchAndProcessData, config.debounceDelay);

    async function fetchAndProcessData(forceRefresh = false, isLightPoll = false) {
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

            dashboardState.rawData = data;
            const hasChanged = processData(data, forceRefresh);
            dashboardState.errorCount = 0;
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
            return undefined;
        } finally {
            dashboardState.isUpdating = false;
            if (forceRefresh && !isLightPoll) showGlobalLoading(false);
        }
    }

    function processData(data, forceRefresh) {
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
        if (hasChangedOverall) {
            updateCharts(data.sessions || [], data.participants || []);
        }
        setTimeout(() => {
            fixDataIssues();
            enhanceBadgesAndLabels();
            initTooltips();
            errorHandler.checkAndFixBrokenElements?.();
        }, 100);
        return hasChangedOverall;
    }

    function startPolling() {
        if (!config.pollingEnabled || (window.dashboardConfig && window.dashboardConfig.activeMode && window.dashboardConfig.activeMode !== 'polling')) {
            if (config.debugMode) console.log("Dashboard Core: Polling disabled or not the active mode.");
            return;
        }
        clearTimeout(dashboardState.pollingTimeoutId);
        const poll = async () => {
            if (document.visibilityState === 'visible' && !dashboardState.isUpdating && !dashboardState.isErrorThrottleActive) {
                await fetchAndProcessData(false, true);
            }
            if (config.pollingEnabled) {
                 dashboardState.pollingTimeoutId = setTimeout(poll, config.refreshInterval);
            }
        };
        dashboardState.pollingTimeoutId = setTimeout(poll, config.refreshInterval);
        if (config.debugMode) console.log(`Dashboard Core: Polling started (interval: ${config.refreshInterval}ms).`);
    }

    function stopPolling() {
        clearTimeout(dashboardState.pollingTimeoutId);
        dashboardState.pollingTimeoutId = null;
        if (config.debugMode) console.log("Dashboard Core: Polling stopped.");
    }

    // --- Fonctions UI ---
    function updateSessionTable(sessions) {
        if (!sessions || !Array.isArray(sessions)) return;
        const sessionTableBody = document.querySelector('.session-table tbody, #sessions-table tbody');
        if (!sessionTableBody) return;
        sessionTableBody.innerHTML = '';
        if (sessions.length === 0) {
             const cols = sessionTableBody.closest('table')?.querySelectorAll('thead th').length || 5;
             sessionTableBody.innerHTML = `<tr class="no-data-row"><td colspan="${cols}" class="text-center p-4 text-muted">Aucune session à afficher.</td></tr>`;
             return;
        }
        sessions.forEach(session => {
            const maxP = session.max_participants || 0;
            const placesR = session.places_restantes !== undefined ? session.places_restantes : (maxP - (session.inscrits || 0));
            let placesClass = 'text-secondary', placesIcon = 'fa-question-circle';
            if (typeof placesR === 'number' && !isNaN(placesR)) {
                if (placesR <= 0) { placesClass = 'text-danger'; placesIcon = 'fa-times-circle'; }
                else if (placesR <= Math.floor(maxP * 0.3)) { placesClass = 'text-warning'; placesIcon = 'fa-exclamation-triangle'; }
                else { placesClass = 'text-success'; placesIcon = 'fa-check-circle'; }
            }
            const rowHtml = `
                <tr class="session-row" data-session-id="${session.id}" data-theme="${session.theme || 'N/A'}" data-full="${placesR <= 0 ? '1' : '0'}">
                    <td><span class="fw-bold d-block">${session.date || 'N/A'}</span><small class="text-secondary">${session.horaire || 'N/A'}</small></td>
                    <td class="theme-cell"><span class="theme-badge" data-theme="${session.theme || 'N/A'}" data-bs-toggle="tooltip" data-bs-placement="top" title="${(window.themesDataForChart && window.themesDataForChart[session.theme]) ? window.themesDataForChart[session.theme].description : ''}">${session.theme || 'N/A'}</span></td>
                    <td class="places-dispo text-nowrap ${placesClass}"><i class="fas ${placesIcon} me-1"></i> ${placesR} / ${maxP}</td>
                    <td class="js-salle-cell">${session.salle || '<span class="badge bg-secondary">Non définie</span>'}</td>
                    <td class="text-nowrap text-center">
                        <button type="button" class="btn btn-sm btn-outline-secondary me-1" data-bs-toggle="modal" data-bs-target="#participantsModal_${session.id}" title="Voir participants"><i class="fas fa-users"></i> <span class="badge bg-secondary ms-1">${session.inscrits || 0}</span></button>
                        <button type="button" class="btn btn-sm btn-primary" data-bs-toggle="modal" data-bs-target="#inscriptionModal_${session.id}" title="Inscrire"><i class="fas fa-plus"></i></button>
                    </td>
                </tr>`;
            sessionTableBody.insertAdjacentHTML('beforeend', rowHtml);
        });
    }

    function updateStatisticsCounters(sessions) {
        let stats = { totalInscriptions: 0, totalEnAttente: 0, totalSessions: 0, totalSessionsCompletes: 0 };
        if (sessions && Array.isArray(sessions)) {
            stats.totalSessions = sessions.length;
            sessions.forEach(session => {
                stats.totalInscriptions += (session.inscrits || 0);
                stats.totalEnAttente += (session.liste_attente || 0);
                const placesR = session.places_restantes !== undefined ? session.places_restantes : ((session.max_participants || 0) - (session.inscrits || 0));
                if (placesR <= 0) stats.totalSessionsCompletes++;
            });
        }
        document.getElementById('total-inscriptions')?.textContent = stats.totalInscriptions.toLocaleString();
        document.getElementById('total-en-attente')?.textContent = stats.totalEnAttente.toLocaleString();
        document.getElementById('total-sessions')?.textContent = stats.totalSessions.toLocaleString();
        document.getElementById('total-sessions-completes')?.textContent = stats.totalSessionsCompletes.toLocaleString();
    }

    function updateActivityFeed(activities) {
        const container = document.getElementById('recent-activity');
        if (!container) return;
        const spinner = container.querySelector('.loading-spinner');
        if (spinner) spinner.remove();
        if (!activities || activities.length === 0) {
            container.innerHTML = '<div class="list-group-item text-center p-3 text-muted">Aucune activité récente</div>';
            return;
        }
        let html = '';
        activities.forEach(activity => {
            const icon = getActivityIcon(activity.type);
            const userInfo = activity.user ? `<span class="text-primary fw-bold">${activity.user}</span>` : '';
            html += `<a href="#" class="list-group-item list-group-item-action activity-item type-${activity.type || 'default'}" data-activity-id="${activity.id}">
                        <div class="d-flex w-100 justify-content-between">
                            <h6 class="mb-1 activity-title"><i class="${icon} me-2"></i>${activity.description || 'Activité'} ${userInfo}</h6>
                            <small class="text-muted activity-time">${activity.date_relative || ''}</small>
                        </div>
                        ${activity.details ? `<p class="mb-1 activity-details"><small>${activity.details}</small></p>` : ''}
                    </a>`;
        });
        container.innerHTML = html;
    }

    function getActivityIcon(type) { /* ... (Code de la fonction getActivityIcon) ... */
         const iconMap = {
            'connexion': 'fas fa-sign-in-alt text-success', 'deconnexion': 'fas fa-sign-out-alt text-warning',
            'inscription': 'fas fa-user-plus text-primary', 'validation': 'fas fa-check-circle text-success',
            'refus': 'fas fa-times-circle text-danger', 'annulation': 'fas fa-ban text-danger',
            'ajout_participant': 'fas fa-user-plus text-primary', 'suppression_participant': 'fas fa-user-minus text-danger',
            'modification_participant': 'fas fa-user-edit text-warning', 'reinscription': 'fas fa-redo text-info',
            'liste_attente': 'fas fa-clock text-warning', 'ajout_theme': 'fas fa-folder-plus text-primary',
            'ajout_service': 'fas fa-building text-primary', 'ajout_salle': 'fas fa-door-open text-primary',
            'attribution_salle': 'fas fa-map-marker-alt text-info', 'systeme': 'fas fa-cog text-secondary',
            'notification': 'fas fa-bell text-warning', 'telecharger_invitation': 'fas fa-file-download text-info',
            'ajout_document': 'fas fa-file-upload text-info', 'suppression_document': 'fas fa-file-excel text-danger',
            'default': 'fas fa-info-circle text-secondary'
        };
        return iconMap[type] || iconMap.default;
    }

    function fixDataIssues() { /* ... (Code de la fonction fixDataIssues) ... */
         document.querySelectorAll('.places-dispo').forEach(el => {
            const text = el.textContent.trim();
            if (text.includes('/')) {
                const parts = text.split('/');
                const available = parseInt(parts[0].trim());
                const total = parseInt(parts[1].trim());
                if (isNaN(available) || isNaN(total)) {
                    el.classList.remove('text-success', 'text-warning', 'text-danger');
                    el.classList.add('text-secondary');
                    el.innerHTML = '<i class="fas fa-question-circle me-1"></i> ? / ?';
                    el.title = 'Données temporairement indisponibles';
                    return;
                }
                let icon, colorClass;
                if (available <= 0) { icon = 'fa-times-circle'; colorClass = 'text-danger'; }
                else if (available <= 0.2 * total) { icon = 'fa-exclamation-circle'; colorClass = 'text-danger'; }
                else if (available <= 0.4 * total) { icon = 'fa-exclamation-triangle'; colorClass = 'text-warning'; }
                else { icon = 'fa-check-circle'; colorClass = 'text-success'; }
                el.classList.remove('text-success', 'text-warning', 'text-danger', 'text-secondary');
                el.classList.add(colorClass);
                el.innerHTML = `<i class="fas ${icon} me-1"></i> ${available} / ${total}`;
            } else if (text === 'NaN / NaN' || text.includes('undefined') || text === '/ ' || text === ' / ' || text.includes('null') || text === '? / ?') {
                if (!el.innerHTML.includes('fa-question-circle')) {
                    el.classList.remove('text-success', 'text-warning', 'text-danger');
                    el.classList.add('text-secondary');
                    el.innerHTML = '<i class="fas fa-question-circle me-1"></i> ? / ?';
                    el.title = 'Données temporairement indisponibles';
                }
            }
        });
        document.querySelectorAll('.counter-value, .badge-count').forEach(counter => {
            const text = counter.textContent.trim();
            if (text === '' || text === 'undefined' || text === 'null' || text === 'NaN' || text === '—') {
                counter.textContent = '—';
                counter.classList.add('text-muted');
                counter.title = 'Valeur temporairement indisponible';
            }
        });
    }
    function enhanceBadgesAndLabels() { /* ... (Code de la fonction enhanceBadgesAndLabels) ... */
        if (typeof window.enhanceThemeBadgesGlobally === 'function') {
            window.enhanceThemeBadgesGlobally();
        }
        document.querySelectorAll('.js-salle-cell').forEach(cell => {
            const textContent = cell.textContent.trim();
            if (!cell.querySelector('.salle-badge') && textContent) {
                if (textContent === 'Non définie' || textContent === 'N/A') cell.innerHTML = '<span class="badge bg-secondary salle-badge">Non définie</span>';
                else cell.innerHTML = `<span class="badge bg-info text-dark salle-badge">${textContent}</span>`;
            }
        });
    }
    function initTooltips() { /* ... (Code de la fonction initTooltips via window.initializeGlobalTooltips) ... */
        if (typeof window.initializeGlobalTooltips === 'function') {
            window.initializeGlobalTooltips();
        }
    }
    function setupValidationListeners() { /* ... (Code de la fonction setupValidationListeners pour .validation-ajax) ... */
         document.body.addEventListener('click', function(event) {
            const button = event.target.closest('.validation-ajax');
            if (!button) return;
            const inscriptionId = button.getAttribute('data-inscription-id');
            const action = button.getAttribute('data-action');
            if (!inscriptionId || !action) return;

            button.disabled = true;
            const originalText = button.innerHTML;
            button.innerHTML = '<span class="spinner-border spinner-border-sm" role="status" aria-hidden="true"></span>';

            fetch('/validation_inscription_ajax', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'X-CSRFToken': getCsrfToken() },
                body: JSON.stringify({ inscription_id: inscriptionId, action: action })
            })
            .then(response => response.json())
            .then(data => {
                if (data.success) {
                    if (typeof showToast === 'function') showToast(data.message, 'success');
                    debouncedFetchAndProcessData(true); // Forcer refresh complet
                    const modal = button.closest('.modal');
                    if (modal && typeof bootstrap !== 'undefined' && bootstrap.Modal.getInstance(modal)) {
                        bootstrap.Modal.getInstance(modal).hide();
                    }
                } else {
                    if (typeof showToast === 'function') showToast(data.message || 'Erreur lors de la validation', 'danger');
                }
            })
            .catch(error => {
                console.error('Validation AJAX error:', error);
                if (typeof showToast === 'function') showToast('Erreur de communication.', 'danger');
            })
            .finally(() => {
                const currentButton = document.querySelector(`.validation-ajax[data-inscription-id="${inscriptionId}"][data-action="${action}"]`);
                if(currentButton) { currentButton.disabled = false; currentButton.innerHTML = originalText; }
            });
        });
    }


    // --- Fonctions Graphiques (Chart.js) ---
    // Les fonctions renderThemeDistributionChartJS, renderServiceDistributionChartJS, generateCustomLegend
    // sont celles fournies dans la réponse précédente.
    function initializeCharts() {
        if (config.chartRendering === 'none' || typeof Chart === 'undefined') {
            if(config.debugMode && typeof Chart === 'undefined') console.warn("Chart.js n'est pas chargé. Graphiques dynamiques désactivés.");
            return;
        }
        renderThemeDistributionChartJS([]);
        renderServiceDistributionChartJS([]);
    }
    function updateCharts(sessions, participants) {
        if (config.chartRendering === 'none' || typeof Chart === 'undefined') return;
        renderThemeDistributionChartJS(sessions || []);
        renderServiceDistributionChartJS(participants || []);
    }
    function renderThemeDistributionChartJS(sessionsData) { /* ... (Code complet de la fonction) ... */
        const ctx = document.getElementById('themeDistributionChart')?.getContext('2d');
        const legendContainer = document.getElementById('themeChartLegend');
        if (!ctx) return;
        const parentDiv = ctx.canvas.parentNode;
        let noDataMsg = parentDiv.querySelector('.no-data-message-chart');
        if (!sessionsData || sessionsData.filter(s => (s.inscrits || 0) > 0).length === 0) {
            if (dashboardState.themeChartInstance) { dashboardState.themeChartInstance.destroy(); dashboardState.themeChartInstance = null; }
            ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);
            if (!noDataMsg) { noDataMsg = document.createElement('div'); noDataMsg.className = 'no-data-message-chart'; parentDiv.appendChild(noDataMsg); }
            noDataMsg.innerHTML = '<i class="fas fa-info-circle me-2"></i>Aucune inscription pour afficher la répartition.';
            if(legendContainer) legendContainer.innerHTML = '';
            return;
        }
        if (noDataMsg) noDataMsg.remove();
        const themeCounts = sessionsData.reduce((acc, s) => { acc[s.theme] = (acc[s.theme] || 0) + (s.inscrits || 0); return acc; }, {});
        const labels = Object.keys(themeCounts).filter(k => themeCounts[k] > 0);
        const dataValues = labels.map(l => themeCounts[l]);
        const colors = labels.map((l, i) => (window.themesDataForChart?.[l]?.color || getRandomColor(i)));
        const chartData = { labels, datasets: [{ data: dataValues, backgroundColor: colors, borderColor: '#fff', borderWidth: 2, hoverOffset: 8 }] };
        const chartOptions = { responsive: true, maintainAspectRatio: false, animation: {animateScale: true, animateRotate: true, duration: 800}, plugins: { legend: {display: false}, tooltip: {callbacks: {label: c => `${c.label}: ${c.parsed} (${(c.parsed / c.dataset.data.reduce((a,b)=>a+b,0) * 100).toFixed(1)}%)`}}}};
        if (dashboardState.themeChartInstance) { dashboardState.themeChartInstance.data = chartData; dashboardState.themeChartInstance.update(); }
        else { dashboardState.themeChartInstance = new Chart(ctx, {type: 'doughnut', data: chartData, options: chartOptions}); }
        generateCustomLegend(legendContainer, labels, colors, dataValues, window.themesDataForChart || {});
    }
    function renderServiceDistributionChartJS(participantsData) { /* ... (Code complet de la fonction) ... */
        const ctx = document.getElementById('serviceDistributionChart')?.getContext('2d');
        const legendContainer = document.getElementById('serviceChartLegend');
        if (!ctx) return;
        const parentDiv = ctx.canvas.parentNode;
        let noDataMsg = parentDiv.querySelector('.no-data-message-chart');
        if (!participantsData || participantsData.length === 0) {
            if (dashboardState.serviceChartInstance) { dashboardState.serviceChartInstance.destroy(); dashboardState.serviceChartInstance = null; }
            ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);
            if (!noDataMsg) { noDataMsg = document.createElement('div'); noDataMsg.className = 'no-data-message-chart'; parentDiv.appendChild(noDataMsg); }
            noDataMsg.innerHTML = '<i class="fas fa-info-circle me-2"></i>Aucun participant pour afficher la répartition.';
            if(legendContainer) legendContainer.innerHTML = '';
            return;
        }
        if (noDataMsg) noDataMsg.remove();
        const serviceCounts = participantsData.reduce((acc, p) => { acc[p.service] = (acc[p.service] || 0) + 1; return acc; }, {});
        const labels = Object.keys(serviceCounts).filter(k => serviceCounts[k] > 0);
        const dataValues = labels.map(l => serviceCounts[l]);
        const colors = labels.map((l, i) => (window.servicesDataForChart?.[l]?.color || getRandomColor(i + labels.length)));
        const chartData = { labels, datasets: [{ data: dataValues, backgroundColor: colors, borderColor: colors.map(c => Chart.helpers.color(c).darken(0.2).rgbString()), borderWidth:1, borderRadius:4, barPercentage:0.7, categoryPercentage:0.8}]};
        const chartOptions = { indexAxis:'y', responsive:true, maintainAspectRatio:false, scales:{x:{beginAtZero:true, ticks:{precision:0}, grid:{color:'rgba(0,0,0,0.05)'}}, y:{grid:{display:false}}}, plugins:{legend:{display:false}, tooltip:{callbacks:{label:c=>`${c.label}: ${c.raw} participant(s)`}}}, animation:{duration:800}};
        if (dashboardState.serviceChartInstance) { dashboardState.serviceChartInstance.data = chartData; dashboardState.serviceChartInstance.update(); }
        else { dashboardState.serviceChartInstance = new Chart(ctx, {type:'bar', data:chartData, options:chartOptions}); }
        if(legendContainer) generateCustomLegend(legendContainer, labels, colors, dataValues, window.servicesDataForChart || {}, true);
    }
    function generateCustomLegend(container, labels, colors, values, configData, isServiceChart = false) { /* ... (Code complet de la fonction) ... */
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
        const styleSheet = document.createElement("style"); styleSheet.id = 'fadeInLegendStyle';
        styleSheet.innerText = "@keyframes fadeInLegend { to { opacity: 1; } }"; document.head.appendChild(styleSheet);
    }


    // --- Utilitaires ---
    function debounce(func, delay) { let timeout; return function(...args) { const context = this; clearTimeout(timeout); timeout = setTimeout(() => func.apply(context, args), delay); }; }
    function simpleHash(obj) { const str = JSON.stringify(obj); let hash = 0; if (str.length === 0) return hash; for (let i = 0; i < str.length; i++) { const char = str.charCodeAt(i); hash = ((hash << 5) - hash) + char; hash |= 0; } return hash; }
    function getRandomColor(index) { const colors = ['#4e73df', '#1cc88a', '#36b9cc', '#f6c23e', '#e74a3b', '#858796', '#5a5c69', '#fd7e14', '#6f42c1', '#d63384', '#20c997', '#6610f2']; return colors[index % colors.length]; }
    function showGlobalLoading(isLoading) { if (globalLoadingOverlay) { globalLoadingOverlay.style.display = isLoading ? 'flex' : 'none'; if(isLoading) globalLoadingOverlay.classList.remove('hidden'); else globalLoadingOverlay.classList.add('hidden'); } }
    function setupStaticEventListeners() {
        const refreshButton = document.getElementById('refresh-dashboard');
        if (refreshButton) {
            refreshButton.addEventListener('click', () => {
                if (config.debugMode) console.log('Dashboard Core: Manual refresh triggered via button.');
                refreshButton.disabled = true;
                refreshButton.innerHTML = '<i class="fas fa-sync-alt fa-spin me-1"></i>Actualisation...';
                fetchAndProcessData(true).finally(() => {
                    refreshButton.disabled = false;
                    refreshButton.innerHTML = '<i class="fas fa-sync-alt me-1"></i>Actualiser';
                });
            });
        }
    }
    function setupMutationObserver() { /* ... (Code de la fonction setupMutationObserver) ... */
         if (!window.MutationObserver) return;
        let observerTimeout = null;
        const observer = new MutationObserver(function(mutations) {
            let important = false;
            for (const mutation of mutations) {
                if (mutation.type === 'childList' && mutation.addedNodes.length > 0) {
                    for (const node of mutation.addedNodes) {
                        if (node.nodeType === 1 && node.classList && ( node.classList.contains('places-dispo') || node.classList.contains('theme-badge') || node.classList.contains('counter-value') || node.querySelector('.places-dispo, .theme-badge, .counter-value') )) {
                            important = true; break;
                        }
                    }
                }
                if (important) break;
            }
            if (important) {
                clearTimeout(observerTimeout);
                observerTimeout = setTimeout(() => { fixDataIssues(); enhanceBadgesAndLabels(); }, 300);
            }
        });
        observer.observe(document.body, { childList: true, subtree: true });
    }


    // --- Exposition des méthodes publiques ---
    window.dashboardCore = {
        forceRefresh: () => fetchAndProcessData(true),
        startPolling: startPolling,
        stopPolling: stopPolling,
        // Les fonctions suivantes sont principalement pour usage interne ou si dashboard-init a un besoin spécifique
        initializeDashboard: initializeDashboard, // Permet à dashboard-init de déclencher si nécessaire
        fetchDataInternal: fetchAndProcessData, // Pour un contrôle plus fin par dashboard-init
        updateCharts: updateCharts,
        updateStatisticsCounters: updateStatisticsCounters,
        updateActivityFeed: updateActivityFeed,
        initializeCharts: initializeCharts,
        getState: () => dashboardState,
        getConfig: () => config
    };

    // --- Démarrage ---
    initializeDashboard(); // dashboard-core s'auto-initialise

    // Émettre l'événement dashboardCoreReady une fois que tout est défini et initialisé
    if (config.debugMode) console.log('Dashboard Core: Dispatching dashboardCoreReady event.');
    document.dispatchEvent(new CustomEvent('dashboardCoreReady', { detail: { dashboardCore: window.dashboardCore } }));

}); // Fin du DOMContentLoaded pour dashboard-core.js

// Fonction showToast globale
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
        toastElement.innerHTML = `<div class="d-flex"><div class="toast-body">${message}</div><button type="button" class="btn-close ${textClass === 'text-white' ? 'btn-close-white' : ''} me-2 m-auto" data-bs-dismiss="toast" aria-label="Close"></button></div>`;
        toastContainer.appendChild(toastElement);
        const bsToast = new bootstrap.Toast(toastElement, { delay: duration, autohide: true });
        bsToast.show();
        toastElement.addEventListener('hidden.bs.toast', () => toastElement.remove());
    };
}
