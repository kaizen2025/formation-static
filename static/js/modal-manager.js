/**
 * modal-manager.js - Gestionnaire unifié des modaux pour l'application
 * Ce fichier résout les problèmes de visibilité et d'interaction avec les modaux
 * sur toutes les pages de l'application.
 */

// Configuration globale
const ModalManager = {
    // Options de configuration
    config: {
        debugMode: false,                  // Afficher les logs de debug
        autoInitialize: true,              // Initialiser automatiquement les modaux au chargement
        fixZIndex: true,                   // Corriger les problèmes de z-index
        forceVisibility: true,             // Forcer la visibilité des éléments dans les modaux
        enhanceSelects: true,              // Améliorer les sélecteurs dans les modaux
        fixBootstrapIssues: true,          // Corriger les problèmes connus de Bootstrap
        portalCompatibilityMode: true,     // Compatibilité avec le système portal-modal
        fixScintillation: true             // Corriger le scintillement des modaux
    },

    // État interne
    state: {
        initialized: false,                // Si le gestionnaire a été initialisé
        activeModals: [],                  // Liste des modaux actifs
        modalOpenCount: 0,                 // Compteur de modaux ouverts
        portalModalContainer: null,        // Conteneur des modaux portal
        lastOpenedModal: null              // Dernier modal ouvert
    },

    /**
     * Initialise le gestionnaire de modaux
     * @param {Object} options - Options de configuration
     */
    init: function(options = {}) {
        // Fusionner les options fournies avec la configuration par défaut
        this.config = { ...this.config, ...options };
        
        if (this.state.initialized) {
            this.debug('ModalManager already initialized');
            return;
        }

        this.debug('Initializing ModalManager');
        
        // Créer les styles nécessaires s'ils n'existent pas déjà
        this.createGlobalStyles();
        
        // Initialiser tous les modaux existants
        this.initializeAllModals();
        
        // Ajouter les écouteurs d'événements globaux
        this.setupGlobalEventListeners();
        
        // Créer un conteneur pour les modaux portal si nécessaire
        if (this.config.portalCompatibilityMode) {
            this.setupPortalModalContainer();
        }
        
        this.state.initialized = true;
        this.debug('ModalManager initialized successfully');
    },

    /**
     * Initialise tous les modaux présents dans le DOM
     */
    initializeAllModals: function() {
        // Sélectionner tous les modaux Bootstrap standards
        const bootstrapModals = document.querySelectorAll('.modal:not(.portal-modal)');
        
        bootstrapModals.forEach(modal => {
            this.enhanceModal(modal);
        });
        
        this.debug(`Enhanced ${bootstrapModals.length} bootstrap modals`);
        
        // Gérer les boutons qui ouvrent les modaux
        const modalTriggers = document.querySelectorAll('[data-bs-toggle="modal"], [data-portal-target]');
        modalTriggers.forEach(trigger => {
            this.enhanceModalTrigger(trigger);
        });
        
        this.debug(`Enhanced ${modalTriggers.length} modal triggers`);
    },

    /**
     * Améliore un modal spécifique
     * @param {HTMLElement} modal - L'élément modal à améliorer
     */
    enhanceModal: function(modal) {
        if (!modal) return;
        
        const modalId = modal.id;
        if (!modalId) {
            this.debug('Modal without ID detected, skipping', modal);
            return;
        }
        
        // Ajouter la classe modal-fix qui corrige de nombreux problèmes
        if (this.config.fixBootstrapIssues && !modal.classList.contains('modal-fix')) {
            modal.classList.add('modal-fix');
        }
        
        // Corriger les problèmes spécifiques aux sélecteurs dans ce modal
        if (this.config.enhanceSelects) {
            this.fixSelectElements(modal);
        }
        
        // Corriger la visibilité des éléments de formulaire
        if (this.config.forceVisibility) {
            this.fixFormElementsVisibility(modal);
        }
        
        // Corriger les problèmes de z-index
        if (this.config.fixZIndex) {
            this.fixZIndexIssues(modal);
        }
        
        // Attacher des écouteurs d'événements spécifiques au modal
        this.attachModalEventListeners(modal);
        
        // Stocker une référence au modal dans notre état
        this.state.activeModals.push({
            id: modalId,
            element: modal,
            isOpen: false,
            instance: typeof bootstrap !== 'undefined' && bootstrap.Modal ? new bootstrap.Modal(modal) : null
        });
    },

    /**
     * Améliore un déclencheur de modal
     * @param {HTMLElement} trigger - L'élément déclencheur à améliorer
     */
    enhanceModalTrigger: function(trigger) {
        if (!trigger) return;
        
        // Identifier le type de déclencheur
        const isBootstrapTrigger = trigger.hasAttribute('data-bs-toggle') && trigger.getAttribute('data-bs-toggle') === 'modal';
        const isPortalTrigger = trigger.hasAttribute('data-portal-target');
        
        // Obtenir l'identifiant du modal cible
        let targetId = null;
        if (isBootstrapTrigger) {
            targetId = trigger.getAttribute('data-bs-target');
            if (targetId && targetId.startsWith('#')) {
                targetId = targetId.substring(1);
            }
        } else if (isPortalTrigger) {
            targetId = trigger.getAttribute('data-portal-target');
            if (targetId && targetId.startsWith('#')) {
                targetId = targetId.substring(1);
            }
        }
        
        if (!targetId) {
            this.debug('Modal trigger without target detected, skipping', trigger);
            return;
        }
        
        // Pour les déclencheurs portal, ajouter un gestionnaire personnalisé
        if (isPortalTrigger && this.config.portalCompatibilityMode) {
            // Remplacer l'attribut data-portal-target par data-bs-target pour utiliser Bootstrap
            trigger.setAttribute('data-bs-target', `#${targetId}`);
            trigger.setAttribute('data-bs-toggle', 'modal');
            trigger.removeAttribute('data-portal-target');
            
            // Assurer la compatibilité avec les gestionnaires portal existants
            trigger.addEventListener('click', (e) => {
                // Si le modal n'existe pas dans le DOM principal, le créer via le système portal
                const targetModal = document.getElementById(targetId);
                if (!targetModal) {
                    this.createPortalModal(targetId, trigger);
                    e.preventDefault(); // Prévenir le comportement par défaut
                    e.stopPropagation(); // Arrêter la propagation
                }
            });
        }
    },

    /**
     * Attache des écouteurs d'événements à un modal spécifique
     * @param {HTMLElement} modal - L'élément modal
     */
    attachModalEventListeners: function(modal) {
        if (!modal) return;
        
        // Écouteur pour l'événement d'affichage du modal
        modal.addEventListener('shown.bs.modal', (e) => {
            const modalId = modal.id;
            this.debug(`Modal ${modalId} shown`);
            
            // Mettre à jour l'état
            const modalState = this.state.activeModals.find(m => m.id === modalId);
            if (modalState) {
                modalState.isOpen = true;
            }
            
            this.state.modalOpenCount++;
            this.state.lastOpenedModal = modal;
            
            // Appliquer les correctifs après l'affichage
            this.applyPostShowFixes(modal);
            
            // Déclencher un événement personnalisé
            this.triggerEvent('modalManager.shown', { modalId });
        });
        
        // Écouteur pour l'événement de masquage du modal
        modal.addEventListener('hidden.bs.modal', (e) => {
            const modalId = modal.id;
            this.debug(`Modal ${modalId} hidden`);
            
            // Mettre à jour l'état
            const modalState = this.state.activeModals.find(m => m.id === modalId);
            if (modalState) {
                modalState.isOpen = false;
            }
            
            this.state.modalOpenCount--;
            if (this.state.lastOpenedModal === modal) {
                this.state.lastOpenedModal = null;
            }
            
            // Déclencher un événement personnalisé
            this.triggerEvent('modalManager.hidden', { modalId });
            
            // Nettoyage si c'est un modal portal
            if (modal.classList.contains('portal-modal') && this.config.portalCompatibilityMode) {
                setTimeout(() => {
                    if (document.body.classList.contains('modal-open') && this.state.modalOpenCount === 0) {
                        document.body.classList.remove('modal-open');
                        document.body.style.overflow = '';
                        document.body.style.paddingRight = '';
                        
                        // Supprimer les backdrops restants
                        document.querySelectorAll('.modal-backdrop').forEach(backdrop => {
                            backdrop.remove();
                        });
                    }
                }, 300);
            }
        });
        
        // Gestion de la validation des formulaires dans le modal
        const forms = modal.querySelectorAll('form.needs-validation');
        forms.forEach(form => {
            form.addEventListener('submit', (event) => {
                if (!form.checkValidity()) {
                    event.preventDefault();
                    event.stopPropagation();
                    
                    // Focus sur le premier champ invalide
                    const firstInvalid = form.querySelector(':invalid');
                    if (firstInvalid) {
                        try {
                            firstInvalid.focus();
                        } catch (e) {
                            this.debug('Error focusing invalid element', e);
                        }
                    }
                }
                form.classList.add('was-validated');
            });
        });
        
        // Gestion des onglets du modal
        const tabLinks = modal.querySelectorAll('[data-bs-toggle="tab"]');
        tabLinks.forEach(link => {
            link.addEventListener('shown.bs.tab', (e) => {
                const targetSelector = e.target.getAttribute('data-bs-target');
                if (!targetSelector) return;
                
                const targetPane = modal.querySelector(targetSelector);
                if (targetPane) {
                    // Appliquer à nouveau les correctifs à l'onglet actif
                    this.fixFormElementsVisibility(targetPane);
                    
                    // Focus sur le premier champ interactif
                    setTimeout(() => {
                        const firstField = targetPane.querySelector('select, input:not([type="hidden"]), textarea, button:not([type="hidden"])');
                        if (firstField) {
                            try {
                                firstField.focus();
                            } catch (e) {
                                this.debug('Error focusing field in tab', e);
                            }
                        }
                    }, 100);
                }
            });
        });
    },

    /**
     * Applique des correctifs après l'affichage d'un modal
     * @param {HTMLElement} modal - L'élément modal
     */
    applyPostShowFixes: function(modal) {
        if (!modal) return;
        
        // Réappliquer les correctifs pour s'assurer que tout est visible
        if (this.config.forceVisibility) {
            this.fixFormElementsVisibility(modal);
        }
        
        if (this.config.enhanceSelects) {
            this.fixSelectElements(modal);
        }
        
        // Focus sur le premier élément interactif
        setTimeout(() => {
            // Trouver l'onglet actif s'il y en a
            const activeTab = modal.querySelector('.tab-pane.active');
            const container = activeTab || modal;
            
            const firstField = container.querySelector('select, input:not([type="hidden"]), textarea, button:not([type="hidden"]):not(.btn-close)');
            if (firstField) {
                try {
                    firstField.focus();
                } catch (e) {
                    this.debug('Error focusing first field', e);
                }
            }
        }, 100);
        
        // Forcer un reflow pour éviter le scintillement
        if (this.config.fixScintillation) {
            modal.style.transition = 'none';
            modal.style.transform = 'translateZ(0)';
            modal.offsetHeight; // Forcer un reflow
            setTimeout(() => {
                modal.style.transition = '';
            }, 100);
        }
    },

    /**
     * Corrige la visibilité des éléments de formulaire dans un container
     * @param {HTMLElement} container - Le conteneur (modal ou onglet)
     */
    fixFormElementsVisibility: function(container) {
        if (!container) return;
        
        // Sélectionner tous les éléments de formulaire
        const formElements = container.querySelectorAll('input:not([type="hidden"]), select, textarea, button:not([type="hidden"]):not(.btn-close), .form-select, .form-control');
        
        formElements.forEach(el => {
            // Styles essentiels pour la visibilité et l'interaction
            el.style.cssText += `
                display: ${el.tagName === 'SELECT' || el.classList.contains('form-select') ? 'block' : 'inline-block'} !important;
                visibility: visible !important;
                opacity: 1 !important;
                pointer-events: auto !important;
                position: relative !important;
                z-index: 1060 !important;
            `;
        });
        
        // Assurer la visibilité des labels et autres éléments textuels
        const textElements = container.querySelectorAll('label, .form-label, .invalid-feedback, small, p, h6, .form-text');
        textElements.forEach(el => {
            el.style.cssText += `
                display: block !important;
                visibility: visible !important;
                opacity: 1 !important;
            `;
        });
        
        // S'assurer que les tableaux et leurs éléments sont visibles
        const tableElements = container.querySelectorAll('table, thead, tbody, tr, th, td');
        tableElements.forEach(el => {
            const display = el.tagName === 'TABLE' ? 'table' : 
                          el.tagName === 'TR' ? 'table-row' : 
                          (el.tagName === 'TD' || el.tagName === 'TH') ? 'table-cell' : 
                          el.tagName === 'THEAD' || el.tagName === 'TBODY' ? 'table-row-group' : 'block';
            
            el.style.cssText += `
                display: ${display} !important;
                visibility: visible !important;
                opacity: 1 !important;
            `;
        });
        
        // Badges et alertes
        const infoElements = container.querySelectorAll('.badge, .alert, .btn, .btn-group');
        infoElements.forEach(el => {
            el.style.cssText += `
                visibility: visible !important;
                opacity: 1 !important;
                pointer-events: auto !important;
            `;
        });
    },

    /**
     * Corrige spécifiquement les éléments select
     * @param {HTMLElement} container - Le conteneur (modal ou onglet)
     */
    fixSelectElements: function(container) {
        if (!container) return;
        
        // Sélectionner tous les sélecteurs
        const selects = container.querySelectorAll('select, .form-select');
        
        selects.forEach(select => {
            // Styles spécifiques aux selects pour assurer qu'ils s'affichent correctement
            select.style.cssText += `
                display: block !important;
                visibility: visible !important;
                opacity: 1 !important;
                -webkit-appearance: menulist !important;
                -moz-appearance: menulist !important;
                appearance: menulist !important;
                position: relative !important;
                z-index: 2000 !important;
                color: #212529 !important;
                background-color: #fff !important;
                width: 100% !important;
                pointer-events: auto !important;
            `;
            
            // Forcer un reflow pour recalculer les dimensions
            select.offsetHeight;
        });
    },

    /**
     * Corrige les problèmes de z-index
     * @param {HTMLElement} modal - L'élément modal
     */
    fixZIndexIssues: function(modal) {
        if (!modal) return;
        
        // Assurer que le modal lui-même a un z-index suffisant
        modal.style.zIndex = '1055 !important';
        
        // Dialog et Content
        const dialog = modal.querySelector('.modal-dialog');
        if (dialog) {
            dialog.style.zIndex = '1056 !important';
        }
        
        const content = modal.querySelector('.modal-content');
        if (content) {
            content.style.zIndex = '1057 !important';
        }
        
        // Assurer que le bouton de fermeture est au-dessus de tout
        const closeBtn = modal.querySelector('.btn-close');
        if (closeBtn) {
            closeBtn.style.cssText += `
                z-index: 2050 !important;
                position: relative !important;
                pointer-events: auto !important;
            `;
        }
        
        // Ajuster les z-index des boutons pour qu'ils soient cliquables
        const buttons = modal.querySelectorAll('.btn:not(.btn-close)');
        buttons.forEach(btn => {
            btn.style.cssText += `
                z-index: 1060 !important;
                position: relative !important;
                pointer-events: auto !important;
            `;
        });
    },

    /**
     * Crée des styles globaux pour les modaux
     */
    createGlobalStyles: function() {
        // Vérifier si les styles existent déjà
        if (document.getElementById('modal-manager-styles')) {
            return;
        }
        
        // Créer l'élément style
        const styleElement = document.createElement('style');
        styleElement.id = 'modal-manager-styles';
        
        // Définir les styles
        styleElement.textContent = `
            /* Styles globaux pour les modaux */
            .modal-fix {
                z-index: 1055 !important;
            }
            .modal-fix .modal-dialog {
                z-index: 1056 !important;
            }
            .modal-fix .modal-content {
                z-index: 1057 !important;
            }
            .modal-fix select, 
            .modal-fix .form-select, 
            .modal-fix input:not([type="hidden"]), 
            .modal-fix textarea,
            .modal-fix button:not([type="hidden"]) {
                display: block !important;
                visibility: visible !important;
                opacity: 1 !important;
                position: relative !important;
                z-index: 1060 !important;
                pointer-events: auto !important;
            }
            .modal-fix .form-select,
            .modal-fix select {
                -webkit-appearance: menulist !important;
                appearance: menulist !important;
                width: 100% !important;
                color: #212529 !important;
                background-color: #fff !important;
            }
            .modal-fix .modal-footer .btn,
            .modal-fix .modal-body .btn {
                display: inline-block !important;
                z-index: 1070 !important;
            }
            .modal-fix .tab-content,
            .modal-fix .tab-pane {
                display: block !important;
                visibility: visible !important;
                opacity: 1 !important;
            }
            .modal-fix .tab-pane:not(.active) {
                display: none !important;
            }
            
            /* Styles de compatibilité pour le système portal */
            .portal-modal {
                z-index: 1055 !important;
                position: fixed !important;
                top: 0 !important;
                left: 0 !important;
                width: 100% !important;
                height: 100% !important;
                overflow-x: hidden !important;
                overflow-y: auto !important;
                outline: 0 !important;
            }
            
            /* Améliorations pour éviter le scintillement */
            .modal.fade {
                transform: translateZ(0);
                backface-visibility: hidden;
            }
            
            /* Correctifs pour les selects dans Safari/Chrome */
            @media screen and (-webkit-min-device-pixel-ratio:0) { 
                .modal-fix select,
                .modal-fix .form-select {
                    -webkit-appearance: menulist !important;
                    background-image: none !important;
                }
            }
            
            /* Correctifs pour les modaux mobiles */
            @media (max-width: 576px) {
                .modal-fix .modal-dialog {
                    margin: 0.5rem auto !important;
                }
            }
        `;
        
        // Ajouter les styles au head
        document.head.appendChild(styleElement);
        this.debug('Global modal styles created');
    },

    /**
     * Configure les écouteurs d'événements globaux
     */
    setupGlobalEventListeners: function() {
        // Écouter DOMContentLoaded pour initialiser les nouveaux modaux
        window.addEventListener('DOMContentLoaded', () => {
            if (this.config.autoInitialize) {
                this.initializeAllModals();
            }
        });
        
        // Observer les mutations du DOM pour détecter les nouveaux modaux
        if ('MutationObserver' in window) {
            const observer = new MutationObserver((mutations) => {
                let shouldReinit = false;
                
                mutations.forEach(mutation => {
                    if (mutation.type === 'childList') {
                        mutation.addedNodes.forEach(node => {
                            if (node.nodeType === 1 && (
                                node.classList && node.classList.contains('modal') || 
                                node.querySelector && node.querySelector('.modal')
                            )) {
                                shouldReinit = true;
                            }
                        });
                    }
                });
                
                if (shouldReinit) {
                    this.debug('New modals detected, reinitializing');
                    this.initializeAllModals();
                }
            });
            
            observer.observe(document.body, {
                childList: true,
                subtree: true
            });
        }
    },

    /**
     * Configure le conteneur pour les modaux portal
     */
    setupPortalModalContainer: function() {
        // Vérifier si le conteneur existe déjà
        let container = document.getElementById('portal-modal-container');
        if (!container) {
            // Créer le conteneur
            container = document.createElement('div');
            container.id = 'portal-modal-container';
            container.style.cssText = 'position: relative; z-index: 1100;';
            document.body.appendChild(container);
        }
        
        this.state.portalModalContainer = container;
        this.debug('Portal modal container set up');
        
        // Initialiser les modaux déjà présents dans le conteneur
        const existingPortalModals = container.querySelectorAll('.portal-modal');
        existingPortalModals.forEach(modal => {
            this.enhanceModal(modal);
        });
    },

    /**
     * Crée un modal portal
     * @param {string} targetId - ID du modal à créer
     * @param {HTMLElement} trigger - Élément déclencheur
     */
    createPortalModal: function(targetId, trigger) {
        if (!this.state.portalModalContainer) {
            this.setupPortalModalContainer();
        }
        
        const originalModal = document.getElementById(targetId);
        if (originalModal) {
            // Le modal existe déjà, on ne le recrée pas
            const bsModal = bootstrap.Modal.getInstance(originalModal) || new bootstrap.Modal(originalModal);
            bsModal.show();
            return;
        }
        
        // Chercher le contenu du modal dans le DOM
        const sourceContent = document.querySelector(`script[data-portal-source="${targetId}"]`);
        if (!sourceContent) {
            this.debug(`No portal source found for modal ${targetId}`);
            return;
        }
        
        // Créer le nouveau modal
        const portalModal = document.createElement('div');
        portalModal.id = targetId;
        portalModal.className = 'modal fade modal-fix portal-modal';
        portalModal.setAttribute('tabindex', '-1');
        portalModal.setAttribute('aria-hidden', 'true');
        portalModal.innerHTML = sourceContent.textContent;
        
        // Ajouter au conteneur
        this.state.portalModalContainer.appendChild(portalModal);
        
        // Améliorer le modal
        this.enhanceModal(portalModal);
        
        // Afficher le modal
        const bsModal = bootstrap.Modal.getInstance(portalModal) || new bootstrap.Modal(portalModal);
        bsModal.show();
        
        // Événement de suppression lors de la fermeture
        portalModal.addEventListener('hidden.bs.modal', () => {
            setTimeout(() => {
                portalModal.remove();
            }, 300);
        });
        
        this.debug(`Portal modal ${targetId} created and shown`);
    },

    /**
     * Affiche un modal par son ID
     * @param {string} modalId - ID du modal à afficher
     */
    showModal: function(modalId) {
        const modalState = this.state.activeModals.find(m => m.id === modalId);
        
        if (modalState && modalState.instance) {
            modalState.instance.show();
            return true;
        }
        
        // Chercher le modal dans le DOM s'il n'est pas dans notre état
        const modalElement = document.getElementById(modalId);
        if (modalElement) {
            this.enhanceModal(modalElement);
            const bsModal = bootstrap.Modal.getInstance(modalElement) || new bootstrap.Modal(modalElement);
            bsModal.show();
            return true;
        }
        
        // Essayer de créer un modal portal
        if (this.config.portalCompatibilityMode) {
            const sourceContent = document.querySelector(`script[data-portal-source="${modalId}"]`);
            if (sourceContent) {
                this.createPortalModal(modalId, null);
                return true;
            }
        }
        
        this.debug(`Modal ${modalId} not found`);
        return false;
    },

    /**
     * Cache un modal par son ID
     * @param {string} modalId - ID du modal à cacher
     */
    hideModal: function(modalId) {
        const modalState = this.state.activeModals.find(m => m.id === modalId);
        
        if (modalState && modalState.instance) {
            modalState.instance.hide();
            return true;
        }
        
        // Chercher le modal dans le DOM s'il n'est pas dans notre état
        const modalElement = document.getElementById(modalId);
        if (modalElement) {
            const bsModal = bootstrap.Modal.getInstance(modalElement);
            if (bsModal) {
                bsModal.hide();
                return true;
            }
        }
        
        this.debug(`Modal ${modalId} not found or already hidden`);
        return false;
    },

    /**
     * Met à jour les contenus d'un modal
     * @param {string} modalId - ID du modal à mettre à jour
     * @param {Object} options - Options de mise à jour
     */
    updateModal: function(modalId, options = {}) {
        const modal = document.getElementById(modalId);
        if (!modal) {
            this.debug(`Modal ${modalId} not found for update`);
            return false;
        }
        
        // Mise à jour du titre
        if (options.title) {
            const titleElement = modal.querySelector('.modal-title');
            if (titleElement) {
                titleElement.innerHTML = options.title;
            }
        }
        
        // Mise à jour du corps
        if (options.body) {
            const bodyElement = modal.querySelector('.modal-body');
            if (bodyElement) {
                bodyElement.innerHTML = options.body;
            }
        }
        
        // Mise à jour des boutons du footer
        if (options.footer) {
            const footerElement = modal.querySelector('.modal-footer');
            if (footerElement) {
                footerElement.innerHTML = options.footer;
            }
        }
        
        // Réappliquer les correctifs
        this.enhanceModal(modal);
        
        this.debug(`Modal ${modalId} updated`);
        return true;
    },

    /**
     * Déclenche un événement personnalisé
     * @param {string} name - Nom de l'événement
     * @param {Object} detail - Détails de l'événement
     */
    triggerEvent: function(name, detail = {}) {
        const event = new CustomEvent(name, {
            detail,
            bubbles: true,
            cancelable: true
        });
        
        document.dispatchEvent(event);
    },

    /**
     * Affiche un message de debug si le mode debug est activé
     * @param {string} message - Message à afficher
     * @param {*} data - Données supplémentaires à logger
     */
    debug: function(message, data) {
        if (this.config.debugMode) {
            if (data) {
                console.log(`[ModalManager] ${message}`, data);
            } else {
                console.log(`[ModalManager] ${message}`);
            }
        }
    }
};

// Auto-initialisation lors du chargement du script
document.addEventListener('DOMContentLoaded', function() {
    // Récupérer la configuration depuis window.dashboardConfig si disponible
    const debugMode = window.dashboardConfig && window.dashboardConfig.debugMode;
    
    // Initialiser le gestionnaire de modaux
    ModalManager.init({
        debugMode: debugMode || false
    });
    
    // Exposer le gestionnaire de modaux à l'échelle globale
    window.ModalManager = ModalManager;
});
