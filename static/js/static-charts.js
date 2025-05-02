/**
 * static-charts.js - Graphiques statiques optimisés
 * Version améliorée avec calcul correct des angles, gestion d'état, et animations
 */
document.addEventListener('DOMContentLoaded', function() {
    console.log("Static charts loader initialized");
    
    // Désactiver les anciens graphiques
    if (window.chartModule && window.chartModule.cleanup) {
        window.chartModule.cleanup();
    }
    
    // Variables globales pour stocker les données
    let cachedThemeData = null;
    let cachedParticipantData = null;
    let initialRenderComplete = false;
    
    // Exposer les fonctions pour le polling
    window.staticChartsModule = {
        initialize: initStaticCharts,
        updateThemeChart: function(data) {
            if (data && data.length) {
                cachedThemeData = data;
                renderThemeChart(data);
            }
        },
        updateServiceChart: function(data) {
            if (data && data.length) {
                cachedParticipantData = data;
                renderServiceChart(data);
            }
        }
    };
    
    // Charger les données des graphiques
    initStaticCharts();
    
    /**
     * Initialise tous les graphiques statiques
     */
    async function initStaticCharts() {
        try {
            // Afficher les chargements pour chaque graphique
            document.querySelectorAll('.chart-container').forEach(container => {
                const hasOverlay = container.querySelector('.chart-overlay');
                if (hasOverlay) {
                    hasOverlay.classList.remove('hidden');
                    hasOverlay.style.display = 'flex';
                } else {
                    const overlay = document.createElement('div');
                    overlay.className = 'chart-overlay';
                    overlay.innerHTML = '<div class="spinner-border spinner-border-sm text-primary me-2" role="status"></div> Chargement...';
                    container.appendChild(overlay);
                }
            });
            
            // 1. Graphique par thème (avec gestion d'erreur par graphique)
            try {
                const themeData = await fetch('/api/sessions')
                    .then(res => {
                        if (!res.ok) throw new Error(`HTTP error ${res.status}`);
                        return res.json();
                    })
                    .catch(err => {
                        console.error("Error fetching theme data:", err);
                        markChartError('themeChart');
                        return null;
                    });
                
                if (themeData && themeData.length) {
                    cachedThemeData = themeData;
                    renderThemeChart(themeData);
                }
            } catch (themeErr) {
                console.error("Error in theme chart processing:", themeErr);
                markChartError('themeChart');
            }
            
            // 2. Graphique par service (avec gestion d'erreur par graphique)
            try {
                const participantData = await fetch('/api/participants')
                    .then(res => {
                        if (!res.ok) throw new Error(`HTTP error ${res.status}`);
                        return res.json();
                    })
                    .catch(err => {
                        console.error("Error fetching participant data:", err);
                        markChartError('serviceChart');
                        return null;
                    });
                
                if (participantData && participantData.length) {
                    cachedParticipantData = participantData;
                    renderServiceChart(participantData);
                }
            } catch (serviceErr) {
                console.error("Error in service chart processing:", serviceErr);
                markChartError('serviceChart');
            }
            
            // Masquer les chargements
            document.querySelectorAll('.chart-overlay').forEach(overlay => {
                overlay.style.display = 'none';
                overlay.classList.add('hidden');
            });
            
            // Marquer l'initialisation comme complète
            initialRenderComplete = true;
            
            return { success: true };
        } catch (err) {
            console.error("Error rendering static charts:", err);
            
            // En cas d'erreur générale, afficher un message d'erreur global
            document.querySelectorAll('.chart-container').forEach(container => {
                container.innerHTML = `
                    <div class="alert alert-warning text-center">
                        <i class="fas fa-exclamation-triangle me-2"></i>
                        Graphique indisponible actuellement
                    </div>
                `;
            });
            
            return { success: false, error: err.message };
        }
    }
    
    /**
     * Marque un graphique spécifique comme étant en erreur
     */
    function markChartError(chartId) {
        const container = document.getElementById(chartId)?.parentElement;
        if (!container) return;
        
        container.querySelector('.chart-overlay')?.remove();
        container.innerHTML = `
            <div class="alert alert-warning text-center">
                <i class="fas fa-exclamation-triangle me-2"></i>
                Graphique indisponible actuellement
            </div>
        `;
    }
    
    /**
     * Rendu du graphique circulaire par thème
     */
    function renderThemeChart(sessions) {
        const container = document.getElementById('themeChart')?.parentElement;
        if (!container) return;
        
        // Calculer les données pour le graphique
        const themeCounts = {};
        const themeColors = {
            'Communiquer avec Teams': 'var(--theme-teams)',
            'Gérer les tâches (Planner)': 'var(--theme-planner)',
            'Gérer mes fichiers (OneDrive/SharePoint)': 'var(--theme-onedrive)',
            'Collaborer avec Teams': 'var(--theme-sharepoint)'
        };
        
        sessions.forEach(session => {
            if (!session.theme) return;
            if (!themeCounts[session.theme]) {
                themeCounts[session.theme] = {
                    count: 0,
                    color: themeColors[session.theme] || '#6c757d'
                };
            }
            themeCounts[session.theme].count += session.inscrits || 0;
        });
        
        // Calculer le total et les angles pour chaque segment
        const total = Object.values(themeCounts).reduce((sum, t) => sum + t.count, 0);
        let startAngle = 0;
        
        // Remplacer le canvas par notre graphique simplifié avec angles calculés correctement
        container.innerHTML = `
            <div class="static-chart-container ${!initialRenderComplete ? 'animate' : ''}">
                <h5 class="static-chart-title">Répartition par thème</h5>
                <div class="static-chart-donut">
                    ${Object.entries(themeCounts).map(([theme, data], index) => {
                        const percentage = total > 0 ? (data.count / total) * 360 : 0;
                        const angle = startAngle;
                        startAngle += percentage;
                        return `
                            <div class="donut-segment" style="
                                --fill: ${data.color};
                                --rotation: ${angle};
                                --index: ${index};
                            "></div>
                        `;
                    }).join('')}
                    <div class="donut-center">
                        <div class="donut-total">${total}</div>
                        <div class="donut-label">Total</div>
                    </div>
                </div>
                <div class="static-chart-legend mt-3">
                    ${Object.entries(themeCounts).map(([theme, data]) => `
                        <div class="legend-item" title="${theme}: ${data.count} participants">
                            <span class="legend-color" style="background-color: ${data.color}"></span>
                            <span class="legend-label">${theme.length > 20 ? theme.substring(0, 20) + '...' : theme}</span>
                            <span class="legend-value badge bg-secondary ms-1">${data.count}</span>
                        </div>
                    `).join('')}
                </div>
            </div>
        `;
    }
    
    /**
     * Rendu du graphique en barres par service
     */
    function renderServiceChart(participants) {
        const container = document.getElementById('serviceChart')?.parentElement;
        if (!container) return;
        
        // Calculer les données pour le graphique
        const serviceCounts = {};
        const serviceColors = {
            'Commerce Anecoop-Solagora': 'var(--service-commerce)',
            'Comptabilité': 'var(--service-comptabilite)',
            'Florensud': 'var(--service-florensud)',
            'Informatique': 'var(--service-informatique)',
            'Marketing': 'var(--service-marketing)',
            'Qualité': 'var(--service-qualite)',
            'RH': 'var(--service-rh)'
        };
        
        participants.forEach(participant => {
            if (!participant.service) return;
            if (!serviceCounts[participant.service]) {
                serviceCounts[participant.service] = {
                    count: 0,
                    color: serviceColors[participant.service] || '#6c757d'
                };
            }
            serviceCounts[participant.service].count++;
        });
        
        // Trier par nombre de participants
        const sortedServices = Object.entries(serviceCounts)
            .sort((a, b) => b[1].count - a[1].count);
        
        // Calculer le maximum pour l'échelle
        const maxCount = Math.max(...Object.values(serviceCounts).map(s => s.count), 1);
        
        // Remplacer le canvas par notre graphique simplifié
        container.innerHTML = `
            <div class="static-chart-container ${!initialRenderComplete ? 'animate' : ''}">
                <h5 class="static-chart-title">Participants par service</h5>
                <div class="static-chart-bars">
                    ${sortedServices.map(([service, data], index) => {
                        const percent = Math.round(data.count / maxCount * 100);
                        return `
                            <div class="bar-item">
                                <div class="bar-header">
                                    <div class="bar-label" title="${service}">${service}</div>
                                    <div class="bar-total">${data.count}</div>
                                </div>
                                <div class="bar-container">
                                    <div class="bar-value ${service.toLowerCase().replace(/[^a-z0-9]/g, '')}" style="
                                        width: ${percent}%;
                                        --percent: ${percent}%;
                                        --index: ${index};
                                    "></div>
                                    <span class="bar-count">${data.count}</span>
                                </div>
                            </div>
                        `;
                    }).join('')}
                </div>
            </div>
        `;
    }
});
/**
 * Fonction pour restaurer et améliorer les badges de thèmes
 * À ajouter à la fin de votre static-charts.js ou dans un bloc script
 */
document.addEventListener('DOMContentLoaded', function() {
    
    // Données des descriptions des thèmes pour les tooltips
    const themesDescriptions = {
        'Communiquer avec Teams': 'Maîtrisez la communication en ligne avec Microsoft Teams. Apprenez à créer des conversations, organiser des réunions virtuelles et partager des fichiers efficacement.',
        'Gérer les tâches (Planner)': 'Organisez et suivez vos tâches d\'équipe avec Microsoft Planner. Créez des plans, assignez des tâches et visualisez la progression de vos projets.',
        'Gérer mes fichiers (OneDrive/SharePoint)': 'Stockez, partagez et collaborez sur vos documents avec OneDrive et SharePoint. Apprenez à synchroniser vos fichiers et à gérer les autorisations d\'accès.',
        'Collaborer avec Teams': 'Travaillez en équipe efficacement grâce aux fonctionnalités collaboratives de Teams. Créez des canaux, partagez des documents et intégrez d\'autres applications Office 365.'
    };
    
    // Icônes associées à chaque thème
    const themesIcons = {
        'Communiquer avec Teams': 'fas fa-comments',
        'Gérer les tâches (Planner)': 'fas fa-tasks',
        'Gérer mes fichiers (OneDrive/SharePoint)': 'fas fa-file-alt',
        'Collaborer avec Teams': 'fas fa-users'
    };
    
    // Classes CSS associées à chaque thème
    const themesClasses = {
        'Communiquer avec Teams': 'theme-comm',
        'Gérer les tâches (Planner)': 'theme-planner',
        'Gérer mes fichiers (OneDrive/SharePoint)': 'theme-onedrive',
        'Collaborer avec Teams': 'theme-sharepoint'
    };
    
    // Fonction pour créer un badge de thème avec tooltip
    function createThemeBadge(themeName) {
        // Si le thème n'est pas reconnu, utiliser des valeurs par défaut
        const description = themesDescriptions[themeName] || 'Formation Microsoft 365';
        const iconClass = themesIcons[themeName] || 'fas fa-info-circle';
        const themeClass = themesClasses[themeName] || 'bg-secondary';
        
        return `<span class="theme-badge ${themeClass}" data-theme="${themeName}">
            <i class="${iconClass} me-1"></i>${themeName}
            <span class="theme-tooltip">
                <strong>${themeName}</strong><br>
                ${description}
            </span>
        </span>`;
    }
    
    // Fonction pour restaurer les badges de thèmes dans les tableaux
    function restoreThemeBadges() {
        
        // Restaurer les badges dans les tableaux
        document.querySelectorAll('table td:nth-child(2), .theme-cell, td:has(.theme-badge), td:contains("Communiquer avec Teams"), td:contains("Gérer les tâches (Planner)"), td:contains("Gérer mes fichiers (OneDrive/SharePoint)"), td:contains("Collaborer avec Teams")').forEach(cell => {
            const content = cell.textContent.trim();
            
            // Si la cellule contient un thème connu et pas déjà un badge
            if (themesDescriptions[content] && !cell.querySelector('.theme-badge')) {
                cell.innerHTML = createThemeBadge(content);
            }
        });
        
        // Vérifier si les badges existants ont des tooltips
        document.querySelectorAll('.theme-badge').forEach(badge => {
            const themeName = badge.textContent.trim().replace(/\s+/g, ' ');
            
            // Si le badge n'a pas de tooltip mais que le thème est connu
            if (!badge.querySelector('.theme-tooltip') && themesDescriptions[themeName]) {
                // Préserver l'icône si elle existe
                const iconHtml = badge.querySelector('i') ? badge.querySelector('i').outerHTML : `<i class="${themesIcons[themeName] || 'fas fa-info-circle'} me-1"></i>`;
                
                badge.innerHTML = `${iconHtml}${themeName}<span class="theme-tooltip"><strong>${themeName}</strong><br>${themesDescriptions[themeName]}</span>`;
            }
            
            // Ajouter la classe de thème si manquante
            if (themesClasses[themeName] && !badge.classList.contains(themesClasses[themeName])) {
                Object.values(themesClasses).forEach(cls => badge.classList.remove(cls));
                badge.classList.add(themesClasses[themeName]);
            }
            
            // Ajouter l'attribut data-theme si manquant
            if (!badge.hasAttribute('data-theme')) {
                badge.setAttribute('data-theme', themeName);
            }
        });
    }
    
    // Appliquer les amélioration immédiatement
    restoreThemeBadges();
    
    // Appliquer de nouveau après tout chargement AJAX
    const originalFetch = window.fetch;
    window.fetch = function() {
        return originalFetch.apply(this, arguments)
            .then(response => {
                // Petit délai pour laisser le DOM se mettre à jour
                setTimeout(restoreThemeBadges, 100);
                return response;
            });
    };
    
    // Réappliquer lors des modifications du DOM
    const observer = new MutationObserver(function(mutations) {
        let needsUpdate = false;
        
        mutations.forEach(function(mutation) {
            if (mutation.addedNodes.length > 0) {
                for (let i = 0; i < mutation.addedNodes.length; i++) {
                    const node = mutation.addedNodes[i];
                    if (node.nodeType === 1) { // Element Node
                        if (node.tagName === 'TABLE' || 
                            node.tagName === 'TR' || 
                            node.tagName === 'TD' ||
                            node.querySelector('table, tr, td, .theme-badge')) {
                            needsUpdate = true;
                            break;
                        }
                    }
                }
            }
        });
        
        if (needsUpdate) {
            setTimeout(restoreThemeBadges, 50);
        }
    });
    
    // Observer les changements dans la page
    observer.observe(document.body, {
        childList: true,
        subtree: true
    });
    
    // Exposer la fonction globalement pour un usage manuel si nécessaire
    window.restoreThemeBadges = restoreThemeBadges;
});