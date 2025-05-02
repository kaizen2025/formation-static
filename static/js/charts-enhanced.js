/**
 * charts-enhanced.js - Amélioration des graphiques statiques
 * Modernise l'affichage des graphiques et ajoute des descriptions détaillées
 */

document.addEventListener('DOMContentLoaded', function() {
    console.log("Enhanced Charts: Initialisation...");
    
    // Configuration et données
    const config = {
        animateCharts: true,       // Activer les animations
        enableTooltips: true,      // Activer les tooltips détaillés
        enhanceDonut: true,        // Améliorer le graphique en donut
        enhanceBars: true,         // Améliorer le graphique en barres
        fixDashboard: true,        // Correctifs pour le dashboard
        debugMode: false           // Mode debug
    };
    
    // Descriptions des thèmes de formation pour les tooltips
    const themesData = {
        'Communiquer avec Teams': {
            description: 'Maîtrisez la communication en ligne avec Microsoft Teams. Apprenez à créer des conversations, organiser des réunions virtuelles et partager des fichiers efficacement.',
            icon: 'fas fa-comments',
            color: 'var(--theme-teams)',
            class: 'theme-comm'
        },
        'Gérer les tâches (Planner)': {
            description: 'Organisez et suivez vos tâches d\'équipe avec Microsoft Planner. Créez des plans, assignez des tâches et visualisez la progression de vos projets.',
            icon: 'fas fa-tasks',
            color: 'var(--theme-planner)',
            class: 'theme-planner'
        },
        'Gérer mes fichiers (OneDrive/SharePoint)': {
            description: 'Stockez, partagez et collaborez sur vos documents avec OneDrive et SharePoint. Apprenez à synchroniser vos fichiers et à gérer les autorisations d\'accès.',
            icon: 'fas fa-file-alt',
            color: 'var(--theme-onedrive)',
            class: 'theme-onedrive'
        },
        'Collaborer avec Teams': {
            description: 'Travaillez en équipe efficacement grâce aux fonctionnalités collaboratives de Teams. Créez des canaux, partagez des documents et intégrez d\'autres applications Office 365.',
            icon: 'fas fa-users',
            color: 'var(--theme-sharepoint)',
            class: 'theme-sharepoint'
        }
    };
    
    // Données des services pour les tooltips et améliorations
    const servicesData = {
        'Commerce Anecoop-Solagora': {
            description: 'Service commercial gérant les relations clients et les ventes de produits.',
            icon: 'fas fa-shopping-cart',
            color: 'var(--service-commerce)',
            class: 'commerce'
        },
        'Comptabilité': {
            description: 'Service financier en charge de la comptabilité et des opérations financières.',
            icon: 'fas fa-calculator',
            color: 'var(--service-comptabilite)',
            class: 'comptabilite'
        },
        'Florensud': {
            description: 'Service dédié à la gestion des produits floraux et horticoles.',
            icon: 'fas fa-leaf',
            color: 'var(--service-florensud)',
            class: 'florensud'
        },
        'Informatique': {
            description: 'Service en charge des systèmes d\'information et du support technique.',
            icon: 'fas fa-laptop-code',
            color: 'var(--service-informatique)',
            class: 'informatique'
        },
        'Marketing': {
            description: 'Service responsable de la stratégie marketing et communication.',
            icon: 'fas fa-bullhorn',
            color: 'var(--service-marketing)',
            class: 'marketing'
        },
        'Qualité': {
            description: 'Service en charge du contrôle qualité et des processus.',
            icon: 'fas fa-clipboard-check',
            color: 'var(--service-qualite)',
            class: 'qualite'
        },
        'RH': {
            description: 'Service des ressources humaines gérant le personnel et les formations.',
            icon: 'fas fa-users',
            color: 'var(--service-rh)',
            class: 'rh'
        }
    };
    
    /**
     * Améliore le graphique en donut (répartition par thème)
     */
    function enhanceDonutChart() {
        // Sélectionner le conteneur du graphique en donut
        const donutContainer = document.getElementById('themeChart')?.parentElement;
        if (!donutContainer) {
            return false;
        }
        
        // Ajouter une classe pour l'animation si elle n'existe pas déjà
        if (config.animateCharts && !donutContainer.classList.contains('animate')) {
            donutContainer.classList.add('animate');
        }
        
        // Ajouter un titre explicite s'il n'existe pas déjà
        if (!donutContainer.querySelector('.static-chart-title')) {
            const title = document.createElement('h5');
            title.className = 'static-chart-title';
            title.textContent = 'RÉPARTITION PAR THÈME';
            donutContainer.insertBefore(title, donutContainer.firstChild);
        }
        
        // Récupérer les segments du donut
        const segments = donutContainer.querySelectorAll('.donut-segment');
        segments.forEach((segment, index) => {
            // Ajouter un index pour l'animation
            segment.style.setProperty('--index', index);
            
            // S'assurer que la rotation est correctement définie
            if (!segment.style.getPropertyValue('--rotation')) {
                // Fallback si la rotation n'est pas définie
                segment.style.setProperty('--rotation', `${index * 90}`);
            }
        });
        
        // Améliorer la légende
        const legendItems = donutContainer.querySelectorAll('.legend-item');
        legendItems.forEach(item => {
            const themeName = item.textContent.trim().replace(/\d+/g, '').trim();
            const themeCount = item.textContent.match(/\d+/) ? item.textContent.match(/\d+/)[0] : '0';
            
            if (themesData[themeName] && config.enableTooltips) {
                // Ajouter un tooltip avec la description
                const tooltip = document.createElement('div');
                tooltip.className = 'bar-tooltip';
                tooltip.textContent = themesData[themeName].description;
                item.appendChild(tooltip);
                
                // Ajouter une classe pour le style au survol
                item.classList.add('has-tooltip');
            }
            
            // Restructurer la légende si nécessaire
            if (!item.querySelector('.legend-label')) {
                // Vider l'élément tout en conservant les données-attributs
                const attrs = {};
                Array.from(item.attributes).forEach(attr => {
                    attrs[attr.name] = attr.value;
                });
                
                const oldHTML = item.innerHTML;
                item.innerHTML = '';
                
                // Recréer le contenu avec une structure améliorée
                // Conserver le carré de couleur s'il existe
                if (oldHTML.includes('legend-color')) {
                    const colorDiv = document.createElement('div');
                    colorDiv.className = 'legend-color';
                    
                    // Extraire la couleur du style si possible
                    const colorStyle = oldHTML.match(/background-color: ([^;]*);/);
                    if (colorStyle && colorStyle[1]) {
                        colorDiv.style.backgroundColor = colorStyle[1];
                    } else if (themesData[themeName]) {
                        colorDiv.style.backgroundColor = themesData[themeName].color;
                    }
                    
                    item.appendChild(colorDiv);
                }
                
                // Ajouter le libellé
                const label = document.createElement('span');
                label.className = 'legend-label';
                label.textContent = themeName;
                item.appendChild(label);
                
                // Ajouter le compteur
                const value = document.createElement('span');
                value.className = 'legend-value';
                value.textContent = themeCount;
                item.appendChild(value);
                
                // Restaurer les attributs
                Object.keys(attrs).forEach(name => {
                    if (name !== 'class' && name !== 'style') {
                        item.setAttribute(name, attrs[name]);
                    }
                });
            }
        });
        
        return true;
    }
    
    /**
     * Améliore le graphique en barres (participants par service)
     */
    function enhanceBarChart() {
        // Sélectionner le conteneur du graphique en barres
        const barContainer = document.getElementById('serviceChart')?.parentElement;
        if (!barContainer) {
            return false;
        }
        
        // Ajouter une classe pour l'animation si elle n'existe pas déjà
        if (config.animateCharts && !barContainer.classList.contains('animate')) {
            barContainer.classList.add('animate');
        }
        
        // Ajouter un titre explicite s'il n'existe pas déjà
        if (!barContainer.querySelector('.static-chart-title')) {
            const title = document.createElement('h5');
            title.className = 'static-chart-title';
            title.textContent = 'PARTICIPANTS PAR SERVICE';
            barContainer.insertBefore(title, barContainer.firstChild);
        }
        
        // Améliorer les barres
        const barItems = barContainer.querySelectorAll('.bar-item');
        barItems.forEach((item, index) => {
            // Récupérer le nom du service
            const labelElement = item.querySelector('.bar-label');
            const serviceName = labelElement ? labelElement.textContent.trim() : '';
            const serviceData = servicesData[serviceName] || {
                description: 'Service Anecoop France',
                icon: 'fas fa-building',
                color: '#6c757d',
                class: 'default'
            };
            
            // Ajouter un index pour l'animation
            const barValue = item.querySelector('.bar-value');
            if (barValue) {
                barValue.style.setProperty('--index', index);
                
                // Ajouter la classe pour la couleur si elle n'existe pas déjà
                if (serviceData.class && !barValue.classList.contains(serviceData.class)) {
                    barValue.classList.add(serviceData.class);
                }
            }
            
            // Ajouter un tooltip si activé
            if (config.enableTooltips) {
                const tooltip = document.createElement('div');
                tooltip.className = 'bar-tooltip';
                tooltip.textContent = serviceData.description;
                item.appendChild(tooltip);
            }
            
            // Ajouter un en-tête avec le nombre total si ce n'est pas déjà fait
            if (!item.querySelector('.bar-header') && labelElement) {
                // Récupérer le nombre de participants
                const countElement = item.querySelector('.bar-count');
                const count = countElement ? countElement.textContent.trim() : '1';
                
                // Créer l'en-tête
                const header = document.createElement('div');
                header.className = 'bar-header';
                
                // Ajouter une icône au libellé si elle n'existe pas déjà
                if (!labelElement.querySelector('i') && serviceData.icon) {
                    const icon = document.createElement('i');
                    icon.className = `${serviceData.icon} bar-icon`;
                    labelElement.insertBefore(icon, labelElement.firstChild);
                }
                
                // Déplacer le libellé dans l'en-tête
                header.appendChild(labelElement);
                
                // Ajouter le compteur
                const total = document.createElement('span');
                total.className = 'bar-total';
                total.textContent = count;
                header.appendChild(total);
                
                // Insérer l'en-tête au début de l'élément
                item.insertBefore(header, item.firstChild);
                
                // Supprimer l'ancien compteur s'il existe
                if (countElement) {
                    countElement.remove();
                }
            }
            
            // Calculer la largeur en pourcentage pour l'animation
            if (barValue) {
                // Obtenir la largeur actuelle si elle est définie
                const currentWidth = barValue.style.width;
                if (currentWidth && !barValue.style.getPropertyValue('--percent')) {
                    barValue.style.setProperty('--percent', currentWidth);
                }
            }
        });
        
        return true;
    }
    
    /**
     * Améliore les tooltips des badges de thèmes
     */
    function enhanceThemeBadges() {
        // Sélectionner tous les badges de thèmes
        document.querySelectorAll('.theme-badge').forEach(badge => {
            // Récupérer le nom du thème (supprimer les espaces en trop)
            const themeName = badge.textContent.trim();
            
            // Si le badge n'a pas déjà un tooltip et que le thème est connu
            if (!badge.querySelector('.theme-tooltip') && themesData[themeName]) {
                // Extraire l'icône existante si présente
                const hasIcon = badge.querySelector('i');
                const iconHtml = hasIcon ? hasIcon.outerHTML : '';
                
                // Ajouter la description dans un tooltip
                badge.innerHTML = `
                    ${iconHtml || `<i class="${themesData[themeName].icon} me-1"></i>`}${themeName}
                    <span class="theme-tooltip">
                        <strong>${themeName}</strong><br>
                        ${themesData[themeName].description}
                    </span>
                `;
            }
            
            // Ajouter la classe correspondant au thème si elle n'existe pas déjà
            if (themesData[themeName] && !badge.classList.contains(themesData[themeName].class)) {
                // Supprimer les classes existantes
                Object.values(themesData).forEach(data => {
                    if (data.class) {
                        badge.classList.remove(data.class);
                    }
                });
                
                // Ajouter la classe correcte
                badge.classList.add(themesData[themeName].class);
            }
        });
    }
    
    /**
     * Corrige l'affichage des thèmes sur le dashboard
     */
    function fixDashboardThemes() {
        if (!config.fixDashboard) {
            return false;
        }
        
        // Trouver les éléments qui contiennent "Thème de la formation"
        document.querySelectorAll('span:contains("Thème de la formation"), div:contains("Thème de la formation")').forEach(element => {
            // Vérifier si cet élément contient exactement ce texte
            if (element.childNodes.length === 1 && 
                element.childNodes[0].nodeType === Node.TEXT_NODE && 
                element.childNodes[0].textContent.trim() === "Thème de la formation") {
                
                // Rechercher l'élément parent qui contient la formation
                const parentElement = element.closest('.card, .row, .col, tr, td');
                if (!parentElement) {
                    return;
                }
                
                // Chercher le nom du thème dans les éléments voisins
                let themeName = null;
                let themeElement = null;
                
                // Chercher dans les éléments précédents/suivants
                Array.from(parentElement.querySelectorAll('span, div, p, h1, h2, h3, h4, h5, h6'))
                    .forEach(el => {
                        if (el !== element) {
                            Object.keys(themesData).forEach(theme => {
                                if (el.textContent.includes(theme)) {
                                    themeName = theme;
                                    themeElement = el;
                                }
                            });
                        }
                    });
                
                // Si un thème est trouvé
                if (themeName && themeElement) {
                    // Créer un badge de thème
                    const themeData = themesData[themeName];
                    const badgeHtml = `
                        <span class="theme-badge ${themeData.class}" data-theme="${themeName}">
                            <i class="${themeData.icon} me-1"></i>${themeName}
                            <span class="theme-tooltip">
                                <strong>${themeName}</strong><br>
                                ${themeData.description}
                            </span>
                        </span>
                    `;
                    
                    // Remplacer le texte "Thème de la formation" par le badge
                    element.outerHTML = badgeHtml;
                    
                    // Si l'élément du thème est différent, le supprimer (éviter les duplications)
                    if (themeElement !== element) {
                        themeElement.style.display = 'none';
                    }
                } else {
                    // Si aucun thème n'est trouvé, simplement cacher cet élément
                    element.style.display = 'none';
                }
            }
        });
        
        return true;
    }
    
    /**
     * Corrige les thèmes dans les tableaux
     */
    function fixThemesInTables() {
        // Pour chaque cellule de tableau qui pourrait contenir un thème
        document.querySelectorAll('table td:nth-child(2), th:contains("Thème") + td, td.theme-cell').forEach(cell => {
            const themeName = cell.textContent.trim();
            
            // Si la cellule contient un thème connu mais pas de badge
            if (themesData[themeName] && !cell.innerHTML.includes('theme-badge')) {
                // Créer un badge avec tooltip
                const themeData = themesData[themeName];
                cell.innerHTML = `
                    <span class="theme-badge ${themeData.class}" data-theme="${themeName}">
                        <i class="${themeData.icon} me-1"></i>${themeName}
                        <span class="theme-tooltip">
                            <strong>${themeName}</strong><br>
                            ${themeData.description}
                        </span>
                    </span>
                `;
            }
        });
    }
    
    /**
     * Initialise les tooltips Bootstrap
     */
    function initBootstrapTooltips() {
        if (typeof bootstrap !== 'undefined' && typeof bootstrap.Tooltip === 'function') {
            document.querySelectorAll('[data-bs-toggle="tooltip"]').forEach(function(tooltipTriggerEl) {
                try {
                    new bootstrap.Tooltip(tooltipTriggerEl);
                } catch (e) {
                    if (config.debugMode) {
                        console.warn("Erreur lors de l'initialisation d'un tooltip:", e);
                    }
                }
            });
        }
    }
    
    /**
     * Applique toutes les améliorations
     */
    function applyAllEnhancements() {
        if (config.debugMode) {
            console.log("Enhanced Charts: Applying all enhancements...");
        }
        
        // Améliorer les graphiques
        if (config.enhanceDonut) {
            enhanceDonutChart();
        }
        
        if (config.enhanceBars) {
            enhanceBarChart();
        }
        
        // Améliorer les badges et corriger les thèmes
        enhanceThemeBadges();
        fixThemesInTables();
        
        // Corriger le dashboard
        if (config.fixDashboard) {
            fixDashboardThemes();
        }
        
        // Initialiser les tooltips Bootstrap
        initBootstrapTooltips();
        
        if (config.debugMode) {
            console.log("Enhanced Charts: All enhancements applied.");
        }
    }
    
    // Appliquer les améliorations immédiatement
    applyAllEnhancements();
    
    // Appliquer à nouveau après un court délai (pour les éléments chargés via AJAX)
    setTimeout(applyAllEnhancements, 500);
    
    // Observer les modifications du DOM pour réappliquer les améliorations
    const observer = new MutationObserver(function(mutations) {
        let needsUpdate = false;
        
        mutations.forEach(function(mutation) {
            if (mutation.addedNodes.length > 0) {
                // Vérifier si les nouveaux nœuds contiennent des éléments pertinents
                for (let i = 0; i < mutation.addedNodes.length; i++) {
                    const node = mutation.addedNodes[i];
                    if (node.nodeType === 1) { // ELEMENT_NODE
                        if (node.matches('.static-chart-container, .card, .theme-badge, table, tr, td') ||
                            node.querySelector('.static-chart-container, .card, .theme-badge, table, tr, td')) {
                            needsUpdate = true;
                            break;
                        }
                    }
                }
            }
        });
        
        if (needsUpdate) {
            if (config.debugMode) {
                console.log("Enhanced Charts: DOM changes detected, reapplying enhancements...");
            }
            setTimeout(applyAllEnhancements, 50);
        }
    });
    
    // Observer les changements dans tout le document
    observer.observe(document.body, {
        childList: true,
        subtree: true
    });
    
    // Intercepter les requêtes fetch pour réappliquer les améliorations après les appels AJAX
    const originalFetch = window.fetch;
    window.fetch = function() {
        return originalFetch.apply(this, arguments)
            .then(response => {
                setTimeout(applyAllEnhancements, 300);
                return response;
            });
    };
    
    // Exposer l'API globalement
    window.enhancedCharts = {
        applyAllEnhancements,
        enhanceDonutChart,
        enhanceBarChart,
        enhanceThemeBadges,
        fixThemesInTables,
        fixDashboardThemes,
        config
    };
    
    console.log("Enhanced Charts: Initialization complete");
});