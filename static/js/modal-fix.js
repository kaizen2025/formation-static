/* 
 * modal-fix.js - Simple, robust fix for Bootstrap modals
 * Replace the complex modal-fix-ultimate.js with this simplified version
 */

document.addEventListener('DOMContentLoaded', function() {
    console.log('Simplified Modal Fix Initialized');
    
    // Apply fixes to all modals
    function applyModalFixes() {
        document.querySelectorAll('.modal').forEach(modal => {
            if (!modal) return;
            
            // Fix the modal's z-index
            modal.style.zIndex = '1055';
            
            // Fix <select> elements
            modal.querySelectorAll('select, .form-select').forEach(select => {
                select.style.cssText = 'display: block !important; visibility: visible !important; opacity: 1 !important; z-index: 2000 !important; position: relative !important; pointer-events: auto !important; -webkit-appearance: listbox !important; appearance: listbox !important;';
            });
            
            // Fix buttons
            modal.querySelectorAll('button, .btn').forEach(button => {
                button.style.cssText = 'position: relative !important; z-index: 2001 !important; pointer-events: auto !important;';
            });
            
            // Fix close buttons specifically
            modal.querySelectorAll('.btn-close').forEach(closeBtn => {
                closeBtn.style.cssText = 'position: relative !important; z-index: 2005 !important; pointer-events: auto !important;';
            });
            
            // Force recalculation of layout
            modal.offsetHeight;
        });
    }
    
    // Apply on DOMContentLoaded
    applyModalFixes();
    
    // Apply when modal is shown/hidden
    document.addEventListener('shown.bs.modal', function(e) {
        setTimeout(() => {
            if (e.target && !e.target.classList.contains('show')) {
                e.target.classList.add('show');
                e.target.style.display = 'block';
                
                // Check for backdrop
                if (!document.querySelector('.modal-backdrop')) {
                    const backdrop = document.createElement('div');
                    backdrop.className = 'modal-backdrop fade show';
                    document.body.appendChild(backdrop);
                }
            }
            applyModalFixes();
            
            // Focus on first form element
            const firstInput = e.target.querySelector('input, select, textarea');
            if (firstInput) {
                try {
                    firstInput.focus();
                } catch(e) {}
            }
        }, 50);
    });
    
    // Fix modal buttons
    document.addEventListener('click', function(e) {
        const modalToggle = e.target.closest('[data-bs-toggle="modal"]');
        if (modalToggle) {
            const targetSelector = modalToggle.getAttribute('data-bs-target') || modalToggle.getAttribute('href');
            const modalElement = document.querySelector(targetSelector);
            
            if (modalElement) {
                setTimeout(() => {
                    // Ensure modal is shown properly
                    if (!modalElement.classList.contains('show')) {
                        console.log('Force showing modal:', targetSelector);
                        modalElement.classList.add('show');
                        modalElement.style.display = 'block';
                        document.body.classList.add('modal-open');
                        
                        // Create backdrop if needed
                        if (!document.querySelector('.modal-backdrop')) {
                            const backdrop = document.createElement('div');
                            backdrop.className = 'modal-backdrop fade show';
                            document.body.appendChild(backdrop);
                        }
                    }
                    applyModalFixes();
                }, 150);
            }
        }
    });
    
    // Watch for new modals added to the DOM
    if (window.MutationObserver) {
        const observer = new MutationObserver(function(mutations) {
            let modalAdded = false;
            
            mutations.forEach(function(mutation) {
                if (mutation.addedNodes && mutation.addedNodes.length > 0) {
                    for (let i = 0; i < mutation.addedNodes.length; i++) {
                        const node = mutation.addedNodes[i];
                        if (node.nodeType === 1 && 
                            (node.classList && node.classList.contains('modal') || 
                             node.querySelector && node.querySelector('.modal'))) {
                            modalAdded = true;
                        }
                    }
                }
            });
            
            if (modalAdded) {
                setTimeout(applyModalFixes, 10);
            }
        });
        
        observer.observe(document.body, {
            childList: true,
            subtree: true
        });
    }
    
    console.log('Modal fix initialization complete');
});