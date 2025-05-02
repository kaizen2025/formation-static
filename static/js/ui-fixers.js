/**
 * ui-fixers.js - Correctifs pour l'interface utilisateur
 * Résout les problèmes d'affichage et améliore la cohérence des informations
 * v1.0.0
 */
document.addEventListener('DOMContentLoaded', function() {
    console.log('UI Fixers initialized v1.0.0');
    
    // Configuration
    const config = {
        debugMode: window.dashboardConfig && window.dashboardConfig.debugMode || false,
        enhanceLabels: true, // Amélioration des libellés
        fixTooltips: true, // Correction des info-bulles
        fixSessionInfo: true, // Amélioration des informations de session
        fixSalleDisplay: true, // Correction de l'affichage des salles
        enhanceAccessibility: true, // Amélioration de l'accessibilité
    };
    
    // Exécuter les correctifs au chargement initial
    setTimeout(applyAllFixes, 500);
    
    // Réappliquer les correctifs lors des mises à jour AJAX
    const originalFetch = window.fetch;
    window.fetch = async function(...args) {
        const response = await originalFetch.apply(this, args);
        const url = args[0].toString();
        
        // Si la requête concerne l'API, appliquer les correctifs après un court délai
        if (url.includes('/api/')) {
            setTimeout(applyAllFixes, 300);
        }
        
        return response;
    };
    
    /**
     * Applique tous les correctifs configurés
     */
    function applyAllFixes() {
        if (config.debugMode) console.log('UI Fixers: Applying all fixes...');
        
        if (config.enhanceLabels) enhanceLabels();
        if (config.fixTooltips) fixTooltips();
        if (config.fixSessionInfo) fixSessionInfo();
        if (config.fixSalleDisplay) fixSalleDisplay();
        if (config.enhanceAccessibility) enhanceAccessibility();
        
        if (config.debugMode) console.log('UI Fixers: All fixes applied');
    }
    
    /**
     * Améliore les libellés pour une meilleure clarté
     */
    function enhanceLabels() {
        // Améliorer les libellés des boutons et liens
        document.querySelectorAll('a, button').forEach(el => {
            if (el.textContent.trim() === 'Voir Participants') {
                el.innerHTML = '<i class="fas fa-users me-1"></i>Liste des participants';
            } else if (el.textContent.trim() === 'Gérer Salle') {
                el.innerHTML = '<i class="fas fa-building me-1"></i>Gérer la salle';
            }
        });
        
        // Améliorer les titres des tableaux et sections
        document.querySelectorAll('.card-header h5, .card-header .card-title').forEach(el => {
            if (el.textContent.includes('Sessions à venir')) {
                el.innerHTML = '<i class="fas fa-calendar-alt me-2"></i>Sessions à venir';
            } else if (el.textContent.includes('Participants par service')) {
                el.innerHTML = '<i class="fas fa-users me-2"></i>Répartition par service';
            } else if (el.textContent.includes('Répartition par thème')) {
                el.innerHTML = '<i class="fas fa-book me-2"></i>Répartition par thème';
            }
        });
    }
    
    /**
     * Corrige les info-bulles et en ajoute de nouvelles
     */
    function fixTooltips() {
        // Supprimer les anciennes info-bulles
        const oldTooltips = document.querySelectorAll('.tooltip');
        oldTooltips.forEach(tooltip => tooltip.remove());
        
        // Ajouter des info-bulles pour les éléments qui en ont besoin
        document.querySelectorAll('[data-bs-toggle="tooltip"], [title]:not(script):not(style)').forEach(el => {
            // S'assurer que Bootstrap est chargé
            if (typeof bootstrap !== 'undefined' && typeof bootstrap.Tooltip === 'function') {
                try {
                    new bootstrap.Tooltip(el, {
                        boundary: document.body,
                        container: 'body',
                        trigger: 'hover focus'
                    });
                } catch (e) {
                    console.warn('UI Fixers: Error creating tooltip', e);
                }
            }
        });
        
        // Ajouter des attributs title aux éléments qui devraient en avoir
        document.querySelectorAll('.salle-badge, .places-dispo, .theme-badge').forEach(el => {
            if (!el.getAttribute('title')) {
                if (el.classList.contains('salle-badge')) {
                    el.setAttribute('title', 'Salle assignée à cette session');
                } else if (el.classList.contains('places-dispo')) {
                    el.setAttribute('title', 'Places disponibles / Capacité totale');
                } else if (el.classList.contains('theme-badge')) {
                    el.setAttribute('title', 'Thème de la formation');
                }
                
                // Initialiser l'info-bulle
                if (typeof bootstrap !== 'undefined' && typeof bootstrap.Tooltip === 'function') {
                    try {
                        new bootstrap.Tooltip(el, {
                            boundary: document.body,
                            container: 'body'
                        });
                    } catch (e) {
                        console.warn('UI Fixers: Error creating tooltip for element', e);
                    }
                }
            }
        });
    }
    
    /**
     * Améliore l'affichage des informations de session
     */
    function fixSessionInfo() {
        // Améliorer la lisibilité des informations de session dans les tableaux
        document.querySelectorAll('table tr').forEach(row => {
            const dateCell = row.querySelector('td:first-child');
            const themeCell = row.querySelector('td:nth-child(2)');
            
            if (dateCell && themeCell) {
                // Mettre en gras la date
                const dateContent = dateCell.innerHTML;
                if (dateContent.includes('/') && !dateContent.includes('<strong>')) {
                    const parts = dateContent.split('<br>');
                    if (parts.length > 0) {
                        const newDate = `<strong>${parts[0]}</strong>`;
                        const newTime = parts.length > 1 ? `<br>${parts[1]}` : '';
                        dateCell.innerHTML = newDate + newTime;
                    }
                }
                
                // S'assurer que le thème a un badge correctement stylisé
                if (themeCell.textContent.trim() && !themeCell.querySelector('.badge')) {
                    const theme = themeCell.textContent.trim();
                    let badgeClass = 'theme-badge ';
                    
                    if (theme.includes('Teams') && theme.includes('Communiquer')) {
                        badgeClass += 'theme-comm';
                    } else if (theme.includes('Planner')) {
                        badgeClass += 'theme-planner';
                    } else if (theme.includes('OneDrive') || theme.includes('fichiers')) {
                        badgeClass += 'theme-onedrive';
                    } else if (theme.includes('Teams') && theme.includes('Collaborer')) {
                        badgeClass += 'theme-sharepoint';
                    } else {
                        badgeClass += 'bg-secondary';
                    }
                    
                    themeCell.innerHTML = `<span class="badge ${badgeClass}">${theme}</span>`;
                }
            }
        });
        
        // Améliorer l'affichage des places disponibles
        document.querySelectorAll('.places-dispo').forEach(el => {
            const text = el.textContent.trim();
            if (text.includes('/')) {
                const [dispo, total] = text.split('/').map(n => parseInt(n.trim(), 10));
                
                if (!isNaN(dispo) && !isNaN(total)) {
                    // Ajouter une classe de couleur en fonction du taux de remplissage
                    let colorClass = 'text-success';
                    if (dispo === 0) {
                        colorClass = 'text-danger';
                    } else if (dispo <= total * 0.2) { // Moins de 20% de places restantes
                        colorClass = 'text-danger';
                    } else if (dispo <= total * 0.4) { // Moins de 40% de places restantes
                        colorClass = 'text-warning';
                    }
                    
                    // Si l'élément n'a pas déjà la bonne classe, la remplacer
                    if (!el.classList.contains(colorClass)) {
                        el.classList.remove('text-success', 'text-warning', 'text-danger');
                        el.classList.add(colorClass);
                    }
                    
                    // Ajouter une icône visuelle
                    if (!el.querySelector('i')) {
                        let icon = 'fa-check-circle';
                        if (dispo === 0) {
                            icon = 'fa-times-circle';
                        } else if (dispo <= total * 0.2) {
                            icon = 'fa-exclamation-circle';
                        } else if (dispo <= total * 0.4) {
                            icon = 'fa-exclamation-triangle';
                        }
                        
                        el.innerHTML = `<i class="fas ${icon} me-1"></i> ${dispo} / ${total}`;
                    }
                }
            }
        });
    }
    
    /**
     * Corrige l'affichage des salles qui apparaissent/disparaissent
     */
    function fixSalleDisplay() {
        // Stabiliser l'affichage des badges de salle
        document.querySelectorAll('.salle, td:contains("Salle")').forEach(el => {
            const salleText = el.textContent.trim();
            
            // Si c'est une cellule vide ou "Non définie", la formater correctement
            if (!salleText || salleText === 'N/A' || salleText.includes('Non définie')) {
                el.innerHTML = '<span class="badge bg-secondary text-white">Salle non définie</span>';
            } 
            // Si la salle existe mais n'est pas dans un badge, la formater correctement
            else if (!el.querySelector('.badge') && !el.classList.contains('badge')) {
                const salleName = salleText.replace('Salle', '').trim();
                el.innerHTML = `<span class="badge bg-info text-white">${salleName || 'Salle'}</span>`;
            }
        });
        
        // Stabiliser les badges de salle dans les tableaux de session
        document.querySelectorAll('table tr td:nth-child(4), .salle-cell').forEach(cell => {
            if (!cell.querySelector('.badge, .salle-badge')) {
                if (cell.textContent.trim() === '' || cell.textContent.trim() === 'N/A') {
                    cell.innerHTML = '<span class="badge bg-secondary salle-badge">Non définie</span>';
                } else {
                    const salleName = cell.textContent.trim();
                    cell.innerHTML = `<span class="badge bg-info text-white salle-badge">${salleName}</span>`;
                }
            }
        });
    }
    
    /**
     * Améliore l'accessibilité de l'interface
     */
    function enhanceAccessibility() {
        // Ajouter des attributs ARIA aux éléments interactifs
        document.querySelectorAll('button:not([aria-label]), a.btn:not([aria-label])').forEach(el => {
            if (!el.getAttribute('aria-label')) {
                el.setAttribute('aria-label', el.textContent.trim());
            }
        });
        
        // Améliorer le contraste des éléments textuels
        document.querySelectorAll('.text-muted').forEach(el => {
            // Remplacer text-muted par des couleurs avec meilleur contraste
            el.classList.remove('text-muted');
            el.classList.add('text-secondary');
        });
        
        // Ajouter des attributs alt aux images sans alt
        document.querySelectorAll('img:not([alt])').forEach(img => {
            img.setAttribute('alt', 'Image ' + (img.getAttribute('src') || '').split('/').pop());
        });
    }

    // Exposer les fonctions pour une utilisation externe
    window.uiFixers = {
        applyAllFixes,
        enhanceLabels,
        fixTooltips,
        fixSessionInfo,
        fixSalleDisplay,
        enhanceAccessibility
    };
    
    // Réappliquer les correctifs après des mises à jour dynamiques
    document.addEventListener('DOMNodeInserted', function(e) {
        // Vérifier si l'élément inséré ou ses enfants sont pertinents
        if (e.target && (
            e.target.classList?.contains('card') || 
            e.target.classList?.contains('table') ||
            e.target.querySelector?.('.card, .table, tr, td, .badge')
        )) {
            // Appliquer les correctifs avec un léger délai
            setTimeout(applyAllFixes, 100);
        }
    });
    
    console.log('UI Fixers ready! v1.0.0');
});