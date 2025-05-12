/**
 * modal-manager.js - Gestionnaire unifié des modaux pour l'application
 * v1.1.0 - Amélioration de la robustesse, gestion des contenus dynamiques, focus.
 */

const ModalManager = {
    config: {
        debugMode: false,
        autoInitialize: true,
        fixZIndex: true,
        forceVisibility: true,
        enhanceSelects: true,
        fixBootstrapIssues: true,
        fixScintillation: true
    },
    state: {
        initialized: false,
        activeModals: [],
        modalOpenCount: 0,
        lastOpenedModal: null
    },

    init: function(options = {}) {
        this.config = { ...this.config, ...options };
        if (this.state.initialized && !options.forceReinit) {
            this.debug('ModalManager already initialized');
            return;
        }
        this.debug('Initializing ModalManager (v1.1.0)');
        this.createGlobalStyles();
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
        this.debug(`Enhanced ${bootstrapModals.length} modals`);

        const modalTriggers = document.querySelectorAll('[data-bs-toggle="modal"]');
        modalTriggers.forEach(trigger => this.enhanceModalTrigger(trigger));
        this.debug(`Enhanced ${modalTriggers.length} modal triggers`);
    },

    enhanceModal: function(modal) {
        if (!modal || modal.dataset.modalManagerEnhanced === 'true') return;
        const modalId = modal.id || `modal-${Math.random().toString(36).substr(2, 9)}`;
        if (!modal.id) modal.id = modalId;

        if (this.config.fixBootstrapIssues && !modal.classList.contains('modal-fix')) {
            modal.classList.add('modal-fix');
        }
        this.applyFixesToModalContent(modal);
        this.attachModalEventListeners(modal);
        
        let instance = bootstrap.Modal.getInstance(modal);
        if (!instance) {
            try {
                instance = new bootstrap.Modal(modal);
            } catch (e) {
                this.debug(`Error creating Bootstrap modal instance for ${modalId}:`, e);
                return; // Ne pas ajouter si l'instance ne peut être créée
            }
        }

        if (!this.state.activeModals.find(m => m.id === modalId)) {
            this.state.activeModals.push({ id: modalId, element: modal, isOpen: false, instance: instance });
        }
        modal.dataset.modalManagerEnhanced = 'true';
    },
    
    applyFixesToModalContent: function(modalOrContainer) {
        if (!modalOrContainer) return;
        if (this.config.enhanceSelects) this.fixSelectElements(modalOrContainer);
        if (this.config.forceVisibility) this.fixElementsVisibility(modalOrContainer);
        if (this.config.fixZIndex && modalOrContainer.classList.contains('modal')) this.fixZIndexIssues(modalOrContainer);
        
        // Améliorer les badges de thème
        if (typeof window.enhanceThemeBadgesGlobally === 'function') {
            window.enhanceThemeBadgesGlobally(modalOrContainer);
        }
        // Initialiser les tooltips
        if (typeof bootstrap !== 'undefined' && typeof bootstrap.Tooltip === 'function') {
            const tooltipTriggerList = Array.from(modalOrContainer.querySelectorAll('[data-bs-toggle="tooltip"]'));
            tooltipTriggerList.forEach(tooltipTriggerEl => {
                let tooltipInstance = bootstrap.Tooltip.getInstance(tooltipTriggerEl);
                if (tooltipInstance) tooltipInstance.dispose();
                new bootstrap.Tooltip(tooltipTriggerEl);
            });
        }
    },

    enhanceModalTrigger: function(trigger) { /* Pas de changement majeur ici, Bootstrap gère bien */ },

    attachModalEventListeners: function(modal) {
        modal.addEventListener('shown.bs.modal', (e) => {
            const modalId = modal.id;
            this.debug(`Modal ${modalId} shown`);
            const modalState = this.state.activeModals.find(m => m.id === modalId);
            if (modalState) modalState.isOpen = true;
            this.state.modalOpenCount++;
            this.state.lastOpenedModal = modal;
            this.applyPostShowFixes(modal);
            this.triggerEvent('modalManager.shown', { modalId });
        });
        modal.addEventListener('hidden.bs.modal', (e) => {
            const modalId = modal.id;
            this.debug(`Modal ${modalId} hidden`);
            const modalState = this.state.activeModals.find(m => m.id === modalId);
            if (modalState) modalState.isOpen = false;
            this.state.modalOpenCount--;
            if (this.state.lastOpenedModal === modal) this.state.lastOpenedModal = null;
            this.triggerEvent('modalManager.hidden', { modalId });
            // Ensure body scroll is restored if no modals are open
            if (this.state.modalOpenCount === 0 && document.body.classList.contains('modal-open')) {
                document.body.classList.remove('modal-open');
                document.body.style.overflow = '';
                document.body.style.paddingRight = '';
                document.querySelectorAll('.modal-backdrop').forEach(b => b.remove()); // Clean up any stray backdrops
            }
        });
        
        const forms = modal.querySelectorAll('form.needs-validation');
        forms.forEach(form => {
            form.addEventListener('submit', (event) => {
                if (!form.checkValidity()) {
                    event.preventDefault(); event.stopPropagation();
                    const firstInvalid = form.querySelector(':invalid');
                    if (firstInvalid) try { firstInvalid.focus(); } catch (e) { this.debug('Error focusing invalid element', e); }
                }
                form.classList.add('was-validated');
            });
        });
        
        const tabLinks = modal.querySelectorAll('[data-bs-toggle="tab"]');
        tabLinks.forEach(link => {
            link.addEventListener('shown.bs.tab', (e) => {
                const targetSelector = e.target.getAttribute('data-bs-target');
                if (!targetSelector) return;
                const targetPane = modal.querySelector(targetSelector);
                if (targetPane) {
                    this.applyFixesToModalContent(targetPane); // Appliquer les correctifs au contenu de l'onglet
                    setTimeout(() => { // Focus après que l'onglet soit pleinement visible
                        const firstField = targetPane.querySelector('select, input:not([type="hidden"]), textarea, button:not([type="hidden"]):not(.btn-close)');
                        if (firstField) try { firstField.focus(); } catch (err) { this.debug('Error focusing field in tab', err); }
                    }, 100);
                }
            });
        });
    },

    applyPostShowFixes: function(modal) {
        if (!modal) return;
        this.applyFixesToModalContent(modal); // Appliquer à tout le modal
        
        setTimeout(() => {
            const activeTab = modal.querySelector('.tab-pane.active');
            const containerToFocus = activeTab || modal;
            const firstField = containerToFocus.querySelector('select, input:not([type="hidden"]), textarea, button:not([type="hidden"]):not(.btn-close)');
            if (firstField) try { firstField.focus(); } catch (e) { this.debug('Error focusing first field', e); }
        }, 100);

        if (this.config.fixScintillation) {
            modal.style.transition = 'none'; modal.style.transform = 'translateZ(0)';
            modal.offsetHeight; // Force reflow
            setTimeout(() => { modal.style.transition = ''; }, 50);
        }
    },

    fixElementsVisibility: function(container) { // Renommé pour clarté
        if (!container) return;
        const elementsToFix = container.querySelectorAll(
            'input:not([type="hidden"]), select, textarea, button:not([type="hidden"]):not(.btn-close), .form-select, .form-control, ' +
            'label, .form-label, .invalid-feedback, small, p, h1, h2, h3, h4, h5, h6, .form-text, ' +
            'table, thead, tbody, tr, th, td, .table-responsive, ' +
            '.badge, .alert, .btn-group, ' + 
            '.nav-tabs, .nav-pills, .tab-content, .tab-pane, .nav-link, i.fas, i.far'
        );
        elementsToFix.forEach(el => {
            let displayStyle = 'block'; // Default
            if (['BUTTON', 'SPAN', 'I', 'A', 'SMALL'].includes(el.tagName) || el.classList.contains('btn') || el.classList.contains('badge') || el.classList.contains('nav-link')) {
                displayStyle = 'inline-block';
            } else if (el.tagName === 'TABLE' || el.classList.contains('table')) {
                displayStyle = 'table';
            } else if (el.tagName === 'THEAD' || el.tagName === 'TBODY') {
                displayStyle = 'table-row-group';
            } else if (el.tagName === 'TR') {
                displayStyle = 'table-row';
            } else if (el.tagName === 'TH' || el.tagName === 'TD') {
                displayStyle = 'table-cell';
            }
            
            el.style.setProperty('display', displayStyle, 'important');
            el.style.setProperty('visibility', 'visible', 'important');
            el.style.setProperty('opacity', '1', 'important');
            el.style.setProperty('pointer-events', 'auto', 'important');
            el.style.setProperty('position', 'relative', 'important'); // Pour le contexte de stacking
        });
    },

    fixSelectElements: function(container) {
        if (!container) return;
        const selects = container.querySelectorAll('select, .form-select');
        selects.forEach(select => {
            select.style.setProperty('display', 'block', 'important');
            select.style.setProperty('visibility', 'visible', 'important');
            select.style.setProperty('opacity', '1', 'important');
            select.style.setProperty('-webkit-appearance', 'menulist', 'important');
            select.style.setProperty('-moz-appearance', 'menulist', 'important');
            select.style.setProperty('appearance', 'menulist', 'important');
            select.style.setProperty('position', 'relative', 'important');
            select.style.setProperty('z-index', (parseInt(getComputedStyle(select.closest('.modal-content') || select).zIndex) || 1057) + 5, 'important');
            select.style.setProperty('color', '#212529', 'important');
            select.style.setProperty('background-color', '#fff', 'important');
            select.style.setProperty('width', '100%', 'important');
            select.style.setProperty('pointer-events', 'auto', 'important');
            select.offsetHeight; // Force reflow
        });
    },

    fixZIndexIssues: function(modal) { /* Contenu dans modal-fixes.css, JS peut être redondant ou pour cas dynamiques */ },
    createGlobalStyles: function() { /* Les styles sont maintenant dans modal-fixes.css */ },

    setupGlobalEventListeners: function() {
        window.addEventListener('DOMContentLoaded', () => {
            if (this.config.autoInitialize) this.initializeAllModals();
        });
        if ('MutationObserver' in window) {
            const observer = new MutationObserver((mutations) => {
                mutations.forEach(mutation => {
                    if (mutation.type === 'childList') {
                        mutation.addedNodes.forEach(node => {
                            if (node.nodeType === 1 && (node.classList.contains('modal') || node.querySelector('.modal'))) {
                                this.debug('New modal detected by MutationObserver, enhancing it.');
                                if (node.classList.contains('modal')) this.enhanceModal(node);
                                node.querySelectorAll('.modal').forEach(m => this.enhanceModal(m));
                            }
                        });
                    }
                });
            });
            observer.observe(document.body, { childList: true, subtree: true });
        }
    },
    
    showModal: function(modalId) {
        const modalState = this.state.activeModals.find(m => m.id === modalId);
        if (modalState && modalState.instance) {
            modalState.instance.show(); return true;
        }
        const modalElement = document.getElementById(modalId);
        if (modalElement) {
            this.enhanceModal(modalElement); // Assurer qu'il est amélioré
            const instance = bootstrap.Modal.getInstance(modalElement) || new bootstrap.Modal(modalElement);
            instance.show(); return true;
        }
        this.debug(`Modal ${modalId} not found for showModal.`); return false;
    },
    hideModal: function(modalId) {
        const modalState = this.state.activeModals.find(m => m.id === modalId);
        if (modalState && modalState.instance) {
            modalState.instance.hide(); return true;
        }
        const modalElement = document.getElementById(modalId);
        if (modalElement) {
            const instance = bootstrap.Modal.getInstance(modalElement);
            if (instance) { instance.hide(); return true; }
        }
        this.debug(`Modal ${modalId} not found for hideModal.`); return false;
    },
    updateModal: function(modalId, options = {}) { /* Peut être implémenté si besoin de changer contenu dynamiquement */ },
    triggerEvent: function(name, detail = {}) { document.dispatchEvent(new CustomEvent(name, { detail, bubbles: true, cancelable: true })); },
    debug: function(message, data) { if (this.config.debugMode) console.log(`[ModalManager] ${message}`, data || ''); }
};

// Auto-initialisation lors du chargement du script
document.addEventListener('DOMContentLoaded', function() {
    const debugMode = window.dashboardConfig && window.dashboardConfig.debugMode;
    ModalManager.init({ debugMode: debugMode || false });
    window.ModalManager = ModalManager; // Exposer globalement
});
