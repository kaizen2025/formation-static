/**
 * modal-solution.js - Solution robuste pour les problèmes de modales Bootstrap
 * Remplace le fichier modal-fix-ultimate.js existant
 */

document.addEventListener('DOMContentLoaded', function() {
    console.log('Initialisation de la solution robuste pour les modales...');
    
    // Configuration globale - À adapter selon vos besoins
    const config = {
        animationsEnabled: true,      // Désactiver si les animations posent problème
        forceSafeMode: true,          // Force le mode sécurisé sur tous les navigateurs
        debugMode: false,             // Activer pour obtenir des logs détaillés
        autoFix: true,                // Tenter de corriger automatiquement les problèmes
        focusOnShow: true,            // Mettre le focus automatiquement dans le premier champ
        preventScrollLock: false      // Empêcher le verrouillage du scroll qui peut causer des décalages
    };
    
    // Détecter les navigateurs problématiques
    const needsFix = detectProblematicBrowser();
    
    // Appliquer les correctifs CSS nécessaires
    applyCSSFixes(needsFix || config.forceSafeMode);
    
    // Initialiser les gestionnaires d'événements pour les modales
    initializeModalEventHandlers(config);
    
    // Patch Bootstrap Modal si nécessaire
    patchBootstrapModal(needsFix || config.forceSafeMode);
    
    if (config.debugMode) {
        console.log('Configuration de la solution de modales:', config);
        console.log('Navigateur nécessite correctifs:', needsFix);
    }
    
    /**
     * Détecte si le navigateur actuel est connu pour avoir des problèmes avec Bootstrap Modal
     */
    function detectProblematicBrowser() {
        const ua = navigator.userAgent;
        
        // Détecter les versions problématiques connues
        const isChromium = /Chrome\//.test(ua) && /Google Inc/.test(navigator.vendor);
        const isChrome91Plus = /Chrome\/9[0-9]|Chrome\/[0-9]{3,}/.test(ua);
        const isFirefox90Plus = /Firefox\/9[0-9]|Firefox\/[0-9]{3,}/.test(ua);
        const isSafari15Plus = /Version\/1[5-9]|Version\/[2-9][0-9]/.test(ua) && /Safari/.test(ua);
        const isIOS15Plus = /OS 1[5-9]_|OS [2-9][0-9]_/.test(ua) && /Safari/.test(ua);
        const isEdge = /Edg\//.test(ua);
        
        // Vérifier si l'appareil est mobile
        const isMobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(ua);
        
        // Vérifier s'il s'agit d'un iPad avec iPadOS 13+
        const isIPadOS = /iPad/.test(ua) || (/Macintosh/.test(ua) && 'ontouchend' in document);
        
        if (config.debugMode) {
            console.log('Détection de navigateur:');
            console.log('- Chrome 91+:', isChrome91Plus);
            console.log('- Firefox 90+:', isFirefox90Plus);
            console.log('- Safari 15+:', isSafari15Plus);
            console.log('- iOS 15+:', isIOS15Plus);
            console.log('- Est mobile:', isMobile);
            console.log('- Est iPad OS:', isIPadOS);
        }
        
        return isChrome91Plus || isFirefox90Plus || isSafari15Plus || isIOS15Plus || (isEdge && isChromium) || (isMobile && !(isIPadOS && isSafari15Plus));
    }
    
    /**
     * Applique les correctifs CSS nécessaires pour assurer l'affichage correct des modales
     */
    function applyCSSFixes(needsFix) {
        if (!needsFix && !config.forceSafeMode) return;
        
        const styleEl = document.createElement('style');
        styleEl.id = 'modal-solution-styles';
        
        styleEl.textContent = `
            /* Correctifs pour les modales */
            .modal {
                display: none;
                position: fixed;
                top: 0;
                left: 0;
                z-index: 1055 !important;
                width: 100%;
                height: 100%;
                overflow-x: hidden;
                overflow-y: auto;
                outline: 0;
            }
            
            .modal.fade {
                transition: opacity 0.15s linear !important;
            }
            
            .modal.fade .modal-dialog {
                transition: transform 0.15s ease-out !important;
                transform: translate(0, -50px) !important;
            }
            
            .modal.show {
                display: block !important;
            }
            
            .modal.show .modal-dialog {
                transform: none !important;
            }
            
            .modal-backdrop {
                position: fixed;
                top: 0;
                left: 0;
                z-index: 1050 !important;
                width: 100vw;
                height: 100vh;
                background-color: #000;
                opacity: 0.5;
            }
            
            body.modal-open {
                overflow: hidden;
                padding-right: 0 !important;
            }
            
            /* Correctifs pour les problèmes de scroll */
            @media (max-width: 576px) {
                .modal-dialog {
                    margin: 0.5rem !important;
                }
            }
            
            /* Correctifs d'interface */
            .modal-content {
                box-shadow: 0 0.5rem 1rem rgba(0, 0, 0, 0.5) !important;
            }
            
            /* Eviter les décalages lors de l'ouverture */
            html {
                overflow-y: scroll !important;
            }
            
            /* Fixer l'animation d'affichage */
            .fade {
                transition: opacity 0.15s linear !important;
            }
            
            /* Assurer que les modales sont au-dessus de tout */
            .modal-backdrop.show {
                opacity: 0.5 !important;
            }

            /* Corriger les problèmes d'affichage des select dans les modales */
            .modal .form-select {
                display: block !important;
                visibility: visible !important;
                opacity: 1 !important;
                z-index: 2000 !important;
                position: relative !important;
            }
        `;
        
        document.head.appendChild(styleEl);
        
        if (config.debugMode) {
            console.log('Correctifs CSS appliqués');
        }
    }
    
    /**
     * Initialise les gestionnaires d'événements pour les modales
     */
    function initializeModalEventHandlers(config) {
        // Gestionnaire global pour tous les boutons qui ouvrent des modales
        document.addEventListener('click', function(event) {
            // Vérifier si c'est un bouton qui ouvre une modale
            const button = event.target.closest('[data-bs-toggle="modal"]');
            if (!button) return;
            
            // Prévenir le comportement par défaut pour éviter les conflits
            event.preventDefault();
            
            // Récupérer la cible
            const targetSelector = button.getAttribute('data-bs-target') || button.getAttribute('href');
            if (!targetSelector) return;
            
            const modal = document.querySelector(targetSelector);
            if (!modal) return;
            
            // Résoudre les problèmes potentiels avec le DOM
            prepareModalDOM(modal);
            
            // Ouvrir la modale
            openModal(modal, config);
        });
        
        // Gestionnaire pour les boutons de fermeture
        document.addEventListener('click', function(event) {
            // Vérifier si c'est un bouton de fermeture de modale
            const closeButton = event.target.closest('[data-bs-dismiss="modal"]');
            if (!closeButton) return;
            
            // Trouver la modale parente
            const modal = closeButton.closest('.modal');
            if (!modal) return;
            
            // Fermer la modale
            closeModal(modal, config);
        });
        
        // Gestionnaire pour la touche Echap
        document.addEventListener('keydown', function(event) {
            if (event.key !== 'Escape') return;
            
            // Trouver la modale ouverte la plus récente
            const openModals = document.querySelectorAll('.modal.show');
            if (openModals.length === 0) return;
            
            const modalToClose = openModals[openModals.length - 1];
            closeModal(modalToClose, config);
        });
        
        // Gestionnaire pour les clics sur l'arrière-plan
        document.addEventListener('click', function(event) {
            // Vérifier si le clic est sur l'arrière-plan d'une modale
            if (!event.target.classList.contains('modal')) return;
            
            // Récupérer l'attribut data-bs-backdrop
            const backdropAttr = event.target.getAttribute('data-bs-backdrop');
            if (backdropAttr === 'static') return; // Ne pas fermer si backdrop=static
            
            closeModal(event.target, config);
        });
        
        if (config.debugMode) {
            console.log('Gestionnaires d\'événements initialisés');
        }
    }
    
    /**
     * Prépare le DOM d'une modale pour assurer son affichage correct
     */
    function prepareModalDOM(modal) {
        // S'assurer que le backdrop existe
        let backdrop = document.querySelector('.modal-backdrop');
        if (!backdrop) {
            backdrop = document.createElement('div');
            backdrop.className = 'modal-backdrop fade';
            document.body.appendChild(backdrop);
        }

        // Assurer que tous les selects dans la modale sont bien visibles
        const selects = modal.querySelectorAll('select');
        selects.forEach(select => {
            select.style.display = 'block';
            select.style.visibility = 'visible';
            select.style.opacity = '1';
        });
    }
    
    /**
     * Ouvre une modale de manière robuste
     */
    function openModal(modal, config) {
        // Récupérer ou créer une instance Bootstrap Modal
        let modalInstance;
        try {
            modalInstance = bootstrap.Modal.getInstance(modal);
            if (!modalInstance) {
                modalInstance = new bootstrap.Modal(modal, {
                    backdrop: true,
                    keyboard: true,
                    focus: config.focusOnShow
                });
            }
        } catch (error) {
            // Si Bootstrap n'est pas disponible ou ne fonctionne pas, utiliser notre propre implémentation
            if (config.debugMode) {
                console.warn('Erreur Bootstrap Modal, utilisation de l\'implémentation de secours:', error);
            }
            
            // Implémentation manuelle
            modal.style.display = 'block';
            document.body.classList.add('modal-open');
            
            // Créer ou réactiver le backdrop
            let backdrop = document.querySelector('.modal-backdrop');
            if (!backdrop) {
                backdrop = document.createElement('div');
                backdrop.className = 'modal-backdrop fade';
                document.body.appendChild(backdrop);
            }
            
            // Forcer le recalcul du DOM
            modal.offsetHeight;
            
            // Ajouter les classes d'animation
            modal.classList.add('show');
            backdrop.classList.add('show');
            
            // Mettre le focus sur le premier champ si nécessaire
            if (config.focusOnShow) {
                setTimeout(() => {
                    const firstInput = modal.querySelector('input, select, textarea');
                    if (firstInput) {
                        firstInput.focus();
                    }
                }, 150);
            }
            
            return;
        }
        
        // Si nous avons une instance Bootstrap, l'utiliser
        try {
            modalInstance.show();
            
            // Corriger les problèmes potentiels après l'affichage
            setTimeout(() => {
                if (!modal.classList.contains('show')) {
                    modal.classList.add('show');
                    modal.style.display = 'block';
                    
                    let backdrop = document.querySelector('.modal-backdrop');
                    if (!backdrop) {
                        backdrop = document.createElement('div');
                        backdrop.className = 'modal-backdrop fade show';
                        document.body.appendChild(backdrop);
                    } else if (!backdrop.classList.contains('show')) {
                        backdrop.classList.add('show');
                    }
                }
                
                // Mettre le focus sur le premier champ si nécessaire
                if (config.focusOnShow) {
                    const firstInput = modal.querySelector('input, select, textarea');
                    if (firstInput) {
                        firstInput.focus();
                    }
                }
            }, 150);
        } catch (error) {
            if (config.debugMode) {
                console.error('Erreur lors de l\'ouverture de la modale:', error);
            }
            
            // Fallback en cas d'erreur
            modal.style.display = 'block';
            modal.classList.add('show');
            document.body.classList.add('modal-open');
        }
    }
    
    /**
     * Ferme une modale de manière robuste
     */
    function closeModal(modal, config) {
        // Récupérer l'instance Bootstrap Modal
        let modalInstance;
        try {
            modalInstance = bootstrap.Modal.getInstance(modal);
        } catch (error) {
            // Si Bootstrap n'est pas disponible, utiliser notre propre implémentation
            if (config.debugMode) {
                console.warn('Erreur Bootstrap Modal pour la fermeture, utilisation de l\'implémentation de secours:', error);
            }
            
            // Implémentation manuelle
            modal.classList.remove('show');
            
            // Animation de fermeture
            setTimeout(() => {
                modal.style.display = 'none';
                
                // Vérifier s'il reste des modales ouvertes
                const openModals = document.querySelectorAll('.modal.show');
                if (openModals.length === 0) {
                    document.body.classList.remove('modal-open');
                    
                    // Supprimer le backdrop
                    const backdrop = document.querySelector('.modal-backdrop');
                    if (backdrop) {
                        backdrop.classList.remove('show');
                        setTimeout(() => {
                            if (backdrop.parentNode) {
                                backdrop.parentNode.removeChild(backdrop);
                            }
                        }, 150);
                    }
                }
            }, 150);
            
            return;
        }
        
        // Si nous avons une instance Bootstrap, l'utiliser
        if (modalInstance) {
            try {
                modalInstance.hide();
            } catch (error) {
                if (config.debugMode) {
                    console.error('Erreur lors de la fermeture de la modale:', error);
                }
                
                // Fallback en cas d'erreur
                modal.classList.remove('show');
                modal.style.display = 'none';
                
                // Vérifier s'il reste des modales ouvertes
                const openModals = document.querySelectorAll('.modal.show');
                if (openModals.length === 0) {
                    document.body.classList.remove('modal-open');
                    
                    // Supprimer le backdrop
                    const backdrop = document.querySelector('.modal-backdrop');
                    if (backdrop && backdrop.parentNode) {
                        backdrop.parentNode.removeChild(backdrop);
                    }
                }
            }
        } else {
            // Si pour une raison quelconque, nous n'avons pas d'instance, fermer manuellement
            modal.classList.remove('show');
            setTimeout(() => {
                modal.style.display = 'none';
                
                // Vérifier s'il reste des modales ouvertes
                const openModals = document.querySelectorAll('.modal.show');
                if (openModals.length === 0) {
                    document.body.classList.remove('modal-open');
                    
                    // Supprimer le backdrop
                    const backdrop = document.querySelector('.modal-backdrop');
                    if (backdrop && backdrop.parentNode) {
                        backdrop.parentNode.removeChild(backdrop);
                    }
                }
            }, 150);
        }
    }
    
    /**
     * Modifie le comportement natif de Bootstrap Modal pour éviter les problèmes connus
     */
    function patchBootstrapModal(needsFix) {
        if (!needsFix && !config.forceSafeMode) return;
        if (typeof bootstrap === 'undefined' || !bootstrap.Modal) {
            if (config.debugMode) {
                console.warn('Bootstrap Modal non disponible pour le patch');
            }
            return;
        }
        
        try {
            // Sauvegarder les méthodes originales
            const originalShow = bootstrap.Modal.prototype.show;
            const originalHide = bootstrap.Modal.prototype.hide;
            
            // Remplacer la méthode show
            bootstrap.Modal.prototype.show = function(...args) {
                try {
                    // Exécuter la méthode d'origine
                    originalShow.apply(this, args);
                    
                    // Vérifier si la modale est bien affichée
                    const modalElement = this._element;
                    setTimeout(() => {
                        if (modalElement && !modalElement.classList.contains('show')) {
                            modalElement.classList.add('show');
                            modalElement.style.display = 'block';
                            document.body.classList.add('modal-open');
                            
                            let backdrop = document.querySelector('.modal-backdrop');
                            if (!backdrop) {
                                backdrop = document.createElement('div');
                                backdrop.className = 'modal-backdrop fade show';
                                document.body.appendChild(backdrop);
                            } else if (!backdrop.classList.contains('show')) {
                                backdrop.classList.add('show');
                            }
                        }
                    }, 150);
                } catch (error) {
                    if (config.debugMode) {
                        console.error('Erreur lors du patch de show:', error);
                    }
                    
                    // En cas d'erreur, assurer que la modale s'affiche quand même
                    const modalElement = this._element;
                    if (modalElement) {
                        modalElement.classList.add('show');
                        modalElement.style.display = 'block';
                        document.body.classList.add('modal-open');
                    }
                }
            };
            
            // Remplacer la méthode hide
            bootstrap.Modal.prototype.hide = function(...args) {
                try {
                    // Exécuter la méthode d'origine
                    originalHide.apply(this, args);
                    
                    // Vérifier si la modale est bien cachée
                    const modalElement = this._element;
                    setTimeout(() => {
                        if (modalElement && modalElement.classList.contains('show')) {
                            modalElement.classList.remove('show');
                            modalElement.style.display = 'none';
                        }
                        
                        // Vérifier s'il reste des modales ouvertes
                        const openModals = document.querySelectorAll('.modal.show');
                        if (openModals.length === 0) {
                            document.body.classList.remove('modal-open');
                            
                            // Supprimer le backdrop si nécessaire
                            const backdrop = document.querySelector('.modal-backdrop');
                            if (backdrop && backdrop.parentNode) {
                                backdrop.parentNode.removeChild(backdrop);
                            }
                        }
                    }, 150);
                } catch (error) {
                    if (config.debugMode) {
                        console.error('Erreur lors du patch de hide:', error);
                    }
                    
                    // En cas d'erreur, assurer que la modale se ferme quand même
                    const modalElement = this._element;
                    if (modalElement) {
                        modalElement.classList.remove('show');
                        modalElement.style.display = 'none';
                        
                        // Vérifier s'il reste des modales ouvertes
                        const openModals = document.querySelectorAll('.modal.show');
                        if (openModals.length === 0) {
                            document.body.classList.remove('modal-open');
                            
                            // Supprimer le backdrop
                            const backdrop = document.querySelector('.modal-backdrop');
                            if (backdrop && backdrop.parentNode) {
                                backdrop.parentNode.removeChild(backdrop);
                            }
                        }
                    }
                }
            };
            
            if (config.debugMode) {
                console.log('Bootstrap Modal patché avec succès');
            }
        } catch (error) {
            if (config.debugMode) {
                console.error('Erreur lors du patch de Bootstrap Modal:', error);
            }
        }
    }
    
    // Corriger spécifiquement les modals d'inscription détectés
    const applyInscriptionModalFixes = function() {
        const inscriptionModals = document.querySelectorAll('[id^="inscriptionModal"], [id^="participantsModal"], [id^="listeAttenteModal"], [id^="editSalleModal"]');
        
        inscriptionModals.forEach(modal => {
            // Assurer que les contrôles de formulaire sont bien visibles
            const selects = modal.querySelectorAll('select');
            selects.forEach(select => {
                select.style.display = 'block';
                select.style.visibility = 'visible';
                select.style.opacity = '1';
                select.style.zIndex = '2000';
                select.style.position = 'relative';
            });
            
            // Assurer que la modale est bien préparée pour l'affichage
            modal.setAttribute('tabindex', '-1');
            if (!modal.getAttribute('aria-hidden')) {
                modal.setAttribute('aria-hidden', 'true');
            }
            
            // Préparer pour une meilleure accessibilité
            const modalTitle = modal.querySelector('.modal-title');
            if (modalTitle && !modal.getAttribute('aria-labelledby')) {
                const titleId = modalTitle.id || `modal-title-${Math.random().toString(36).substr(2, 9)}`;
                modalTitle.id = titleId;
                modal.setAttribute('aria-labelledby', titleId);
            }
        });
        
        if (config.debugMode) {
            console.log(`${inscriptionModals.length} modales d'inscription corrigées`);
        }
    };
    
    // Appliquer les correctifs spécifiques aux modales d'inscription
    setTimeout(applyInscriptionModalFixes, 1000);
    
    // Surveiller les changements dans le DOM pour appliquer les correctifs aux nouvelles modales
    if (MutationObserver) {
        const observer = new MutationObserver(function(mutations) {
            mutations.forEach(function(mutation) {
                if (mutation.addedNodes && mutation.addedNodes.length > 0) {
                    for (let i = 0; i < mutation.addedNodes.length; i++) {
                        const node = mutation.addedNodes[i];
                        if (node.nodeType === 1 && node.classList && node.classList.contains('modal')) {
                            prepareModalDOM(node);
                            if (config.debugMode) {
                                console.log('Nouvelle modale détectée et préparée:', node);
                            }
                        }
                    }
                }
            });
        });
        
        observer.observe(document.body, {
            childList: true,
            subtree: true
        });
        
        if (config.debugMode) {
            console.log('Observation du DOM activée pour les nouvelles modales');
        }
    }
    
    console.log('Solution de modales initialisée avec succès!');
});