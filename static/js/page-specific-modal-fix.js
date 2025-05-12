/**
 * page-specific-modal-fix.js - Fixes pour les modaux des pages salles et thèmes
 * À inclure en bas des pages problématiques avant le bloc endblock
 */
document.addEventListener('DOMContentLoaded', function() {
    const currentPath = window.location.pathname;
    
    // Vérifier si nous sommes sur les pages à problème
    const isThemesPage = currentPath.includes('/themes');
    const isSallesPage = currentPath.includes('/salles');
    
    if (!isThemesPage && !isSallesPage) return;
    
    console.log(`Modal Fix: Applying specific fixes for ${isThemesPage ? 'themes' : 'salles'} page`);
    
    // 1. Remplacer les attributs data-bs-toggle par data-portal-target
    document.querySelectorAll('[data-bs-toggle="modal"]').forEach(button => {
        const targetId = button.getAttribute('data-bs-target');
        if (!targetId) return;
        
        // Créer un nouveau bouton avec attributs portal
        const newButton = button.cloneNode(true);
        newButton.removeAttribute('data-bs-toggle');
        newButton.removeAttribute('data-bs-target');
        newButton.setAttribute('data-portal-target', targetId);
        
        // Remplacer l'ancien bouton
        button.parentNode.replaceChild(newButton, button);
        
        console.log(`Modal Fix: Converted button for ${targetId} to portal system`);
    });
    
    // 2. Convertir les data-bs-dismiss en data-portal-dismiss
    document.querySelectorAll('[data-bs-dismiss="modal"]').forEach(button => {
        button.removeAttribute('data-bs-dismiss');
        button.setAttribute('data-portal-dismiss', 'modal');
    });
    
    // 3. S'assurer que les sélecteurs dans les modaux sont visibles
    document.querySelectorAll('.modal select, .modal .form-select').forEach(select => {
        select.style.cssText = `
            display: block !important;
            visibility: visible !important;
            opacity: 1 !important;
            position: relative !important;
            z-index: 2000 !important;
            pointer-events: auto !important;
            -webkit-appearance: listbox !important;
            appearance: listbox !important;
        `;
    });
    
    // 4. Corriger les boutons dans les modaux
    document.querySelectorAll('.modal button:not(.btn-close), .modal .btn:not(.btn-close)').forEach(button => {
        button.style.cssText = `
            position: relative !important;
            z-index: 2001 !important;
            pointer-events: auto !important;
            opacity: 1 !important;
            visibility: visible !important;
        `;
    });
    
    // 5. Corriger les boutons de fermeture
    document.querySelectorAll('.modal .btn-close, .modal [data-portal-dismiss="modal"]').forEach(button => {
        button.style.cssText = `
            position: relative !important;
            z-index: 2005 !important;
            pointer-events: auto !important;
            opacity: 1 !important;
            visibility: visible !important;
        `;
    });
    
    // 6. Observer les modaux ajoutés au conteneur portal pour appliquer les styles
    // Ce fix est important pour gérer les modaux qui sont déplacés dans le conteneur portal
    if (window.MutationObserver) {
        const portalContainer = document.getElementById('portal-modal-container');
        if (portalContainer) {
            const observer = new MutationObserver(function(mutations) {
                mutations.forEach(function(mutation) {
                    if (mutation.addedNodes && mutation.addedNodes.length > 0) {
                        for (let i = 0; i < mutation.addedNodes.length; i++) {
                            const node = mutation.addedNodes[i];
                            if (node.classList && node.classList.contains('portal-modal')) {
                                console.log("Modal Fix: New portal modal added, applying styles");
                                
                                // Appliquer les styles aux selects
                                node.querySelectorAll('select, .form-select').forEach(select => {
                                    select.style.cssText = `
                                        display: block !important;
                                        visibility: visible !important;
                                        opacity: 1 !important;
                                        position: relative !important;
                                        z-index: 2000 !important;
                                        pointer-events: auto !important;
                                        -webkit-appearance: listbox !important;
                                        appearance: listbox !important;
                                    `;
                                });
                                
                                // Appliquer les styles aux boutons
                                node.querySelectorAll('button:not(.btn-close), .btn:not(.btn-close)').forEach(button => {
                                    button.style.cssText = `
                                        position: relative !important;
                                        z-index: 2001 !important;
                                        pointer-events: auto !important;
                                        opacity: 1 !important;
                                        visibility: visible !important;
                                    `;
                                });
                            }
                        }
                    }
                });
            });
            
            observer.observe(portalContainer, { childList: true });
        }
    }
    
    console.log("Modal Fix: Page-specific fixes applied successfully");
});