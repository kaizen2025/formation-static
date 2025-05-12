/**
 * modal-simple.js - Solution optimisée pour les modaux Bootstrap
 * Version finale avec correctifs pour tous les problèmes d'affichage
 */
(function() {
    'use strict';
    
    // Configuration
    const config = {
        debug: true,
        log: function(message) {
            if (this.debug) console.log("ModalSimple:", message);
        }
    };
    
    /**
     * Fonction principale qui applique tous les correctifs nécessaires aux modaux
     */
    function fixModal(modal) {
        if (!modal) return;
        
        const modalId = modal.id || 'unknownModal';
        config.log(`Fixing modal: ${modalId}`);
        
        // Correction des sélecteurs
        fixSelects(modal);
        
        // Correction des champs de formulaire
        fixFormFields(modal);
        
        // Correction des onglets
        fixTabs(modal);
        
        // Correction des badges
        fixBadges(modal);
        
        // Correction des boutons
        fixButtons(modal);
    }
    
    /**
     * Correction spécifique pour les sélecteurs
     */
    function fixSelects(modal) {
        const selects = modal.querySelectorAll('select, .form-select');
        
        selects.forEach(select => {
            // Appliquer des styles spécifiques pour garantir la visibilité
            select.style.display = 'block';
            select.style.visibility = 'visible';
            select.style.opacity = '1';
            select.style.color = '#212529';
            select.style.backgroundColor = '#ffffff';
            select.style.appearance = 'menulist';
            select.style.WebkitAppearance = 'menulist';
            select.style.MozAppearance = 'menulist';
            
            // Corriger chaque option aussi
            const options = select.querySelectorAll('option');
            options.forEach(option => {
                option.style.color = '#212529';
                option.style.backgroundColor = '#ffffff';
            });
            
            // Ajouter un gestionnaire d'événements pour la validation
            select.addEventListener('change', function() {
                if (this.value) {
                    this.classList.remove('is-invalid');
                    const errorEl = this.parentNode.querySelector('.invalid-feedback, .text-danger');
                    if (errorEl) errorEl.style.display = 'none';
                }
            });
            
            // Force repaint pour s'assurer que le select est bien rendu
            select.style.display = 'none';
            select.offsetHeight; // Force reflow
            select.style.display = 'block';
            
            // Marquer comme corrigé
            select.dataset.fixed = 'true';
        });
    }
    
    /**
     * Correction des champs de formulaire
     */
    function fixFormFields(modal) {
        const inputs = modal.querySelectorAll('input:not([type="hidden"]), textarea');
        
        inputs.forEach(input => {
            input.style.display = 'block';
            input.style.visibility = 'visible';
            input.style.opacity = '1';
            input.style.color = '#212529';
            input.style.backgroundColor = '#ffffff';
            
            // Marquer comme corrigé
            input.dataset.fixed = 'true';
        });
    }
    
    /**
     * Correction des onglets
     */
    function fixTabs(modal) {
        const tabs = modal.querySelectorAll('.nav-tabs .nav-link');
        
        tabs.forEach(tab => {
            // Style de base
            tab.style.display = 'block';
            tab.style.visibility = 'visible';
            tab.style.opacity = '1';
            
            // Gérer le clic sur l'onglet
            tab.addEventListener('click', function(e) {
                e.preventDefault();
                
                // Récupérer la cible
                const target = this.getAttribute('data-bs-target');
                if (!target) return;
                
                // Désactiver tous les onglets
                tabs.forEach(t => {
                    t.classList.remove('active');
                    t.setAttribute('aria-selected', 'false');
                });
                
                // Activer cet onglet
                this.classList.add('active');
                this.setAttribute('aria-selected', 'true');
                
                // Masquer tous les panneaux
                const panes = modal.querySelectorAll('.tab-pane');
                panes.forEach(pane => {
                    pane.classList.remove('show', 'active');
                    pane.style.display = 'none';
                });
                
                // Afficher le panneau cible
                const targetPane = modal.querySelector(target);
                if (targetPane) {
                    targetPane.classList.add('show', 'active');
                    targetPane.style.display = 'block';
                    
                    // Corriger les éléments du panneau
                    fixFormFields(targetPane);
                    fixSelects(targetPane);
                    
                    // Focus sur le premier champ
                    setTimeout(() => {
                        const firstInput = targetPane.querySelector('input:not([type="hidden"]), select, textarea');
                        if (firstInput) {
                            try {
                                firstInput.focus();
                            } catch (e) {
                                console.error('Error focusing:', e);
                            }
                        }
                    }, 100);
                }
            });
            
            // Marquer comme corrigé
            tab.dataset.fixed = 'true';
        });
        
        // S'assurer que le panneau actif est visible
        const activePane = modal.querySelector('.tab-pane.active');
        if (activePane) {
            activePane.style.display = 'block';
            activePane.style.visibility = 'visible';
            activePane.style.opacity = '1';
        }
    }
    
    /**
     * Correction des badges
     */
    function fixBadges(modal) {
        const badges = modal.querySelectorAll('.badge, .salle-field');
        
        badges.forEach(badge => {
            badge.style.color = '#212529';
            badge.style.backgroundColor = '#f8f9fa';
            badge.style.border = '1px solid #dee2e6';
            badge.dataset.fixed = 'true';
        });
    }
    
    /**
     * Correction des boutons
     */
    function fixButtons(modal) {
        const buttons = modal.querySelectorAll('.btn-primary, .btn-success');
        
        buttons.forEach(button => {
            // Style pour les boutons primaires
            if (button.classList.contains('btn-primary')) {
                button.style.backgroundColor = '#0d6efd';
                button.style.borderColor = '#0d6efd';
                button.style.color = 'white';
            }
            
            // Style pour les boutons de succès
            if (button.classList.contains('btn-success')) {
                button.style.backgroundColor = '#198754';
                button.style.borderColor = '#198754';
                button.style.color = 'white';
            }
            
            // S'assurer qu'ils sont visibles
            button.style.display = 'inline-block';
            button.style.visibility = 'visible';
            button.style.opacity = '1';
            
            // Marquer comme corrigé
            button.dataset.fixed = 'true';
        });
    }
    
    /**
     * Gestionnaire d'affichage des modaux
     */
    function handleModalShow(event) {
        const modal = event.target;
        config.log(`Modal ${modal.id} is being shown`);
        
        // Appliquer toutes les corrections
        fixModal(modal);
        
        // Focus sur le premier champ après l'affichage
        setTimeout(() => {
            // Trouver le panneau actif
            const activePane = modal.querySelector('.tab-pane.active');
            const targetElement = activePane 
                ? activePane.querySelector('select, input:not([type="hidden"]), textarea')
                : modal.querySelector('select, input:not([type="hidden"]), textarea');
                
            if (targetElement) {
                try {
                    targetElement.focus();
                } catch (e) {
                    config.log(`Error focusing on first field: ${e.message}`);
                }
            }
        }, 300);
    }
    
    /**
     * Vérifier et corriger périodiquement les modaux
     */
    function periodicCheck() {
        const modals = document.querySelectorAll('.modal.show');
        modals.forEach(modal => {
            // Vérifier les éléments qui pourraient avoir perdu leurs correctifs
            const unfixedSelects = modal.querySelectorAll('select:not([data-fixed]), .form-select:not([data-fixed])');
            if (unfixedSelects.length > 0) {
                config.log(`Found ${unfixedSelects.length} unfixed selects in modal ${modal.id}, reapplying fixes`);
                fixModal(modal);
            }
        });
    }
    
    /**
     * Initialisation
     */
    function init() {
        config.log('Initializing modal-simple.js');
        
        // Correction initiale pour tous les modaux
        document.querySelectorAll('.modal').forEach(fixModal);
        
        // Écouter les événements d'affichage de modal
        document.addEventListener('show.bs.modal', handleModalShow);
        
        // Écouter les événements d'onglets
        document.addEventListener('shown.bs.tab', function(event) {
            const tabPane = document.querySelector(event.target.getAttribute('data-bs-target'));
            if (tabPane) {
                config.log(`Tab pane ${tabPane.id} shown, applying fixes`);
                fixModal(tabPane.closest('.modal'));
            }
        });
        
        // Vérification périodique des modaux
        setInterval(periodicCheck, 1000);
        
        config.log('Initialization complete');
    }
    
    // Démarrer lorsque le DOM est prêt
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
