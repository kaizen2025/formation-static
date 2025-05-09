/**
 * api-error-handler.js - Gestionnaire d'erreurs API spécialisé
 * v1.1.1 - Correction syntaxe 'export' et amélioration gestion erreurs
 */

class ApiErrorHandler {
    constructor(options = {}) {
        this.options = {
            showNotifications: true,
            logToConsole: true,
            collectMetrics: true, // Optionnel: pour une future collecte de métriques
            ...options
        };

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
            // Ajouter d'autres erreurs connues si nécessaire
        };

        this.errorMetrics = {
            totalErrors: 0,
            byEndpoint: {},
            byErrorType: {}
        };
        this.hasAppliedPlacesRestantesFix = false;
    }

    handleApiError(endpoint, errorData, statusCode) {
        if (this.options.logToConsole) {
            console.error(`ApiErrorHandler: Erreur ${statusCode} sur ${endpoint}`, errorData);
        }

        if (this.options.collectMetrics) {
            this.collectErrorMetrics(endpoint, errorData, statusCode);
        }

        const errorMessage = errorData?.message || errorData?.error || (typeof errorData === 'string' ? errorData : JSON.stringify(errorData));
        const errorKey = this.identifyKnownError(errorMessage);

        if (errorKey) {
            const errorInfo = this.knownErrors[errorKey];
            if (!errorInfo.reported && this.shouldReportError(errorKey)) {
                // this.reportErrorToServer(endpoint, errorData, errorKey); // Optionnel: si vous avez un endpoint de rapport
                errorInfo.reported = true;
            }
            if (errorInfo.recovery && typeof errorInfo.recovery === 'function') {
                return errorInfo.recovery();
            }
        }

        if (statusCode === 500) return this.handleServerError(endpoint, errorData);
        if (statusCode === 404) return this.handleNotFoundError(endpoint);
        if (statusCode === 401 || statusCode === 403) return this.handleAuthError(statusCode, endpoint);
        if (statusCode === 0 && errorData?.name === 'AbortError') { // Timeout de fetch
            this.showUserNotification(endpoint, statusCode, 'La requête a mis trop de temps à répondre (timeout).');
            return true;
        }


        if (this.options.showNotifications) {
            this.showUserNotification(endpoint, statusCode, errorMessage);
        }
        return false;
    }

    identifyKnownError(errorMessage) {
        if (!errorMessage) return null;
        const message = typeof errorMessage === 'string' ? errorMessage : JSON.stringify(errorMessage);
        const cleanMessage = message.replace(/['"]/g, '').trim().toLowerCase();
        return Object.keys(this.knownErrors).find(key => cleanMessage.includes(key.toLowerCase()));
    }

    shouldReportError(errorType) {
        const doNotReportErrors = ['network_timeout', 'user_cancel'];
        return !doNotReportErrors.includes(errorType);
    }

    handlePlacesRestantesError() {
        console.warn("ApiErrorHandler: Tentative de récupération de l'erreur 'places_restantes'.");
        if (typeof window.dashboardConfig !== 'undefined') {
            window.dashboardConfig.useFallbackEndpoints = true;
        }
        document.querySelectorAll('.places-count, .places-dispo').forEach(element => {
            if (!element.dataset.originalText) element.dataset.originalText = element.textContent;
            if (!element.classList.contains('data-error')) {
                element.classList.add('data-error', 'text-danger');
                element.innerHTML = '<i class="fas fa-exclamation-circle me-1"></i> ? / ?';
                element.title = 'Données des places temporairement indisponibles.';
                if (typeof bootstrap !== 'undefined' && bootstrap.Tooltip) {
                    const tooltip = bootstrap.Tooltip.getInstance(element);
                    if (tooltip) tooltip.dispose();
                    new bootstrap.Tooltip(element);
                }
            }
        });
        this.hasAppliedPlacesRestantesFix = true;
        if (typeof window.forcePollingUpdate === 'function') setTimeout(() => window.forcePollingUpdate(true), 1000);
        this.showUserNotification('dashboard_essential', 500, 'Certaines données (places) sont indisponibles. Tentative de récupération...');
        return true;
    }

    handleMaxParticipantsError() { /* Similaire à places_restantes */ console.warn("ApiErrorHandler: Handling MaxParticipantsError."); return true; }
    handleTypeError() { /* Logique de récupération pour TypeError */ console.warn("ApiErrorHandler: Handling TypeError."); return true; }
    handleUndefinedError() { /* Logique de récupération pour undefined */ console.warn("ApiErrorHandler: Handling UndefinedError."); return true; }

    handleServerError(endpoint, errorData) {
        const msg = errorData?.message || (typeof errorData === 'string' ? errorData : 'Erreur interne du serveur.');
        if (msg.includes('places_restantes') || msg.includes('max_participants')) {
            return this.handleDataModelError(endpoint, msg);
        }
        if (msg.toLowerCase().includes('database') || msg.toUpperCase().includes('SQL') || msg.toLowerCase().includes('query')) {
            return this.handleDatabaseError(endpoint);
        }
        this.showUserNotification(endpoint, 500, `Erreur serveur: ${msg}`);
        return false;
    }

    handleNotFoundError(endpoint) {
        let resourceType = "ressource";
        if (endpoint.includes('session')) resourceType = "session";
        else if (endpoint.includes('participant')) resourceType = "participant";
        this.showUserNotification(endpoint, 404, `${resourceType.charAt(0).toUpperCase() + resourceType.slice(1)} introuvable. Elle a peut-être été supprimée.`);
        return true;
    }

    handleAuthError(statusCode, endpoint = 'auth') {
        const message = statusCode === 401
            ? 'Votre session a expiré ou vous n\'êtes pas connecté. Veuillez vous reconnecter.'
            : 'Vous n\'avez pas les droits nécessaires pour cette action.';
        this.showUserNotification(endpoint, statusCode, message);
        if (statusCode === 401 && !window.location.pathname.startsWith('/login')) {
            setTimeout(() => {
                window.location.href = `/login?next=${encodeURIComponent(window.location.pathname + window.location.search)}`;
            }, 3000);
        }
        return true;
    }

    handleDataModelError(endpoint, errorMessage) {
        if (errorMessage.includes('places_restantes')) return this.handlePlacesRestantesError();
        if (errorMessage.includes('max_participants')) return this.handleMaxParticipantsError();
        this.showUserNotification(endpoint, 500, 'Erreur de données. Certaines informations peuvent être incorrectes.');
        return true;
    }

    handleDatabaseError(endpoint) {
        this.showUserNotification(endpoint, 500, 'Erreur de base de données. Veuillez réessayer plus tard.');
        return true;
    }

    showUserNotification(endpoint, statusCode, customMessage = null) {
        let message = customMessage || 'Une erreur est survenue lors du chargement des données.';
        let theme = 'warning';

        if (statusCode >= 500) theme = 'danger';
        else if (statusCode === 404) theme = 'info';
        else if (statusCode === 401 || statusCode === 403) theme = 'danger';
        else if (statusCode === 0) theme = 'secondary'; // Erreur réseau ou timeout

        if (typeof window.showToast === 'function') {
            window.showToast(message, theme);
        } else {
            console.error('Notification (showToast non disponible):', message);
        }
    }

    collectErrorMetrics(endpoint, errorData, statusCode) {
        this.errorMetrics.totalErrors++;
        this.errorMetrics.byEndpoint[endpoint] = (this.errorMetrics.byEndpoint[endpoint] || 0) + 1;
        const errorType = errorData?.message || `status_${statusCode}`;
        this.errorMetrics.byErrorType[errorType] = (this.errorMetrics.byErrorType[errorType] || 0) + 1;
    }

    // reportErrorToServer(endpoint, errorData, errorType) { /* ... */ }

    checkAndFixBrokenElements() {
        let repairsMade = false;
        document.querySelectorAll('.places-dispo, .places-count').forEach(el => {
            const text = el.textContent.trim();
            if (text.includes('NaN') || text.includes('undefined') || text.includes('null') || text === '/ ' || text === ' / ' || text === '? / ?') {
                if (!el.classList.contains('data-error')) {
                    el.classList.add('data-error', 'text-danger');
                    el.innerHTML = '<i class="fas fa-exclamation-circle me-1"></i> ? / ?';
                    el.title = 'Données temporairement indisponibles';
                    repairsMade = true;
                }
            }
        });
        document.querySelectorAll('.counter-value, .stat-value, .badge-count').forEach(el => {
            const text = el.textContent.trim();
            if (text === 'NaN' || text === 'undefined' || text === '' || text === 'null' || text === '—') {
                el.textContent = '—';
                el.classList.add('text-muted');
                el.title = 'Valeur indisponible';
                repairsMade = true;
            }
        });
        if (repairsMade && this.options.logToConsole) console.log("ApiErrorHandler: UI elements repaired.");
        return repairsMade;
    }
}

// Créer et assigner l'instance à window
window.apiErrorHandler = new ApiErrorHandler({
    logToConsole: (window.dashboardConfig && window.dashboardConfig.debugMode) || false
});

// Intégration avec le système existant (si uiFixers est utilisé)
if (typeof window.uiFixers !== 'undefined' && typeof window.uiFixers.applyAllFixes === 'function') {
    window.uiFixers.apiErrorHandler = window.apiErrorHandler;
    const originalApplyAllFixes = window.uiFixers.applyAllFixes;
    window.uiFixers.applyAllFixes = function() {
        originalApplyAllFixes.apply(this, arguments);
        try {
            window.apiErrorHandler.checkAndFixBrokenElements();
        } catch (e) {
            console.error('Error in enhanced applyAllFixes (ApiErrorHandler):', e);
        }
    };
}

// Interception globale des erreurs de fetch pour les endpoints API
if (typeof window.fetch === 'function') {
    const originalFetch = window.fetch;
    window.fetch = async function(...args) {
        const url = typeof args[0] === 'string' ? args[0] : (args[0] instanceof Request ? args[0].url : null);
        try {
            const response = await originalFetch.apply(this, args);
            if (url && url.includes('/api/') && !response.ok) {
                let errorData = null;
                try {
                    errorData = await response.clone().json();
                } catch (e) {
                    try {
                        errorData = { message: await response.clone().text() };
                    } catch (textErr) {
                        errorData = { message: `Erreur ${response.status} non-JSON et texte illisible` };
                    }
                }
                window.apiErrorHandler.handleApiError(url, errorData, response.status);
            }
            return response;
        } catch (error) {
            if (url) {
                 window.apiErrorHandler.handleApiError(url, { message: error.message, name: error.name }, 0);
            } else {
                console.error('Fetch network error (URL non déterminée):', error);
            }
            throw error;
        }
    };
}

// PAS D'EXPORT ICI car inclus via <script src="...">
