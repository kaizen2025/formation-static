/**
 * modal-form-fix.js - Correctif universel pour les problèmes de formulaires dans les modaux Bootstrap
 * Ce script améliore la visibilité et l'interactivité des éléments de formulaire dans tous les modaux
 */
(function() {
    "use strict";
    
    console.log("Modal Form Fix: Initializing...");
    
    // Configuration
    const config = {
        zIndexBase: 1050,
        formElementSelectors: [
            'input:not([type="hidden"])', 
            'select', 
            '.form-select',
            'textarea', 
            '.form-control',
            'button:not(.btn-close):not([data-bs-dismiss="modal"])', 
            '.btn:not(.btn-close):not([data-bs-dismiss="modal"])'
        ],
        labelSelectors: [
            'label', 
            '.form-label', 
            '.invalid-feedback', 
            '.form-text'
        ],
        tableSelectors: [
            'table', 
            '.table', 
            '.table-responsive', 
            'thead', 
            'tbody', 
            'tr', 
            'th', 
            'td'
        ],
        tabSelectors: [
            '.nav-tabs', 
            '.nav-pills', 
            '.tab-content', 
            '.tab-pane', 
            '.nav-link'
        ]
    };
    
    // Fonction pour corriger la visibilité des éléments de formulaire dans un modal
    function fixModalFormElements(modalElement) {
        if (!modalElement) return;
        
        console.log("Modal Form Fix: Fixing elements in modal:", modalElement.id || "unnamed modal");
        
        // Corriger les éléments de formulaire
        config.formElementSelectors.forEach((selector, index) => {
            const elements = modalElement.querySelectorAll(selector);
            elements.forEach(el => {
                el.style.cssText = `
                    display: ${el.tagName === 'SELECT' || el.classList.contains('form-select') ? 'block' : 
                              el.tagName === 'BUTTON' || el.classList.contains('btn') ? 'inline-block' : 'block'} !important;
                    visibility: visible !important;
                    opacity: 1 !important;
                    pointer-events: auto !important;
                    position: relative !important;
                    z-index: ${config.zIndexBase + 5 + index} !important;
                `;
                
                // Styles supplémentaires pour les selects
                if (el.tagName === 'SELECT' || el.classList.contains('form-select')) {
                    el.style.cssText += `
                        -webkit-appearance: menulist !important;
                        appearance: menulist !important;
                        width: 100% !important;
                    `;
                }
            });
        });
        
        // Corriger les labels et textes
        config.labelSelectors.forEach((selector) => {
            const elements = modalElement.querySelectorAll(selector);
            elements.forEach(el => {
                el.style.cssText = `
                    display: block !important;
                    visibility: visible !important;
                    opacity: 1 !important;
                    position: relative !important;
                    z-index: ${config.zIndexBase + 3} !important;
                `;
            });
        });
        
        // Corriger les tableaux
        config.tableSelectors.forEach((selector) => {
            const elements = modalElement.querySelectorAll(selector);
            elements.forEach(el => {
                el.style.cssText = `
                    display: ${el.tagName === 'TABLE' || el.classList.contains('table') ? 'table' : 
                              el.tagName === 'TR' ? 'table-row' : 
                              (el.tagName === 'TD' || el.tagName === 'TH') ? 'table-cell' : 
                              el.tagName === 'THEAD' || el.tagName === 'TBODY' ? 'table-row-group' : 'block'} !important;
                    visibility: visible !important;
                    opacity: 1 !important;
                    position: relative !important;
                    z-index: ${config.zIndexBase + 2} !important;
                `;
            });
        });
        
        // Corriger les onglets et leur contenu
        config.tabSelectors.forEach((selector) => {
            const elements = modalElement.querySelectorAll(selector);
            elements.forEach(el => {
                el.style.cssText = `
                    visibility: visible !important;
                    opacity: 1 !important;
                    position: relative !important;
                    z-index: ${config.zIndexBase + 3} !important;
                `;
                
                // Styles supplémentaires pour les onglets actifs
                if (el.classList.contains('tab-pane') && el.classList.contains('active')) {
                    el.style.display = 'block !important';
                }
                
                // Styles pour les liens d'onglets
                if (el.classList.contains('nav-link')) {
                    el.style.pointerEvents = 'auto !important';
                }
            });
        });
        
        console.log("Modal Form Fix: Elements fixed in modal:", modalElement.id || "unnamed modal");
    }
    
    // Observer les modaux affichés
    function observeModalDisplay() {
        document.addEventListener('show.bs.modal', function(event) {
            const modalElement = event.target;
            console.log("Modal Form Fix: Modal is about to be shown:", modalElement.id || "unnamed modal");
            
            // Fixer les éléments avant l'affichage
            fixModalFormElements(modalElement);
            
            // Puis à nouveau après l'affichage complet
            modalElement.addEventListener('shown.bs.modal', function() {
                console.log("Modal Form Fix: Modal is now fully shown:", modalElement.id || "unnamed modal");
                
                // Re-fixer les éléments une fois le modal affiché
                fixModalFormElements(modalElement);
                
                // Fixer spécifiquement les onglets affichés
                const activeTabs = modalElement.querySelectorAll('.tab-pane.active');
                activeTabs.forEach(tab => {
                    tab.style.display = 'block !important';
                    
                    // Fixer les éléments dans l'onglet actif
                    fixModalFormElements(tab);
                });
                
                // Observer les changements d'onglet
                const tabTriggers = modalElement.querySelectorAll('[data-bs-toggle="tab"]');
                tabTriggers.forEach(trigger => {
                    trigger.addEventListener('shown.bs.tab', function(e) {
                        const targetSelector = e.target.getAttribute('data-bs-target');
                        if (targetSelector) {
                            const tabPane = document.querySelector(targetSelector);
                            if (tabPane) {
                                console.log("Modal Form Fix: Tab changed, fixing new tab:", targetSelector);
                                fixModalFormElements(tabPane);
                            }
                        }
                    }, { once: false }); // Écouter tous les changements d'onglet
                });
            }, { once: true }); // Écouter seulement la première fois que le modal est affiché
        });
    }
    
    // Fonction d'initialisation
    function init() {
        console.log("Modal Form Fix: Setting up observers...");
        
        // Observer l'affichage des modaux
        observeModalDisplay();
        
        // Appliquer les correctifs aux modaux existants
        document.querySelectorAll('.modal').forEach(modal => {
            fixModalFormElements(modal);
        });
        
        console.log("Modal Form Fix: Initialization complete.");
    }
    
    // Lancer l'initialisation après le chargement du DOM
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
