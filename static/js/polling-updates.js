/**
 * polling-updates.js - Alternative optimisée au WebSocket
 * Utilise le polling intelligent pour les mises à jour avec réduction des requêtes
 * v3.0.0 - Performances améliorées et réduction du nombre de requêtes
 */
document.addEventListener('DOMContentLoaded', function() {
    console.log('Optimized polling updates initialized v3.0.0'); // Version log

    // Configuration
    const config = {
        get pollingInterval() { return (window.dashboardConfig && window.dashboardConfig.autoRefreshInterval) || 30000; }, // 30 sec au lieu de 15
        get debugMode() { return (window.dashboardConfig && window.dashboardConfig.debugMode) || false; },
        retryDelay: 1500, // Délai plus long
        maxRetries: 2, // Moins de tentatives
        maxConsecutiveErrors: 5,
        staggerRequests: true, // Échelonnement des requêtes
        smartPolling: true, // Polling intelligent
        visibilityPause: true, // Pause quand onglet non visible
    };

    let consecutiveErrors = 0;
    let pollingEnabled = true;
    let pollingIntervalId = null;
    let lastData = {
        sessions: null,
        participants: null,
        salles: null,
        activites: null
    };
    let lastFetch = {
        sessions: 0,
        participants: 0, 
        salles: 0,
        activites: 0
    };

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
                startPolling();
            }, config.pollingInterval * 4);
            if (typeof showToast === 'function') showToast('Problème de connexion serveur. Tentative de reconnexion...', 'warning');
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
        
        // Ajouter un cache buster pour éviter les réponses en cache
        const separator = url.includes('?') ? '&' : '?';
        const urlWithCacheBuster = `${url}${separator}_=${Date.now()}`;
        
        while (retries < config.maxRetries) {
            try {
                if (config.debugMode) console.log(`Polling Fetch: ${url} (Attempt ${retries + 1}/${config.maxRetries})`);
                const response = await fetch(urlWithCacheBuster, options);
                if (response.ok) {
                    const contentType = response.headers.get("content-type");
                    if (contentType && contentType.indexOf("application/json") !== -1) {
                        return response.json();
                    } else {
                        console.warn(`Polling Fetch: Received non-JSON response from ${url}`);
                        return null;
                    }
                }
                console.error(`Polling Fetch: HTTP Error ${response.status} for ${url}`);
                if (response.status === 404) throw new Error(`HTTP Error 404: Not Found`);
                throw new Error(`HTTP Error ${response.status}`);
            } catch (error) {
                retries++;
                console.warn(`Polling Fetch error for ${url} (Attempt ${retries}/${config.maxRetries}):`, error.message);
                if (retries >= config.maxRetries) {
                    console.error(`Polling Fetch: Max retries reached for ${url}.`);
                    throw error;
                }
                await new Promise(resolve => setTimeout(resolve, delay));
                delay = delay * 1.5 + Math.random() * 200;
            }
        }
    }

    /**
     * Détermine si une ressource doit être actualisée en fonction
     * de son importance et du temps écoulé depuis la dernière requête
     */
    function shouldRefreshResource(resourceName) {
        const now = Date.now();
        const lastUpdate = lastFetch[resourceName] || 0;
        const timeSinceLastUpdate = now - lastUpdate;
        
        // Périodes de rafraîchissement selon le type de ressource
        const refreshPeriods = {
            sessions: config.pollingInterval, // Prioritaire
            activites: config.pollingInterval * 1.5, // Moins prioritaire
            participants: config.pollingInterval * 2, // Moins fréquent
            salles: config.pollingInterval * 3 // Rarement modifié
        };
        
        return timeSinceLastUpdate >= (refreshPeriods[resourceName] || config.pollingInterval);
    }

    /**
     * Compare deux ensembles de données pour détecter les changements
     * Évite les mises à jour inutiles si les données sont identiques
     */
    function hasDataChanged(oldData, newData) {
        if (!oldData || !newData) return true;
        
        // Vérification superficielle basée sur la taille et quelques propriétés clés
        if (oldData.length !== newData.length) return true;
        
        // Vérification plus poussée sur un échantillon des données
        const sampleSize = Math.min(3, oldData.length);
        for (let i = 0; i < sampleSize; i++) {
            const index = Math.floor(Math.random() * oldData.length);
            const oldItem = oldData[index];
            const newItem = newData[index];
            
            // Si un élément échantillonné est différent, considérer que les données ont changé
            if (JSON.stringify(oldItem) !== JSON.stringify(newItem)) {
                return true;
            }
        }
        
        return false;
    }

    async function refreshDashboardComponents() {
        if (!pollingEnabled || (config.visibilityPause && document.visibilityState !== 'visible')) { 
            if (config.debugMode) console.log('Polling: Skipped refresh (disabled or tab not visible)');
            return; 
        }
        
        if (config.debugMode) console.log('Polling: Starting dashboard refresh cycle...');
        
        try {
            // Déterminer quelles ressources doivent être actualisées
            const toRefresh = {
                sessions: shouldRefreshResource('sessions'),
                participants: shouldRefreshResource('participants'),
                salles: shouldRefreshResource('salles'),
                activites: shouldRefreshResource('activites')
            };
            
            if (config.debugMode) {
                console.log('Polling: Resources to refresh:', 
                    Object.entries(toRefresh)
                    .filter(([_, needsRefresh]) => needsRefresh)
                    .map(([name]) => name)
                    .join(', ') || 'None'
                );
            }
            
            // Récupérer uniquement les ressources nécessaires
            const requests = [];
            
            if (toRefresh.sessions) {
                requests.push(fetchWithRetry('/api/sessions')
                    .then(data => {
                        lastFetch.sessions = Date.now();
                        if (hasDataChanged(lastData.sessions, data)) {
                            lastData.sessions = data;
                            return { type: 'sessions', data };
                        }
                        return { type: 'sessions', data: null, unchanged: true };
                    })
                    .catch(error => ({ type: 'sessions', error }))
                );
                
                // Ajouter un délai pour échelonner les requêtes
                if (config.staggerRequests && requests.length > 0) {
                    await new Promise(resolve => setTimeout(resolve, 150));
                }
            }
            
            if (toRefresh.participants) {
                requests.push(fetchWithRetry('/api/participants')
                    .then(data => {
                        lastFetch.participants = Date.now();
                        if (hasDataChanged(lastData.participants, data)) {
                            lastData.participants = data;
                            return { type: 'participants', data };
                        }
                        return { type: 'participants', data: null, unchanged: true };
                    })
                    .catch(error => ({ type: 'participants', error }))
                );
                
                // Ajouter un délai pour échelonner les requêtes
                if (config.staggerRequests && requests.length > 0) {
                    await new Promise(resolve => setTimeout(resolve, 150));
                }
            }
            
            if (toRefresh.salles) {
                requests.push(fetchWithRetry('/api/salles')
                    .then(data => {
                        lastFetch.salles = Date.now();
                        if (hasDataChanged(lastData.salles, data)) {
                            lastData.salles = data;
                            return { type: 'salles', data };
                        }
                        return { type: 'salles', data: null, unchanged: true };
                    })
                    .catch(error => ({ type: 'salles', error }))
                );
                
                // Ajouter un délai pour échelonner les requêtes
                if (config.staggerRequests && requests.length > 0) {
                    await new Promise(resolve => setTimeout(resolve, 150));
                }
            }
            
            if (toRefresh.activites && document.getElementById('recent-activity')) {
                requests.push(fetchWithRetry('/api/activites')
                    .then(data => {
                        lastFetch.activites = Date.now();
                        if (hasDataChanged(lastData.activites, data)) {
                            lastData.activites = data;
                            return { type: 'activites', data };
                        }
                        return { type: 'activites', data: null, unchanged: true };
                    })
                    .catch(error => ({ type: 'activites', error }))
                );
            }
            
            // Traiter les réponses
            const results = await Promise.allSettled(requests);
            
            let updatedComponents = 0;
            let sessionsData = null;
            let participantsData = null;
            let sallesData = null;
            
            results.forEach(result => {
                if (result.status === 'fulfilled') {
                    const { type, data, error, unchanged } = result.value;
                    
                    if (error) {
                        console.error(`Polling: Error fetching ${type}:`, error);
                        handleError(error, `${type} fetch`);
                    } else if (unchanged) {
                        if (config.debugMode) console.log(`Polling: ${type} data unchanged, skipping update`);
                    } else if (data) {
                        if (config.debugMode) console.log(`Polling: ${type} data updated successfully`);
                        updatedComponents++;
                        
                        // Stocker les données pour la mise à jour ultérieure
                        if (type === 'sessions') sessionsData = data;
                        else if (type === 'participants') participantsData = data;
                        else if (type === 'salles') sallesData = data;
                        else if (type === 'activites') updateActivityFeed(data);
                    }
                } else {
                    console.error(`Polling: Promise rejected:`, result.reason);
                    handleError(result.reason, 'promise rejection');
                }
            });
            
            // Mise à jour des compteurs et tableaux si des données ont changé
            if (sessionsData || participantsData || sallesData) {
                updateStatsAndUI(sessionsData, participantsData, sallesData);
            }
            
            if (updatedComponents > 0) {
                handleSuccess();
                if (config.debugMode) console.log(`Polling: Updated ${updatedComponents} components`);
            } else {
                if (config.debugMode) console.log(`Polling: No components needed updating`);
            }
            
        } catch (error) {
            console.error('Polling: Error in refresh cycle:', error);
            handleError(error, 'refresh cycle');
        }
    }

    function updateStatsAndUI(sessionsData, participantsData, sallesData) {
        if (config.debugMode) console.log("Polling: Updating stats and UI...");
        
        try {
            // Mise à jour de la table de sessions
            if (sessionsData && typeof window.updateSessionTable === 'function') {
                window.updateSessionTable(sessionsData);
            } 
            
            // Mise à jour des graphiques statiques
            const staticChartsAvailable = window.staticChartsModule && 
                typeof window.staticChartsModule.updateThemeChart === 'function' && 
                typeof window.staticChartsModule.updateServiceChart === 'function';
                
            if (staticChartsAvailable) {
                if (sessionsData) window.staticChartsModule.updateThemeChart(sessionsData);
                if (participantsData) window.staticChartsModule.updateServiceChart(participantsData);
            }
            
            // Mise à jour des compteurs
            if (sessionsData) {
                updateCounter('sessions_programmees', sessionsData.length);
                updateCounter('total_sessions_completes', sessionsData.filter(s => s.places_restantes === 0).length);
                updateCounter('total_inscriptions', sessionsData.reduce((sum, s) => sum + (s.inscrits || 0), 0));
                updateCounter('total_en_attente', sessionsData.reduce((sum, s) => sum + (s.liste_attente || 0), 0));
            }
            
            if (participantsData) {
                updateCounter('counter-participants', participantsData.length);
            }
            
            if (sallesData) {
                updateCounter('counter-salles', sallesData.length);
            }
            
            // Animation des compteurs
            if (typeof window.animateAllDashboardCounters === 'function') {
                window.animateAllDashboardCounters();
            }
            
        } catch (error) {
            console.error("Polling: Error updating UI:", error);
            // Ne pas compter comme erreur critique - l'interface peut toujours fonctionner
        }
    }

    function updateActivityFeed(activitesData) {
        if (!activitesData) return;
        
        const activitesLists = document.querySelectorAll('#recent-activity, #recent-activity-admin');
        if (activitesLists.length === 0) return;
        
        try {
            activitesLists.forEach(list => {
                // Sauvegarder l'état de défilement actuel
                const scrollPos = list.scrollTop;
                
                list.innerHTML = '';
                const activities = activitesData.slice(0, 5);
                
                if (activities.length > 0) {
                    activities.forEach(activite => {
                        const icon = getIconForActivity(activite.type);
                        const titre = activite.type.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase());
                        const activityItem = document.createElement('div');
                        activityItem.className = 'list-group-item list-group-item-action px-0 py-2 border-0';
                        activityItem.innerHTML = `
                            <div class="d-flex w-100 justify-content-between">
                                <h6 class="mb-1 small fw-bold"><i class="${icon} me-2 fa-fw"></i>${titre}</h6>
                                <small class="text-muted text-nowrap">${activite.date_relative || ''}</small>
                            </div>
                            <p class="mb-1 small">${activite.description || ''}</p>
                            ${activite.details ? `<small class="text-muted">${activite.details}</small>` : ''}
                        `;
                        list.appendChild(activityItem);
                    });
                } else {
                    list.innerHTML = '<div class="list-group-item px-0 border-0 text-center text-muted fst-italic py-3">Aucune activité récente.</div>';
                }
                
                // Restaurer la position de défilement
                list.scrollTop = scrollPos;
            });
            
        } catch (error) {
            console.error('Polling: Error updating activity feed:', error);
            activitesLists.forEach(list => {
                list.innerHTML = `<div class="list-group-item px-0 border-0 text-center text-danger py-3"><i class="fas fa-exclamation-circle me-2"></i>Erreur chargement activités.</div>`;
            });
        }
    }

    // --- Fonctions Utilitaires (Compteurs, Icônes) ---
    function updateCounter(elementId, value) {
        const elements = document.querySelectorAll(`#${elementId}, .${elementId}, [id^="counter-${elementId}"]`);
        elements.forEach(element => {
            if (element) {
                const targetValue = parseInt(value, 10);
                if (!isNaN(targetValue)) { element.dataset.targetValue = targetValue; element.textContent = targetValue; }
                else { element.textContent = 'N/A'; delete element.dataset.targetValue; }
            }
        });
    }
    
    window.animateCounter = function(element, startValue, endValue) {
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
             const current = parseInt(element.dataset.currentValue || element.textContent.replace(/,/g, '') || '0', 10);
             if (!isNaN(target) && !isNaN(current)) {
                 if (current !== target) { window.animateCounter(element, current, target); element.dataset.currentValue = target; }
                 else { element.textContent = target; }
             }
         });
     }
     
    function getIconForActivity(type) {
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

    // --- Exposition Globale & Initialisation ---
    window.refreshRecentActivity = function() {
        if (config.debugMode) console.log("Polling: Manual refresh of recent activity requested");
        return fetchWithRetry('/api/activites')
            .then(data => {
                lastFetch.activites = Date.now();
                lastData.activites = data;
                updateActivityFeed(data);
                return { status: 'success' };
            })
            .catch(error => {
                console.error("Polling: Error refreshing activities:", error);
                handleError(error, 'Activity Manual Refresh');
                return { status: 'error', error };
            });
    };
    
    window.updateStatsCounters = function() {
        if (config.debugMode) console.log("Polling: Manual stats update requested");
        return Promise.all([
            fetchWithRetry('/api/sessions').catch(e => { console.error("Error fetching sessions:", e); return null; }),
            fetchWithRetry('/api/participants').catch(e => { console.error("Error fetching participants:", e); return null; }),
            fetchWithRetry('/api/salles').catch(e => { console.error("Error fetching salles:", e); return null; })
        ])
        .then(([sessions, participants, salles]) => {
            if (sessions) {
                lastFetch.sessions = Date.now();
                lastData.sessions = sessions;
            }
            if (participants) {
                lastFetch.participants = Date.now();
                lastData.participants = participants;
            }
            if (salles) {
                lastFetch.salles = Date.now();
                lastData.salles = salles;
            }
            
            updateStatsAndUI(sessions, participants, salles);
            return { status: 'success' };
        })
        .catch(error => {
            console.error("Polling: Error updating stats:", error);
            handleError(error, 'Stats Manual Update');
            return { status: 'error', error };
        });
    };

    function startPolling() {
        if (pollingIntervalId) { 
            if (config.debugMode) console.log("Polling: Already started."); 
            return; 
        }
        
        console.log(`Polling: Starting optimized polling with interval ${config.pollingInterval}ms.`);
        pollingEnabled = true; 
        consecutiveErrors = 0;
        
        // Premier rafraîchissement différé
        setTimeout(refreshDashboardComponents, 1000);
        
        // Configuration de l'intervalle régulier
        pollingIntervalId = setInterval(refreshDashboardComponents, config.pollingInterval);
    }

    // Démarrer automatiquement
    startPolling();

    // Réactiver les mises à jour quand l'onglet redevient visible
    document.addEventListener('visibilitychange', function() {
        if (document.visibilityState === 'visible' && pollingEnabled) {
            if (config.debugMode) console.log("Polling: Tab became visible, triggering immediate refresh.");
            // Attendre un court délai pour que la page soit complètement rechargée
            setTimeout(refreshDashboardComponents, 300);
        }
    });

    console.log('Optimized polling updates ready! v3.0.0'); // Version log
});