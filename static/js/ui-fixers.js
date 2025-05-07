// static/js/ui-fixers.js
// Version 1.0.2 - Refined selectors, improved logging, badge consistency.
document.addEventListener('DOMContentLoaded', function() {
    const DASH_CONFIG = window.dashboardConfig || { debugMode: false };
    if (DASH_CONFIG.debugMode) console.log('UI Fixers initialized (v1.0.2)');

    const internalConfig = {
        enhanceLabels: true, fixTooltips: true, fixSessionInfo: true,
        fixSalleDisplay: true, enhanceAccessibility: true,
    };

    // Debounce applyAllFixes to avoid rapid calls from MutationObserver
    let applyFixesTimeout;
    function debouncedApplyAllFixes() {
        clearTimeout(applyFixesTimeout);
        applyFixesTimeout = setTimeout(applyAllFixes, 150); // 150ms debounce
    }

    // Initial application of fixes
    setTimeout(applyAllFixes, 500); // Initial delay after DOM content loaded

    // Re-apply fixes after fetch calls to /api/ (if they modify relevant DOM)
    const originalFetch = window.fetch;
    window.fetch = async function(...args) {
        const response = await originalFetch.apply(this, args);
        try {
            const url = (args[0] instanceof Request) ? args[0].url : args[0].toString();
            if (url.includes('/api/')) {
                // If the response is OK and JSON, assume data might have changed the DOM
                if (response.ok && response.headers.get('content-type')?.includes('application/json')) {
                    response.clone().json().then(() => { // Clone to read body without consuming original
                        if (DASH_CONFIG.debugMode) console.log('UI Fixers: API call detected, queueing fixes for URL:', url);
                        debouncedApplyAllFixes();
                    }).catch(() => { /* Ignore if not JSON */ });
                }
            }
        } catch (e) {
            if (DASH_CONFIG.debugMode) console.warn('UI Fixers: Error in fetch wrapper', e);
        }
        return response;
    };

    function applyAllFixes() {
        if (DASH_CONFIG.debugMode) console.log('UI Fixers: Applying all fixes...');
        if (internalConfig.enhanceLabels) enhanceLabels();
        if (internalConfig.fixTooltips) fixTooltips(); // Tooltips should be re-init after DOM changes
        if (internalConfig.fixSessionInfo) fixSessionInfo();
        if (internalConfig.fixSalleDisplay) fixSalleDisplay();
        if (internalConfig.enhanceAccessibility) enhanceAccessibility();
        // Call global theme badge enhancer from layout.html as it's the source of truth for theme badges
        if (typeof window.enhanceThemeBadgesGlobally === 'function') {
            window.enhanceThemeBadgesGlobally();
        }
        if (DASH_CONFIG.debugMode) console.log('UI Fixers: All fixes applied cycle finished.');
    }

    function enhanceLabels() {
        // Example: Add icons to buttons/links if they are missing
        document.querySelectorAll('a.btn, button.btn').forEach(el => {
            const text = el.textContent.trim();
            if ((text.includes('Voir Participants') || text.includes('Liste des participants')) && !el.querySelector('i.fa-users')) {
                el.innerHTML = `<i class="fas fa-users me-1"></i>${text || 'Participants'}`;
            } else if (text.includes('Gérer Salle') && !el.querySelector('i.fa-building')) {
                el.innerHTML = `<i class="fas fa-building me-1"></i>${text || 'Gérer Salle'}`;
            }
        });
        // Card headers - these are often set by Jinja, but can be a fallback
        document.querySelectorAll('.card-header h5, .card-header h6, .card-header .card-title').forEach(el => {
            const text = el.textContent.trim();
            if (text.includes('Sessions à venir') && !el.querySelector('i.fa-calendar-alt, i.fa-calendar-check')) {
                el.innerHTML = `<i class="fas fa-calendar-check me-2"></i>${text}`;
            } else if (text.includes('Participants par service') && !el.querySelector('i.fa-users, i.fa-chart-bar')) {
                el.innerHTML = `<i class="fas fa-chart-bar me-2"></i>${text}`;
            } else if (text.includes('Répartition par thème') && !el.querySelector('i.fa-book, i.fa-chart-pie')) {
                el.innerHTML = `<i class="fas fa-chart-pie me-2"></i>${text}`;
            }
        });
    }

    function fixTooltips() {
        if (typeof bootstrap !== 'undefined' && typeof bootstrap.Tooltip === 'function') {
            // Dispose of existing tooltips on elements that might be re-initialized
            // document.querySelectorAll('[data-bs-toggle="tooltip"], [title]:not(iframe)').forEach(el => {
            //     const instance = bootstrap.Tooltip.getInstance(el);
            //     if (instance) {
            //         instance.dispose();
            //     }
            // });

            // Initialize new tooltips
            const tooltipTriggerList = [].slice.call(document.querySelectorAll('[data-bs-toggle="tooltip"], [title]:not(iframe):not(script):not(style)'));
            tooltipTriggerList.forEach(el => {
                 if (!bootstrap.Tooltip.getInstance(el)) {
                    try {
                        new bootstrap.Tooltip(el, {
                            container: 'body', // Important for elements in tables or complex layouts
                            boundary: document.body,
                            trigger: 'hover focus' // More accessible triggers
                        });
                    } catch (e) { console.warn('UI Fixers: Error creating tooltip', e, el); }
                }
            });

            // Add titles to specific elements if they don't have one
            document.querySelectorAll('.salle-badge, .places-dispo, .theme-badge').forEach(el => {
                if (!el.hasAttribute('title') && !el.dataset.bsOriginalTitle) {
                    let titleText = '';
                    if (el.classList.contains('salle-badge')) titleText = el.textContent.trim() === 'Non définie' ? 'Aucune salle assignée' : `Salle : ${el.textContent.trim()}`;
                    else if (el.classList.contains('places-dispo')) titleText = 'Places disponibles / Capacité totale';
                    else if (el.classList.contains('theme-badge')) titleText = `Thème : ${el.textContent.trim()}`;

                    if (titleText) {
                        el.setAttribute('title', titleText);
                        el.setAttribute('data-bs-toggle', 'tooltip'); // Ensure it's picked up
                        if (!bootstrap.Tooltip.getInstance(el)) {
                           try { new bootstrap.Tooltip(el, { container: 'body' }); }
                           catch (e) { console.warn('UI Fixers: Error creating tooltip for dynamic element', e, el); }
                        }
                    }
                }
            });
        }
    }

    function fixSessionInfo() {
        // Date cell formatting
        document.querySelectorAll('table td:first-child').forEach(dateCell => {
            // Check if it looks like a date cell (e.g., contains day name or /) and isn't already bolded
            if (dateCell.innerHTML.match(/\b(lundi|mardi|mercredi|jeudi|vendredi|samedi|dimanche)\b/i) || dateCell.innerHTML.includes('/')) {
                if (!dateCell.querySelector('strong')) {
                    const parts = dateCell.innerHTML.split('<br>');
                    if (parts.length > 0) {
                        dateCell.innerHTML = `<strong>${parts[0]}</strong>${parts.length > 1 ? `<br><small class="text-secondary">${parts[1]}</small>` : ''}`;
                    }
                }
            }
        });

        // Places disponibles formatting
        document.querySelectorAll('.places-dispo').forEach(el => {
            const text = el.textContent.trim();
            if (text.includes('/')) {
                const [dispoStr, totalStr] = text.split('/');
                const dispo = parseInt(dispoStr.trim(), 10);
                const total = parseInt(totalStr.trim(), 10);

                if (!isNaN(dispo) && !isNaN(total) && total > 0) {
                    let colorClass = 'text-success';
                    let iconClass = 'fa-check-circle';

                    if (dispo === 0) {
                        colorClass = 'text-danger';
                        iconClass = 'fa-times-circle';
                    } else if (dispo <= total * 0.2) { // Less than or equal to 20%
                        colorClass = 'text-danger';
                        iconClass = 'fa-exclamation-circle';
                    } else if (dispo <= total * 0.4) { // Less than or equal to 40%
                        colorClass = 'text-warning';
                        iconClass = 'fa-exclamation-triangle';
                    }

                    el.classList.remove('text-success', 'text-warning', 'text-danger', 'text-secondary');
                    el.classList.add(colorClass);

                    // Update icon and text content if not already done or if values changed
                    const existingIcon = el.querySelector('i.fas');
                    if (!existingIcon || !existingIcon.classList.contains(iconClass)) {
                        el.innerHTML = `<i class="fas ${iconClass} me-1"></i> ${dispo} / ${total}`;
                    } else {
                        // Only update text if icon is correct but numbers might have changed
                        el.innerHTML = `<i class="fas ${iconClass} me-1"></i> ${dispo} / ${total}`;
                    }
                } else if (!isNaN(dispo) && !isNaN(total) && total === 0) { // Case where max_participants is 0
                     el.classList.remove('text-success', 'text-warning', 'text-danger', 'text-secondary');
                     el.classList.add('text-secondary');
                     el.innerHTML = `<i class="fas fa-minus-circle me-1"></i> ${dispo} / ${total}`;
                }
            }
        });
    }

    function fixSalleDisplay() {
        // Targets cells specifically marked for salle display
        document.querySelectorAll('.js-salle-cell').forEach(el => {
            const salleText = el.textContent.trim();
            if (!el.querySelector('.salle-badge')) { // Only modify if not already a badge
                if (!salleText || salleText.toLowerCase() === 'non définie' || salleText.toLowerCase() === 'n/a') {
                    el.innerHTML = '<span class="badge bg-secondary text-white salle-badge" data-bs-toggle="tooltip" title="Aucune salle assignée">Non définie</span>';
                } else {
                    const salleName = salleText.replace(/^Salle\s*/i, '').trim();
                    el.innerHTML = `<span class="badge bg-info text-white salle-badge" data-bs-toggle="tooltip" title="Salle: ${salleName}">${salleName}</span>`;
                }
            }
        });
        // Fallback for less specific table cells (usually 4th column)
        document.querySelectorAll('table td:nth-child(4)').forEach(cell => {
            if (cell.classList.contains('js-salle-cell') || cell.querySelector('.salle-badge')) return; // Skip if already handled

            const text = cell.textContent.trim();
            // Heuristic: if it's likely a room name or placeholder
            if ((text.match(/^[A-Za-z0-9\s-]+$/) && text.length > 1 && text.length < 30 && !text.includes('/')) || text.toLowerCase() === 'non définie' || text.toLowerCase() === 'n/a') {
                 if (!text || text.toLowerCase() === 'non définie' || text.toLowerCase() === 'n/a') {
                    cell.innerHTML = '<span class="badge bg-secondary text-white salle-badge" data-bs-toggle="tooltip" title="Aucune salle assignée">Non définie</span>';
                } else {
                    cell.innerHTML = `<span class="badge bg-info text-white salle-badge" data-bs-toggle="tooltip" title="Salle: ${text}">${text}</span>`;
                }
            }
        });
    }

    function enhanceAccessibility() {
        // Add aria-labels to icon-only buttons or buttons where text might be insufficient
        document.querySelectorAll('button:not([aria-label]), a.btn:not([aria-label])').forEach(el => {
            let ariaLabel = el.getAttribute('title'); // Prefer existing title
            if (!ariaLabel) {
                const icon = el.querySelector('i.fas, i.fab, i.far');
                let textContent = el.textContent.trim();
                // Remove badge text from button text content for aria-label
                const badge = el.querySelector('.badge');
                if (badge) {
                    textContent = textContent.replace(badge.textContent.trim(), '').trim();
                }

                if (textContent) {
                    ariaLabel = textContent;
                } else if (icon) {
                    // Try to infer from icon class
                    if (icon.classList.contains('fa-user-plus')) ariaLabel = "S'inscrire";
                    else if (icon.classList.contains('fa-clock')) ariaLabel = "S'inscrire en liste d'attente";
                    else if (icon.classList.contains('fa-users')) ariaLabel = "Voir les participants";
                    else if (icon.classList.contains('fa-building')) ariaLabel = "Attribuer ou modifier la salle";
                    else if (icon.classList.contains('fa-edit')) ariaLabel = "Modifier";
                    else if (icon.classList.contains('fa-trash')) ariaLabel = "Supprimer";
                    else if (icon.classList.contains('fa-sync-alt')) ariaLabel = "Actualiser";
                }
            }
            if (ariaLabel && !el.hasAttribute('aria-label')) {
                el.setAttribute('aria-label', ariaLabel);
            }
        });

        // Replace text-muted with text-secondary for better contrast if needed (Bootstrap 5 often handles this well)
        // document.querySelectorAll('.text-muted').forEach(el => {
        //     el.classList.remove('text-muted');
        //     el.classList.add('text-secondary');
        // });

        // Add alt text to images if missing
        document.querySelectorAll('img:not([alt])').forEach(img => {
            const src = img.getAttribute('src') || '';
            let altText = 'Image descriptive';
            if (src) {
                const filename = src.split('/').pop().split('.')[0];
                altText = `Image: ${filename.replace(/[-_]/g, ' ')}`;
            }
            img.setAttribute('alt', altText);
        });
    }

    window.uiFixers = { applyAllFixes, enhanceLabels, fixTooltips, fixSessionInfo, fixSalleDisplay, enhanceAccessibility };

    if (window.MutationObserver) {
        const observer = new MutationObserver(mutations => {
            let needsFixing = false;
            for (const mutation of mutations) {
                if (mutation.type === 'childList' && mutation.addedNodes.length > 0) {
                    for (const node of mutation.addedNodes) {
                        if (node.nodeType === 1 && (
                            node.matches('table, tr, td, .badge, .card, [data-bs-toggle="tooltip"], .js-salle-cell, .js-theme-cell, .places-dispo') ||
                            node.querySelector('table, tr, td, .badge, .card, [data-bs-toggle="tooltip"], .js-salle-cell, .js-theme-cell, .places-dispo')
                        )) {
                            needsFixing = true;
                            break;
                        }
                    }
                }
                // Also check for attribute changes that might require tooltip re-init (e.g. title added)
                if (mutation.type === 'attributes' && mutation.attributeName === 'title') {
                    needsFixing = true;
                }
                if (needsFixing) break;
            }
            if (needsFixing) {
                if (DASH_CONFIG.debugMode) console.log('UI Fixers: Relevant DOM change detected, queueing reapplication of fixes.');
                debouncedApplyAllFixes();
            }
        });
        observer.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['title'] });
    }

    if (DASH_CONFIG.debugMode) console.log('UI Fixers ready! (v1.0.2)');
});
