const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');
const source = fs.readFileSync(path.join(__dirname, '../../src/Jellyfin.Plugin.CommunityRating/Web/community-rating.js'), 'utf8');

function clientFixture(t, route = '#/movies', language = 'fr', kefin = false) {
    const dom = new JSDOM('<!doctype html><html lang="' + language + '"><head></head><body><button class="btnSort">Sort</button></body></html>', {
        url: 'https://jellyfin.invalid/web/' + route, runScripts: 'outside-only'
    });
    let closed = false;
    t.after(async () => {
        await settle();
        closed = true;
        dom.window.close();
    });
    const window = dom.window;
    const requests = [];
    const library = Array.from({ length: 501 }, (_, index) => ({ Id: `item-${index}`, Name: `Film ${String(index).padStart(3, '0')}` }));
    const counts = Object.fromEntries(library.map(item => [item.Id, [0, 0]]));
    counts['item-500'] = [12, 1];
    counts['item-2'] = [6, 20];
    window.setTimeout = callback => setImmediate(() => { if (!closed) callback(); });
    window.setInterval = () => 0;
    window.ApiClient = {
        getUrl: route => 'https://jellyfin.invalid/' + route,
        getCurrentUserId: () => 'member',
        getCurrentUser: async () => ({ Policy: { IsAdministrator: false } }),
        getJSON: async url => url.includes('/Collections')
            ? [{ Id: 'collection-recommended', Key: 'movie-recommended' }]
            : url.includes('/Me/Votes')
                ? new URL(url).searchParams.getAll('ids').map(ItemId => ({ ItemId, Vote: 0 }))
            : ({
                Options: { Enabled: true, AdminTooltipsEnabled: false },
                Items: new URL(url).searchParams.getAll('ids').map(ItemId => ({ ItemId, ViewCount: counts[ItemId][0], LikeCount: counts[ItemId][1], RecommendationCount: counts[ItemId][2] || 0, DiscouragementCount: counts[ItemId][3] || 0 }))
            }),
        getItems: async (userId, query) => {
            requests.push({ userId, ...query });
            assert.ok(!String(query.SortBy).includes('CommunityRatingViews'));
            assert.ok(!String(query.SortBy).includes('CommunityRatingLikes'));
            const items = query.IsFavorite ? library.filter(item => item.Id !== 'item-500') : library;
            return { Items: items.slice(query.StartIndex || 0, (query.StartIndex || 0) + (query.Limit || items.length)), TotalRecordCount: items.length };
        }
    };
    if (kefin) {
        const sectionItems = [library[4], library[2], library[3]];
        counts['item-2'] = [0, 0, 30, 0];
        counts['item-3'] = [0, 0, 10, 20];
        counts['item-4'] = [0, 0, 20, 5];
        window.apiHelper = { getItems: async (query, useCache) => {
            requests.push({ kefin: true, ...query, useCache });
            return { Items: sectionItems, TotalRecordCount: sectionItems.length };
        } };
        window.cardBuilder = {
            sortItems: items => [...items].reverse(),
            renderCards: items => items,
            renderSpotlightSection: items => items
        };
    }
    window.eval(source);
    const settle = async () => { for (let index = 0; index < 12; index++) await new Promise(resolve => setImmediate(resolve)); };
    return { window, document: window.document, requests, library, counts, settle };
}

test('Kefin Tweaks native collection sections preserve the Community Rating ranking', async t => {
    const f = clientFixture(t, '#/home', 'en', true);
    await f.settle();
    const result = await f.window.apiHelper.getItems({ ParentId: 'collection-recommended', SortBy: 'DateAdded', Limit: 3 }, true);
    assert.equal(f.requests.at(-1).SortBy, 'Default');
    assert.equal(f.requests.at(-1).useCache, false);
    assert.deepEqual(result.Items.map(item => [item.Id, item.__communityRatingRank]), [['item-2', 30], ['item-4', 20], ['item-3', 10]]);
    assert.deepEqual(Array.from(f.window.cardBuilder.sortItems(result.Items), item => item.Id), ['item-2', 'item-4', 'item-3']);
});

test('recommendation and negative recommendation sorts rank the full library', async t => {
    const f = clientFixture(t);
    f.counts['item-400'] = [0, 0, 25, 1];
    f.counts['item-300'] = [0, 0, 2, 30];
    const query = { IncludeItemTypes: 'Movie', SortBy: 'CommunityRatingRecommendations', SortOrder: 'Descending', StartIndex: 0, Limit: 1 };
    let result = await f.window.ApiClient.getItems('member', query);
    assert.equal(result.Items[0].Id, 'item-400');
    query.SortBy = 'CommunityRatingDiscouragements';
    result = await f.window.ApiClient.getItems('member', query);
    assert.equal(result.Items[0].Id, 'item-300');
});

// Match Jellyfin Web 10.11.11 libraryBrowser's native radio change handlers.
// The plugin must reach these handlers even without a global LibraryBrowser.
function radioDialog(f, query, onRefresh, items = [{ id: 'SortName', name: 'Name' }]) {
    const dialog = f.document.createElement('div');
    dialog.className = 'formDialog';
    const choices = f.document.createElement('div');
    for (const option of items) {
        const label = f.document.createElement('label');
        const input = f.document.createElement('input');
        input.type = 'radio';
        input.name = 'SortBy';
        input.value = option.id;
        input.className = 'menuSortBy';
        input.checked = query.SortBy === option.id;
        input.addEventListener('change', function () {
            if (!this.checked) return;
            const changed = query.SortBy !== this.value;
            query.SortBy = this.value.replace('_', ',');
            query.StartIndex = 0;
            if (changed) onRefresh();
        });
        label.append(input, f.document.createTextNode(option.name));
        choices.append(label);
    }
    dialog.append(choices);
    for (const value of ['Ascending', 'Descending']) {
        const input = f.document.createElement('input');
        input.type = 'radio'; input.name = 'SortOrder'; input.className = 'menuSortOrder'; input.value = value;
        input.checked = query.SortOrder === value;
        input.addEventListener('change', function () {
            if (!this.checked) return;
            query.SortOrder = this.value; query.StartIndex = 0; onRefresh();
        });
        dialog.append(input);
    }
    f.document.body.append(dialog);
    return dialog;
}

function selectDialog(f, selected = 'SortName', order = 'Ascending') {
    const dialog = f.document.createElement('div');
    dialog.className = 'formDialog';
    dialog.innerHTML = '<form><select class="selectSortBy"><option value="SortName">Name</option><option value="DateCreated">Date added</option></select><select class="selectSortOrder"><option value="Ascending">Ascending</option><option value="Descending">Descending</option></select></form>';
    dialog.querySelector('.selectSortBy').value = selected;
    dialog.querySelector('.selectSortOrder').value = order;
    f.document.body.append(dialog);
    return dialog;
}

function choose(f, element) {
    if (element.type === 'radio') element.checked = true;
    element.dispatchEvent(new f.window.Event('change', { bubbles: true }));
}

test('radio menu gains working member sorts without a global LibraryBrowser', async t => {
    const f = clientFixture(t);
    const query = { IncludeItemTypes: 'Movie', SortBy: 'SortName', SortOrder: 'Ascending', StartIndex: 0, Limit: 2 };
    await f.window.ApiClient.getItems('member', query);
    const refreshes = [];
    const dialog = radioDialog(f, query, () => refreshes.push(f.window.ApiClient.getItems('member', query)));
    await f.settle();
    const views = dialog.querySelector('input[value="CommunityRatingViews"]');
    const likes = dialog.querySelector('input[value="CommunityRatingLikes"]');
    assert.ok(views); assert.ok(likes);
    assert.match(views.parentElement.textContent, /Vus par les membres/);
    choose(f, views);
    let result = await refreshes.at(-1);
    assert.equal(query.SortBy, 'CommunityRatingViews');
    assert.equal(query.SortOrder, 'Descending');
    assert.equal(result.Items[0].Id, 'item-500');
    assert.equal(result.Items[1].Id, 'item-2');
    choose(f, likes);
    result = await refreshes.at(-1);
    assert.equal(result.Items[0].Id, 'item-2');
    const native = dialog.querySelector('input[value="SortName"]');
    choose(f, native);
    result = await refreshes.at(-1);
    assert.equal(query.SortBy, 'SortName');
    assert.equal(result.Items[0].Id, 'item-0');
    await f.settle();
    assert.equal(dialog.querySelectorAll('input[value="CommunityRatingViews"]').length, 1);
});

test('generic select menu sorts fresh query objects across pages and preserves filters', async t => {
    const f = clientFixture(t, '#/list?type=Movie');
    const base = { IncludeItemTypes: 'Movie', Limit: 1, IsFavorite: true, SortBy: 'SortName', SortOrder: 'Ascending' };
    await f.window.ApiClient.getItems('member', { ...base, StartIndex: 0 });
    const dialog = selectDialog(f);
    await f.settle();
    const select = dialog.querySelector('.selectSortBy');
    assert.equal(select.options.length, 6);
    select.value = 'CommunityRatingViews'; choose(f, select);
    const settings = { SortBy: select.value, SortOrder: dialog.querySelector('.selectSortOrder').value };
    assert.equal(settings.SortOrder, 'Descending');
    const first = await f.window.ApiClient.getItems('member', { ...base, ...settings, StartIndex: 0 });
    const second = await f.window.ApiClient.getItems('member', { ...base, ...settings, StartIndex: 1 });
    assert.equal(first.TotalRecordCount, 500);
    assert.equal(first.Items[0].Id, 'item-2');
    assert.equal(second.Items[0].Id, 'item-0');
    assert.equal(f.requests.every(request => request.IsFavorite), true);
    dialog.remove();
    const reopened = selectDialog(f, settings.SortBy, settings.SortOrder);
    await f.settle();
    assert.equal(reopened.querySelector('.selectSortBy').value, 'CommunityRatingViews');
    assert.equal(reopened.querySelectorAll('option[value="CommunityRatingViews"]').length, 1);
});

test('persisted member sort works after reload, with ascending order and array item types', async t => {
    const f = clientFixture(t, '#/list?type=Series');
    const query = { IncludeItemTypes: ['Series'], SortBy: 'CommunityRatingLikes', SortOrder: 'Ascending', StartIndex: 499, Limit: 2 };
    const result = await f.window.ApiClient.getItems('member', query);
    assert.equal(result.Items[0].Id, 'item-500');
    assert.equal(result.Items[1].Id, 'item-2');
    const dialog = selectDialog(f, query.SortBy, query.SortOrder);
    await f.settle();
    assert.equal(dialog.querySelector('.selectSortBy').value, 'CommunityRatingLikes');
    assert.equal(dialog.querySelector('.selectSortOrder').value, 'Ascending');
});

test('sort button installs the classic hook immediately when its module loads late', async t => {
    const f = clientFixture(t);
    const query = { IncludeItemTypes: 'Episode', SortBy: 'SortName', SortOrder: 'Ascending', StartIndex: 0, Limit: 1 };
    const refreshes = [];
    let shown;
    f.window.LibraryBrowser = { showSortMenu(options) { shown = options; radioDialog(f, query, options.callback, options.items); } };
    f.document.querySelector('.btnSort').addEventListener('click', () => f.window.LibraryBrowser.showSortMenu({
        items: [{ id: 'SortName', name: 'Name' }], query,
        callback() { refreshes.push(f.window.ApiClient.getItems('member', query)); }
    }));
    f.document.querySelector('.btnSort').click();
    assert.equal(shown.items.length, 5);
    const dialog = f.document.querySelector('.formDialog');
    choose(f, dialog.querySelector('input[value="CommunityRatingLikes"]'));
    const result = await refreshes.at(-1);
    assert.equal(query.SortOrder, 'Descending');
    assert.equal(query.SortBy, 'CommunityRatingLikes');
    assert.equal(result.Items[0].Id, 'item-2');
    await f.settle();
    assert.equal(dialog.querySelectorAll('input[value="CommunityRatingLikes"]').length, 1);
    choose(f, dialog.querySelector('input.menuSortOrder[value="Ascending"]'));
    assert.equal((await refreshes.at(-1)).Items[0].Id, 'item-0');
});

test('radio fallback remains usable when injection occurs after the initial list request', async t => {
    const f = clientFixture(t);
    const query = { IncludeItemTypes: 'Movie', SortBy: 'SortName', SortOrder: 'Ascending', StartIndex: 0, Limit: 1 };
    const refreshes = [];
    const dialog = radioDialog(f, query, () => refreshes.push(f.window.ApiClient.getItems('member', query)));
    await f.settle();
    choose(f, dialog.querySelector('input[value="CommunityRatingViews"]'));
    assert.equal((await refreshes.at(-1)).Items[0].Id, 'item-500');
    assert.equal(query.SortOrder, 'Descending');
});

test('music and unsupported list menus do not gain member sort controls', async t => {
    const f = clientFixture(t, '#/list?type=Audio');
    await f.window.ApiClient.getItems('member', { IncludeItemTypes: 'Audio', SortBy: 'SortName', Limit: 10 });
    const dialog = selectDialog(f);
    await f.settle();
    assert.equal(dialog.querySelectorAll('option[value^="CommunityRating"]').length, 0);
});

test('folder lists infer support from their media cards when the query has no item type', async t => {
    const f = clientFixture(t, '#/list?parentId=collection');
    const page = f.document.createElement('div');
    page.className = 'page';
    page.innerHTML = '<div class="card" data-type="Movie"></div>';
    f.document.body.append(page);
    const dialog = selectDialog(f);
    await f.settle();
    const select = dialog.querySelector('.selectSortBy');
    select.value = 'CommunityRatingLikes'; choose(f, select);
    assert.equal(select.value, 'CommunityRatingLikes');
    const result = await f.window.ApiClient.getItems('member', { ParentId: 'collection', SortBy: select.value, SortOrder: 'Descending', Limit: 1 });
    assert.equal(result.Items[0].Id, 'item-2');
});

test('both sort menus translate to English, French, and English fallback without duplicates', async t => {
    const f = clientFixture(t, '#/movies', 'en-US');
    const query = { IncludeItemTypes: 'Movie', SortBy: 'SortName', Limit: 1 };
    await f.window.ApiClient.getItems('member', query);
    const selectMenu = selectDialog(f);
    const radioMenu = radioDialog(f, query, () => {});
    await f.settle();
    const select = selectMenu.querySelector('option[value="CommunityRatingViews"]');
    const radio = radioMenu.querySelector('input[value="CommunityRatingLikes"]').closest('label');
    assert.equal(select.textContent, 'Viewed by members');
    assert.equal(radio.textContent, 'Liked by members');
    f.document.documentElement.lang = 'fr-CA';
    await f.settle();
    assert.equal(select.textContent, 'Vus par les membres');
    assert.equal(radio.textContent, 'Aimés par les membres');
    f.document.documentElement.lang = 'de';
    await f.settle();
    assert.equal(select.textContent, 'Viewed by members');
    assert.equal(radio.textContent, 'Liked by members');
    assert.equal(selectMenu.querySelectorAll('option[value="CommunityRatingViews"]').length, 1);
    assert.equal(radioMenu.querySelectorAll('input[value="CommunityRatingLikes"]').length, 1);
});
