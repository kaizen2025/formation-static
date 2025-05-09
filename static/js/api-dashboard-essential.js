/**
 * api-dashboard-essential.js - API simulée pour le tableau de bord
 * Version: 1.0.0
 * 
 * Ce fichier fournit une API simulée pour le tableau de bord lorsque
 * l'API réelle n'est pas disponible ou ne fonctionne pas correctement.
 * À inclure après dashboard-fix.js.
 */

(function() {
  console.log('API Simulator: Initializing');
  
  // Configuration de l'API simulée
  const apiConfig = {
    enabled: true,             // Activer l'API simulée
    interceptFetch: true,      // Intercepter les appels fetch
    responseDelay: 200,        // Délai de réponse simulé (ms)
    logRequests: true,         // Journaliser les requêtes
    endpoints: {
      '/api/dashboard_essential': true,
      '/api/inscriptions-par-theme': true,
      '/api/participants-par-service': true,
      '/api/activites-recentes': true,
      '/api/sessions-a-venir': true
    }
  };
  
  // Données simulées pour l'endpoint '/api/dashboard_essential'
  const dashboardEssentialData = {
    sessions: [
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
    ],
    participants: [
      { id: 1, nom: "PHILIBERT", prenom: "Elodie", email: "ephilibert@anecoop-france.com", service: "Qualité", service_id: "qualite", service_color: "#F44336" },
      { id: 2, nom: "SARRAZIN", prenom: "Enora", email: "esarrazin@anecoop-france.com", service: "Qualité", service_id: "qualite", service_color: "#F44336" },
      { id: 3, nom: "CASTAN", prenom: "Sophie", email: "scastan@anecoop-france.com", service: "Qualité", service_id: "qualite", service_color: "#F44336" },
      { id: 4, nom: "BIVIA", prenom: "Kevin", email: "kbivia@anecoop-france.com", service: "Informatique", service_id: "informatique", service_color: "#607D8B" },
      { id: 5, nom: "GOMEZ", prenom: "Elisabeth", email: "egomez@anecoop-france.com", service: "RH", service_id: "rh", service_color: "#FF9800" },
      { id: 6, nom: "MIR", prenom: "Andreu", email: "amir@solagora.com", service: "Commerce", service_id: "commerce", service_color: "#FFC107" },
      { id: 7, nom: "BROUSSOUX", prenom: "Camille", email: "cbroussoux@anecoop-france.com", service: "Marketing", service_id: "marketing", service_color: "#9C27B0" },
      { id: 8, nom: "BERNAL", prenom: "Paola", email: "pbernal@anecoop-france.com", service: "Qualité", service_id: "qualite", service_color: "#F44336" }
    ],
    activites: [
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
    ],
    status: "ok",
    timestamp: Date.now()
  };
  
  // Données simulées pour l'endpoint '/api/inscriptions-par-theme'
  const inscriptionsParThemeData = [
    { theme: "Communiquer avec Teams", count: 7 },
    { theme: "Gérer les tâches (Planner)", count: 12 },
    { theme: "Gérer mes fichiers (OneDrive/SharePoint)", count: 15 },
    { theme: "Collaborer avec Teams", count: 10 }
  ];
  
  // Données simulées pour l'endpoint '/api/participants-par-service'
  const participantsParServiceData = [
    { service: "Qualité", count: 4 },
    { service: "Informatique", count: 1 },
    { service: "RH", count: 1 },
    { service: "Commerce", count: 1 },
    { service: "Marketing", count: 1 }
  ];
  
  // Données simulées pour l'endpoint '/api/activites-recentes'
  const activitesRecentesData = dashboardEssentialData.activites;
  
  // Données simulées pour l'endpoint '/api/sessions-a-venir'
  const sessionsAVenirData = dashboardEssentialData.sessions;
  
  // Mapping des endpoints vers les données simulées
  const endpointDataMap = {
    '/api/dashboard_essential': dashboardEssentialData,
    '/api/inscriptions-par-theme': inscriptionsParThemeData,
    '/api/participants-par-service': participantsParServiceData,
    '/api/activites-recentes': activitesRecentesData,
    '/api/sessions-a-venir': sessionsAVenirData
  };
  
  // Fonction pour intercepter les appels fetch à l'API
  function interceptFetch() {
    const originalFetch = window.fetch;
    
    window.fetch = function(resource, options) {
      // Vérifier si c'est une requête à intercepter
      const url = typeof resource === 'string' ? resource : resource.url;
      
      // Vérifier si l'endpoint est dans notre liste
      const isApiRequest = Object.keys(apiConfig.endpoints).some(endpoint => 
        url.includes(endpoint) && apiConfig.endpoints[endpoint]
      );
      
      // Si ce n'est pas un endpoint à intercepter, utiliser le fetch original
      if (!apiConfig.enabled || !isApiRequest) {
        return originalFetch(resource, options);
      }
      
      // Journaliser la requête
      if (apiConfig.logRequests) {
        console.log(`API Simulator: Intercepted request to ${url}`);
      }
      
      // Trouver l'endpoint correspondant
      const matchingEndpoint = Object.keys(apiConfig.endpoints).find(endpoint => url.includes(endpoint));
      
      // Obtenir les données simulées pour cet endpoint
      const responseData = endpointDataMap[matchingEndpoint] || { error: "Endpoint not simulated" };
      
      // Créer une réponse simulée
      return new Promise(resolve => {
        setTimeout(() => {
          const response = new Response(JSON.stringify(responseData), {
            status: 200,
            headers: {
              'Content-Type': 'application/json'
            }
          });
          resolve(response);
        }, apiConfig.responseDelay);
      });
    };
    
    console.log('API Simulator: Fetch interceptor installed');
  }
  
  // Installer l'intercepteur fetch si activé
  if (apiConfig.interceptFetch) {
    interceptFetch();
  }
  
  // Exposer l'API simulée à window pour pouvoir la désactiver/activer manuellement
  window.apiSimulator = {
    config: apiConfig,
    enable: function() {
      apiConfig.enabled = true;
      console.log('API Simulator: Enabled');
    },
    disable: function() {
      apiConfig.enabled = false;
      console.log('API Simulator: Disabled');
    },
    getData: function(endpoint) {
      return endpointDataMap[endpoint] || null;
    },
    setData: function(endpoint, data) {
      if (endpointDataMap[endpoint]) {
        endpointDataMap[endpoint] = data;
        console.log(`API Simulator: Data updated for ${endpoint}`);
        return true;
      }
      return false;
    }
  };
  
  console.log('API Simulator: Initialization complete');
})();
