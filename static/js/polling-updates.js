/**
 * polling-updates.js - Optimized polling for dashboard updates.
 * v3.1.0 - Corrections pour la gestion des erreurs 500 et données manquantes
 */
document.addEventListener('DOMContentLoaded', function() {
    console.log("--- polling-updates.js EXECUTING ---");
    
    const DASH_CONFIG = window.dashboardConfig || { 
        debugMode: false, 
        autoRefreshInterval: 30000, 
        baseApiUrl: '/api'
    };
    
    // Configuration
    const config = {
        maxRetries: 2,
        retryDelay: 1000, // Delay base en ms entre les tentatives
        maxConsecutiveErrors: 5, // Après combien d'erreurs on arrête le polling
        pollingInterval: DASH_CONFIG.autoRefreshInterval || 30000,
        minRefreshInterval: 20000, // Pas de refresh plus fréquent que 20s
        staggerRequests: true, // Décaler les requêtes pour ne pas surcharger
        visibilityPause: true, // Mettre en pause si l'onglet est inactif
        combinedEndpointRetries: 2, // Nombre de tentatives pour l'endpoint dashboard_essential
        baseApiUrl: DASH_CONFIG.baseApiUrl || '/api',
        debugMode: DASH_CONFIG.debugMode || false
    };
    
    // État global
    let consecutiveErrors = 0;
    let pollingEnabled = true;
    let pollingIntervalId = null;
    let lastDataHashes = { sessions: '', participants: '', salles: '', activites: '' };
    let lastFetchTimestamps = { sessions: 0, participants: 0, salles: 0, activites: 0 };
    let isBackendErrorActive = false;
    let dashboardEssentialFailed = false; // Flag pour suivre si dashboard_essential a échoué

    // Fonction de hachage simple pour détecter les changements de données
    function simpleHash(obj) {
        if (!obj) return '';
        try {
            return JSON.stringify(obj).split('').reduce((a, b) => {
                a = ((a << 5) - a) + b.charCodeAt(0);
                return a & a;
            }, 0).toString(36);
        } catch (e) {
            return Math.random().toString(36).substring(2, 8);
        }
    }

    // Afficher/masquer l'avertissement d'erreur backend
    function showBackendErrorWarning(show) {
        let errorDiv = document.getElementById('backend-error-warning');
        
        if (show && !errorDiv) {
            errorDiv = document.createElement('div');
            errorDiv.id = 'backend-error-warning';
            errorDiv.className = 'alert alert-danger alert-dismissible fade show small p-2 mt-2 mx-4';
            errorDiv.setAttribute('role', 'alert');
            errorDiv.innerHTML = `
                <i class="fas fa-exclamation-triangle me-2"></i>
                Impossible de récupérer certaines données du serveur. Les tentatives continues en arrière-plan.
                <button type="button" class="btn-close p-2" data-bs-dismiss="alert" aria-label="Close"></button>
            `;
            
            // Essayer de l'insérer après l'en-tête du dashboard
            const header = document.querySelector('#dashboard-content > div:first-child');
            if (header && header.parentNode) {
                header.parentNode.insertBefore(errorDiv, header.nextSibling);
            } else {
                const container = document.getElementById('dashboard-content');
                if (container) container.prepend(errorDiv);
            }
            
            isBackendErrorActive = true;
        } else if (!show && errorDiv) {
            try {
                if (typeof bootstrap !== 'undefined' && bootstrap.Alert) {
                    const alertInstance = bootstrap.Alert.getOrCreateInstance(errorDiv);
                    if (alertInstance) alertInstance.close();
                } else {
                    errorDiv.remove();
                }
            } catch (e) {
                // Fallback si l'API Bootstrap échoue
                errorDiv.style.display = 'none';
                setTimeout(() => {
                    try { errorDiv.remove(); } catch (e) {}
                }, 300);
            }
            isBackendErrorActive = false;
        }
    }

    // Gestion des erreurs avec compteur
    function handleError(error, component) {
        console.error(`PollingUpdates: Error in ${component}:`, error.message || error);
        consecutiveErrors++;
        
        if (consecutiveErrors >= config.maxConsecutiveErrors && pollingEnabled) {
            console.error(`PollingUpdates: Trop d'erreurs consécutives (${consecutiveErrors}). Polling mis en pause.`);
            pollingEnabled = false;
            
            if (pollingIntervalId) {
                clearInterval(pollingIntervalId);
                pollingIntervalId = null;
            }
            
            showBackendErrorWarning(true);
        }
    }

    // Réinitialiser les compteurs d'erreur après un succès
    function handleSuccess() {
        if (consecutiveErrors > 0) {
            if (config.debugMode) {
                console.log("PollingUpdates: Compteur d'erreurs consécutives réinitialisé.");
            }
            consecutiveErrors = 0;
        }
        
        if (isBackendErrorActive) {
            showBackendErrorWarning(false);
        }
        
        if (!pollingEnabled) {
            pollingEnabled = true;
            startPolling();
        }
    }

    /**
     * Fonction améliorée pour récupérer des données avec gestion d'erreurs robuste
     * @param {string} url - L'URL à appeler
     * @param {Object} options - Options du fetch
     * @returns {Promise<Object|null>} - Les données JSON ou null en cas d'erreur
     */
    async function fetchWithRetry(url, options = {}) {
        let retries = 0;
        let delay = config.retryDelay;
        const cacheBuster = `_=${Date.now()}`;
        const fullUrl = `${url}${url.includes('?') ? '&' : '?'}${cacheBuster}`;
        
        while (retries <= config.maxRetries) {
            try {
                console.log(`PollingUpdates: Fetching URL: ${url} (Attempt ${retries + 1})`);
                
                const response = await fetch(fullUrl, {
                    method: 'GET',
                    credentials: 'same-origin',
                    headers: {
                        'Accept': 'application/json',
                        'X-Requested-With': 'XMLHttpRequest'
                    },
                    ...options
                });
                
                if (response.ok) {
                    const contentType = response.headers.get("content-type");
                    if (contentType && contentType.includes("application/json")) {
                        return await response.json();
                    }
                    
                    console.warn(`PollingUpdates: Réponse non-JSON reçue de ${url}`);
                    throw new Error(`Réponse non-JSON (type: ${contentType})`);
                }
                
                // Gérer les erreurs HTTP spécifiques
                let errorText = '';
                try {
                    errorText = await response.text();
                } catch (e) {
                    errorText = 'Impossible de lire la réponse d\'erreur';
                }
                
                const errorJson = tryParseJson(errorText);
                console.error(`PollingUpdates: Erreur HTTP ${response.status} pour ${url}. Réponse:`, errorJson || errorText.substring(0, 200));
                
                // Traitement spécial pour l'erreur 'places_restantes'
                if (errorJson && errorJson.message === "'places_restantes'" && url.includes('/api/dashboard_essential')) {
                    console.log("PollingUpdates: Erreur spécifique 'places_restantes' détectée. Abandon des tentatives pour cet endpoint.");
                    dashboardEssentialFailed = true;
                    throw new Error("Erreur places_restantes détectée, passage aux endpoints individuels");
                }
                
                // Ne pas réessayer indéfiniment les erreurs client (4xx) sauf 429 (Too Many Requests)
                if (response.status >= 400 && response.status < 500 && response.status !== 429) {
                    throw new Error(`Erreur client HTTP ${response.status}`);
                }
                
                // Pour les erreurs serveur (5xx) ou 429, on réessaie
                retries++;
                if (retries > config.maxRetries) {
                    console.error(`PollingUpdates: Max retries atteint pour ${url}. Abandon.`);
                    throw new Error(`Max retries (${config.maxRetries}) dépassés`);
                }
                
                // Attente exponentielle avec jitter
                await new Promise(resolve => setTimeout(resolve, delay + Math.random() * 500));
                delay *= 1.8; // Augmenter le délai plus agressivement
                
            } catch (error) {
                // Si c'est l'erreur spécifique places_restantes, ne pas réessayer
                if (error.message.includes('places_restantes')) {
                    throw error;
                }
                
                retries++;
                console.warn(`PollingUpdates: Erreur fetch pour ${url} (Tentative ${retries}/${config.maxRetries + 1}):`, error.message);
                
                if (retries > config.maxRetries) {
                    console.error(`PollingUpdates: Max retries atteint pour ${url}. Abandon.`);
                    throw error;
                }
                
                // Attente exponentielle avec jitter
                await new Promise(resolve => setTimeout(resolve, delay + Math.random() * 500));
                delay *= 1.8;
            }
        }
        
        // Ne devrait pas être atteint, mais sécurité
        throw new Error(`Échec de récupération de ${url} après ${config.maxRetries + 1} tentatives.`);
    }

    // Fonction utilitaire pour essayer de parser du JSON
    function tryParseJson(text) {
        try {
            return JSON.parse(text);
        } catch (e) {
            return null;
        }
    }

    // Vérifier si une ressource doit être rafraîchie
    function shouldRefreshResource(resourceName) {
        const now = Date.now();
        const lastFetch = lastFetchTimestamps[resourceName] || 0;
        return (now - lastFetch) >= config.minRefreshInterval;
    }

    /**
     * Refresh all dashboard components
     * Improved to handle combined endpoint failure
     */
    async function refreshDashboardComponents() {
        if (!pollingEnabled || (config.visibilityPause && document.visibilityState !== 'visible')) {
            if (pollingEnabled && config.debugMode) console.log('PollingUpdates: Skipped refresh (tab not visible)');
            return;
        }
        
        console.log("PollingUpdates: Attempting refresh cycle...");
        
        let dashboardDataPayload = { sessions: null, participants: null, salles: null, activites: null };
        let dataUpdatedOverall = false;
        
        // Si l'endpoint combiné a déjà échoué avec l'erreur places_restantes, utiliser directement les endpoints individuels
        if (dashboardEssentialFailed) {
            console.log('PollingUpdates: Utilisation des endpoints individuels comme fallback...');
            await refreshUsingIndividualEndpoints(dashboardDataPayload);
        } else {
            // Essayer d'abord l'endpoint combiné
            try {
                const combinedData = await fetchWithRetry(`${config.baseApiUrl}/dashboard_essential`, {
                    timeout: 10000 // 10 secondes timeout
                });
                
                if (combinedData) {
                    // Transformation et vérification des données reçues
                    if (combinedData.sessions && Array.isArray(combinedData.sessions)) {
                        const sessionsHash = simpleHash(combinedData.sessions);
                        if (lastDataHashes.sessions !== sessionsHash) {
                            dashboardDataPayload.sessions = combinedData.sessions;
                            lastDataHashes.sessions = sessionsHash;
                            lastFetchTimestamps.sessions = Date.now();
                            dataUpdatedOverall = true;
                            console.log('PollingUpdates: sessions data has changed.');
                        }
                    }
                    
                    if (combinedData.activites && Array.isArray(combinedData.activites)) {
                        const activitesHash = simpleHash(combinedData.activites);
                        if (lastDataHashes.activites !== activitesHash) {
                            dashboardDataPayload.activites = combinedData.activites;
                            lastDataHashes.activites = activitesHash;
                            lastFetchTimestamps.activites = Date.now();
                            dataUpdatedOverall = true;
                            console.log('PollingUpdates: activites data has changed.');
                        }
                    }
                    
                    // Note: combinedData peut ne pas contenir participants/salles, ce qui est OK
                }
            } catch (error) {
                console.error('PollingUpdates: Échec de l\'endpoint combiné:', error.message);
                
                // Si l'erreur contient places_restantes, on flaggue pour toujours utiliser les endpoints individuels
                if (error.message.includes('places_restantes')) {
                    dashboardEssentialFailed = true;
                    console.warn('PollingUpdates: Passage permanent aux endpoints individuels en raison de l\'erreur places_restantes');
                }
                
                // Fallback vers les endpoints individuels
                console.log('PollingUpdates: Utilisation des endpoints individuels comme fallback...');
                await refreshUsingIndividualEndpoints(dashboardDataPayload);
            }
        }
        
        // Mise à jour UI seulement si des données ont changé ET aucune erreur fatale n'a arrêté le polling
        if (dataUpdatedOverall && pollingEnabled) {
            if (config.debugMode) console.log("PollingUpdates: Data changed, updating UI with payload:", dashboardDataPayload);
            
            // Mise à jour des composants
            updateStatsAndUI(dashboardDataPayload);
            updateActivityFeed(dashboardDataPayload.activites);
            
            // Réinitialiser le compteur d'erreurs, cacher l'alerte si besoin
            handleSuccess();
            
            // Notification aux autres modules que des données ont été mises à jour
            document.dispatchEvent(new CustomEvent('dashboardDataRefreshed', { 
                detail: { data: dashboardDataPayload } 
            }));
        } else if (!dataUpdatedOverall && pollingEnabled) {
            if (config.debugMode) console.log(`PollingUpdates: No data changes detected, UI not updated this cycle.`);
            handleSuccess(); // Considérer un cycle sans changement comme un succès
        }
    }

    /**
     * Refresh using individual API endpoints when combined endpoint fails
     * @param {Object} dashboardDataPayload - Data container to be filled
     * @returns {Promise<boolean>} - Success indicator
     */
    async function refreshUsingIndividualEndpoints(dashboardDataPayload) {
        let dataUpdatedOverall = false;
        
        // Liste des endpoints individuels à appeler
        const endpoints = [
            { name: 'sessions', url: `${config.baseApiUrl}/sessions` },
            { name: 'activites', url: `${config.baseApiUrl}/activites` }
        ];
        
        // Endpoints optionnels selon les composants visibles
        if (document.getElementById('participants-chart') || document.querySelector('[data-component="participants-data"]')) {
            endpoints.push({ name: 'participants', url: `${config.baseApiUrl}/participants` });
        }
        
        // Appels en parallèle pour plus d'efficacité
        const results = await Promise.allSettled(
            endpoints.map(endpoint => 
                shouldRefreshResource(endpoint.name) 
                    ? fetchWithRetry(endpoint.url).catch(e => {
                        console.error(`PollingUpdates: Erreur sur endpoint individuel ${endpoint.name}:`, e);
                        return null;
                    })
                    : Promise.resolve(null)
            )
        );
        
        // Traitement des résultats
        for (let i = 0; i < endpoints.length; i++) {
            const endpoint = endpoints[i];
            const result = results[i];
            
            if (result.status === 'fulfilled' && result.value) {
                const data = result.value;
                const dataArray = Array.isArray(data) ? data : (data.items || null);
                
                if (dataArray) {
                    const dataHash = simpleHash(dataArray);
                    if (lastDataHashes[endpoint.name] !== dataHash) {
                        dashboardDataPayload[endpoint.name] = dataArray;
                        lastDataHashes[endpoint.name] = dataHash;
                        lastFetchTimestamps[endpoint.name] = Date.now();
                        dataUpdatedOverall = true;
                        console.log(`PollingUpdates: ${endpoint.name} data has changed.`);
                    }
                }
            } else if (result.status === 'rejected') {
                console.error(`PollingUpdates: Échec de l'endpoint ${endpoints[i].name}:`, result.reason);
                handleError(result.reason, `${endpoints[i].name} endpoint`);
            }
        }
        
        return dataUpdatedOverall;
    }

    /**
     * Update page statistics and UI components with refreshed data
     * @param {Object} payload - Data for updating UI
     */
    function updateStatsAndUI(payload) {
        console.log("PollingUpdates: Données reçues pour stats/UI:", JSON.stringify(payload));
        
        // Mettre à jour les statistiques globales et compteurs
        if (payload.sessions && Array.isArray(payload.sessions)) {
            updateSessionStats(payload.sessions);
            
            // Mettre à jour le tableau des sessions si présent
            if (typeof window.updateSessionTable === 'function') {
                window.updateSessionTable(payload.sessions);
            }
        }
        
        // Mettre à jour d'autres composants UI si besoin
        if (payload.participants && Array.isArray(payload.participants)) {
            updateParticipantStats(payload.participants);
        }
        
        // Appliquer les corrections UI après les mises à jour
        if (typeof window.uiFixers !== 'undefined' && typeof window.uiFixers.applyAllFixes === 'function') {
            setTimeout(window.uiFixers.applyAllFixes, 100);
        }
    }

    /**
     * Mise à jour des statistiques des sessions
     * @param {Array} sessions - Données de sessions
     */
    function updateSessionStats(sessions) {
        if (!sessions || !Array.isArray(sessions)) return;
        
        try {
            // Calcul des statistiques
            let totalSessions = sessions.length;
            let totalInscriptions = 0;
            let totalEnAttente = 0;
            let totalSessionsCompletes = 0;
            
            sessions.forEach(session => {
                if (typeof session.inscrits === 'number') {
                    totalInscriptions += session.inscrits;
                }
                
                if (typeof session.liste_attente === 'number') {
                    totalEnAttente += session.liste_attente;
                }
                
                // Une session est complète si places_restantes = 0
                if (typeof session.places_restantes === 'number' && session.places_restantes <= 0) {
                    totalSessionsCompletes++;
                }
            });
            
            // Mise à jour des compteurs dans le DOM
            updateCounter('total-inscriptions', totalInscriptions);
            updateCounter('total-en-attente', totalEnAttente);
            updateCounter('total-sessions', totalSessions);
            updateCounter('total-sessions-completes', totalSessionsCompletes);
            
            // Animation des compteurs globaux si besoin
            if (typeof window.animateAllDashboardCounters === 'function') {
                window.animateAllDashboardCounters();
            }
        } catch (e) {
            console.error('PollingUpdates: Erreur lors de la mise à jour des statistiques des sessions:', e);
        }
    }

    /**
     * Mise à jour des statistiques des participants
     * @param {Array} participants - Données des participants
     */
    function updateParticipantStats(participants) {
        if (!participants || !Array.isArray(participants)) return;
        
        try {
            // Mise à jour du compteur de participants total si présent
            updateCounter('total-participants', participants.length);
            
            // Mise à jour d'autres éléments liés aux participants si nécessaire
        } catch (e) {
            console.error('PollingUpdates: Erreur lors de la mise à jour des statistiques des participants:', e);
        }
    }

    /**
     * Update activity feed with recent activities
     * @param {Array} activitesArray - Recent activities data
     */
    function updateActivityFeed(activitesArray) {
        console.log("PollingUpdates: Données reçues pour Activité Récente:", JSON.stringify(activitesArray));
        
        const activityContainer = document.getElementById('recent-activity');
        if (!activityContainer || !activitesArray || !Array.isArray(activitesArray)) return;
        
        try {
            // Vider le conteneur ou stocker l'état actuel pour comparaison
            const currentFirstActivityId = activityContainer.querySelector('.activity-item')?.dataset?.activityId;
            
            // Construction du HTML pour les activités
            let activitiesHTML = '';
            activitesArray.slice(0, 10).forEach(activity => { // Limiter à 10 activités
                const icon = getIconForActivity(activity.type);
                const userPart = activity.user ? `<span class="text-primary">${activity.user}</span>` : '';
                
                activitiesHTML += `
                <div class="activity-item" data-activity-id="${activity.id}">
                    <div class="activity-icon">
                        <i class="${icon}"></i>
                    </div>
                    <div class="activity-content">
                        <div class="activity-title">
                            ${activity.description} ${userPart}
                        </div>
                        <div class="activity-subtitle">
                            ${activity.details ? `<small>${activity.details}</small><br>` : ''}
                            <small class="text-muted">${activity.date_relative || ''}</small>
                        </div>
                    </div>
                </div>`;
            });
            
            // Mise à jour du DOM seulement si nécessaire
            if (activitiesHTML && (
                !currentFirstActivityId || 
                currentFirstActivityId !== activitesArray[0]?.id?.toString()
            )) {
                // Remplacer le contenu avec animation
                activityContainer.innerHTML = activitiesHTML;
                activityContainer.querySelectorAll('.activity-item').forEach((el, index) => {
                    el.style.animationDelay = `${index * 50}ms`;
                    el.classList.add('fade-in');
                });
            }
            
            // Mettre à jour le titre si nécessaire
            const activityTitle = document.querySelector('.activity-feed-title');
            if (activityTitle) {
                activityTitle.textContent = `Activité Récente (${activitesArray.length})`;
            }
        } catch (e) {
            console.error('PollingUpdates: Erreur lors de la mise à jour du flux d\'activités:', e);
        }
    }

    /**
     * Update a counter element with animation
     * @param {string} elementId - ID of the counter element
     * @param {number} value - New value
     */
    function updateCounter(elementId, value) {
        const element = document.getElementById(elementId);
        if (!element) return;
        
        // Extraire la valeur actuelle
        const currentValue = parseInt(element.textContent.replace(/[^\d]/g, ''), 10) || 0;
        
        // Ne mettre à jour que si la valeur a changé
        if (currentValue !== value) {
            if (typeof window.animateCounter === 'function') {
                window.animateCounter(element, currentValue, value);
            } else {
                // Fallback si la fonction d'animation n'est pas disponible
                element.textContent = value.toLocaleString();
            }
        }
    }

    /**
     * Get appropriate icon class based on activity type
     * @param {string} type - Activity type
     * @returns {string} - Icon class
     */
    function getIconForActivity(type) {
        const iconMap = {
            'connexion': 'fas fa-sign-in-alt text-success',
            'deconnexion': 'fas fa-sign-out-alt text-warning',
            'inscription': 'fas fa-user-plus text-primary',
            'validation': 'fas fa-check-circle text-success',
            'refus': 'fas fa-times-circle text-danger',
            'annulation': 'fas fa-ban text-danger',
            'ajout_participant': 'fas fa-user-plus text-primary',
            'suppression_participant': 'fas fa-user-minus text-danger',
            'modification_participant': 'fas fa-user-edit text-warning',
            'reinscription': 'fas fa-redo text-info',
            'liste_attente': 'fas fa-clock text-warning',
            'ajout_theme': 'fas fa-folder-plus text-primary',
            'ajout_service': 'fas fa-building text-primary',
            'ajout_salle': 'fas fa-door-open text-primary',
            'attribution_salle': 'fas fa-map-marker-alt text-info',
            'systeme': 'fas fa-cog text-secondary',
            'notification': 'fas fa-bell text-warning',
            'default': 'fas fa-info-circle text-secondary'
        };
        
        return iconMap[type] || iconMap.default;
    }

    /**
     * Stub for refreshRecentActivity exported for backward compatibility
     */
    window.refreshRecentActivity = function() {
        console.log("PollingUpdates: refreshRecentActivity called - handled by polling-updates.js");
        
        if (shouldRefreshResource('activites')) {
            fetchWithRetry(`${config.baseApiUrl}/activites`)
                .then(data => {
                    if (data && Array.isArray(data)) {
                        updateActivityFeed(data);
                        lastFetchTimestamps.activites = Date.now();
                    }
                })
                .catch(e => console.error("PollingUpdates: Error refreshing activities:", e));
        }
    };

    /**
     * Stub for updateStatsCounters exported for backward compatibility
     */
    window.updateStatsCounters = function() {
        console.log("PollingUpdates: updateStatsCounters called - handled by polling-updates.js");
        
        if (shouldRefreshResource('sessions')) {
            fetchWithRetry(`${config.baseApiUrl}/sessions`)
                .then(data => {
                    if (data) {
                        const sessions = Array.isArray(data) ? data : (data.items || []);
                        updateSessionStats(sessions);
                        lastFetchTimestamps.sessions = Date.now();
                    }
                })
                .catch(e => console.error("PollingUpdates: Error refreshing stats:", e));
        }
    };

    /**
     * Force an immediate update of all dashboard components
     * @param {boolean} importantChange - Whether this is an important change requiring full refresh
     * @returns {Promise} - Resolution indicates refresh cycle completion
     */
    window.forcePollingUpdate = async function(importantChange = false) {
        if (config.debugMode) console.log("PollingUpdates: Manual refresh forced. ImportantChange:", importantChange);
        
        // Si le polling était désactivé à cause d'erreurs, le réactiver pour cette tentative
        const wasPollingDisabled = !pollingEnabled;
        if (wasPollingDisabled) {
            console.log("PollingUpdates: Réactivation temporaire du polling pour l'actualisation manuelle.");
            pollingEnabled = true;
            consecutiveErrors = 0;
            showBackendErrorWarning(false);
        }
        
        if (importantChange) {
            // Réinitialiser les timestamps et hashes pour forcer un refresh complet
            Object.keys(lastFetchTimestamps).forEach(key => lastFetchTimestamps[key] = 0);
            Object.keys(lastDataHashes).forEach(key => lastDataHashes[key] = '');
            
            // Réinitialiser le flag d'échec de l'endpoint combiné pour le retester
            dashboardEssentialFailed = false;
        }
        
        // Suspendre l'intervalle pendant l'actualisation manuelle
        if (pollingIntervalId) {
            clearInterval(pollingIntervalId);
            pollingIntervalId = null;
        }
        
        try {
            await refreshDashboardComponents();
            return { success: true };
        } catch (e) {
            console.error("PollingUpdates: Erreur pendant forcePollingUpdate", e);
            return { success: false, error: e.message };
        } finally {
            // Redémarrer le polling seulement s'il était actif avant l'appel manuel
            if (pollingEnabled) {
                startPolling();
            } else if (wasPollingDisabled) {
                // Si on l'a réactivé juste pour le test et qu'il a encore échoué (handleError l'aura remis à false)
                if (pollingEnabled) startPolling();
                else console.log("PollingUpdates: L'actualisation manuelle a échoué, le polling reste désactivé.");
            }
        }
    };

    /**
     * Start the polling mechanism
     */
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
        showBackendErrorWarning(false);
        
        // Premier appel un peu différé
        setTimeout(refreshDashboardComponents, 500);
        
        // Démarrer l'intervalle
        pollingIntervalId = setInterval(refreshDashboardComponents, config.pollingInterval);
    }

    // --- Initialisation ---
    // Démarrer le polling si le mode est 'polling' ou 'auto' (car WebSocket n'est pas utilisé ici)
    if (DASH_CONFIG.activeMode === 'polling' || !DASH_CONFIG.activeMode) {
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
    
    console.log('PollingUpdates: Setup complete (v3.1.0).');
});
