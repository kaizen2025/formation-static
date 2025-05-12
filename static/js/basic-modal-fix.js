/**
 * basic-modal-fix.js - Solution ultra-simplifiée pour les modaux Bootstrap
 * Script minimaliste qui réinitialise les modaux et utilise l'approche Bootstrap native
 */
(function() {
    "use strict";
    
    // Configuration
    const config = {
        debug: true,
        log: function(message) {
            if (this.debug) console.log("Modal Fix:", message);
        }
    };
    
    config.log("Initializing basic modal fix...");
    
    // Fonctions utilitaires pour les modaux
    const ModalUtils = {
        /**
         * Désactive tous les autres systèmes modaux qui pourraient créer des conflits
         */
        disableConflictingSystems: function() {
            // Désactiver le système portal-modal s'il existe
            if (window.portalModal) {
                config.log("Disabling portal-modal system temporarily");
                // Sauvegarder les fonctions originales pour les restaurer après
                window._originalPortalModal = {
                    showModal: window.portalModal.showModal,
                    hideModal: window.portalModal.hideModal
                };
                
                // Désactiver les fonctions pour éviter les conflits
                window.portalModal.showModal = function() { 
                    config.log("Portal modal showModal intercepted and prevented");
                    return;
                };
                window.portalModal.hideModal = function() {
                    config.log("Portal modal hideModal intercepted and prevented");
                    return;
                };
            }
            
            // Désactiver d'autres gestionnaires d'événements qui peuvent causer des conflits
            document.querySelectorAll('[data-portal-target]').forEach(el => {
                el.removeAttribute('data-portal-target');
                if (!el.hasAttribute('data-bs-target') && !el.hasAttribute('data-bs-toggle')) {
                    el.setAttribute('data-bs-toggle', 'modal');
                    const targetId = el.getAttribute('data-target') || 
                                     el.getAttribute('href') || 
                                     el.getAttribute('data-modal-target');
                    if (targetId) {
                        el.setAttribute('data-bs-target', targetId);
                    }
                }
            });
        },
        
        /**
         * Réinitialise tous les modaux Bootstrap pour utiliser l'approche native
         */
        resetBootstrapModals: function() {
            document.querySelectorAll('.modal').forEach(modal => {
                // Supprimer toutes les classes et attributs qui pourraient interférer
                modal.classList.remove('show');
                modal.removeAttribute('aria-modal');
                modal.removeAttribute('role');
                modal.style.display = '';
                modal.style.paddingRight = '';
                
                // S'assurer que les sélecteurs et inputs sont visibles
                modal.querySelectorAll('select, input:not([type="hidden"]), textarea, button:not(.btn-close)').forEach(el => {
                    el.style.cssText = `
                        display: ${el.tagName === 'SELECT' ? 'block' : 
                                  el.tagName === 'BUTTON' ? 'inline-block' : 'block'} !important;
                        visibility: visible !important;
                        opacity: 1 !important;
                        position: relative !important;
                        z-index: 10 !important;
                    `;
                    
                    if (el.tagName === 'SELECT') {
                        el.style.cssText += `
                            -webkit-appearance: menulist !important;
                            appearance: menulist !important;
                        `;
                    }
                });
                
                // Réinitialiser l'instance Bootstrap si elle existe
                try {
                    const bsInstance = bootstrap.Modal.getInstance(modal);
                    if (bsInstance) {
                        bsInstance.dispose();
                    }
                } catch (e) {
                    config.log("Error disposing Bootstrap modal instance: " + e.message);
                }
            });
            
            // Supprimer tous les backdrops existants
            document.querySelectorAll('.modal-backdrop').forEach(backdrop => {
                backdrop.remove();
            });
            
            // Réinitialiser l'état du body
            document.body.classList.remove('modal-open');
            document.body.style.overflow = '';
            document.body.style.paddingRight = '';
        },
        
        /**
         * Réinitialise et initialise un modal spécifique
         */
        setupModal: function(modalElement) {
            if (!modalElement) return null;
            
            const modalId = modalElement.id;
            config.log(`Setting up modal: ${modalId}`);
            
            // Réinitialiser d'abord le modal
            modalElement.classList.remove('show');
            modalElement.style.display = '';
            
            try {
                // Initialiser une nouvelle instance Bootstrap
                return new bootstrap.Modal(modalElement, {
                    backdrop: true,
                    keyboard: true,
                    focus: true
                });
            } catch (e) {
                config.log(`Error initializing Bootstrap modal #${modalId}: ${e.message}`);
                return null;
            }
        },
        
        /**
         * Corrige les problèmes d'onglets dans un modal
         */
        fixModalTabs: function(modalElement) {
            if (!modalElement) return;
            
            const tabLinks = modalElement.querySelectorAll('[data-bs-toggle="tab"]');
            tabLinks.forEach(link => {
                link.addEventListener('click', function(e) {
                    e.preventDefault();
                    
                    const targetSelector = this.getAttribute('data-bs-target') || this.getAttribute('href');
                    if (!targetSelector) return;
                    
                    // Cacher tous les panneaux d'onglets
                    modalElement.querySelectorAll('.tab-pane').forEach(pane => {
                        pane.classList.remove('show', 'active');
                    });
                    
                    // Désactiver tous les onglets
                    modalElement.querySelectorAll('[data-bs-toggle="tab"]').forEach(tab => {
                        tab.classList.remove('active');
                        tab.setAttribute('aria-selected', 'false');
                    });
                    
                    // Activer l'onglet cliqué
                    this.classList.add('active');
                    this.setAttribute('aria-selected', 'true');
                    
                    // Afficher le panneau d'onglet cible
                    const targetPane = document.querySelector(targetSelector);
                    if (targetPane) {
                        targetPane.classList.add('show', 'active');
                    }
                });
            });
        }
    };
    
    // Initialisation principale
    function init() {
        config.log("Starting initialization...");
        
        // Désactiver les systèmes qui peuvent interférer
        ModalUtils.disableConflictingSystems();
        
        // Réinitialiser tous les modaux
        ModalUtils.resetBootstrapModals();
        
        // Écouter l'affichage des modaux
        document.addEventListener('show.bs.modal', function(event) {
            const modalElement = event.target;
            config.log(`Modal #${modalElement.id} is being shown`);
            
            // Corriger les onglets lors de l'affichage
            ModalUtils.fixModalTabs(modalElement);
        });
        
        // Initialiser l'ouverture des modaux sans passer par des attributs data-*
        document.querySelectorAll('button[onclick*="show"], a[onclick*="show"]').forEach(element => {
            const onclickAttr = element.getAttribute('onclick') || '';
            
            // Si l'élément a un onclick qui montre un modal mais pas d'attributs Bootstrap
            if (onclickAttr.includes('show') && 
                !element.hasAttribute('data-bs-toggle') && 
                !element.hasAttribute('data-bs-target')) {
                
                // Essayer de récupérer l'ID du modal depuis l'attribut onclick
                const matches = onclickAttr.match(/show(?:Modal|Inscription|Participants)Modal\(['"]?([^'"()]+)['"]?\)/);
                if (matches && matches[1]) {
                    const modalId = matches[1];
                    
                    // Supprimer l'ancien handler onclick
                    element.removeAttribute('onclick');
                    
                    // Ajouter les attributs Bootstrap
                    element.setAttribute('data-bs-toggle', 'modal');
                    element.setAttribute('data-bs-target', `#${modalId}`);
                    
                    config.log(`Modified button to use data-bs-toggle for modal #${modalId}`);
                }
            }
        });
        
        // Réinitialiser les modaux individuels
        document.querySelectorAll('.modal').forEach(modal => {
            ModalUtils.setupModal(modal);
        });
        
        // Corriger la transition entre modaux (par exemple du modal participants au modal inscription)
        document.querySelectorAll('button[id^="inscriptionBtn_"]').forEach(button => {
            const sessionId = button.id.split('_')[1];
            if (!sessionId) return;
            
            button.removeAttribute('onclick');
            button.addEventListener('click', function() {
                const participantsModalId = `participantsModal_${sessionId}`;
                const inscriptionModalId = `inscriptionModal_${sessionId}`;
                
                const participantsModal = bootstrap.Modal.getInstance(document.getElementById(participantsModalId));
                const inscriptionModal = bootstrap.Modal.getInstance(document.getElementById(inscriptionModalId));
                
                if (participantsModal) {
                    participantsModal.hide();
                    
                    // Attendre la fin de la transition avant d'ouvrir le nouveau modal
                    document.getElementById(participantsModalId).addEventListener('hidden.bs.modal', function() {
                        if (inscriptionModal) {
                            setTimeout(() => {
                                inscriptionModal.show();
                            }, 300);
                        }
                    }, { once: true });
                }
            });
        });
        
        config.log("Basic modal fix initialized successfully");
    }
    
    // Exécuter l'initialisation au chargement du DOM
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
