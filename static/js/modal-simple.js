/**
 * modal-simple.js - Solution ultra-simplifiée pour les modaux Bootstrap
 * Ce script remplace toutes les approches complexes précédentes
 */
(function() {
    'use strict';
    
    // Configuration de base
    const config = {
        debug: true,
        log: function(message) {
            if (this.debug) console.log("ModalSimple:", message);
        },
        selectors: {
            modals: '.modal',
            formElements: 'select, input:not([type="hidden"]), textarea, button:not(.btn-close)',
            tabPanes: '.tab-pane',
            tabButtons: '[data-bs-toggle="tab"]',
            selectElements: 'select, .form-select'
        }
    };
    
    // Fonction pour initialiser les modaux
    function initializeModal(modal) {
        if (!modal) return;
        
        const modalId = modal.id || 'unknownModal';
        config.log(`Initializing modal: ${modalId}`);
        
        // S'assurer que les éléments de formulaire sont visibles et utilisables
        const formElements = modal.querySelectorAll(config.selectors.formElements);
        formElements.forEach(element => {
            element.style.display = element.tagName === 'SELECT' ? 'block' : 
                                   (element.tagName === 'BUTTON' || element.classList.contains('btn')) ? 'inline-block' : 'block';
            element.style.visibility = 'visible';
            element.style.opacity = '1';
            element.style.zIndex = 'auto';
            
            // Styles spécifiques pour les selects qui sont souvent problématiques
            if (element.tagName === 'SELECT') {
                element.style.webkitAppearance = 'menulist';
                element.style.mozAppearance = 'menulist';
                element.style.appearance = 'menulist';
            }
        });
        
        // S'assurer que l'onglet actif est visible
        const activeTabPane = modal.querySelector(`${config.selectors.tabPanes}.active`);
        if (activeTabPane) {
            activeTabPane.style.display = 'block';
            activeTabPane.style.visibility = 'visible';
            activeTabPane.style.opacity = '1';
        }
        
        // Gérer les boutons d'onglets
        const tabButtons = modal.querySelectorAll(config.selectors.tabButtons);
        tabButtons.forEach(button => {
            button.addEventListener('click', function(event) {
                // Empêcher le comportement par défaut si nécessaire
                if (button.classList.contains('nav-link') && !button.hasAttribute('href')) {
                    event.preventDefault();
                }
                
                // Récupérer la cible de l'onglet
                const targetSelector = button.getAttribute('data-bs-target') || button.getAttribute('href');
                if (!targetSelector) return;
                
                // Désactiver tous les onglets
                modal.querySelectorAll('.nav-link').forEach(tab => {
                    tab.classList.remove('active');
                    tab.setAttribute('aria-selected', 'false');
                });
                
                // Activer l'onglet cliqué
                button.classList.add('active');
                button.setAttribute('aria-selected', 'true');
                
                // Masquer tous les panneaux d'onglets
                modal.querySelectorAll(config.selectors.tabPanes).forEach(pane => {
                    pane.classList.remove('active', 'show');
                    pane.style.display = 'none';
                    pane.style.opacity = '0';
                    pane.style.visibility = 'hidden';
                });
                
                // Afficher le panneau ciblé
                const targetPane = document.querySelector(targetSelector);
                if (targetPane) {
                    targetPane.classList.add('active', 'show');
                    targetPane.style.display = 'block';
                    targetPane.style.opacity = '1';
                    targetPane.style.visibility = 'visible';
                    
                    // Focus sur le premier champ de l'onglet
                    setTimeout(() => {
                        const firstField = targetPane.querySelector(config.selectors.formElements);
                        if (firstField) {
                            try {
                                firstField.focus();
                            } catch (e) {
                                config.log(`Error focusing first field in tab: ${e.message}`);
                            }
                        }
                    }, 50);
                }
            });
        });
    }
    
    // Fonction pour gérer l'affichage d'un modal
    function handleModalShow(modal) {
        if (!modal) return;
        
        config.log(`Modal ${modal.id} is being shown`);
        
        // S'assurer que tous les éléments sont visibles
        const formElements = modal.querySelectorAll(config.selectors.formElements);
        formElements.forEach(element => {
            element.style.display = element.tagName === 'SELECT' ? 'block' : 
                                   (element.tagName === 'BUTTON' || element.classList.contains('btn')) ? 'inline-block' : 'block';
            element.style.visibility = 'visible';
            element.style.opacity = '1';
        });
        
        // Focus sur le premier champ
        setTimeout(() => {
            const firstField = modal.querySelector('select, input:not([type="hidden"]), textarea');
            if (firstField) {
                try {
                    firstField.focus();
                } catch (e) {
                    config.log(`Error focusing first field: ${e.message}`);
                }
            }
        }, 100);
    }
    
    // Fonction principale d'initialisation
    function init() {
        config.log("Initializing modal-simple.js");
        
        // Initialiser tous les modaux présents lors du chargement
        document.querySelectorAll(config.selectors.modals).forEach(modal => {
            initializeModal(modal);
        });
        
        // Surveiller l'ouverture des modaux
        document.addEventListener('show.bs.modal', function(event) {
            handleModalShow(event.target);
        });
        
        // Un sélecteur efficace pour trouver le contenu caché et le rendre visible
        document.addEventListener('shown.bs.modal', function(event) {
            const modal = event.target;
            
            // Collecter tous les selects et s'assurer qu'ils sont bien visibles
            const selectElements = modal.querySelectorAll(config.selectors.selectElements);
            selectElements.forEach(select => {
                select.style.display = 'block !important';
                select.style.visibility = 'visible !important';
                select.style.opacity = '1 !important';
                select.style.appearance = 'menulist !important';
                select.style.webkitAppearance = 'menulist !important';
                select.style.mozAppearance = 'menulist !important';
                select.style.position = 'static !important';
                select.style.zIndex = 'auto !important';
                
                // Parfois, forcer un recalcul des dimensions aide
                select.offsetHeight;
            });
            
            // Vérifier et corriger les onglets
            const activeTabPane = modal.querySelector(`${config.selectors.tabPanes}.active`);
            if (activeTabPane) {
                activeTabPane.style.display = 'block !important';
                activeTabPane.style.visibility = 'visible !important';
                activeTabPane.style.opacity = '1 !important';
            }
        });
        
        config.log("Initialization complete");
    }
    
    // Démarrer lorsque le DOM est prêt
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
