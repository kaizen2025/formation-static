/**
 * Formation Microsoft 365 - charts.js (version améliorée)
 * Correction des erreurs de réutilisation de canvas et d'API manquante
 * v1.3.0
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
    }
};

// Stockage des instances de graphiques
let themeChartInstance = null;
let serviceChartInstance = null;

/**
 * Initialise tous les graphiques
 */
async function initializeCharts() {
    console.log('Initialisation des graphiques...');
    
    try {
        // Initialiser en séquence pour éviter les conflits
        await initThemeChart();
        await initServiceChart();
        
        console.log('Tous les graphiques initialisés avec succès');
        return true;
    } catch (error) {
        console.error('Erreur initialisation graphiques:', error);
        return false;
    }
}

/**
 * Initialise le graphique de répartition par thème
 */
async function initThemeChart() {
    try {
        const ctx = document.getElementById('themeChart');
        if (!ctx) return false;

        // Afficher l'overlay de chargement
        toggleChartOverlay('theme-chart-overlay', true);
        
        // IMPORTANT: Détruire l'instance existante pour éviter l'erreur "Canvas is already in use"
        if (themeChartInstance) {
            themeChartInstance.destroy();
            themeChartInstance = null;
        }

        // Récupérer les données via l'API
        const sessionsResponse = await fetch('/api/sessions');
        if (!sessionsResponse.ok) throw new Error(`Erreur API sessions: ${sessionsResponse.status}`);
        const sessions = await sessionsResponse.json();
        
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
        
        toggleChartOverlay('theme-chart-overlay', false);
        return true;
    } catch (error) {
        console.error('Erreur initialisation graphique thème:', error);
        toggleChartOverlay('theme-chart-overlay', false, 'Erreur de chargement');
        return false;
    }
}

/**
 * Initialise le graphique des participants par service
 * CORRECTION: Utilise les données de participants directement sans passer par l'API services
 */
async function initServiceChart() {
    try {
        const ctx = document.getElementById('serviceChart');
        if (!ctx) return false;

        // Afficher l'overlay
        toggleChartOverlay('service-chart-overlay', true);
        
        // IMPORTANT: Détruire l'instance existante
        if (serviceChartInstance) {
            serviceChartInstance.destroy();
            serviceChartInstance = null;
        }

        // Récupérer les données des participants (contient déjà le service_id et le nom du service)
        const participantsResponse = await fetch('/api/participants');
        if (!participantsResponse.ok) throw new Error(`Erreur API participants: ${participantsResponse.status}`);
        const participants = await participantsResponse.json();
        
        // Récupérer les données des sessions pour calculer les inscriptions
        const sessionsResponse = await fetch('/api/sessions');
        if (!sessionsResponse.ok) throw new Error(`Erreur API sessions: ${sessionsResponse.status}`);
        const sessions = await sessionsResponse.json();

        // Calculer les participants uniques et les inscriptions par service
        const serviceMap = {};
        
        // Extraire les services uniques directement des participants
        participants.forEach(participant => {
            const serviceId = participant.service_id;
            const serviceName = participant.service;
            
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
        });
        
        // Calculer les inscriptions par service
        participants.forEach(participant => {
            const inscriptions = participant.inscriptions || 0;
            const serviceId = participant.service_id;
            
            if (serviceMap[serviceId]) {
                serviceMap[serviceId].totalInscriptions += inscriptions;
            }
        });
        
        // Préparer les données pour le graphique
        const servicesData = Object.values(serviceMap)
            .filter(s => s.uniqueParticipants.size > 0)
            .sort((a, b) => a.nom.localeCompare(b.nom));
            
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
        
        toggleChartOverlay('service-chart-overlay', false);
        return true;
    } catch (error) {
        console.error('Erreur initialisation graphique service:', error);
        toggleChartOverlay('service-chart-overlay', false, 'Erreur de chargement');
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
    if (name.includes('qualité') || name.includes('qualite')) return '#F44336';
    if (name.includes('commerce')) return '#FFC107';
    if (name.includes('informatique')) return '#607D8B';
    if (name.includes('rh')) return '#FF9800';
    if (name.includes('marketing')) return '#9C27B0';
    if (name.includes('comptabilité') || name.includes('comptabilite')) return '#2196F3';
    if (name.includes('florensud')) return '#4CAF50';
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

// Exposer les fonctions pour utilisation externe
window.chartModule = {
    initialize: initializeCharts,
    refreshThemeChart: initThemeChart,
    refreshServiceChart: initServiceChart
};

// Attendre que le DOM soit chargé et que Chart.js soit disponible
document.addEventListener('DOMContentLoaded', () => {
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
});