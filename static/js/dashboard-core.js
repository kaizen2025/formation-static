// static/js/dashboard-core.js (v2.3.0) - Version améliorée

// --- Configuration ---
const defaultConfig = {
    debugMode: false,
    autoRefreshInterval: 60000,
    minRefreshDelay: 15000,
    debounceDelay: 500,
    baseApiUrl: '/api', // Chemin relatif par défaut pour l'API
    fetchTimeoutDuration: 20000,
    maxErrorsBeforeThrottle: 3,
    errorThrottleDelay: 60000,
    useSimulatedDataOnError: true,
    pollingEnabled: true,
    activeMode: 'polling',
    themeColors: {
        // Les couleurs par défaut seront surchargées par window.dashboardConfig
        'default': '#6c757d',
        'primary': '#4e73df',
        'info': '#36b9cc',
        'success': '#1cc88a',
        'warning': '#f6c23e',
        'danger': '#e74a3b'
    },
    serviceColors: {
        // Les couleurs par défaut seront surchargées par window.dashboardConfig
    }
};

// Récupérer baseAppUrl depuis la configuration globale injectée par le template
const baseAppUrlFromWindow = (window.dashboardConfig && typeof window.dashboardConfig.baseAppUrl === 'string') 
                           ? window.dashboardConfig.baseAppUrl 
                           : '';

// Construire l'URL de base de l'API correctement
// S'assure qu'il n'y a pas de double slash et gère le cas où baseAppUrlFromWindow est vide
let effectiveApiUrl = (baseAppUrlFromWindow.endsWith('/') ? baseAppUrlFromWindow.slice(0, -1) : baseAppUrlFromWindow) + 
                      (defaultConfig.baseApiUrl.startsWith('/') ? defaultConfig.baseApiUrl : '/' + defaultConfig.baseApiUrl);

// Si baseAppUrlFromWindow était vide, effectiveApiUrl pourrait commencer par '//' si defaultConfig.baseApiUrl ne commence pas par '/'.
// Assurons-nous qu'il commence toujours par un seul slash s'il n'est pas une URL complète.
if (effectiveApiUrl.startsWith('//')) {
    effectiveApiUrl = effectiveApiUrl.substring(1);
}
if (!effectiveApiUrl.startsWith('/') && !effectiveApiUrl.startsWith('http')) {
    effectiveApiUrl = '/' + effectiveApiUrl;
}

const config = { 
    ...defaultConfig, 
    ...(window.dashboardConfig || {}),
    baseApiUrl: effectiveApiUrl // Surcharger avec l'URL API correctement construite
};

// Si window.dashboardConfig fournit explicitement baseApiUrl, cela le surchargera à nouveau.
// C'est généralement ce qu'on veut si on a une config plus spécifique.
if (window.dashboardConfig && typeof window.dashboardConfig.baseApiUrl === 'string') {
    config.baseApiUrl = window.dashboardConfig.baseApiUrl;
}

if (config.debugMode) {
    console.log('Dashboard Core (v2.3.0): Initializing.');
    console.log('Dashboard Core: Effective Config', config);
}

// --- Variables d'état globales ---
let dashboardState = {
    lastRefresh: null,
    refreshInProgress: false,
    errorCount: 0,
    retryScheduled: false,
    dataCache: {
        sessions: null,
        participants: null,
        stats: null,
        activities: null
    },
    charts: {},
    activePollingIntervalId: null
};

// --- Utilitaires ---
function debounce(func, wait) {
    let timeout;
    return function(...args) {
        const context = this;
        clearTimeout(timeout);
        timeout = setTimeout(() => func.apply(context, args), wait);
    };
}

// --- Utilitaires API ---
async function fetchAPI(endpoint, options = {}) {
    const defaultOptions = {
        method: 'GET',
        headers: {
            'Content-Type': 'application/json',
            'X-Requested-With': 'XMLHttpRequest'
        },
        credentials: 'same-origin',
    };
    
    const finalOptions = { ...defaultOptions, ...options };
    
    // Construire l'URL complète avec le chemin de base de l'API
    const apiPath = endpoint.startsWith('/') ? endpoint : '/' + endpoint;
    const url = config.baseApiUrl + apiPath;
    
    // Ajouter un timeout pour éviter les requêtes qui ne répondent jamais
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), config.fetchTimeoutDuration);
    finalOptions.signal = controller.signal;
    
    try {
        if (config.debugMode) console.log(`Dashboard Core: Fetching ${url}`);
        
        const response = await fetch(url, finalOptions);
        clearTimeout(timeoutId);
        
        if (!response.ok) {
            throw new Error(`API Error: ${response.status} ${response.statusText}`);
        }
        
        return await response.json();
    } catch (error) {
        clearTimeout(timeoutId);
        console.error(`Dashboard Core: API fetch error for ${url}:`, error);
        
        // Gestion des erreurs et retries
        handleApiError(endpoint, error);
        
        throw error;
    }
}

function handleApiError(endpoint, error) {
    dashboardState.errorCount++;
    
    if (dashboardState.errorCount >= config.maxErrorsBeforeThrottle && !dashboardState.retryScheduled) {
        dashboardState.retryScheduled = true;
        console.warn(`Dashboard Core: Throttling API requests for ${config.errorThrottleDelay/1000}s due to multiple errors.`);
        setTimeout(() => {
            dashboardState.errorCount = 0;
            dashboardState.retryScheduled = false;
            refreshDashboard();
        }, config.errorThrottleDelay);
    }
    
    // Utiliser des données simulées en cas d'erreur si cette option est activée
    if (config.useSimulatedDataOnError) {
        console.log(`Dashboard Core: Using simulated data for ${endpoint} due to API error.`);
        return getSimulatedData(endpoint);
    }
}

function getSimulatedData(endpoint) {
    // Génération de données de remplacement simples en cas d'erreur API
    switch(endpoint) {
        case '/dashboard_essential':
            return {
                sessions: [],
                participants: [],
                activites: [{
                    id: 1,
                    type: "Simulation d'activité",
                    description: "Données générées suite à une erreur API",
                    details: null,
                    date_relative: "à l'instant",
                    user: "Système"
                }],
                services: [],
                salles: [],
                timestamp: Date.now(),
                status: 'error'
            };
        case '/sessions?page=1&per_page=5':
            return {
                items: [{
                    id: 1,
                    date: "Aujourd'hui",
                    iso_date: new Date().toISOString().split('T')[0],
                    horaire: "09:00 - 12:00",
                    theme: "Session de remplacement",
                    theme_id: 1,
                    places_restantes: 10,
                    inscrits: 5,
                    max_participants: 15,
                    liste_attente: 0,
                    salle: "Salle virtuelle",
                    salle_id: 1
                }],
                total: 1,
                pages: 1,
                page: 1,
                per_page: 5
            };
        case '/activites?limit=7':
            return [{
                id: 1,
                type: "Simulation d'activité",
                description: "Données générées suite à une erreur API",
                details: null,
                date_relative: "à l'instant",
                user: "Système"
            }];
        default:
            return [];
    }
}

// --- Fonctions de chargement des données ---
async function loadDashboardStats() {
    try {
        // Récupérer les données essentielles du dashboard
        const dashboardData = await fetchAPI('/dashboard_essential');
        
        // Extraire les statistiques
        const stats = {
            sessions_count: dashboardData.sessions.length || 0,
            participants_count: dashboardData.participants.length || 0,
            waiting_count: 0, // À calculer
            completed_sessions: 0 // À calculer
        };
        
        // Calculer le nombre total de personnes en attente
        for (const session of dashboardData.sessions) {
            stats.waiting_count += session.liste_attente_count || 0;
            
            // Compter les sessions complètes (où places_restantes = 0)
            if (session.places_restantes <= 0) {
                stats.completed_sessions++;
            }
        }
        
        dashboardState.dataCache.stats = stats;
        updateDashboardCounters(stats);
        return stats;
    } catch (error) {
        console.error('Error loading dashboard stats:', error);
        // Utiliser des données de secours si nécessaire
        if (config.useSimulatedDataOnError) {
            const fallbackStats = {
                sessions_count: 3,
                participants_count: 15,
                waiting_count: 2,
                completed_sessions: 5
            };
            updateDashboardCounters(fallbackStats);
            return fallbackStats;
        }
    }
}

async function loadUpcomingSessions() {
    try {
        // Utiliser l'API /sessions existante avec pagination
        const sessionsData = await fetchAPI('/sessions?page=1&per_page=5');
        
        // Transformer les données au format attendu par updateSessionsTable
        const sessions = sessionsData.items.map(session => ({
            id: session.id,
            date: session.iso_date,
            heure_debut: session.horaire.split(' - ')[0],
            heure_fin: session.horaire.split(' - ')[1],
            theme: session.theme,
            titre: session.theme, // Utiliser le même titre que le thème
            salle: session.salle || "Non définie",
            places_disponibles: session.places_restantes,
            places_prises: session.inscrits
        }));
        
        dashboardState.dataCache.sessions = sessions;
        updateSessionsTable(sessions);
        return sessions;
    } catch (error) {
        console.error('Error loading upcoming sessions:', error);
        if (config.useSimulatedDataOnError) {
            const fallbackSessions = getSimulatedData('/sessions?page=1&per_page=5').items.map(session => ({
                id: session.id,
                date: session.iso_date,
                heure_debut: session.horaire.split(' - ')[0],
                heure_fin: session.horaire.split(' - ')[1],
                theme: session.theme,
                titre: session.theme,
                salle: session.salle || "Non définie",
                places_disponibles: session.places_restantes,
                places_prises: session.inscrits
            }));
            updateSessionsTable(fallbackSessions);
            return fallbackSessions;
        }
    }
}

async function loadThemeDistribution() {
    try {
        // Récupérer les données essentielles du dashboard qui contiennent les sessions
        const dashboardData = await fetchAPI('/dashboard_essential');
        
        // Créer un dictionnaire pour compter les sessions par thème
        const themeCounts = {};
        const themeColors = {};
        
        // Extraire et compter les thèmes à partir des sessions
        dashboardData.sessions.forEach(session => {
            if (session.theme && session.theme_id) {
                if (!themeCounts[session.theme]) {
                    themeCounts[session.theme] = 0;
                    // Assigner des couleurs par défaut pour les thèmes
                    const themeColors = {
                        'Communiquer avec Teams': '#4e73df',
                        'Collaborer avec Teams': '#1cc88a',
                        'Gérer les tâches (Planner)': '#f6c23e',
                        'Gérer mes fichiers (OneDrive/SharePoint)': '#36b9cc'
                    };
                    themeColors[session.theme] = themeColors[session.theme] || 
                                               config.themeColors[Object.keys(themeCounts).length % Object.keys(config.themeColors).length] || 
                                               '#6c757d';
                }
                themeCounts[session.theme]++;
            }
        });
        
        // Convertir en format attendu par updateThemeChart
        const themeData = Object.keys(themeCounts).map(theme => ({
            theme: theme,
            count: themeCounts[theme],
            color: themeColors[theme] || '#6c757d'
        }));
        
        updateThemeChart(themeData);
        return themeData;
    } catch (error) {
        console.error('Error loading theme distribution:', error);
        // Données de remplacement pour le graphique
        const fallbackThemeData = [
            { theme: "Excel", count: 5, color: "#4CAF50" },
            { theme: "Word", count: 3, color: "#2196F3" },
            { theme: "PowerPoint", count: 2, color: "#FFC107" }
        ];
        updateThemeChart(fallbackThemeData);
        return fallbackThemeData;
    }
}

async function loadServiceDistribution() {
    try {
        // Récupérer les données essentielles du dashboard
        const dashboardData = await fetchAPI('/dashboard_essential');
        
        // Créer un dictionnaire pour compter les participants par service
        const serviceCounts = {};
        const serviceColors = {};
        
        // Extraire les services à partir des participants
        dashboardData.participants.forEach(participant => {
            if (participant.service) {
                if (!serviceCounts[participant.service]) {
                    serviceCounts[participant.service] = 0;
                    serviceColors[participant.service] = participant.service_color || '#6c757d';
                }
                serviceCounts[participant.service]++;
            }
        });
        
        // Convertir en format attendu par updateServiceChart
        const serviceData = Object.keys(serviceCounts).map(service => ({
            service: service,
            count: serviceCounts[service],
            color: serviceColors[service]
        }));
        
        // Trier par nombre décroissant
        serviceData.sort((a, b) => b.count - a.count);
        
        updateServiceChart(serviceData);
        return serviceData;
    } catch (error) {
        console.error('Error loading service distribution:', error);
        // Données de remplacement pour le graphique
        const fallbackServiceData = [
            { service: "Informatique", count: 7, color: "#9C27B0" },
            { service: "Comptabilité", count: 4, color: "#FF5722" },
            { service: "RH", count: 3, color: "#607D8B" }
        ];
        updateServiceChart(fallbackServiceData);
        return fallbackServiceData;
    }
}

async function loadRecentActivities() {
    try {
        // Utiliser l'API /activites existante avec limitation
        const activities = await fetchAPI('/activites?limit=7');
        
        // Transformer au format attendu par updateActivitiesList si nécessaire
        const formattedActivities = activities.map(activity => ({
            id: activity.id,
            timestamp: activity.date_iso,
            action: activity.type,
            description: activity.description,
            user: activity.user || 'Système'
        }));
        
        dashboardState.dataCache.activities = formattedActivities;
        updateActivitiesList(formattedActivities);
        return formattedActivities;
    } catch (error) {
        console.error('Error loading recent activities:', error);
        if (config.useSimulatedDataOnError) {
            const fallbackActivities = getSimulatedData('/activites?limit=7');
            updateActivitiesList(fallbackActivities);
            return fallbackActivities;
        }
    }
}

// --- Fonctions de mise à jour de l'interface ---
function updateDashboardCounters(stats) {
    if (!stats) return;
    
    // Mettre à jour les compteurs du dashboard
    const counterElements = {
        'sessions_count': document.getElementById('sessions-count'),
        'participants_count': document.getElementById('participants-count'),
        'waiting_count': document.getElementById('waiting-count'),
        'completed_sessions': document.getElementById('completed-sessions-count')
    };
    
    for (const [key, element] of Object.entries(counterElements)) {
        if (element && stats[key] !== undefined) {
            // Animation simple du compteur
            const currentValue = parseInt(element.textContent) || 0;
            const targetValue = stats[key];
            animateCounter(element, currentValue, targetValue);
        }
    }
}

function animateCounter(element, start, end) {
    if (!element) return;
    
    const duration = 1000; // ms
    const stepTime = 50; // ms
    const steps = duration / stepTime;
    const increment = (end - start) / steps;
    let current = start;
    let step = 0;
    
    const timer = setInterval(() => {
        step++;
        current += increment;
        element.textContent = Math.round(current);
        
        if (step >= steps) {
            clearInterval(timer);
            element.textContent = end;
        }
    }, stepTime);
}

function updateSessionsTable(sessions) {
    const tableBody = document.getElementById('upcoming-sessions-tbody');
    if (!tableBody) return;
    
    // Supprimer le spinner de chargement s'il existe
    const loadingRow = document.getElementById('sessions-loading-row');
    if (loadingRow) {
        loadingRow.remove();
    }
    
    if (!sessions || sessions.length === 0) {
        tableBody.innerHTML = `
            <tr>
                <td colspan="5" class="text-center py-4">
                    <i class="fas fa-info-circle me-2 text-info"></i>
                    Aucune session à venir n'est programmée pour le moment.
                </td>
            </tr>
        `;
        return;
    }
    
    // Trier les sessions par date/heure
    const sortedSessions = [...sessions].sort((a, b) => {
        // Comparer d'abord par date
        const dateA = new Date(a.date);
        const dateB = new Date(b.date);
        if (dateA < dateB) return -1;
        if (dateA > dateB) return 1;
        
        // Si même date, comparer par heure
        return a.heure_debut.localeCompare(b.heure_debut);
    });
    
    // Mettre à jour le tableau avec les nouvelles données
    tableBody.innerHTML = sortedSessions.map(session => {
        const sessionDate = new Date(session.date);
        const formattedDate = sessionDate.toLocaleDateString('fr-FR', { 
            weekday: 'long', 
            day: 'numeric', 
            month: 'long' 
        });
        
        // Déterminer la classe pour le badge de places
        let badgeClass = 'bg-success';
        if (session.places_disponibles <= 0) {
            badgeClass = 'bg-danger';
        } else if (session.places_disponibles <= 3) {
            badgeClass = 'bg-warning text-dark';
        }
        
        return `
            <tr data-session-id="${session.id}">
                <td>
                    <div class="fw-bold">${formattedDate}</div>
                    <div class="small text-muted">${session.heure_debut} - ${session.heure_fin}</div>
                </td>
                <td>
                    <span class="fw-semibold">${session.titre || session.theme}</span>
                    ${session.titre && session.theme && session.titre !== session.theme ? `<div class="small text-muted">${session.theme}</div>` : ''}
                </td>
                <td>${session.salle || '-'}</td>
                <td>
                    <span class="badge ${badgeClass}">
                        ${session.places_prises}/${session.places_prises + session.places_disponibles}
                    </span>
                </td>
                <td>
                    <a href="/sessions/${session.id}" class="btn btn-sm btn-outline-primary">
                        <i class="fas fa-eye"></i>
                    </a>
                </td>
            </tr>
        `;
    }).join('');
    
    // Ajouter des événements aux lignes du tableau si nécessaire
    initializeSessionRowEvents();
}

function initializeSessionRowEvents() {
    // Exemple: rendre les lignes cliquables pour naviguer vers la page de détail
    document.querySelectorAll('#upcoming-sessions-tbody tr').forEach(row => {
        row.addEventListener('click', (event) => {
            // Ne pas déclencher si on a cliqué sur le bouton
            if (event.target.closest('.btn') || event.target.closest('a')) {
                return;
            }
            
            const sessionId = row.dataset.sessionId;
            if (sessionId) {
                window.location.href = `/sessions/${sessionId}`;
            }
        });
        
        // Ajouter une classe pour indiquer que la ligne est cliquable
        row.classList.add('clickable-row');
    });
}

function formatDateTime(isoString) {
    if (!isoString) return '';
    
    try {
        const date = new Date(isoString);
        
        // Formatage de la date en français
        const dateOptions = { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' };
        const nowDate = new Date();
        
        // Si c'est aujourd'hui, montrer seulement l'heure
        if (date.toDateString() === nowDate.toDateString()) {
            return `aujourd'hui à ${date.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}`;
        }
        
        // Si c'est hier, afficher "hier à HH:MM"
        const yesterday = new Date(nowDate);
        yesterday.setDate(nowDate.getDate() - 1);
        if (date.toDateString() === yesterday.toDateString()) {
            return `hier à ${date.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}`;
        }
        
        // Sinon, afficher la date complète
        return date.toLocaleDateString('fr-FR', dateOptions);
    } catch (e) {
        console.error('Error formatting date:', e);
        return isoString;
    }
}

function updateActivitiesList(activities) {
    const activityList = document.getElementById('recent-activity-list');
    if (!activityList) return;
    
    // Supprimer le spinner de chargement s'il existe
    const loadingItem = document.getElementById('activity-loading-spinner');
    if (loadingItem) {
        loadingItem.remove();
    }
    
    if (!activities || activities.length === 0) {
        activityList.innerHTML = `
            <li class="list-group-item text-center py-4">
                <i class="fas fa-info-circle me-2 text-info"></i>
                Aucune activité récente à afficher.
            </li>
        `;
        return;
    }
    
    // Limiter à max 5 activités les plus récentes
    const recentActivities = activities.slice(0, 5);
    
    // Mettre à jour la liste avec les nouvelles données
    activityList.innerHTML = recentActivities.map(activity => {
        // Déterminer l'icône basée sur l'action
        let icon = 'fa-circle-check';
        let iconClass = 'text-success';
        
        if (activity.action && activity.action.includes('supprim') || activity.type && activity.type.includes('supprim')) {
            icon = 'fa-trash';
            iconClass = 'text-danger';
        } else if (activity.action && activity.action.includes('modifi') || activity.type && activity.type.includes('modifi')) {
            icon = 'fa-pen-to-square';
            iconClass = 'text-primary';
        } else if (activity.action && activity.action.includes('connect') || activity.type && activity.type.includes('connect')) {
            icon = 'fa-sign-in-alt';
            iconClass = 'text-info';
        } else if (activity.action && activity.action.includes('inscri') || activity.type && activity.type.includes('inscri')) {
            icon = 'fa-user-plus';
            iconClass = 'text-success';
        } else if (activity.action && activity.action.includes('désinscri') || activity.type && activity.type.includes('désinscri')) {
            icon = 'fa-user-minus';
            iconClass = 'text-warning';
        }
        
        return `
            <li class="list-group-item border-start-0 border-end-0 py-3">
                <div class="d-flex">
                    <div class="me-3">
                        <i class="fas ${icon} ${iconClass}"></i>
                    </div>
                    <div class="activity-content">
                        <div class="mb-1">${activity.description}</div>
                        <div class="d-flex justify-content-between align-items-center">
                            <small class="text-muted">${activity.user || 'Système'}</small>
                            <small class="text-muted">${
                                activity.date_relative || 
                                formatDateTime(activity.timestamp)
                            }</small>
                        </div>
                    </div>
                </div>
            </li>
        `;
    }).join('');
}

function updateThemeChart(data) {
    const chartCanvas = document.getElementById('theme-distribution-chart');
    if (!chartCanvas) return;
    
    // Détruire le graphique existant s'il y en a un
    if (dashboardState.charts.themeChart) {
        dashboardState.charts.themeChart.destroy();
    }
    
    if (!data || data.length === 0) {
        // Afficher un message si pas de données
        const ctx = chartCanvas.getContext('2d');
        ctx.clearRect(0, 0, chartCanvas.width, chartCanvas.height);
        ctx.font = '14px Arial';
        ctx.textAlign = 'center';
        ctx.fillText('Aucune donnée disponible', chartCanvas.width / 2, chartCanvas.height / 2);
        return;
    }
    
    // Préparer les données pour le graphique
    const labels = data.map(item => item.theme);
    const values = data.map(item => item.count);
    
    // Utiliser les couleurs fournies par l'API ou les couleurs par défaut
    const colors = data.map((item, index) => {
        if (item.color) return item.color;
        // Utiliser les couleurs de thème de la configuration ou des couleurs par défaut
        const themeColors = Object.values(config.themeColors || defaultConfig.themeColors);
        return themeColors[index % themeColors.length];
    });
    
    // Créer le graphique
    dashboardState.charts.themeChart = new Chart(chartCanvas, {
        type: 'doughnut',
        data: {
            labels: labels,
            datasets: [{
                data: values,
                backgroundColor: colors,
                hoverOffset: 4,
                borderWidth: 1,
                borderColor: 'rgba(255, 255, 255, 0.8)'
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            cutout: '70%',
            plugins: {
                legend: {
                    position: 'bottom',
                    labels: {
                        padding: 10,
                        usePointStyle: true,
                        pointStyle: 'circle'
                    }
                },
                tooltip: {
                    callbacks: {
                        label: function(context) {
                            const value = context.raw;
                            const total = context.dataset.data.reduce((sum, val) => sum + val, 0);
                            const percentage = Math.round((value / total) * 100);
                            return `${context.label}: ${value} (${percentage}%)`;
                        }
                    }
                }
            },
            animation: {
                animateRotate: true,
                animateScale: true
            }
        }
    });
}

function updateServiceChart(data) {
    const chartCanvas = document.getElementById('service-distribution-chart');
    if (!chartCanvas) return;
    
    // Détruire le graphique existant s'il y en a un
    if (dashboardState.charts.serviceChart) {
        dashboardState.charts.serviceChart.destroy();
    }
    
    if (!data || data.length === 0) {
        // Afficher un message si pas de données
        const ctx = chartCanvas.getContext('2d');
        ctx.clearRect(0, 0, chartCanvas.width, chartCanvas.height);
        ctx.font = '14px Arial';
        ctx.textAlign = 'center';
        ctx.fillText('Aucune donnée disponible', chartCanvas.width / 2, chartCanvas.height / 2);
        return;
    }
    
    // Préparer les données pour le graphique
    const labels = data.map(item => item.service);
    const values = data.map(item => item.count);
    
    // Utiliser les couleurs fournies ou les couleurs par défaut
    const colors = data.map((item, index) => {
        if (item.color) return item.color;
        // Utiliser les couleurs de service de la configuration ou des couleurs par défaut
        const serviceColors = Object.values(config.serviceColors || defaultConfig.themeColors);
        return serviceColors[index % serviceColors.length];
    });
    
    // Créer le graphique
    dashboardState.charts.serviceChart = new Chart(chartCanvas, {
        type: 'bar',
        data: {
            labels: labels,
            datasets: [{
                label: 'Participants',
                data: values,
                backgroundColor: colors,
                borderWidth: 1,
                borderColor: 'rgba(255, 255, 255, 0.5)',
                borderRadius: 4
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            indexAxis: 'y',
            plugins: {
                legend: {
                    display: false
                },
                tooltip: {
                    callbacks: {
                        label: function(context) {
                            const value = context.raw;
                            return `${value} participant${value > 1 ? 's' : ''}`;
                        }
                    }
                }
            },
            scales: {
                x: {
                    beginAtZero: true,
                    ticks: {
                        precision: 0
                    }
                }
            },
            animation: {
                animateScale: true
            }
        }
    });
}

// --- Fonction de rafraîchissement global ---
async function refreshDashboard() {
    if (dashboardState.refreshInProgress) return;
    
    dashboardState.refreshInProgress = true;
    
    try {
        if (config.debugMode) console.log('Dashboard Core: Refreshing dashboard data...');
        
        // Charger toutes les données en parallèle
        await Promise.all([
            loadDashboardStats(),
            loadUpcomingSessions(),
            loadThemeDistribution(),
            loadServiceDistribution(),
            loadRecentActivities()
        ]);
        
        // Mettre à jour la date du dernier rafraîchissement
        dashboardState.lastRefresh = new Date();
        updateLastRefreshTime();
        
        // Réinitialiser le compteur d'erreurs si tout s'est bien passé
        dashboardState.errorCount = 0;
    } catch (error) {
        console.error('Error refreshing dashboard:', error);
    } finally {
        dashboardState.refreshInProgress = false;
    }
}

function updateLastRefreshTime() {
    const refreshTimeElement = document.getElementById('last-refresh-time');
    if (refreshTimeElement && dashboardState.lastRefresh) {
        const formattedTime = dashboardState.lastRefresh.toLocaleTimeString('fr-FR', { 
            hour: '2-digit', 
            minute: '2-digit',
            second: '2-digit'
        });
        refreshTimeElement.textContent = formattedTime;
    }
}

// --- Gestionnaire de polling et de mise à jour auto ---
function startPolling() {
    if (!config.pollingEnabled) return;
    
    if (dashboardState.activePollingIntervalId) {
        clearInterval(dashboardState.activePollingIntervalId);
    }
    
    dashboardState.activePollingIntervalId = setInterval(() => {
        if (!document.hidden && !dashboardState.refreshInProgress) {
            refreshDashboard();
        }
    }, config.autoRefreshInterval);
    
    // Mettre à jour l'indicateur de mode actif
    const pollingIndicator = document.getElementById('polling-indicator');
    if (pollingIndicator) {
        pollingIndicator.classList.remove('d-none');
    }
    
    config.activeMode = 'polling';
    
    if (config.debugMode) console.log(`Dashboard Core: Started polling every ${config.autoRefreshInterval/1000}s`);
}

function stopPolling() {
    if (dashboardState.activePollingIntervalId) {
        clearInterval(dashboardState.activePollingIntervalId);
        dashboardState.activePollingIntervalId = null;
    }
    
    // Mettre à jour l'indicateur de mode actif
    const pollingIndicator = document.getElementById('polling-indicator');
    if (pollingIndicator) {
        pollingIndicator.classList.add('d-none');
    }
    
    config.activeMode = 'manual';
    
    if (config.debugMode) console.log('Dashboard Core: Stopped polling');
}

function togglePolling() {
    if (config.activeMode === 'polling') {
        stopPolling();
    } else {
        startPolling();
    }
}

// --- Initialisation ---
function initializeDashboard() {
    // Charger les données initiales
    refreshDashboard();
    
    // Démarrer le polling si activé
    if (config.pollingEnabled) {
        startPolling();
    }
    
    // Ajouter un gestionnaire pour le bouton de rafraîchissement manuel
    const refreshButton = document.getElementById('refresh-dashboard-btn');
    if (refreshButton) {
        refreshButton.addEventListener('click', function() {
            // Ne pas autoriser les rafraîchissements trop fréquents
            const now = new Date();
            const timeSinceLastRefresh = dashboardState.lastRefresh 
                ? now - dashboardState.lastRefresh 
                : config.minRefreshDelay + 1;
            
            if (timeSinceLastRefresh < config.minRefreshDelay) {
                console.log(`Dashboard Core: Refresh too frequent. Please wait ${Math.ceil((config.minRefreshDelay - timeSinceLastRefresh)/1000)}s.`);
                
                // Animer le bouton pour indiquer qu'il faut attendre
                refreshButton.classList.add('btn-disabled');
                setTimeout(() => {
                    refreshButton.classList.remove('btn-disabled');
                }, 1000);
                
                return;
            }
            
            refreshDashboard();
        });
    }
    
    // Ajouter un gestionnaire pour le bouton de toggle du polling
    const togglePollingButton = document.getElementById('toggle-polling-btn');
    if (togglePollingButton) {
        togglePollingButton.addEventListener('click', togglePolling);
    }
    
    // Écouter les événements de visibilité de la page
    document.addEventListener('visibilitychange', function() {
        if (!document.hidden && config.activeMode === 'polling') {
            // Rafraîchir immédiatement lorsque l'utilisateur revient sur la page
            refreshDashboard();
        }
    });
    
    // Initialiser les filtres pour le tableau des sessions
    initializeSessionFilters();
}

function initializeSessionFilters() {
    const filterInput = document.getElementById('sessions-filter-input');
    if (filterInput) {
        filterInput.addEventListener('input', debounce(function() {
            filterSessionsTable(this.value.toLowerCase());
        }, config.debounceDelay));
    }
}

function filterSessionsTable(query) {
    const tableRows = document.querySelectorAll('#upcoming-sessions-tbody tr');
    if (!tableRows.length) return;
    
    let hasVisibleRows = false;
    
    tableRows.forEach(row => {
        if (!query) {
            row.style.display = '';
            hasVisibleRows = true;
            return;
        }
        
        const text = row.textContent.toLowerCase();
        if (text.includes(query)) {
            row.style.display = '';
            hasVisibleRows = true;
        } else {
            row.style.display = 'none';
        }
    });
    
    // Afficher un message si aucune ligne ne correspond à la recherche
    const noResultsRow = document.getElementById('no-sessions-results');
    if (!hasVisibleRows) {
        if (!noResultsRow) {
            const tbody = document.getElementById('upcoming-sessions-tbody');
            if (tbody) {
                const newRow = document.createElement('tr');
                newRow.id = 'no-sessions-results';
                newRow.innerHTML = `
                    <td colspan="5" class="text-center py-4">
                        <i class="fas fa-search me-2 text-muted"></i>
                        Aucune session ne correspond à votre recherche.
                    </td>
                `;
                tbody.appendChild(newRow);
            }
        }
    } else if (noResultsRow) {
        noResultsRow.remove();
    }
}

// --- Démarrage ---
// Exécuter l'initialisation lorsque le DOM est chargé
document.addEventListener('DOMContentLoaded', function() {
    if (config.debugMode) console.log('Dashboard Core: DOM loaded, initializing dashboard...');
    initializeDashboard();
});

// Exporter l'API publique
window.DashboardCore = {
    config,
    refreshDashboard,
    togglePolling,
    getCurrentState: () => ({ ...dashboardState }),
    getVersion: () => '2.3.0'
};

// Émettre un événement pour signaler que dashboard-core.js est complètement chargé
document.dispatchEvent(new CustomEvent('dashboardCoreFullyReady'));
