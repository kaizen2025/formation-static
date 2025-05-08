/**
 * dashboard-core.js - Fichier JavaScript optimisé pour le tableau de bord
 * Remplace: polling-updates.js, ui-fixers.js, charts-enhanced.js, static-charts.js
 * Version: 1.1.0 - Fiabilisation de la gestion d'état et des erreurs
 */

document.addEventListener('DOMContentLoaded', function() {
    console.log('Dashboard Core: Initializing (v1.1.0)');

    // Configuration centralisée
    const config = window.dashboardConfig || {
        debugMode: false,
        refreshInterval: 150000, // Augmenté à 2.5 minutes
        minRefreshDelay: 15000, // Minimum 15 secondes entre les requêtes auto
        baseApiUrl: '/api',
        chartRendering: 'auto'
    };

    // État global du tableau de bord
    let dashboardState = {
        lastRefresh: 0,
        updating: false, // Flag pour éviter les requêtes simultanées
        dataHashes: {},
        errorCount: 0,
        maxErrors: 5,
        pollingActive: true,
        pollingInterval: null,
        themeChart: null,
        serviceChart: null
    };

    // Référence au gestionnaire d'erreurs API s'il existe
    const errorHandler = window.apiErrorHandler || {
        handleApiError: (endpoint, errorData, statusCode) => {
            console.error(`Fallback Error Handler: Erreur ${statusCode} sur ${endpoint}`, errorData);
            // Implémenter une notification basique si nécessaire
            showToast(`Erreur ${statusCode} lors du chargement de ${endpoint}`, 'danger');
            return false; // Indique que l'erreur n'a pas été gérée spécifiquement
        },
        checkAndFixBrokenElements: () => {
            // Implémenter une vérification basique si nécessaire
            console.warn("Fallback checkAndFixBrokenElements called");
        }
    };

    // ====== INITIALISATION ET CYCLE DE VIE ======

    function initializeDashboard() {
        enhanceUI();
        setupEventListeners();
        initializeCharts();

        // Première récupération de données, plus robuste
        fetchDashboardData(true).catch(err => {
            console.error("Dashboard Core: Initial data fetch failed", err);
            showErrorWarning(true); // Afficher l'avertissement si le premier fetch échoue
        }).finally(() => {
             updateDonutTotal(); // Mettre à jour même si le fetch initial échoue (affiche 0)
        });

        startPolling();
        console.log('Dashboard Core: Initialization complete.');
    }

    function startPolling() {
        if (dashboardState.pollingInterval) {
            clearInterval(dashboardState.pollingInterval);
        }
        dashboardState.pollingInterval = setInterval(() => {
            if (dashboardState.pollingActive && document.visibilityState === 'visible') {
                fetchDashboardData();
            } else if (!dashboardState.pollingActive) {
                 console.log("Dashboard Core: Polling paused due to errors.");
            }
        }, config.refreshInterval);
        console.log(`Dashboard Core: Polling started (interval: ${config.refreshInterval}ms)`);
    }

    function setupEventListeners() {
        document.addEventListener('visibilitychange', () => {
            if (document.visibilityState === 'visible' && dashboardState.pollingActive) {
                console.log('Dashboard Core: Tab visible, triggering refresh');
                fetchDashboardData(); // Ne pas forcer ici, respecter le délai min
            }
        });

        const refreshButton = document.getElementById('refresh-dashboard');
        if (refreshButton) {
            refreshButton.addEventListener('click', function() {
                this.disabled = true;
                this.innerHTML = '<i class="fas fa-sync-alt fa-spin me-1"></i>Actualisation...';
                const overlay = document.getElementById('loading-overlay');
                if (overlay) overlay.style.display = 'flex';

                // Forcer une actualisation complète
                fetchDashboardData(true)
                    .then((updated) => {
                        if (updated) {
                             showToast('Données actualisées avec succès', 'success');
                        } else {
                             showToast('Aucune nouvelle donnée détectée.', 'info');
                        }
                        // Réactiver le polling s'il était en pause
                        if (!dashboardState.pollingActive) {
                            dashboardState.pollingActive = true;
                            dashboardState.errorCount = 0;
                            showErrorWarning(false);
                            startPolling(); // Redémarrer le polling
                        }
                    })
                    .catch(err => {
                        console.error('Dashboard Core: Error during manual refresh:', err);
                        showToast('Erreur lors de l\'actualisation manuelle', 'danger');
                    })
                    .finally(() => {
                        this.disabled = false;
                        this.innerHTML = '<i class="fas fa-sync-alt me-1"></i>Actualiser';
                        if (overlay) overlay.style.display = 'none';
                    });
            });
        }
        setupValidationListeners();
        setupMutationObserver();
    }

    function setupMutationObserver() {
        // (Identique à la version précédente - semble correct)
        if (!window.MutationObserver) return;
        let observerTimeout = null;
        const observer = new MutationObserver(function(mutations) {
            let important = false;
            for (const mutation of mutations) { /* ... (vérification pertinence) ... */
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
            if (important) {
                clearTimeout(observerTimeout);
                observerTimeout = setTimeout(() => {
                    fixDataIssues();
                    enhanceBadgesAndLabels();
                }, 300);
            }
        });
        observer.observe(document.body, { childList: true, subtree: true });
        if (config.debugMode) console.log('Dashboard Core: Mutation observer initialized');
    }

    // ====== COMMUNICATION AVEC L'API ======

    async function fetchDashboardData(forceRefresh = false) {
        if (dashboardState.updating) {
            console.log('Dashboard Core: Skipping fetch (update in progress)');
            return Promise.resolve(false);
        }

        const now = Date.now();
        // Respecter le délai minimum même si forcé par visibilité, sauf si bouton manuel
        if (!forceRefresh && now - dashboardState.lastRefresh < config.minRefreshDelay) {
            console.log(`Dashboard Core: Skipping fetch (too soon, last: ${dashboardState.lastRefresh}, now: ${now})`);
            return Promise.resolve(false);
        }

        dashboardState.updating = true; // *** Set flag BEFORE fetch ***
        dashboardState.lastRefresh = now;

        try {
            const url = `${config.baseApiUrl}/dashboard_essential?_=${Date.now()}`;
            console.log(`Dashboard Core: Fetching data from ${url}`);

            const response = await fetch(url, {
                method: 'GET',
                headers: { 'Accept': 'application/json', 'X-Requested-With': 'XMLHttpRequest' }
            });

            if (!response.ok) {
                // Utiliser le gestionnaire d'erreurs API s'il existe
                let errorData = null;
                try { errorData = await response.clone().json(); } catch (e) { /* ignore parsing error */ }
                errorHandler.handleApiError(url, errorData, response.status);
                // Lancer une erreur pour déclencher le bloc catch
                throw new Error(`HTTP error! status: ${response.status}`);
            }

            const data = await response.json();
            const hasChanged = processData(data, forceRefresh);

            dashboardState.errorCount = 0; // Réinitialiser en cas de succès
            showErrorWarning(false); // Masquer l'avertissement d'erreur

            if (hasChanged) {
                console.log('Dashboard Core: Data updated, triggering dashboardDataRefreshed event');
                document.dispatchEvent(new CustomEvent('dashboardDataRefreshed', { detail: { data: data } }));
            } else {
                console.log('Dashboard Core: No significant data changes detected');
            }
            return hasChanged;

        } catch (error) {
            console.error('Dashboard Core: Error fetching dashboard data:', error);
            dashboardState.errorCount++;

            if (dashboardState.errorCount >= dashboardState.maxErrors && dashboardState.pollingActive) {
                console.warn(`Dashboard Core: Too many errors (${dashboardState.errorCount}), pausing polling`);
                dashboardState.pollingActive = false;
                clearInterval(dashboardState.pollingInterval);
                showErrorWarning(true);
            }
            // Ne pas retenter avec fallback ici, laisser le gestionnaire d'erreur décider
            // await fallbackToIndividualRequests(); // Commenté
            return false; // Indiquer qu'il n'y a pas eu de mise à jour réussie
        } finally {
            // *** Assurer que le flag est TOUJOURS réinitialisé ***
            dashboardState.updating = false;
            console.log('Dashboard Core: Fetch cycle finished.');
        }
    }

    function processData(data, forceRefresh = false) {
        // (Identique à la version précédente - semble correct)
        if (!data) return false;
        let hasChanged = forceRefresh;

        if (data.sessions && Array.isArray(data.sessions)) {
            const validatedSessions = data.sessions.map(session => {
                if (typeof session.places_restantes !== 'number' || isNaN(session.places_restantes)) {
                    session.places_restantes = Math.max(0, (session.max_participants || 0) - (session.inscrits || 0));
                }
                return session;
            });
            const sessionsHash = simpleHash(validatedSessions);
            if (forceRefresh || sessionsHash !== dashboardState.dataHashes.sessions) {
                updateSessionTable(validatedSessions);
                updateCharts(validatedSessions, data.participants || []);
                updateStatisticsCounters(validatedSessions);
                dashboardState.dataHashes.sessions = sessionsHash;
                hasChanged = true;
            }
        }

        if (data.activites && Array.isArray(data.activites)) {
            const activitiesHash = simpleHash(data.activites);
            if (forceRefresh || activitiesHash !== dashboardState.dataHashes.activites) {
                updateActivityFeed(data.activites);
                dashboardState.dataHashes.activites = activitiesHash;
                hasChanged = true;
            }
        }

        if (hasChanged) {
            setTimeout(() => {
                fixDataIssues(); // Appeler la correction après mise à jour DOM
                enhanceBadgesAndLabels();
                initTooltips();
                errorHandler.checkAndFixBrokenElements(); // Vérifier après mise à jour
            }, 100);
        }
        return hasChanged;
    }

    // Fallback non utilisé activement, mais gardé pour référence
    // async function fallbackToIndividualRequests() { ... }

    // ====== MISE À JOUR DES COMPOSANTS UI ======
    // updateSessionTable, updateStatisticsCounters, updateCounter, updateActivityFeed, getActivityIcon
    // (Identiques à la version précédente - semblent corrects)
    function updateSessionTable(sessions) {
        if (!sessions || !Array.isArray(sessions)) return;
        const sessionTableBody = document.querySelector('.session-table tbody');
        if (!sessionTableBody) return;
        sessions.forEach(session => {
            const row = sessionTableBody.querySelector(`tr[data-session-id="${session.id}"]`);
            if (!row) return;
            const placesCell = row.querySelector('.places-dispo');
            if (placesCell) {
                const maxP = session.max_participants || 0;
                const placesR = session.places_restantes;
                placesCell.textContent = `${placesR} / ${maxP}`;
                placesCell.classList.remove('text-success', 'text-warning', 'text-danger', 'text-secondary');
                if (typeof placesR !== 'number' || isNaN(placesR)) {
                     placesCell.classList.add('text-secondary');
                     placesCell.innerHTML = '<i class="fas fa-question-circle me-1"></i> ? / ?';
                } else if (placesR <= 0) {
                    placesCell.classList.add('text-danger');
                } else if (placesR <= Math.floor(maxP * 0.3)) {
                    placesCell.classList.add('text-warning');
                } else {
                    placesCell.classList.add('text-success');
                }
            }
            const participantsBadge = row.querySelector('.btn-outline-secondary .badge');
            if (participantsBadge) {
                participantsBadge.textContent = session.inscrits || 0;
            }
            row.dataset.full = (session.places_restantes <= 0) ? '1' : '0';
        });
    }

    function updateStatisticsCounters(sessions) {
        if (!sessions || !Array.isArray(sessions)) return;
        let totalInscriptions = 0, totalEnAttente = 0, totalSessionsCompletes = 0;
        const totalSessions = sessions.length;
        sessions.forEach(session => {
            totalInscriptions += (session.inscrits || 0);
            totalEnAttente += (session.liste_attente || 0);
            if (session.places_restantes <= 0) totalSessionsCompletes++;
        });
        updateCounter('total-inscriptions', totalInscriptions);
        updateCounter('total-en-attente', totalEnAttente);
        updateCounter('total-sessions', totalSessions);
        updateCounter('total-sessions-completes', totalSessionsCompletes);
    }

    function updateCounter(elementId, newValue) {
        const element = document.getElementById(elementId);
        if (!element) return;
        const currentValue = parseInt(element.textContent.replace(/[^\d]/g, '')) || 0;
        if (currentValue !== newValue) {
            element.textContent = newValue.toLocaleString();
            // Ajouter une classe pour une animation CSS si souhaité
            element.classList.add('updated');
            setTimeout(() => element.classList.remove('updated'), 500);
        }
    }

    function updateActivityFeed(activities) {
        if (!activities || !Array.isArray(activities)) return;
        const container = document.getElementById('recent-activity');
        if (!container) return;
        const spinner = container.querySelector('.loading-spinner');
        if (spinner) spinner.remove();
        if (activities.length === 0) {
            container.innerHTML = '<div class="text-center p-3 text-muted">Aucune activité récente</div>';
            return;
        }
        let html = '';
        activities.forEach(activity => {
            const icon = getActivityIcon(activity.type);
            const userInfo = activity.user ? `<span class="text-primary">${activity.user}</span>` : '';
            html += `
            <div class="activity-item fade-in" data-activity-id="${activity.id}">
                <div class="activity-icon"><i class="${icon}"></i></div>
                <div class="activity-content">
                    <div class="activity-title">${activity.description} ${userInfo}</div>
                    <div class="activity-subtitle">
                        ${activity.details ? `<small>${activity.details}</small><br>` : ''}
                        <small class="text-muted">${activity.date_relative || ''}</small>
                    </div>
                </div>
            </div>`;
        });
        container.innerHTML = html;
    }

    function getActivityIcon(type) {
        const iconMap = { /* ... (identique) ... */
            'connexion': 'fas fa-sign-in-alt text-success', 'deconnexion': 'fas fa-sign-out-alt text-warning',
            'inscription': 'fas fa-user-plus text-primary', 'validation': 'fas fa-check-circle text-success',
            'refus': 'fas fa-times-circle text-danger', 'annulation': 'fas fa-ban text-danger',
            'ajout_participant': 'fas fa-user-plus text-primary', 'suppression_participant': 'fas fa-user-minus text-danger',
            'modification_participant': 'fas fa-user-edit text-warning', 'reinscription': 'fas fa-redo text-info',
            'liste_attente': 'fas fa-clock text-warning', 'ajout_theme': 'fas fa-folder-plus text-primary',
            'ajout_service': 'fas fa-building text-primary', 'ajout_salle': 'fas fa-door-open text-primary',
            'attribution_salle': 'fas fa-map-marker-alt text-info', 'systeme': 'fas fa-cog text-secondary',
            'notification': 'fas fa-bell text-warning', 'default': 'fas fa-info-circle text-secondary'
        };
        return iconMap[type] || iconMap.default;
    }

    // ====== AMÉLIORATION ET CORRECTION UI ======
    // enhanceUI, initTooltips, enhanceBadgesAndLabels, fixDataIssues, enhanceAccessibility, showErrorWarning, setupValidationListeners
    // (Identiques à la version précédente - semblent corrects)
     function enhanceUI() {
        initTooltips();
        enhanceBadgesAndLabels();
        fixDataIssues();
        enhanceAccessibility();
    }
    function initTooltips() {
        if (typeof bootstrap === 'undefined' || typeof bootstrap.Tooltip !== 'function') return;
        const tooltipTriggerList = document.querySelectorAll('[data-bs-toggle="tooltip"], [title]:not(iframe):not(script):not(style)');
        tooltipTriggerList.forEach(el => {
            if (!bootstrap.Tooltip.getInstance(el)) {
                try { new bootstrap.Tooltip(el, { container: 'body', boundary: document.body }); }
                catch (e) { if (config.debugMode) console.warn('Dashboard Core: Error creating tooltip', e); }
            }
        });
    }
    function enhanceBadgesAndLabels() {
        if (typeof window.enhanceThemeBadgesGlobally === 'function') { window.enhanceThemeBadgesGlobally(); }
        else { /* ... (implémentation locale identique) ... */
             document.querySelectorAll('.theme-badge').forEach(badge => {
                if (badge.dataset.enhanced === 'true') return;
                const themeName = badge.textContent.trim();
                if (themeName.includes('Teams') && themeName.includes('Communiquer')) badge.classList.add('theme-comm');
                else if (themeName.includes('Planner')) badge.classList.add('theme-planner');
                else if (themeName.includes('OneDrive') || themeName.includes('fichiers')) badge.classList.add('theme-onedrive');
                else if (themeName.includes('Collaborer')) badge.classList.add('theme-sharepoint');
                badge.dataset.enhanced = 'true';
            });
        }
        document.querySelectorAll('.js-salle-cell').forEach(cell => { /* ... (identique) ... */
             const textContent = cell.textContent.trim();
            if (!cell.querySelector('.salle-badge') && textContent) {
                if (textContent === 'Non définie' || textContent === 'N/A') cell.innerHTML = '<span class="badge bg-secondary salle-badge">Non définie</span>';
                else cell.innerHTML = `<span class="badge bg-info salle-badge">${textContent}</span>`;
            }
        });
    }
    function fixDataIssues() { /* ... (identique à v1.0.0) ... */
        document.querySelectorAll('.places-dispo').forEach(el => {
            const text = el.textContent.trim();
            if (text.includes('/')) {
                const parts = text.split('/');
                const available = parseInt(parts[0].trim());
                const total = parseInt(parts[1].trim());
                if (!isNaN(available) && !isNaN(total)) {
                    let icon, colorClass;
                    if (available <= 0) { icon = 'fa-times-circle'; colorClass = 'text-danger'; }
                    else if (available <= 0.2 * total) { icon = 'fa-exclamation-circle'; colorClass = 'text-danger'; }
                    else if (available <= 0.4 * total) { icon = 'fa-exclamation-triangle'; colorClass = 'text-warning'; }
                    else { icon = 'fa-check-circle'; colorClass = 'text-success'; }
                    if (!el.querySelector('.fas') || !el.classList.contains(colorClass)) {
                        el.classList.remove('text-success', 'text-warning', 'text-danger', 'text-secondary');
                        el.classList.add(colorClass);
                        el.innerHTML = `<i class="fas ${icon} me-1"></i> ${available} / ${total}`;
                    }
                }
            } else if (text === 'NaN / NaN' || text.includes('undefined') || text === '/ ' || text === ' / ') {
                el.classList.remove('text-success', 'text-warning', 'text-danger');
                el.classList.add('text-secondary');
                el.innerHTML = '<i class="fas fa-question-circle me-1"></i> ? / ?';
                el.title = 'Données temporairement indisponibles';
            }
        });
        document.querySelectorAll('.counter-value').forEach(counter => {
            const text = counter.textContent.trim();
            if (text === '' || text === 'undefined' || text === 'null' || text === 'NaN') counter.textContent = '0';
        });
        document.querySelectorAll('table tbody').forEach(tbody => {
            if (!tbody.querySelector('tr')) {
                const cols = tbody.closest('table').querySelectorAll('thead th').length || 3;
                tbody.innerHTML = `<tr><td colspan="${cols}" class="text-center p-3 text-muted">Aucune donnée disponible</td></tr>`;
            }
        });
    }
    function enhanceAccessibility() { /* ... (identique) ... */
        document.querySelectorAll('img:not([alt])').forEach(img => {
            const filename = img.src.split('/').pop().split('?')[0];
            const name = filename.split('.')[0].replace(/[_-]/g, ' ');
            img.setAttribute('alt', name || 'Image');
        });
        document.querySelectorAll('button:not([type])').forEach(button => {
            button.setAttribute('type', button.closest('form') ? 'submit' : 'button');
        });
    }
    function showErrorWarning(show) { /* ... (identique) ... */
        let errorDiv = document.getElementById('backend-error-warning');
        if (show && !errorDiv) {
            errorDiv = document.createElement('div'); errorDiv.id = 'backend-error-warning';
            errorDiv.className = 'alert alert-warning alert-dismissible fade show small p-2 mt-2 mx-4';
            errorDiv.innerHTML = `<i class="fas fa-exclamation-triangle me-2"></i> Problème de communication avec le serveur. Certaines informations peuvent être temporairement indisponibles. <button type="button" class="btn-close p-2" data-bs-dismiss="alert" aria-label="Close"></button>`;
            const content = document.getElementById('dashboard-content');
            if (content) content.prepend(errorDiv);
        } else if (!show && errorDiv) { errorDiv.remove(); }
    }
    function setupValidationListeners() { /* ... (identique) ... */
        document.querySelectorAll('.validation-ajax').forEach(button => {
            button.addEventListener('click', function() {
                const inscriptionId = this.getAttribute('data-inscription-id'); const action = this.getAttribute('data-action');
                if (!inscriptionId || !action) return; this.disabled = true;
                fetch('/validation_inscription_ajax', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ inscription_id: inscriptionId, action: action }) })
                .then(response => response.json()).then(data => {
                    if (data.success) { showToast(data.message, 'success'); fetchDashboardData(true);
                        setTimeout(() => { const modal = this.closest('.modal'); if (modal && typeof bootstrap !== 'undefined') { const modalInstance = bootstrap.Modal.getInstance(modal); if (modalInstance) modalInstance.hide(); } }, 1000);
                    } else { showToast(data.message || 'Erreur lors de la validation', 'danger'); this.disabled = false; }
                }).catch(error => { console.error('Error:', error); showToast('Erreur de communication avec le serveur', 'danger'); this.disabled = false; });
            });
        });
    }

    // ====== GESTION DES GRAPHIQUES ======
    // initializeCharts, updateCharts, updateChartJsCharts, updateThemeChart, updateServiceChart, updateStaticCharts, updateStaticThemeChart, updateStaticServiceChart, updateDonutTotal
    // (Identiques à la version précédente - semblent corrects)
    function initializeCharts() { /* ... (identique) ... */
        const hasChartJs = typeof Chart !== 'undefined'; const chartMode = config.chartRendering === 'auto' ? (hasChartJs ? 'chartjs' : 'static') : config.chartRendering;
        if (chartMode === 'chartjs') { document.querySelectorAll('.static-chart-donut, .static-chart-bars').forEach(el => el.style.display = 'none'); }
        else { document.querySelectorAll('#themeChartCanvas, #serviceChartCanvas').forEach(el => el.style.display = 'none'); document.querySelectorAll('.static-chart-donut, .static-chart-bars').forEach(el => el.style.display = 'block'); }
        if (config.debugMode) console.log(`Dashboard Core: Chart rendering mode: ${chartMode}`);
    }
    function updateCharts(sessions, participants) { /* ... (identique) ... */
        const hasChartJs = typeof Chart !== 'undefined'; const chartMode = config.chartRendering === 'auto' ? (hasChartJs ? 'chartjs' : 'static') : config.chartRendering;
        if (chartMode === 'chartjs' && hasChartJs) updateChartJsCharts(sessions, participants); else updateStaticCharts(sessions, participants);
    }
    function updateChartJsCharts(sessions, participants) { /* ... (identique) ... */ updateThemeChart(sessions); updateServiceChart(participants); }
    function updateThemeChart(sessions) { /* ... (identique) ... */
        const canvas = document.getElementById('themeChartCanvas'); if (!canvas) return;
        const themeCounts = {}; sessions.forEach(session => { if (session.theme && typeof session.inscrits === 'number') { const themeName = typeof session.theme === 'string' ? session.theme : (session.theme.nom || 'Inconnu'); themeCounts[themeName] = (themeCounts[themeName] || 0) + session.inscrits; } });
        const labels = Object.keys(themeCounts); const data = labels.map(label => themeCounts[label]); const backgroundColor = labels.map(label => window.themesDataForChart && window.themesDataForChart[label] ? window.themesDataForChart[label].color : getRandomColor(label));
        const total = data.reduce((a, b) => a + b, 0); updateDonutTotal(total);
        if (dashboardState.themeChart) { dashboardState.themeChart.data.labels = labels; dashboardState.themeChart.data.datasets[0].data = data; dashboardState.themeChart.data.datasets[0].backgroundColor = backgroundColor; dashboardState.themeChart.update(); }
        else { const ctx = canvas.getContext('2d'); if (ctx) { dashboardState.themeChart = new Chart(ctx, { type: 'doughnut', data: { labels: labels, datasets: [{ data: data, backgroundColor: backgroundColor, borderWidth: 2, borderColor: '#fff' }] }, options: { responsive: true, maintainAspectRatio: false, cutout: '65%', plugins: { legend: { position: 'bottom', labels: { padding: 15, boxWidth: 12, font: { size: 11 } } } } } }); } }
    }
    function updateServiceChart(participants) { /* ... (identique) ... */
        const canvas = document.getElementById('serviceChartCanvas'); if (!canvas) return;
        const serviceCounts = {}; participants.forEach(participant => { let serviceName = 'N/A'; if (typeof participant.service === 'string') serviceName = participant.service; else if (participant.service && participant.service.nom) serviceName = participant.service.nom; serviceCounts[serviceName] = (serviceCounts[serviceName] || 0) + 1; });
        const sortedServices = Object.entries(serviceCounts).sort((a, b) => b[1] - a[1]).map(([name, count]) => ({ name, count }));
        const labels = sortedServices.map(s => s.name); const data = sortedServices.map(s => s.count); const backgroundColor = labels.map(label => window.servicesDataForChart && window.servicesDataForChart[label] ? window.servicesDataForChart[label].color : getRandomColor(label));
        if (dashboardState.serviceChart) { dashboardState.serviceChart.data.labels = labels; dashboardState.serviceChart.data.datasets[0].data = data; dashboardState.serviceChart.data.datasets[0].backgroundColor = backgroundColor; dashboardState.serviceChart.update(); }
        else { const ctx = canvas.getContext('2d'); if (ctx) { dashboardState.serviceChart = new Chart(ctx, { type: 'bar', data: { labels: labels, datasets: [{ data: data, backgroundColor: backgroundColor, borderColor: backgroundColor, borderWidth: 1, borderRadius: 4 }] }, options: { responsive: true, maintainAspectRatio: false, indexAxis: 'y', plugins: { legend: { display: false } }, scales: { x: { beginAtZero: true, ticks: { precision: 0 } } } } }); } }
    }
    function updateStaticCharts(sessions, participants) { /* ... (identique) ... */ updateStaticThemeChart(sessions); updateStaticServiceChart(participants); }
    function updateStaticThemeChart(sessions) { /* ... (identique) ... */
        const container = document.querySelector('.static-chart-donut'); if (!container) return;
        const themeCounts = {}; sessions.forEach(session => { if (session.theme && typeof session.inscrits === 'number') { const themeName = typeof session.theme === 'string' ? session.theme : (session.theme.nom || 'Inconnu'); themeCounts[themeName] = (themeCounts[themeName] || 0) + session.inscrits; } });
        const total = Object.values(themeCounts).reduce((a, b) => a + b, 0); updateDonutTotal(total); container.innerHTML = '';
        if (Object.keys(themeCounts).length === 0) { container.innerHTML = '<div class="donut-center"><div class="donut-total">0</div><div class="donut-label">INSCRITS</div></div>'; return; }
        let startAngle = 0; Object.entries(themeCounts).forEach(([theme, count], index) => { const percentage = (count / total) * 100; const angle = (percentage / 100) * 360; const color = window.themesDataForChart && window.themesDataForChart[theme] ? window.themesDataForChart[theme].color : getRandomColor(theme); const segment = document.createElement('div'); segment.className = 'donut-segment'; segment.style.setProperty('--fill', color); segment.style.setProperty('--rotation', startAngle); segment.style.setProperty('--percentage', percentage); segment.style.setProperty('--index', index); segment.style.backgroundColor = color; container.appendChild(segment); startAngle += angle; });
        const center = document.createElement('div'); center.className = 'donut-center'; center.innerHTML = `<div class="donut-total">${total}</div><div class="donut-label">INSCRITS</div>`; container.appendChild(center); container.classList.add('animate');
    }
    function updateStaticServiceChart(participants) { /* ... (identique) ... */
        const container = document.querySelector('.static-chart-bars'); if (!container) return;
        const serviceCounts = {}; participants.forEach(participant => { let serviceName = 'N/A'; if (typeof participant.service === 'string') serviceName = participant.service; else if (participant.service && participant.service.nom) serviceName = participant.service.nom; serviceCounts[serviceName] = (serviceCounts[serviceName] || 0) + 1; });
        const sortedServices = Object.entries(serviceCounts).sort((a, b) => b[1] - a[1]); container.innerHTML = '';
        if (sortedServices.length === 0) { container.innerHTML = '<div class="text-center text-muted">Aucun participant</div>'; return; }
        const maxCount = Math.max(...sortedServices.map(([_, count]) => count));
        sortedServices.forEach(([service, count], index) => { const percentage = (count / maxCount) * 100; const color = window.servicesDataForChart && window.servicesDataForChart[service] ? window.servicesDataForChart[service].color : getRandomColor(service); const barItem = document.createElement('div'); barItem.className = 'bar-item'; barItem.innerHTML = `<div class="bar-header"><div class="bar-label"><i class="fas fa-users fa-sm me-1"></i> ${service}</div><div class="bar-total">${count}</div></div><div class="bar-container"><div class="bar-value" style="width: ${percentage}%; background-color: ${color};" data-value="${count}" data-index="${index}"></div></div>`; container.appendChild(barItem); }); container.classList.add('animate');
    }
    function updateDonutTotal(total = null) { /* ... (identique) ... */
        const element = document.getElementById('chart-theme-total');
        if (element) {
            if (total === null) {
                if (dashboardState.themeChart && dashboardState.themeChart.data.datasets[0].data) total = dashboardState.themeChart.data.datasets[0].data.reduce((a, b) => a + b, 0);
                else { const staticChart = document.querySelector('.static-chart-donut'); if (staticChart) { const segments = staticChart.querySelectorAll('.donut-segment'); const values = Array.from(segments).map(s => parseInt(s.getAttribute('data-value') || '0')); total = values.reduce((a, b) => a + b, 0); } }
            }
            if (total !== null) element.textContent = total.toString();
        }
    }

    // ====== UTILITAIRES ======

    /**
     * Génère un hash simple pour une structure de données
     * @param {any} data Données à hasher
     * @returns {string} Hash simple
     */
    function simpleHash(data) {
        try {
            const str = JSON.stringify(data);
            let hash = 0;
            for (let i = 0; i < str.length; i++) {
                const char = str.charCodeAt(i);
                hash = ((hash << 5) - hash) + char;
                hash |= 0; // Convert to 32bit integer
            }
            return hash.toString();
        } catch (e) {
            console.error("Hashing error:", e);
            return Date.now().toString(); // Fallback hash
        }
    }

    /**
     * Génère une couleur aléatoire basée sur une chaîne (pour la cohérence)
     * @param {string} str Chaîne pour générer la couleur
     * @returns {string} Couleur hexadécimale
     */
    function getRandomColor(str) {
        let hash = 0;
        for (let i = 0; i < str.length; i++) {
            hash = str.charCodeAt(i) + ((hash << 5) - hash);
        }
        let color = '#';
        for (let i = 0; i < 3; i++) {
            const value = (hash >> (i * 8)) & 0xFF;
            // Assurer une certaine luminosité pour éviter les couleurs trop sombres
            const adjustedValue = Math.min(200, Math.max(50, value));
            color += ('00' + adjustedValue.toString(16)).substr(-2);
        }
        return color;
    }

    /**
     * Crée le conteneur de toast s'il n'existe pas
     * @returns {HTMLElement} Le conteneur de toast
     */
    function createToastContainer() {
        let container = document.createElement('div');
        container.id = 'toast-container';
        container.className = 'toast-container position-fixed top-0 end-0 p-3';
        container.style.zIndex = '1100'; // S'assurer qu'il est au-dessus des modales
        document.body.appendChild(container);
        return container;
    }

    /**
     * Affiche une notification toast (implémentation locale)
     * @param {string} message Message
     * @param {string} type Type (success, danger, warning, info)
     */
    function showToast(message, type = 'info') {
        const toastContainer = document.getElementById('toast-container') || createToastContainer();
        const toastId = 'toast-' + Date.now();
        const toastEl = document.createElement('div');
        toastEl.id = toastId;
        toastEl.className = `toast align-items-center text-white bg-${type} border-0 fade`; // Ajout de fade
        toastEl.setAttribute('role', 'alert');
        toastEl.setAttribute('aria-live', 'assertive');
        toastEl.setAttribute('aria-atomic', 'true');
        toastEl.innerHTML = `
            <div class="d-flex">
                <div class="toast-body">${message}</div>
                <button type="button" class="btn-close btn-close-white me-2 m-auto" data-bs-dismiss="toast" aria-label="Close"></button>
            </div>
        `;
        toastContainer.appendChild(toastEl);

        // Initialiser et montrer le toast Bootstrap
        if (typeof bootstrap !== 'undefined' && typeof bootstrap.Toast === 'function') {
            const toast = new bootstrap.Toast(toastEl, { delay: 5000 });
            toast.show();
            // Supprimer l'élément après disparition
            toastEl.addEventListener('hidden.bs.toast', () => toastEl.remove());
        } else {
            // Fallback simple si Bootstrap n'est pas chargé
            toastEl.classList.add('show');
            setTimeout(() => {
                toastEl.classList.remove('show');
                setTimeout(() => toastEl.remove(), 150);
            }, 5000);
        }
    }

    // Exposer la fonction showToast globalement si elle n'existe pas
    if (typeof window.showToast === 'undefined') {
        window.showToast = showToast;
    }

    // Démarrer le tableau de bord
    initializeDashboard();

}); // Fin de DOMContentLoaded
