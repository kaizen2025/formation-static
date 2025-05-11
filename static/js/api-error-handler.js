/**
 * api-error-handler.js - Gestionnaire d'erreurs API spécialisé
 * v1.1.2 - Encapsulation IIFE, journalisation améliorée, gestion robuste des erreurs.
 */

(function() { // Début de l'IIFE

    // Tente de récupérer la configuration globale, avec des valeurs par défaut sûres.
    const DASH_CONFIG = window.dashboardConfig || { 
        debugMode: false, // Par défaut, le mode debug est désactivé
        // Ajoutez d'autres configurations par défaut si nécessaire
    };

    class ApiErrorHandler {
        constructor(options = {}) {
            this.options = {
                showNotifications: true,
                logToConsole: DASH_CONFIG.debugMode || false, // Log si debugMode est activé globalement, sinon false
                collectMetrics: false, 
                errorReportUrl: null, 
                ...options
            };
            
            // Erreurs connues spécifiques à l'application et leurs actions de récupération.
            // À remplir si des erreurs récurrentes nécessitent un traitement particulier.
            this.knownErrors = {
                /* Exemple:
                'places_restantes_calculation_error': {
                    description: 'Erreur de calcul des places restantes côté serveur',
                    recovery: () => this.handlePlacesRestantesServerError(), // Fonction à implémenter
                    reported: false // Pour éviter de rapporter la même erreur plusieurs fois
                },
                */
            };
            
            this.errorMetrics = {
                totalErrors: 0,
                byEndpoint: {},
                byErrorType: {}
            };

            if (this.options.logToConsole) {
                console.log('ApiErrorHandler: Initialized (v1.1.2)');
            }
        }
        
        /**
         * Point d'entrée principal pour la gestion des erreurs API.
         * @param {string} endpoint - L'URL de l'API qui a échoué.
         * @param {object|string|null} errorData - Les données d'erreur (souvent un objet JSON ou un message).
         * @param {number} statusCode - Le code de statut HTTP (0 pour les erreurs réseau).
         * @returns {boolean} - True si l'erreur a été gérée d'une manière spécifique, false sinon.
         */
        handleApiError(endpoint, errorData, statusCode) {
            if (this.options.logToConsole) {
                console.error(`ApiErrorHandler: Erreur ${statusCode} sur ${endpoint}`, errorData);
            }
            
            if (this.options.collectMetrics) {
                this.collectErrorMetrics(endpoint, errorData, statusCode);
            }
            
            const errorMessage = this.parseErrorMessage(errorData);

            if (statusCode === 0 || (errorData && errorData.name === 'TypeError' && errorMessage.toLowerCase().includes('failed to fetch'))) {
                return this.handleNetworkError(endpoint, errorMessage);
            }

            const errorKey = this.identifyKnownError(errorMessage);
            if (errorKey && this.knownErrors[errorKey]) {
                const errorInfo = this.knownErrors[errorKey];
                if (this.options.errorReportUrl && !errorInfo.reported && this.shouldReportError(errorKey)) {
                    this.reportErrorToServer(endpoint, errorData, errorKey);
                    errorInfo.reported = true;
                }
                if (errorInfo.recovery && typeof errorInfo.recovery === 'function') {
                    try {
                        return errorInfo.recovery();
                    } catch (recoveryError) {
                        if (this.options.logToConsole) console.error(`ApiErrorHandler: Erreur pendant la récupération de '${errorKey}':`, recoveryError);
                    }
                }
            }
            
            // Gestion hiérarchique des codes de statut HTTP
            if (statusCode >= 500) return this.handleServerError(endpoint, errorMessage, statusCode);
            if (statusCode === 429) return this.handleRateLimitError(endpoint, errorMessage);
            if (statusCode === 404) return this.handleNotFoundError(endpoint, errorMessage);
            if (statusCode === 401 || statusCode === 403) return this.handleAuthError(statusCode, errorMessage);
            if (statusCode >= 400) return this.handleBadRequestError(endpoint, errorMessage, statusCode); // Gère 400 et autres 4xx

            // Si non géré spécifiquement, afficher une notification générique
            this.showUserNotification('generic', statusCode, `Erreur ${statusCode} sur ${endpoint}: ${errorMessage.substring(0, 150)}...`);
            return false; // Indique que l'erreur n'a pas eu de gestionnaire spécifique au-delà de la notification.
        }

        parseErrorMessage(errorData) {
            if (!errorData) return 'Erreur inconnue (pas de données d\'erreur).';
            if (typeof errorData === 'string') return errorData;
            if (errorData.message) return errorData.message;
            if (errorData.error) return errorData.error;
            try {
                return JSON.stringify(errorData);
            } catch (e) {
                return 'Erreur inconnue (données d\'erreur non sérialisables).';
            }
        }

        handleNetworkError(endpoint, errorMessage) {
            if (this.options.logToConsole) console.error(`ApiErrorHandler: Erreur réseau sur ${endpoint}: ${errorMessage}`);
            this.showUserNotification('network', 0, `Problème de connexion réseau en tentant d'accéder aux données. Veuillez vérifier votre connexion internet et réessayer.`);
            // Envisager d'arrêter le polling ou d'augmenter les intervalles ici
            return true;
        }
        
        identifyKnownError(errorMessage) {
            if (!errorMessage) return null;
            const message = typeof errorMessage === 'string' ? errorMessage.toLowerCase() : JSON.stringify(errorMessage).toLowerCase();
            return Object.keys(this.knownErrors).find(key => message.includes(key.toLowerCase()));
        }
        
        shouldReportError(errorType) {
            const doNotReportErrors = ['network_timeout', 'user_cancel']; // Exemples
            return !doNotReportErrors.includes(errorType);
        }
        
        handleServerError(endpoint, errorMessage, statusCode) {
            this.showUserNotification('server', statusCode, `Une erreur est survenue côté serveur en accédant à "${endpoint}". Veuillez réessayer plus tard. (Code: ${statusCode})`);
            return true;
        }
        
        handleNotFoundError(endpoint, errorMessage) {
            this.showUserNotification('notfound', 404, `La ressource demandée sur "${endpoint}" n'a pas été trouvée. Elle a peut-être été déplacée ou supprimée.`);
            return true;
        }

        handleBadRequestError(endpoint, errorMessage, statusCode) {
            let msg = `La requête vers "${endpoint}" était invalide.`;
            if (errorMessage && errorMessage !== this.parseErrorMessage({})) { // Si un message spécifique est fourni
                msg += ` Détails: ${errorMessage.substring(0, 100)}`;
            }
            this.showUserNotification('badrequest', statusCode, msg + ` (Code: ${statusCode})`);
            return true;
        }

        handleRateLimitError(endpoint, errorMessage) {
            this.showUserNotification('ratelimit', 429, `Trop de requêtes effectuées vers "${endpoint}". Veuillez attendre un moment avant de réessayer.`);
            return true;
        }
        
        handleAuthError(statusCode, errorMessage) {
            const message = statusCode === 401 
                ? 'Votre session a peut-être expiré ou vous n\'êtes pas authentifié. Veuillez vous reconnecter.'
                : 'Accès non autorisé. Vous ne disposez pas des permissions nécessaires pour cette action.';
            this.showUserNotification('auth', statusCode, message);
            
            if (statusCode === 401 && !window.location.pathname.includes('/login')) {
                // Rediriger vers la page de login en conservant la page actuelle dans 'next'
                const currentPath = window.location.pathname + window.location.search;
                setTimeout(() => { window.location.href = '/login?next=' + encodeURIComponent(currentPath); }, 3000);
            }
            return true;
        }
        
        showUserNotification(type, statusCode, customMessage) {
            if (!this.options.showNotifications) return;

            let message = customMessage || 'Une erreur inattendue est survenue.';
            let theme = 'warning'; 

            switch (type) {
                case 'network': theme = 'danger'; break;
                case 'server': theme = 'danger'; break;
                case 'notfound': theme = 'warning'; break;
                case 'auth': theme = 'danger'; break;
                case 'badrequest': theme = 'warning'; break;
                case 'ratelimit': theme = 'warning'; break;
                case 'generic':
                    if (statusCode >= 500) theme = 'danger';
                    else if (statusCode === 0) theme = 'danger'; // Erreur réseau aussi
                    else if (statusCode >= 400) theme = 'warning';
                    else theme = 'info'; // Pour les codes < 400, bien que peu probable ici
                    break;
            }

            if (typeof window.showToast === 'function') {
                window.showToast(message, theme);
            } else {
                if (this.options.logToConsole) {
                    console.warn('ApiErrorHandler: window.showToast function not found. Notification en console:', {type, message});
                }
            }
        }
        
        collectErrorMetrics(endpoint, errorData, statusCode) {
            this.errorMetrics.totalErrors++;
            this.errorMetrics.byEndpoint[endpoint] = (this.errorMetrics.byEndpoint[endpoint] || 0) + 1;
            const errorType = this.parseErrorMessage(errorData) || `status_${statusCode}`;
            this.errorMetrics.byErrorType[errorType] = (this.errorMetrics.byErrorType[errorType] || 0) + 1;
        }
        
        reportErrorToServer(endpoint, errorData, errorType) {
            if (!this.options.errorReportUrl || !this.options.collectMetrics) return;
            const reportData = {
                endpoint,
                errorType,
                statusCode: errorData.status || (errorData.response ? errorData.response.status : null), // Essayer de récupérer le statut
                errorMessage: this.parseErrorMessage(errorData),
                timestamp: new Date().toISOString(),
                userAgent: navigator.userAgent,
                url: window.location.href,
                // Ne pas inclure errorData directement s'il peut contenir des infos sensibles.
                // details: JSON.stringify(errorData, Object.getOwnPropertyNames(errorData)) // Pour plus de détails si nécessaire
            };
            
            if (this.options.logToConsole) console.log("ApiErrorHandler: Reporting error to server:", reportData);

            if (navigator.sendBeacon) {
                const blob = new Blob([JSON.stringify(reportData)], { type: 'application/json' });
                navigator.sendBeacon(this.options.errorReportUrl, blob);
            } else {
                fetch(this.options.errorReportUrl, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(reportData),
                    keepalive: true // Important pour les erreurs se produisant lors de la fermeture de la page
                }).catch(e => {
                    if (this.options.logToConsole) console.error('ApiErrorHandler: Échec de l\'envoi du rapport d\'erreur via fetch:', e);
                });
            }
        }
        
        checkAndFixBrokenElements() {
            // Cette fonction est un placeholder. Les corrections spécifiques d'UI
            // devraient être implémentées ici si nécessaire, ou dans des modules UI dédiés.
            if (this.options.logToConsole) {
                console.log("ApiErrorHandler: checkAndFixBrokenElements() appelé. Implémentez des corrections UI spécifiques si besoin.");
            }
        }
    }

    // Créer et assigner l'instance globale pour qu'elle soit accessible par d'autres scripts.
    window.apiErrorHandler = new ApiErrorHandler();

})(); // Fin de l'IIFE
