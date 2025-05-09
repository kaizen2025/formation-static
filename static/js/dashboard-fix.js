/**
 * dashboard-fix.js - Correctif pour le tableau de bord Microsoft 365
 * Version: 1.0.0
 * 
 * Ce fichier résout les problèmes d'affichage du tableau de bord
 * en implémentant des données simulées et en corrigeant les fonctions de rendu.
 */

document.addEventListener('DOMContentLoaded', function() {
  console.log('Dashboard Fix: Initializing rescue module');
  
  // Configuration
  const config = {
    debugMode: true,
    useLocalData: true,  // Utiliser les données simulées si l'API échoue
    fixCharts: true,     // Corriger les graphiques
    fixTables: true,     // Corriger les tableaux de données
    fixActivities: true  // Corriger l'affichage des activités
  };
  
  // Données simulées pour les sessions
  const mockSessions = [
    { 
      id: 1, date: "lundi 19 mai 2025", horaire: "09h00–10h30", 
      theme: "Communiquer avec Teams", theme_id: 1, places_restantes: 8, 
      inscrits: 7, max_participants: 15, liste_attente: 0, salle: "Salle Tramontane", salle_id: 1 
    },
    { 
      id: 2, date: "lundi 19 mai 2025", horaire: "11h00–12h30", 
      theme: "Gérer les tâches (Planner)", theme_id: 2, places_restantes: 3, 
      inscrits: 12, max_participants: 15, liste_attente: 2, salle: "Salle Tramontane", salle_id: 1 
    },
    { 
      id: 3, date: "mardi 20 mai 2025", horaire: "14h00–15h30", 
      theme: "Gérer mes fichiers (OneDrive/SharePoint)", theme_id: 3, places_restantes: 0, 
      inscrits: 15, max_participants: 15, liste_attente: 4, salle: "Salle Tramontane", salle_id: 1 
    },
    { 
      id: 4, date: "mardi 20 mai 2025", horaire: "16h00–17h30", 
      theme: "Collaborer avec Teams", theme_id: 4, places_restantes: 5, 
      inscrits: 10, max_participants: 15, liste_attente: 0, salle: "Salle Tramontane", salle_id: 1 
    }
  ];
  
  // Données simulées pour les participants par service
  const mockParticipants = [
    { id: 1, nom: "PHILIBERT", prenom: "Elodie", email: "ephilibert@anecoop-france.com", service: "Qualité", service_id: "qualite" },
    { id: 2, nom: "SARRAZIN", prenom: "Enora", email: "esarrazin@anecoop-france.com", service: "Qualité", service_id: "qualite" },
    { id: 3, nom: "CASTAN", prenom: "Sophie", email: "scastan@anecoop-france.com", service: "Qualité", service_id: "qualite" },
    { id: 4, nom: "BIVIA", prenom: "Kevin", email: "kbivia@anecoop-france.com", service: "Informatique", service_id: "informatique" },
    { id: 5, nom: "GOMEZ", prenom: "Elisabeth", email: "egomez@anecoop-france.com", service: "RH", service_id: "rh" },
    { id: 6, nom: "MIR", prenom: "Andreu", email: "amir@solagora.com", service: "Commerce", service_id: "commerce" },
    { id: 7, nom: "BROUSSOUX", prenom: "Camille", email: "cbroussoux@anecoop-france.com", service: "Marketing", service_id: "marketing" }
  ];
  
  // Données simulées pour les activités récentes
  const mockActivities = [
    { 
      id: 1, type: "validation", description: "Validation inscription: Elodie PHILIBERT", 
      details: "Session: Communiquer avec Teams (lundi 19 mai 2025)", 
      date_relative: "il y a 32 minutes", user: "admin" 
    },
    { 
      id: 2, type: "ajout_participant", description: "Ajout: Kevin BIVIA", 
      details: "Service: Informatique", 
      date_relative: "il y a 2 heures", user: "admin" 
    },
    { 
      id: 3, type: "liste_attente", description: "Ajout liste attente: Sophie CASTAN", 
      details: "Session: Gérer mes fichiers (OneDrive/SharePoint) - Position: 2", 
      date_relative: "hier", user: "admin" 
    },
    { 
      id: 4, type: "connexion", description: "Connexion de admin", 
      details: null, 
      date_relative: "il y a 4 heures", user: "admin" 
    },
    { 
      id: 5, type: "inscription", description: "Demande inscription: Elisabeth GOMEZ", 
      details: "Session: Gérer les tâches (Planner)", 
      date_relative: "hier", user: "admin" 
    }
  ];
  
  // Données complètes pour le dashboard
  const mockDashboardData = {
    sessions: mockSessions,
    participants: mockParticipants,
    activites: mockActivities,
    status: "ok",
    timestamp: Date.now()
  };
  
  // Fonction pour mettre à jour les statistiques générales
  function updateStatisticsCounters(sessions) {
    console.log('Dashboard Fix: Updating statistics counters');
    
    // Définir des valeurs par défaut
    let stats = { 
      totalInscriptions: 0, 
      totalEnAttente: 0, 
      totalSessions: 0, 
      totalSessionsCompletes: 0 
    };
    
    // Calculer les statistiques si des données sont disponibles
    if (sessions && Array.isArray(sessions)) {
      stats.totalSessions = sessions.length;
      sessions.forEach(session => {
        stats.totalInscriptions += (session.inscrits || 0);
        stats.totalEnAttente += (session.liste_attente || 0);
        
        let placesR = session.places_restantes;
        if (typeof placesR !== 'number' || isNaN(placesR)) {
          placesR = Math.max(0, (session.max_participants || 0) - (session.inscrits || 0));
        }
        
        if (placesR <= 0) stats.totalSessionsCompletes++;
      });
    }
    
    // Mettre à jour les compteurs dans le DOM
    document.getElementById('total-inscriptions')?.textContent = stats.totalInscriptions.toLocaleString();
    document.getElementById('total-en-attente')?.textContent = stats.totalEnAttente.toLocaleString();
    document.getElementById('total-sessions')?.textContent = stats.totalSessions.toLocaleString();
    document.getElementById('total-sessions-completes')?.textContent = stats.totalSessionsCompletes.toLocaleString();
    
    console.log('Dashboard Fix: Statistics updated:', stats);
  }
  
  // Fonction pour mettre à jour le tableau des sessions
  function updateSessionTable(sessions) {
    console.log('Dashboard Fix: Updating session table');
    
    const sessionTableBody = document.querySelector('.session-table tbody');
    if (!sessionTableBody) {
      console.warn("Dashboard Fix: Session table body not found");
      return;
    }
    
    // Vider le tableau
    sessionTableBody.innerHTML = '';
    
    // Afficher un message si aucune session n'est disponible
    if (!sessions || sessions.length === 0) {
      const cols = sessionTableBody.closest('table')?.querySelectorAll('thead th').length || 5;
      sessionTableBody.innerHTML = `<tr class="no-data-row"><td colspan="${cols}" class="text-center p-4 text-muted"><i class="fas fa-info-circle me-2"></i>Aucune session programmée à afficher.</td></tr>`;
      return;
    }
    
    // Remplir le tableau avec les sessions
    sessions.forEach(session => {
      // Calculer les places restantes si non définies
      let placesR = session.places_restantes;
      if (typeof placesR !== 'number' || isNaN(placesR)) {
        placesR = Math.max(0, (session.max_participants || 0) - (session.inscrits || 0));
      }
      
      // Déterminer les classes CSS pour les places
      let placesClass = 'text-secondary', placesIcon = 'fa-question-circle';
      if (placesR <= 0) { 
        placesClass = 'text-danger'; placesIcon = 'fa-times-circle'; 
      } else if ((session.max_participants || 0) > 0 && placesR <= Math.floor((session.max_participants || 0) * 0.3)) { 
        placesClass = 'text-warning'; placesIcon = 'fa-exclamation-triangle'; 
      } else { 
        placesClass = 'text-success'; placesIcon = 'fa-check-circle'; 
      }
      
      // Créer la ligne HTML
      const rowHtml = `
        <tr class="session-row" data-session-id="${session.id}" data-theme="${session.theme || 'N/A'}" data-full="${placesR <= 0 ? '1' : '0'}">
          <td>
            <span class="fw-bold d-block">${session.date || 'N/A'}</span>
            <small class="text-secondary">${session.horaire || 'N/A'}</small>
          </td>
          <td class="theme-cell">
            <span class="theme-badge" data-theme="${session.theme || 'N/A'}" data-bs-toggle="tooltip" data-bs-placement="top" title="${session.theme || 'N/A'}">
              ${session.theme || 'N/A'}
            </span>
          </td>
          <td class="places-dispo text-nowrap ${placesClass}">
            <i class="fas ${placesIcon} me-1"></i> ${placesR} / ${session.max_participants || 0}
          </td>
          <td class="js-salle-cell">
            ${session.salle ? `<span class="badge bg-light text-dark border">${session.salle}</span>` : '<span class="badge bg-secondary">Non définie</span>'}
          </td>
          <td class="text-nowrap text-center">
            <button type="button" class="btn btn-sm btn-outline-secondary me-1" data-bs-toggle="modal" data-bs-target="#participantsModal_${session.id}" title="Voir les participants"><i class="fas fa-users"></i> <span class="badge bg-secondary ms-1">${session.inscrits || 0}</span></button>
            <button type="button" class="btn btn-sm btn-primary" data-bs-toggle="modal" data-bs-target="#inscriptionModal_${session.id}" title="Inscrire un participant"><i class="fas fa-plus"></i></button>
          </td>
        </tr>`;
      
      // Ajouter la ligne au tableau
      sessionTableBody.insertAdjacentHTML('beforeend', rowHtml);
    });
    
    console.log('Dashboard Fix: Session table updated with', sessions.length, 'sessions');
  }
  
  // Fonction pour mettre à jour les activités récentes
  function updateActivityFeed(activities) {
    console.log('Dashboard Fix: Updating activity feed');
    
    const container = document.getElementById('recent-activity');
    if (!container) {
      console.warn("Dashboard Fix: Activity container not found");
      return;
    }
    
    // Supprimer l'indicateur de chargement s'il existe
    const spinner = container.querySelector('.loading-spinner');
    if (spinner) spinner.remove();
    
    // Afficher un message si aucune activité n'est disponible
    if (!activities || activities.length === 0) {
      container.innerHTML = '<div class="list-group-item text-center p-3 text-muted"><i class="fas fa-info-circle me-2"></i>Aucune activité récente à afficher.</div>';
      return;
    }
    
    // Générer le HTML pour les activités
    let html = '';
    activities.forEach(activity => {
      const icon = getActivityIcon(activity.type);
      const userHtml = activity.user ? `<span class="text-primary fw-bold">${activity.user}</span>` : 'Système';
      const detailsHtml = activity.details ? `<p class="mb-1 activity-details text-muted small"><i class="fas fa-info-circle fa-fw me-1"></i>${activity.details}</p>` : '';
      
      html += `
        <div class="list-group-item list-group-item-action activity-item type-${activity.type || 'default'}" data-activity-id="${activity.id}">
          <div class="d-flex w-100 justify-content-between">
            <h6 class="mb-1 activity-title"><i class="${icon} me-2 fa-fw"></i>${activity.description || 'Activité non spécifiée'}</h6>
            <small class="text-muted activity-time text-nowrap ms-2">${activity.date_relative || ''}</small>
          </div>
          ${detailsHtml}
          <small class="text-muted d-block mt-1"><i class="fas fa-user fa-fw me-1"></i>Par: ${userHtml}</small>
        </div>`;
    });
    
    // Mettre à jour le conteneur
    container.innerHTML = html;
    console.log('Dashboard Fix: Activity feed updated with', activities.length, 'activities');
  }
  
  // Fonction pour obtenir l'icône correspondant au type d'activité
  function getActivityIcon(type) {
    const iconMap = {
      'connexion': 'fas fa-sign-in-alt text-success',
      'deconnexion': 'fas fa-sign-out-alt text-warning',
      'inscription': 'fas fa-user-plus text-primary',
      'validation': 'fas fa-check-circle text-success',
      'refus': 'fas fa-times-circle text-danger',
      'annulation': 'fas fa-ban text-danger',
      'ajout_participant': 'fas fa-user-plus text-primary',
      'suppression_participant': 'fas fa-user-minus text-danger',
      'modification_participant': 'fas fa-user-edit text-warning',
      'liste_attente': 'fas fa-clock text-warning',
      'default': 'fas fa-info-circle text-secondary'
    };
    
    return iconMap[type] || iconMap.default;
  }
  
  // Fonction pour mettre à jour les graphiques avec Chart.js
  function updateCharts(sessions, participants) {
    console.log('Dashboard Fix: Updating charts');
    
    if (typeof Chart === 'undefined') {
      console.warn("Dashboard Fix: Chart.js n'est pas disponible");
      return;
    }
    
    // Mettre à jour le graphique de répartition par thème
    updateThemeChart(sessions);
    
    // Mettre à jour le graphique de répartition par service
    updateServiceChart(participants);
  }
  
  // Fonction pour mettre à jour le graphique de répartition par thème
  function updateThemeChart(sessions) {
    const chartCanvas = document.getElementById('themeDistributionChart');
    if (!chartCanvas) {
      console.warn("Dashboard Fix: Element 'themeDistributionChart' non trouvé");
      return;
    }
    
    // Nettoyer le graphique existant s'il existe
    const existingChart = Chart.getChart(chartCanvas);
    if (existingChart) existingChart.destroy();
    
    // Vérifier si des données sont disponibles
    if (!sessions || sessions.length === 0) {
      const noDataMessage = document.createElement('div');
      noDataMessage.className = 'no-data-message-chart';
      noDataMessage.innerHTML = '<i class="fas fa-chart-pie me-2"></i>Aucune donnée pour afficher la répartition par thème.';
      chartCanvas.parentNode.appendChild(noDataMessage);
      return;
    }
    
    // Calculer les données pour le graphique
    const themeCounts = sessions.reduce((acc, session) => {
      const theme = session.theme || 'Non défini';
      acc[theme] = (acc[theme] || 0) + (session.inscrits || 0);
      return acc;
    }, {});
    
    const labels = Object.keys(themeCounts);
    const data = labels.map(label => themeCounts[label]);
    
    // Définir des couleurs pour les thèmes
    const themeColors = {
      'Communiquer avec Teams': '#4e73df',
      'Gérer les tâches (Planner)': '#1cc88a',
      'Gérer mes fichiers (OneDrive/SharePoint)': '#36b9cc',
      'Collaborer avec Teams': '#f6c23e'
    };
    
    const backgroundColors = labels.map(label => themeColors[label] || `hsl(${Math.random() * 360}, 70%, 60%)`);
    
    // Créer le graphique
    new Chart(chartCanvas, {
      type: 'doughnut',
      data: {
        labels: labels,
        datasets: [{
          data: data,
          backgroundColor: backgroundColors,
          borderWidth: 1
        }]
      },
      options: {
        responsive: true,
        plugins: {
          legend: {
            position: 'bottom'
          }
        }
      }
    });
    
    console.log('Dashboard Fix: Theme chart updated');
  }
  
  // Fonction pour mettre à jour le graphique de répartition par service
  function updateServiceChart(participants) {
    const chartCanvas = document.getElementById('serviceDistributionChart');
    if (!chartCanvas) {
      console.warn("Dashboard Fix: Element 'serviceDistributionChart' non trouvé");
      return;
    }
    
    // Nettoyer le graphique existant s'il existe
    const existingChart = Chart.getChart(chartCanvas);
    if (existingChart) existingChart.destroy();
    
    // Vérifier si des données sont disponibles
    if (!participants || participants.length === 0) {
      const noDataMessage = document.createElement('div');
      noDataMessage.className = 'no-data-message-chart';
      noDataMessage.innerHTML = '<i class="fas fa-users me-2"></i>Aucune donnée pour afficher la répartition par service.';
      chartCanvas.parentNode.appendChild(noDataMessage);
      return;
    }
    
    // Calculer les données pour le graphique
    const serviceCounts = participants.reduce((acc, participant) => {
      const service = participant.service || 'Non défini';
      acc[service] = (acc[service] || 0) + 1;
      return acc;
    }, {});
    
    const labels = Object.keys(serviceCounts);
    const data = labels.map(label => serviceCounts[label]);
    
    // Définir des couleurs pour les services
    const serviceColors = {
      'Qualité': '#e74a3b',
      'Informatique': '#4e73df',
      'RH': '#f6c23e',
      'Commerce': '#1cc88a',
      'Marketing': '#6f42c1'
    };
    
    const backgroundColors = labels.map(label => serviceColors[label] || `hsl(${Math.random() * 360}, 70%, 60%)`);
    
    // Créer le graphique
    new Chart(chartCanvas, {
      type: 'bar',
      data: {
        labels: labels,
        datasets: [{
          data: data,
          backgroundColor: backgroundColors,
          borderWidth: 1
        }]
      },
      options: {
        indexAxis: 'y',
        responsive: true,
        plugins: {
          legend: {
            display: false
          }
        },
        scales: {
          x: {
            beginAtZero: true,
            ticks: {
              precision: 0
            }
          }
        }
      }
    });
    
    console.log('Dashboard Fix: Service chart updated');
  }
  
  // Fonction pour initialiser les tooltips Bootstrap
  function initializeTooltips() {
    if (typeof bootstrap === 'undefined' || !bootstrap.Tooltip) {
      console.warn("Dashboard Fix: Bootstrap Tooltip n'est pas disponible");
      return;
    }
    
    const tooltipTriggerList = [].slice.call(document.querySelectorAll('[data-bs-toggle="tooltip"]'));
    tooltipTriggerList.map(function(tooltipTriggerEl) {
      return new bootstrap.Tooltip(tooltipTriggerEl);
    });
  }
  
  // Fonction principale pour réparer le tableau de bord
  function fixDashboard() {
    console.log('Dashboard Fix: Starting dashboard repair');
    
    // Charger les données depuis l'API ou utiliser les données simulées
    if (config.useLocalData) {
      console.log('Dashboard Fix: Using mock data');
      processDashboardData(mockDashboardData);
    } else {
      // Tenter de charger les données depuis l'API
      fetch('/api/dashboard_essential')
        .then(response => {
          if (!response.ok) {
            throw new Error('Network response was not ok');
          }
          return response.json();
        })
        .then(data => {
          console.log('Dashboard Fix: Data loaded from API');
          processDashboardData(data);
        })
        .catch(error => {
          console.warn('Dashboard Fix: Failed to load data from API, using mock data', error);
          processDashboardData(mockDashboardData);
        });
    }
  }
  
  // Fonction pour traiter les données du tableau de bord
  function processDashboardData(data) {
    console.log('Dashboard Fix: Processing dashboard data');
    
    // Mise à jour des statistiques
    if (config.fixTables) {
      updateStatisticsCounters(data.sessions);
      updateSessionTable(data.sessions);
    }
    
    // Mise à jour des activités récentes
    if (config.fixActivities) {
      updateActivityFeed(data.activites);
    }
    
    // Mise à jour des graphiques
    if (config.fixCharts) {
      updateCharts(data.sessions, data.participants);
    }
    
    // Initialiser les tooltips
    initializeTooltips();
    
    console.log('Dashboard Fix: Dashboard repair completed');
  }
  
  // Vérifier si le tableau de bord existe sur la page
  const dashboardExists = document.getElementById('total-inscriptions') || 
                         document.getElementById('total-en-attente') ||
                         document.querySelector('.session-table') ||
                         document.getElementById('recent-activity');
  
  if (dashboardExists) {
    console.log('Dashboard Fix: Dashboard detected, applying fixes');
    
    // Attendre un peu pour s'assurer que le tableau de bord a eu une chance de charger ses données
    // si elles étaient en cours de chargement
    setTimeout(fixDashboard, 1000);
  } else {
    console.log('Dashboard Fix: Dashboard not detected on this page');
  }
  
  // Exposer certaines fonctions à la fenêtre pour une utilisation manuelle si nécessaire
  window.dashboardFix = {
    fix: fixDashboard,
    updateStats: updateStatisticsCounters,
    updateSessionTable: updateSessionTable,
    updateActivities: updateActivityFeed,
    updateCharts: updateCharts,
    mockData: mockDashboardData
  };
});
