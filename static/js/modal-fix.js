// Créez un nouveau fichier static/js/modal-fix.js avec ce contenu

/**
 * Solution définitive pour les modales qui scintillent
 * Ce script remplace complètement la gestion des modales par Bootstrap
 * pour éviter les conflits d'événements qui causent le scintillement
 */
document.addEventListener('DOMContentLoaded', function() {
    // Supprimer tous les gestionnaires d'événements Bootstrap pour les modales
    document.querySelectorAll('[data-bs-toggle="modal"]').forEach(function(button) {
        // Clone le bouton pour supprimer tous les écouteurs d'événements
        const newButton = button.cloneNode(true);
        button.parentNode.replaceChild(newButton, button);
    });

    // Cache global pour les instances de modales
    const modalInstances = {};

    // Gestionnaires d'événements personnalisés pour les boutons de modales
    document.addEventListener('click', function(event) {
        // Vérifier si l'élément cliqué ou un de ses parents est un déclencheur de modale
        let target = event.target;
        while (target && target !== document) {
            if (target.hasAttribute('data-bs-toggle') && target.getAttribute('data-bs-toggle') === 'modal') {
                event.preventDefault();
                event.stopPropagation();
                
                // Récupérer l'ID de la modale cible
                const modalId = target.getAttribute('data-bs-target') || target.getAttribute('href');
                if (!modalId) return;
                
                // Ouvrir la modale de façon sécurisée
                openModalSafely(modalId.replace('#', ''));
                return;
            }
            target = target.parentNode;
        }
    }, true);

    // Fonction sécurisée pour ouvrir une modale sans scintillement
    function openModalSafely(modalId) {
        const modalElement = document.getElementById(modalId);
        if (!modalElement) return;
        
        // Désactiver temporairement les événements de survol
        document.body.classList.add('modal-opening');
        
        // Si la modale est déjà dans le cache, la réutiliser
        if (!modalInstances[modalId]) {
            try {
                // Appliquer des styles pour désactiver les transitions
                const modalBackdrop = document.createElement('div');
                modalBackdrop.className = 'modal-backdrop show';
                modalBackdrop.style.transition = 'none';
                document.body.appendChild(modalBackdrop);
                
                // Configurer la modale
                modalElement.style.display = 'block';
                modalElement.style.transition = 'none';
                modalElement.classList.add('show');
                modalElement.setAttribute('aria-modal', 'true');
                modalElement.setAttribute('role', 'dialog');
                modalElement.removeAttribute('aria-hidden');
                
                // Désactiver le défilement du corps
                document.body.style.overflow = 'hidden';
                document.body.style.paddingRight = '15px';
                
                // Créer un objet modal personnalisé
                modalInstances[modalId] = {
                    element: modalElement,
                    backdrop: modalBackdrop,
                    show: function() {
                        this.element.style.display = 'block';
                        this.element.classList.add('show');
                        this.backdrop.style.display = 'block';
                        document.body.style.overflow = 'hidden';
                        document.body.style.paddingRight = '15px';
                    },
                    hide: function() {
                        this.element.style.display = 'none';
                        this.element.classList.remove('show');
                        this.backdrop.style.display = 'none';
                        document.body.style.overflow = '';
                        document.body.style.paddingRight = '';
                    }
                };
                
                // Configurer les boutons de fermeture
                modalElement.querySelectorAll('[data-bs-dismiss="modal"]').forEach(function(closeBtn) {
                    // Supprimer les gestionnaires existants
                    const newCloseBtn = closeBtn.cloneNode(true);
                    closeBtn.parentNode.replaceChild(newCloseBtn, closeBtn);
                    
                    // Ajouter notre gestionnaire personnalisé
                    newCloseBtn.addEventListener('click', function(e) {
                        e.preventDefault();
                        e.stopPropagation();
                        modalInstances[modalId].hide();
                    });
                });
                
                // Fermer la modale si on clique sur l'arrière-plan
                modalBackdrop.addEventListener('click', function() {
                    modalInstances[modalId].hide();
                });
                
                // Fermer la modale si on clique en dehors du contenu
                modalElement.addEventListener('click', function(e) {
                    if (e.target === modalElement) {
                        modalInstances[modalId].hide();
                    }
                });
                
                // Ajouter un gestionnaire pour la touche Escape
                document.addEventListener('keydown', function(e) {
                    if (e.key === 'Escape' && modalElement.style.display === 'block') {
                        modalInstances[modalId].hide();
                    }
                });
                
            } catch (error) {
                console.error('Erreur lors de l\'initialisation de la modale:', error);
                // Fallback : utiliser l'API Bootstrap en dernier recours
                try {
                    const bsModal = new bootstrap.Modal(modalElement);
                    modalInstances[modalId] = {
                        bsInstance: bsModal,
                        show: function() { this.bsInstance.show(); },
                        hide: function() { this.bsInstance.hide(); }
                    };
                } catch (bsError) {
                    console.error('Erreur Bootstrap:', bsError);
                    return;
                }
            }
        }
        
        // Afficher la modale
        modalInstances[modalId].show();
        
        // Réactiver les événements de survol après un court délai
        setTimeout(function() {
            document.body.classList.remove('modal-opening');
        }, 500);
    }
    
    // Styles CSS pour empêcher les événements de survol pendant l'ouverture des modales
    const style = document.createElement('style');
    style.innerHTML = `
        .modal-opening * {
            pointer-events: none !important;
        }
        .modal-opening .modal.show,
        .modal-opening .modal.show *,
        .modal-opening .modal-backdrop {
            pointer-events: auto !important;
        }
        .modal, .modal-backdrop {
            transition: none !important;
        }
    `;
    document.head.appendChild(style);
    
    // Corrige également le problème des modales qui ne se ferment pas correctement
    const closeButtons = document.querySelectorAll('[data-bs-dismiss="modal"]');
    closeButtons.forEach(button => {
        button.addEventListener('click', function(e) {
            e.preventDefault();
            e.stopPropagation();
            
            // Trouver la modale parente
            let modalElement = this.closest('.modal');
            if (modalElement && modalElement.id) {
                if (modalInstances[modalElement.id]) {
                    modalInstances[modalElement.id].hide();
                } else {
                    // Fallback
                    modalElement.style.display = 'none';
                    modalElement.classList.remove('show');
                    document.body.style.overflow = '';
                    document.body.style.paddingRight = '';
                    
                    // Suppression des backdrops orphelins
                    document.querySelectorAll('.modal-backdrop').forEach(backdrop => {
                        backdrop.remove();
                    });
                }
            }
        });
    });
});