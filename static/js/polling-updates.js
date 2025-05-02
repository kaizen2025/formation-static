/**
 * polling-updates.js - Alternative robuste à WebSocket
 * Utilise le polling simple pour les mises à jour
 * v1.0.0
 */
// Ajoutez ce code au début de polling-updates.js
document.addEventListener('DOMContentLoaded', function() {
    console.log('Polling updates initialized');
    
    // Configuration
    const config = {
        pollingInterval: 15000,   // 15 secondes entre les mises à jour
        retryDelay: 1000,         // Délai entre les tentatives en cas d'erreur
        maxRetries: 3,            // Nombre maximum de tentatives
        maxConsecutiveErrors: 5,  // Protection contre les erreurs en boucle
        debugMode: false          // Activer pour voir les logs détaillés
    };
    
    // Compteur pour suivre les erreurs consécutives
    let consecutiveErrors = 0;
    let pollingEnabled = true;    // Flag pour activer/désactiver le polling
    
    // Protection contre les boucles d'erreurs
    function handleError(error, component) {
        console.error(`Error in ${component}:`, error);
        consecutiveErrors++;
        
        if (consecutiveErrors >= config.maxConsecutiveErrors) {
            console.error(`Trop d'erreurs consécutives (${consecutiveErrors}). Polling désactivé temporairement.`);
            pollingEnabled = false;
            
            // Réactiver après un délai plus long
            setTimeout(() => {
                console.log('Tentative de réactivation du polling...');
                consecutiveErrors = 0;
                pollingEnabled = true;
            }, config.pollingInterval * 3);
            
            // Afficher une notification à l'utilisateur
            if (typeof showToast === 'function') {
                showToast('Problème de connexion détecté. Rafraîchissez la page si besoin.', 'warning');
            }
        }
    }
    
    // Réinitialiser le compteur d'erreurs en cas de succès
    function handleSuccess() {
        if (consecutiveErrors > 0) {
            consecutiveErrors = 0;
        }
    }
    
    // Dans la fonction refreshDashboard, ajoutez cette vérification
    async function refreshDashboard() {
        // Ne pas continuer si le polling est désactivé
        if (!pollingEnabled) return;
        
        // Seulement mettre à jour si la page est visible
        if (document.visibilityState !== 'visible') return;
        
        try {
            // Mise à jour des données...
            
            // En cas de succès
            handleSuccess();
        } catch (error) {
            handleError(error, 'dashboard refresh');
        }
    }
    

document.addEventListener('DOMContentLoaded', function() {
    console.log('Polling updates initialized');
    
    // Configuration
    const config = {
        pollingInterval: 15000,  // 15 secondes entre les mises à jour
        retryDelay: 1000,        // Délai entre les tentatives en cas d'erreur
        maxRetries: 3,           // Nombre maximum de tentatives
        debugMode: false         // Activer pour voir les logs détaillés
    };
    
    // Fonction fetch avec retry
    async function fetchWithRetry(url, options = {}) {
        let retries = 0;
        let delay = config.retryDelay;
        
        while (retries < config.maxRetries) {
            try {
                const response = await fetch(url, options);
                if (response.ok) return response.json();
                throw new Error(`HTTP Error ${response.status}`);
            } catch (error) {
                retries++;
                if (retries >= config.maxRetries) throw error;
                
                console.log(`Fetch error, retry ${retries}/${config.maxRetries} in ${delay}ms...`);
                await new Promise(resolve => setTimeout(resolve, delay));
                delay *= 1.5;  // Délai exponentiel
            }
        }
    }
    
    // Fonctions de mise à jour
    async function refreshDashboard() {
        // Seulement mettre à jour si la page est visible
        if (document.visibilityState !== 'visible') return;
        
        if (config.debugMode) console.log('Refreshing dashboard data...');
        
        try {
            // 1. Mise à jour des graphiques si le module existe
            if (typeof window.chartModule !== 'undefined' && window.chartModule.initialize) {
                window.chartModule.initialize();
            }
            
            // 2. Mise à jour des activités récentes
            refreshRecentActivity();
            
            // 3. Mise à jour des compteurs
            updateStatsCounters();
            
        } catch (error) {
            console.error('Error refreshing dashboard:', error);
        }
    }
    
    // Activités récentes
    async function refreshRecentActivity() {
        const activitesLists = document.querySelectorAll('#recent-activity, #recent-activity-admin');
        if (activitesLists.length === 0) return;
        
        try {
            const data = await fetchWithRetry('/api/activites');
            
            activitesLists.forEach(list => {
                list.innerHTML = '';
                const activities = data.slice(0, 5);
                
                if (activities.length > 0) {
                    activities.forEach(activite => {
                        const icon = getIconForActivity(activite.type);
                        const titre = activite.type.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase());
                        const activityItem = document.createElement('div');
                        activityItem.className = 'list-group-item list-group-item-action px-0 py-2 border-0';
                        activityItem.innerHTML = `
                            <div class="d-flex w-100 justify-content-between">
                                <h6 class="mb-1 small fw-bold"><i class="${icon} me-2 fa-fw"></i>${titre}</h6>
                                <small class="text-muted text-nowrap">${activite.date_relative}</small>
                            </div>
                            <p class="mb-1 small">${activite.description}</p>
                            ${activite.details ? `<small class="text-muted">${activite.details}</small>` : ''}
                        `;
                        list.appendChild(activityItem);
                    });
                } else {
                    list.innerHTML = '<div class="list-group-item px-0 border-0 text-center text-muted fst-italic py-3">Aucune activité récente.</div>';
                }
            });
        } catch (error) {
            console.error('Error refreshing activities:', error);
            activitesLists.forEach(list => {
                list.innerHTML = `
                    <div class="list-group-item px-0 border-0 text-center text-danger py-3">
                        <i class="fas fa-exclamation-circle me-2"></i>Erreur chargement.
                        <div class="mt-2">
                            <button class="btn btn-sm btn-outline-primary" onclick="refreshRecentActivity()">
                                <i class="fas fa-sync-alt me-1"></i>Réessayer
                            </button>
                        </div>
                    </div>`;
            });
        }
    }
    
    // Mise à jour des compteurs statistiques
    async function updateStatsCounters() {
        try {
            const [sessionsData, participantsData, sallesData] = await Promise.all([
                fetchWithRetry('/api/sessions'),
                fetchWithRetry('/api/participants'),
                fetchWithRetry('/api/salles')
            ]);
            
            // Mettre à jour tous les compteurs importants
            updateCounter('sessions_programmees', sessionsData.length);
            updateCounter('total_sessions_completes', sessionsData.filter(s => s.places_restantes === 0).length);
            updateCounter('total_inscriptions', sessionsData.reduce((sum, s) => sum + s.inscrits, 0));
            updateCounter('total_en_attente', sessionsData.reduce((sum, s) => sum + (s.liste_attente || 0), 0));
            updateCounter('counter-participants', participantsData.length);
            updateCounter('counter-salles', sallesData.length);
            
        } catch (error) {
            console.error('Error updating counters:', error);
        }
    }
    
    // Fonction auxiliaire pour animer les compteurs
    function updateCounter(elementId, value) {
        const elements = document.querySelectorAll(`#${elementId}, .${elementId}, [id^="counter-${elementId}"]`);
        elements.forEach(element => {
            if (element) {
                const currentValue = parseInt(element.textContent.replace(/,/g, ''), 10) || 0;
                const targetValue = parseInt(value, 10);
                if (!isNaN(targetValue)) {
                    animateCounter(element, currentValue, targetValue);
                }
            }
        });
    }
    
    function animateCounter(element, startValue, endValue) {
        if (startValue === endValue) {
            element.textContent = endValue;
            return;
        }
        
        const duration = 700;
        const steps = 15;
        const increment = (endValue - startValue) / steps;
        let current = startValue;
        let stepCount = 0;
        const interval = duration / steps;
        
        const timer = setInterval(() => {
            current += increment;
            stepCount++;
            if (stepCount >= steps || (increment > 0 && current >= endValue) || (increment < 0 && current <= endValue)) {
                clearInterval(timer);
                element.textContent = endValue;
            } else {
                element.textContent = Math.round(current);
            }
        }, interval);
    }
    
    // Fonction pour déterminer l'icône de l'activité
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
    
    // Exposer les fonctions au niveau global pour permettre les appels depuis d'autres scripts
    window.refreshRecentActivity = refreshRecentActivity;
    window.updateStatsCounters = updateStatsCounters;
    window.animateCounter = animateCounter;
    
    // Lancer les mises à jour périodiques
    setInterval(refreshDashboard, config.pollingInterval);
    
    // Première mise à jour après un délai
    setTimeout(refreshDashboard, 1000);
    
    // Actualisation lors du retour sur l'onglet
    document.addEventListener('visibilitychange', function() {
        if (document.visibilityState === 'visible') {
            refreshDashboard();
        }
    });
    
    console.log('Polling updates ready!');
});