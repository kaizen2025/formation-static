/**
 * stable-modal-fix.js - Solution anti-scintillement pour les modales
 * Version ultra-robuste pour éliminer tout clignotement
 */
(function() {
    'use strict';
    
    // Configuration
    const config = {
        debug: false,
        log: function(message) { if (this.debug) console.log("StableModal:", message); },
        // Sélecteurs des boutons qui ouvrent les modales
        buttonSelectors: '[data-bs-toggle="modal"], [data-portal-target], .btn-modifier, .btn-delete-theme, [data-bs-target*="Modal"]'
    };
    
    // Capture les boutons déjà présents et les prépare
    function captureExistingButtons() {
        document.querySelectorAll(config.buttonSelectors).forEach(prepareButton);
    }
    
    // Prépare un bouton pour l'ouverture stable de modale
    function prepareButton(button) {
        // Éviter de traiter deux fois le même bouton
        if (button.dataset.stableModalFixed === 'true') return;
        
        // Identifier la cible
        let targetId = button.getAttribute('data-bs-target') || 
                       button.getAttribute('data-portal-target');
        
        if (!targetId && button.classList.contains('btn-modifier')) {
            // Pour les boutons de modification de salle
            const salleId = button.closest('[data-salle-id]')?.getAttribute('data-salle-id');
            if (salleId) targetId = `#editSalleModal${salleId}`;
        }
        
        if (!targetId && button.classList.contains('btn-delete-theme')) {
            // Pour les boutons de suppression de thème
            const themeId = button.getAttribute('data-theme-id');
            if (themeId) targetId = `#deleteThemeModal${themeId}`;
        }
        
        if (!targetId) {
            config.log(`Bouton sans cible identifiable: ${button.outerHTML}`);
            return;
        }
        
        // Enlever le # si présent
        targetId = targetId.replace(/^#/, '');
        
        // Remplacer le gestionnaire d'événements existant
        const newButton = button.cloneNode(true);
        newButton.dataset.stableModalFixed = 'true';
        button.parentNode.replaceChild(newButton, button);
        
        // Ajouter notre gestionnaire stable
        newButton.addEventListener('click', function(e) {
            e.preventDefault();
            e.stopPropagation();
            
            // Bloquer les autres clics pendant la transition
            this.style.pointerEvents = 'none';
            
            // Ouvrir la modale de manière stable
            stableModalOpen(targetId);
            
            // Réactiver le bouton après un court délai
            setTimeout(() => {
                this.style.pointerEvents = 'auto';
            }, 800);
        });
        
        config.log(`Bouton préparé pour la modale: ${targetId}`);
    }
    
    // Observer les nouveaux boutons ajoutés au DOM
    function setupButtonObserver() {
        if (!window.MutationObserver) return;
        
        const observer = new MutationObserver(mutations => {
            mutations.forEach(mutation => {
                if (mutation.type === 'childList') {
                    mutation.addedNodes.forEach(node => {
                        if (node.nodeType === 1) { // ELEMENT_NODE
                            if (node.matches && node.matches(config.buttonSelectors)) {
                                prepareButton(node);
                            }
                            const buttons = node.querySelectorAll?.(config.buttonSelectors);
                            if (buttons) buttons.forEach(prepareButton);
                        }
                    });
                }
            });
        });
        
        observer.observe(document.body, {
            childList: true,
            subtree: true
        });
        
        config.log('Observateur de boutons configuré');
    }
    
    // Ouvre une modale de manière stable, sans scintillement
    function stableModalOpen(modalId) {
        config.log(`Ouverture stable de la modale: ${modalId}`);
        const modalElement = document.getElementById(modalId);
        
        if (!modalElement) {
            console.error(`Modale non trouvée: ${modalId}`);
            return;
        }
        
        // 1. STABILISER LA MODALE POUR ÉVITER LE SCINTILLEMENT
        // Fixer d'abord les styles pour éviter le scintillement
        modalElement.style.position = 'fixed';
        modalElement.style.zIndex = '1060'; // Plus élevé que le z-index par défaut
        modalElement.style.transition = 'none'; // Désactiver les transitions pour éviter le clignotement
        modalElement.style.opacity = '0'; // Cacher pendant la préparation
        
        // 2. DÉSACTIVER TEMPORAIREMENT LES ÉVÉNEMENTS QUI POURRAIENT DÉCLENCHER DES FERMETURES INTEMPESTIVES
        document.body.style.pointerEvents = 'none';
        
        // 3. EMPÊCHER LES INTERACTIONS ACCIDENTELLES PENDANT LA PRÉPARATION
        modalElement.querySelectorAll('button, input, select').forEach(el => {
            el.disabled = true;
        });
        
        // 4. DÉSACTIVER TOUTES LES ANIMATIONS BOOTSTRAP TEMPORAIREMENT
        modalElement.classList.remove('fade');
        
        // 5. NETTOYER TOUT ÉTAT PRÉCÉDENT QUI POURRAIT INTERFÉRER
        document.querySelectorAll('.modal-backdrop').forEach(backdrop => backdrop.remove());
        document.body.classList.remove('modal-open');
        modalElement.classList.remove('show');
        
        // 6. AJOUTER UN BACKDROP STABLE MANUELLEMENT
        const backdrop = document.createElement('div');
        backdrop.className = 'modal-backdrop';
        backdrop.style.zIndex = '1050';
        backdrop.style.opacity = '0.5';
        backdrop.style.transition = 'none';
        document.body.appendChild(backdrop);
        
        // 7. MONTRER LA MODALE APRÈS UN COURT DÉLAI POUR PERMETTRE AU NAVIGATEUR DE STABILISER LE DOM
        setTimeout(() => {
            // Réactiver les interactions
            document.body.style.pointerEvents = 'auto';
            
            // Réactiver les contrôles
            modalElement.querySelectorAll('button, input, select').forEach(el => {
                el.disabled = false;
            });
            
            // Assurer la visibilité des éléments dans la modale
            fixModalElements(modalElement);
            
            // Afficher la modale
            modalElement.style.display = 'block';
            modalElement.classList.add('show');
            document.body.classList.add('modal-open');
            
            // Réactiver les transitions après l'affichage
            setTimeout(() => {
                modalElement.style.transition = '';
                modalElement.style.opacity = '1';
                
                // Réactiver les animations Bootstrap pour les fermetures futures
                modalElement.classList.add('fade');
                
                config.log(`Modale ${modalId} affichée avec succès et stabilisée`);
            }, 50);
        }, 50);
        
        // 8. AJOUTER UN GESTIONNAIRE POUR LA FERMETURE STABLE
        setupModalCloseHandlers(modalElement, backdrop);
    }
    
    // Configure les gestionnaires pour fermer la modale de façon stable
    function setupModalCloseHandlers(modalElement, backdrop) {
        if (!modalElement) return;
        
        // Gestionnaire pour les boutons de fermeture
        modalElement.querySelectorAll('.btn-close, [data-bs-dismiss="modal"], [data-portal-dismiss="modal"]').forEach(button => {
            // Remplacer pour éviter les conflits
            const newButton = button.cloneNode(true);
            button.parentNode.replaceChild(newButton, button);
            
            newButton.addEventListener('click', function(e) {
                e.preventDefault();
                e.stopPropagation();
                stableModalClose(modalElement, backdrop);
            });
        });
        
        // Gestionnaire pour le clic sur le backdrop (facultatif)
        if (backdrop) {
            backdrop.addEventListener('click', function() {
                stableModalClose(modalElement, backdrop);
            });
        }
    }
    
    // Ferme une modale de manière stable
    function stableModalClose(modalElement, backdrop) {
        if (!modalElement) return;
        
        // Transition de sortie douce
        modalElement.style.opacity = '0';
        if (backdrop) backdrop.style.opacity = '0';
        
        // Après la transition, nettoyer complètement
        setTimeout(() => {
            modalElement.style.display = 'none';
            modalElement.classList.remove('show');
            document.body.classList.remove('modal-open');
            document.body.style.overflow = '';
            document.body.style.paddingRight = '';
            
            if (backdrop && backdrop.parentNode) {
                backdrop.parentNode.removeChild(backdrop);
            }
            
            config.log(`Modale fermée avec succès: ${modalElement.id}`);
        }, 150);
    }
    
    // Assure la visibilité des éléments dans la modale
    function fixModalElements(modalElement) {
        if (!modalElement) return;
        
        // Formulaires, selects et inputs
        modalElement.querySelectorAll('select, input, textarea, .form-select, .form-control').forEach(el => {
            el.style.cssText = `
                display: ${el.tagName === 'SELECT' ? 'block' : 'block'} !important;
                visibility: visible !important;
                opacity: 1 !important;
                pointer-events: auto !important;
                position: relative !important;
                z-index: 100 !important;
            `;
            
            // Styles spécifiques pour les selects
            if (el.tagName === 'SELECT') {
                el.style.appearance = 'menulist';
                el.style.webkitAppearance = 'menulist';
                el.style.mozAppearance = 'menulist';
                el.style.width = '100%';
            }
        });
        
        // Boutons
        modalElement.querySelectorAll('button, .btn').forEach(el => {
            if (!el.classList.contains('btn-close')) {
                el.style.cssText = `
                    display: inline-block !important;
                    visibility: visible !important;
                    opacity: 1 !important;
                    pointer-events: auto !important;
                    position: relative !important;
                    z-index: 100 !important;
                `;
            }
        });
        
        // Boutons de fermeture
        modalElement.querySelectorAll('.btn-close').forEach(el => {
            el.style.cssText = `
                display: block !important;
                visibility: visible !important;
                opacity: 1 !important;
                pointer-events: auto !important;
                position: relative !important;
                z-index: 200 !important;
            `;
        });
    }
    
    // Initialisation
    function init() {
        config.log('Initialisation du correctif anti-scintillement...');
        captureExistingButtons();
        setupButtonObserver();
        config.log('Initialisation terminée.');
    }
    
    // Lancer l'initialisation après le chargement du DOM
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
    
    // Exposer l'API utilitaire
    window.stableModal = {
        open: stableModalOpen,
        close: stableModalClose,
        fix: fixModalElements,
        setDebug: function(debug) { config.debug = debug; },
        reInit: init
    };
})();
