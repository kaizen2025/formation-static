/**
 * charts-enhanced.js - Graphiques améliorés pour le tableau de bord
 * Version: 2.3.0 - Solution robuste pour les problèmes de chargement des graphiques
 */

console.log("--- charts-enhanced.js EXECUTING ---");

document.addEventListener('DOMContentLoaded', function() {
    const DASH_CONFIG = window.dashboardConfig || { 
        debugMode: true, 
        autoRefreshInterval: 30000,
        pollingEnabled: true,
        socketEnabled: false,
        preferredMode: 'polling',
        baseApiUrl: '/api'
    };
    
    if (DASH_CONFIG.debugMode) console.log('Enhanced Charts (v2.3.0): Initializing...');
    
    // État des graphiques
    let chartsInitialized = false;
    let chartCreationAttempts = {
        theme: 0,
        service: 0
    };
    
    // Vérifier si Chart.js est chargé correctement
    const isChartJsAvailable = typeof Chart !== 'undefined';
    if (!isChartJsAvailable) {
        console.warn('Enhanced Charts: Chart.js library is not loaded. Falling back to static charts.');
        // Basculer vers le rendu statique des graphiques
        useStaticCharts();
    }

    let themeChartInstance = null;
    let serviceChartInstance = null;
    
    // Données globales pour les thèmes/services avec couleurs
    window.themesDataForChart = window.themesDataForChart || {
        'Communiquer avec Teams': { color: 'var(--theme-teams, #0078d4)', description: 'Communication via Teams' },
        'Gérer les tâches (Planner)': { color: 'var(--theme-planner, #7719aa)', description: 'Gestion des tâches avec Planner' },
        'Gérer mes fichiers (OneDrive/SharePoint)': { color: 'var(--theme-onedrive, #0364b8)', description: 'Gestion de fichiers OneDrive/SharePoint' },
        'Collaborer avec Teams': { color: 'var(--theme-sharepoint, #038387)', description: 'Collaboration documentaire via Teams' },
    };
    
    window.servicesDataForChart = window.servicesDataForChart || {
        'Commerce Anecoop-Solagora': { color: 'var(--service-commerce, #FFC107)' },
        'Comptabilité': { color: 'var(--service-comptabilite, #2196F3)' },
        'Florensud': { color: 'var(--service-florensud, #4CAF50)' },
        'Informatique': { color: 'var(--service-informatique, #607D8B)' },
        'Marketing': { color: 'var(--service-marketing, #9C27B0)' },
        'Qualité': { color: 'var(--service-qualite, #F44336)' },
        'RH': { color: 'var(--service-rh, #FF9800)' },
    };
    
    // Récupère la couleur résolue depuis une variable CSS
    function getResolvedColor(colorNameOrVar, defaultColor = '#a0aec0') {
        if (typeof colorNameOrVar === 'string' && colorNameOrVar.startsWith('var(')) {
            const varNameMatch = colorNameOrVar.match(/--([a-zA-Z0-9-]+)/);
            if (varNameMatch && varNameMatch[0]) {
                const resolved = getComputedStyle(document.documentElement).getPropertyValue(varNameMatch[0].trim());
                return resolved ? resolved.trim() : defaultColor;
            }
        }
        return colorNameOrVar || defaultColor;
    }
    
    // Fonction utilitaire pour récupérer les données de session valides
    function validateAndProcessSessions(sessionsArray) {
        if (!sessionsArray || !Array.isArray(sessionsArray)) {
            console.warn('Enhanced Charts: Sessions data is invalid or missing');
            return [];
        }

        // Filtrer les sessions avec données invalides et calculer places_restantes si nécessaire
        return sessionsArray.filter(session => {
            return session && 
                   typeof session === 'object' && 
                   (typeof session.theme === 'string' || 
                    (typeof session.theme === 'object' && session.theme && typeof session.theme.nom === 'string'));
        }).map(session => {
            // Clone pour éviter de modifier l'original
            const processedSession = {...session};
            
            // Correction du thème si nécessaire
            if (typeof processedSession.theme === 'object' && processedSession.theme) {
                processedSession.theme = processedSession.theme.nom;
            }
            
            // Assurer que inscrits est un nombre
            if (typeof processedSession.inscrits !== 'number' || isNaN(processedSession.inscrits)) {
                processedSession.inscrits = 0;
            }
            
            // Correction de places_restantes si nécessaire
            if ((typeof processedSession.places_restantes !== 'number' || isNaN(processedSession.places_restantes)) &&
                typeof processedSession.max_participants === 'number' && typeof processedSession.inscrits === 'number') {
                
                processedSession.places_restantes = Math.max(0, processedSession.max_participants - processedSession.inscrits);
            }
            
            return processedSession;
        });
    }
    
    // Options communes pour les graphiques
    const commonChartOptions = {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
            legend: {
                position: 'bottom',
                labels: {
                    padding: 15,
                    boxWidth: 12,
                    font: { size: 11 }
                }
            },
            tooltip: {
                backgroundColor: 'rgba(0,0,0,0.7)',
                titleFont: { size: 13 },
                bodyFont: { size: 12 },
                padding: 10,
                callbacks: {
                    label: function(context) {
                        let label = context.dataset.label || '';
                        if (label) {
                            label += ': ';
                        }
                        if (context.parsed.y !== null && context.chart.config.type === 'bar') {
                            label += context.parsed.y;
                        }
                        if (context.parsed !== null && context.chart.config.type === 'doughnut') {
                            label += context.parsed;
                        }
                        return label;
                    }
                }
            }
        }
    };
    
    // Fonction principale pour créer ou mettre à jour le graphique des thèmes
    function createOrUpdateThemeChart(sessionsArray) {
        const processedSessions = validateAndProcessSessions(sessionsArray);
        console.log("Enhanced Charts: Données reçues pour Graphique Thèmes:", processedSessions);
        console.log("Enhanced Charts: Attempting to create/update THEME chart.");
        
        const canvasElement = document.getElementById('themeChartCanvas');
        if (!canvasElement) {
            if (DASH_CONFIG.debugMode) console.warn('Enhanced Charts: Canvas #themeChartCanvas not found.');
            // Si Canvas non trouvé, essayer de rendre en HTML statique
            updateStaticThemeChart(processedSessions);
            return;
        }
        
        const ctx = canvasElement.getContext('2d');
        if (!ctx || !isChartJsAvailable) {
            console.error('Enhanced Charts: Failed to get 2D context for #themeChartCanvas or Chart.js unavailable.');
            updateStaticThemeChart(processedSessions);
            return;
        }
        
        const themeCounts = {};
        if (processedSessions && Array.isArray(processedSessions) && processedSessions.length > 0) {
            processedSessions.forEach(session => {
                if (session.theme && typeof session.inscrits === 'number') {
                    themeCounts[session.theme] = (themeCounts[session.theme] || 0) + session.inscrits;
                }
            });
        } else {
            if (DASH_CONFIG.debugMode) console.log('Enhanced Charts: No valid session data for theme chart.');
        }
        
        const chartData = Object.entries(themeCounts).map(([label, value]) => ({
            label,
            value,
            color: getResolvedColor(window.themesDataForChart[label]?.color, '#CCCCCC')
        }));
        
        const labels = chartData.map(item => item.label);
        const values = chartData.map(item => item.value);
        const backgroundColors = chartData.map(item => item.color);
        
        const totalInscrits = values.reduce((a, b) => a + b, 0);
        const donutTotalEl = document.getElementById('chart-theme-total');
        if (donutTotalEl) donutTotalEl.textContent = totalInscrits.toLocaleString();
        
        if (themeChartInstance) {
            try {
                themeChartInstance.data.labels = labels;
                themeChartInstance.data.datasets[0].data = values;
                themeChartInstance.data.datasets[0].backgroundColor = backgroundColors;
                themeChartInstance.update();
                if (DASH_CONFIG.debugMode) console.log('Enhanced Charts: Theme chart updated.');
            } catch (e) {
                console.error('Enhanced Charts: Error updating theme chart, destroying and recreating:', e);
                try {
                    themeChartInstance.destroy();
                    themeChartInstance = null;
                } catch (destroyError) {
                    console.error('Enhanced Charts: Error destroying theme chart:', destroyError);
                }
                updateStaticThemeChart(processedSessions);
            }
        } else {
            chartCreationAttempts.theme++;
            try {
                // Nettoyer le contexte avant de créer un nouveau graphique
                ctx.clearRect(0, 0, canvasElement.width, canvasElement.height);
                
                themeChartInstance = new Chart(ctx, {
                    type: 'doughnut',
                    data: {
                        labels: labels,
                        datasets: [{
                            label: 'Inscriptions par Thème',
                            data: values,
                            backgroundColor: backgroundColors,
                            borderColor: '#fff',
                            borderWidth: 2,
                            hoverOffset: 8
                        }]
                    },
                    options: {
                        ...commonChartOptions,
                        cutout: '65%',
                        plugins: {
                            ...commonChartOptions.plugins,
                            legend: { ...commonChartOptions.plugins.legend, display: labels.length > 0 && labels.length < 10 },
                        }
                    }
                });
                if (DASH_CONFIG.debugMode) console.log('Enhanced Charts: Theme chart created.');
            } catch (e) {
                console.error('Enhanced Charts: Error creating theme chart:', e);
                // En cas d'erreur, utiliser le rendu statique
                updateStaticThemeChart(processedSessions);
                
                // Si plusieurs tentatives échouent, basculer définitivement vers les graphiques statiques
                if (chartCreationAttempts.theme >= 2) {
                    console.warn('Enhanced Charts: Multiple failures creating theme chart. Switching permanently to static charts.');
                    useStaticCharts();
                }
            }
        }
    }
    
    // Fonction principale pour créer ou mettre à jour le graphique des services
    function createOrUpdateServiceChart(participantsArray) {
        console.log("Enhanced Charts: Données reçues pour Graphique Services:", participantsArray);
        console.log("Enhanced Charts: Attempting to create/update SERVICE chart.");
        
        const canvasElement = document.getElementById('serviceChartCanvas');
        if (!canvasElement) {
            if (DASH_CONFIG.debugMode) console.warn('Enhanced Charts: Canvas #serviceChartCanvas not found.');
            // Si Canvas non trouvé, essayer de rendre en HTML statique
            updateStaticServiceChart(participantsArray);
            return;
        }
        
        const ctx = canvasElement.getContext('2d');
        if (!ctx || !isChartJsAvailable) {
            console.error('Enhanced Charts: Failed to get 2D context for #serviceChartCanvas or Chart.js unavailable.');
            updateStaticServiceChart(participantsArray);
            return;
        }
        
        const serviceCounts = {};
        if (participantsArray && Array.isArray(participantsArray)) {
            participantsArray.forEach(participant => {
                let service = null;
                if (typeof participant.service === 'string') {
                    service = participant.service;
                } else if (participant.service && typeof participant.service === 'object' && participant.service.nom) {
                    service = participant.service.nom;
                }
                
                if (service) {
                    serviceCounts[service] = (serviceCounts[service] || 0) + 1;
                }
            });
        } else {
            if (DASH_CONFIG.debugMode) console.log('Enhanced Charts: No participant data for service chart.');
        }
        
        let chartData = Object.entries(serviceCounts).map(([label, value]) => ({
            label,
            value,
            color: getResolvedColor(window.servicesDataForChart[label]?.color, '#CCCCCC')
        }));
        
        chartData.sort((a, b) => b.value - a.value); // Trier par valeur décroissante
        
        const labels = chartData.map(item => item.label);
        const values = chartData.map(item => item.value);
        const backgroundColors = chartData.map(item => item.color);
        
        if (serviceChartInstance) {
            try {
                serviceChartInstance.data.labels = labels;
                serviceChartInstance.data.datasets[0].data = values;
                serviceChartInstance.data.datasets[0].backgroundColor = backgroundColors;
                serviceChartInstance.data.datasets[0].borderColor = backgroundColors;
                serviceChartInstance.update();
                if (DASH_CONFIG.debugMode) console.log('Enhanced Charts: Service chart updated.');
            } catch (e) {
                console.error('Enhanced Charts: Error updating service chart, destroying and recreating:', e);
                try {
                    serviceChartInstance.destroy();
                    serviceChartInstance = null;
                } catch (destroyError) {
                    console.error('Enhanced Charts: Error destroying service chart:', destroyError);
                }
                updateStaticServiceChart(participantsArray);
            }
        } else {
            chartCreationAttempts.service++;
            try {
                // Nettoyer le contexte avant de créer un nouveau graphique
                ctx.clearRect(0, 0, canvasElement.width, canvasElement.height);
                
                serviceChartInstance = new Chart(ctx, {
                    type: 'bar',
                    data: {
                        labels: labels,
                        datasets: [{
                            label: 'Participants par Service',
                            data: values,
                            backgroundColor: backgroundColors,
                            borderColor: backgroundColors,
                            borderWidth: 1,
                            borderRadius: 4,
                            barPercentage: 0.7,
                            categoryPercentage: 0.8
                        }]
                    },
                    options: {
                        ...commonChartOptions,
                        indexAxis: 'y', // Graphique à barres horizontales
                        scales: {
                            x: {
                                beginAtZero: true,
                                ticks: {
                                    precision: 0 // Pas de décimales pour les nombres de participants
                                }
                            },
                            y: {
                                ticks: {
                                    font: { size: 10 } // Police plus petite pour les étiquettes Y si nombreuses
                                }
                            }
                        },
                        plugins: {
                            ...commonChartOptions.plugins,
                            legend: { display: false }, // Légende souvent inutile pour les graphiques à barres à un seul jeu de données
                        }
                    }
                });
                if (DASH_CONFIG.debugMode) console.log('Enhanced Charts: Service chart created.');
            } catch (e) {
                console.error('Enhanced Charts: Error creating service chart:', e);
                // En cas d'erreur, utiliser le rendu statique
                updateStaticServiceChart(participantsArray);
                
                // Si plusieurs tentatives échouent, basculer définitivement vers les graphiques statiques
                if (chartCreationAttempts.service >= 2) {
                    console.warn('Enhanced Charts: Multiple failures creating service chart. Switching permanently to static charts.');
                    useStaticCharts();
                }
            }
        }
    }
    
    // Fonction pour initialiser les graphiques avec des données
    function initializeCharts(payload) {
        if (!payload) {
            if (DASH_CONFIG.debugMode) console.warn('Enhanced Charts: No data payload provided for initialization.');
            // Essayer de créer des graphiques vides ou une visualisation de substitution
            createOrUpdateThemeChart([]);
            createOrUpdateServiceChart([]);
            return Promise.resolve({ success: false, message: "No initial data for charts." });
        }
        
        if (DASH_CONFIG.debugMode) console.log('Enhanced Charts: Initializing/Updating charts with payload:', payload);
        
        if (payload.sessions) createOrUpdateThemeChart(payload.sessions);
        else createOrUpdateThemeChart([]);
        
        if (payload.participants) createOrUpdateServiceChart(payload.participants);
        else createOrUpdateServiceChart([]);
        
        // Mise à jour du feed d'activité
        if (payload.activites) updateActivityFeed(payload.activites);
        
        // Appel de l'améliorateur global des badges de thème s'il existe
        if (typeof window.enhanceThemeBadgesGlobally === 'function') {
            window.enhanceThemeBadgesGlobally();
        }
        
        // Marquer les graphiques comme initialisés
        chartsInitialized = true;
        
        return Promise.resolve({ success: true, message: "Charts initialized/updated." });
    }
    
    // Implémenter le rendu statique des graphiques comme solution de repli
    function useStaticCharts() {
        if (DASH_CONFIG.debugMode) console.log('Enhanced Charts: Using static chart rendering as fallback.');
        
        // Remplacer les fonctions de graphique pour utiliser le rendu statique
        window.chartModule = {
            initialize: function() {
                if (DASH_CONFIG.debugMode) console.log('Static Charts: initialize() called. Will fetch data and render static HTML charts.');
                
                // Charger les données initiales
                fetchDashboardData();
                
                return Promise.resolve({ success: true, message: "Static chart module initialized." });
            }
        };
        
        // Cacher les canvas et montrer les conteneurs statiques
        document.querySelectorAll('canvas#themeChartCanvas, canvas#serviceChartCanvas').forEach(canvas => {
            canvas.style.display = 'none';
        });
        
        document.querySelectorAll('.static-chart-donut, .static-chart-bars').forEach(container => {
            container.style.display = 'block';
        });
    }
    
    // Fonction pour charger les données du tableau de bord via l'API
    function fetchDashboardData() {
        fetch('/api/dashboard_essential')
            .then(response => {
                if (!response.ok) {
                    throw new Error(`HTTP error! status: ${response.status}`);
                }
                return response.json();
            })
            .then(data => {
                console.log("Dashboard data received:", data);
                
                // Mettre à jour les graphiques statiques
                updateStaticThemeChart(data.sessions);
                updateStaticServiceChart(data.participants || []);
                
                // Mettre à jour le feed d'activité
                updateActivityFeed(data.activites || []);
                
                // Déclencher l'événement pour d'autres composants qui utilisent ces données
                document.dispatchEvent(new CustomEvent('dashboardDataRefreshed', { 
                    detail: { data: data } 
                }));
            })
            .catch(error => {
                console.error("Error fetching dashboard data:", error);
                // Afficher un message d'erreur
                showLoadingError();
                
                // Fallback: essayer de charger les données individuellement
                tryIndividualDataFetches();
            });
    }
    
    // Tente de récupérer les données par endpoints individuels si l'endpoint combiné échoue
    function tryIndividualDataFetches() {
        console.log("Enhanced Charts: Trying individual data fetches as fallback");
        
        // Récupérer les sessions
        fetch('/api/sessions')
            .then(response => response.ok ? response.json() : null)
            .then(data => {
                if (data) {
                    const sessions = Array.isArray(data) ? data : (data.items || []);
                    updateStaticThemeChart(sessions);
                }
            })
            .catch(e => console.error("Error fetching sessions:", e));
            
        // Récupérer les participants
        fetch('/api/participants')
            .then(response => response.ok ? response.json() : null)
            .then(data => {
                if (data) {
                    const participants = Array.isArray(data) ? data : (data.items || []);
                    updateStaticServiceChart(participants);
                }
            })
            .catch(e => console.error("Error fetching participants:", e));
            
        // Récupérer les activités
        fetch('/api/activites')
            .then(response => response.ok ? response.json() : null)
            .then(data => {
                if (data && Array.isArray(data)) {
                    updateActivityFeed(data);
                }
            })
            .catch(e => console.error("Error fetching activities:", e));
    }
    
    // Implémentation statique du graphique des thèmes
    function updateStaticThemeChart(sessions) {
        console.log("Static Charts: Updating theme chart with:", sessions);
        
        // Trouver les conteneurs de graphiques
        const donutContainer = document.querySelector('.static-chart-donut');
        const legendContainer = document.querySelector('#theme-chart-legend');
        const totalElement = document.getElementById('chart-theme-total');
        
        if (!donutContainer) {
            console.error("Theme chart container not found");
            return;
        }
        
        // S'assurer que le conteneur est visible
        donutContainer.style.display = 'block';
        
        // Effacer le contenu existant
        donutContainer.innerHTML = '';
        if (legendContainer) legendContainer.innerHTML = '';
        
        // Traiter les données
        const themeCounts = {};
        let totalInscriptions = 0;
        
        const processedSessions = validateAndProcessSessions(sessions);
        
        if (processedSessions && processedSessions.length > 0) {
            processedSessions.forEach(session => {
                if (session.theme && session.inscrits) {
                    themeCounts[session.theme] = (themeCounts[session.theme] || 0) + session.inscrits;
                    totalInscriptions += session.inscrits;
                }
            });
        }
        
        // Mettre à jour le compteur total
        if (totalElement) {
            totalElement.textContent = totalInscriptions;
        }
        
        // Couleurs pour les thèmes
        const themeColors = {
            'Communiquer avec Teams': '#0078d4',
            'Gérer les tâches (Planner)': '#7719aa',
            'Gérer mes fichiers (OneDrive/SharePoint)': '#0364b8',
            'Collaborer avec Teams': '#038387'
        };
        
        // Si pas de données, afficher un état vide
        if (Object.keys(themeCounts).length === 0) {
            donutContainer.innerHTML = '<div class="donut-center"><div class="donut-total">0</div><div class="donut-label">INSCRITS</div></div>';
            return;
        }
        
        // Créer les segments du donut
        let startAngle = 0;
        const entries = Object.entries(themeCounts);
        
        entries.forEach(([theme, count], index) => {
            const percentage = (count / totalInscriptions) * 100;
            const angle = (percentage / 100) * 360;
            const color = themeColors[theme] || `hsl(${index * 60}, 70%, 50%)`;
            
            // Créer le segment
            const segment = document.createElement('div');
            segment.classList.add('donut-segment');
            segment.style.setProperty('--fill', color);
            segment.style.setProperty('--rotation', startAngle);
            segment.style.setProperty('--percentage', percentage);
            segment.style.setProperty('--index', index);
            segment.style.clipPath = `polygon(50% 50%, ${50 + 50 * Math.cos(startAngle * Math.PI / 180)}% ${50 + 50 * Math.sin(startAngle * Math.PI / 180)}%, ${50 + 50 * Math.cos((startAngle + angle) * Math.PI / 180)}% ${50 + 50 * Math.sin((startAngle + angle) * Math.PI / 180)}%)`;
            segment.style.transform = `rotate(${startAngle}deg)`;
            segment.style.backgroundColor = color;
            donutContainer.appendChild(segment);
            
            // Ajouter à la légende
            if (legendContainer) {
                const legendItem = document.createElement('div');
                legendItem.classList.add('legend-item');
                legendItem.innerHTML = `
                    <div class="legend-color" style="background-color: ${color};"></div>
                    <div class="legend-label">${theme}</div>
                    <div class="legend-value">${count}</div>
                `;
                legendContainer.appendChild(legendItem);
            }
            
            startAngle += angle;
        });
        
        // Ajouter le trou central
        const center = document.createElement('div');
        center.classList.add('donut-center');
        center.innerHTML = `
            <div class="donut-total">${totalInscriptions}</div>
            <div class="donut-label">INSCRITS</div>
        `;
        donutContainer.appendChild(center);
        
        // Ajouter la classe d'animation
        donutContainer.classList.add('animate');
    }
    
    // Implémentation statique du graphique des services
    function updateStaticServiceChart(participants) {
        console.log("Static Charts: Updating service chart with:", participants);
        
        // Trouver le conteneur du graphique
        const barsContainer = document.querySelector('.static-chart-bars');
        
        if (!barsContainer) {
            console.error("Service chart container not found");
            return;
        }
        
        // S'assurer que le conteneur est visible
        barsContainer.style.display = 'block';
        
        // Effacer le contenu existant
        barsContainer.innerHTML = '';
        
        // Traiter les données
        const serviceCounts = {};
        
        if (participants && Array.isArray(participants) && participants.length > 0) {
            participants.forEach(participant => {
                let service = null;
                if (typeof participant.service === 'string') {
                    service = participant.service;
                } else if (participant.service && typeof participant.service === 'object' && participant.service.nom) {
                    service = participant.service.nom;
                }
                
                if (service) {
                    serviceCounts[service] = (serviceCounts[service] || 0) + 1;
                }
            });
        }
        
        // Couleurs pour les services
        const serviceColors = {
            'Commerce Anecoop-Solagora': '#FFC107',
            'Comptabilité': '#2196F3',
            'Florensud': '#4CAF50',
            'Informatique': '#607D8B',
            'Marketing': '#9C27B0',
            'Qualité': '#F44336',
            'RH': '#FF9800'
        };
        
        // Si pas de données, afficher un état vide
        if (Object.keys(serviceCounts).length === 0) {
            barsContainer.innerHTML = '<div class="text-center text-muted">Aucun participant</div>';
            return;
        }
        
        // Trier les services par nombre en ordre décroissant
        const sortedServices = Object.entries(serviceCounts)
            .sort((a, b) => b[1] - a[1]);
            
        // Récupérer le nombre maximum pour les calculs de pourcentage
        const maxCount = Math.max(...Object.values(serviceCounts));
        
        // Créer les éléments de barres
        sortedServices.forEach(([service, count], index) => {
            const percentage = (count / maxCount) * 100;
            const color = serviceColors[service] || `hsl(${index * 60}, 70%, 50%)`;
            const serviceClass = service.toLowerCase().replace(/[^a-z0-9]/g, '-');
            
            // Créer l'élément de barre
            const barItem = document.createElement('div');
            barItem.classList.add('bar-item');
            
            barItem.innerHTML = `
                <div class="bar-header">
                    <div class="bar-label">
                        <i class="fas fa-users fa-sm me-1"></i>
                        ${service}
                    </div>
                    <div class="bar-total">${count}</div>
                </div>
                <div class="bar-container">
                    <div class="bar-value ${serviceClass}" 
                         style="width: ${percentage}%; background-color: ${color}; --percent: ${percentage}%;" 
                         data-value="${count}" 
                         data-index="${index}"></div>
                </div>
            `;
            
            barsContainer.appendChild(barItem);
        });
        
        // Ajouter la classe d'animation
        barsContainer.classList.add('animate');
    }
    
    // Implémentation de la mise à jour du feed d'activité
    function updateActivityFeed(activities) {
        console.log("Enhanced Charts: Updating activity feed with:", activities);
        
        // Trouver le conteneur
        const activityContainer = document.getElementById('recent-activity');
        
        if (!activityContainer) {
            console.warn("Activity container not found");
            return;
        }
        
        // Supprimer le spinner de chargement
        const loadingEl = activityContainer.querySelector('.loading-spinner');
        if (loadingEl) {
            loadingEl.remove();
        }
        
        // Effacer le contenu existant
        activityContainer.innerHTML = '';
        
        // Si pas d'activités, afficher un état vide
        if (!activities || !Array.isArray(activities) || activities.length === 0) {
            activityContainer.innerHTML = '<div class="text-center p-3 text-muted">Aucune activité récente</div>';
            return;
        }
        
        // Icônes d'activité en fonction du type
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
        
        // Créer les éléments d'activité
        activities.forEach(activity => {
            const icon = activityIcons[activity.type] || activityIcons.default;
            
            let itemClass = 'list-group-item-light';
            if (activity.type.includes('ajout')) itemClass = 'list-group-item-success';
            if (activity.type.includes('suppression')) itemClass = 'list-group-item-danger';
            if (activity.type.includes('modification')) itemClass = 'list-group-item-warning';
            if (activity.type.includes('validation')) itemClass = 'list-group-item-info';
            
            const activityItem = document.createElement('div');
            activityItem.classList.add('list-group-item', 'py-2', itemClass);
            
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
            
            activityContainer.appendChild(activityItem);
        });
    }
    
    // Afficher une erreur de chargement
    function showLoadingError() {
        // Pour le graphique des thèmes
        const themeContainer = document.querySelector('.static-chart-donut');
        if (themeContainer) {
            themeContainer.innerHTML = '<div class="text-center text-danger p-3">Erreur de chargement des données</div>';
        }
        
        // Pour le graphique des services
        const serviceContainer = document.querySelector('.static-chart-bars');
        if (serviceContainer) {
            serviceContainer.innerHTML = '<div class="text-center text-danger p-3">Erreur de chargement des données</div>';
        }
        
        // Pour le feed d'activité
        const activityContainer = document.getElementById('recent-activity');
        if (activityContainer) {
            activityContainer.innerHTML = '<div class="text-center text-danger p-3">Erreur de chargement des activités</div>';
        }
    }
    
    // Écouter les événements de rafraîchissement des données
    document.addEventListener('dashboardDataRefreshed', function(event) {
        if (event.detail && event.detail.data) {
            if (DASH_CONFIG.debugMode) console.log('Enhanced Charts: Received dashboardDataRefreshed event.');
            initializeCharts(event.detail.data);
        } else if (DASH_CONFIG.debugMode) {
            console.warn('Enhanced Charts: dashboardDataRefreshed event received without data.');
        }
    });
    
    // Exposer un module d'initialisation pour dashboard-init.js
    window.chartModule = {
        initialize: function() {
            // Cette fonction sera appelée par dashboard-init.js.
            // Le rendu réel des graphiques se fera à la réception de l'événement 'dashboardDataRefreshed'.
            if (DASH_CONFIG.debugMode) console.log('Enhanced Charts: chartModule.initialize() called. Waiting for data event or initial data.');
            
            // Tenter de récupérer les données immédiatement
            fetchDashboardData();
            
            return Promise.resolve({ success: true, message: "Chart module ready, fetching initial data." });
        }
    };
    
    // Fixer le bouton de rafraîchissement
    const refreshBtn = document.getElementById('refresh-dashboard');
    if (refreshBtn) {
        refreshBtn.addEventListener('click', function() {
            this.innerHTML = '<i class="fas fa-sync-alt fa-spin"></i> Actualisation...';
            this.disabled = true;
            
            fetchDashboardData();
            
            // Réinitialiser le bouton après 2 secondes
            setTimeout(() => {
                this.innerHTML = '<i class="fas fa-sync-alt"></i> Actualiser';
                this.disabled = false;
            }, 2000);
        });
    }
    
    if (DASH_CONFIG.debugMode) console.log("Enhanced Charts (v2.3.0): Setup complete.");
});
