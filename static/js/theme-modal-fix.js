// /static/js/theme-modal-fix.js
/**
 * Solution ULTRA-AGRESSIVE spécifiquement pour les modals de la page Thèmes
 * Désactive totalement le système Bootstrap et en utilise un personnalisé
 */
(function() {
    console.log("Theme Modal Fix: Initializing with extreme measures...");
    
    // Vérifier si nous sommes sur la page des thèmes
    if (!window.location.pathname.includes('/themes')) {
        console.log("Theme Modal Fix: Not on themes page, exiting");
        return;
    }
    
    console.log("Theme Modal Fix: Running on themes page");
    
    // Créer un conteneur spécial pour nos modals
    const themePortalContainer = document.createElement('div');
    themePortalContainer.id = 'theme-modal-container';
    themePortalContainer.style.cssText = `
        position: fixed;
        top: 0;
        left: 0;
        width: 100%;
        height: 100%;
        z-index: 99999;
        pointer-events: none;
    `;
    document.body.appendChild(themePortalContainer);
    
    // Interception IMMÉDIATE de tous les clics sur toute la page
    document.addEventListener('click', function(e) {
        // Chercher si le clic concerne un bouton de modal
        const modalOpener = e.target.closest('[data-bs-toggle="modal"]');
        if (modalOpener) {
            e.preventDefault();
            e.stopPropagation();
            
            // Récupérer l'ID du modal ciblé
            const targetId = modalOpener.getAttribute('data-bs-target');
            if (!targetId) return;
            
            console.log(`Theme Modal Fix: Intercepted click for modal ${targetId}`);
            showModalWithPortal(targetId);
        }
        
        // Chercher si c'est un bouton de fermeture de modal
        const modalCloser = e.target.closest('[data-bs-dismiss="modal"], .btn-close');
        if (modalCloser && themePortalContainer.querySelector('.portal-modal')) {
            e.preventDefault();
            e.stopPropagation();
            
            closeActivePortalModal();
        }
    }, true); // Utilisation de la phase de capture pour intercepter avant tout autre gestionnaire
    
    // Fonction pour afficher un modal avec notre mécanisme de portal
    function showModalWithPortal(targetId) {
        console.log(`Theme Modal Fix: Opening modal with portal: ${targetId}`);
        
        // Nettoyer tout modal actif
        closeActivePortalModal();
        
        // Récupérer le modal original
        const originalModal = document.querySelector(targetId);
        if (!originalModal) {
            console.error(`Theme Modal Fix: Modal ${targetId} not found!`);
            return;
        }
        
        // 1. Créer le backdrop
        const backdrop = document.createElement('div');
        backdrop.className = 'portal-backdrop';
        backdrop.style.cssText = `
            position: fixed;
            top: 0;
            left: 0;
            width: 100vw;
            height: 100vh;
            background-color: rgba(0, 0, 0, 0.5);
            z-index: 999999;
            pointer-events: auto;
        `;
        themePortalContainer.appendChild(backdrop);
        
        // 2. Créer notre conteneur de modal
        const portalModal = document.createElement('div');
        portalModal.className = 'portal-modal';
        portalModal.style.cssText = `
            position: fixed;
            top: 50%;
            left: 50%;
            transform: translate(-50%, -50%);
            width: auto;
            max-width: 90vw;
            max-height: 90vh;
            background-color: white;
            border-radius: 6px;
            box-shadow: 0 5px 15px rgba(0, 0, 0, 0.5);
            z-index: 1000000;
            pointer-events: auto;
            overflow: auto;
        `;
        
        // 3. Cloner le contenu du modal original dans notre portal
        // (Nous prenons .modal-content pour éviter les structures imbriquées)
        const modalContent = originalModal.querySelector('.modal-content');
        if (modalContent) {
            const clonedContent = modalContent.cloneNode(true);
            portalModal.appendChild(clonedContent);
            themePortalContainer.appendChild(portalModal);
            
            // 4. Activer les interactions sur les éléments de formulaire
            portalModal.querySelectorAll('select, .form-select').forEach(select => {
                select.style.cssText = `
                    display: block !important;
                    visibility: visible !important;
                    opacity: 1 !important;
                    -webkit-appearance: listbox !important;
                    appearance: listbox !important;
                `;
            });
            
            portalModal.querySelectorAll('input, textarea, button, .btn').forEach(el => {
                el.style.pointerEvents = 'auto';
                el.style.opacity = '1';
                el.style.visibility = 'visible';
            });
            
            // 5. Améliorer les éléments d'UI (badges, etc.)
            if (typeof window.enhanceThemeBadgesGlobally === 'function') {
                setTimeout(() => {
                    window.enhanceThemeBadgesGlobally(portalModal);
                }, 10);
            }
            
            // 6. Gérer les formulaires dans le portal
            portalModal.querySelectorAll('form').forEach(form => {
                // Récupérer la cible originale
                const originalForm = document.querySelector(`form[action="${form.getAttribute('action')}"]`);
                
                form.addEventListener('submit', function(e) {
                    e.preventDefault();
                    
                    // Si le formulaire original existe, soumettre celui-là
                    if (originalForm) {
                        // Transférer toutes les valeurs vers le formulaire original
                        form.querySelectorAll('input, select, textarea').forEach(input => {
                            const name = input.name;
                            if (name) {
                                const originalInput = originalForm.querySelector(`[name="${name}"]`);
                                if (originalInput) {
                                    if (input.type === 'checkbox' || input.type === 'radio') {
                                        originalInput.checked = input.checked;
                                    } else {
                                        originalInput.value = input.value;
                                    }
                                }
                            }
                        });
                        
                        // Soumettre le formulaire original
                        originalForm.submit();
                    } else {
                        // Fallback: créer un nouveau formulaire et le soumettre
                        const newForm = document.createElement('form');
                        newForm.method = form.method || 'post';
                        newForm.action = form.action;
                        
                        form.querySelectorAll('input, select, textarea').forEach(input => {
                            if (input.name) {
                                const clone = input.cloneNode(true);
                                newForm.appendChild(clone);
                            }
                        });
                        
                        document.body.appendChild(newForm);
                        newForm.submit();
                        document.body.removeChild(newForm);
                    }
                });
            });
            
            // 7. Focus sur le premier champ
            setTimeout(() => {
                const firstInput = portalModal.querySelector('input:not([type="hidden"]), select, textarea');
                if (firstInput) {
                    try {
                        firstInput.focus();
                    } catch (e) {}
                }
            }, 50);
        } else {
            console.error(`Theme Modal Fix: No .modal-content found in ${targetId}`);
            themePortalContainer.appendChild(portalModal);
        }
        
        // 8. Gérer le clic sur le backdrop
        backdrop.addEventListener('click', function() {
            closeActivePortalModal();
        });
        
        // 9. Gérer la touche Escape
        document.addEventListener('keydown', escapeHandler);
        
        // 10. Désactiver le scroll du body
        document.body.style.overflow = 'hidden';
    }
    
    // Fonction pour fermer le modal actif
    function closeActivePortalModal() {
        // Supprimer tout modal et backdrop du portal
        while (themePortalContainer.firstChild) {
            themePortalContainer.removeChild(themePortalContainer.firstChild);
        }
        
        // Réactiver le scroll
        document.body.style.overflow = '';
        
        // Supprimer le gestionnaire d'escape
        document.removeEventListener('keydown', escapeHandler);
    }
    
    // Gestionnaire d'escape pour fermer le modal
    function escapeHandler(e) {
        if (e.key === 'Escape' && themePortalContainer.querySelector('.portal-modal')) {
            closeActivePortalModal();
        }
    }
    
    // Précharger les modals pour éviter le scintillement
    function preloadThemeModals() {
        // Trouver tous les modals de thème
        const themeModals = document.querySelectorAll('.modal');
        
        themeModals.forEach(modal => {
            // Créer des versions préchargées invisibles
            const preloadModal = document.createElement('div');
            preloadModal.className = 'preload-modal';
            preloadModal.dataset.targetId = modal.id;
            preloadModal.style.cssText = `
                position: absolute;
                visibility: hidden;
                opacity: 0;
                pointer-events: none;
            `;
            
            // Cloner le contenu
            const content = modal.querySelector('.modal-content');
            if (content) {
                preloadModal.appendChild(content.cloneNode(true));
                themePortalContainer.appendChild(preloadModal);
            }
        });
    }
    
    // Exécution du préchargement après un délai
    setTimeout(preloadThemeModals, 500);
    
    console.log("Theme Modal Fix: Initialized with extreme portal approach");
})();