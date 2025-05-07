console.log("--- polling-updates.js EXECUTING ---");
document.addEventListener('DOMContentLoaded', function() {
    const DASH_CONFIG = window.dashboardConfig || { debugMode: false, autoRefreshInterval: 30000, baseApiUrl: '/api' };
    if (DASH_CONFIG.debugMode) {
        console.log('PollingUpdates: Initialized (v3.0.2)');
    }

    const config = {
        get pollingInterval() { return DASH_CONFIG.autoRefreshInterval || 30000; },
        get debugMode() { return DASH_CONFIG.debugMode || false; },
        get baseApiUrl() { return DASH_CONFIG.baseApiUrl || '/api';},
        retryDelay: 1500,
        maxRetries: 2,
        maxConsecutiveErrors: 5,
        staggerRequests: true, // Stagger API calls within a refresh cycle
        visibilityPause: true, // Pause polling when tab is not visible
    };

    let consecutiveErrors = 0;
    let pollingEnabled = true;
    let pollingIntervalId = null;
    let lastDataHashes = { sessions: '', participants: '', salles: '', activites: '' };
    let lastFetchTimestamps = { sessions: 0, participants: 0, salles: 0, activites: 0 };

    function simpleHash(obj) {
        const str = JSON.stringify(obj);
        let hash = 0;
        for (let i = 0; i < str.length; i++) {
            const char = str.charCodeAt(i);
            hash = ((hash << 5) - hash) + char;
            hash |= 0;
        }
        return hash.toString();
    }

    function handleError(error, component) {
        console.error(`PollingUpdates: Error in ${component}:`, error.message || error);
        consecutiveErrors++;
        if (consecutiveErrors >= config.maxConsecutiveErrors) {
            console.error(`PollingUpdates: Too many consecutive errors (${consecutiveErrors}). Polling temporarily disabled.`);
            pollingEnabled = false;
            if (pollingIntervalId) clearInterval(pollingIntervalId);
            pollingIntervalId = null;
            if (typeof showToast === 'function') showToast('Problème de connexion serveur. Mises à jour en pause.', 'warning');
            // Attempt to re-enable after a longer delay
            setTimeout(() => {
                if (config.debugMode) console.log('PollingUpdates: Attempting to re-enable polling...');
                consecutiveErrors = 0;
                pollingEnabled = true;
                startPolling();
            }, config.pollingInterval * 10); // e.g., 5 minutes if interval is 30s
        }
    }

    function handleSuccess() {
        if (consecutiveErrors > 0) {
            if (config.debugMode) console.log("PollingUpdates: Consecutive error count reset.");
            consecutiveErrors = 0;
            // If polling was paused due to errors, and now it's successful, re-enable normal interval if needed
            if (!pollingIntervalId && pollingEnabled) {
                startPolling();
            }
        }
    }

    async function fetchWithRetry(url, options = {}) {
        let retries = 0;
        let delay = config.retryDelay;
        const cacheBuster = `_=${Date.now()}`;
        const fullUrl = `${url}${url.includes('?') ? '&' : '?'}${cacheBuster}`;

        while (retries <= config.maxRetries) { // Use <= to allow maxRetries attempts
            try {
                console.log(`PollingUpdates: Fetching URL: ${url}`);
                if (config.debugMode) console.log(`PollingUpdates: Fetching ${url} (Attempt ${retries + 1}/${config.maxRetries + 1})`);
                const response = await fetch(fullUrl, options);
                if (response.ok) {
                    const contentType = response.headers.get("content-type");
                    if (contentType && contentType.includes("application/json")) {
                        return response.json();
                    }
                    console.warn(`PollingUpdates: Received non-JSON response from ${url}`);
                    return null;
                }
                const errorText = await response.text();
                console.error(`PollingUpdates: HTTP Error ${response.status} for ${url}. Body: ${errorText.substring(0, 200)}`);
                if (response.status === 404) throw new Error(`HTTP 404: Not Found (${url})`);
                if (response.status >= 500) throw new Error(`HTTP Server Error ${response.status}`); // Server errors are worth retrying
                return null; // For 4xx client errors other than 404, don't retry indefinitely
            } catch (error) {
                retries++;
                console.warn(`PollingUpdates: Fetch error for ${url} (Attempt ${retries}/${config.maxRetries + 1}):`, error.message);
                if (retries > config.maxRetries) {
                    console.error(`PollingUpdates: Max retries reached for ${url}.`);
                    throw error;
                }
                await new Promise(resolve => setTimeout(resolve, delay + Math.random() * 500));
                delay *= 1.5;
            }
        }
        return null;
    }

    function shouldRefreshResource(resourceName) {
        const now = Date.now();
        const lastUpdate = lastFetchTimestamps[resourceName] || 0;
        const timeSinceLastUpdate = now - lastUpdate;
        // Define how often each resource should ideally be refreshed
        const refreshPeriods = {
            sessions: config.pollingInterval,         // e.g., every 30s
            activites: config.pollingInterval * 1.5,  // e.g., every 45s
            participants: config.pollingInterval * 2, // e.g., every 60s
            salles: config.pollingInterval * 3        // e.g., every 90s
        };
        return timeSinceLastUpdate >= (refreshPeriods[resourceName] || config.pollingInterval);
    }

    async function refreshDashboardComponents() {
        if (!pollingEnabled || (config.visibilityPause && document.visibilityState !== 'visible')) {
            if (config.debugMode) console.log('PollingUpdates: Skipped refresh (disabled or tab not visible)');
            return;
        }
         console.log("PollingUpdates: Attempting refresh cycle..."); 
        if (config.debugMode) console.log('PollingUpdates: Starting dashboard refresh cycle...');

        let dashboardDataPayload = { sessions: null, participants: null, salles: null, activites: null };
        let dataUpdatedOverall = false;

        const resourcesToFetch = [
            { name: 'sessions', endpoint: `${config.baseApiUrl}/sessions` },
            { name: 'participants', endpoint: `${config.baseApiUrl}/participants` },
            { name: 'salles', endpoint: `${config.baseApiUrl}/salles` },
            { name: 'activites', endpoint: `${config.baseApiUrl}/activites`, condition: () => document.getElementById('recent-activity') }
        ];

        try {
            for (const resource of resourcesToFetch) {
                if (resource.condition && !resource.condition()) continue;

                if (shouldRefreshResource(resource.name)) {
                    if (config.staggerRequests && dataUpdatedOverall) { // Stagger after the first successful fetch in this cycle
                        await new Promise(resolve => setTimeout(resolve, 250 + Math.random() * 150));
                    }
                    const apiResponse = await fetchWithRetry(resource.endpoint);
                    lastFetchTimestamps[resource.name] = Date.now();

                    if (apiResponse) {
                        // API might return paginated data { items: [...] } or direct array
                        const currentDataArray = Array.isArray(apiResponse.items) ? apiResponse.items : (Array.isArray(apiResponse) ? apiResponse : null);

                        if (currentDataArray === null) {
                            console.warn(`PollingUpdates: Data for ${resource.name} is not in expected array format. Response:`, apiResponse);
                            handleError(new Error(`Invalid data format from ${resource.endpoint}`), `${resource.name} data processing`);
                            continue;
                        }

                        const currentDataHash = simpleHash(currentDataArray);
                        if (lastDataHashes[resource.name] !== currentDataHash) {
                            dashboardDataPayload[resource.name] = currentDataArray;
                            lastDataHashes[resource.name] = currentDataHash;
                            dataUpdatedOverall = true;
                            if (config.debugMode) console.log(`PollingUpdates: ${resource.name} data has changed.`);
                        } else {
                            if (config.debugMode) console.log(`PollingUpdates: ${resource.name} data unchanged (hash match).`);
                        }
                    } else {
                         handleError(new Error(`No data from ${resource.endpoint}`), `${resource.name} fetch`);
                    }
                }
            }

            if (dataUpdatedOverall) {
                if (config.debugMode) console.log("PollingUpdates: Data changed, updating UI with payload:", dashboardDataPayload);
                updateStatsAndUI(dashboardDataPayload);
                updateActivityFeed(dashboardDataPayload.activites); // Specifically update activity feed
                handleSuccess();
                document.dispatchEvent(new CustomEvent('dashboardDataRefreshed', { detail: { data: dashboardDataPayload } }));
            } else {
                if (config.debugMode) console.log(`PollingUpdates: No data changes detected, UI not updated this cycle.`);
            }

        } catch (error) {
            console.error('PollingUpdates: Error in refresh cycle:', error);
            handleError(error, 'refresh cycle');
        }
    }

    function updateStatsAndUI(payload) {
        const sessionsArray = payload.sessions; // Expected to be an array of session objects
        const participantsArray = payload.participants; // Expected to be an array
        const sallesArray = payload.salles; // Expected to be an array

        try {
            if (sessionsArray && Array.isArray(sessionsArray)) {
                if (typeof window.updateSessionTable === 'function') {
                    window.updateSessionTable(sessionsArray); // dashboard.js function
                }
                updateCounter('stat-sessions-programmees', sessionsArray.length);
                const totalInscritsGlobal = sessionsArray.reduce((sum, s) => sum + (s.inscrits || 0), 0);
                updateCounter('stat-total-inscriptions', totalInscritsGlobal);
                updateCounter('stat-total-en-attente', sessionsArray.reduce((sum, s) => sum + (s.liste_attente || 0), 0));
                updateCounter('stat-total-sessions-completes', sessionsArray.filter(s => s.places_restantes === 0).length);

                const donutTotalEl = document.getElementById('chart-theme-total');
                if (donutTotalEl) donutTotalEl.textContent = totalInscritsGlobal;
            }

            if (participantsArray && Array.isArray(participantsArray)) {
                updateCounter('counter-participants', participantsArray.length); // Ensure this ID exists if used
            }

            if (sallesArray && Array.isArray(sallesArray)) {
                updateCounter('counter-salles', sallesArray.length); // Ensure this ID exists if used
            }

            // Chart updates are now primarily handled by charts-enhanced.js listening to 'dashboardDataRefreshed'
            // but we can still pass data to staticChartsModule as a fallback or for non-canvas elements.
            if (window.staticChartsModule) {
                if (sessionsArray && Array.isArray(sessionsArray)) {
                    const themeCountsForChart = {};
                    sessionsArray.forEach(session => {
                        if (session.theme) { // API returns theme name directly
                            themeCountsForChart[session.theme] = (themeCountsForChart[session.theme] || 0) + (session.inscrits || 0);
                        }
                    });
                    const themeChartData = Object.entries(themeCountsForChart).map(([label, value]) => ({
                        label, value, color: (window.themesDataForChart && window.themesDataForChart[label]) ? window.themesDataForChart[label].color : undefined
                    }));
                    window.staticChartsModule.updateThemeChart(themeChartData);
                }
                if (participantsArray && Array.isArray(participantsArray)) {
                    const serviceCountsForChart = {};
                    participantsArray.forEach(participant => {
                        if (participant.service) { // API returns service name directly
                            serviceCountsForChart[participant.service] = (serviceCountsForChart[participant.service] || 0) + 1;
                        }
                    });
                    const serviceChartData = Object.entries(serviceCountsForChart).map(([label, value]) => ({
                        label, value, color: (window.servicesDataForChart && window.servicesDataForChart[label]) ? window.servicesDataForChart[label].color : undefined
                    }));
                    window.staticChartsModule.updateServiceChart(serviceChartData);
                }
            }

            if (typeof window.animateAllDashboardCounters === 'function') {
                window.animateAllDashboardCounters();
            }

        } catch (error) {
            console.error("PollingUpdates: Error updating UI components:", error);
        }
    }

    function updateActivityFeed(activitesArray) {
        if (!activitesArray || !Array.isArray(activitesArray)) {
            if(config.debugMode && activitesArray !== null) console.warn("PollingUpdates: updateActivityFeed received non-array or null data", activitesArray);
            // Clear feed or show "no activity" if activitesArray is explicitly empty array
            if (Array.isArray(activitesArray) && activitesArray.length === 0) {
                 // Handled below
            } else if (activitesArray !== null) { // If not null and not array, it's an issue
                return;
            }
        }

        const activitesLists = document.querySelectorAll('#recent-activity, #recent-activity-admin');
        if (activitesLists.length === 0) return;

        try {
            activitesLists.forEach(list => {
                const initialLoadingState = list.querySelector('.initial-loading-state');
                if (initialLoadingState) initialLoadingState.remove();

                list.innerHTML = ''; // Clear previous activities
                const activitiesToDisplay = (activitesArray || []).slice(0, 7); // Display up to 7 recent

                if (activitiesToDisplay.length > 0) {
                    activitiesToDisplay.forEach(activite => {
                        const icon = getIconForActivity(activite.type);
                        const titre = (activite.type || 'unknown').replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase());
                        const activityItem = document.createElement('div');
                        activityItem.className = 'list-group-item list-group-item-action px-3 py-2 border-0 small';
                        activityItem.innerHTML = `
                            <div class="d-flex w-100 justify-content-between">
                                <h6 class="mb-1 small fw-bold"><i class="${icon} me-2 fa-fw"></i>${titre}</h6>
                                <small class="text-muted text-nowrap">${activite.date_relative || ''}</small>
                            </div>
                            <p class="mb-1 text-body-secondary">${activite.description || ''}</p>
                            ${activite.details ? `<small class="text-muted fst-italic">${activite.details}</small>` : ''}
                        `;
                        list.appendChild(activityItem);
                    });
                } else {
                    list.innerHTML = '<div class="list-group-item px-3 border-0 text-center text-muted fst-italic py-3">Aucune activité récente.</div>';
                }
            });
        } catch (error) {
            console.error('PollingUpdates: Error updating activity feed:', error);
        }
    }

    function updateCounter(elementId, value) {
        const elements = document.querySelectorAll(`#${elementId}`);
        elements.forEach(element => {
            const targetValue = parseInt(value, 10);
            if (!isNaN(targetValue)) {
                element.dataset.targetValue = targetValue.toString();
                if (!element.classList.contains('counter-value')) element.classList.add('counter-value');
                // Animation is triggered by animateAllDashboardCounters
                // Set text directly for non-animated or initial state
                if (!element.dataset.currentValue) { // Set initial text if no animation has run
                    element.textContent = targetValue.toString();
                }
            } else {
                element.textContent = 'N/A';
                delete element.dataset.targetValue;
            }
        });
    }

    window.animateCounter = function(element, startValue, endValue, duration = 700) {
        if (startValue === endValue) {
            element.textContent = endValue.toLocaleString(); // Format with locale string
            return;
        }
        const steps = Math.max(15, Math.min(30, Math.abs(endValue - startValue))); // Dynamic steps
        const increment = (endValue - startValue) / steps;
        let current = startValue;
        let stepCount = 0;
        const interval = duration / steps;

        if (element.animationIntervalId) clearInterval(element.animationIntervalId);

        element.animationIntervalId = setInterval(() => {
            current += increment;
            stepCount++;
            if (stepCount >= steps || (increment > 0 && current >= endValue) || (increment < 0 && current <= endValue)) {
                clearInterval(element.animationIntervalId);
                element.textContent = endValue.toLocaleString();
                delete element.animationIntervalId;
                element.dataset.currentValue = endValue.toString(); // Store final value
            } else {
                element.textContent = Math.round(current).toLocaleString();
            }
        }, interval);
    }

    window.animateAllDashboardCounters = function() {
         if (config.debugMode) console.log("PollingUpdates: Animating counters...");
         document.querySelectorAll('.counter-value[data-target-value]').forEach(element => {
             const target = parseInt(element.dataset.targetValue, 10);
             const currentText = element.textContent.replace(/[\s,.]/g, ''); // Handle locale separators for parsing
             const current = parseInt(element.dataset.currentValue || currentText || '0', 10);

             if (!isNaN(target)) {
                 if (!isNaN(current) && current !== target) {
                     window.animateCounter(element, current, target);
                 } else if (isNaN(current) || current !== target) { // If current is NaN or different, set directly or animate from 0
                     window.animateCounter(element, isNaN(current) ? 0 : current, target);
                 }
                 // Update currentValue after animation starts or if no animation needed
                 element.dataset.currentValue = target.toString();
             } else {
                 element.textContent = element.dataset.targetValue || 'N/A'; // If target is not a number (e.g. "N/A")
             }
         });
     }

    function getIconForActivity(type) {
        switch (type) {
            case 'inscription': return 'fas fa-user-plus text-success';
            case 'validation': return 'fas fa-check-circle text-primary';
            case 'refus': return 'fas fa-times-circle text-danger';
            case 'annulation': return 'fas fa-user-minus text-warning'; // Changed color
            case 'liste_attente': return 'fas fa-clock text-warning';
            case 'attribution_salle': return 'fas fa-building text-info';
            case 'ajout_participant': return 'fas fa-user-plus text-success';
            case 'modification_participant': return 'fas fa-user-edit text-info'; // Changed color
            case 'suppression_participant': return 'fas fa-user-slash text-danger';
            case 'ajout_salle': return 'fas fa-plus-square text-info'; // Changed icon
            case 'modification_salle': return 'fas fa-edit text-info';
            case 'suppression_salle': return 'fas fa-minus-square text-danger'; // Changed icon
            case 'ajout_theme': return 'fas fa-book-medical text-warning'; // Changed icon
            case 'modification_theme': return 'fas fa-edit text-warning';
            case 'suppression_theme': return 'fas fa-book-dead text-danger'; // Changed icon
            case 'connexion': return 'fas fa-sign-in-alt text-primary';
            case 'deconnexion': return 'fas fa-sign-out-alt text-secondary';
            case 'systeme': return 'fas fa-cogs text-secondary';
            case 'notification': return 'fas fa-bell text-info'; // Changed color
            case 'telecharger_invitation': return 'far fa-calendar-alt text-primary'; // Changed icon
            default: return 'fas fa-info-circle text-secondary';
        }
    }

    window.forcePollingUpdate = async function(importantChange = false) {
        if (config.debugMode) console.log("PollingUpdates: Manual refresh forced. ImportantChange:", importantChange);
        if (importantChange) {
            Object.keys(lastFetchTimestamps).forEach(key => lastFetchTimestamps[key] = 0);
            Object.keys(lastDataHashes).forEach(key => lastDataHashes[key] = '');
        }
        // Clear any existing polling interval to prevent overlap during manual refresh
        if (pollingIntervalId) {
            clearInterval(pollingIntervalId);
            pollingIntervalId = null;
        }
        await refreshDashboardComponents();
        // Restart polling if it was enabled
        if (pollingEnabled) {
            startPolling();
        }
    };

    // Stubs for functions dashboard-init.js might call if this script is the main data provider
    window.refreshRecentActivity = function() {
        if (config.debugMode) console.log("PollingUpdates: refreshRecentActivity called (handled by main cycle).");
        // This is handled by refreshDashboardComponents, but a direct call could force only activity update
        // For now, let the main cycle handle it.
    };
    window.updateStatsCounters = function() {
        if (config.debugMode) console.log("PollingUpdates: updateStatsCounters called (handled by main cycle).");
        // Also handled by refreshDashboardComponents.
    };

    function startPolling() {
        if (pollingIntervalId) {
            if (config.debugMode) console.log("PollingUpdates: Polling already started.");
            return;
        }
        if (!pollingEnabled) {
            if (config.debugMode) console.log("PollingUpdates: Not starting, polling is disabled.");
            return;
        }

        if (config.debugMode) console.log(`PollingUpdates: Starting polling with interval ${config.pollingInterval}ms.`);
        consecutiveErrors = 0; // Reset errors when starting/restarting

        // Initial fetch delayed to allow DOM and other scripts to settle
        setTimeout(refreshDashboardComponents, 500);
        pollingIntervalId = setInterval(refreshDashboardComponents, config.pollingInterval);
    }

    // --- Initialization ---
    if (DASH_CONFIG.activeMode === 'polling' || DASH_CONFIG.preferredMode === 'polling' || (DASH_CONFIG.preferredMode === 'auto' && !DASH_CONFIG.socketEnabled)) {
        startPolling();

        document.addEventListener('visibilitychange', function() {
            if (document.visibilityState === 'visible' && pollingEnabled && !pollingIntervalId) {
                 // If tab becomes visible, polling is enabled, but no interval is set (e.g., after error pause)
                if (config.debugMode) console.log("PollingUpdates: Tab became visible, polling enabled, restarting polling interval.");
                startPolling(); // Restart polling
            } else if (document.visibilityState === 'visible' && pollingEnabled && pollingIntervalId) {
                if (config.debugMode) console.log("PollingUpdates: Tab became visible, triggering immediate refresh.");
                setTimeout(refreshDashboardComponents, 200); // Refresh soon
            } else if (document.visibilityState !== 'visible' && config.visibilityPause && pollingIntervalId) {
                if (config.debugMode) console.log("PollingUpdates: Tab became hidden, pausing updates (clearing interval).");
                // clearInterval(pollingIntervalId); // Option: clear interval to save resources
                // pollingIntervalId = null;
                // Or just let the check at the start of refreshDashboardComponents handle it.
            }
        });
    } else {
        if (config.debugMode) console.log("PollingUpdates: Polling not started, activeMode is not polling or polling is disabled.");
    }

    if (config.debugMode) console.log('PollingUpdates: Setup complete (v3.0.2).');
});
