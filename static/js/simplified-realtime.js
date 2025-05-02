/**
 * Simplified real-time updates without Socket.IO
 * v1.0.0
 */

document.addEventListener('DOMContentLoaded', function() {
    console.log('Simplified real-time updates initialized');
    
    // Configuration
    const config = {
        updateInterval: 15000, // 15 secondes
        retryDelay: 500,       // 500ms
        maxRetries: 3          // 3 tentatives max
    };
    
    // Fetch avec retry
    async function fetchWithRetry(url, options = {}, maxRetries = config.maxRetries, initialDelay = config.retryDelay) {
        let retries = 0;
        let delay = initialDelay;
        
        while (retries < maxRetries) {
            try {
                const response = await fetch(url, options);
                if (response.ok) return response.json();
                throw new Error(`Erreur HTTP ${response.status}`);
            } catch (error) {
                retries++;
                if (retries >= maxRetries) throw error;
                
                console.log(`Erreur fetch, tentative ${retries}/${maxRetries} dans ${delay}ms...`);
                await new Promise(resolve => setTimeout(resolve, delay));
                
                // Délai exponentiel avec jitter
                delay = delay * 1.5 + Math.random() * 200;
            }
        }
    }
    
    // Mêmes fonctions que websocket.js mais sans Socket.IO
    function refreshData() {
        // Uniquement si la page est visible
        if (document.visibilityState === 'visible') {
            // Rafraîchir les différents composants
            if (typeof window.chartModule !== 'undefined' && window.chartModule.initialize) {
                window.chartModule.initialize();
            }
            
            refreshRecentActivity();
            updateStatsCounters();
        }
    }
    
    // Mettre à jour les statistiques
    function updateStatsCounters() {
        // Mêmes fonctions que dans websocket.js
        // ...
    }
    
    // Mettre à jour les activités récentes
    function refreshRecentActivity() {
        const activitesLists = document.querySelectorAll('#recent-activity, #recent-activity-admin');
        if (activitesLists.length === 0) return;
        
        fetchWithRetry('/api/activites')
            .then(data => {
                activitesLists.forEach(list => {
                    list.innerHTML = '';
                    const activities = data.slice(0, 5);
                    
                    if (activities.length > 0) {
                        activities.forEach(activite => {
                            // Afficher chaque activité
                            // ...
                        });
                    } else {
                        list.innerHTML = '<div class="list-group-item px-0 border-0 text-center text-muted fst-italic py-3">Aucune activité récente.</div>';
                    }
                });
            })
            .catch(error => {
                console.error('Erreur chargement activités:', error);
                activitesLists.forEach(list => {
                    list.innerHTML = '<div class="list-group-item px-0 border-0 text-center text-danger py-3">Erreur chargement.</div>';
                });
            });
    }
    
    // Lancer les mises à jour périodiques
    setInterval(refreshData, config.updateInterval);
    
    // Première mise à jour
    setTimeout(refreshData, 1000);
    
    // Mise à jour lors du retour sur l'onglet
    document.addEventListener('visibilitychange', function() {
        if (document.visibilityState === 'visible') {
            refreshData();
        }
    });
});