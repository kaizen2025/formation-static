/**
 * modal-manager.js - Gestionnaire unifié des modaux pour l'application
 * v1.3.0 - Simplifié pour mieux coexister avec Bootstrap, focus sur l'initialisation post-affichage.
 */

const ModalManager = {
    config: {
        debugMode: (window.dashboardConfig && window.dashboardConfig.debugMode) || false,
    },
    state: {
        initialized: false,
        modalOpenCount: 0,
    },

    init: function(options = {}) {
        this.config = { ...this.config, ...options };
        if (this.state.initialized && !options.forceReinit) {
            this.debug('ModalManager already initialized (v1.3.0)');
            return;
        }
        this.debug('Initializing ModalManager (v1.3.0)');
        this.setupGlobalEventListeners(); // Se concentrer sur les événements Bootstrap
        this.state.initialized = true;
        this.debug('ModalManager initialized successfully');
    },
    
    // Applique les améliorations nécessaires APRÈS que Bootstrap ait affiché le modal.
    enhanceModalContent: function(modalElement) {
        if (!modalElement) return;
        const modalId = modalElement.id || 'unidentifiedModal';
        this.debug(`Enhancing content for modal: ${modalId}`);

        // 1. Améliorer les badges de thème
        if (typeof window.enhanceThemeBadgesGlobally === 'function') {
            window.enhanceThemeBadgesGlobally(modalElement);
        }

        // 2. (Ré)Initialiser les tooltips Bootstrap
        if (typeof bootstrap !== 'undefined' && typeof bootstrap.Tooltip === 'function') {
            const tooltipTriggerList = Array.from(modalElement.querySelectorAll('[data-bs-toggle="tooltip"]'));
            tooltipTriggerList.forEach(tooltipTriggerEl => {
                let tooltipInstance = bootstrap.Tooltip.getInstance(tooltipTriggerEl);
                if (tooltipInstance) tooltipInstance.dispose(); // Détruire l'ancien pour éviter les doublons
                new bootstrap.Tooltip(tooltipTriggerEl);
            });
        }
        
        // 3. S'assurer que les onglets fonctionnent et que le contenu de l'onglet actif est correct
        const activeTabPane = modalElement.querySelector('.tab-pane.active');
        if (activeTabPane) {
            // Les styles CSS de modal-fixes.css devraient gérer la visibilité.
            // On peut forcer le focus ici si nécessaire.
        }
        
        // 4. Focus sur le premier élément interactif (après un court délai)
        setTimeout(() => {
            const focusableElements = 'select, input:not([type="hidden"]), textarea, button:not([type="hidden"]):not(.btn-close)';
            let firstFocusable;
            if (activeTabPane) {
                firstFocusable = activeTabPane.querySelector(focusableElements);
            }
            if (!firstFocusable) {
                firstFocusable = modalElement.querySelector(focusableElements);
            }
            if (firstFocusable) {
                try {
                    firstFocusable.focus();
                    this.debug(`Focused on first element in ${modalId}:`, firstFocusable);
                } catch (e) {
                    this.debug(`Error focusing first element in ${modalId}:`, e);
                }
            }
        }, 100); // Léger délai pour que le modal soit pleinement rendu
    },

    setupGlobalEventListeners: function() {
        // Écouter l'événement 'shown.bs.modal' pour tous les modaux
        document.addEventListener('shown.bs.modal', (event) => {
            const modalElement = event.target;
            if (modalElement && modalElement.classList.contains('modal')) {
                this.state.modalOpenCount++;
                this.enhanceModalContent(modalElement); // Appliquer les améliorations ici
                this.triggerEvent('modalManager.shown', { modalId: modalElement.id });
            }
        });

        document.addEventListener('hidden.bs.modal', (event) => {
            const modalElement = event.target;
            if (modalElement && modalElement.classList.contains('modal')) {
                this.state.modalOpenCount--;
                this.triggerEvent('modalManager.hidden', { modalId: modalElement.id });

                // Logique de Bootstrap pour nettoyer le body si c'est le dernier modal
                if (this.state.modalOpenCount === 0 && document.body.classList.contains('modal-open')) {
                    // Bootstrap devrait gérer cela, mais on peut forcer si des problèmes persistent
                    // document.body.classList.remove('modal-open');
                    // document.body.style.overflow = '';
                    // document.body.style.paddingRight = '';
                    // document.querySelectorAll('.modal-backdrop').forEach(b => b.remove());
                }
            }
        });
        
        // Observer les mutations pour les modaux ajoutés dynamiquement
        if ('MutationObserver' in window) {
            const observer = new MutationObserver((mutations) => {
                mutations.forEach(mutation => {
                    if (mutation.type === 'childList') {
                        mutation.addedNodes.forEach(node => {
                            if (node.nodeType === 1) {
                                const modalsInNode = [];
                                if (node.classList && node.classList.contains('modal')) {
                                    modalsInNode.push(node);
                                } else if (node.querySelectorAll) {
                                    modalsInNode.push(...Array.from(node.querySelectorAll('.modal')));
                                }
                                modalsInNode.forEach(modal => {
                                    if (!modal.dataset.modalManagerEnhancedByObserver) {
                                        this.debug('New modal detected by MutationObserver, ensuring Bootstrap instance:', modal.id);
                                        // Juste s'assurer que Bootstrap l'initialise, les listeners feront le reste.
                                        bootstrap.Modal.getOrCreateInstance(modal);
                                        modal.dataset.modalManagerEnhancedByObserver = 'true';
                                    }
                                });
                            }
                        });
                    }
                });
            });
            observer.observe(document.body, { childList: true, subtree: true });
        }
    },
    
    // Fonction pour ouvrir un modal par ID (utile pour les transitions)
    showModal: function(modalId) {
        const modalElement = document.getElementById(modalId);
        if (modalElement) {
            const bsModal = bootstrap.Modal.getOrCreateInstance(modalElement);
            bsModal.show();
            this.debug(`showModal called for: ${modalId}`);
            return true;
        }
        this.debug(`Modal ${modalId} not found for showModal.`);
        return false;
    },

    // Fonction pour fermer un modal par ID
    hideModal: function(modalId) {
        const modalElement = document.getElementById(modalId);
        if (modalElement) {
            const bsModal = bootstrap.Modal.getInstance(modalElement);
            if (bsModal) {
                bsModal.hide();
                this.debug(`hideModal called for: ${modalId}`);
                return true;
            }
        }
        this.debug(`Modal ${modalId} not found or no instance for hideModal.`);
        return false;
    },

    triggerEvent: function(name, detail = {}) { 
        document.dispatchEvent(new CustomEvent(name, { detail, bubbles: true, cancelable: true })); 
    },
    debug: function(message, data) { 
        if (this.config.debugMode) console.log(`[ModalManager] ${message}`, data || ''); 
    }
};

// Auto-initialisation
document.addEventListener('DOMContentLoaded', function() {
    ModalManager.init();
    window.ModalManager = ModalManager; // Exposer globalement
});
