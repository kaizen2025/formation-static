/**
 * modal-manager.js - Gestionnaire unifié des modaux pour l'application
 * v1.2.0 - Amélioration continue de la robustesse, gestion des contenus dynamiques, focus, et transitions.
 */

const ModalManager = {
    config: {
        debugMode: (window.dashboardConfig && window.dashboardConfig.debugMode) || false,
        autoInitialize: true,
        fixZIndex: true,
        forceVisibility: true,
        enhanceSelects: true,
        fixBootstrapIssues: true,
        fixScintillation: true
    },
    state: {
        initialized: false,
        activeModals: new Map(), // Utiliser une Map pour un accès plus facile par ID
        modalOpenCount: 0,
        lastOpenedModal: null
    },

    init: function(options = {}) {
        this.config = { ...this.config, ...options };
        if (this.state.initialized && !options.forceReinit) {
            this.debug('ModalManager already initialized');
            return;
        }
        this.debug('Initializing ModalManager (v1.2.0)');
        // Les styles globaux sont dans modal-fixes.css, inclus via layout.html
        if (this.config.autoInitialize) {
            this.initializeAllModals();
        }
        this.setupGlobalEventListeners();
        this.state.initialized = true;
        this.debug('ModalManager initialized successfully');
    },

    initializeAllModals: function() {
        const bootstrapModals = document.querySelectorAll('.modal');
        bootstrapModals.forEach(modal => this.enhanceModal(modal));
        this.debug(`Enhanced/Checked ${bootstrapModals.length} modals`);

        const modalTriggers = document.querySelectorAll('[data-bs-toggle="modal"]');
        modalTriggers.forEach(trigger => this.enhanceModalTrigger(trigger));
        this.debug(`Enhanced/Checked ${modalTriggers.length} modal triggers`);
    },

    enhanceModal: function(modal) {
        if (!modal || modal.dataset.modalManagerEnhanced === 'true') return;
        const modalId = modal.id || `modal-${Math.random().toString(36).substr(2, 9)}`;
        if (!modal.id) modal.id = modalId;

        if (this.config.fixBootstrapIssues && !modal.classList.contains('modal-fix')) {
            modal.classList.add('modal-fix'); // S'assurer que la classe CSS de base est là
        }
        
        // L'application des correctifs de contenu se fera sur 'shown.bs.modal'
        this.attachModalEventListeners(modal);
        
        let instance = bootstrap.Modal.getInstance(modal);
        if (!instance) {
            try {
                instance = new bootstrap.Modal(modal);
            } catch (e) {
                this.debug(`Error creating Bootstrap modal instance for ${modalId}:`, e);
                return;
            }
        }

        if (!this.state.activeModals.has(modalId)) {
            this.state.activeModals.set(modalId, { element: modal, isOpen: false, instance: instance });
        }
        modal.dataset.modalManagerEnhanced = 'true';
        this.debug(`Modal ${modalId} enhanced and listener attached.`);
    },
    
    applyFixesToModalContent: function(modalOrContainer) {
        // Cette fonction est appelée par 'shown.bs.modal'
        if (!modalOrContainer) return;
        this.debug(`Applying content fixes to: ${modalOrContainer.id || 'container_in_modal'}`);

        if (this.config.enhanceSelects) this.fixSelectElements(modalOrContainer);
        if (this.config.forceVisibility) this.fixElementsVisibility(modalOrContainer);
        // fixZIndexIssues est géré par CSS principalement.

        if (typeof window.enhanceThemeBadgesGlobally === 'function') {
            window.enhanceThemeBadgesGlobally(modalOrContainer);
        }
        if (typeof bootstrap !== 'undefined' && typeof bootstrap.Tooltip === 'function') {
            const tooltipTriggerList = Array.from(modalOrContainer.querySelectorAll('[data-bs-toggle="tooltip"]'));
            tooltipTriggerList.forEach(tooltipTriggerEl => {
                let tooltipInstance = bootstrap.Tooltip.getInstance(tooltipTriggerEl);
                if (tooltipInstance) tooltipInstance.dispose();
                new bootstrap.Tooltip(tooltipTriggerEl);
            });
        }
    },

    enhanceModalTrigger: function(trigger) { /* Bootstrap gère bien les triggers standards */ },

    attachModalEventListeners: function(modal) {
        modal.addEventListener('show.bs.modal', (e) => {
            // Juste avant l'affichage, s'assurer que le z-index est correct si plusieurs modales
            if (this.state.modalOpenCount > 0 && this.state.lastOpenedModal) {
                const lastZIndex = parseInt(getComputedStyle(this.state.lastOpenedModal).zIndex) || 1055;
                modal.style.zIndex = (lastZIndex + 10).toString(); // Mettre le nouveau modal au-dessus
                const backdrop = document.querySelector('.modal-backdrop:last-of-type'); // Cibler le dernier backdrop
                if (backdrop) {
                    backdrop.style.zIndex = (lastZIndex + 9).toString();
                }
            }
        });

        modal.addEventListener('shown.bs.modal', (e) => {
            const modalId = modal.id;
            this.debug(`Modal ${modalId} shown`);
            const modalState = this.state.activeModals.get(modalId);
            if (modalState) modalState.isOpen = true;
            this.state.modalOpenCount++;
            this.state.lastOpenedModal = modal;
            
            this.applyPostShowFixes(modal); // Appliquer les correctifs APRÈS affichage
            this.triggerEvent('modalManager.shown', { modalId });
        });

        modal.addEventListener('hidden.bs.modal', (e) => {
            const modalId = modal.id;
            this.debug(`Modal ${modalId} hidden`);
            const modalState = this.state.activeModals.get(modalId);
            if (modalState) modalState.isOpen = false;
            this.state.modalOpenCount--;

            if (this.state.lastOpenedModal === modal) {
                // Trouver le prochain modal ouvert le plus récent s'il y en a
                this.state.lastOpenedModal = null;
                for (const [id, state] of this.state.activeModals) {
                    if (state.isOpen) { // Trouver un modal encore ouvert
                        this.state.lastOpenedModal = state.element;
                        break; // Pas besoin de trier, juste trouver un modal ouvert
                    }
                }
            }
            
            this.triggerEvent('modalManager.hidden', { modalId });

            // Logique de nettoyage du body si c'est le dernier modal fermé
            if (this.state.modalOpenCount === 0) {
                if (document.body.classList.contains('modal-open')) {
                    document.body.classList.remove('modal-open');
                    document.body.style.overflow = '';
                    document.body.style.paddingRight = '';
                }
                // Supprimer TOUS les backdrops s'il n'y a plus de modales ouvertes
                document.querySelectorAll('.modal-backdrop').forEach(b => b.remove());
                this.debug("All modals closed, body and backdrops cleaned.");
            } else if (this.state.lastOpenedModal) {
                // S'il reste des modales ouvertes, s'assurer que le body a toujours modal-open
                // et qu'il y a un backdrop pour le modal au premier plan.
                if (!document.body.classList.contains('modal-open')) {
                    document.body.classList.add('modal-open');
                }
                if (document.querySelectorAll('.modal-backdrop').length === 0) {
                    const backdrop = document.createElement('div');
                    backdrop.className = 'modal-backdrop fade show';
                    // Ajuster le z-index du backdrop pour qu'il soit en dessous du modal actif mais au-dessus des autres
                    const activeModalZIndex = parseInt(getComputedStyle(this.state.lastOpenedModal).zIndex) || 1055;
                    backdrop.style.zIndex = (activeModalZIndex - 1).toString();
                    document.body.appendChild(backdrop);
                }
                 this.state.lastOpenedModal.focus(); // Redonner le focus au modal restant
            }
        });
        
        const forms = modal.querySelectorAll('form.needs-validation');
        forms.forEach(form => { /* ... (validation form) ... */ });
        const tabLinks = modal.querySelectorAll('[data-bs-toggle="tab"]');
        tabLinks.forEach(link => { /* ... (gestion des onglets) ... */ });
    },

    applyPostShowFixes: function(modal) {
        if (!modal) return;
        this.debug(`Applying post-show fixes to: ${modal.id}`);
        this.applyFixesToModalContent(modal);
        
        setTimeout(() => {
            const activeTab = modal.querySelector('.tab-pane.active');
            const containerToFocus = activeTab || modal;
            const firstField = containerToFocus.querySelector('select, input:not([type="hidden"]), textarea, button:not([type="hidden"]):not(.btn-close)');
            if (firstField) try { firstField.focus(); } catch (e) { this.debug('Error focusing first field', e); }
        }, 50); // Réduit le délai, car les styles sont déjà appliqués par CSS

        if (this.config.fixScintillation) {
            // Le CSS devrait gérer cela avec `transform: translateZ(0)` sur `.modal.fade.show`
        }
    },

    fixElementsVisibility: function(container) {
        // Cette fonction est moins cruciale si modal-fixes.css fait bien son travail.
        // Elle peut servir de fallback ou pour des éléments ajoutés dynamiquement DANS le modal.
        if (!container) return;
        // ... (peut être allégée si CSS est suffisant)
    },

    fixSelectElements: function(container) {
        // Idem, CSS devrait gérer la plupart des cas.
        // Utile si des selects sont ajoutés dynamiquement au modal après son affichage.
        if (!container) return;
        const selects = container.querySelectorAll('select, .form-select');
        selects.forEach(select => {
            // S'assurer que les styles importants de modal-fixes.css sont appliqués
            // ou réappliqués si nécessaire.
            select.style.setProperty('display', 'block', 'important');
            select.style.setProperty('-webkit-appearance', 'menulist', 'important');
            select.style.setProperty('appearance', 'menulist', 'important');
            // ... autres styles de modal-fixes.css pour les selects
        });
    },

    setupGlobalEventListeners: function() {
        window.addEventListener('DOMContentLoaded', () => {
            if (this.config.autoInitialize) this.initializeAllModals();
        });
        if ('MutationObserver' in window) {
            const observer = new MutationObserver((mutations) => {
                mutations.forEach(mutation => {
                    if (mutation.type === 'childList') {
                        mutation.addedNodes.forEach(node => {
                            if (node.nodeType === 1) {
                                if (node.classList && node.classList.contains('modal')) {
                                    this.debug('New modal detected by MutationObserver, enhancing it.');
                                    this.enhanceModal(node);
                                } else if (node.querySelector) {
                                    node.querySelectorAll('.modal').forEach(m => this.enhanceModal(m));
                                }
                            }
                        });
                    }
                });
            });
            observer.observe(document.body, { childList: true, subtree: true });
        }
    },
    
    showModal: function(modalId) { /* ... (inchangé) ... */ },
    hideModal: function(modalId) { /* ... (inchangé) ... */ },
    triggerEvent: function(name, detail = {}) { /* ... (inchangé) ... */ },
    debug: function(message, data) { if (this.config.debugMode) console.log(`[ModalManager] ${message}`, data || ''); }
};

document.addEventListener('DOMContentLoaded', function() {
    const debugMode = window.dashboardConfig && window.dashboardConfig.debugMode;
    ModalManager.init({ debugMode: debugMode || false });
    window.ModalManager = ModalManager;
});
