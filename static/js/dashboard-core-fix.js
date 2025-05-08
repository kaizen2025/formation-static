/**
 * dashboard-core-fix.js - Correctif pour les problèmes de chargement continu
 * Doit être inclus après dashboard-core.js
 */
(function() {
    console.log("Dashboard Core Fix: Initializing spinner fix and polling protection");
    
    // Variables pour détecter les boucles infinies
    let fetchCount = 0;
    let fetchStartTime = Date.now();
    let isFixActive = false;
    
    // Force l'arrêt du spinner après 5 secondes
    setTimeout(function() {
        const overlay = document.getElementById('loading-overlay');
        if (overlay && overlay.style.display !== 'none') {
            console.log('Dashboard Core Fix: Forcing loading overlay to hide (timeout)');
            overlay.style.display = 'none';
        }
        
        // Arrêter tous les autres spinners
        document.querySelectorAll('.spinner-border').forEach(spinner => {
            // Garder la référence à l'élément parent pour conserver la structure
            const parent = spinner.parentElement;
            const newElement = document.createElement('div');
            newElement.innerHTML = '<i class="fas fa-exclamation-circle text-warning"></i> Chargement interrompu';
            
            // Ne pas remplacer le spinner dans le global loading overlay
            if (!parent.closest('#loading-overlay')) {
                parent.replaceChild(newElement, spinner);
            }
        });
    }, 5000);
    
    // Intercepte et protège le polling
    if (window.dashboardState) {
        console.log("Dashboard Core Fix: Patching polling mechanism");
        
        // Sauvegarde des fonctions originales
        const originalDebouncedFetch = window.debouncedFetchDashboardData;
        const original_FetchDashboardData = window._fetchDashboardData;
        
        // Remplacement de la fonction pour détecter les appels trop fréquents
        window._fetchDashboardData = function(forceRefresh = false, lightMode = false) {
            fetchCount++;
            const now = Date.now();
            const timeSinceStart = now - fetchStartTime;
            
            // Si trop d'appels dans une courte période, réinitialiser
            if (fetchCount > 3 && timeSinceStart < 5000) {
                console.warn(`Dashboard Core Fix: Detected too many fetch attempts (${fetchCount}) in ${timeSinceStart}ms. Blocking additional requests.`);
                
                if (!isFixActive) {
                    isFixActive = true;
                    
                    // Réinitialiser l'état
                    window.dashboardState.updating = false;
                    window.dashboardState.fetchTimeoutId = null;
                    
                    // Forcer l'arrêt du overlay
                    const overlay = document.getElementById('loading-overlay');
                    if (overlay) overlay.style.display = 'none';
                    
                    // Réinitialiser après une période de calme
                    setTimeout(() => {
                        console.log("Dashboard Core Fix: Resetting fetch protection");
                        fetchCount = 0;
                        fetchStartTime = Date.now();
                        isFixActive = false;
                    }, 30000);
                    
                    // Afficher un message à l'utilisateur
                    if (window.showToast) {
                        window.showToast("Erreur de chargement des données. La page a été stabilisée.", "warning");
                    }
                }
                
                return Promise.resolve(false);
            }
            
            // Si la période est normale, réinitialiser le compteur périodiquement
            if (timeSinceStart > 30000) {
                fetchCount = 0;
                fetchStartTime = now;
            }
            
            // Appel à la fonction originale avec un try/catch pour éviter les erreurs non gérées
            try {
                return original_FetchDashboardData(forceRefresh, lightMode);
            } catch (error) {
                console.error("Dashboard Core Fix: Caught error in _fetchDashboardData:", error);
                window.dashboardState.updating = false; // S'assurer que l'état est réinitialisé
                return Promise.resolve(false);
            }
        };
    }
    
    // Correction des erreurs de Chart.js
    if (window.Chart) {
        console.log("Dashboard Core Fix: Adding Chart.js error handling");
        
        // Sauvegarde de la fonction originale
        if (window.updateThemeChart) {
            const originalUpdateThemeChart = window.updateThemeChart;
            
            window.updateThemeChart = function(sessions) {
                try {
                    return originalUpdateThemeChart(sessions);
                } catch (error) {
                    console.error("Dashboard Core Fix: Error in theme chart rendering:", error);
                    
                    // Basculer vers les graphiques statiques en cas d'erreur
                    document.querySelectorAll('#themeChartCanvas, #serviceChartCanvas').forEach(el => {
                        if (el) el.style.display = 'none';
                    });
                    document.querySelectorAll('.static-chart-donut, .static-chart-bars').forEach(el => {
                        if (el) el.style.display = 'block';
                    });
                    
                    // Retourner faux pour indiquer l'échec
                    return false;
                }
            };
        }
    }
    
    // Vérifie et corrige les problèmes d'interface périodiquement
    const checkAndFixUI = function() {
        try {
            // Vérifier si des tableaux sont vides et les corriger
            document.querySelectorAll('table tbody').forEach(tbody => {
                if (!tbody.querySelector('tr') || tbody.querySelector('tr').cells.length === 0) {
                    const cols = tbody.closest('table').querySelectorAll('thead th').length || 3;
                    const emptyMessage = '<tr><td colspan="' + cols + '" class="text-center p-3 text-muted">' +
                        '<i class="fas fa-info-circle me-2"></i>Aucune donnée disponible' +
                        '<button class="btn btn-sm btn-outline-secondary ms-3" onclick="if(typeof window.forcePollingUpdate === \'function\') window.forcePollingUpdate(true);">' +
                        '<i class="fas fa-sync me-1"></i>Actualiser</button></td></tr>';
                    tbody.innerHTML = emptyMessage;
                }
            });
            
            // Vérifier les éléments de comptage
            document.querySelectorAll('.counter-value, .badge-count').forEach(counter => {
                const text = counter.textContent.trim();
                if (text === '' || text === 'undefined' || text === 'null' || text === 'NaN') {
                    counter.textContent = '—';
                    counter.classList.add('text-muted');
                    counter.title = 'Valeur temporairement indisponible';
                }
            });
            
            // Vérifier les places restantes
            document.querySelectorAll('.places-dispo').forEach(el => {
                const text = el.textContent.trim();
                if (text === 'NaN / NaN' || text.includes('undefined') || text === '/ ' || text === ' / ' || text.includes('null')) {
                    el.classList.remove('text-success', 'text-warning', 'text-danger');
                    el.classList.add('text-secondary');
                    el.innerHTML = '<i class="fas fa-question-circle me-1"></i> ? / ?';
                    el.title = 'Données temporairement indisponibles';
                }
            });
        } catch (error) {
            console.error("Dashboard Core Fix: Error in UI fix:", error);
        }
    };
    
    // Exécuter après un court délai et périodiquement
    setTimeout(checkAndFixUI, 2000);
    setInterval(checkAndFixUI, 30000);
    
    console.log("Dashboard Core Fix: Setup complete");
})();
