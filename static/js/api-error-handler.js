/**
 * Gestionnaire d'erreurs API pour l'application Formation
 * Fournit des fonctions pour gérer les erreurs HTTP et API de manière uniforme
 */

// Configuration des codes d'erreur et messages associés
const ERROR_MESSAGES = {
    // Erreurs client
    400: "Requête incorrecte. Veuillez vérifier les données envoyées.",
    401: "Authentification requise. Veuillez vous connecter.",
    403: "Accès refusé. Vous n'avez pas les droits nécessaires.",
    404: "Ressource introuvable.",
    405: "Méthode non autorisée.",
    408: "Délai d'attente dépassé. Veuillez réessayer.",
    429: "Trop de requêtes. Veuillez réessayer plus tard.",
    
    // Erreurs serveur
    500: "Erreur interne du serveur. Veuillez réessayer ultérieurement.",
    501: "Fonctionnalité non implémentée.",
    502: "Erreur de passerelle.",
    503: "Service indisponible. Veuillez réessayer plus tard.",
    504: "Délai de passerelle dépassé."
};

// Niveau de détail des erreurs (peut être configuré)
const ERROR_VERBOSITY = 'medium'; // 'low', 'medium', 'high'

/**
 * Gestionnaire principal d'erreurs pour les requêtes fetch
 * @param {Response} response - L'objet Response de fetch
 * @param {string} context - Contexte de l'erreur pour le journal
 * @returns {Promise<any>} - Retourne les données en cas de succès ou rejette avec une erreur formatée
 */
async function handleFetchResponse(response, context = 'API') {
    // Vérifier si la réponse est OK (statut 200-299)
    if (!response.ok) {
        // Essayer de lire le corps de la réponse pour les détails d'erreur
        let errorDetails;
        try {
            errorDetails = await response.json();
        } catch (e) {
            errorDetails = { message: "Détails d'erreur non disponibles" };
        }
        
        // Créer une erreur enrichie
        const error = createFormattedError(response.status, errorDetails, context);
        console.error(`${context} error:`, error);
        
        // Rejeter avec l'erreur enrichie
        throw error;
    }
    
    // Pour les réponses vides (204 No Content)
    if (response.status === 204) {
        return null;
    }
    
    // Pour les réponses JSON
    try {
        return await response.json();
    } catch (e) {
        // Si la réponse n'est pas du JSON valide
        console.warn(`${context}: La réponse n'est pas du JSON valide`, e);
        return response.text(); // Retourner le texte brut à la place
    }
}

/**
 * Crée une erreur formatée avec les détails appropriés
 * @param {number} status - Code de statut HTTP
 * @param {Object} details - Détails de l'erreur
 * @param {string} context - Contexte de l'erreur
 * @returns {Error} - Erreur enrichie avec des détails
 */
function createFormattedError(status, details, context) {
    // Message par défaut basé sur le code de statut
    const defaultMessage = ERROR_MESSAGES[status] || "Une erreur inattendue s'est produite.";
    
    // Message du serveur (s'il existe)
    const serverMessage = details.message || details.error || null;
    
    // Créer le message d'erreur en fonction du niveau de détail
    let errorMessage;
    
    switch (ERROR_VERBOSITY) {
        case 'low':
            errorMessage = defaultMessage;
            break;
        case 'medium':
            errorMessage = serverMessage ? `${defaultMessage} ${serverMessage}` : defaultMessage;
            break;
        case 'high':
            errorMessage = `[${context}] ${status}: ${defaultMessage} ${serverMessage || ''}`;
            break;
        default:
            errorMessage = defaultMessage;
    }
    
    // Créer l'objet d'erreur
    const error = new Error(errorMessage);
    error.status = status;
    error.context = context;
    error.details = details;
    
    return error;
}

/**
 * Affiche un message d'erreur à l'utilisateur
 * @param {Error} error - L'erreur à afficher
 * @param {string} containerId - ID du conteneur où afficher l'erreur (optionnel)
 */
function displayErrorMessage(error, containerId = null) {
    const message = error.message || "Une erreur inattendue s'est produite.";
    
    // Si un conteneur est spécifié, y afficher l'erreur
    if (containerId) {
        const container = document.getElementById(containerId);
        if (container) {
            container.innerHTML = `
                <div class="alert alert-danger alert-dismissible fade show" role="alert">
                    <i class="fas fa-exclamation-triangle me-2"></i>
                    ${message}
                    <button type="button" class="btn-close" data-bs-dismiss="alert" aria-label="Close"></button>
                </div>
            `;
            return;
        }
    }
    
    // Sinon, créer une alerte flottante
    const alertDiv = document.createElement('div');
    alertDiv.className = 'alert alert-danger alert-dismissible fade show position-fixed top-0 end-0 m-3';
    alertDiv.setAttribute('role', 'alert');
    alertDiv.style.zIndex = '9999';
    alertDiv.innerHTML = `
        <i class="fas fa-exclamation-triangle me-2"></i>
        ${message}
        <button type="button" class="btn-close" data-bs-dismiss="alert" aria-label="Close"></button>
    `;
    
    document.body.appendChild(alertDiv);
    
    // Supprimer automatiquement après 5 secondes
    setTimeout(() => {
        alertDiv.classList.remove('show');
        setTimeout(() => alertDiv.remove(), 300);
    }, 5000);
}

/**
 * Envoie une requête API avec gestion d'erreur intégrée
 * @param {string} url - URL de l'API
 * @param {Object} options - Options de fetch
 * @param {string} context - Contexte de la requête
 * @returns {Promise<any>} - Données de la réponse
 */
async function apiRequest(url, options = {}, context = 'API') {
    try {
        const response = await fetch(url, {
            headers: {
                'Content-Type': 'application/json',
                'Accept': 'application/json',
                ...options.headers
            },
            ...options
        });
        
        return await handleFetchResponse(response, context);
    } catch (error) {
        // Logger l'erreur
        console.error(`${context} request failed:`, error);
        
        // Afficher l'erreur si ce n'est pas une requête silencieuse
        if (!options.silent) {
            displayErrorMessage(error);
        }
        
        // Propager l'erreur
        throw error;
    }
}

// Exportation des fonctions pour utilisation dans d'autres modules
window.apiErrorHandler = {
    handleFetchResponse,
    displayErrorMessage,
    apiRequest
};
