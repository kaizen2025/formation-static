/**
 * dashboard-core.js - Fichier JavaScript optimisé pour le tableau de bord
 * Remplace: polling-updates.js, ui-fixers.js, charts-enhanced.js, static-charts.js
 * Version: 1.0.0 - Solution optimisée et allégée
 */

document.addEventListener('DOMContentLoaded', function() {
    console.log('Dashboard Core: Initializing (v1.0.0)');

    // Configuration centralisée (utiliser la config globale si définie, sinon valeurs par défaut)
    const config = window.dashboardConfig || {
        debugMode: false,
        refreshInterval: 120000, // 2 minutes entre les actualisations
        baseApiUrl: '/api',
        chartRendering: 'auto' // 'auto', 'chartjs' ou 'static'
    };

    // État global du tableau de bord
    let dashboardState = {
        lastRefresh: 0,
        updating: false,
        dataHashes: {},
        errorCount: 0,
        maxErrors: 5,
        pollingActive: true,
        pollingInterval: null,
        themeChart: null,
        serviceChart: null
    };

    // ====== INITIALISATION ET CYCLE DE VIE ======

    /**
     * Initialise tous les composants du tableau de bord
     */
    function initializeDashboard() {
        // Initialiser les améliorations UI de base
        enhanceUI();

        // Initialiser les écouteurs d'événements
        setupEventListeners();

        // Initialiser les graphiques (si les canvas sont présents)
        initializeCharts();

        // Première récupération de données
        fetchDashboardData(true).then(() => {
            // Montrer le nombre total d'inscriptions dans le donut chart center
            updateDonutTotal();
        });

        // Démarrer le polling périodique
        startPolling();

        console.log('Dashboard Core: Initialization complete.');
    }

    /**
     * Démarre le polling pour les actualisations de données
     */
    function startPolling() {
        if (dashboardState.pollingInterval) {
            clearInterval(dashboardState.pollingInterval);
        }

        dashboardState.pollingInterval = setInterval(() => {
            if (dashboardState.pollingActive && document.visibilityState === 'visible') {
                fetchDashboardData();
            }
        }, config.refreshInterval);

        console.log(`Dashboard Core: Polling started (interval: ${config.refreshInterval}ms)`);
    }

    /**
     * Met en place les écouteurs d'événements pour le tableau de bord
     */
    function setupEventListeners() {
        // Surveiller la visibilité de l'onglet
        document.addEventListener('visibilitychange', () => {
            if (document.visibilityState === 'visible') {
                console.log('Dashboard Core: Tab visible, triggering refresh');
                // Déclencher une actualisation lorsque l'onglet redevient actif
                fetchDashboardData();
            }
        });

        // Bouton d'actualisation manuelle
        const refreshButton = document.getElementById('refresh-dashboard');
        if (refreshButton) {
            refreshButton.addEventListener('click', function() {
                this.disabled = true;
                this.innerHTML = '<i class="fas fa-sync-alt fa-spin me-1"></i>Actualisation...';

                // Afficher un overlay de chargement si disponible
                const overlay = document.getElementById('loading-overlay');
                if (overlay) overlay.style.display = 'flex';

                // Forcer une actualisation complète
                fetchDashboardData(true)
                    .then(() => {
                        if (config.debugMode) console.log('Dashboard Core: Manual refresh completed');
                        showToast('Données actualisées avec succès', 'success');
                    })
                    .catch(err => {
                        console.error('Dashboard Core: Error during manual refresh:', err);
                        showToast('Erreur lors de l\'actualisation des données', 'danger');
                    })
                    .finally(() => {
                        // Restaurer le bouton d'actualisation
                        this.disabled = false;
                        this.innerHTML = '<i class="fas fa-sync-alt me-1"></i>Actualiser';
                        // Masquer l'overlay
                        if (overlay) overlay.style.display = 'none';
                    });
            });
        }

        // Écouter les actions de validation AJAX
        setupValidationListeners();

        // Utiliser MutationObserver pour un suivi efficace des changements DOM
        setupMutationObserver();
    }

    /**
     * Configure un observateur de mutations pour surveiller les changements DOM importants
     */
    function setupMutationObserver() {
        if (!window.MutationObserver) return;

        let observerTimeout = null;
        const observer = new MutationObserver(function(mutations) {
            // Vérifier si les mutations sont pertinentes (tables, badges, places disponibles)
            let important = false;
            for (const mutation of mutations) {
                if (mutation.type === 'childList' && mutation.addedNodes.length > 0) {
                    for (const node of mutation.addedNodes) {
                        if (node.nodeType === 1) { // Element node
                            if (node.classList && (
                                node.classList.contains('places-dispo') ||
                                node.classList.contains('theme-badge') ||
                                node.classList.contains('counter-value') ||
                                node.querySelector('.places-dispo, .theme-badge, .counter-value')
                            )) {
                                important = true;
                                break;
                            }
                        }
                    }
                }
                if (important) break;
            }

            // Si changements importants, debounce les corrections UI
            if (important) {
                clearTimeout(observerTimeout);
                observerTimeout = setTimeout(() => {
                    fixDataIssues();
                    enhanceBadgesAndLabels();
                }, 300);
            }
        });

        // Observer seulement les changements pertinents
        observer.observe(document.body, {
            childList: true,
            subtree: true,
            characterData: false,
            attributeFilter: ['class', 'data-session-id', 'data-full']
        });

        if (config.debugMode) console.log('Dashboard Core: Mutation observer initialized');
    }

    // ====== COMMUNICATION AVEC L'API ======

    /**
     * Récupère les données du tableau de bord depuis l'API
     * @param {boolean} forceRefresh Force une actualisation complète en ignorant le cache
     * @returns {Promise} Promise qui se résout quand les données sont traitées
     */
    async function fetchDashboardData(forceRefresh = false) {
        // Éviter les requêtes simultanées
        if (dashboardState.updating) {
            console.log('Dashboard Core: Skipping fetch (update in progress)');
            return Promise.resolve(false);
        }

        // Vérifier le délai minimal entre les requêtes (sauf pour forceRefresh)
        const now = Date.now();
        if (!forceRefresh && now - dashboardState.lastRefresh < 10000) { // Min 10 secondes entre les requêtes standard
            console.log('Dashboard Core: Skipping fetch (too soon)');
            return Promise.resolve(false);
        }

        dashboardState.updating = true;
        dashboardState.lastRefresh = now;

        try {
            // Construire l'URL avec un cache buster
            const url = `${config.baseApiUrl}/dashboard_essential?_=${Date.now()}`;
            console.log(`Dashboard Core: Fetching data from ${url}`);

            const response = await fetch(url, {
                method: 'GET',
                headers: {
                    'Accept': 'application/json',
                    'X-Requested-With': 'XMLHttpRequest'
                }
            });

            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }

            const data = await response.json();
            
            // Traiter et valider les données
            const hasChanged = processData(data, forceRefresh);

            // Réinitialiser le compteur d'erreurs en cas de succès
            dashboardState.errorCount = 0;

            // Déclencher un événement pour signaler que les données ont été mises à jour
            if (hasChanged) {
                console.log('Dashboard Core: Data updated, triggering dashboardDataRefreshed event');
                document.dispatchEvent(new CustomEvent('dashboardDataRefreshed', {
                    detail: { data: data }
                }));
            } else {
                console.log('Dashboard Core: No significant data changes detected');
            }

            return hasChanged;

        } catch (error) {
            console.error('Dashboard Core: Error fetching dashboard data:', error);
            dashboardState.errorCount++;

            // Si trop d'erreurs, suspendre le polling
            if (dashboardState.errorCount >= dashboardState.maxErrors) {
                console.error(`Dashboard Core: Too many errors (${dashboardState.errorCount}), pausing polling`);
                dashboardState.pollingActive = false;
                clearInterval(dashboardState.pollingInterval);
                showErrorWarning(true);
            }

            // Tenter de récupérer avec des requêtes individuelles
            await fallbackToIndividualRequests();
            return false;
        } finally {
            dashboardState.updating = false;
        }
    }

    /**
     * Traite les données reçues de l'API et met à jour l'interface
     * @param {Object} data Les données du tableau de bord
     * @param {boolean} forceRefresh Ignorer la vérification du hash et forcer la mise à jour
     * @returns {boolean} True si des données ont changé et ont été mises à jour
     */
    function processData(data, forceRefresh = false) {
        if (!data) return false;
        let hasChanged = forceRefresh;

        // Traiter les sessions
        if (data.sessions && Array.isArray(data.sessions)) {
            // Validation et correction des données de session
            const validatedSessions = data.sessions.map(session => {
                // S'assurer que places_restantes est calculé correctement
                if (typeof session.places_restantes !== 'number' || isNaN(session.places_restantes)) {
                    session.places_restantes = Math.max(0, (session.max_participants || 0) - (session.inscrits || 0));
                }
                return session;
            });

            // Calculer le hash des données
            const sessionsHash = simpleHash(validatedSessions);
            if (forceRefresh || sessionsHash !== dashboardState.dataHashes.sessions) {
                // Mise à jour du tableau des sessions
                updateSessionTable(validatedSessions);
                // Mise à jour des graphiques avec les nouvelles données
                updateCharts(validatedSessions, data.participants || []);
                // Mise à jour des compteurs
                updateStatisticsCounters(validatedSessions);
                // Sauvegarder le hash
                dashboardState.dataHashes.sessions = sessionsHash;
                hasChanged = true;
            }
        }

        // Traiter les activités
        if (data.activites && Array.isArray(data.activites)) {
            const activitiesHash = simpleHash(data.activites);
            if (forceRefresh || activitiesHash !== dashboardState.dataHashes.activites) {
                updateActivityFeed(data.activites);
                dashboardState.dataHashes.activites = activitiesHash;
                hasChanged = true;
            }
        }

        // Appliquer les améliorations UI
        if (hasChanged) {
            setTimeout(() => {
                fixDataIssues();
                enhanceBadgesAndLabels();
                initTooltips();
            }, 100);
        }

        return hasChanged;
    }

    /**
     * Fallback pour récupérer les données via des requêtes individuelles
     * en cas d'échec de l'endpoint combiné
     */
    async function fallbackToIndividualRequests() {
        console.log('Dashboard Core: Attempting individual endpoint fallback');
        const individualData = {};

        try {
            // Récupérer les sessions
            const sessionsResponse = await fetch(`${config.baseApiUrl}/sessions?_=${Date.now()}`);
            if (sessionsResponse.ok) {
                const sessionsData = await sessionsResponse.json();
                individualData.sessions = Array.isArray(sessionsData) ? 
                    sessionsData : (sessionsData.items || []);
            }

            // Récupérer les activités
            const activitiesResponse = await fetch(`${config.baseApiUrl}/activites?_=${Date.now()}`);
            if (activitiesResponse.ok) {
                const activitiesData = await activitiesResponse.json();
                individualData.activites = Array.isArray(activitiesData) ? 
                    activitiesData : (activitiesData.items || []);
            }

            // Traiter les données récupérées
            if (individualData.sessions || individualData.activites) {
                processData(individualData, true);
                return true;
            }
        } catch (error) {
            console.error('Dashboard Core: Fallback request failed:', error);
        }

        return false;
    }

    // ====== MISE À JOUR DES COMPOSANTS UI ======

    /**
     * Met à jour le tableau des sessions avec les nouvelles données
     * @param {Array} sessions Liste des sessions à afficher
     */
    function updateSessionTable(sessions) {
        if (!sessions || !Array.isArray(sessions)) return;

        const sessionTableBody = document.querySelector('.session-table tbody');
        if (!sessionTableBody) return;

        // Pour chaque session dans les données
        sessions.forEach(session => {
            // Trouver la ligne correspondante dans le tableau
            const row = sessionTableBody.querySelector(`tr[data-session-id="${session.id}"]`);
            if (!row) return;

            // Mettre à jour les places disponibles
            const placesCell = row.querySelector('.places-dispo');
            if (placesCell) {
                placesCell.textContent = `${session.places_restantes} / ${session.max_participants}`;
                
                // Mettre à jour les classes CSS
                placesCell.classList.remove('text-success', 'text-warning', 'text-danger');
                if (session.places_restantes <= 0) {
                    placesCell.classList.add('text-danger');
                } else if (session.places_restantes <= Math.floor(session.max_participants * 0.3)) {
                    placesCell.classList.add('text-warning');
                } else {
                    placesCell.classList.add('text-success');
                }
            }

            // Mettre à jour le badge des participants
            const participantsBadge = row.querySelector('.btn-outline-secondary .badge');
            if (participantsBadge) {
                participantsBadge.textContent = session.inscrits || 0;
            }

            // Mettre à jour l'attribut data-full
            row.dataset.full = (session.places_restantes <= 0) ? '1' : '0';
        });
    }

    /**
     * Met à jour les compteurs de statistiques globales
     * @param {Array} sessions Liste des sessions pour calculer les statistiques
     */
    function updateStatisticsCounters(sessions) {
        if (!sessions || !Array.isArray(sessions)) return;

        // Calculer les totaux
        let totalInscriptions = 0;
        let totalEnAttente = 0;
        let totalSessionsCompletes = 0;
        const totalSessions = sessions.length;

        sessions.forEach(session => {
            if (typeof session.inscrits === 'number') {
                totalInscriptions += session.inscrits;
            }
            
            if (typeof session.liste_attente === 'number') {
                totalEnAttente += session.liste_attente;
            }
            
            if (typeof session.places_restantes === 'number' && session.places_restantes <= 0) {
                totalSessionsCompletes++;
            }
        });

        // Mettre à jour les éléments DOM
        updateCounter('total-inscriptions', totalInscriptions);
        updateCounter('total-en-attente', totalEnAttente);
        updateCounter('total-sessions', totalSessions);
        updateCounter('total-sessions-completes', totalSessionsCompletes);
    }

    /**
     * Met à jour un compteur avec une animation
     * @param {string} elementId ID de l'élément à mettre à jour
     * @param {number} newValue Nouvelle valeur à afficher
     */
    function updateCounter(elementId, newValue) {
        const element = document.getElementById(elementId);
        if (!element) return;

        const currentValue = parseInt(element.textContent.replace(/[^\d]/g, '')) || 0;

        // Ne mettre à jour que si la valeur a changé
        if (currentValue !== newValue) {
            // Animation simple par défaut
            element.textContent = newValue.toLocaleString();

            // Animation plus élaborée si disponible
            if (typeof window.animateCounter === 'function') {
                window.animateCounter(element, currentValue, newValue);
            }
        }
    }

    /**
     * Met à jour le flux d'activités récentes
     * @param {Array} activities Liste des activités à afficher
     */
    function updateActivityFeed(activities) {
        if (!activities || !Array.isArray(activities)) return;

        const container = document.getElementById('recent-activity');
        if (!container) return;

        // Supprimer le spinner de chargement si présent
        const spinner = container.querySelector('.loading-spinner');
        if (spinner) spinner.remove();

        // Si aucune activité, afficher un message
        if (activities.length === 0) {
            container.innerHTML = '<div class="text-center p-3 text-muted">Aucune activité récente</div>';
            return;
        }

        // Construire le HTML des activités
        let html = '';
        activities.forEach(activity => {
            const icon = getActivityIcon(activity.type);
            const userInfo = activity.user ? `<span class="text-primary">${activity.user}</span>` : '';
            
            html += `
            <div class="activity-item" data-activity-id="${activity.id}">
                <div class="activity-icon">
                    <i class="${icon}"></i>
                </div>
                <div class="activity-content">
                    <div class="activity-title">
                        ${activity.description} ${userInfo}
                    </div>
                    <div class="activity-subtitle">
                        ${activity.details ? `<small>${activity.details}</small><br>` : ''}
                        <small class="text-muted">${activity.date_relative || ''}</small>
                    </div>
                </div>
            </div>`;
        });

        // Mettre à jour le contenu
        container.innerHTML = html;

        // Animer les éléments
        container.querySelectorAll('.activity-item').forEach((el, index) => {
            el.style.animationDelay = `${index * 50}ms`;
            el.classList.add('fade-in');
        });
    }

    /**
     * Obtient l'icône appropriée pour un type d'activité
     * @param {string} type Type d'activité
     * @returns {string} Classe CSS de l'icône
     */
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
            'reinscription': 'fas fa-redo text-info',
            'liste_attente': 'fas fa-clock text-warning',
            'ajout_theme': 'fas fa-folder-plus text-primary',
            'ajout_service': 'fas fa-building text-primary',
            'ajout_salle': 'fas fa-door-open text-primary',
            'attribution_salle': 'fas fa-map-marker-alt text-info',
            'systeme': 'fas fa-cog text-secondary',
            'notification': 'fas fa-bell text-warning',
            'default': 'fas fa-info-circle text-secondary'
        };
        return iconMap[type] || iconMap.default;
    }

    // ====== AMÉLIORATION ET CORRECTION UI ======

    /**
     * Améliore l'interface utilisateur avec diverses corrections et améliorations
     */
    function enhanceUI() {
        initTooltips();
        enhanceBadgesAndLabels();
        fixDataIssues();
        enhanceAccessibility();
    }

    /**
     * Initialise les tooltips Bootstrap
     */
    function initTooltips() {
        if (typeof bootstrap === 'undefined' || typeof bootstrap.Tooltip !== 'function') return;

        const tooltipTriggerList = document.querySelectorAll('[data-bs-toggle="tooltip"], [title]:not(iframe):not(script):not(style)');
        tooltipTriggerList.forEach(el => {
            // Éviter de réinitialiser les tooltips déjà configurés
            if (!bootstrap.Tooltip.getInstance(el)) {
                try {
                    new bootstrap.Tooltip(el, {
                        container: 'body',
                        boundary: document.body
                    });
                } catch (e) {
                    if (config.debugMode) console.warn('Dashboard Core: Error creating tooltip', e);
                }
            }
        });
    }

    /**
     * Améliore les badges et étiquettes dans le document
     */
    function enhanceBadgesAndLabels() {
        // Si une fonction globale existe déjà, l'utiliser
        if (typeof window.enhanceThemeBadgesGlobally === 'function') {
            window.enhanceThemeBadgesGlobally();
        } else {
            // Implémentation personnalisée pour les badges de thème
            document.querySelectorAll('.theme-badge').forEach(badge => {
                if (badge.dataset.enhanced === 'true') return;
                
                const themeName = badge.textContent.trim();
                
                // Ajouter les classes CSS appropriées
                if (themeName.includes('Teams') && themeName.includes('Communiquer')) {
                    badge.classList.add('theme-comm');
                } else if (themeName.includes('Planner')) {
                    badge.classList.add('theme-planner');
                } else if (themeName.includes('OneDrive') || themeName.includes('fichiers')) {
                    badge.classList.add('theme-onedrive');
                } else if (themeName.includes('Collaborer')) {
                    badge.classList.add('theme-sharepoint');
                }
                
                badge.dataset.enhanced = 'true';
            });
        }

        // Améliorer l'affichage des badges de salle
        document.querySelectorAll('.js-salle-cell').forEach(cell => {
            const textContent = cell.textContent.trim();
            if (!cell.querySelector('.salle-badge') && textContent) {
                if (textContent === 'Non définie' || textContent === 'N/A') {
                    cell.innerHTML = '<span class="badge bg-secondary salle-badge">Non définie</span>';
                } else {
                    cell.innerHTML = `<span class="badge bg-info salle-badge">${textContent}</span>`;
                }
            }
        });
    }

    /**
     * Corrige les problèmes de données dans l'interface
     */
    function fixDataIssues() {
        // Correction des badges de places disponibles
        document.querySelectorAll('.places-dispo').forEach(el => {
            const text = el.textContent.trim();
            
            // Vérifier si le format est valide
            if (text.includes('/')) {
                const parts = text.split('/');
                const available = parseInt(parts[0].trim());
                const total = parseInt(parts[1].trim());
                
                if (!isNaN(available) && !isNaN(total)) {
                    // Ajouter l'icône et le style appropriés
                    let icon, colorClass;
                    
                    if (available <= 0) {
                        icon = 'fa-times-circle';
                        colorClass = 'text-danger';
                    } else if (available <= 0.2 * total) {
                        icon = 'fa-exclamation-circle';
                        colorClass = 'text-danger';
                    } else if (available <= 0.4 * total) {
                        icon = 'fa-exclamation-triangle';
                        colorClass = 'text-warning';
                    } else {
                        icon = 'fa-check-circle';
                        colorClass = 'text-success';
                    }
                    
                    // Ne modifier que si nécessaire
                    if (!el.querySelector('.fas') || !el.classList.contains(colorClass)) {
                        el.classList.remove('text-success', 'text-warning', 'text-danger');
                        el.classList.add(colorClass);
                        el.innerHTML = `<i class="fas ${icon} me-1"></i> ${available} / ${total}`;
                    }
                }
            } else if (text === 'NaN / NaN' || text.includes('undefined') || text === '/ ' || text === ' / ') {
                // Cas d'erreur détecté
                el.classList.remove('text-success', 'text-warning', 'text-danger');
                el.classList.add('text-secondary');
                el.innerHTML = '<i class="fas fa-question-circle me-1"></i> ? / ?';
                el.title = 'Données temporairement indisponibles';
            }
        });

        // Correction des compteurs vides ou invalides
        document.querySelectorAll('.counter-value').forEach(counter => {
            const text = counter.textContent.trim();
            if (text === '' || text === 'undefined' || text === 'null' || text === 'NaN') {
                counter.textContent = '0';
            }
        });

        // Correction des tableaux vides
        document.querySelectorAll('table tbody').forEach(tbody => {
            if (!tbody.querySelector('tr')) {
                const cols = tbody.closest('table').querySelectorAll('thead th').length || 3;
                tbody.innerHTML = `<tr><td colspan="${cols}" class="text-center p-3 text-muted">Aucune donnée disponible</td></tr>`;
            }
        });
    }

    /**
     * Améliore l'accessibilité des éléments de la page
     */
    function enhanceAccessibility() {
        // Ajouter des attributs alt aux images
        document.querySelectorAll('img:not([alt])').forEach(img => {
            const filename = img.src.split('/').pop().split('?')[0];
            const name = filename.split('.')[0].replace(/[_-]/g, ' ');
            img.setAttribute('alt', name || 'Image');
        });
        
        // S'assurer que les boutons ont un type
        document.querySelectorAll('button:not([type])').forEach(button => {
            button.setAttribute('type', button.closest('form') ? 'submit' : 'button');
        });
    }

    /**
     * Affiche ou masque l'avertissement d'erreur backend
     * @param {boolean} show Afficher ou masquer l'avertissement
     */
    function showErrorWarning(show) {
        let errorDiv = document.getElementById('backend-error-warning');
        
        if (show && !errorDiv) {
            errorDiv = document.createElement('div');
            errorDiv.id = 'backend-error-warning';
            errorDiv.className = 'alert alert-warning alert-dismissible fade show small p-2 mt-2 mx-4';
            errorDiv.innerHTML = `
                <i class="fas fa-exclamation-triangle me-2"></i>
                Problème de communication avec le serveur. Certaines informations peuvent être temporairement indisponibles.
                <button type="button" class="btn-close p-2" data-bs-dismiss="alert" aria-label="Close"></button>
            `;
            
            const content = document.getElementById('dashboard-content');
            if (content) content.prepend(errorDiv);
        } else if (!show && errorDiv) {
            errorDiv.remove();
        }
    }

    /**
     * Configure les écouteurs pour les validations AJAX
     */
    function setupValidationListeners() {
        document.querySelectorAll('.validation-ajax').forEach(button => {
            button.addEventListener('click', function() {
                const inscriptionId = this.getAttribute('data-inscription-id');
                const action = this.getAttribute('data-action');
                
                if (!inscriptionId || !action) return;
                
                // Désactiver le bouton
                this.disabled = true;
                
                fetch('/validation_inscription_ajax', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ inscription_id: inscriptionId, action: action })
                })
                .then(response => response.json())
                .then(data => {
                    if (data.success) {
                        showToast(data.message, 'success');
                        // Actualiser les données
                        fetchDashboardData(true);
                        // Fermer la modale
                        setTimeout(() => {
                            const modal = this.closest('.modal');
                            if (modal && typeof bootstrap !== 'undefined') {
                                const modalInstance = bootstrap.Modal.getInstance(modal);
                                if (modalInstance) modalInstance.hide();
                            }
                        }, 1000);
                    } else {
                        showToast(data.message || 'Erreur lors de la validation', 'danger');
                        this.disabled = false;
                    }
                })
                .catch(error => {
                    console.error('Error:', error);
                    showToast('Erreur de communication avec le serveur', 'danger');
                    this.disabled = false;
                });
            });
        });
    }

    // ====== GESTION DES GRAPHIQUES ======

    /**
     * Initialise les graphiques si Chart.js est disponible
     */
    function initializeCharts() {
        const hasChartJs = typeof Chart !== 'undefined';
        const chartMode = config.chartRendering === 'auto' ? 
            (hasChartJs ? 'chartjs' : 'static') : config.chartRendering;

        // Cacher/montrer les éléments appropriés selon le mode
        if (chartMode === 'chartjs') {
            document.querySelectorAll('.static-chart-donut, .static-chart-bars').forEach(el => {
                el.style.display = 'none';
            });
        } else {
            document.querySelectorAll('#themeChartCanvas, #serviceChartCanvas').forEach(el => {
                el.style.display = 'none';
            });
            document.querySelectorAll('.static-chart-donut, .static-chart-bars').forEach(el => {
                el.style.display = 'block';
            });
        }

        if (config.debugMode) {
            console.log(`Dashboard Core: Chart rendering mode: ${chartMode}`);
        }
    }

    /**
     * Met à jour les graphiques avec de nouvelles données
     * @param {Array} sessions Données des sessions pour le graphique des thèmes
     * @param {Array} participants Données des participants pour le graphique des services
     */
    function updateCharts(sessions, participants) {
        const hasChartJs = typeof Chart !== 'undefined';
        const chartMode = config.chartRendering === 'auto' ? 
            (hasChartJs ? 'chartjs' : 'static') : config.chartRendering;

        if (chartMode === 'chartjs' && hasChartJs) {
            updateChartJsCharts(sessions, participants);
        } else {
            updateStaticCharts(sessions, participants);
        }
    }

    /**
     * Met à jour les graphiques Chart.js
     * @param {Array} sessions Données des sessions
     * @param {Array} participants Données des participants
     */
    function updateChartJsCharts(sessions, participants) {
        // Mise à jour du graphique des thèmes
        updateThemeChart(sessions);
        
        // Mise à jour du graphique des services
        updateServiceChart(participants);
    }

    /**
     * Met à jour le graphique des thèmes avec Chart.js
     * @param {Array} sessions Données des sessions
     */
    function updateThemeChart(sessions) {
        const canvas = document.getElementById('themeChartCanvas');
        if (!canvas) return;
        
        // Calculer les données par thème
        const themeCounts = {};
        sessions.forEach(session => {
            if (session.theme && typeof session.inscrits === 'number') {
                const themeName = typeof session.theme === 'string' ? 
                    session.theme : (session.theme.nom || 'Inconnu');
                themeCounts[themeName] = (themeCounts[themeName] || 0) + session.inscrits;
            }
        });
        
        // Préparer les données pour le graphique
        const labels = Object.keys(themeCounts);
        const data = labels.map(label => themeCounts[label]);
        const backgroundColor = labels.map(label => {
            // Utiliser les couleurs de thème définies globalement si disponibles
            return window.themesDataForChart && window.themesDataForChart[label] ? 
                window.themesDataForChart[label].color : getRandomColor(label);
        });
        
        // Mettre à jour le total au centre du donut
        const total = data.reduce((a, b) => a + b, 0);
        updateDonutTotal(total);
        
        // Créer ou mettre à jour le graphique
        if (dashboardState.themeChart) {
            dashboardState.themeChart.data.labels = labels;
            dashboardState.themeChart.data.datasets[0].data = data;
            dashboardState.themeChart.data.datasets[0].backgroundColor = backgroundColor;
            dashboardState.themeChart.update();
        } else {
            const ctx = canvas.getContext('2d');
            if (ctx) {
                dashboardState.themeChart = new Chart(ctx, {
                    type: 'doughnut',
                    data: {
                        labels: labels,
                        datasets: [{
                            data: data,
                            backgroundColor: backgroundColor,
                            borderWidth: 2,
                            borderColor: '#fff'
                        }]
                    },
                    options: {
                        responsive: true,
                        maintainAspectRatio: false,
                        cutout: '65%',
                        plugins: {
                            legend: {
                                position: 'bottom',
                                labels: {
                                    padding: 15,
                                    boxWidth: 12,
                                    font: { size: 11 }
                                }
                            }
                        }
                    }
                });
            }
        }
    }

    /**
     * Met à jour le graphique des services avec Chart.js
     * @param {Array} participants Données des participants
     */
    function updateServiceChart(participants) {
        const canvas = document.getElementById('serviceChartCanvas');
        if (!canvas) return;
        
        // Calculer les données par service
        const serviceCounts = {};
        participants.forEach(participant => {
            let serviceName = 'N/A';
            if (typeof participant.service === 'string') {
                serviceName = participant.service;
            } else if (participant.service && participant.service.nom) {
                serviceName = participant.service.nom;
            }
            serviceCounts[serviceName] = (serviceCounts[serviceName] || 0) + 1;
        });
        
        // Préparer les données pour le graphique
        const sortedServices = Object.entries(serviceCounts)
            .sort((a, b) => b[1] - a[1])
            .map(([name, count]) => ({ name, count }));
        
        const labels = sortedServices.map(s => s.name);
        const data = sortedServices.map(s => s.count);
        const backgroundColor = labels.map(label => {
            // Utiliser les couleurs de service définies globalement si disponibles
            return window.servicesDataForChart && window.servicesDataForChart[label] ? 
                window.servicesDataForChart[label].color : getRandomColor(label);
        });
        
        // Créer ou mettre à jour le graphique
        if (dashboardState.serviceChart) {
            dashboardState.serviceChart.data.labels = labels;
            dashboardState.serviceChart.data.datasets[0].data = data;
            dashboardState.serviceChart.data.datasets[0].backgroundColor = backgroundColor;
            dashboardState.serviceChart.update();
        } else {
            const ctx = canvas.getContext('2d');
            if (ctx) {
                dashboardState.serviceChart = new Chart(ctx, {
                    type: 'bar',
                    data: {
                        labels: labels,
                        datasets: [{
                            data: data,
                            backgroundColor: backgroundColor,
                            borderColor: backgroundColor,
                            borderWidth: 1,
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
            }
        }
    }

    /**
     * Met à jour les graphiques statiques (HTML/CSS)
     * @param {Array} sessions Données des sessions
     * @param {Array} participants Données des participants
     */
    function updateStaticCharts(sessions, participants) {
        updateStaticThemeChart(sessions);
        updateStaticServiceChart(participants);
    }

    /**
     * Met à jour le graphique statique des thèmes
     * @param {Array} sessions Données des sessions
     */
    function updateStaticThemeChart(sessions) {
        const container = document.querySelector('.static-chart-donut');
        if (!container) return;
        
        // Calculer les données par thème
        const themeCounts = {};
        sessions.forEach(session => {
            if (session.theme && typeof session.inscrits === 'number') {
                const themeName = typeof session.theme === 'string' ? 
                    session.theme : (session.theme.nom || 'Inconnu');
                themeCounts[themeName] = (themeCounts[themeName] || 0) + session.inscrits;
            }
        });
        
        // Calculer le total
        const total = Object.values(themeCounts).reduce((a, b) => a + b, 0);
        updateDonutTotal(total);
        
        // Vider le conteneur
        container.innerHTML = '';
        
        // Si pas de données, afficher un état vide
        if (Object.keys(themeCounts).length === 0) {
            container.innerHTML = '<div class="donut-center"><div class="donut-total">0</div><div class="donut-label">INSCRITS</div></div>';
            return;
        }
        
        // Créer les segments
        let startAngle = 0;
        Object.entries(themeCounts).forEach(([theme, count], index) => {
            const percentage = (count / total) * 100;
            const angle = (percentage / 100) * 360;
            const color = window.themesDataForChart && window.themesDataForChart[theme] ? 
                window.themesDataForChart[theme].color : getRandomColor(theme);
            
            // Créer le segment
            const segment = document.createElement('div');
            segment.className = 'donut-segment';
            segment.style.setProperty('--fill', color);
            segment.style.setProperty('--rotation', startAngle);
            segment.style.setProperty('--percentage', percentage);
            segment.style.setProperty('--index', index);
            segment.style.backgroundColor = color;
            container.appendChild(segment);
            
            startAngle += angle;
        });
        
        // Ajouter le centre
        const center = document.createElement('div');
        center.className = 'donut-center';
        center.innerHTML = `
            <div class="donut-total">${total}</div>
            <div class="donut-label">INSCRITS</div>
        `;
        container.appendChild(center);
        
        // Ajouter la classe d'animation
        container.classList.add('animate');
    }

    /**
     * Met à jour le graphique statique des services
     * @param {Array} participants Données des participants
     */
    function updateStaticServiceChart(participants) {
        const container = document.querySelector('.static-chart-bars');
        if (!container) return;
        
        // Calculer les données par service
        const serviceCounts = {};
        participants.forEach(participant => {
            let serviceName = 'N/A';
            if (typeof participant.service === 'string') {
                serviceName = participant.service;
            } else if (participant.service && participant.service.nom) {
                serviceName = participant.service.nom;
            }
            serviceCounts[serviceName] = (serviceCounts[serviceName] || 0) + 1;
        });
        
        // Trier par nombre décroissant
        const sortedServices = Object.entries(serviceCounts)
            .sort((a, b) => b[1] - a[1]);
        
        // Vider le conteneur
        container.innerHTML = '';
        
        // Si pas de données, afficher un état vide
        if (sortedServices.length === 0) {
            container.innerHTML = '<div class="text-center text-muted">Aucun participant</div>';
            return;
        }
        
        // Trouver la valeur maximale pour le calcul des pourcentages
        const maxCount = Math.max(...sortedServices.map(([_, count]) => count));
        
        // Créer les barres
        sortedServices.forEach(([service, count], index) => {
            const percentage = (count / maxCount) * 100;
            const color = window.servicesDataForChart && window.servicesDataForChart[service] ? 
                window.servicesDataForChart[service].color : getRandomColor(service);
            
            // Créer l'élément de barre
            const barItem = document.createElement('div');
            barItem.className = 'bar-item';
            
            barItem.innerHTML = `
                <div class="bar-header">
                    <div class="bar-label">
                        <i class="fas fa-users fa-sm me-1"></i>
                        ${service}
                    </div>
                    <div class="bar-total">${count}</div>
                </div>
                <div class="bar-container">
                    <div class="bar-value" 
                         style="width: ${percentage}%; background-color: ${color};" 
                         data-value="${count}" 
                         data-index="${index}"></div>
                </div>
            `;
            
            container.appendChild(barItem);
        });
        
        // Ajouter la classe d'animation
        container.classList.add('animate');
    }

    /**
     * Met à jour le total au centre du donut chart
     * @param {number} total Valeur totale à afficher
     */
    function updateDonutTotal(total = null) {
        const element = document.getElementById('chart-theme-total');
        if (element) {
            if (total === null) {
                // Calculer le total à partir du graphique si pas fourni
                if (dashboardState.themeChart && dashboardState.themeChart.data.datasets[0].data) {
                    total = dashboardState.themeChart.data.datasets[0].data.reduce((a, b) => a + b, 0);
                } else {
                    const staticChart = document.querySelector('.static-chart-donut');
                    if (staticChart) {
                        const segments = staticChart.querySelectorAll('.donut-segment');
                        const values = Array.from(segments).map(s => 
                            parseInt(s.getAttribute('data-value') || '0'));
                        total = values.reduce((a, b) => a + b, 0);
                    }
                }
            }
            
            if (total !== null) {
                element.textContent = total.toString();
            }
        }
    }

    // ====== UTILITAIRES ======

    /**
     * Affiche une notification toast
     * @param {string} message Le message à afficher
     * @param {string} type Le type de notification (success, danger, warning, info)
     */
    function showToast(message, type = 'info') {
        // Vérifier si la fonction globale existe
        if (typeof window.showToast === 'function') {
            window.showToast(message, type);
            return;
        }

        // Implémentation locale si la fonction globale n'existe pas
        const toastContainer = document.getElementById('toast-container') || createToastContainer();
        const toastId = 'toast-' + Date.now();
        const toast = document.createElement('div');
        toast.id = toastId;
        toast.className = `toast align-items-center text-white bg-${type}`;
        toast.setAttribute('role', 'alert');
        toast.setAttribute('aria-live', 'assertive');
        toast.setAttribute('aria-atomic', 'true');
        
        toast.innerHTML = `
            <div class="d-flex">
                <div class="toast-body">${message}</div>
                <button type="button" class="btn-close me-2 m-auto" data-bs-dismiss="toast" aria-label="Close"></button>
            </div>
        `;
        
        toastContainer.appendChild(toast);
        
        // Initialiser le toast avec Bootstrap si disponible
        if (typeof bootstrap !== 'undefined' && typeof bootstrap.Toast === 'function') {
            new bootstrap.Toast(toast, { delay: 5000 }).show();
        } else {
            // Fallback simple sans Bootstrap
            toast.style.display = 'block';
            setTimeout(() => {
                toast.remove();
            }, 5000);
        }
    }

    /**
     * Crée un conteneur pour les notifications toast
     * @returns {HTMLElement} Le conteneur créé
     */
    function createToastContainer() {
        const container = document.createElement('div');
        container.id = 'toast-container';
        container.className = 'toast-container position-fixed bottom-0 end-0 p-3';
        document.body.appendChild(container);
        return container;
    }

    /**
     * Calcule un hash simple pour détecter les changements
     * @param {Object} obj L'objet à hacher
     * @returns {string} Le hash calculé
     */
    function simpleHash(obj) {
        if (!obj) return '';
        
        try {
            return JSON.stringify(obj)
                .split('')
                .reduce((a, b) => {
                    a = ((a << 5) - a) + b.charCodeAt(0);
                    return a & a;
                }, 0)
                .toString(36);
        } catch (e) {
            return Math.random().toString(36).substring(2, 8);
        }
    }

    /**
     * Génère une couleur aléatoire déterministe basée sur une chaîne
     * @param {string} str La chaîne à utiliser comme graine
     * @returns {string} Une couleur au format CSS
     */
    function getRandomColor(str) {
        if (!str) return '#6c757d';
        
        // Génération déterministe basée sur la chaîne
        let hash = 0;
        for (let i = 0; i < str.length; i++) {
            hash = str.charCodeAt(i) + ((hash << 5) - hash);
        }
        
        let color = '#';
        for (let i = 0; i < 3; i++) {
            const value = (hash >> (i * 8)) & 0xFF;
            color += ('00' + value.toString(16)).substr(-2);
        }
        
        return color;
    }

    // Exposer des fonctions publiques qui pourraient être utiles ailleurs
    window.dashboardCore = {
        refresh: () => fetchDashboardData(true),
        updateSessionTable: updateSessionTable,
        updateActivityFeed: updateActivityFeed,
        enhanceUI: enhanceUI,
        showToast: showToast
    };

    // Démarrer l'initialisation
    initializeDashboard();
});
