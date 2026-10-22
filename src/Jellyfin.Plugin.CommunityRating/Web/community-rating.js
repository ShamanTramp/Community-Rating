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
    const customSortStates = new Map();
    let lastSortContext = null;
    let pendingSortSelection = null;
    const sortModeIds = { views: 'CommunityRatingViews', likes: 'CommunityRatingLikes' };
    const translations = {
        en: {
            viewLabel: 'Viewed by members', likeLabel: 'Liked by members',
            sortViews: 'Viewed by members', sortLikes: 'Liked by members', noMembers: 'No members'
        },
        fr: {
            viewLabel: 'Vu par les membres', likeLabel: 'Aimé par les membres',
            sortViews: 'Vus par les membres', sortLikes: 'Aimés par les membres', noMembers: 'Aucun membre'
        }
    };

    function uiLanguage() {
        const locale = document.documentElement.lang || (typeof navigator !== 'undefined' && navigator.language) || 'en';
        return String(locale).toLowerCase().split(/[-_]/)[0];
    }

    function translate(key) {
        return translations[uiLanguage()]?.[key] ?? translations.en[key] ?? key;
    }

    const styles = `
        .cr-badge-stack{display:flex;flex-direction:var(--cr-card-direction,row);align-items:flex-start;gap:4px;position:absolute;z-index:5;top:var(--cr-inset-y,8px);left:var(--cr-inset-x,3px);pointer-events:none}
        .cr-badge{align-items:center;display:inline-flex;gap:.25em;padding:.12em .4em;border-radius:999px;background:rgba(0,0,0,var(--cr-bg-opacity,.45));color:#fff;font-size:var(--cr-size,16px);font-weight:600;line-height:1.3;text-shadow:0 1px 2px rgba(0,0,0,.8);white-space:nowrap;pointer-events:auto;cursor:default}
        .cr-badge svg{width:1em;height:1em;flex:none;fill:currentColor}
        .cr-badge:focus-visible{outline:2px solid var(--accent-color,#00a4dc);outline-offset:2px}
        .detailPagePrimaryContent.cr-details-top-host{padding-top:0}
        .cr-details-stack{display:flex;flex-wrap:wrap;align-items:flex-start;align-self:flex-start;justify-content:center;gap:.65em;order:-1;flex:0 0 auto;width:100%;max-width:100%;box-sizing:border-box;clear:none;margin:0 0 .5em}
        .cr-details-stack .cr-badge{font-size:var(--cr-detail-size,var(--cr-size,16px))}
        .cr-tooltip{position:fixed;z-index:99999;max-width:min(320px,80vw);max-height:40vh;overflow:auto;padding:.65em .85em;border:1px solid var(--card-bracket-color,rgba(255,255,255,.16));border-radius:.55em;background:var(--card-background-color,rgba(25,25,25,.96));color:var(--primary-text-color,#fff);box-shadow:0 8px 24px rgba(0,0,0,.35);font-size:.9rem;line-height:1.5;white-space:pre-line;pointer-events:none}
        .cr-tooltip[hidden]{display:none}
    `;

    const eyeIcon = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5c-5.5 0-9.7 4.1-11 7 1.3 2.9 5.5 7 11 7s9.7-4.1 11-7c-1.3-2.9-5.5-7-11-7Zm0 12a5 5 0 1 1 0-10 5 5 0 0 1 0 10Zm0-2.2a2.8 2.8 0 1 0 0-5.6 2.8 2.8 0 0 0 0 5.6Z"/></svg>';
    const heartIcon = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 21s-8.5-5.1-10.5-10C-1 4.9 6.5 1 12 7c5.5-6 13-2.1 10.5 4C20.5 15.9 12 21 12 21Z"/></svg>';

    function apiUrl(path, ids) {
        const base = ApiClient.getUrl('CommunityRating/' + path);
        return base + (base.includes('?') ? '&' : '?') + 'ids=' + ids.map(encodeURIComponent).join('&ids=');
    }

    function communitySortMode(sortBy) {
        const first = (Array.isArray(sortBy) ? sortBy.join(',') : String(sortBy || '')).split(',')[0];
        return first === sortModeIds.views ? 'views' : first === sortModeIds.likes ? 'likes' : null;
    }

    function querySignature(query) {
        return JSON.stringify(Object.keys(query)
            .filter(key => !['StartIndex', 'Limit', 'SortBy', 'SortOrder'].includes(key))
            .sort()
            .map(key => [key, query[key]]));
    }

    function supportedItemTypes(query) {
        const types = (Array.isArray(query?.IncludeItemTypes) ? query.IncludeItemTypes
            : String(query?.IncludeItemTypes || '').split(',')).filter(Boolean);
        return types.some(type => ['Movie', 'Series', 'Episode'].includes(type));
    }

    function supportedSortPage() {
        if (lastSortContext?.route === location.hash && supportedItemTypes(lastSortContext.query)) return true;
        const route = location.hash.split('?')[0];
        if (/^#\/(movies|tv|tvshows|shows)(?:\.html)?$/.test(route)) return true;
        const type = new URLSearchParams(location.hash.split('?')[1] || location.search).get('type');
        if (type) return ['Movie', 'Series', 'Episode', 'favoritemovies'].includes(type);
        return Array.from(document.querySelectorAll('.page:not(.hide) .card[data-type], .page:not(.hide) .listItem[data-type]'))
            .some(item => ['Movie', 'Series', 'Episode'].includes(item.getAttribute('data-type')));
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
        return [...state.items].sort((left, right) => {
            const leftCount = state.counts.get(left.Id.toLowerCase())?.[key] || 0;
            const rightCount = state.counts.get(right.Id.toLowerCase())?.[key] || 0;
            const countOrder = (leftCount - rightCount) * direction;
            if (countOrder !== 0) return countOrder;
            return (left.SortName || left.Name || '').localeCompare(right.SortName || right.Name || '', undefined, { sensitivity: 'base' });
        });
    }

    function prepareCommunitySort(query, state, userId, client, getItems) {
        if (state.pending) return state.pending;
        const request = {
            ...query,
            SortBy: 'SortName',
            SortOrder: 'Ascending',
            StartIndex: 0,
            Limit: 500,
            EnableTotalRecordCount: true
        };
        state.pending = (async () => {
            const allItems = [];
            let total = 0;
            do {
                const result = await getItems.call(client, userId, request);
                const page = result.Items || [];
                if (page.length === 0) break;
                allItems.push(...page);
                total = result.TotalRecordCount ?? allItems.length;
                request.StartIndex = allItems.length;
            } while (allItems.length < total);
            state.items = allItems;
            state.totalCount = allItems.length;
            state.counts = await getCommunityCounts(allItems);
        })();
        return state.pending;
    }

    function setDescending(dialog) {
        const select = dialog?.querySelector('.selectSortOrder');
        if (select) select.value = 'Descending';
        dialog?.querySelectorAll('.menuSortOrder').forEach(input => { input.checked = input.value === 'Descending'; });
    }

    function installCommunitySortSupport() {
        // Install independently of LibraryBrowser: generic lists use a different menu
        // and recreate their query object for every page.
        if (ApiClient.getItems && !ApiClient.getItems.__communityRatingSortInstalled) {
            const getItems = ApiClient.getItems;
            const wrapped = function (userId, query) {
                if (!query) return getItems.apply(this, arguments);
                const mode = communitySortMode(query.SortBy);
                if (supportedItemTypes(query) || mode) lastSortContext = { route: location.hash, query };
                if (!mode) return getItems.apply(this, arguments);
                if (pendingSortSelection?.route === location.hash && pendingSortSelection.mode === mode) {
                    query.SortOrder = 'Descending';
                    pendingSortSelection = null;
                }
                const snapshot = { ...query };
                const cacheKey = JSON.stringify([ApiClient.getUrl('Items'), userId, mode, querySignature(snapshot), cacheRevision]);
                let state = customSortStates.get(cacheKey);
                if (!state) {
                    state = { mode, items: [], counts: new Map(), totalCount: 0, pending: null };
                    if (customSortStates.size >= 8) customSortStates.delete(customSortStates.keys().next().value);
                    customSortStates.set(cacheKey, state);
                }
                return prepareCommunitySort(snapshot, state, userId, this, getItems).then(() => {
                    const start = Math.max(0, Number(snapshot.StartIndex) || 0);
                    const limit = snapshot.Limit > 0 ? Number(snapshot.Limit) : state.totalCount;
                    return {
                        Items: orderCommunityItems(state, snapshot.SortOrder).slice(start, start + limit),
                        TotalRecordCount: state.totalCount,
                        StartIndex: start
                    };
                }).catch(error => {
                    customSortStates.delete(cacheKey);
                    throw error;
                });
            };
            wrapped.__communityRatingSortInstalled = true;
            ApiClient.getItems = wrapped;
        }

        const libraryBrowser = window.LibraryBrowser;
        if (!libraryBrowser || libraryBrowser.__communityRatingSortInstalled || typeof libraryBrowser.showSortMenu !== 'function') return;
        const showSortMenu = libraryBrowser.showSortMenu;
        libraryBrowser.showSortMenu = function (menuOptions) {
            if (!menuOptions?.query || !Array.isArray(menuOptions.items)
                || (menuOptions.query.IncludeItemTypes ? !supportedItemTypes(menuOptions.query) : !supportedSortPage())) {
                return showSortMenu.apply(this, arguments);
            }
            const query = menuOptions.query;
            lastSortContext = { route: location.hash, query };
            for (const [mode, key] of [['views', 'sortViews'], ['likes', 'sortLikes']]) {
                const name = translate(key);
                const existing = menuOptions.items.find(item => item.id === sortModeIds[mode]);
                if (existing) existing.name = name;
                else {
                    menuOptions.items.push({ name, id: sortModeIds[mode] });
                }
            }
            let previousMode = communitySortMode(query.SortBy);
            const callback = menuOptions.callback;
            menuOptions.callback = function () {
                const mode = communitySortMode(query.SortBy);
                if (mode && mode !== previousMode) {
                    query.SortOrder = 'Descending';
                    setDescending(document.querySelector('.formDialog'));
                }
                previousMode = mode;
                return callback?.apply(this, arguments);
            };
            return showSortMenu.apply(this, arguments);
        };
        libraryBrowser.__communityRatingSortInstalled = true;
    }

    function extendSortMenus() {
        if (!supportedSortPage()) return;
        // The select menu persists its values and creates a fresh API query later.
        document.querySelectorAll('.formDialog .selectSortBy').forEach(select => {
            if (select.dataset.crSortExtended) {
                for (const [mode, key] of [['views', 'sortViews'], ['likes', 'sortLikes']]) {
                    const option = select.querySelector('option[value="' + sortModeIds[mode] + '"]');
                    if (option && option.textContent !== translate(key)) option.textContent = translate(key);
                }
                return;
            }
            select.dataset.crSortExtended = 'true';
            const selected = select.value || (lastSortContext?.route === location.hash ? lastSortContext.query.SortBy : '');
            for (const [mode, key] of [['views', 'sortViews'], ['likes', 'sortLikes']]) {
                if (select.querySelector('option[value="' + sortModeIds[mode] + '"]')) continue;
                const option = document.createElement('option');
                option.value = sortModeIds[mode];
                option.textContent = translate(key);
                select.appendChild(option);
            }
            if (communitySortMode(selected)) select.value = selected;
            let previousMode = communitySortMode(select.value);
            select.addEventListener('change', () => {
                const mode = communitySortMode(select.value);
                if (mode && mode !== previousMode) setDescending(select.closest('.formDialog'));
                previousMode = mode;
            });
        });

        // A DOM fallback also covers radio menus loaded before LibraryBrowser is
        // available globally. Native radio handlers keep saving and refreshing.
        document.querySelectorAll('.formDialog').forEach(dialog => {
            const native = dialog.querySelector('input.menuSortBy');
            if (!native) return;
            if (dialog.querySelector('input.menuSortBy[value="' + sortModeIds.views + '"]')) {
                for (const [mode, key] of [['views', 'sortViews'], ['likes', 'sortLikes']]) {
                    const input = dialog.querySelector('input.menuSortBy[value="' + sortModeIds[mode] + '"]');
                    const label = input?.closest('label')?.lastElementChild;
                    if (label?.tagName === 'SPAN' && label.textContent !== translate(key)) label.textContent = translate(key);
                }
                return;
            }
            const parent = native.closest('label')?.parentElement;
            if (!parent) return;
            const selected = lastSortContext?.route === location.hash ? lastSortContext.query.SortBy : '';
            for (const [mode, key] of [['views', 'sortViews'], ['likes', 'sortLikes']]) {
                const label = document.createElement('label');
                label.className = 'radio-label-block';
                const input = document.createElement('input', { is: 'emby-radio' });
                input.type = 'radio';
                input.name = native.name;
                input.className = 'menuSortBy';
                input.value = sortModeIds[mode];
                input.setAttribute('is', 'emby-radio');
                input.dataset.id = input.value;
                input.checked = communitySortMode(selected) === mode;
                input.addEventListener('change', () => {
                    if (!input.checked) return;
                    if (lastSortContext?.route === location.hash) lastSortContext.query.SortOrder = 'Descending';
                    pendingSortSelection = { route: location.hash, mode };
                    setDescending(dialog);
                    const originalValue = native.value;
                    // Reuse the existing native handler with the new sort key.
                    native.value = input.value;
                    native.checked = true;
                    try {
                        native.dispatchEvent(new Event('change', { bubbles: true }));
                    } finally {
                        native.value = originalValue;
                        native.checked = false;
                        input.checked = true;
                    }
                });
                const text = document.createElement('span');
                text.textContent = translate(key);
                label.appendChild(input);
                label.appendChild(text);
                parent.appendChild(label);
            }
        });
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
        installCommunitySortSupport();
        extendSortMenus();
        if (scanning) return;
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
                    document.querySelectorAll('.cr-details-top-host').forEach(element => element.classList.remove('cr-details-top-host'));
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
        const size = Number.isFinite(options.BadgeScale) ? options.BadgeScale : 16;
        const factor = Number.isFinite(options.DetailScaleFactor) ? Math.min(3, Math.max(1, options.DetailScaleFactor)) : 1;
        document.documentElement.style.setProperty('--cr-size', `${size}px`);
        document.documentElement.style.setProperty('--cr-detail-size', `${Math.round(size * factor * 100) / 100}px`);
        document.documentElement.style.setProperty('--cr-inset-x', `${Number.isFinite(options.BadgeInsetX) ? options.BadgeInsetX : 3}px`);
        document.documentElement.style.setProperty('--cr-inset-y', `${Number.isFinite(options.BadgeInsetY) ? options.BadgeInsetY : 8}px`);
        document.documentElement.style.setProperty('--cr-bg-opacity', String(options.BackgroundOpacity / 100));
        document.documentElement.style.setProperty('--cr-card-direction', options.StackCardBadges === true ? 'column' : 'row');
    }

    function makeBadge(kind, count, itemId, namesKey) {
        const row = document.createElement('span');
        row.className = 'cr-badge';
        row.tabIndex = 0;
        row.dataset.crItemId = itemId;
        row.dataset.crNamesKey = namesKey;
        row.dataset.crLabel = translate(kind === 'view' ? 'viewLabel' : 'likeLabel');
        row.setAttribute('aria-label', `${row.dataset.crLabel} : ${count}`);
        row.innerHTML = `${kind === 'view' ? eyeIcon : heartIcon}<span>${count}</span>`;
        row.addEventListener('mouseenter', showTooltip);
        row.addEventListener('focus', showTooltip);
        row.addEventListener('mouseleave', hideTooltip);
        row.addEventListener('blur', hideTooltip);
        return row;
    }

    function render(target, item) {
        const primaryContent = target.detail && target.element.querySelector('.detailPagePrimaryContent');
        const ratingBlock = target.detail && (target.element.querySelector('.itemMiscInfo-secondary') || target.element.querySelector('.itemMiscInfo'));
        const host = target.detail
            ? (primaryContent || target.element.querySelector('.infoWrapper') || ratingBlock?.parentElement)
            : (target.element.querySelector('.cardScalable') || target.element.querySelector('.cardImageContainer') || target.element);
        if (!host) return;
        const existing = target.element.querySelector(target.detail ? '.cr-details-stack' : '.cr-badge-stack');
        const signature = JSON.stringify([item.ItemId, item.ViewCount, item.LikeCount, options.AdminTooltipsEnabled, isAdmin, uiLanguage()]);
        if (existing?.dataset.crSignature === signature) {
            if (primaryContent) {
                host.classList.add('cr-details-top-host');
                if (host.firstElementChild !== existing) host.prepend(existing);
            }
            return;
        }
        if (existing) {
            if (tooltipBadge?.dataset.crItemId === item.ItemId) hideTooltip();
            existing.remove();
        }

        const stack = document.createElement('div');
        stack.className = target.detail ? 'cr-details-stack' : 'cr-badge-stack';
        stack.dataset.crSignature = signature;
        if (!target.detail) {
            if (getComputedStyle(host).position === 'static') host.style.position = 'relative';
        }
        stack.appendChild(makeBadge('view', item.ViewCount, item.ItemId, 'ViewedBy'));
        if (target.detail || item.LikeCount > 0) stack.appendChild(makeBadge('like', item.LikeCount, item.ItemId, 'LikedBy'));

        if (target.detail) {
            // Sit directly below the header, before the content sections, while
            // retaining Jellyfin's horizontal content padding and poster offset.
            if (primaryContent) {
                host.classList.add('cr-details-top-host');
                host.prepend(stack);
            }
            else if (ratingBlock?.parentElement === host) ratingBlock.insertAdjacentElement('afterend', stack);
            else host.appendChild(stack);
        } else {
            host.appendChild(stack);
        }
    }

    let tooltipElement;
    let tooltipRequest = 0;
    let tooltipBadge;
    function getTooltip() {
        if (tooltipElement) return tooltipElement;
        tooltipElement = document.createElement('div');
        tooltipElement.id = 'communityRatingTooltip';
        tooltipElement.className = 'cr-tooltip';
        tooltipElement.hidden = true;
        tooltipElement.setAttribute('role', 'tooltip');
        document.body.appendChild(tooltipElement);
        return tooltipElement;
    }

    function displayTooltip(badge, text) {
        const tip = getTooltip();
        if (tooltipBadge && tooltipBadge !== badge) tooltipBadge.removeAttribute('aria-describedby');
        tooltipBadge = badge;
        tip.textContent = text;
        tip.hidden = false;
        badge.setAttribute('aria-describedby', tip.id);
        const rect = badge.getBoundingClientRect();
        const width = tip.offsetWidth || 0;
        const height = tip.offsetHeight || 0;
        const badgeWidth = rect.width ?? Math.max(0, (rect.right ?? rect.left) - rect.left);
        const left = rect.left + badgeWidth / 2 - width / 2;
        const above = rect.top - height - 8;
        const top = above >= 8 ? above : rect.bottom + 8;
        tip.style.left = `${Math.max(8, Math.min(left, window.innerWidth - width - 8))}px`;
        tip.style.top = `${Math.max(8, Math.min(top, window.innerHeight - height - 8))}px`;
    }

    async function showTooltip(event) {
        const badge = event.currentTarget;
        const request = ++tooltipRequest;
        if (!badge.isConnected) return;
        const label = badge.dataset.crLabel;
        displayTooltip(badge, label);
        if (!options?.AdminTooltipsEnabled || !await currentUserIsAdmin()) return;
        if (request !== tooltipRequest || !badge.isConnected || !options.AdminTooltipsEnabled) return;
        const itemId = badge.dataset.crItemId;
        const key = badge.dataset.crNamesKey;
        const cacheKey = itemId.toLowerCase();
        let names = tooltipCache.get(cacheKey);
        if (!names) {
            try {
                const result = await ApiClient.getJSON(apiUrl('Admin/Items', [itemId]));
                if (request !== tooltipRequest || !badge.isConnected || !options.AdminTooltipsEnabled) return;
                const entry = result.find(item => item.ItemId.toLowerCase() === cacheKey);
                names = entry ? { ViewedBy: entry.ViewedBy || [], LikedBy: entry.LikedBy || [] } : { ViewedBy: [], LikedBy: [] };
                tooltipCache.set(cacheKey, names);
            } catch (_) {
                return;
            }
        }
        if (request !== tooltipRequest || !badge.isConnected || !options.AdminTooltipsEnabled) return;
        const people = names[key] || [];
        displayTooltip(badge, label + '\n' + (people.length ? people.join('\n') : translate('noMembers')));
    }

    function hideTooltip() {
        tooltipRequest++;
        if (tooltipElement) tooltipElement.hidden = true;
        if (tooltipBadge) tooltipBadge.removeAttribute('aria-describedby');
        tooltipBadge = null;
    }

    function invalidateCounts() {
        cacheRevision++;
        customSortStates.clear();
        cache.clear();
        tooltipCache.clear();
        hideTooltip();
    }

    ensureStyle();
    const observer = new MutationObserver(queueScan);
    observer.observe(document.documentElement, { childList: true, subtree: true, attributes: true, attributeFilter: ['lang'] });
    window.addEventListener('hashchange', queueScan);
    window.addEventListener('popstate', queueScan);
    window.addEventListener('scroll', queueScan, { passive: true });
    window.addEventListener('scroll', hideTooltip, { passive: true, capture: true });
    window.addEventListener('hashchange', hideTooltip);
    window.addEventListener('popstate', hideTooltip);
    document.addEventListener('keydown', event => { if (event.key === 'Escape') hideTooltip(); });
    document.addEventListener('click', event => {
        if (event.target.closest('.btnSort')) installCommunitySortSupport();
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
