/**
 * polling-updates.js - Alternative optimisée au WebSocket
 * Utilise le polling intelligent pour les mises à jour avec réduction des requêtes
 * v3.0.1 - Correction pour la structure des données API paginées, IDs des compteurs.
 */
document.addEventListener('DOMContentLoaded', function() {
    if (window.dashboardConfig && window.dashboardConfig.debugMode) {
        console.log('Optimized polling updates initialized v3.0.1');
    }

    const config = {
        get pollingInterval() { return (window.dashboardConfig && window.dashboardConfig.autoRefreshInterval) || 30000; },
        get debugMode() { return (window.dashboardConfig && window.dashboardConfig.debugMode) || false; },
        retryDelay: 1500,
        maxRetries: 2,
        maxConsecutiveErrors: 5,
        staggerRequests: true,
        smartPolling: true,
        visibilityPause: true,
    };

    let consecutiveErrors = 0;
    let pollingEnabled = true;
    let pollingIntervalId = null;
    let lastDataHashes = { // Pour une comparaison plus fine des données
        sessions: '', participants: '', salles: '', activites: ''
    };
    let lastFetchTimestamps = { // Renommé pour clarté
        sessions: 0, participants: 0, salles: 0, activites: 0
    };

    // Fonction pour générer un hash simple d'un objet (pour comparaison)
    function simpleHash(obj) {
        const str = JSON.stringify(obj);
        let hash = 0;
        for (let i = 0; i < str.length; i++) {
            const char = str.charCodeAt(i);
            hash = ((hash << 5) - hash) + char;
            hash |= 0; // Convert to 32bit integer
        }
        return hash.toString();
    }

    function handleError(error, component) {
        console.error(`Polling Error in ${component}:`, error);
        consecutiveErrors++;
        if (consecutiveErrors >= config.maxConsecutiveErrors) {
            console.error(`Polling: Too many consecutive errors (${consecutiveErrors}). Polling temporarily disabled.`);
            pollingEnabled = false;
            if (pollingIntervalId) clearInterval(pollingIntervalId);
            pollingIntervalId = null;
            setTimeout(() => {
                console.log('Polling: Attempting to re-enable polling...');
                consecutiveErrors = 0;
                pollingEnabled = true;
                startPolling(); // Redémarrer le polling
            }, config.pollingInterval * 5); // Délai plus long avant de réessayer
            if (typeof showToast === 'function') showToast('Problème de connexion serveur. Mises à jour en pause.', 'warning');
        }
    }

    function handleSuccess() {
        if (consecutiveErrors > 0) {
            if (config.debugMode) console.log("Polling: Consecutive error count reset.");
            consecutiveErrors = 0;
        }
    }

    async function fetchWithRetry(url, options = {}) {
        let retries = 0;
        let delay = config.retryDelay;
        const separator = url.includes('?') ? '&' : '?';
        const urlWithCacheBuster = `${url}${separator}_=${Date.now()}`;
        
        while (retries < config.maxRetries) {
            try {
                if (config.debugMode) console.log(`Polling Fetch: ${url} (Attempt ${retries + 1}/${config.maxRetries})`);
                const response = await fetch(urlWithCacheBuster, options);
                if (response.ok) {
                    const contentType = response.headers.get("content-type");
                    if (contentType && contentType.includes("application/json")) {
                        return response.json();
                    }
                    console.warn(`Polling Fetch: Received non-JSON response from ${url}`);
                    return null; 
                }
                console.error(`Polling Fetch: HTTP Error ${response.status} for ${url}`);
                if (response.status === 404) throw new Error(`HTTP Error 404: Ressource non trouvée (${url})`);
                throw new Error(`HTTP Error ${response.status}`);
            } catch (error) {
                retries++;
                console.warn(`Polling Fetch error for ${url} (Attempt ${retries}/${config.maxRetries}):`, error.message);
                if (retries >= config.maxRetries) {
                    console.error(`Polling Fetch: Max retries reached for ${url}.`);
                    throw error; 
                }
                await new Promise(resolve => setTimeout(resolve, delay + Math.random() * 500)); // Ajout de jitter
                delay *= 1.5; 
            }
        }
        return null; // Devrait être atteint seulement si toutes les tentatives échouent
    }

    function shouldRefreshResource(resourceName) {
        const now = Date.now();
        const lastUpdate = lastFetchTimestamps[resourceName] || 0;
        const timeSinceLastUpdate = now - lastUpdate;
        const refreshPeriods = {
            sessions: config.pollingInterval,
            activites: config.pollingInterval * 1.5, 
            participants: config.pollingInterval * 2,
            salles: config.pollingInterval * 3 
        };
        return timeSinceLastUpdate >= (refreshPeriods[resourceName] || config.pollingInterval);
    }

    async function refreshDashboardComponents() {
        if (!pollingEnabled || (config.visibilityPause && document.visibilityState !== 'visible')) { 
            if (config.debugMode) console.log('Polling: Skipped refresh (disabled or tab not visible)');
            return; 
        }
        if (config.debugMode) console.log('Polling: Starting dashboard refresh cycle...');
        
        let dashboardDataPayload = { sessions: null, participants: null, salles: null, activites: null };
        let dataUpdated = false;

        try {
            const resourcesToFetch = [
                { name: 'sessions', endpoint: '/api/sessions' },
                { name: 'participants', endpoint: '/api/participants' },
                { name: 'salles', endpoint: '/api/salles' },
                { name: 'activites', endpoint: '/api/activites', condition: () => document.getElementById('recent-activity') }
            ];

            for (const resource of resourcesToFetch) {
                if (resource.condition && !resource.condition()) continue; // Skip si la condition n'est pas remplie

                if (shouldRefreshResource(resource.name)) {
                    if (config.staggerRequests && dataUpdated) { // dataUpdated est utilisé pour espacer après la première requête réussie du cycle
                        await new Promise(resolve => setTimeout(resolve, 200 + Math.random() * 100));
                    }
                    const apiResponse = await fetchWithRetry(resource.endpoint);
                    lastFetchTimestamps[resource.name] = Date.now();

                    if (apiResponse) {
                        // Pour les API paginées, prendre 'items', sinon prendre la réponse directe
                        const currentData = apiResponse.items && Array.isArray(apiResponse.items) ? apiResponse.items : apiResponse;
                        const currentDataHash = simpleHash(currentData);

                        if (lastDataHashes[resource.name] !== currentDataHash) {
                            dashboardDataPayload[resource.name] = currentData; // Stocker le tableau de données
                            lastDataHashes[resource.name] = currentDataHash;
                            dataUpdated = true;
                            if (config.debugMode) console.log(`Polling: ${resource.name} data has changed.`);
                        } else {
                            if (config.debugMode) console.log(`Polling: ${resource.name} data unchanged (hash match).`);
                        }
                    } else {
                         handleError(new Error(`No data from ${resource.endpoint}`), `${resource.name} fetch`);
                    }
                }
            }
            
            if (dataUpdated) {
                updateStatsAndUI(dashboardDataPayload); // Passer l'objet contenant toutes les données mises à jour
                updateActivityFeed(dashboardDataPayload.activites); // Mettre à jour spécifiquement le flux d'activité
                handleSuccess();
                if (config.debugMode) console.log(`Polling: UI updated with new data.`);
                 // Émettre un événement pour que d'autres scripts (comme charts-enhanced.js) puissent réagir
                document.dispatchEvent(new CustomEvent('dashboardDataRefreshed', { detail: { data: dashboardDataPayload } }));
            } else {
                if (config.debugMode) console.log(`Polling: No data changes detected, UI not updated.`);
            }
            
        } catch (error) {
            console.error('Polling: Error in refresh cycle:', error);
            handleError(error, 'refresh cycle');
        }
    }

    function updateStatsAndUI(payload) { // Reçoit l'objet payload complet
        if (config.debugMode) console.log("Polling: Updating stats and UI with payload:", payload);
        
        const sessionsArray = payload.sessions; // Doit être un tableau
        const participantsArray = payload.participants; // Doit être un tableau
        const sallesArray = payload.salles; // Doit être un tableau

        try {
            if (sessionsArray && Array.isArray(sessionsArray)) {
                if (typeof window.updateSessionTable === 'function') {
                    window.updateSessionTable(sessionsArray);
                }
                updateCounter('stat-sessions-programmees', sessionsArray.length);
                updateCounter('stat-total-sessions-completes', sessionsArray.filter(s => s.places_restantes === 0).length);
                updateCounter('stat-total-inscriptions', sessionsArray.reduce((sum, s) => sum + (s.inscrits || 0), 0));
                updateCounter('stat-total-en-attente', sessionsArray.reduce((sum, s) => sum + (s.liste_attente || 0), 0));
                
                // Mettre à jour le total dans le donut chart si l'élément existe
                const donutTotalEl = document.getElementById('chart-theme-total');
                if (donutTotalEl) {
                    donutTotalEl.textContent = sessionsArray.reduce((sum, s) => sum + (s.inscrits || 0), 0);
                }
            }
            
            if (participantsArray && Array.isArray(participantsArray)) {
                updateCounter('counter-participants', participantsArray.length); // Assurez-vous que cet ID existe
            }
            
            if (sallesArray && Array.isArray(sallesArray)) {
                updateCounter('counter-salles', sallesArray.length); // Assurez-vous que cet ID existe
            }

            // Appel aux modules de graphiques avec les données appropriées
            if (window.staticChartsModule) {
                if (sessionsArray && Array.isArray(sessionsArray)) {
                    const themeCountsForChart = {};
                    sessionsArray.forEach(session => {
                        if (session.theme) {
                            themeCountsForChart[session.theme] = (themeCountsForChart[session.theme] || 0) + (session.inscrits || 0);
                        }
                    });
                    const themeChartDataForStatic = Object.entries(themeCountsForChart).map(([label, value]) => ({ 
                        label, value, color: (window.themesData && window.themesData[label]) ? window.themesData[label].color : undefined 
                    }));
                    window.staticChartsModule.updateThemeChart(themeChartDataForStatic);
                }
                if (participantsArray && Array.isArray(participantsArray)) {
                    const serviceCountsForChart = {};
                    participantsArray.forEach(participant => {
                        if (participant.service) {
                            serviceCountsForChart[participant.service] = (serviceCountsForChart[participant.service] || 0) + 1;
                        }
                    });
                    const serviceChartDataForStatic = Object.entries(serviceCountsForChart).map(([label, value]) => ({ 
                        label, value, color: (window.servicesData && window.servicesData[label]) ? window.servicesData[label].color : undefined
                    }));
                    window.staticChartsModule.updateServiceChart(serviceChartDataForStatic);
                }
            }
            
            if (typeof window.animateAllDashboardCounters === 'function') {
                window.animateAllDashboardCounters();
            }
            
        } catch (error) {
            console.error("Polling: Error updating UI components:", error);
        }
    }

    function updateActivityFeed(activitesArray) { // Attend un tableau
        if (!activitesArray || !Array.isArray(activitesArray)) {
            if(config.debugMode && activitesArray !== null) console.warn("Polling: updateActivityFeed received non-array or null data", activitesArray);
            return;
        }
        
        const activitesLists = document.querySelectorAll('#recent-activity, #recent-activity-admin');
        if (activitesLists.length === 0) return;
        
        try {
            activitesLists.forEach(list => {
                const scrollPos = list.scrollTop;
                list.innerHTML = ''; // Vider la liste
                const activitiesToDisplay = activitesArray.slice(0, 5); // Afficher les 5 plus récentes
                
                if (activitiesToDisplay.length > 0) {
                    activitiesToDisplay.forEach(activite => {
                        const icon = getIconForActivity(activite.type);
                        const titre = activite.type.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase());
                        const activityItem = document.createElement('div');
                        activityItem.className = 'list-group-item list-group-item-action px-3 py-2 border-0 small'; // px-3
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
                list.scrollTop = scrollPos;
            });
        } catch (error) {
            console.error('Polling: Error updating activity feed:', error);
        }
    }

    function updateCounter(elementId, value) {
        const elements = document.querySelectorAll(`#${elementId}`); // Cibler par ID exact
        elements.forEach(element => {
            const targetValue = parseInt(value, 10);
            if (!isNaN(targetValue)) {
                element.dataset.targetValue = targetValue; // Pour l'animation
                if (!element.classList.contains('counter-value')) element.classList.add('counter-value'); // S'assurer que la classe est là
                // L'animation sera déclenchée par animateAllDashboardCounters
                element.textContent = targetValue; // Mettre à jour immédiatement au cas où l'animation n'est pas appelée
            } else {
                element.textContent = 'N/A';
                delete element.dataset.targetValue;
            }
        });
    }
    
    window.animateCounter = function(element, startValue, endValue) {
        // ... (votre fonction animateCounter existante) ...
        if (startValue === endValue) { element.textContent = endValue; return; }
        const duration = 700; const steps = 15; const increment = (endValue - startValue) / steps;
        let current = startValue; let stepCount = 0; const interval = duration / steps;
        const previousIntervalId = element.animationIntervalId; if (previousIntervalId) clearInterval(previousIntervalId);
        const timer = setInterval(() => {
            current += increment; stepCount++;
            if (stepCount >= steps || (increment > 0 && current >= endValue) || (increment < 0 && current <= endValue)) {
                clearInterval(timer); element.textContent = endValue; delete element.animationIntervalId;
            } else { element.textContent = Math.round(current); }
        }, interval);
        element.animationIntervalId = timer;
    }
    
    window.animateAllDashboardCounters = function() {
         if (config.debugMode) console.log("Polling: Animating counters...");
         document.querySelectorAll('.counter-value[data-target-value]').forEach(element => {
             const target = parseInt(element.dataset.targetValue, 10);
             const currentText = element.textContent.replace(/,/g, ''); // Gérer les séparateurs de milliers si présents
             const current = parseInt(element.dataset.currentValue || currentText || '0', 10);
             if (!isNaN(target) && !isNaN(current)) {
                 if (current !== target) { 
                     window.animateCounter(element, current, target); 
                     element.dataset.currentValue = target; // Mettre à jour la valeur actuelle pour la prochaine animation
                 } else { 
                     element.textContent = target; // Assurer que la valeur finale est correcte
                 }
             }
         });
     }
     
    function getIconForActivity(type) {
        // ... (votre fonction getIconForActivity existante) ...
        switch (type) {
            case 'inscription': return 'fas fa-user-plus text-success'; 
            case 'validation': return 'fas fa-check-circle text-primary'; 
            case 'refus': return 'fas fa-times-circle text-danger'; 
            case 'annulation': return 'fas fa-user-minus text-danger'; 
            case 'liste_attente': return 'fas fa-clock text-warning'; 
            case 'attribution_salle': return 'fas fa-building text-info'; 
            case 'ajout_participant': return 'fas fa-user-plus text-success'; 
            case 'modification_participant': return 'fas fa-user-edit text-success'; 
            case 'ajout_salle': return 'fas fa-building text-info'; 
            case 'modification_salle': return 'fas fa-edit text-info'; 
            case 'ajout_theme': return 'fas fa-book text-warning'; 
            case 'modification_theme': return 'fas fa-edit text-warning'; 
            case 'connexion': return 'fas fa-sign-in-alt text-primary'; 
            case 'deconnexion': return 'fas fa-sign-out-alt text-secondary'; 
            case 'systeme': return 'fas fa-cogs text-secondary'; 
            case 'notification': return 'fas fa-bell text-warning'; 
            case 'telecharger_invitation': return 'far fa-calendar-plus text-primary'; 
            default: return 'fas fa-info-circle text-secondary';
        }
    }

    // Exposer une fonction pour forcer une mise à jour (par exemple, par le bouton "Actualiser")
    window.forcePollingUpdate = async function(importantChange = false) {
        if (config.debugMode) console.log("Polling: Manual refresh forced.");
        if (importantChange) { // Si c'est un changement important, réinitialiser les timestamps pour forcer toutes les requêtes
            Object.keys(lastFetchTimestamps).forEach(key => lastFetchTimestamps[key] = 0);
            Object.keys(lastDataHashes).forEach(key => lastDataHashes[key] = ''); // Forcer la mise à jour des données
        }
        await refreshDashboardComponents();
    };
    
    // Fonctions pour les composants externes (comme dashboard.js)
    window.refreshRecentActivity = function() { /* ... déjà défini dans refreshDashboardComponents ... */ };
    window.updateStatsCounters = function() { /* ... déjà défini dans refreshDashboardComponents ... */ };


    function startPolling() {
        if (pollingIntervalId) { 
            if (config.debugMode) console.log("Polling: Already started."); 
            return; 
        }
        if (!pollingEnabled) {
            if (config.debugMode) console.log("Polling: Not starting, polling is disabled.");
            return;
        }
        
        console.log(`Polling: Starting polling with interval ${config.pollingInterval}ms.`);
        consecutiveErrors = 0;
        
        setTimeout(refreshDashboardComponents, 500); // Premier appel un peu différé
        pollingIntervalId = setInterval(refreshDashboardComponents, config.pollingInterval);
    }

    startPolling();

    document.addEventListener('visibilitychange', function() {
        if (document.visibilityState === 'visible' && pollingEnabled && pollingIntervalId) {
            if (config.debugMode) console.log("Polling: Tab became visible, triggering immediate refresh.");
            setTimeout(refreshDashboardComponents, 200); // Délai court
        } else if (document.visibilityState !== 'visible' && config.visibilityPause) {
            if (config.debugMode) console.log("Polling: Tab became hidden, pausing updates (if enabled).");
        }
    });

    if (config.debugMode) console.log('Optimized polling updates ready! v3.0.1');
});
