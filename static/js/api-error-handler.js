/**
 * api-error-handler.js - Gestionnaire d'erreurs API spécialisé
 * v1.0.0 - Conçu pour gérer correctement les erreurs spécifiques dont places_restantes
 */

class ApiErrorHandler {
    constructor(options = {}) {
        this.options = {
            showNotifications: true,
            logToConsole: true,
            collectMetrics: true,
            ...options
        };
        
        // Stockage des erreurs spécifiques connues et leur action de récupération
        this.knownErrors = {
            'places_restantes': {
                description: 'Erreur de calcul des places restantes',
                recovery: () => this.handlePlacesRestantesError(),
                reported: false
            },
            'max_participants': {
                description: 'Erreur avec max_participants',
                recovery: () => this.handleMaxParticipantsError(),
                reported: false
            },
            'TypeError': {
                description: 'Erreur de type lors du traitement des données',
                recovery: () => this.handleTypeError(),
                reported: false
            },
            'undefined': {
                description: 'Valeur undefined rencontrée',
                recovery: () => this.handleUndefinedError(),
                reported: false
            }
        };
        
        // Métriques d'erreurs pour analyse
        this.errorMetrics = {
            totalErrors: 0,
            byEndpoint: {},
            byErrorType: {}
        };
    }
    
    /**
     * Traite une erreur d'API
     * @param {string} endpoint - L'endpoint qui a échoué
     * @param {Object} errorData - Les données d'erreur
     * @param {number} statusCode - Le code HTTP
     * @returns {boolean} - True si l'erreur a été traitée
     */
    handleApiError(endpoint, errorData, statusCode) {
        if (this.options.logToConsole) {
            console.error(`ApiErrorHandler: Erreur ${statusCode} sur ${endpoint}`, errorData);
        }
        
        if (this.options.collectMetrics) {
            this.collectErrorMetrics(endpoint, errorData, statusCode);
        }
        
        // Vérifier si c'est une erreur connue
        if (errorData && errorData.message) {
            const errorKey = this.identifyKnownError(errorData.message);
            if (errorKey) {
                const errorInfo = this.knownErrors[errorKey];
                
                // Si c'est la première fois qu'on rencontre cette erreur, envoyer un rapport
                if (!errorInfo.reported && this.shouldReportError(errorKey)) {
                    this.reportErrorToServer(endpoint, errorData, errorKey);
                    errorInfo.reported = true;
                }
                
                // Exécuter l'action de récupération
                if (errorInfo.recovery && typeof errorInfo.recovery === 'function') {
                    return errorInfo.recovery();
                }
            }
        }
        
        // Gérer les erreurs spécifiques par code HTTP
        if (statusCode === 500) {
            return this.handleServerError(endpoint, errorData);
        } else if (statusCode === 404) {
            return this.handleNotFoundError(endpoint);
        } else if (statusCode === 401 || statusCode === 403) {
            return this.handleAuthError(statusCode);
        }
        
        // Afficher une notification à l'utilisateur si activé
        if (this.options.showNotifications) {
            this.showUserNotification(endpoint, statusCode);
        }
        
        return false;
    }
    
    /**
     * Identifie si le message d'erreur correspond à une erreur connue
     * @param {string} errorMessage - Message d'erreur à analyser
     * @returns {string|null} - Clé de l'erreur identifiée ou null
     */
    identifyKnownError(errorMessage) {
        // Éliminer les guillemets et espaces du message
        const cleanMessage = errorMessage.replace(/['"]/g, '').trim();
        
        // Vérifier d'abord les correspondances exactes
        const exactMatch = Object.keys(this.knownErrors).find(key => 
            cleanMessage === key);
        
        if (exactMatch) return exactMatch;
        
        // Ensuite vérifier les inclusions partielles
        return Object.keys(this.knownErrors).find(key => 
            cleanMessage.includes(key));
    }
    
    /**
     * Vérifie si une erreur doit être signalée
     * @param {string} errorType - Type d'erreur
     * @returns {boolean} - True si l'erreur doit être signalée
     */
    shouldReportError(errorType) {
        // Éviter de signaler certaines erreurs trop fréquentes
        const doNotReportErrors = ['network_timeout', 'user_cancel'];
        return !doNotReportErrors.includes(errorType);
    }
    
    /**
     * Action spécifique pour gérer l'erreur 'places_restantes'
     * @returns {boolean} - True si l'erreur a été traitée
     */
    handlePlacesRestantesError() {
        console.log("ApiErrorHandler: Récupération de l'erreur places_restantes");
        
        // Récupérer tous les éléments concernés par places_restantes
        const placesElements = document.querySelectorAll('.places-count, .places-dispo');
        
        placesElements.forEach(element => {
            // Sauvegarder la valeur originale si elle existe et n'est pas déjà sauvegardée
            if (!element.dataset.originalText) {
                element.dataset.originalText = element.textContent;
            }
            
            // Vérifier si le contenu n'est pas déjà marqué comme erreur
            if (!element.classList.contains('data-error')) {
                // Appliquer le style d'erreur
                element.classList.add('data-error');
                
                // Mettre à jour le contenu pour indiquer l'indisponibilité
                element.textContent = '? / ?';
                element.title = 'Données temporairement indisponibles';
                
                // Si bootstrap est disponible, créer un tooltip
                if (typeof bootstrap !== 'undefined' && typeof bootstrap.Tooltip === 'function') {
                    const tooltip = bootstrap.Tooltip.getInstance(element);
                    if (tooltip) tooltip.dispose();
                    new bootstrap.Tooltip(element, {
                        title: 'Données temporairement indisponibles',
                        placement: 'top'
                    });
                }
            }
        });
        
        // Alerter l'utilisateur
        this.showUserNotification('dashboard_essential', 500, 
            'Impossible de charger les données de places disponibles. Affichage temporairement désactivé.');
        
        return true;
    }
    
    /**
     * Action spécifique pour gérer l'erreur 'max_participants'
     * @returns {boolean} - True si l'erreur a été traitée
     */
    handleMaxParticipantsError() {
        console.log("ApiErrorHandler: Récupération de l'erreur max_participants");
        
        // Rechercher toutes les références aux capacités des sessions
        const capacityElements = document.querySelectorAll('.session-capacity, .capacity-display');
        
        capacityElements.forEach(element => {
            if (!element.dataset.originalText) {
                element.dataset.originalText = element.textContent;
            }
            
            if (!element.classList.contains('data-error')) {
                element.classList.add('data-error');
                element.textContent = '?';
                element.title = 'Capacité temporairement indisponible';
                
                // Bootstrap tooltip si disponible
                if (typeof bootstrap !== 'undefined' && typeof bootstrap.Tooltip === 'function') {
                    const tooltip = bootstrap.Tooltip.getInstance(element);
                    if (tooltip) tooltip.dispose();
                    new bootstrap.Tooltip(element, {
                        title: 'Capacité temporairement indisponible',
                        placement: 'top'
                    });
                }
            }
        });
        
        return true;
    }
    
    /**
     * Action pour gérer les TypeError génériques
     * @returns {boolean} - True si l'erreur a été traitée
     */
    handleTypeError() {
        console.log("ApiErrorHandler: Récupération d'une TypeError");
        
        // Rechercher des éléments dynamiques qui pourraient avoir des problèmes
        const dynamicElements = document.querySelectorAll('[data-dynamic]');
        
        dynamicElements.forEach(element => {
            // Marquer comme ayant une erreur
            element.classList.add('error-state');
            
            // Si c'est un conteneur qui devrait afficher des données, montrer un message
            if (element.children.length === 0 || element.innerHTML.trim() === '') {
                element.innerHTML = '<div class="text-center text-muted p-3"><i class="fas fa-exclamation-circle me-2"></i>Données temporairement indisponibles</div>';
            }
        });
        
        return true;
    }
    
    /**
     * Action pour gérer les erreurs 'undefined'
     * @returns {boolean} - True si l'erreur a été traitée
     */
    handleUndefinedError() {
        console.log("ApiErrorHandler: Récupération d'une erreur 'undefined'");
        
        // Vérifier les compteurs qui pourraient être affectés
        const counters = document.querySelectorAll('.counter-value, .stat-value');
        
        counters.forEach(counter => {
            const text = counter.textContent.trim();
            if (text === 'undefined' || text === 'NaN' || text === '') {
                counter.textContent = '—';
                counter.classList.add('text-muted');
                counter.title = 'Valeur temporairement indisponible';
            }
        });
        
        return true;
    }
    
    /**
     * Gère les erreurs serveur 500
     * @param {string} endpoint - Endpoint qui a échoué
     * @param {Object} errorData - Données d'erreur
     * @returns {boolean} - True si l'erreur a été traitée
     */
    handleServerError(endpoint, errorData) {
        console.log(`ApiErrorHandler: Gestion de l'erreur serveur 500 pour ${endpoint}`);
        
        // Vérifier si l'erreur contient un message spécifique connu
        if (errorData && errorData.message) {
            const errorMessage = typeof errorData.message === 'string' ? errorData.message : JSON.stringify(errorData.message);
            
            // Erreurs spécifiques aux données de session
            if (errorMessage.includes('places_restantes') || errorMessage.includes('max_participants')) {
                return this.handleDataModelError(endpoint, errorMessage);
            }
            
            // Erreurs de base de données
            if (errorMessage.includes('database') || errorMessage.includes('SQL') || errorMessage.includes('query')) {
                return this.handleDatabaseError(endpoint);
            }
        }
        
        // Erreur serveur générique
        this.showUserNotification(endpoint, 500);
        return false;
    }
    
    /**
     * Gère les erreurs serveur 404
     * @param {string} endpoint - Endpoint qui a échoué
     * @returns {boolean} - True si l'erreur a été traitée
     */
    handleNotFoundError(endpoint) {
        console.log(`ApiErrorHandler: Gestion de l'erreur 404 pour ${endpoint}`);
        
        if (endpoint.includes('session')) {
            this.showUserNotification('session', 404, 'Session introuvable. Elle a peut-être été supprimée.');
            return true;
        }
        
        if (endpoint.includes('participant')) {
            this.showUserNotification('participant', 404, 'Participant introuvable. Il a peut-être été supprimé.');
            return true;
        }
        
        this.showUserNotification(endpoint, 404);
        return false;
    }
    
    /**
     * Gère les erreurs d'authentification
     * @param {number} statusCode - Code HTTP 401 ou 403
     * @returns {boolean} - True si l'erreur a été traitée
     */
    handleAuthError(statusCode) {
        console.log(`ApiErrorHandler: Gestion de l'erreur d'authentification ${statusCode}`);
        
        const message = statusCode === 401 
            ? 'Votre session a expiré. Veuillez vous reconnecter.'
            : 'Vous n\'avez pas les droits nécessaires pour cette action.';
            
        this.showUserNotification('auth', statusCode, message);
        
        // Rediriger vers la page de login après un délai si 401
        if (statusCode === 401) {
            setTimeout(() => {
                window.location.href = '/login?expired=1';
            }, 3000);
        }
        
        return true;
    }
    
    /**
     * Gère les erreurs de modèle de données
     * @param {string} endpoint - Endpoint qui a échoué
     * @param {string} errorMessage - Message d'erreur
     * @returns {boolean} - True si l'erreur a été traitée
     */
    handleDataModelError(endpoint, errorMessage) {
        console.log(`ApiErrorHandler: Gestion de l'erreur de modèle de données pour ${endpoint}`);
        
        // Vérifier spécifiquement pour places_restantes
        if (errorMessage.includes('places_restantes')) {
            return this.handlePlacesRestantesError();
        }
        
        // Vérifier pour max_participants
        if (errorMessage.includes('max_participants')) {
            return this.handleMaxParticipantsError();
        }
        
        // Erreur générique de modèle de données
        this.showUserNotification(endpoint, 500, 'Erreur de données. Certaines informations peuvent être incorrectes.');
        return true;
    }
    
    /**
     * Gère les erreurs de base de données
     * @param {string} endpoint - Endpoint qui a échoué
     * @returns {boolean} - True si l'erreur a été traitée
     */
    handleDatabaseError(endpoint) {
        console.log(`ApiErrorHandler: Gestion de l'erreur de base de données pour ${endpoint}`);
        
        this.showUserNotification(endpoint, 500, 'Erreur de base de données. Réessayez plus tard.');
        return true;
    }
    
    /**
     * Affiche une notification adaptée à l'utilisateur
     * @param {string} endpoint - Endpoint concerné
     * @param {number} statusCode - Code HTTP
     * @param {string} [customMessage] - Message personnalisé facultatif
     */
    showUserNotification(endpoint, statusCode, customMessage = null) {
        let message = customMessage || 'Une erreur est survenue lors du chargement des données.';
        let theme = 'warning';
        
        // Personnaliser le message selon l'endpoint et le code de statut
        if (!customMessage) {
            if (endpoint.includes('dashboard_essential')) {
                message = 'Impossible de charger certaines informations du tableau de bord. Les valeurs affichées peuvent être incomplètes.';
            } else if (endpoint.includes('activites')) {
                message = 'Impossible de charger les activités récentes.';
            }
            
            // Adapter selon le code de statut
            if (statusCode >= 500) {
                theme = 'danger';
                message = `Erreur serveur: ${message}`;
            } else if (statusCode === 404) {
                message = `Ressource introuvable: ${message}`;
            } else if (statusCode === 401 || statusCode === 403) {
                theme = 'danger';
            }
        }
        
        // Afficher la notification si une fonction showToast est disponible
        if (typeof window.showToast === 'function') {
            window.showToast(message, theme);
        } 
        // Sinon essayer la lib createNotification (comme mentionné dans les logs)
        else if (window.createNotification) {
            window.createNotification({
                theme: theme,
                positionClass: 'nfc-top-right',
                duration: 5000
            })({
                title: theme === 'danger' ? 'Erreur' : 'Attention',
                message: message
            });
        }
        // Dernier recours - console
        else {
            console.error('Notification:', message);
        }
    }
    
    /**
     * Collecte des métriques sur les erreurs pour analyse
     * @param {string} endpoint - Endpoint qui a échoué
     * @param {Object} errorData - Données d'erreur
     * @param {number} statusCode - Code HTTP
     */
    collectErrorMetrics(endpoint, errorData, statusCode) {
        this.errorMetrics.totalErrors++;
        
        // Par endpoint
        if (!this.errorMetrics.byEndpoint[endpoint]) {
            this.errorMetrics.byEndpoint[endpoint] = 0;
        }
        this.errorMetrics.byEndpoint[endpoint]++;
        
        // Par type d'erreur
        const errorType = errorData && errorData.message 
            ? errorData.message 
            : `status_${statusCode}`;
            
        if (!this.errorMetrics.byErrorType[errorType]) {
            this.errorMetrics.byErrorType[errorType] = 0;
        }
        this.errorMetrics.byErrorType[errorType]++;
        
        // Si beaucoup d'erreurs s'accumulent, envoyer un rapport
        if (this.errorMetrics.totalErrors % 10 === 0) {
            this.sendErrorMetricsReport();
        }
    }
    
    /**
     * Envoie un rapport d'erreur au serveur pour analyse
     * @param {string} endpoint - Endpoint qui a échoué
     * @param {Object} errorData - Données d'erreur
     * @param {string} errorType - Type d'erreur identifié
     */
    reportErrorToServer(endpoint, errorData, errorType) {
        // Préparer les données à envoyer
        const reportData = {
            endpoint,
            errorType,
            timestamp: new Date().toISOString(),
            userAgent: navigator.userAgent,
            details: errorData
        };
        
        // Utiliser sendBeacon pour une transmission fiable même si la page se ferme
        if (navigator.sendBeacon) {
            const blob = new Blob([JSON.stringify(reportData)], { type: 'application/json' });
            navigator.sendBeacon('/api/error_report', blob);
        } else {
            // Fallback à fetch
            fetch('/api/error_report', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(reportData),
                keepalive: true
            }).catch(e => console.error('Échec de l\'envoi du rapport d\'erreur', e));
        }
    }
    
    /**
     * Envoie un rapport de métriques d'erreurs au serveur
     */
    sendErrorMetricsReport() {
        // Éviter d'envoyer si c'est désactivé
        if (!this.options.collectMetrics) return;
        
        const reportData = {
            metrics: this.errorMetrics,
            timestamp: new Date().toISOString(),
            sessionId: this.getSessionId()
        };
        
        // Utiliser fetch avec keepalive
        fetch('/api/error_metrics', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(reportData),
            keepalive: true
        }).catch(e => console.error('Échec de l\'envoi des métriques d\'erreur', e));
    }
    
    /**
     * Récupère l'ID de session depuis le localStorage ou un cookie
     * @returns {string} ID de session ou anonymous
     */
    getSessionId() {
        // Essayer localStorage d'abord
        const localStorageId = localStorage.getItem('session_id');
        if (localStorageId) return localStorageId;
        
        // Essayer de lire depuis les cookies
        const cookies = document.cookie.split(';');
        for (const cookie of cookies) {
            const [name, value] = cookie.trim().split('=');
            if (name === 'session_id') return decodeURIComponent(value);
        }
        
        return 'anonymous';
    }
}

// Créer et exporter une instance
window.apiErrorHandler = new ApiErrorHandler();

// Intégration avec le système existant
if (typeof window.uiFixers !== 'undefined') {
    // Ajouter la référence au gestionnaire d'erreurs
    window.uiFixers.apiErrorHandler = window.apiErrorHandler;
    
    // Améliorer la fonction applyAllFixes pour inclure les corrections d'erreurs
    const originalApplyAllFixes = window.uiFixers.applyAllFixes;
    window.uiFixers.applyAllFixes = function() {
        // Appliquer les corrections UI standards
        originalApplyAllFixes.apply(this, arguments);
        
        // Vérifier et corriger les problèmes de données après les corrections UI
        try {
            // Rechercher des indicateurs d'erreurs de données
            const placesElements = document.querySelectorAll('.places-dispo');
            placesElements.forEach(element => {
                const text = element.textContent.trim();
                if (text === 'NaN / NaN' || 
                    text === 'undefined / undefined' || 
                    text.includes('null') ||
                    text === '/ ') {
                    // Appeler la correction des erreurs places_restantes
                    window.apiErrorHandler.handlePlacesRestantesError();
                    return false; // Une fois suffit
                }
            });
        } catch (e) {
            console.error('Error in enhanced applyAllFixes:', e);
        }
    };
}

// Interception globale des erreurs de fetch pour les endpoints API
if (typeof window.fetch === 'function') {
    const originalFetch = window.fetch;
    window.fetch = async function(...args) {
        try {
            const response = await originalFetch.apply(this, args);
            
            // Vérifier si c'est un appel API et s'il a échoué
            const url = typeof args[0] === 'string' ? args[0] : args[0].url;
            if (typeof url === 'string' && url.includes('/api/') && !response.ok) {
                // Récupérer les informations d'erreur
                let errorData = null;
                try {
                    errorData = await response.clone().json();
                } catch (e) {
                    errorData = { message: 'Could not parse error response' };
                }
                
                // Appeler le gestionnaire d'erreurs
                window.apiErrorHandler.handleApiError(url, errorData, response.status);
            }
            
            return response;
        } catch (error) {
            // Erreur réseau (pas de réponse du serveur)
            console.error('Fetch network error:', error);
            window.apiErrorHandler.handleApiError('network', { message: error.message }, 0);
            throw error;
        }
    };
}

export { ApiErrorHandler };
