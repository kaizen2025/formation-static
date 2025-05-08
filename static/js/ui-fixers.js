/**
 * ui-fixers.js - Amélioration de l'interface utilisateur et corrections automatiques
 * v1.2.0 - Amélioration majeure pour la résilience aux erreurs de données et API
 */
console.log("--- ui-fixers.js EXECUTING ---");

document.addEventListener('DOMContentLoaded', function() {
    const DASH_CONFIG = window.dashboardConfig || { debugMode: false };
    if (DASH_CONFIG.debugMode) console.log('UI Fixers initialized (v1.2.0)');

    const internalConfig = {
        enhanceLabels: true,
        fixTooltips: true,
        fixSessionInfo: true,
        fixSalleDisplay: true,
        enhancePlacesRestantes: true, 
        enhanceAccessibility: true,
        fixBadges: true,
        fixMissingData: true,
        maxQueuedFixes: 5, // Limite le nombre de corrections en file d'attente
        limitMutationCallbacks: true, // Limiter les callbacks de l'observateur de mutations
    };

    // État interne
    let lastFixTimestamp = 0;
    let scheduledFixId = null;
    let fixesCounter = 0;
    let apiCallDetectedAt = 0;
    let queuedFixesCount = 0;
    let lastMutationHandled = 0;
    let mutationDebounceTime = 50; // ms minimum entre les appels de l'observateur de mutations

    // Debounce applyAllFixes pour éviter les appels rapides du MutationObserver
    function debouncedApplyAllFixes() {
        // Limiter le nombre de corrections en file d'attente
        if (queuedFixesCount >= internalConfig.maxQueuedFixes) {
            console.log(`UI Fixers: Too many queued fixes (${queuedFixesCount}), skipping this request`);
            return;
        }
        
        clearTimeout(scheduledFixId);
        queuedFixesCount++;
        scheduledFixId = setTimeout(() => {
            applyAllFixes();
            queuedFixesCount--;
        }, 150); // 150ms debounce
    }

    // Application initiale des corrections
    setTimeout(applyAllFixes, 500); // Retard initial après chargement du DOM

    // Réappliquer les corrections après les appels fetch vers /api/ (s'ils modifient le DOM pertinent)
    const originalFetch = window.fetch;
    window.fetch = async function(...args) {
        const response = await originalFetch.apply(this, args);
        try {
            const url = (args[0] instanceof Request) ? args[0].url : args[0].toString();
            if (url.includes('/api/')) {
                // Si la réponse est OK et JSON, supposer que les données pourraient avoir modifié le DOM
                if (response.ok && response.headers.get('content-type')?.includes('application/json')) {
                    response.clone().json().then(() => { // Cloner pour lire le corps sans consommer l'original
                        if (DASH_CONFIG.debugMode) console.log('UI Fixers: API call detected, queueing fixes for URL:', url);
                        apiCallDetectedAt = Date.now();
                        debouncedApplyAllFixes();
                    }).catch(() => { /* Ignorer si pas JSON */ });
                }
            }
        } catch (e) {
            if (DASH_CONFIG.debugMode) console.warn('UI Fixers: Error in fetch wrapper', e);
        }
        return response;
    };

    /**
     * Applique toutes les corrections UI configurées
     */
    function applyAllFixes() {
        const now = Date.now();
        if (now - lastFixTimestamp < 50) {
            // Ne pas appliquer les corrections trop fréquemment
            if (DASH_CONFIG.debugMode) console.log('UI Fixers: Skipping fixes (too frequent)');
            debouncedApplyAllFixes(); // Reprogrammer pour plus tard
            return;
        }

        fixesCounter++;
        if (DASH_CONFIG.debugMode) console.log('UI Fixers: Applying all fixes...', fixesCounter);
        lastFixTimestamp = now;

        try {
            if (internalConfig.fixMissingData) fixMissingData();
            if (internalConfig.enhanceLabels) enhanceLabels();
            if (internalConfig.fixTooltips) fixTooltips(); // Les tooltips doivent être ré-initialisés après les changements DOM
            if (internalConfig.fixSessionInfo) fixSessionInfo();
            if (internalConfig.fixSalleDisplay) fixSalleDisplay();
            if (internalConfig.enhancePlacesRestantes) enhancePlacesRestantes(); 
            if (internalConfig.fixBadges) fixBadges();
            if (internalConfig.enhanceAccessibility) enhanceAccessibility();

            // Appeler l'enhancer de badges de thèmes global depuis layout.html 
            if (typeof window.enhanceThemeBadgesGlobally === 'function') {
                window.enhanceThemeBadgesGlobally();
            }

            if (DASH_CONFIG.debugMode) console.log('UI Fixers: All fixes applied cycle finished.');
        } catch (error) {
            console.error('UI Fixers: Error applying fixes:', error);
        }
    }
    
    /**
     * Corrige les données manquantes ou invalides dans le DOM
     */
    function fixMissingData() {
        // Fixer les éléments vides ou avec contenu invalide
        document.querySelectorAll('[data-dynamic], .counter-value, .places-dispo').forEach(el => {
            const text = el.textContent.trim();
            
            // Corriger les conteneurs vides
            if (text === '' || text === 'undefined' || text === 'null' || text === 'NaN') {
                if (el.classList.contains('counter-value')) {
                    el.textContent = '0';
                } else if (el.classList.contains('places-dispo')) {
                    el.textContent = '? / ?';
                    el.classList.add('text-secondary');
                    el.title = 'Données temporairement indisponibles';
                } else if (el.children.length === 0) {
                    el.innerHTML = '<div class="text-muted text-center p-2">Données non disponibles</div>';
                }
            }
            
            // Corriger les valeurs NaN / NaN dans places-dispo
            if (el.classList.contains('places-dispo') && (text.includes('NaN') || text.includes('undefined'))) {
                el.textContent = '? / ?';
                el.classList.add('text-secondary');
                el.title = 'Données temporairement indisponibles';
            }
        });
        
        // Fixer les badges sans couleur
        document.querySelectorAll('.badge').forEach(badge => {
            if (!Array.from(badge.classList).some(c => c.startsWith('bg-') || badge.style.backgroundColor)) {
                badge.classList.add('bg-secondary');
            }
        });
        
        // Fixer les tableaux sans données
        document.querySelectorAll('table').forEach(table => {
            const tbody = table.querySelector('tbody');
            if (tbody && !tbody.querySelector('tr')) {
                const cols = table.querySelectorAll('thead th').length || 3;
                tbody.innerHTML = `<tr><td colspan="${cols}" class="text-center p-3 text-muted">Aucune donnée disponible</td></tr>`;
            }
        });
        
        // Fixer les listes vides
        document.querySelectorAll('.list-group, [data-empty-message]').forEach(list => {
            if (list.children.length === 0) {
                const message = list.dataset.emptyMessage || 'Aucun élément disponible';
                list.innerHTML = `<div class="list-group-item text-center text-muted">${message}</div>`;
            }
        });
    }

    /**
     * Ajoute des icônes et améliore les étiquettes
     */
    function enhanceLabels() {
        // Exemple : Ajouter des icônes aux boutons/liens s'ils n'en ont pas
        document.querySelectorAll('a.btn, button.btn').forEach(el => {
            const text = el.textContent.trim();
            if ((text.includes('Voir Participants') || text.includes('Liste des participants')) && !el.querySelector('i.fa-users')) {
                el.innerHTML = `<i class="fas fa-users me-1"></i>${text || 'Participants'}`;
            } else if (text.includes('Gérer Salle') && !el.querySelector('i.fa-building')) {
                el.innerHTML = `<i class="fas fa-building me-1"></i>${text || 'Gérer Salle'}`;
            }
        });

        // En-têtes de carte - souvent définis par Jinja, mais peut être un fallback
        document.querySelectorAll('.card-header h5, .card-header h6, .card-header .card-title').forEach(el => {
            const text = el.textContent.trim();
            if (text.includes('Sessions à venir') && !el.querySelector('i.fa-calendar-alt, i.fa-calendar-check')) {
                el.innerHTML = `<i class="fas fa-calendar-check me-2"></i>${text}`;
            } else if (text.includes('Participants par service') && !el.querySelector('i.fa-users, i.fa-chart-bar')) {
                el.innerHTML = `<i class="fas fa-chart-bar me-2"></i>${text}`;
            } else if (text.includes('Répartition par thème') && !el.querySelector('i.fa-book, i.fa-chart-pie')) {
                el.innerHTML = `<i class="fas fa-chart-pie me-2"></i>${text}`;
            } else if (text.includes('Activité récente') && !el.querySelector('i.fa-history')) {
                el.innerHTML = `<i class="fas fa-history me-2"></i>${text}`;
            }
        });
    }

    /**
     * Corrige les infosbulles (tooltips) Bootstrap
     */
    function fixTooltips() {
        if (typeof bootstrap !== 'undefined' && typeof bootstrap.Tooltip === 'function') {
            // Initialiser de nouvelles infosbulles
            const tooltipTriggerList = [].slice.call(document.querySelectorAll('[data-bs-toggle="tooltip"], [title]:not(iframe):not(script):not(style)'));
            tooltipTriggerList.forEach(el => {
                if (!bootstrap.Tooltip.getInstance(el)) {
                    try {
                        new bootstrap.Tooltip(el, {
                            container: 'body', // Important pour les éléments dans des tableaux ou des layouts complexes
                            boundary: document.body,
                            trigger: 'hover focus' // Déclencheurs plus accessibles
                        });
                    } catch (e) { 
                        console.warn('UI Fixers: Error creating tooltip', e, el); 
                    }
                }
            });

            // Ajouter des titres à des éléments spécifiques s'ils n'en ont pas
            document.querySelectorAll('.salle-badge, .places-dispo, .theme-badge').forEach(el => {
                if (!el.hasAttribute('title') && !el.dataset.bsOriginalTitle) {
                    let titleText = '';
                    if (el.classList.contains('salle-badge')) titleText = el.textContent.trim() === 'Non définie' ? 'Aucune salle assignée' : `Salle : ${el.textContent.trim()}`;
                    else if (el.classList.contains('places-dispo')) titleText = 'Places disponibles / Capacité totale';
                    else if (el.classList.contains('theme-badge')) titleText = `Thème : ${el.textContent.trim()}`;

                    if (titleText) {
                        el.setAttribute('title', titleText);
                        el.setAttribute('data-bs-toggle', 'tooltip'); // S'assurer qu'il est détecté
                        if (!bootstrap.Tooltip.getInstance(el)) {
                            try { new bootstrap.Tooltip(el, { container: 'body' }); }
                            catch (e) { console.warn('UI Fixers: Error creating tooltip for dynamic element', e, el); }
                        }
                    }
                }
            });
        }
    }

    /**
     * Corrige la mise en forme des informations de session
     */
    function fixSessionInfo() {
        // Mise en forme des cellules de date
        document.querySelectorAll('table td:first-child').forEach(dateCell => {
            // Vérifier si cela ressemble à une cellule de date (p. ex., contient un jour de semaine ou /) et n'est pas déjà en gras
            if (dateCell.innerHTML.match(/\b(lundi|mardi|mercredi|jeudi|vendredi|samedi|dimanche)\b/i) || dateCell.innerHTML.includes('/')) {
                if (!dateCell.querySelector('strong')) {
                    const parts = dateCell.innerHTML.split('<br>');
                    if (parts.length > 0) {
                        dateCell.innerHTML = `<strong>${parts[0]}</strong>${parts.length > 1 ? `<br><small class="text-secondary">${parts[1]}</small>` : ''}`;
                    }
                }
            }
        });

        // Amélioration de l'affichage des places disponibles 
        document.querySelectorAll('.places-dispo').forEach(el => {
            const text = el.textContent.trim();
            if (text.includes('/')) {
                const [dispoStr, totalStr] = text.split('/');
                const dispo = parseInt(dispoStr.trim(), 10);
                const total = parseInt(totalStr.trim(), 10);

                if (!isNaN(dispo) && !isNaN(total) && total > 0) {
                    let colorClass = 'text-success';
                    let iconClass = 'fa-check-circle';

                    if (dispo === 0) {
                        colorClass = 'text-danger';
                        iconClass = 'fa-times-circle';
                    } else if (dispo <= total * 0.2) { // Inférieur ou égal à 20%
                        colorClass = 'text-danger';
                        iconClass = 'fa-exclamation-circle';
                    } else if (dispo <= total * 0.4) { // Inférieur ou égal à 40%
                        colorClass = 'text-warning';
                        iconClass = 'fa-exclamation-triangle';
                    }

                    el.classList.remove('text-success', 'text-warning', 'text-danger', 'text-secondary');
                    el.classList.add(colorClass);

                    // Mettre à jour l'icône et le contenu textuel si ce n'est pas déjà fait ou si les valeurs ont changé
                    const existingIcon = el.querySelector('i.fas');
                    if (!existingIcon || !existingIcon.classList.contains(iconClass)) {
                        el.innerHTML = `<i class="fas ${iconClass} me-1"></i> ${dispo} / ${total}`;
                    } else {
                        // Mettre à jour uniquement le texte si l'icône est correcte mais les nombres pourraient avoir changé
                        el.innerHTML = `<i class="fas ${iconClass} me-1"></i> ${dispo} / ${total}`;
                    }
                } else if (!isNaN(dispo) && !isNaN(total) && total === 0) { // Cas où max_participants est 0
                    el.classList.remove('text-success', 'text-warning', 'text-danger', 'text-secondary');
                    el.classList.add('text-secondary');
                    el.innerHTML = `<i class="fas fa-minus-circle me-1"></i> ${dispo} / ${total}`;
                }
            } else if (text === '? / ?' || text.includes('NaN') || text.includes('undefined')) {
                // Cas d'erreur détecté
                el.classList.remove('text-success', 'text-warning', 'text-danger');
                el.classList.add('text-secondary');
                el.innerHTML = `<i class="fas fa-question-circle me-1"></i> ? / ?`;
                el.title = 'Données temporairement indisponibles';
            }
        });
    }

    /**
     * Fonction spécifique pour gérer les problèmes de "places_restantes"
     * Implémente une solution de contournement pour les erreurs 500 places_restantes
     */
    function enhancePlacesRestantes() {
        // Vérifier si des éléments ont des valeurs suspicieuses
        let suspiciousElements = [];
        
        // Cas 1: Valeurs illisibles ou "NaN / NaN"
        document.querySelectorAll('.places-dispo').forEach(el => {
            const text = el.textContent.trim();
            if (text.includes('NaN') || text.includes('undefined') || text === '/ ' || text === ' / ' || text === ' /') {
                suspiciousElements.push({el: el, type: 'invalid'});
            }

            // Cas 2: Places disponibles > capacité (impossible normalement)
            if (text.includes('/')) {
                const [dispoStr, totalStr] = text.split('/');
                const dispo = parseInt(dispoStr.trim(), 10);
                const total = parseInt(totalStr.trim(), 10);
                
                if (!isNaN(dispo) && !isNaN(total) && dispo > total) {
                    suspiciousElements.push({el: el, type: 'inconsistent'});
                }
            }
        });
        
        // Si des éléments suspects sont trouvés, les corriger
        if (suspiciousElements.length > 0) {
            console.warn(`UI Fixers: Detected ${suspiciousElements.length} suspicious places_restantes elements. Attempting repairs...`);
            
            suspiciousElements.forEach(item => {
                const el = item.el;
                
                // Rechercher l'élément parent session-row ou tr
                const sessionRow = el.closest('.session-row, tr');
                let sessionId = null;
                
                if (sessionRow) {
                    sessionId = sessionRow.dataset.sessionId || sessionRow.getAttribute('data-session-id');
                }
                
                // Détecter la capacité si possible
                let capacityValue = 10; // Valeur par défaut
                
                // Essayer de détecter la capacité à partir de la rangée ou d'un dataset
                if (sessionRow) {
                    const capacityText = sessionRow.querySelector('.session-capacity')?.textContent.trim();
                    if (capacityText && !isNaN(parseInt(capacityText, 10))) {
                        capacityValue = parseInt(capacityText, 10);
                    } else if (sessionRow.dataset.capacity && !isNaN(parseInt(sessionRow.dataset.capacity, 10))) {
                        capacityValue = parseInt(sessionRow.dataset.capacity, 10);
                    }
                }
                
                // Pour les valeurs invalides, appliquer un état "données non disponibles"
                if (item.type === 'invalid' || item.type === 'inconsistent') {
                    el.classList.remove('text-success', 'text-warning', 'text-danger', 'text-secondary');
                    el.classList.add('text-secondary', 'data-error');
                    el.innerHTML = `<i class="fas fa-question-circle me-1"></i> ? / ${capacityValue}`;
                    el.setAttribute('title', 'Données temporairement indisponibles');
                    el.setAttribute('data-original-broken', 'true');
                    
                    // Si Bootstrap est disponible, mettre à jour le tooltip
                    if (typeof bootstrap !== 'undefined' && typeof bootstrap.Tooltip === 'function') {
                        const tooltip = bootstrap.Tooltip.getInstance(el);
                        if (tooltip) {
                            tooltip.dispose();
                        }
                        new bootstrap.Tooltip(el, {
                            container: 'body',
                            title: 'Données temporairement indisponibles'
                        });
                    }
                    
                    console.log(`UI Fixers: Fixed broken places_restantes for session ${sessionId || 'unknown'}. Applied fallback display.`);
                }
            });
        }
    }

    /**
     * Améliore l'affichage des salles de session
     */
    function fixSalleDisplay() {
        // Cible les cellules spécifiquement marquées pour l'affichage de la salle
        document.querySelectorAll('.js-salle-cell').forEach(el => {
            const salleText = el.textContent.trim();
            if (!el.querySelector('.salle-badge')) { // Modifier uniquement si ce n'est pas déjà un badge
                if (!salleText || salleText.toLowerCase() === 'non définie' || salleText.toLowerCase() === 'n/a') {
                    el.innerHTML = '<span class="badge bg-secondary text-white salle-badge" data-bs-toggle="tooltip" title="Aucune salle assignée">Non définie</span>';
                } else {
                    const salleName = salleText.replace(/^Salle\s*/i, '').trim();
                    el.innerHTML = `<span class="badge bg-info text-white salle-badge" data-bs-toggle="tooltip" title="Salle: ${salleName}">${salleName}</span>`;
                }
            }
        });

        // Fallback pour les cellules de tableau moins spécifiques (habituellement 4ème colonne)
        document.querySelectorAll('table td:nth-child(4)').forEach(cell => {
            if (cell.classList.contains('js-salle-cell') || cell.querySelector('.salle-badge')) return; // Sauter si déjà traité
            
            const text = cell.textContent.trim();
            // Heuristique : s'il s'agit probablement d'un nom de salle ou d'un espace réservé
            if ((text.match(/^[A-Za-z0-9\s-]+$/) && text.length > 1 && text.length < 30 && !text.includes('/')) || 
                text.toLowerCase() === 'non définie' || text.toLowerCase() === 'n/a') {
                
                if (!text || text.toLowerCase() === 'non définie' || text.toLowerCase() === 'n/a') {
                    cell.innerHTML = '<span class="badge bg-secondary text-white salle-badge" data-bs-toggle="tooltip" title="Aucune salle assignée">Non définie</span>';
                } else {
                    cell.innerHTML = `<span class="badge bg-info text-white salle-badge" data-bs-toggle="tooltip" title="Salle: ${text}">${text}</span>`;
                }
            }
        });
    }
    
    /**
     * Améliore l'apparence des badges
     */
    function fixBadges() {
        // S'assurer que tous les badges ont une couleur de fond
        document.querySelectorAll('.badge, .theme-badge').forEach(badge => {
            // Si le badge n'a pas de classe bg-* et pas de background-color, ajouter une classe par défaut
            const hasBgClass = Array.from(badge.classList).some(cls => cls.startsWith('bg-'));
            const hasInlineStyle = badge.style.backgroundColor && badge.style.backgroundColor !== 'transparent';
            
            if (!hasBgClass && !hasInlineStyle) {
                // Essayer de détecter le type de badge
                if (badge.classList.contains('theme-badge')) {
                    const theme = badge.textContent.trim();
                    if (theme.includes('Teams') && theme.includes('Communiquer')) {
                        badge.classList.add('theme-comm');
                    } else if (theme.includes('Planner')) {
                        badge.classList.add('theme-planner');
                    } else if (theme.includes('OneDrive') || theme.includes('fichiers')) {
                        badge.classList.add('theme-onedrive');
                    } else if (theme.includes('Collaborer')) {
                        badge.classList.add('theme-sharepoint');
                    } else {
                        badge.classList.add('bg-primary');
                    }
                } else if (badge.classList.contains('salle-badge')) {
                    badge.classList.add('bg-info');
                } else {
                    badge.classList.add('bg-secondary');
                }
            }
            
            // S'assurer que le texte est lisible (texte blanc sur fond foncé)
            if (!badge.classList.contains('text-white') && !badge.classList.contains('text-dark')) {
                badge.classList.add('text-white');
            }
        });
    }

    /**
     * Améliore l'accessibilité des éléments de la page
     */
    function enhanceAccessibility() {
        // Assurer que les boutons ont un attribut "type"
        document.querySelectorAll('button:not([type])').forEach(button => {
            // Si dans un formulaire, supposer submit, sinon button
            const isInForm = button.closest('form') !== null;
            button.setAttribute('type', isInForm ? 'submit' : 'button');
        });

        // Assurer que les tableaux ont un caption pour les lecteurs d'écran
        document.querySelectorAll('table:not(:has(caption))').forEach(table => {
            // Vérifier si une légende est nécessaire (table de données vs disposition)
            if (table.querySelector('th') || table.querySelector('[scope]')) {
                const headerText = table.querySelector('thead th')?.textContent.trim();
                const nearestHeading = table.previousElementSibling?.closest('h1, h2, h3, h4, h5, h6')?.textContent.trim();
                
                // Créer caption seulement si un texte est disponible
                if (headerText || nearestHeading) {
                    const caption = document.createElement('caption');
                    caption.className = 'visually-hidden'; // Masqué visuellement mais accessible aux lecteurs d'écran
                    caption.textContent = headerText || nearestHeading || 'Tableau de données';
                    table.prepend(caption);
                }
            }
        });

        // Ajouter des attributs alt aux images qui n'en ont pas
        document.querySelectorAll('img:not([alt])').forEach(img => {
            // Essayer de déduire un alt significatif
            let altText = '';
            if (img.src) {
                const filename = img.src.split('/').pop().split('?')[0];
                const nameWithoutExt = filename.split('.')[0];
                altText = nameWithoutExt.replace(/[_-]/g, ' ').replace(/([a-z])([A-Z])/g, '$1 $2'); // Convertir camelCase et snake_case
                altText = altText.charAt(0).toUpperCase() + altText.slice(1); // Majuscule première lettre
            }
            
            img.setAttribute('alt', altText || 'Image');
        });
        
        // Assurer que la page a un favicon pour éviter erreur 404
        if (!document.querySelector('link[rel="shortcut icon"]')) {
            const link = document.createElement('link');
            link.rel = 'shortcut icon';
            link.href = '/static/favicon.ico';
            document.head.appendChild(link);
        }
    }

    /**
     * Surveilleur de mutations pour détecter les changements dans le DOM et réappliquer les corrections si nécessaire
     */
    if (window.MutationObserver) {
        const config = { 
            attributes: true, 
            childList: true, 
            subtree: true, 
            characterData: false 
        };
        
        const callback = function(mutationsList, observer) {
            // Vérification rapide pour éviter trop d'invocations
            const now = Date.now();
            
            // Limiter la fréquence des appels de l'observateur de mutations
            if (internalConfig.limitMutationCallbacks && now - lastMutationHandled < mutationDebounceTime) {
                return;
            }
            
            const timeSinceLastApiCall = now - apiCallDetectedAt;
            let shouldTriggerFixes = false;
            
            for (const mutation of mutationsList) {
                // Ignorer les mutations moins importantes comme les classes d'animation
                if (mutation.type === 'attributes' && 
                    (mutation.attributeName === 'style' || 
                     mutation.attributeName === 'class' && mutation.target.classList.contains('fade'))) {
                    continue;
                }
                
                // Ignorer les mutations dans certains conteneurs (popups, tooltips)
                if (mutation.target && (
                    mutation.target.classList.contains('tooltip') || 
                    mutation.target.classList.contains('popover') ||
                    mutation.target.closest('.tooltip, .popover'))) {
                    continue;
                }
                
                // Si un changement pertinent est détecté
                // Évaluer si le changement a pu affecter le contenu qui nous intéresse
                if (mutation.type === 'childList' && mutation.addedNodes.length > 0) {
                    // Analyser les noeuds ajoutés
                    for (const node of mutation.addedNodes) {
                        if (node.nodeType === 1) { // Element node
                            // Vérifier si l'élément ajouté contient des cibles intéressantes
                            if (node.querySelector('.places-dispo, .js-salle-cell, [data-bs-toggle="tooltip"], .theme-badge, .counter-value, .badge') ||
                                node.classList && (
                                    node.classList.contains('places-dispo') || 
                                    node.classList.contains('js-salle-cell') || 
                                    node.classList.contains('theme-badge') ||
                                    node.classList.contains('counter-value') ||
                                    node.classList.contains('badge'))) {
                                shouldTriggerFixes = true;
                                break;
                            }
                        }
                    }
                }
                
                // Si un API call a été détecté récemment (moins de 2 secondes), soyons moins stricts
                if (timeSinceLastApiCall < 2000) {
                    shouldTriggerFixes = true;
                    break;
                }
                
                if (shouldTriggerFixes) break;
            }
            
            if (shouldTriggerFixes) {
                if (DASH_CONFIG.debugMode) console.log('UI Fixers: Relevant DOM change detected, queueing reapplication of fixes.');
                debouncedApplyAllFixes();
                lastMutationHandled = now;
            }
        };
        
        const observer = new MutationObserver(callback);
        observer.observe(document.body, config);
        
        if (DASH_CONFIG.debugMode) console.log('UI Fixers: MutationObserver started');
    }

    // Exporter les fonctions publiques
    window.uiFixers = {
        applyAllFixes: applyAllFixes,
        enhanceLabels: enhanceLabels,
        fixTooltips: fixTooltips,
        fixSessionInfo: fixSessionInfo,
        fixSalleDisplay: fixSalleDisplay,
        enhancePlacesRestantes: enhancePlacesRestantes,
        enhanceAccessibility: enhanceAccessibility,
        fixBadges: fixBadges,
        fixMissingData: fixMissingData
    };
});
