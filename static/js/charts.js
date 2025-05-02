/**
 * Formation Microsoft 365 - charts.js (version complète améliorée)
 * Correction des erreurs de réutilisation de canvas et gestion robuste des erreurs
 * v1.4.0
 */

// Configuration globale
const chartConfig = {
    debugMode: false,
    colors: {
        teams: '#0078D4',
        planner: '#7719AA',
        onedrive: '#0364B8',
        sharepoint: '#038387',
        services: {
            'commerce': '#FFC107',
            'comptabilite': '#2196F3',
            'florensud': '#4CAF50',
            'informatique': '#607D8B',
            'marketing': '#9C27B0',
            'qualite': '#F44336',
            'rh': '#FF9800'
        }
    },
    // Prévenir les initialisations multiples
    initStatus: {
        themeInitializing: false,
        serviceInitializing: false
    }
};

// Stockage des instances de graphiques
let themeChartInstance = null;
let serviceChartInstance = null;

// Fonction utilitaire pour les requêtes fetch avec retry
async function fetchWithRetry(url, options = {}, maxRetries = 3, initialDelay = 500) {
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
            
            // Délai exponentiel avec jitter pour éviter la congestion
            delay = delay * 1.5 + Math.random() * 200;
        }
    }
}

/**
 * Initialise les graphiques présents sur la page avec prévention des initialisations multiples
 * @returns {Promise<boolean>} True si l'initialisation a réussi ou si aucun graphique n'est présent, False en cas d'erreur
 */
async function initializeCharts() {
    console.log('Initialisation des graphiques...');
    
    // Protection contre les initialisations multiples
    if (chartConfig.initStatus.initializing) {
        console.log('Une initialisation des graphiques est déjà en cours, ignoré');
        return false;
    }
    
    // Marquer comme en cours d'initialisation
    chartConfig.initStatus.initializing = true;
    
    try {
        // 1. Vérifier si on est sur une page avec des graphiques
        const themeChart = document.getElementById('themeChart');
        const serviceChart = document.getElementById('serviceChart');
        
        // Si aucun graphique n'est présent sur cette page, sortir proprement
        if (!themeChart && !serviceChart) {
            console.log("Aucun canvas de graphique trouvé sur cette page (normal)");
            chartConfig.initStatus.initializing = false;
            return true; // Succès, même s'il n'y a rien à faire
        }
        
        // 2. Vérifier si Chart.js est disponible
        if (typeof Chart === 'undefined') {
            console.error("Chart.js n'est pas chargé!");
            const overlays = document.querySelectorAll('#theme-chart-overlay, #service-chart-overlay');
            overlays.forEach(overlay => {
                if (overlay) {
                    overlay.innerHTML = '<p class="text-danger">Erreur: Chart.js manquant</p>';
                    overlay.style.display = 'flex';
                }
            });
            chartConfig.initStatus.initializing = false;
            return false;
        }
        
        // 3. Initialiser uniquement les graphiques présents sur la page
        let success = true;
        
        if (themeChart) {
            try {
                const themeSuccess = await initThemeChart();
                if (!themeSuccess) {
                    console.warn("Échec de l'initialisation du graphique thème");
                    success = false;
                }
            } catch (themeError) {
                console.error("Erreur lors de l'initialisation du graphique thème:", themeError);
                success = false;
            }
        }
        
        if (serviceChart) {
            try {
                const serviceSuccess = await initServiceChart();
                if (!serviceSuccess) {
                    console.warn("Échec de l'initialisation du graphique service");
                    success = false;
                }
            } catch (serviceError) {
                console.error("Erreur lors de l'initialisation du graphique service:", serviceError);
                success = false;
            }
        }
        
        // 4. Rapport sur le résultat global
        if (success) {
            console.log('Tous les graphiques présents ont été initialisés avec succès');
        } else {
            console.warn("Certains graphiques n'ont pas pu être initialisés correctement");
        }
        
        // 5. Libérer le verrou d'initialisation
        chartConfig.initStatus.initializing = false;
        return success;
    } catch (error) {
        // En cas d'erreur générale, assurer que le verrou est libéré
        console.error('Erreur générale lors de l\'initialisation des graphiques:', error);
        chartConfig.initStatus.initializing = false;
        return false;
    }
}

/**
 * Initialise le graphique de répartition par thème
 */
async function initThemeChart() {
    // Éviter les initialisations simultanées
    if (chartConfig.initStatus.themeInitializing) {
        console.log('Initialisation du graphique thème déjà en cours, ignoré');
        return false;
    }
    
    chartConfig.initStatus.themeInitializing = true;
    
    try {
        const ctx = document.getElementById('themeChart');
        if (!ctx) {
            console.log("Canvas 'themeChart' non trouvé");
            chartConfig.initStatus.themeInitializing = false;
            return false;
        }

        // Afficher l'overlay de chargement
        const overlay = document.getElementById('theme-chart-overlay');
        if (overlay) overlay.style.display = 'flex';
        
        // SOLUTION ROBUSTE: Détruire TOUTE instance Chart.js associée à ce canvas
        try {
            const existingChart = Chart.getChart(ctx);
            if (existingChart) {
                existingChart.destroy();
                console.log("Instance de graphique thème existante détruite");
            }
        } catch (destroyError) {
            console.warn("Erreur lors de la destruction du graphique thème:", destroyError);
            // Continuer malgré l'erreur
        }
        
        // Réinitialiser notre référence dans tous les cas
        themeChartInstance = null;

        // Récupérer les données via l'API avec retry
        let sessions;
        try {
            sessions = await fetchWithRetry('/api/sessions');
        } catch (fetchError) {
            console.error('Erreur récupération données sessions:', fetchError);
            if (overlay) {
                overlay.innerHTML = `
                    <div class="text-center">
                        <i class="fas fa-exclamation-circle text-danger mb-2"></i>
                        <p class="text-muted mb-0">Erreur chargement données</p>
                        <button class="btn btn-sm btn-outline-primary mt-2" onclick="chartModule.refreshThemeChart()">
                            <i class="fas fa-sync-alt me-1"></i>Réessayer
                        </button>
                    </div>`;
                overlay.style.display = 'flex';
            }
            chartConfig.initStatus.themeInitializing = false;
            return false;
        }
        
        // Traitement des données
        const themeCounts = {};
        sessions.forEach(session => {
            if (session.inscrits > 0) {
                const theme = session.theme;
                if (!themeCounts[theme]) {
                    themeCounts[theme] = {
                        count: 0,
                        color: getThemeColor(theme)
                    };
                }
                themeCounts[theme].count += session.inscrits;
            }
        });

        // Préparation des données
        const labels = Object.keys(themeCounts);
        
        // Si pas de données, afficher un message et créer un graphique minimal
        if (labels.length === 0) {
            // Créer des données fictives pour éviter les erreurs
            const fallbackData = {
                labels: ['Aucune donnée'],
                datasets: [{
                    data: [1],
                    backgroundColor: ['#cccccc'],
                    borderWidth: 1
                }]
            };
            
            themeChartInstance = new Chart(ctx, {
                type: 'doughnut',
                data: fallbackData,
                options: {
                    responsive: true,
                    maintainAspectRatio: false,
                    cutout: '60%',
                    plugins: {
                        legend: {
                            display: false
                        },
                        tooltip: {
                            enabled: false
                        }
                    }
                }
            });
            
            if (overlay) {
                overlay.innerHTML = '<div class="text-center"><p class="text-muted mb-0">Aucune donnée disponible</p></div>';
                overlay.style.display = 'flex';
            }
            
            chartConfig.initStatus.themeInitializing = false;
            return true;
        }
        
        const data = labels.map(theme => themeCounts[theme].count);
        const colors = labels.map(theme => themeCounts[theme].color);
        
        // Création du graphique (après avoir vérifié que l'ancien est détruit)
        themeChartInstance = new Chart(ctx, {
            type: 'doughnut',
            data: {
                labels: labels,
                datasets: [{
                    data: data,
                    backgroundColor: colors,
                    borderWidth: 1
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                cutout: '60%',
                plugins: {
                    legend: {
                        position: 'bottom',
                        labels: {
                            boxWidth: 12,
                            font: {
                                size: 11
                            }
                        }
                    },
                    tooltip: {
                        callbacks: {
                            label: function(context) {
                                return `${context.label}: ${context.raw} inscriptions`;
                            }
                        }
                    }
                }
            }
        });
        
        if (overlay) overlay.style.display = 'none';
        chartConfig.initStatus.themeInitializing = false;
        return true;
    } catch (error) {
        console.error('Erreur initialisation graphique thème:', error);
        const overlay = document.getElementById('theme-chart-overlay');
        if (overlay) {
            overlay.innerHTML = `
                <div class="text-center">
                    <i class="fas fa-exclamation-circle text-danger mb-2"></i>
                    <p class="text-muted mb-0">Erreur graphique thème</p>
                    <button class="btn btn-sm btn-outline-primary mt-2" onclick="chartModule.refreshThemeChart()">
                        <i class="fas fa-sync-alt me-1"></i>Réessayer
                    </button>
                </div>`;
            overlay.style.display = 'flex';
        }
        chartConfig.initStatus.themeInitializing = false;
        return false;
    }
}

/**
 * Initialise le graphique des participants par service
 */
async function initServiceChart() {
    // Éviter les initialisations simultanées
    if (chartConfig.initStatus.serviceInitializing) {
        console.log('Initialisation du graphique service déjà en cours, ignoré');
        return false;
    }
    
    chartConfig.initStatus.serviceInitializing = true;
    
    try {
        const ctx = document.getElementById('serviceChart');
        if (!ctx) {
            console.log("Canvas 'serviceChart' non trouvé");
            chartConfig.initStatus.serviceInitializing = false;
            return false;
        }

        // Afficher l'overlay
        const overlay = document.getElementById('service-chart-overlay');
        if (overlay) overlay.style.display = 'flex';
        
        // SOLUTION ROBUSTE: Détruire TOUTE instance Chart.js associée à ce canvas
        try {
            const existingChart = Chart.getChart(ctx);
            if (existingChart) {
                existingChart.destroy();
                console.log("Instance de graphique service existante détruite");
            }
        } catch (destroyError) {
            console.warn("Erreur lors de la destruction du graphique service:", destroyError);
            // Continuer malgré l'erreur
        }
        
        // Réinitialiser notre référence dans tous les cas
        serviceChartInstance = null;

        // Récupérer les données nécessaires avec retry
        let participants, sessions;
        try {
            // Récupérer en parallèle pour optimiser
            [participants, sessions] = await Promise.all([
                fetchWithRetry('/api/participants'),
                fetchWithRetry('/api/sessions')
            ]);
        } catch (fetchError) {
            console.error('Erreur récupération données:', fetchError);
            if (overlay) {
                overlay.innerHTML = `
                    <div class="text-center">
                        <i class="fas fa-exclamation-circle text-danger mb-2"></i>
                        <p class="text-muted mb-0">Erreur chargement données</p>
                        <button class="btn btn-sm btn-outline-primary mt-2" onclick="chartModule.refreshServiceChart()">
                            <i class="fas fa-sync-alt me-1"></i>Réessayer
                        </button>
                    </div>`;
                overlay.style.display = 'flex';
            }
            chartConfig.initStatus.serviceInitializing = false;
            return false;
        }

        // Calculer les participants uniques et les inscriptions par service
        const serviceMap = {};
        
        // Extraire les services uniques directement des participants
        participants.forEach(participant => {
            const serviceId = participant.service_id;
            const serviceName = participant.service;
            
            if (!serviceId || !serviceName) return;
            
            if (!serviceMap[serviceId]) {
                serviceMap[serviceId] = {
                    nom: serviceName,
                    couleur: getServiceColor(serviceName),
                    uniqueParticipants: new Set(),
                    totalInscriptions: 0
                };
            }
            
            // Ajouter le participant à son service
            serviceMap[serviceId].uniqueParticipants.add(participant.id);
            
            // Ajouter les inscriptions si disponibles
            if (typeof participant.inscriptions === 'number') {
                serviceMap[serviceId].totalInscriptions += participant.inscriptions;
            }
        });
        
        // Préparer les données pour le graphique
        const servicesData = Object.values(serviceMap)
            .filter(s => s.uniqueParticipants.size > 0)
            .sort((a, b) => a.nom.localeCompare(b.nom));
        
        // Si pas de données, afficher un message et créer un graphique minimal
        if (servicesData.length === 0) {
            // Créer des données fictives pour éviter les erreurs
            const fallbackData = {
                labels: ['Aucune donnée'],
                datasets: [{
                    data: [1],
                    backgroundColor: ['#cccccc'],
                    borderWidth: 1
                }]
            };
            
            serviceChartInstance = new Chart(ctx, {
                type: 'bar',
                data: fallbackData,
                options: {
                    responsive: true,
                    maintainAspectRatio: false,
                    indexAxis: 'y',
                    plugins: {
                        legend: {
                            display: false
                        },
                        tooltip: {
                            enabled: false
                        }
                    },
                    scales: {
                        x: {
                            display: false
                        },
                        y: {
                            display: false
                        }
                    }
                }
            });
            
            if (overlay) {
                overlay.innerHTML = '<div class="text-center"><p class="text-muted mb-0">Aucune donnée disponible</p></div>';
                overlay.style.display = 'flex';
            }
            
            chartConfig.initStatus.serviceInitializing = false;
            return true;
        }
            
        const labels = servicesData.map(s => s.nom);
        const uniqueParticipants = servicesData.map(s => s.uniqueParticipants.size);
        const totalInscriptions = servicesData.map(s => s.totalInscriptions);
        const colors = servicesData.map(s => s.couleur);
        
        // Créer le graphique
        serviceChartInstance = new Chart(ctx, {
            type: 'bar',
            data: {
                labels: labels,
                datasets: [{
                    label: 'Participants uniques',
                    data: uniqueParticipants,
                    backgroundColor: colors,
                    borderWidth: 1
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                indexAxis: 'y', // Barres horizontales
                scales: {
                    x: {
                        beginAtZero: true,
                        ticks: {
                            precision: 0,
                            stepSize: 1
                        }
                    }
                },
                plugins: {
                    legend: {
                        display: false
                    },
                    tooltip: {
                        callbacks: {
                            label: function(context) {
                                const index = context.dataIndex;
                                return [
                                    `Service: ${labels[index]}`,
                                    `Participants uniques: ${uniqueParticipants[index]}`,
                                    `Inscriptions totales: ${totalInscriptions[index]}`
                                ];
                            }
                        }
                    }
                }
            }
        });
        
        if (overlay) overlay.style.display = 'none';
        chartConfig.initStatus.serviceInitializing = false;
        return true;
    } catch (error) {
        console.error('Erreur initialisation graphique service:', error);
        const overlay = document.getElementById('service-chart-overlay');
        if (overlay) {
            overlay.innerHTML = `
                <div class="text-center">
                    <i class="fas fa-exclamation-circle text-danger mb-2"></i>
                    <p class="text-muted mb-0">Erreur graphique service</p>
                    <button class="btn btn-sm btn-outline-primary mt-2" onclick="chartModule.refreshServiceChart()">
                        <i class="fas fa-sync-alt me-1"></i>Réessayer
                    </button>
                </div>`;
            overlay.style.display = 'flex';
        }
        chartConfig.initStatus.serviceInitializing = false;
        return false;
    }
}

/**
 * Détermine la couleur pour un thème
 */
function getThemeColor(themeName) {
    if (!themeName) return '#6c757d';
    
    if (themeName.includes('Teams') && themeName.includes('Communiquer')) {
        return chartConfig.colors.teams;
    } else if (themeName.includes('Teams') && themeName.includes('Collaborer')) {
        return '#00A2ED';
    } else if (themeName.includes('Planner') || themeName.includes('tâches')) {
        return chartConfig.colors.planner;
    } else if (themeName.includes('OneDrive') || themeName.includes('fichiers')) {
        return chartConfig.colors.onedrive;
    } else if (themeName.includes('SharePoint')) {
        return chartConfig.colors.sharepoint;
    }
    return '#6c757d';
}

/**
 * Détermine la couleur pour un service
 */
function getServiceColor(serviceName) {
    if (!serviceName) return '#6c757d';
    
    const name = serviceName.toLowerCase();
    if (name.includes('qualité') || name.includes('qualite')) return chartConfig.colors.services.qualite;
    if (name.includes('commerce')) return chartConfig.colors.services.commerce;
    if (name.includes('informatique')) return chartConfig.colors.services.informatique;
    if (name.includes('rh')) return chartConfig.colors.services.rh;
    if (name.includes('marketing')) return chartConfig.colors.services.marketing;
    if (name.includes('comptabilité') || name.includes('comptabilite')) return chartConfig.colors.services.comptabilite;
    if (name.includes('florensud')) return chartConfig.colors.services.florensud;
    return '#6c757d';
}

/**
 * Gestion des overlays
 */
function toggleChartOverlay(id, show, message = '') {
    const overlay = document.getElementById(id);
    if (!overlay) return;
    
    if (show) {
        overlay.style.display = 'flex';
    } else if (message) {
        overlay.innerHTML = `<div class="text-center"><i class="fas fa-exclamation-circle text-danger mb-2"></i><p class="text-muted mb-0">${message}</p></div>`;
        overlay.style.display = 'flex';
    } else {
        overlay.style.display = 'none';
    }
}

/**
 * Nettoyage de toutes les instances de graphiques
 */
function cleanupCharts() {
    // Nettoyer le graphique thème
    try {
        const themeCanvas = document.getElementById('themeChart');
        if (themeCanvas) {
            const themeChartExisting = Chart.getChart(themeCanvas);
            if (themeChartExisting) {
                themeChartExisting.destroy();
                console.log("Graphique thème détruit");
            }
        }
    } catch (e) {
        console.warn("Erreur lors du nettoyage du graphique thème:", e);
    }
    
    // Nettoyer le graphique service
    try {
        const serviceCanvas = document.getElementById('serviceChart');
        if (serviceCanvas) {
            const serviceChartExisting = Chart.getChart(serviceCanvas);
            if (serviceChartExisting) {
                serviceChartExisting.destroy();
                console.log("Graphique service détruit");
            }
        }
    } catch (e) {
        console.warn("Erreur lors du nettoyage du graphique service:", e);
    }
    
    // Réinitialiser les variables
    themeChartInstance = null;
    serviceChartInstance = null;
}

// Exposer les fonctions pour utilisation externe
window.chartModule = {
    initialize: initializeCharts,
    refreshThemeChart: initThemeChart,
    refreshServiceChart: initServiceChart,
    cleanup: cleanupCharts
};

// Événement lors du chargement du DOM pour éviter les initialisations multiples
const initChartsOnLoad = () => {
    // Vérifier si Chart.js est chargé
    if (typeof Chart === 'undefined') {
        console.error("Chart.js n'est pas chargé !");
        const themeOverlay = document.getElementById('theme-chart-overlay');
        const serviceOverlay = document.getElementById('service-chart-overlay');
        
        if(themeOverlay) themeOverlay.innerHTML = '<p class="text-danger small p-2">Erreur: Chart.js manquant.</p>';
        if(serviceOverlay) serviceOverlay.innerHTML = '<p class="text-danger small p-2">Erreur: Chart.js manquant.</p>';
        return;
    }
    
    // Initialiser après un court délai pour éviter les conflits
    setTimeout(initializeCharts, 500);
};

// S'assurer que l'événement n'est pas enregistré plusieurs fois
document.removeEventListener('DOMContentLoaded', initChartsOnLoad);
document.addEventListener('DOMContentLoaded', initChartsOnLoad);

// Nettoyage des graphiques avant la fermeture de la page
window.addEventListener('beforeunload', cleanupCharts);