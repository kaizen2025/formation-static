/**
 * Dashboard Core JavaScript - Formation Application
 * Version améliorée avec gestion des erreurs et des graphiques
 */

// Variables globales pour les graphiques
let themeChart = null;
let serviceChart = null;

/**
 * Fonction principale d'initialisation du dashboard
 */
document.addEventListener('DOMContentLoaded', function() {
    console.log("Dashboard Core initialized");
    
    // Initialisation des graphiques
    initializeCharts();
    
    // Chargement des activités récentes
    loadRecentActivities();
    
    // Gestionnaire pour le bouton d'actualisation
    const refreshButton = document.querySelector('.btn-actualiser');
    if (refreshButton) {
        refreshButton.addEventListener('click', function(e) {
            e.preventDefault();
            console.log("Actualisation du dashboard...");
            refreshDashboard();
        });
    }
    
    // Gestionnaire pour les onglets
    const tabs = document.querySelectorAll('[data-toggle="tab"]');
    if (tabs) {
        tabs.forEach(tab => {
            tab.addEventListener('shown.bs.tab', function(e) {
                // Redimensionner les graphiques si nécessaire
                if (themeChart) themeChart.resize();
                if (serviceChart) serviceChart.resize();
            });
        });
    }
});

/**
 * Initialise tous les graphiques du dashboard
 */
function initializeCharts() {
    console.log("Initialisation des graphiques...");
    
    // Graphique de répartition par thème
    initThemeChart();
    
    // Graphique de distribution par service
    initServiceChart();
}

/**
 * Initialise le graphique de répartition par thème
 */
function initThemeChart() {
    console.log("Initialisation du graphique par thème...");
    const container = document.getElementById('theme-chart-container');
    
    if (!container) {
        console.warn("Conteneur de graphique par thème non trouvé");
        return;
    }
    
    // Afficher un indicateur de chargement
    container.innerHTML = `
        <div class="d-flex justify-content-center align-items-center" style="height: 300px;">
            <div class="spinner-border text-primary" role="status">
                <span class="visually-hidden">Chargement...</span>
            </div>
        </div>
    `;
    
    // Récupérer les données
    fetch('/api/inscriptions-par-theme')
        .then(response => {
            if (!response.ok) {
                throw new Error(`Erreur HTTP: ${response.status}`);
            }
            return response.json();
        })
        .then(data => {
            // Vérifier si des données sont disponibles
            if (!data || data.length === 0 || (data.error && data.error.length > 0)) {
                container.innerHTML = `
                    <div class="alert alert-info text-center" role="alert">
                        <i class="fas fa-info-circle me-2"></i> Aucune donnée disponible pour ce graphique
                    </div>
                `;
                return;
            }
            
            // Recréer le canvas pour le graphique
            container.innerHTML = '<canvas id="theme-chart" height="300"></canvas>';
            const ctx = document.getElementById('theme-chart').getContext('2d');
            
            // Créer le graphique
            renderThemeChart(ctx, data);
        })
        .catch(error => {
            console.error("Erreur lors du chargement des données de thème:", error);
            container.innerHTML = `
                <div class="alert alert-danger text-center" role="alert">
                    <i class="fas fa-exclamation-triangle me-2"></i> Erreur lors du chargement des données
                    <br><small>${error.message}</small>
                </div>
            `;
        });
}

/**
 * Rend le graphique de répartition par thème
 */
function renderThemeChart(ctx, data) {
    // Préparation des données
    const labels = data.map(item => item.theme);
    const counts = data.map(item => item.count);
    const colors = generateColorPalette(data.length);
    
    // Détruire le graphique existant s'il y en a un
    if (themeChart) {
        themeChart.destroy();
    }
    
    // Créer le nouveau graphique
    themeChart = new Chart(ctx, {
        type: 'pie',
        data: {
            labels: labels,
            datasets: [{
                data: counts,
                backgroundColor: colors,
                borderColor: colors.map(color => adjustColorBrightness(color, -20)),
                borderWidth: 1,
                hoverOffset: 15
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: {
                    position: 'right',
                    labels: {
                        boxWidth: 15,
                        padding: 15
                    }
                },
                tooltip: {
                    callbacks: {
                        label: function(context) {
                            const label = context.label || '';
                            const value = context.raw || 0;
                            const total = context.chart.data.datasets[0].data.reduce((a, b) => a + b, 0);
                            const percentage = Math.round((value / total) * 100);
                            return `${label}: ${value} (${percentage}%)`;
                        }
                    }
                }
            }
        }
    });
    
    console.log("Graphique par thème créé avec succès");
}

/**
 * Initialise le graphique de distribution par service
 */
function initServiceChart() {
    console.log("Initialisation du graphique par service...");
    const container = document.getElementById('service-chart-container');
    
    if (!container) {
        console.warn("Conteneur de graphique par service non trouvé");
        return;
    }
    
    // Afficher un indicateur de chargement
    container.innerHTML = `
        <div class="d-flex justify-content-center align-items-center" style="height: 300px;">
            <div class="spinner-border text-primary" role="status">
                <span class="visually-hidden">Chargement...</span>
            </div>
        </div>
    `;
    
    // Récupérer les données
    fetch('/api/participants-par-service')
        .then(response => {
            if (!response.ok) {
                throw new Error(`Erreur HTTP: ${response.status}`);
            }
            return response.json();
        })
        .then(data => {
            // Vérifier si des données sont disponibles
            if (!data || data.length === 0 || (data.error && data.error.length > 0)) {
                container.innerHTML = `
                    <div class="alert alert-info text-center" role="alert">
                        <i class="fas fa-info-circle me-2"></i> Aucune donnée disponible pour ce graphique
                    </div>
                `;
                return;
            }
            
            // Recréer le canvas pour le graphique
            container.innerHTML = '<canvas id="service-chart" height="300"></canvas>';
            const ctx = document.getElementById('service-chart').getContext('2d');
            
            // Créer le graphique
            renderServiceChart(ctx, data);
        })
        .catch(error => {
            console.error("Erreur lors du chargement des données de service:", error);
            container.innerHTML = `
                <div class="alert alert-danger text-center" role="alert">
                    <i class="fas fa-exclamation-triangle me-2"></i> Erreur lors du chargement des données
                    <br><small>${error.message}</small>
                </div>
            `;
        });
}

/**
 * Rend le graphique de distribution par service
 */
function renderServiceChart(ctx, data) {
    // Trier les données par nombre de participants (ordre décroissant)
    data.sort((a, b) => b.count - a.count);
    
    // Préparation des données
    const labels = data.map(item => item.service);
    const counts = data.map(item => item.count);
    const colors = generateColorPalette(data.length, 'blue');
    
    // Détruire le graphique existant s'il y en a un
    if (serviceChart) {
        serviceChart.destroy();
    }
    
    // Créer le nouveau graphique
    serviceChart = new Chart(ctx, {
        type: 'bar',
        data: {
            labels: labels,
            datasets: [{
                label: 'Nombre de participants',
                data: counts,
                backgroundColor: colors,
                borderColor: colors.map(color => adjustColorBrightness(color, -20)),
                borderWidth: 1,
                borderRadius: 5,
                maxBarThickness: 50
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            scales: {
                y: {
                    beginAtZero: true,
                    ticks: {
                        precision: 0
                    }
                },
                x: {
                    ticks: {
                        autoSkip: false,
                        maxRotation: 45,
                        minRotation: 45
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
                            return `${context.raw} participant(s)`;
                        }
                    }
                }
            }
        }
    });
    
    console.log("Graphique par service créé avec succès");
}

/**
 * Charge les activités récentes
 */
function loadRecentActivities() {
    console.log("Chargement des activités récentes...");
    const container = document.getElementById('activities-container');
    
    if (!container) {
        console.warn("Conteneur d'activités récentes non trouvé");
        return;
    }
    
    // Afficher un indicateur de chargement
    container.innerHTML = `
        <div class="text-center p-4">
            <div class="spinner-border text-primary" role="status">
                <span class="visually-hidden">Chargement des activités...</span>
            </div>
            <p class="mt-2">Chargement des activités...</p>
        </div>
    `;
    
    // Récupérer les données
    fetch('/api/activites-recentes')
        .then(response => {
            if (!response.ok) {
                throw new Error(`Erreur HTTP: ${response.status}`);
            }
            return response.json();
        })
        .then(data => {
            // Vérifier si des données sont disponibles
            if (!data || data.length === 0 || (data.error && data.error.length > 0)) {
                container.innerHTML = `
                    <div class="alert alert-info text-center" role="alert">
                        <i class="fas fa-info-circle me-2"></i> Aucune activité récente
                    </div>
                `;
                return;
            }
            
            // Créer la liste des activités
            renderActivitiesList(container, data);
        })
        .catch(error => {
            console.error("Erreur lors du chargement des activités récentes:", error);
            container.innerHTML = `
                <div class="alert alert-danger text-center" role="alert">
                    <i class="fas fa-exclamation-triangle me-2"></i> Erreur lors du chargement des activités
                    <br><small>${error.message}</small>
                </div>
            `;
        });
}

/**
 * Rend la liste des activités récentes
 */
function renderActivitiesList(container, activities) {
    let html = '<div class="list-group">';
    
    activities.forEach(activity => {
        const date = new Date(activity.timestamp);
        const formattedDate = date.toLocaleDateString('fr-FR', {
            day: '2-digit',
            month: '2-digit',
            year: 'numeric',
            hour: '2-digit',
            minute: '2-digit'
        });
        
        let entityBadge = '';
        if (activity.entity) {
            entityBadge = `<span class="badge bg-primary">${activity.entity}</span>`;
        }
        
        html += `
            <div class="list-group-item list-group-item-action">
                <div class="d-flex justify-content-between align-items-center">
                    <div>
                        <strong>${activity.user}</strong> ${activity.action}
                        <div class="text-muted small">${formattedDate}</div>
                    </div>
                    ${entityBadge}
                </div>
            </div>
        `;
    });
    
    html += '</div>';
    container.innerHTML = html;
    console.log("Liste des activités rendue avec succès");
}

/**
 * Actualise le dashboard complet
 */
function refreshDashboard() {
    // Réinitialiser les graphiques
    initializeCharts();
    
    // Recharger les activités
    loadRecentActivities();
    
    // Feedback visuel de l'actualisation
    const refreshButton = document.querySelector('.btn-actualiser');
    if (refreshButton) {
        refreshButton.classList.add('disabled');
        refreshButton.innerHTML = '<i class="fas fa-sync-alt fa-spin"></i> Actualisation...';
        
        setTimeout(() => {
            refreshButton.classList.remove('disabled');
            refreshButton.innerHTML = '<i class="fas fa-sync-alt"></i> Actualiser';
        }, 1000);
    }
}

/**
 * Génère une palette de couleurs pour les graphiques
 */
function generateColorPalette(count, baseColor = 'rainbow') {
    const colors = [];
    
    if (baseColor === 'rainbow') {
        // Palette arc-en-ciel
        const baseColors = [
            '#4e73df', // bleu primaire
            '#1cc88a', // vert
            '#36b9cc', // cyan
            '#f6c23e', // jaune
            '#e74a3b', // rouge
            '#6f42c1', // violet
            '#fd7e14', // orange
            '#20c9a6', // turquoise
            '#858796', // gris
            '#5a5c69'  // gris foncé
        ];
        
        for (let i = 0; i < count; i++) {
            colors.push(baseColors[i % baseColors.length]);
        }
    } else if (baseColor === 'blue') {
        // Nuances de bleu
        for (let i = 0; i < count; i++) {
            const hue = 210; // bleu
            const saturation = 70;
            const lightness = 70 - (i * 30 / count);
            colors.push(`hsl(${hue}, ${saturation}%, ${lightness}%)`);
        }
    } else {
        // Nuances d'une couleur de base
        for (let i = 0; i < count; i++) {
            const hue = baseColor === 'green' ? 120 : (baseColor === 'red' ? 0 : 210);
            const saturation = 70;
            const lightness = 70 - (i * 30 / count);
            colors.push(`hsl(${hue}, ${saturation}%, ${lightness}%)`);
        }
    }
    
    return colors;
}

/**
 * Ajuste la luminosité d'une couleur
 */
function adjustColorBrightness(color, percent) {
    let R = parseInt(color.substring(1, 3), 16);
    let G = parseInt(color.substring(3, 5), 16);
    let B = parseInt(color.substring(5, 7), 16);

    R = parseInt(R * (100 + percent) / 100);
    G = parseInt(G * (100 + percent) / 100);
    B = parseInt(B * (100 + percent) / 100);

    R = (R < 255) ? R : 255;
    G = (G < 255) ? G : 255;
    B = (B < 255) ? B : 255;

    R = Math.max(0, R).toString(16);
    G = Math.max(0, G).toString(16);
    B = Math.max(0, B).toString(16);

    const RR = (R.length === 1) ? `0${R}` : R;
    const GG = (G.length === 1) ? `0${G}` : G;
    const BB = (B.length === 1) ? `0${B}` : B;

    return `#${RR}${GG}${BB}`;
}

/**
 * Définit une nouvelle taille pour les graphiques
 * Utile lors d'un changement de taille de fenêtre
 */
window.addEventListener('resize', function() {
    if (themeChart) themeChart.resize();
    if (serviceChart) serviceChart.resize();
});
