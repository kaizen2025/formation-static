/**
 * polling-updates.js - Optimized polling for dashboard updates.
 * v3.0.3 - Added explicit error handling for fetch failures and UI feedback.
 */
document.addEventListener('DOMContentLoaded', function() {
    console.log("--- polling-updates.js EXECUTING ---"); // Log de démarrage
    const DASH_CONFIG = window.dashboardConfig || { debugMode: false, autoRefreshInterval: 30000, baseApiUrl: '/api' };
    if (DASH_CONFIG.debugMode) {
        console.log('PollingUpdates: Initialized (v3.0.3 - Robust Error Handling)');
    }

    // ... (config, simpleHash - inchangés) ...
    const config = { /* ... comme avant ... */ };
    let consecutiveErrors = 0;
    let pollingEnabled = true;
    let pollingIntervalId = null;
    let lastDataHashes = { sessions: '', participants: '', salles: '', activites: '' };
    let lastFetchTimestamps = { sessions: 0, participants: 0, salles: 0, activites: 0 };
    let isBackendErrorActive = false; // Flag pour suivre l'état de l'erreur backend

    function simpleHash(obj) { /* ... comme avant ... */ }

    function showBackendErrorWarning(show) {
        let errorDiv = document.getElementById('backend-error-warning');
        if (show && !errorDiv) {
            errorDiv = document.createElement('div');
            errorDiv.id = 'backend-error-warning';
            errorDiv.className = 'alert alert-danger alert-dismissible fade show small p-2 mt-2 mx-4';
            errorDiv.setAttribute('role', 'alert');
            errorDiv.innerHTML = `
                <i class="fas fa-exclamation-triangle me-2"></i>
                Impossible de récupérer les données du serveur. Les mises à jour sont en pause.
                <button type="button" class="btn-close p-2" data-bs-dismiss="alert" aria-label="Close"></button>
            `;
            // Essayer de l'insérer après l'en-tête du dashboard
            const header = document.querySelector('#dashboard-content > div:first-child');
            if (header && header.parentNode) {
                header.parentNode.insertBefore(errorDiv, header.nextSibling);
            } else { // Fallback
                const container = document.getElementById('dashboard-content');
                if (container) container.prepend(errorDiv);
            }
            isBackendErrorActive = true;
        } else if (!show && errorDiv) {
            const alertInstance = bootstrap.Alert.getOrCreateInstance(errorDiv);
            if (alertInstance) alertInstance.close(); // Utilise l'API Bootstrap pour fermer
            isBackendErrorActive = false;
        } else if (show && errorDiv) {
            // L'erreur est déjà affichée
            isBackendErrorActive = true;
        }
    }


    function handleError(error, component) {
        console.error(`PollingUpdates: Error in ${component}:`, error.message || error);
        consecutiveErrors++;
        if (consecutiveErrors >= config.maxConsecutiveErrors && pollingEnabled) {
            console.error(`PollingUpdates: Trop d'erreurs consécutives (${consecutiveErrors}). Polling mis en pause.`);
            pollingEnabled = false; // Arrêter les tentatives de polling
            if (pollingIntervalId) clearInterval(pollingIntervalId);
            pollingIntervalId = null;
            showBackendErrorWarning(true); // Afficher l'alerte à l'utilisateur
            // On ne réessaie plus automatiquement si on atteint la limite max
        }
    }

    function handleSuccess() {
        if (consecutiveErrors > 0) {
            if (config.debugMode) console.log("PollingUpdates: Compteur d'erreurs consécutives réinitialisé.");
            consecutiveErrors = 0;
        }
        // Si une erreur était affichée, on la cache car la connexion a réussi
        if (isBackendErrorActive) {
            showBackendErrorWarning(false);
        }
        // Si le polling était désactivé à cause des erreurs, on le réactive
        if (!pollingEnabled) {
            pollingEnabled = true;
            startPolling(); // Redémarrer le polling
        }
    }

    async function fetchWithRetry(url, options = {}) {
        let retries = 0;
        let delay = config.retryDelay;
        const cacheBuster = `_=${Date.now()}`;
        const fullUrl = `${url}${url.includes('?') ? '&' : '?'}${cacheBuster}`;

        while (retries <= config.maxRetries) {
            try {
                console.log(`PollingUpdates: Fetching URL: ${url} (Attempt ${retries + 1})`); // Log ajouté
                const response = await fetch(fullUrl, options);

                if (response.ok) {
                    const contentType = response.headers.get("content-type");
                    if (contentType && contentType.includes("application/json")) {
                        return await response.json(); // Succès !
                    }
                    console.warn(`PollingUpdates: Réponse non-JSON reçue de ${url}`);
                    throw new Error(`Réponse non-JSON (type: ${contentType})`); // Traiter comme une erreur pour réessayer
                }

                // Gérer les erreurs HTTP non-OK
                const errorText = await response.text();
                console.error(`PollingUpdates: Erreur HTTP ${response.status} pour ${url}. Réponse: ${errorText.substring(0, 200)}`);

                // Ne pas réessayer indéfiniment les erreurs client (4xx) sauf 429 (Too Many Requests)
                if (response.status >= 400 && response.status < 500 && response.status !== 429) {
                    throw new Error(`Erreur client HTTP ${response.status}`); // Arrêter les tentatives
                }

                // Pour les erreurs serveur (5xx) ou 429, on réessaie
                throw new Error(`Erreur serveur HTTP ${response.status}`);

            } catch (error) {
                retries++;
                console.warn(`PollingUpdates: Erreur fetch pour ${url} (Tentative ${retries}/${config.maxRetries + 1}):`, error.message);
                if (retries > config.maxRetries) {
                    console.error(`PollingUpdates: Max retries atteint pour ${url}. Abandon.`);
                    throw error; // Lancer l'erreur finale après max retries
                }
                // Attente exponentielle avec jitter
                await new Promise(resolve => setTimeout(resolve, delay + Math.random() * 500));
                delay *= 1.8; // Augmenter le délai plus agressivement
            }
        }
        // Ne devrait pas être atteint, mais sécurité
        throw new Error(`Échec de récupération de ${url} après ${config.maxRetries + 1} tentatives.`);
    }

    // ... (shouldRefreshResource - inchangé) ...
    function shouldRefreshResource(resourceName) { /* ... comme avant ... */ }

    async function refreshDashboardComponents() {
        if (!pollingEnabled || (config.visibilityPause && document.visibilityState !== 'visible')) {
            // Ne pas logger si juste en pause à cause de l'onglet caché
            if (pollingEnabled && config.debugMode) console.log('PollingUpdates: Skipped refresh (tab not visible)');
            return;
        }
        console.log("PollingUpdates: Attempting refresh cycle..."); // Log ajouté

        let dashboardDataPayload = { sessions: null, participants: null, salles: null, activites: null };
        let dataUpdatedOverall = false;
        let cycleHasError = false; // Flag pour suivre si une erreur s'est produite dans ce cycle

        const resourcesToFetch = [
            { name: 'sessions', endpoint: `${config.baseApiUrl}/sessions` },
            { name: 'participants', endpoint: `${config.baseApiUrl}/participants` },
            { name: 'salles', endpoint: `${config.baseApiUrl}/salles` },
            { name: 'activites', endpoint: `${config.baseApiUrl}/activites`, condition: () => document.getElementById('recent-activity') }
        ];

        try {
            for (const resource of resourcesToFetch) {
                if (resource.condition && !resource.condition()) continue;
                if (!shouldRefreshResource(resource.name)) continue; // Sauter si pas besoin de rafraîchir

                if (config.staggerRequests && dataUpdatedOverall) {
                    await new Promise(resolve => setTimeout(resolve, 250 + Math.random() * 150));
                }

                try {
                    const apiResponse = await fetchWithRetry(resource.endpoint); // Utilise la fonction avec retry
                    lastFetchTimestamps[resource.name] = Date.now();

                    // Traitement de la réponse (si succès)
                    const currentDataArray = Array.isArray(apiResponse?.items) ? apiResponse.items : (Array.isArray(apiResponse) ? apiResponse : null);

                    if (currentDataArray === null && apiResponse !== null) { // apiResponse n'est pas null mais le format est mauvais
                        console.warn(`PollingUpdates: Format de données inattendu pour ${resource.name}. Réponse:`, apiResponse);
                        // Ne pas traiter comme une erreur fatale pour le cycle, mais logger
                    } else if (currentDataArray !== null) { // Données valides (ou null si fetch a échoué avant)
                        const currentDataHash = simpleHash(currentDataArray);
                        if (lastDataHashes[resource.name] !== currentDataHash) {
                            dashboardDataPayload[resource.name] = currentDataArray;
                            lastDataHashes[resource.name] = currentDataHash;
                            dataUpdatedOverall = true;
                            if (config.debugMode) console.log(`PollingUpdates: ${resource.name} data has changed.`);
                        } else {
                            if (config.debugMode) console.log(`PollingUpdates: ${resource.name} data unchanged.`);
                        }
                    }
                    // Si apiResponse est null (après échec de fetchWithRetry), on ne fait rien ici, l'erreur a déjà été lancée/attrapée

                } catch (fetchError) {
                    // Attraper l'erreur finale de fetchWithRetry
                    handleError(fetchError, `${resource.name} fetch`);
                    cycleHasError = true; // Marquer qu'une erreur s'est produite
                    // Optionnel : arrêter de chercher d'autres ressources dans ce cycle si une échoue ?
                    // break;
                }
            } // Fin boucle for resources

            // Mise à jour UI seulement si des données ont changé ET aucune erreur fatale n'a arrêté le polling
            if (dataUpdatedOverall && pollingEnabled) {
                if (config.debugMode) console.log("PollingUpdates: Data changed, updating UI with payload:", dashboardDataPayload);
                updateStatsAndUI(dashboardDataPayload);
                updateActivityFeed(dashboardDataPayload.activites);
                handleSuccess(); // Réinitialiser le compteur d'erreurs, cacher l'alerte si besoin
                document.dispatchEvent(new CustomEvent('dashboardDataRefreshed', { detail: { data: dashboardDataPayload } }));
            } else if (!dataUpdatedOverall && pollingEnabled) {
                if (config.debugMode) console.log(`PollingUpdates: No data changes detected, UI not updated this cycle.`);
                handleSuccess(); // Considérer un cycle sans changement comme un succès
            } else if (!pollingEnabled) {
                 if (config.debugMode) console.log(`PollingUpdates: Polling is disabled, skipping UI update.`);
            }

        } catch (error) { // Erreur inattendue dans la logique de la boucle elle-même
            console.error('PollingUpdates: Erreur majeure dans le cycle de rafraîchissement:', error);
            handleError(error, 'refresh cycle logic');
        }
    }

    // ... (updateStatsAndUI - AJOUTER LE LOG ICI) ...
    function updateStatsAndUI(payload) {
        console.log("PollingUpdates: Données reçues pour stats/UI:", JSON.stringify(payload)); // <-- LOG AJOUTÉ
        // ... (reste de la fonction inchangée) ...
    }

    // ... (updateActivityFeed - AJOUTER LE LOG ICI) ...
    function updateActivityFeed(activitesArray) {
        console.log("PollingUpdates: Données reçues pour Activité Récente:", JSON.stringify(activitesArray)); // <-- LOG AJOUTÉ
        // ... (reste de la fonction inchangée) ...
    }

    // ... (updateCounter, animateCounter, animateAllDashboardCounters, getIconForActivity - inchangés) ...
    function updateCounter(elementId, value) { /* ... comme avant ... */ }
    window.animateCounter = function(element, startValue, endValue, duration = 700) { /* ... comme avant ... */ }
    window.animateAllDashboardCounters = function() { /* ... comme avant ... */ }
    function getIconForActivity(type) { /* ... comme avant ... */ }


    // --- Force Update ---
    window.forcePollingUpdate = async function(importantChange = false) {
        if (config.debugMode) console.log("PollingUpdates: Manual refresh forced. ImportantChange:", importantChange);

        // Si le polling était désactivé à cause d'erreurs, le réactiver pour cette tentative
        const wasPollingDisabled = !pollingEnabled;
        if (wasPollingDisabled) {
            console.log("PollingUpdates: Réactivation temporaire du polling pour l'actualisation manuelle.");
            pollingEnabled = true;
            consecutiveErrors = 0; // Reset errors for the manual attempt
            showBackendErrorWarning(false); // Hide warning
        }

        if (importantChange) {
            Object.keys(lastFetchTimestamps).forEach(key => lastFetchTimestamps[key] = 0);
            Object.keys(lastDataHashes).forEach(key => lastDataHashes[key] = '');
        }

        if (pollingIntervalId) { clearInterval(pollingIntervalId); pollingIntervalId = null; }

        try {
            await refreshDashboardComponents();
        } catch (e) {
            console.error("PollingUpdates: Erreur pendant forcePollingUpdate", e);
            // handleError a déjà été appelé dans refreshDashboardComponents si nécessaire
        } finally {
            // Redémarrer le polling seulement s'il était actif avant l'appel manuel
            // ou s'il n'avait pas été désactivé par maxErrors
            if (pollingEnabled) {
                 startPolling();
            } else if (wasPollingDisabled) {
                // Si on l'a réactivé juste pour le test et qu'il a encore échoué (handleError l'aura remis à false)
                // on le laisse désactivé. Si le test a réussi (handleSuccess l'a remis à true), startPolling le relance.
                if (pollingEnabled) startPolling();
                else console.log("PollingUpdates: L'actualisation manuelle a échoué, le polling reste désactivé.");
            }
        }
    };

    // ... (Stubs refreshRecentActivity, updateStatsCounters - inchangés) ...
    window.refreshRecentActivity = function() { /* ... */ };
    window.updateStatsCounters = function() { /* ... */ };

    function startPolling() {
        // Ne pas démarrer si déjà en cours ou désactivé
        if (pollingIntervalId || !pollingEnabled) {
            if (pollingIntervalId && config.debugMode) console.log("PollingUpdates: Polling déjà démarré.");
            if (!pollingEnabled && config.debugMode) console.log("PollingUpdates: Tentative de démarrage alors que pollingEnabled est false.");
            return;
        }

        if (config.debugMode) console.log(`PollingUpdates: Démarrage du polling avec intervalle ${config.pollingInterval}ms.`);
        // Reset errors when starting polling
        consecutiveErrors = 0;
        showBackendErrorWarning(false); // Assurer que l'erreur n'est pas affichée au démarrage

        // Premier appel un peu différé
        setTimeout(refreshDashboardComponents, 500);
        // Démarrer l'intervalle
        pollingIntervalId = setInterval(refreshDashboardComponents, config.pollingInterval);
    }

    // --- Initialisation ---
    // Démarrer le polling si le mode est 'polling' ou 'auto' (car WebSocket n'est pas utilisé ici)
    if (DASH_CONFIG.activeMode === 'polling') {
        startPolling();

        // Gestion de la visibilité de l'onglet
        document.addEventListener('visibilitychange', function() {
            if (document.visibilityState === 'visible' && pollingEnabled) {
                if (config.debugMode) console.log("PollingUpdates: Onglet visible, déclenchement rafraîchissement.");
                // Si le polling était en pause (intervalle arrêté), le redémarrer
                if (!pollingIntervalId) startPolling();
                // Rafraîchir rapidement
                setTimeout(refreshDashboardComponents, 200);
            } else if (document.visibilityState !== 'visible' && config.visibilityPause && pollingIntervalId) {
                if (config.debugMode) console.log("PollingUpdates: Onglet caché, mise en pause des mises à jour (intervalle arrêté).");
                // Optionnel: arrêter l'intervalle pour économiser ressources
                // clearInterval(pollingIntervalId);
                // pollingIntervalId = null;
            }
        });
    } else {
        if (config.debugMode) console.log("PollingUpdates: Polling non démarré (mode actif non 'polling').");
    }

    if (config.debugMode) console.log('PollingUpdates: Setup complete (v3.0.3).');
});
