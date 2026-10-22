(function () {
    'use strict';

    if (window.__communityRatingLoaded) return;
    window.__communityRatingLoaded = true;

    const styleId = 'communityRatingStyles';
    const cache = new Map();
    const tooltipCache = new Map();
    let options = null;
    let isAdmin;
    let isAdminPromise;
    let refreshQueued = false;
    let scanning = false;
    let cacheRevision = 0;
    const customSortStates = new WeakMap();
    const sortModeIds = { views: 'CommunityRatingViews', likes: 'CommunityRatingLikes' };
    let originalGetItems = null;

    const styles = `
        .cr-badge-stack{display:flex;flex-direction:var(--cr-card-direction,row);align-items:flex-start;gap:4px;position:absolute;z-index:5;top:var(--cr-inset-y,8px);left:var(--cr-inset-x,8px);pointer-events:none}
        .cr-badge{align-items:center;display:inline-flex;gap:.25em;padding:.12em .4em;border-radius:999px;background:rgba(0,0,0,var(--cr-bg-opacity,.45));color:#fff;font-size:var(--cr-size,16px);font-weight:600;line-height:1.3;text-shadow:0 1px 2px rgba(0,0,0,.8);white-space:nowrap;pointer-events:auto;cursor:default}
        .cr-badge svg{width:1em;height:1em;flex:none;fill:currentColor}
        .cr-badge:focus-visible{outline:2px solid var(--accent-color,#00a4dc);outline-offset:2px}
        .cr-details-stack{display:flex;flex-wrap:wrap;align-items:center;gap:.45em;margin:.25em 0}
        .cr-tooltip{position:fixed;z-index:99999;max-width:min(320px,80vw);max-height:40vh;overflow:auto;padding:.65em .85em;border:1px solid var(--card-bracket-color,rgba(255,255,255,.16));border-radius:.55em;background:var(--card-background-color,rgba(25,25,25,.96));color:var(--primary-text-color,#fff);box-shadow:0 8px 24px rgba(0,0,0,.35);font-size:.9rem;line-height:1.5;white-space:pre-line;pointer-events:none}
        .cr-tooltip[hidden]{display:none}
    `;

    const eyeIcon = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5c-5.5 0-9.7 4.1-11 7 1.3 2.9 5.5 7 11 7s9.7-4.1 11-7c-1.3-2.9-5.5-7-11-7Zm0 12a5 5 0 1 1 0-10 5 5 0 0 1 0 10Zm0-2.2a2.8 2.8 0 1 0 0-5.6 2.8 2.8 0 0 0 0 5.6Z"/></svg>';
    const heartIcon = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 21s-8.5-5.1-10.5-10C-1 4.9 6.5 1 12 7c5.5-6 13-2.1 10.5 4C20.5 15.9 12 21 12 21Z"/></svg>';

    function apiUrl(path, ids) {
        const base = ApiClient.getUrl('CommunityRating/' + path);
        return base + (base.includes('?') ? '&' : '?') + 'ids=' + ids.map(encodeURIComponent).join('&ids=');
    }

    function querySignature(query) {
        return JSON.stringify(Object.keys(query)
            .filter(key => !['StartIndex', 'Limit', 'SortBy', 'SortOrder'].includes(key))
            .sort()
            .map(key => [key, query[key]]));
    }

    async function getCommunityCounts(items) {
        const counts = new Map();
        for (let start = 0; start < items.length; start += 100) {
            const ids = items.slice(start, start + 100).map(item => item.Id);
            const response = await ApiClient.getJSON(apiUrl('Items', ids));
            for (const item of response.Items || []) counts.set(item.ItemId.toLowerCase(), item);
        }
        return counts;
    }

    function orderCommunityItems(state, sortOrder) {
        const key = state.mode === 'views' ? 'ViewCount' : 'LikeCount';
        const direction = sortOrder === 'Ascending' ? 1 : -1;
        state.sortedItems = [...state.items].sort((left, right) => {
            const leftCount = state.counts.get(left.Id.toLowerCase())?.[key] || 0;
            const rightCount = state.counts.get(right.Id.toLowerCase())?.[key] || 0;
            const countOrder = (leftCount - rightCount) * direction;
            if (countOrder !== 0) return countOrder;
            return (left.SortName || left.Name || '').localeCompare(right.SortName || right.Name || '', undefined, { sensitivity: 'base' });
        });
    }

    async function prepareCommunitySort(query, state) {
        const signature = querySignature(query);
        if (state.signature === signature && state.revision === cacheRevision && state.sortedItems) return;
        if (state.pending) return state.pending;

        const request = {
            ...query,
            SortBy: state.backendSortBy,
            SortOrder: 'Ascending',
            StartIndex: 0,
            Limit: 500,
            EnableTotalRecordCount: true
        };
        const revision = cacheRevision;
        state.pending = (async () => {
            const allItems = [];
            let total = 0;
            do {
                const result = await originalGetItems.call(ApiClient, ApiClient.getCurrentUserId(), request);
                const page = result.Items || [];
                if (page.length === 0) break;
                allItems.push(...page);
                total = result.TotalRecordCount || allItems.length;
                request.StartIndex = allItems.length;
            } while (allItems.length < total);

            state.items = allItems;
            state.totalCount = total;
            state.counts = await getCommunityCounts(allItems);
            state.signature = signature;
            state.revision = revision;
            orderCommunityItems(state, query.SortOrder);
        })().finally(() => { state.pending = null; });
        return state.pending;
    }

    function installCommunitySortSupport() {
        const libraryBrowser = window.LibraryBrowser;
        if (!libraryBrowser || libraryBrowser.__communityRatingSortInstalled || !ApiClient.getItems) return;
        libraryBrowser.__communityRatingSortInstalled = true;
        originalGetItems = ApiClient.getItems;

        ApiClient.getItems = function (userId, query) {
            const state = query && customSortStates.get(query);
            if (!state) return originalGetItems.call(this, userId, query);
            return prepareCommunitySort(query, state).then(() => {
                const start = Math.max(0, query.StartIndex || 0);
                const limit = query.Limit > 0 ? query.Limit : state.totalCount;
                return {
                    Items: state.sortedItems.slice(start, start + limit),
                    TotalRecordCount: state.totalCount,
                    StartIndex: start
                };
            });
        };

        const originalShowSortMenu = libraryBrowser.showSortMenu;
        libraryBrowser.showSortMenu = function (menuOptions) {
            if (!menuOptions?.query || !Array.isArray(menuOptions.items)) {
                return originalShowSortMenu.apply(this, arguments);
            }

            const query = menuOptions.query;
            const itemTypes = String(query.IncludeItemTypes || '').split(',').filter(Boolean);
            if (itemTypes.length && !itemTypes.some(type => ['Movie', 'Series', 'Episode'].includes(type))) {
                return originalShowSortMenu.apply(this, arguments);
            }
            let state = customSortStates.get(query);
            const backendSortBy = state?.backendSortBy || query.SortBy || 'SortName';
            if (!menuOptions.items.some(item => item.id === sortModeIds.views)) {
                menuOptions.items.push({ name: 'Vus par les membres', id: sortModeIds.views });
                menuOptions.items.push({ name: 'Aimés par les membres', id: sortModeIds.likes });
            }

            if (state) {
                query.SortBy = sortModeIds[state.mode];
                const selectionObserver = new MutationObserver(() => {
                    const selectedOption = document.querySelector(`input.menuSortBy[value="${sortModeIds[state.mode]}"]`);
                    if (selectedOption) {
                        query.SortBy = state.backendSortBy;
                        selectionObserver.disconnect();
                    }
                });
                selectionObserver.observe(document.body, { childList: true, subtree: true });
            }

            const callback = menuOptions.callback;
            menuOptions.callback = function () {
                const selectedMode = query.SortBy === sortModeIds.views ? 'views'
                    : query.SortBy === sortModeIds.likes ? 'likes'
                        : null;
                state = customSortStates.get(query);

                if (selectedMode) {
                    const isNewMode = !state || state.mode !== selectedMode;
                    state = state || { backendSortBy, items: [], counts: new Map(), signature: null, pending: null, totalCount: 0 };
                    state.mode = selectedMode;
                    state.backendSortBy = backendSortBy;
                    customSortStates.set(query, state);
                    query.SortBy = state.backendSortBy;
                    query.StartIndex = 0;
                    if (isNewMode) {
                        query.SortOrder = 'Descending';
                        const descending = document.querySelector('.formDialog .menuSortOrder[value="Descending"]');
                        const ascending = document.querySelector('.formDialog .menuSortOrder[value="Ascending"]');
                        if (descending) descending.checked = true;
                        if (ascending) ascending.checked = false;
                    }
                    prepareCommunitySort(query, state)
                        .then(() => {
                            orderCommunityItems(state, query.SortOrder);
                            callback?.call(this);
                        })
                        .catch(error => {
                            customSortStates.delete(query);
                            query.SortBy = backendSortBy;
                            console.warn('Could not sort this list by member activity.', error);
                            callback?.call(this);
                        });
                    return;
                }

                if (state && query.SortBy === state.backendSortBy) {
                    orderCommunityItems(state, query.SortOrder);
                    query.StartIndex = 0;
                    callback?.call(this);
                    return;
                }

                if (state) customSortStates.delete(query);
                callback?.call(this);
            };
            return originalShowSortMenu.apply(this, arguments);
        };
    }

    function currentUserIsAdmin() {
        if (isAdmin !== undefined) return Promise.resolve(isAdmin);
        if (!isAdminPromise) {
            isAdminPromise = ApiClient.getCurrentUser()
                .then(user => { isAdmin = user?.Policy?.IsAdministrator === true; return isAdmin; })
                .catch(() => { isAdmin = false; return false; });
        }
        return isAdminPromise;
    }

    function ensureStyle() {
        if (document.getElementById(styleId)) return;
        const node = document.createElement('style');
        node.id = styleId;
        node.textContent = styles;
        document.head.appendChild(node);
    }

    function itemIdFromDetails() {
        const hashQuery = location.hash.includes('?') ? location.hash.slice(location.hash.indexOf('?') + 1) : '';
        const hashId = new URLSearchParams(hashQuery).get('id');
        return hashId || new URLSearchParams(location.search).get('id');
    }

    function getDetailsPage() {
        return document.querySelector('.itemDetailPage');
    }

    function collectCards() {
        return Array.from(document.querySelectorAll('.card[data-id]'))
            .map(card => ({ id: card.getAttribute('data-id'), element: card }))
            .filter(entry => {
                if (!entry.id) return false;
                const rect = entry.element.getBoundingClientRect();
                return rect.bottom >= -200 && rect.top <= window.innerHeight + 200;
            });
    }

    function collectTargets() {
        const entries = collectCards();
        const detailPage = getDetailsPage();
        const detailId = detailPage && itemIdFromDetails();
        if (detailId) entries.push({ id: detailId, element: detailPage, detail: true });
        return entries;
    }

    function queueScan() {
        if (refreshQueued) return;
        refreshQueued = true;
        window.setTimeout(() => {
            refreshQueued = false;
            scan();
        }, 120);
    }

    async function scan() {
        if (scanning) return;
        installCommunitySortSupport();
        ensureStyle();
        const targets = collectTargets();
        if (!targets.length) return;
        scanning = true;
        try {
            const ids = [...new Set(targets.map(entry => entry.id))]
                .filter(id => !cache.has(id.toLowerCase()));
            for (let index = 0; index < ids.length; index += 100) {
                const response = await ApiClient.getJSON(apiUrl('Items', ids.slice(index, index + 100)));
                options = response.Options;
                applyOptions();
                if (!options || !options.Enabled) {
                    document.querySelectorAll('.cr-badge-stack,.cr-details-stack').forEach(element => element.remove());
                    return;
                }
                response.Items.forEach(item => cache.set(item.ItemId.toLowerCase(), item));
                ids.slice(index, index + 100).forEach(id => {
                    if (!cache.has(id.toLowerCase())) cache.set(id.toLowerCase(), null);
                });
            }
            if (!options || !options.Enabled) return;
            if (options.AdminTooltipsEnabled) await currentUserIsAdmin();
            for (const target of targets) {
                const item = cache.get(target.id.toLowerCase());
                if (item) render(target, item);
            }
        } catch (error) {
            console.debug('Community Rating counters are temporarily unavailable.', error);
        } finally {
            scanning = false;
        }
    }

    function applyOptions() {
        if (!options) return;
        document.documentElement.style.setProperty('--cr-size', `${options.BadgeScale}px`);
        document.documentElement.style.setProperty('--cr-inset-x', `${options.BadgeInsetX}px`);
        document.documentElement.style.setProperty('--cr-inset-y', `${options.BadgeInsetY}px`);
        document.documentElement.style.setProperty('--cr-bg-opacity', String(options.BackgroundOpacity / 100));
        document.documentElement.style.setProperty('--cr-card-direction', options.StackCardBadges === true ? 'column' : 'row');
    }

    function makeBadge(kind, count, itemId, namesKey) {
        const row = document.createElement('span');
        row.className = 'cr-badge';
        row.tabIndex = options && options.AdminTooltipsEnabled && isAdmin === true ? 0 : -1;
        row.dataset.crItemId = itemId;
        row.dataset.crNamesKey = namesKey;
        row.setAttribute('aria-label', `${kind === 'view' ? 'Vues' : 'Favoris'} : ${count}`);
        row.innerHTML = `${kind === 'view' ? eyeIcon : heartIcon}<span>${count}</span>`;
        if (row.tabIndex === 0) {
            row.addEventListener('mouseenter', showTooltip);
            row.addEventListener('focus', showTooltip);
            row.addEventListener('mouseleave', hideTooltip);
            row.addEventListener('blur', hideTooltip);
        }
        return row;
    }

    function render(target, item) {
        const host = target.detail
            ? (target.element.querySelector('.itemMiscInfo') || target.element.querySelector('.detailPagePrimaryContainer') || target.element)
            : (target.element.querySelector('.cardScalable') || target.element.querySelector('.cardImageContainer') || target.element);
        const existing = target.element.querySelector(target.detail ? '.cr-details-stack' : '.cr-badge-stack');
        const signature = JSON.stringify([item.ItemId, item.ViewCount, item.LikeCount, options.AdminTooltipsEnabled, isAdmin]);
        if (existing?.dataset.crSignature === signature) return;
        if (existing) existing.remove();

        const stack = document.createElement('div');
        stack.className = target.detail ? 'cr-details-stack' : 'cr-badge-stack';
        stack.dataset.crSignature = signature;
        if (!target.detail) {
            if (getComputedStyle(host).position === 'static') host.style.position = 'relative';
        }
        stack.appendChild(makeBadge('view', item.ViewCount, item.ItemId, 'ViewedBy'));
        if (target.detail || item.LikeCount > 0) stack.appendChild(makeBadge('like', item.LikeCount, item.ItemId, 'LikedBy'));

        if (target.detail) {
            const ratingBlock = target.element.querySelector('.itemMiscInfo');
            if (ratingBlock && ratingBlock.parentElement) ratingBlock.insertAdjacentElement('afterend', stack);
            else host.appendChild(stack);
        } else {
            host.appendChild(stack);
        }
    }

    let tooltipElement;
    let tooltipRequest = 0;
    function getTooltip() {
        if (tooltipElement) return tooltipElement;
        tooltipElement = document.createElement('div');
        tooltipElement.className = 'cr-tooltip';
        tooltipElement.hidden = true;
        tooltipElement.setAttribute('role', 'tooltip');
        document.body.appendChild(tooltipElement);
        return tooltipElement;
    }

    async function showTooltip(event) {
        const badge = event.currentTarget;
        const request = ++tooltipRequest;
        if (!options || !options.AdminTooltipsEnabled || !await currentUserIsAdmin()) return;
        const itemId = badge.dataset.crItemId;
        const key = badge.dataset.crNamesKey;
        const cacheKey = itemId.toLowerCase();
        let names = tooltipCache.get(cacheKey);
        if (!names) {
            try {
                const result = await ApiClient.getJSON(apiUrl('Admin/Items', [itemId]));
                const entry = result.find(item => item.ItemId.toLowerCase() === cacheKey);
                names = entry ? { ViewedBy: entry.ViewedBy || [], LikedBy: entry.LikedBy || [] } : { ViewedBy: [], LikedBy: [] };
                tooltipCache.set(cacheKey, names);
            } catch (_) {
                return;
            }
        }
        if (request !== tooltipRequest || !badge.isConnected) return;
        const people = names[key] || [];
        const tip = getTooltip();
        tip.textContent = people.length ? people.join('\n') : 'Aucun compte';
        tip.hidden = false;
        const rect = badge.getBoundingClientRect();
        tip.style.left = `${Math.min(rect.left, window.innerWidth - tip.offsetWidth - 8)}px`;
        tip.style.top = `${Math.min(rect.bottom + 6, window.innerHeight - tip.offsetHeight - 8)}px`;
    }

    function hideTooltip() {
        tooltipRequest++;
        if (tooltipElement) tooltipElement.hidden = true;
    }

    function invalidateCounts() {
        cacheRevision++;
        cache.clear();
        tooltipCache.clear();
        hideTooltip();
    }

    ensureStyle();
    const observer = new MutationObserver(queueScan);
    observer.observe(document.documentElement, { childList: true, subtree: true });
    window.addEventListener('hashchange', queueScan);
    window.addEventListener('popstate', queueScan);
    window.addEventListener('scroll', queueScan, { passive: true });
    document.addEventListener('click', event => {
        if (event.target.closest('.buttonUserData,.btnUserData,.itemAction,.cardOverlayButton')) {
            window.setTimeout(() => {
                invalidateCounts();
                queueScan();
            }, 700);
        }
    }, true);
    scan();
    window.setInterval(() => {
        installCommunitySortSupport();
        invalidateCounts();
        scan();
    }, 30000);
})();
