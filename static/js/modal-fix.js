/*
 * modal-fix.js - Simple, robust fix for Bootstrap modals
 * v1.0.2 - Added dynamic content initialization (tooltips, badges) on shown.bs.modal
 */
document.addEventListener('DOMContentLoaded', function() {
    const DASH_CONFIG = window.dashboardConfig || { debugMode: false };
    if (DASH_CONFIG.debugMode) console.log('ModalFix: Initializing (v1.0.2)');

    function initializeModalDynamicContent(modalElement) {
        if (!modalElement) return;

        // Améliorer les badges de thème à l'intérieur de la modale affichée
        if (typeof window.enhanceThemeBadgesGlobally === 'function') {
            // Ciblez uniquement les badges à l'intérieur de CETTE modale
            // La fonction globale devrait être capable de gérer cela si elle itère sur tous les .theme-badge
            // ou vous pouvez passer modalElement à une version modifiée de enhanceThemeBadgesGlobally.
            // Pour l'instant, on suppose que l'appel global fonctionne.
            window.enhanceThemeBadgesGlobally(); 
        }

        // Initialiser/Réinitialiser les tooltips Bootstrap à l'intérieur de la modale
        if (typeof bootstrap !== 'undefined' && typeof bootstrap.Tooltip === 'function') {
            const tooltipTriggerList = [].slice.call(modalElement.querySelectorAll('[data-bs-toggle="tooltip"]'));
            tooltipTriggerList.forEach(function (tooltipTriggerEl) {
                const existingTooltip = bootstrap.Tooltip.getInstance(tooltipTriggerEl);
                if (existingTooltip) {
                    existingTooltip.dispose(); 
                }
                new bootstrap.Tooltip(tooltipTriggerEl);
            });
            if (DASH_CONFIG.debugMode && tooltipTriggerList.length > 0) {
                 console.log('ModalFix: Tooltips re-initialized in modal:', modalElement.id);
            }
        }
    }

    function applyModalStylingFixes(modalElement) {
        if (!modalElement) return;
        if (DASH_CONFIG.debugMode) console.log('ModalFix: Applying styling fixes to modal:', modalElement.id);

        modalElement.style.zIndex = '1055'; 

        modalElement.querySelectorAll('select, .form-select').forEach(select => {
            select.style.cssText = 'display: block !important; visibility: visible !important; opacity: 1 !important; z-index: 1056 !important; position: relative !important; pointer-events: auto !important; -webkit-appearance: listbox !important; appearance: listbox !important;';
        });

        modalElement.querySelectorAll('button:not(.btn-close), .btn:not(.btn-close), input[type="button"], input[type="submit"]').forEach(button => {
            button.style.position = 'relative';
            button.style.zIndex = '1057'; 
            button.style.pointerEvents = 'auto';
        });
        
        modalElement.querySelectorAll('.btn-close').forEach(closeBtn => {
            closeBtn.style.position = 'relative';
            closeBtn.style.zIndex = '1060';
            closeBtn.style.pointerEvents = 'auto';
        });

        const firstFocusable = modalElement.querySelector(
            'input:not([type="hidden"]):not(:disabled), select:not(:disabled), textarea:not(:disabled), button:not(:disabled):not(.btn-close), [href], [tabindex]:not([tabindex="-1"])'
        );
        if (firstFocusable && typeof firstFocusable.focus === 'function') {
            try {
                firstFocusable.focus({ preventScroll: true });
                if (DASH_CONFIG.debugMode) console.log('ModalFix: Focused on:', firstFocusable, 'in modal', modalElement.id);
            } catch (e) {
                if (DASH_CONFIG.debugMode) console.warn('ModalFix: Error focusing on element:', e, firstFocusable);
            }
        }
    }

    document.addEventListener('shown.bs.modal', function(event) {
        if (DASH_CONFIG.debugMode) console.log('ModalFix: shown.bs.modal triggered for', event.target.id);
        const modal = event.target;
        if (modal && modal.classList.contains('modal')) {
            setTimeout(() => { 
                if (!modal.classList.contains('show')) modal.classList.add('show');
                if (modal.style.display !== 'block' && modal.classList.contains('show')) modal.style.display = 'block';
                
                if (modal.classList.contains('show') && !document.querySelector('.modal-backdrop.show')) {
                    let backdrop = document.querySelector('.modal-backdrop');
                    if (!backdrop) {
                        backdrop = document.createElement('div');
                        backdrop.className = 'modal-backdrop fade'; 
                        document.body.appendChild(backdrop);
                        backdrop.offsetHeight; 
                    }
                    backdrop.classList.add('show');
                    document.body.classList.add('modal-open');
                }
                applyModalStylingFixes(modal);
                initializeModalDynamicContent(modal); // NOUVEL APPEL ICI
            }, 70); // Augmenter légèrement le délai si nécessaire
        }
    });

    // ... (le reste de modal-fix.js, comme le MutationObserver, peut rester si utile)
    if (window.MutationObserver) {
        const observer = new MutationObserver(function(mutations) {
            mutations.forEach(function(mutation) {
                if (mutation.addedNodes && mutation.addedNodes.length > 0) {
                    for (let i = 0; i < mutation.addedNodes.length; i++) {
                        const node = mutation.addedNodes[i];
                        if (node.nodeType === 1 && node.classList && node.classList.contains('modal')) {
                            // On se fie maintenant à 'shown.bs.modal' pour l'initialisation principale
                            if (DASH_CONFIG.debugMode) console.log('ModalFix: New modal added to DOM:', node.id);
                        }
                    }
                }
            });
        });
        observer.observe(document.body, { childList: true, subtree: true });
    }

    if (DASH_CONFIG.debugMode) console.log('ModalFix: Initialization complete (v1.0.2).');
});
