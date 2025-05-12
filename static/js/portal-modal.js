// static/js/portal-modal.js

/**
 * PortalModal - Une solution robuste pour remplacer les modals Bootstrap problématiques
 * Cette solution contourne complètement le système modal de Bootstrap
 */
class PortalModal {
    constructor() {
        this.portalContainer = null;
        this.activeModal = null;
        this.backdrop = null;
        this.activeButtons = new Map();
        this.init();
    }

    init() {
        // Créer un conteneur pour les portails modaux au niveau racine du document
        this.portalContainer = document.createElement('div');
        this.portalContainer.id = 'portal-modal-container';
        this.portalContainer.style.cssText = 'position: fixed; top: 0; left: 0; width: 100%; height: 0; z-index: 1999;';
        document.body.appendChild(this.portalContainer);

        // Créer le backdrop (fond semi-transparent)
        this.backdrop = document.createElement('div');
        this.backdrop.className = 'portal-modal-backdrop';
        this.backdrop.style.cssText = 'position: fixed; top: 0; left: 0; width: 100%; height: 100%; background-color: rgba(0,0,0,0.5); z-index: 2000; display: none;';
        this.portalContainer.appendChild(this.backdrop);

        // Fermeture par clic sur backdrop
        this.backdrop.addEventListener('click', () => {
            if (this.activeModal && this.activeModal.getAttribute('data-backdrop') !== 'static') {
                this.hideModal(this.activeModal.id);
            }
        });

        // Attacher des gestionnaires d'événements aux boutons modaux
        document.addEventListener('click', (e) => {
            const portalTrigger = e.target.closest('[data-portal-target]');
            if (portalTrigger) {
                e.preventDefault();
                const targetId = portalTrigger.getAttribute('data-portal-target');
                this.showModal(targetId);
            }

            const closeButton = e.target.closest('[data-portal-dismiss]');
            if (closeButton && this.activeModal) {
                e.preventDefault();
                this.hideModal(this.activeModal.id);
            }
        });

        // Échap pour fermer
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape' && this.activeModal && this.activeModal.getAttribute('data-keyboard') !== 'false') {
                this.hideModal(this.activeModal.id);
            }
        });

        // Convertir les modals Bootstrap existants
        this.convertExistingModals();
    }

    convertExistingModals() {
        document.querySelectorAll('.modal').forEach(modal => {
            // Identifiant du modal pour référence
            const modalId = modal.id;
            if (!modalId) return;

            // Créer un clone du modal pour notre système de portail
            const portalModal = modal.cloneNode(true);
            portalModal.classList.remove('fade', 'modal');
            portalModal.classList.add('portal-modal');
            portalModal.style.cssText = `
                position: fixed;
                top: 50%;
                left: 50%;
                transform: translate(-50%, -50%);
                z-index: 2001;
                width: auto;
                max-width: 90%;
                max-height: 90vh;
                overflow: auto;
                display: none;
                box-shadow: 0 0.5rem 1rem rgba(0,0,0,0.5);
                border-radius: 0.5rem;
                background-color: transparent;
            `;

            // Conserver les attributs importants
            const backdrop = modal.getAttribute('data-bs-backdrop') || 'true';
            const keyboard = modal.getAttribute('data-bs-keyboard') || 'true';
            
            portalModal.setAttribute('data-backdrop', backdrop);
            portalModal.setAttribute('data-keyboard', keyboard);
            
            // Sélectionner le contenu modal réel (seulement .modal-content)
            const modalContent = portalModal.querySelector('.modal-content');
            if (modalContent) {
                modalContent.style.cssText = `
                    background-color: #fff;
                    position: relative;
                    display: flex;
                    flex-direction: column;
                    width: 100%;
                    border: 1px solid rgba(0,0,0,0.2);
                    border-radius: 0.5rem;
                    outline: 0;
                `;
            }

            // Ajouter au conteneur de portail
            this.portalContainer.appendChild(portalModal);

            // Convertir les déclencheurs
            document.querySelectorAll(`[data-bs-toggle="modal"][data-bs-target="#${modalId}"]`).forEach(trigger => {
                this.activeButtons.set(trigger, {
                    targetId: modalId,
                    originalHandler: trigger.onclick
                });
                
                // Remplacer par notre déclencheur
                trigger.setAttribute('data-portal-target', `#${modalId}`);
                trigger.removeAttribute('data-bs-toggle');
                trigger.removeAttribute('data-bs-target');
            });

            // Convertir les boutons de fermeture
            portalModal.querySelectorAll('[data-bs-dismiss="modal"]').forEach(closeBtn => {
                closeBtn.setAttribute('data-portal-dismiss', 'modal');
                closeBtn.removeAttribute('data-bs-dismiss');
            });
        });

        // Retirer les modals Bootstrap originaux du DOM 
        // (optionnel - vous pouvez les conserver cachés si vous préférez)
        document.querySelectorAll('.modal').forEach(modal => {
            modal.style.display = 'none';
            modal.classList.remove('fade', 'show');
            modal.setAttribute('aria-hidden', 'true');
        });
    }

    showModal(targetId) {
        // Nettoyer l'ID si nécessaire 
        const id = targetId.startsWith('#') ? targetId.substring(1) : targetId;
        
        // Trouver le modal
        const modal = document.querySelector(`#portal-modal-container .portal-modal#${id}`);
        
        if (!modal) {
            console.error(`Modal with id "${id}" not found in portal container`);
            return;
        }

        // Cacher le modal actif si présent
        if (this.activeModal && this.activeModal !== modal) {
            this.hideModal(this.activeModal.id);
        }

        // Ajuster le style du body pour empêcher le défilement
        document.body.style.overflow = 'hidden';
        document.body.style.paddingRight = '17px'; // Compensation pour la disparition de la barre de défilement
        
        // Afficher le backdrop puis le modal avec un léger délai
        this.backdrop.style.display = 'block';
        
        // Réinitialiser les styles pour s'assurer que tout fonctionne correctement
        modal.style.display = 'block';
        
        // Ajuster la largeur en fonction des classes de taille
        if (modal.querySelector('.modal-dialog.modal-xl')) {
            modal.style.maxWidth = '1140px';
        } else if (modal.querySelector('.modal-dialog.modal-lg')) {
            modal.style.maxWidth = '800px';
        } else if (modal.querySelector('.modal-dialog.modal-sm')) {
            modal.style.maxWidth = '500px';
        } else {
            modal.style.maxWidth = '500px';
        }
        
        // Rendre visible au premier plan
        setTimeout(() => {
            modal.style.opacity = '1';
            
            // Centrer correctement le modal
            const modalDialog = modal.querySelector('.modal-dialog');
            if (modalDialog) {
                modalDialog.style.margin = '0 auto';
                modalDialog.style.position = 'relative';
                
                // Vérifier s'il s'agit d'un modal centré verticalement
                if (modalDialog.classList.contains('modal-dialog-centered')) {
                    modalDialog.style.display = 'flex';
                    modalDialog.style.alignItems = 'center';
                    modalDialog.style.minHeight = 'calc(100% - 3.5rem)';
                }
            }
        }, 10);

        // Focus sur le premier élément interactif
        setTimeout(() => {
            const firstInput = modal.querySelector('input:not([type="hidden"]), select, textarea, button:not(.btn-close)');
            if (firstInput) firstInput.focus();
            
            // Déclencher un événement personnalisé similaire aux événements Bootstrap
            const showEvent = new CustomEvent('portal-modal.shown', { detail: { modalId: id } });
            document.dispatchEvent(showEvent);
            
            // Initialiser Bootstrap Tooltips dans le modal
            if (typeof bootstrap !== 'undefined' && typeof bootstrap.Tooltip === 'function') {
                modal.querySelectorAll('[title], [data-bs-toggle="tooltip"]').forEach(el => {
                    new bootstrap.Tooltip(el, { container: modal });
                });
            }
            
            // Initialiser les badges de thème
            if (typeof window.enhanceThemeBadgesGlobally === 'function') {
                window.enhanceThemeBadgesGlobally(modal);
            }
        }, 150);
        
        this.activeModal = modal;
    }

    hideModal(id) {
        // Nettoyer l'ID si nécessaire 
        const modalId = id.startsWith('#') ? id.substring(1) : id;
        
        // Trouver le modal
        const modal = document.querySelector(`#portal-modal-container .portal-modal#${modalId}`);
        
        if (!modal) {
            console.error(`Modal with id "${modalId}" not found in portal container`);
            return;
        }

        // Transition de sortie 
        modal.style.opacity = '0';
        
        // Masquer après transition
        setTimeout(() => {
            modal.style.display = 'none';
            
            // Masquer le backdrop si c'était le dernier modal
            if (this.activeModal === modal) {
                this.backdrop.style.display = 'none';
                this.activeModal = null;
                
                // Restaurer le défilement du body
                document.body.style.overflow = '';
                document.body.style.paddingRight = '';
            }
            
            // Déclencher un événement personnalisé similaire aux événements Bootstrap
            const hideEvent = new CustomEvent('portal-modal.hidden', { detail: { modalId: modalId } });
            document.dispatchEvent(hideEvent);
            
            // Supprimer les tooltips pour éviter les doublons
            if (typeof bootstrap !== 'undefined' && typeof bootstrap.Tooltip === 'function') {
                modal.querySelectorAll('[data-bs-toggle="tooltip"]').forEach(el => {
                    const instance = bootstrap.Tooltip.getInstance(el);
                    if (instance) instance.dispose();
                });
            }
        }, 150);
    }
}

// Initialiser notre système de modals par portail lorsque le DOM est chargé
document.addEventListener('DOMContentLoaded', () => {
    window.portalModal = new PortalModal();
    console.log('Portal Modal system initialized');
});