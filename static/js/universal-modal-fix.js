/**
 * universal-modal-fix.js - Solution universelle pour les problèmes de modales
 * Compatible avec data-bs-target (Bootstrap) et data-portal-target (votre système personnalisé)
 */
(function() {
    'use strict';
    
    // Configuration
    const config = {
        debug: false, // Mettre à true pour activer le débogage
        log: function(message) {
            if (this.debug) console.log("UniversalModalFix:", message);
        }
    };
    
    // Fonction principale qui initialise tout
    function initUniversalModalFix() {
        config.log("Initialisation du correctif universel pour les modales...");
        
        // 1. Traiter tous les boutons avec data-portal-target
        document.querySelectorAll('[data-portal-target]').forEach(button => {
            const targetId = button.getAttribute('data-portal-target');
            if (!targetId) return;
            
            config.log(`Traitement du bouton portal pour la cible: ${targetId}`);
            
            // Supprimer les gestionnaires d'événements existants
            const newButton = button.cloneNode(true);
            button.parentNode.replaceChild(newButton, button);
            
            // Ajouter notre gestionnaire d'événements
            newButton.addEventListener('click', function(e) {
                e.preventDefault();
                openModal(targetId.replace(/^#/, ''));
            });
        });
        
        // 2. Vérifier les boutons avec data-bs-target au cas où
        document.querySelectorAll('[data-bs-toggle="modal"]').forEach(button => {
            const targetId = button.getAttribute('data-bs-target');
            if (!targetId) return;
            
            config.log(`Vérification du bouton Bootstrap pour la cible: ${targetId}`);
            
            // S'assurer que la modale a été correctement initialisée par Bootstrap
            const targetModal = document.querySelector(targetId);
            if (targetModal && !bootstrap.Modal.getInstance(targetModal)) {
                try {
                    new bootstrap.Modal(targetModal);
                    config.log(`Modale Bootstrap initialisée: ${targetId}`);
                } catch (err) {
                    config.log(`Erreur d'initialisation Bootstrap pour ${targetId}: ${err.message}`);
                }
            }
        });
        
        // 3. S'assurer que tous les boutons de fermeture fonctionnent
        document.querySelectorAll('[data-bs-dismiss="modal"], [data-portal-dismiss="modal"], .btn-close').forEach(closeButton => {
            // Remplacer pour supprimer les gestionnaires d'événements existants
            const newCloseButton = closeButton.cloneNode(true);
            closeButton.parentNode.replaceChild(newCloseButton, closeButton);
            
            newCloseButton.addEventListener('click', function(e) {
                e.preventDefault();
                const modal = this.closest('.modal');
                if (modal) {
                    closeModal(modal.id);
                }
            });
        });
        
        config.log("Initialisation du correctif terminée.");
    }
    
    // Fonction pour ouvrir une modale de manière fiable
    function openModal(modalId) {
        config.log(`Tentative d'ouverture de la modale: ${modalId}`);
        const modalElement = document.getElementById(modalId);
        
        if (!modalElement) {
            console.error(`Modale non trouvée: ${modalId}`);
            return;
        }
        
        // Essayer d'abord avec l'API Bootstrap
        try {
            const bsModal = bootstrap.Modal.getInstance(modalElement) || new bootstrap.Modal(modalElement);
            bsModal.show();
            config.log(`Modale ouverte via Bootstrap: ${modalId}`);
            
            // S'assurer que la modale est visible après un court délai
            setTimeout(() => {
                fixModalVisibility(modalElement);
            }, 50);
            return;
        } catch (err) {
            config.log(`Échec de l'ouverture via Bootstrap: ${err.message}`);
            // Continuer avec la méthode manuelle
        }
        
        // Méthode manuelle si Bootstrap échoue
        modalElement.style.display = 'block';
        modalElement.classList.add('show');
        document.body.classList.add('modal-open');
        
        // Créer un backdrop si nécessaire
        let backdrop = document.querySelector('.modal-backdrop');
        if (!backdrop) {
            backdrop = document.createElement('div');
            backdrop.className = 'modal-backdrop fade show';
            document.body.appendChild(backdrop);
        }
        
        // Assurer la visibilité et l'interactivité après un court délai
        setTimeout(() => {
            fixModalVisibility(modalElement);
        }, 50);
        
        config.log(`Modale ouverte manuellement: ${modalId}`);
    }
    
    // Fonction pour fermer une modale de manière fiable
    function closeModal(modalId) {
        config.log(`Tentative de fermeture de la modale: ${modalId}`);
        const modalElement = document.getElementById(modalId);
        
        if (!modalElement) {
            console.error(`Modale non trouvée: ${modalId}`);
            return;
        }
        
        // Essayer d'abord avec l'API Bootstrap
        try {
            const bsModal = bootstrap.Modal.getInstance(modalElement);
            if (bsModal) {
                bsModal.hide();
                config.log(`Modale fermée via Bootstrap: ${modalId}`);
                return;
            }
        } catch (err) {
            config.log(`Échec de la fermeture via Bootstrap: ${err.message}`);
            // Continuer avec la méthode manuelle
        }
        
        // Méthode manuelle si Bootstrap échoue
        modalElement.style.display = 'none';
        modalElement.classList.remove('show');
        document.body.classList.remove('modal-open');
        
        // Supprimer le backdrop
        const backdrop = document.querySelector('.modal-backdrop');
        if (backdrop) backdrop.remove();
        
        config.log(`Modale fermée manuellement: ${modalId}`);
    }
    
    // Fonction pour s'assurer que tous les éléments de la modale sont visibles et interactifs
    function fixModalVisibility(modalElement) {
        if (!modalElement) return;
        
        // S'assurer que la modale elle-même est visible
        modalElement.style.display = 'block';
        modalElement.style.visibility = 'visible';
        modalElement.style.opacity = '1';
        
        // Correction des sélecteurs
        const selects = modalElement.querySelectorAll('select, .form-select');
        selects.forEach(select => {
            select.style.cssText = `
                display: block !important;
                visibility: visible !important;
                opacity: 1 !important;
                position: relative !important;
                z-index: 2000 !important;
                appearance: menulist !important;
                -webkit-appearance: menulist !important;
                width: 100% !important;
                pointer-events: auto !important;
            `;
        });
        
        // Correction des champs de formulaire
        const inputs = modalElement.querySelectorAll('input:not([type="hidden"]), textarea');
        inputs.forEach(input => {
            input.style.cssText = `
                display: block !important;
                visibility: visible !important;
                opacity: 1 !important;
                position: relative !important;
                z-index: 1500 !important;
                pointer-events: auto !important;
            `;
        });
        
        // Correction des boutons
        const buttons = modalElement.querySelectorAll('button:not(.btn-close), .btn:not(.btn-close)');
        buttons.forEach(button => {
            button.style.cssText = `
                display: inline-block !important;
                visibility: visible !important;
                opacity: 1 !important;
                position: relative !important;
                z-index: 2000 !important;
                pointer-events: auto !important;
            `;
        });
        
        // Correction du bouton de fermeture
        const closeButtons = modalElement.querySelectorAll('.btn-close, [data-bs-dismiss="modal"], [data-portal-dismiss="modal"]');
        closeButtons.forEach(button => {
            button.style.cssText = `
                display: block !important;
                visibility: visible !important;
                opacity: 1 !important;
                position: relative !important;
                z-index: 2500 !important;
                pointer-events: auto !important;
            `;
        });
    }
    
    // Initialiser après le chargement du DOM
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', initUniversalModalFix);
    } else {
        initUniversalModalFix();
    }
    
    // Re-initialiser après les changements d'AJAX
    const originalFetch = window.fetch;
    window.fetch = function() {
        return originalFetch.apply(this, arguments).then(response => {
            setTimeout(initUniversalModalFix, 500);
            return response;
        });
    };
    
    // Exposer quelques fonctions utiles globalement
    window.universalModalFix = {
        openModal: openModal,
        closeModal: closeModal,
        reInit: initUniversalModalFix
    };
})();
