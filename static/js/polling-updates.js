/**
 * polling-updates.js - Optimized polling for dashboard updates.
 * v3.1.0 - Solution aux problèmes de chargement et actualisation.
 */

document.addEventListener('DOMContentLoaded', function() {
    console.log("--- polling-updates.js EXECUTING ---");

    // Configuration - Mise à jour pour forcer le mode polling
    window.dashboardConfig = window.dashboardConfig || {
        debugMode: true,
        autoRefreshInterval: 30000,
        baseApiUrl: '/api',
        pollingEnabled: true,
        socketEnabled: false,  // Désactiver Socket.IO en raison des erreurs gevent
        preferredMode: 'polling'  // Forcer le mode polling
    };

    const DASH_CONFIG = window.dashboardConfig;
    
    if (DASH_CONFIG.debugMode) {
        console.log('PollingUpdates: Initialized (v3.1.0 - Optimized for stability)');
    }
    
    // Configuration interne
    const config = {
        baseApiUrl: DASH_CONFIG.baseApiUrl || '/api',
        pollingInterval: DASH_CONFIG.autoRefreshInterval || 30000,
        maxConsecutiveErrors: 3,
        maxRetries: 2,
        retryDelay: 1000,
        staggerRequests: true,
        visibilityPause: true,
        minTimeBetweenRefresh: {
            sessions: 20000,  // 20s
            participants: 60000,  // 1m
            salles: 120000,  // 2m
            activites: 10000   // 10s
        },
        debugMode: DASH_CONFIG.debugMode || false
    };
    
    let consecutiveErrors = 0;
    let pollingEnabled = true;
    let pollingIntervalId = null;
    let lastDataHashes = { sessions: '', participants: '', salles: '', activites: '' };
    let lastFetchTimestamps = { sessions: 0, participants: 0, salles: 0, activites: 0 };
    let isBackendErrorActive = false; // Flag pour suivre l'état de l'erreur backend
    
    // Fonction de hachage simple pour comparer les données
    function simpleHash(obj) {
        if (!obj) return '';
        try {
            // Pour les tableaux, joindre les IDs et les principales valeurs de chaque objet
            if (Array.isArray(obj)) {
                return obj.map(item => {
                    if (typeof item === 'object' && item !== null) {
                        // Extraire les propriétés clés selon le type d'objet
                        if ('id' in item) {
                            if ('inscrits' in item) return `${item.id}:${item.inscrits}:${item.places_restantes || 0}`;
                            if ('service' in item) return `${item.id}:${item.service}`;
                            if ('type' in item) return `${item.id}:${item.type}:${item.description}`;
                            return `${item.id}`;
                        }
                        // Fallback pour les objets sans id
                        return JSON.stringify(item).slice(0, 50);
                    }
                    return String(item);
                }).join('|');
            }
            // Pour les objets, utiliser une version tronquée du JSON
            return JSON.stringify(obj).slice(0, 100);
        } catch (e) {
            console.warn('PollingUpdates: Error in simpleHash:', e);
            return String(Date.now()); // Fallback - traiter comme toujours différent
        }
    }
    
    // Affiche ou masque le message d'erreur backend
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
            errorDiv.remove(); // Supprimer l'élément directement
            isBackendErrorActive = false;
        } else if (show && errorDiv) {
            // L'erreur est déjà affichée
            isBackendErrorActive = true;
        }
    }
    
    // Gestion des erreurs
    function handleError(error, component) {
        console.error(`PollingUpdates: Error in ${component}:`, error.message || error);
        consecutiveErrors++;
        if (consecutiveErrors >= config.maxConsecutiveErrors && pollingEnabled) {
            console.error(`PollingUpdates: Trop d'erreurs consécutives (${consecutiveErrors}). Polling mis en pause.`);
            pollingEnabled = false; // Arrêter les tentatives de polling
            if (pollingIntervalId) clearInterval(pollingIntervalId);
            pollingIntervalId = null;
            showBackendErrorWarning(true); // Afficher l'alerte à l'utilisateur
        }
    }
    
    // Gestion des succès - réinitialise les erreurs
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
    
    // Fonction pour fetch avec retry et timeout
    async function fetchWithRetry(url, options = {}) {
        let retries = 0;
        let delay = config.retryDelay;
        const cacheBuster = `_=${Date.now()}`;
        const fullUrl = `${url}${url.includes('?') ? '&' : '?'}${cacheBuster}`;
        
        while (retries <= config.maxRetries) {
            try {
                console.log(`PollingUpdates: Fetching URL: ${url} (Attempt ${retries + 1})`);
                
                // Utiliser AbortController pour le timeout
                const controller = new AbortController();
                const timeoutId = setTimeout(() => controller.abort(), 10000); // 10s timeout
                
                const fetchOptions = {
                    ...options,
                    signal: controller.signal
                };
                
                const response = await fetch(fullUrl, fetchOptions);
                clearTimeout(timeoutId);
                
                if (response.ok) {
                    const contentType = response.headers.get("content-type");
                    if (contentType && contentType.includes("application/json")) {
                        return await response.json(); // Succès !
                    }
                    console.warn(`PollingUpdates: Réponse non-JSON reçue de ${url}`);
                    throw new Error(`Réponse non-JSON (type: ${contentType})`);
                }
                
                // Gérer les erreurs HTTP non-OK
                const errorText = await response.text();
                console.error(`PollingUpdates: Erreur HTTP ${response.status} pour ${url}. Réponse: ${errorText.substring(0, 200)}`);
                
                // Ne pas réessayer indéfiniment les erreurs client (4xx) sauf 429 (Too Many Requests)
                if (response.status >= 400 && response.status < 500 && response.status !== 429) {
                    throw new Error(`Erreur client HTTP ${response.status}`);
                }
                
                // Pour les erreurs serveur (5xx) ou 429, on réessaie
                throw new Error(`Erreur serveur HTTP ${response.status}`);
            } catch (error) {
                retries++;
                
                if (error.name === 'AbortError') {
                    console.warn(`PollingUpdates: Timeout for ${url} (Attempt ${retries}/${config.maxRetries + 1})`);
                } else {
                    console.warn(`PollingUpdates: Erreur fetch pour ${url} (Tentative ${retries}/${config.maxRetries + 1}):`, error.message);
                }
                
                if (retries > config.maxRetries) {
                    console.error(`PollingUpdates: Max retries atteint pour ${url}. Abandon.`);
                    throw error;
                }
                
                // Attente exponentielle avec jitter
                await new Promise(resolve => setTimeout(resolve, delay + Math.random() * 500));
                delay *= 1.8; // Augmenter le délai plus agressivement
            }
        }
        
        // Ne devrait pas être atteint, mais sécurité
        throw new Error(`Échec de récupération de ${url} après ${config.maxRetries + 1} tentatives.`);
    }
    
    // Détermine si une ressource doit être actualisée
    function shouldRefreshResource(resourceName) {
        const now = Date.now();
        const lastFetch = lastFetchTimestamps[resourceName] || 0;
        const timeSinceLastFetch = now - lastFetch;
        const minTime = config.minTimeBetweenRefresh[resourceName] || 10000; // Default 10s
        
        if (timeSinceLastFetch < minTime) {
            if (config.debugMode) console.log(`PollingUpdates: Skipping ${resourceName} refresh (${timeSinceLastFetch}ms < ${minTime}ms)`);
            return false;
        }
        return true;
    }
    
    // Fonction centrale d'actualisation du tableau de bord
    async function refreshDashboardComponents() {
        if (!pollingEnabled || (config.visibilityPause && document.visibilityState !== 'visible')) {
            if (pollingEnabled && config.debugMode) console.log('PollingUpdates: Skipped refresh (tab not visible)');
            return;
        }
        
        console.log("PollingUpdates: Attempting refresh cycle...");
        
        let dashboardDataPayload = { sessions: null, participants: null, salles: null, activites: null };
        let dataUpdatedOverall = false;
        let cycleHasError = false;
        
        const resourcesToFetch = [
            { name: 'sessions', endpoint: `${config.baseApiUrl}/sessions` },
            { name: 'participants', endpoint: `${config.baseApiUrl}/participants` },
            { name: 'salles', endpoint: `${config.baseApiUrl}/salles` },
            { name: 'activites', endpoint: `${config.baseApiUrl}/activites`, condition: () => document.getElementById('recent-activity') }
        ];
        
        try {
            // Essayons d'abord l'endpoint combiné pour plus d'efficacité
            const dashboardEssentialEndpoint = `${config.baseApiUrl}/dashboard_essential`;
            try {
                const essentialData = await fetchWithRetry(dashboardEssentialEndpoint);
                console.log("PollingUpdates: Données essentielles reçues:", essentialData);
                
                if (essentialData && !essentialData.error) {
                    // Mettre à jour les timestamps
                    for (const resourceName of ['sessions', 'participants', 'activites']) {
                        if (essentialData[resourceName]) {
                            lastFetchTimestamps[resourceName] = Date.now();
                            
                            // Vérifier si les données ont changé
                            const currentDataHash = simpleHash(essentialData[resourceName]);
                            if (lastDataHashes[resourceName] !== currentDataHash) {
                                dashboardDataPayload[resourceName] = essentialData[resourceName];
                                lastDataHashes[resourceName] = currentDataHash;
                                dataUpdatedOverall = true;
                                if (config.debugMode) console.log(`PollingUpdates: ${resourceName} data has changed.`);
                            } else {
                                if (config.debugMode) console.log(`PollingUpdates: ${resourceName} data unchanged.`);
                            }
                        }
                    }
                    
                    // Comme nous avons réussi, nous ignorons les endpoints individuels
                    handleSuccess();
                } else {
                    // Si l'endpoint combiné échoue, utilisons les endpoints individuels
                    throw new Error("Endpoint dashboard_essential failed or returned error. Falling back to individual endpoints.");
                }
            } catch (essentialError) {
                console.warn("PollingUpdates: Échec de l'endpoint combiné:", essentialError.message);
                console.log("PollingUpdates: Utilisation des endpoints individuels comme fallback...");
                
                // Continuer avec les endpoints individuels
                for (const resource of resourcesToFetch) {
                    if (resource.condition && !resource.condition()) continue;
                    if (!shouldRefreshResource(resource.name)) continue; // Sauter si pas besoin de rafraîchir
                    
                    if (config.staggerRequests && dataUpdatedOverall) {
                        await new Promise(resolve => setTimeout(resolve, 250 + Math.random() * 150));
                    }
                    
                    try {
                        const apiResponse = await fetchWithRetry(resource.endpoint);
                        lastFetchTimestamps[resource.name] = Date.now();
                        
                        // Traitement de la réponse (si succès)
                        const currentDataArray = Array.isArray(apiResponse?.items) ? apiResponse.items : (Array.isArray(apiResponse) ? apiResponse : null);
                        
                        if (currentDataArray === null && apiResponse !== null) {
                            console.warn(`PollingUpdates: Format de données inattendu pour ${resource.name}. Réponse:`, apiResponse);
                        } else if (currentDataArray !== null) {
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
                    } catch (fetchError) {
                        handleError(fetchError, `${resource.name} fetch`);
                        cycleHasError = true;
                    }
                }
            }
            
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
        } catch (error) {
            console.error('PollingUpdates: Erreur majeure dans le cycle de rafraîchissement:', error);
            handleError(error, 'refresh cycle logic');
        }
    }
    
    // Met à jour les statistiques et l'UI avec les données reçues
    function updateStatsAndUI(payload) {
        console.log("PollingUpdates: Données reçues pour stats/UI:", JSON.stringify(payload));
        
        // Mise à jour du tableau des sessions si les données et la fonction existent
        if (payload.sessions && typeof window.updateSessionTable === 'function') {
            try {
                window.updateSessionTable(payload.sessions);
            } catch (e) {
                console.error("PollingUpdates: Erreur lors de la mise à jour du tableau des sessions:", e);
            }
        }
        
        // Mise à jour des compteurs de statistiques
        if (payload.sessions) {
            try {
                updateDashboardStatistics(payload.sessions);
            } catch (e) {
                console.error("PollingUpdates: Erreur lors de la mise à jour des statistiques:", e);
            }
        }
        
        // Mise à jour des graphiques via l'événement - géré par charts-enhanced.js
    }
    
    // Met à jour les compteurs de statistiques du tableau de bord
    function updateDashboardStatistics(sessions) {
        if (!sessions || !Array.isArray(sessions)) return;
        
        // Calcul des totaux
        let totalInscriptions = 0;
        let totalEnAttente = 0;
        let totalSessionsCompletes = 0;
        let totalSessions = sessions.length;
        
        sessions.forEach(session => {
            // Vérifier que les propriétés nécessaires existent
            if (typeof session.inscrits === 'number') {
                totalInscriptions += session.inscrits;
            }
            
            if (typeof session.liste_attente === 'number') {
                totalEnAttente += session.liste_attente;
            }
            
            if (typeof session.places_restantes === 'number' && session.places_restantes <= 0) {
                totalSessionsCompletes++;
            }
        });
        
        // Mise à jour des compteurs dans l'UI
        updateCounter('total-inscriptions', totalInscriptions);
        updateCounter('total-en-attente', totalEnAttente);
        updateCounter('total-sessions-completes', totalSessionsCompletes);
        
        // Exposer ces statistiques globalement pour d'autres composants
        window.dashboardStats = {
            totalInscriptions,
            totalEnAttente,
            totalSessionsCompletes,
            totalSessions
        };
    }
    
    // Met à jour le feed d'activités récentes
    function updateActivityFeed(activitesArray) {
        console.log("PollingUpdates: Données reçues pour Activité Récente:", JSON.stringify(activitesArray));
        
        const activityContainer = document.getElementById('recent-activity');
        if (!activityContainer) return;
        
        // Supprimer le spinner de chargement
        const loadingSpinner = activityContainer.querySelector('.loading-spinner');
        if (loadingSpinner) {
            loadingSpinner.remove();
        }
        
        if (!activitesArray || !Array.isArray(activitesArray) || activitesArray.length === 0) {
            // Afficher un message si pas d'activités
            if (activityContainer.children.length === 0) {
                activityContainer.innerHTML = `
                    <div class="text-center text-muted p-3">
                        <i class="fas fa-info-circle me-2"></i>
                        Aucune activité récente
                    </div>
                `;
            }
            return;
        }
        
        // Vider le conteneur si nécessaire
        if (!loadingSpinner && activityContainer.children.length === 0 || 
            activityContainer.querySelector('.text-muted')) {
            activityContainer.innerHTML = '';
        }
        
        // Fonction pour créer un élément d'activité
        function createActivityItem(activity) {
            const activityIcons = {
                'connexion': 'fa-sign-in-alt',
                'deconnexion': 'fa-sign-out-alt',
                'inscription': 'fa-user-plus',
                'validation': 'fa-check-circle',
                'refus': 'fa-times-circle',
                'annulation': 'fa-ban',
                'ajout_participant': 'fa-user-plus',
                'modification_participant': 'fa-user-edit',
                'suppression_participant': 'fa-user-minus',
                'liste_attente': 'fa-clock',
                'ajout_theme': 'fa-plus-circle',
                'modification_theme': 'fa-edit',
                'suppression_theme': 'fa-trash-alt',
                'ajout_salle': 'fa-door-open',
                'modification_salle': 'fa-door-open',
                'suppression_salle': 'fa-door-closed',
                'attribution_salle': 'fa-building',
                'notification': 'fa-bell',
                'systeme': 'fa-cogs',
                'default': 'fa-info-circle'
            };
            
            const icon = activityIcons[activity.type] || activityIcons.default;
            
            let itemClass = 'list-group-item-light';
            if (activity.type.includes('ajout')) itemClass = 'list-group-item-success';
            if (activity.type.includes('suppression')) itemClass = 'list-group-item-danger';
            if (activity.type.includes('modification')) itemClass = 'list-group-item-warning';
            if (activity.type.includes('validation')) itemClass = 'list-group-item-info';
            
            const activityItem = document.createElement('div');
            activityItem.classList.add('list-group-item', 'py-2', itemClass);
            activityItem.dataset.activityId = activity.id;
            
            activityItem.innerHTML = `
                <div class="d-flex align-items-start">
                    <div class="me-2">
                        <i class="fas ${icon} fa-fw text-primary"></i>
                    </div>
                    <div class="flex-grow-1">
                        <div class="d-flex justify-content-between">
                            <strong class="mb-1">${activity.description}</strong>
                            <small class="text-muted">${activity.date_relative || 'récemment'}</small>
                        </div>
                        ${activity.details ? `<small class="text-muted">${activity.details}</small>` : ''}
                        ${activity.user ? `<small class="d-block text-primary">Par: ${activity.user}</small>` : ''}
                    </div>
                </div>
            `;
            
            return activityItem;
        }
        
        // Ajouter chaque activité au conteneur (seulement les nouvelles)
        activitesArray.forEach(activity => {
            // Vérifier si l'activité existe déjà
            const existingActivity = activityContainer.querySelector(`[data-activity-id="${activity.id}"]`);
            if (!existingActivity) {
                const activityItem = createActivityItem(activity);
                
                // Ajouter l'élément au début (plus récent en haut)
                if (activityContainer.firstChild) {
                    activityContainer.insertBefore(activityItem, activityContainer.firstChild);
                } else {
                    activityContainer.appendChild(activityItem);
                }
                
                // Animation d'entrée
                activityItem.style.opacity = '0';
                activityItem.style.transform = 'translateX(-10px)';
                setTimeout(() => {
                    activityItem.style.transition = 'opacity 0.3s ease, transform 0.3s ease';
                    activityItem.style.opacity = '1';
                    activityItem.style.transform = 'translateX(0)';
                }, 50);
            }
        });
        
        // Limiter le nombre d'éléments affichés (garder les 10 plus récents)
        const allItems = activityContainer.querySelectorAll('.list-group-item');
        if (allItems.length > 10) {
            for (let i = 10; i < allItems.length; i++) {
                allItems[i].remove();
            }
        }
    }
    
    // Met à jour un compteur avec animation
    function updateCounter(elementId, value) {
        const element = document.getElementById(elementId);
        if (!element) return;
        
        const currentValue = parseInt(element.textContent.replace(/[^\d]/g, '')) || 0;
        
        if (currentValue !== value) {
            window.animateCounter(element, currentValue, value);
        }
    }
    
    // Fonction globale pour animer un compteur
    window.animateCounter = function(element, startValue, endValue, duration = 700) {
        if (!element) return;
        
        // Assurons-nous d'utiliser des nombres
        startValue = parseInt(startValue) || 0;
        endValue = parseInt(endValue) || 0;
        
        // Si pas de changement, ne rien faire
        if (startValue === endValue) return;
        
        const diff = endValue - startValue;
        const startTime = performance.now();
        
        function updateValue(timestamp) {
            const elapsedTime = timestamp - startTime;
            
            if (elapsedTime < duration) {
                const progress = elapsedTime / duration;
                const easeProgress = progress < 0.5 ? 4 * progress * progress * progress : 1 - Math.pow(-2 * progress + 2, 3) / 2; // Ease in-out cubic
                const currentValue = Math.round(startValue + diff * easeProgress);
                element.textContent = currentValue.toLocaleString();
                requestAnimationFrame(updateValue);
            } else {
                element.textContent = endValue.toLocaleString();
            }
        }
        
        requestAnimationFrame(updateValue);
    };
    
    // Fonction globale pour animer tous les compteurs du tableau de bord
    window.animateAllDashboardCounters = function() {
        const counterElements = document.querySelectorAll('.counter-value');
        counterElements.forEach(el => {
            const finalValue = parseInt(el.getAttribute('data-final') || '0');
            window.animateCounter(el, 0, finalValue);
        });
    };
    
    // Force le rafraîchissement manuel des données
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
            return Promise.resolve({ success: true, message: "Refresh completed successfully" });
        } catch (e) {
            console.error("PollingUpdates: Erreur pendant forcePollingUpdate", e);
            return Promise.reject({ success: false, message: "Refresh error: " + e.message });
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
    
    // Stubs pour la compatibilité avec dashboard.js
    window.refreshRecentActivity = function() {
        if (config.debugMode) console.log('PollingUpdates: refreshRecentActivity called - handled by polling-updates.js');
        fetch('/api/activites')
            .then(response => response.json())
            .then(data => updateActivityFeed(data))
            .catch(err => console.error('Error refreshing activity feed:', err));
    };
    
    window.updateStatsCounters = function() {
        if (config.debugMode) console.log('PollingUpdates: updateStatsCounters called - handled by polling-updates.js');
        fetch('/api/dashboard_essential')
            .then(response => response.json())
            .then(data => {
                if (data.sessions) {
                    updateDashboardStatistics(data.sessions);
                }
            })
            .catch(err => console.error('Error updating stats counters:', err));
    };
    
    // Démarre le polling
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
    
    // Initialisation
    if (DASH_CONFIG.activeMode === 'polling' || DASH_CONFIG.preferredMode === 'polling' || DASH_CONFIG.preferredMode === 'auto') {
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
                if (config.debugMode) console.log("PollingUpdates: Onglet caché, mise en pause des mises à jour automatiques.");
            }
        });
    } else {
        if (config.debugMode) console.log("PollingUpdates: Polling non démarré (mode actif non 'polling' ou 'auto').");
    }
    
    if (config.debugMode) console.log('PollingUpdates: Setup complete (v3.1.0).');
});
