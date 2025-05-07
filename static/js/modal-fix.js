/*
 * modal-fix.js - Simple, robust fix for Bootstrap modals
 * Replace the complex modal-fix-ultimate.js with this simplified version
 * v1.0.1 - Added debug logging, minor focus adjustment.
 */

document.addEventListener('DOMContentLoaded', function() {
    const DASH_CONFIG = window.dashboardConfig || { debugMode: false };
    if (DASH_CONFIG.debugMode) console.log('ModalFix: Simplified Modal Fix Initialized (v1.0.1)');

    function applyModalFixes(modalElement) {
        if (!modalElement) return;
        if (DASH_CONFIG.debugMode) console.log('ModalFix: Applying fixes to modal:', modalElement.id);

        modalElement.style.zIndex = '1055'; // Standard z-index for modals

        modalElement.querySelectorAll('select, .form-select').forEach(select => {
            select.style.cssText = 'display: block !important; visibility: visible !important; opacity: 1 !important; z-index: 1056 !important; position: relative !important; pointer-events: auto !important; -webkit-appearance: listbox !important; appearance: listbox !important;';
        });

        modalElement.querySelectorAll('button, .btn, input[type="button"], input[type="submit"]').forEach(button => {
             // Avoid overly aggressive styling on all buttons, focus on those that might be problematic
            if (!button.classList.contains('btn-close')) { // Don't mess with btn-close too much here
                button.style.position = 'relative !important';
                button.style.zIndex = '1057 !important'; // Ensure interactable elements are above selects
                button.style.pointerEvents = 'auto !important';
            }
        });

        modalElement.querySelectorAll('.btn-close').forEach(closeBtn => {
            closeBtn.style.position = 'relative !important'; // Keep relative for layout
            closeBtn.style.zIndex = '1060 !important'; // Ensure close button is on top
            closeBtn.style.pointerEvents = 'auto !important';
        });

        // Force reflow/repaint, can sometimes help with rendering glitches
        // Use with caution as it can be performance intensive if overused.
        // modalElement.offsetHeight;
    }

    // Apply when a modal is shown
    document.addEventListener('shown.bs.modal', function(event) {
        if (DASH_CONFIG.debugMode) console.log('ModalFix: shown.bs.modal triggered for', event.target.id);
        const modal = event.target;
        if (modal && modal.classList.contains('modal')) {
            setTimeout(() => { // Delay slightly to ensure modal is fully in DOM and styles applied
                // Ensure modal is displayed correctly (Bootstrap sometimes fails to add 'show' or set display)
                if (!modal.classList.contains('show')) {
                    modal.classList.add('show');
                }
                if (modal.style.display !== 'block' && modal.classList.contains('show')) {
                     modal.style.display = 'block'; // Force display if 'show' is present but not visible
                }
                
                // Ensure backdrop exists
                if (modal.classList.contains('show') && !document.querySelector('.modal-backdrop.show')) {
                    if (DASH_CONFIG.debugMode) console.log('ModalFix: Backdrop missing, attempting to create one for', modal.id);
                    let backdrop = document.querySelector('.modal-backdrop');
                    if (!backdrop) {
                        backdrop = document.createElement('div');
                        backdrop.className = 'modal-backdrop fade'; // Start with fade
                        document.body.appendChild(backdrop);
                        // Force reflow to apply 'fade' class before 'show'
                        backdrop.offsetHeight;
                    }
                    backdrop.classList.add('show');
                    document.body.classList.add('modal-open'); // Ensure body class is set
                }

                applyModalFixes(modal);

                // Auto-focus on the first focusable element in the modal
                // Exclude elements that are part of a toast or another modal nested (though nesting is bad)
                const firstFocusable = modal.querySelector(
                    'input:not([type="hidden"]):not(:disabled), select:not(:disabled), textarea:not(:disabled), button:not(:disabled), [href], [tabindex]:not([tabindex="-1"])'
                );
                if (firstFocusable && typeof firstFocusable.focus === 'function') {
                    try {
                        firstFocusable.focus({ preventScroll: true }); // preventScroll is a good addition
                         if (DASH_CONFIG.debugMode) console.log('ModalFix: Focused on:', firstFocusable);
                    } catch (e) {
                        if (DASH_CONFIG.debugMode) console.warn('ModalFix: Error focusing on element:', e, firstFocusable);
                    }
                }
            }, 50); // Small delay
        }
    });

    // Attempt to fix modals triggered by clicks if Bootstrap's own handlers are problematic
    document.addEventListener('click', function(e) {
        const modalToggle = e.target.closest('[data-bs-toggle="modal"]');
        if (modalToggle) {
            const targetSelector = modalToggle.getAttribute('data-bs-target') || modalToggle.getAttribute('href');
            if (targetSelector) {
                const modalElement = document.querySelector(targetSelector);
                if (modalElement) {
                    // This is a bit aggressive and might interfere with Bootstrap's own timing.
                    // Use primarily if modals are consistently failing to show.
                    // setTimeout(() => {
                    //     if (!modalElement.classList.contains('show')) {
                    //         if (DASH_CONFIG.debugMode) console.log('ModalFix: Click - Force showing modal:', targetSelector);
                    //         const modalInstance = bootstrap.Modal.getOrCreateInstance(modalElement);
                    //         modalInstance.show(); // Use Bootstrap's API to show
                    //     }
                    //     // applyModalFixes(modalElement); // 'shown.bs.modal' should handle this
                    // }, 100); // Delay to allow Bootstrap to attempt first
                }
            }
        }
    });

    // Watch for modals added to the DOM dynamically (e.g., via AJAX)
    if (window.MutationObserver) {
        const observer = new MutationObserver(function(mutations) {
            mutations.forEach(function(mutation) {
                if (mutation.addedNodes && mutation.addedNodes.length > 0) {
                    for (let i = 0; i < mutation.addedNodes.length; i++) {
                        const node = mutation.addedNodes[i];
                        if (node.nodeType === 1 && node.classList && node.classList.contains('modal')) {
                            if (DASH_CONFIG.debugMode) console.log('ModalFix: New modal added to DOM, applying fixes:', node.id);
                            // applyModalFixes(node); // Apply immediately or wait for 'shown.bs.modal'
                            // It's generally better to let 'shown.bs.modal' handle it for consistency.
                        }
                    }
                }
            });
        });

        observer.observe(document.body, {
            childList: true,
            subtree: true // Observe entire body for new modals
        });
    }

    if (DASH_CONFIG.debugMode) console.log('ModalFix: Initialization complete.');
});
