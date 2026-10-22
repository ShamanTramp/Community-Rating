const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');
const source = fs.readFileSync(path.join(__dirname, '../../src/Jellyfin.Plugin.CommunityRating/Web/community-rating.js'), 'utf8');
const configHtml = fs.readFileSync(path.join(__dirname, '../../src/Jellyfin.Plugin.CommunityRating/Configuration/configPage.html'), 'utf8');
const settle = async () => { for (let index = 0; index < 12; index++) await new Promise(resolve => setImmediate(resolve)); };

function presentation(t, { admin = false, namesEnabled = false, rejectNames = false, language = 'fr', noMembers = false } = {}) {
    const dom = new JSDOM(`<!doctype html><html lang="${language}"><head><style>.detailPagePrimaryContent{padding-top:20px}</style></head><body>
        <div class="card" data-id="movie-a"><div class="cardScalable"></div></div>
        <div class="itemDetailPage"><div class="detailPagePrimaryContainer">
        <div class="detailImageContainer">Poster</div>
        <div class="detailRibbon"><div class="infoWrapper"><h1 class="nameContainer">Film title</h1>
            <div class="itemMiscInfo itemMiscInfo-primary"><span>2009 · 1h57</span></div>
            <div class="itemMiscInfo itemMiscInfo-secondary"><span>IMDb 7.9</span><span>Rotten Tomatoes 88%</span></div>
        </div><div class="mainDetailButtons"><button>Play</button></div></div>
        <div class="detailPagePrimaryContent"><div class="detailSection">
            <form class="trackSelections"><select><option>Video</option></select></form>
            <div class="detailSectionContent"><p class="overview">Film description</p></div>
        </div></div></div></div>
        </body></html>`, { url: 'https://jellyfin.invalid/web/#/details?id=movie-a', runScripts: 'outside-only' });
    const window = dom.window;
    let closed = false;
    t.after(async () => { await settle(); closed = true; window.close(); });
    const intervals = [];
    window.setTimeout = callback => setImmediate(() => { if (!closed) callback(); });
    window.setInterval = callback => { intervals.push(callback); };
    const calls = [];
    const options = { Enabled: true, BadgeScale: 16, BackgroundOpacity: 45, AdminTooltipsEnabled: namesEnabled, StackCardBadges: false };
    window.ApiClient = {
        getUrl: route => 'https://jellyfin.invalid/' + route,
        getCurrentUser: async () => ({ Policy: { IsAdministrator: admin } }),
        getJSON: async url => {
            calls.push(url);
            if (url.includes('/Admin/')) {
                if (rejectNames) throw new Error('Forbidden');
                return [{ ItemId: 'movie-a', ViewedBy: noMembers ? [] : ['Alpha', 'Beta'], LikedBy: noMembers ? [] : ['Alpha'] }];
            }
            return { Options: { ...options }, Items: [{ ItemId: 'movie-a', ViewCount: 2, LikeCount: 1 }] };
        }
    };
    Object.defineProperty(window.HTMLElement.prototype, 'offsetWidth', { configurable: true, get() { return this.classList.contains('cr-tooltip') ? 180 : 0; } });
    Object.defineProperty(window.HTMLElement.prototype, 'offsetHeight', { configurable: true, get() { return this.classList.contains('cr-tooltip') ? 60 : 0; } });
    window.eval(source);
    function fire(element, type) {
        element.getBoundingClientRect = () => ({ left: 100, top: 200, right: 160, bottom: 230, width: 60, height: 30 });
        element.dispatchEvent(new window.Event(type));
    }
    return { window, document: window.document, calls, options, intervals, fire };
}

for (const admin of [false, true]) {
    test(`label tooltips appear above icons when name lists are off (administrator=${admin})`, async t => {
        const f = presentation(t, { admin });
        await settle();
        const badges = f.document.querySelectorAll('.cr-badge-stack .cr-badge');
        f.fire(badges[0], 'mouseenter');
        await settle();
        const tip = f.document.getElementById('communityRatingTooltip');
        assert.equal(tip.textContent, 'Vu par les membres');
        assert.equal(tip.hidden, false);
        assert.equal(tip.style.top, '132px');
        assert.equal(tip.style.left, '40px');
        assert.equal(badges[0].getAttribute('aria-describedby'), tip.id);
        assert.equal(badges[0].getAttribute('aria-label'), 'Vu par les membres : 2');
        f.fire(badges[0], 'mouseleave');
        assert.equal(tip.hidden, true);
        f.fire(badges[1], 'focus');
        await settle();
        assert.equal(tip.textContent, 'Aimé par les membres');
        assert.equal(badges[1].tabIndex, 0);
        f.document.dispatchEvent(new f.window.KeyboardEvent('keydown', { key: 'Escape' }));
        assert.equal(tip.hidden, true);
        assert.equal(badges[1].hasAttribute('aria-describedby'), false);
        assert.equal(f.calls.some(url => url.includes('/Admin/')), false);
    });
}

test('ordinary users keep labels when administrator name lists are enabled', async t => {
    const f = presentation(t, { namesEnabled: true });
    await settle();
    f.fire(f.document.querySelector('.cr-badge'), 'focus');
    await settle();
    assert.equal(f.document.querySelector('.cr-tooltip').textContent, 'Vu par les membres');
    assert.equal(f.calls.some(url => url.includes('/Admin/')), false);
});

test('administrators get the label followed by the correct private name list', async t => {
    const f = presentation(t, { admin: true, namesEnabled: true });
    await settle();
    const badges = f.document.querySelectorAll('.cr-details-stack .cr-badge');
    f.fire(badges[0], 'focus');
    await settle();
    assert.equal(f.document.querySelector('.cr-tooltip').textContent, 'Vu par les membres\nAlpha\nBeta');
    f.fire(badges[1], 'mouseenter');
    await settle();
    assert.equal(f.document.querySelector('.cr-tooltip').textContent, 'Aimé par les membres\nAlpha');
    assert.equal(badges[0].hasAttribute('aria-describedby'), false);
    assert.equal(f.calls.filter(url => url.includes('/Admin/')).length, 1);
    f.window.dispatchEvent(new f.window.Event('scroll'));
    assert.equal(f.document.querySelector('.cr-tooltip').hidden, true);
});

test('a rejected names request does not hide the public label', async t => {
    const f = presentation(t, { admin: true, namesEnabled: true, rejectNames: true });
    await settle();
    f.fire(f.document.querySelector('.cr-badge'), 'mouseenter');
    await settle();
    const tip = f.document.querySelector('.cr-tooltip');
    assert.equal(tip.textContent, 'Vu par les membres');
    assert.equal(tip.hidden, false);
});

test('detail counters center inside the description column and share the configured card size', async t => {
    const f = presentation(t);
    await settle();
    const ratings = f.document.querySelector('.itemMiscInfo-secondary');
    const row = f.document.querySelector('.cr-details-stack');
    const column = f.document.querySelector('.detailPagePrimaryContent');
    column.style.width = '640px';
    assert.equal(row.parentElement, column);
    assert.equal(column.firstElementChild, row);
    assert.equal(column.querySelector('.overview').textContent, 'Film description');
    assert.equal(f.document.querySelector('.infoWrapper').contains(row), false);
    assert.equal(f.document.querySelector('.detailRibbon').nextElementSibling, column);
    assert.equal(f.window.getComputedStyle(column).paddingTop, '0px');
    assert.equal(f.window.getComputedStyle(row).marginTop, '0px');
    assert.equal(f.window.getComputedStyle(row).clear, 'none');
    assert.equal(f.window.getComputedStyle(row).order, '-1');
    assert.equal(ratings.parentElement.className, 'infoWrapper');
    assert.equal(ratings.textContent, 'IMDb 7.9Rotten Tomatoes 88%');
    assert.equal(f.window.getComputedStyle(row).display, 'flex');
    assert.equal(f.window.getComputedStyle(row).justifyContent, 'center');
    assert.equal(f.window.getComputedStyle(row).width, '100%');
    const style = f.document.documentElement.style;
    assert.equal(style.getPropertyValue('--cr-size'), '16px');
    assert.equal(style.getPropertyValue('--cr-detail-size'), '16px');
    const card = f.document.querySelector('.cr-badge-stack .cr-badge');
    const detail = row.querySelector('.cr-badge');
    assert.equal(f.window.getComputedStyle(detail).padding, f.window.getComputedStyle(card).padding);
    assert.equal(style.getPropertyValue('--cr-inset-x'), '3px');
    assert.equal(style.getPropertyValue('--cr-inset-y'), '8px');
    f.options.BadgeScale = 24;
    f.options.StackCardBadges = true;
    f.intervals[0]();
    await settle();
    assert.equal(f.document.querySelector('.cr-details-stack'), row);
    assert.equal(style.getPropertyValue('--cr-size'), '24px');
    assert.equal(style.getPropertyValue('--cr-detail-size'), '24px');
    f.options.DetailScaleFactor = 1.25;
    f.intervals[0]();
    await settle();
    assert.equal(style.getPropertyValue('--cr-size'), '24px');
    assert.equal(style.getPropertyValue('--cr-detail-size'), '30px');
    assert.equal(f.document.querySelector('.cr-details-stack'), row);
    column.style.width = '400px';
    assert.equal(row.parentElement, column);
    assert.equal(f.window.getComputedStyle(row).justifyContent, 'center');
});

test('detail rows stay above asynchronously added content without duplicating counters', async t => {
    const f = presentation(t);
    await settle();
    const row = f.document.querySelector('.cr-details-stack');
    const primary = f.document.querySelector('.detailPagePrimaryContent');
    const originalColumn = primary.querySelector('.detailSection');
    originalColumn.className = 'oldColumn';
    const replacement = f.document.createElement('div');
    replacement.className = 'detailSection';
    primary.prepend(replacement);
    await settle();
    assert.equal(row.parentElement, primary);
    assert.equal(primary.firstElementChild, row);
    replacement.remove();
    await settle();
    const fallback = f.document.querySelector('.cr-details-stack');
    assert.equal(fallback.parentElement, primary);
    assert.equal(primary.firstElementChild, fallback);
    assert.equal(f.document.querySelectorAll('.cr-details-stack').length, 1);
});

test('disabling counters restores the original spacing of the content column', async t => {
    const f = presentation(t);
    await settle();
    const column = f.document.querySelector('.detailPagePrimaryContent');
    assert.equal(f.window.getComputedStyle(column).paddingTop, '0px');
    f.options.Enabled = false;
    f.intervals[0]();
    await settle();
    assert.equal(f.document.querySelector('.cr-details-stack'), null);
    assert.equal(column.classList.contains('cr-details-top-host'), false);
    assert.equal(f.window.getComputedStyle(column).paddingTop, '20px');
});

test('configuration uses 3px and 8px defaults and preserves previously saved offsets', async t => {
    const dom = new JSDOM(configHtml, { url: 'https://jellyfin.invalid/', runScripts: 'outside-only' });
    t.after(() => dom.window.close());
    const window = dom.window;
    const config = {};
    window.Dashboard = { showLoadingMsg() {}, hideLoadingMsg() {}, processPluginConfigurationUpdateResult() {} };
    window.ApiClient = { getPluginConfiguration: async () => config, updatePluginConfiguration: async (id, value) => Object.assign(config, value) };
    window.eval(window.document.querySelector('script').textContent);
    const page = window.document.getElementById('CommunityRatingConfigPage');
    const x = window.document.getElementById('BadgeInsetX');
    const y = window.document.getElementById('BadgeInsetY');
    const factor = window.document.getElementById('DetailScaleFactor');
    page.dispatchEvent(new window.Event('pageshow'));
    await settle();
    assert.equal(x.value, '3'); assert.equal(y.value, '8');
    assert.equal(factor.value, '1');
    window.document.getElementById('CommunityRatingConfigForm').dispatchEvent(new window.Event('submit', { cancelable: true }));
    await settle();
    assert.equal(config.BadgeInsetX, 3); assert.equal(config.BadgeInsetY, 8);
    assert.equal(config.DetailScaleFactor, 1);
    factor.value = '1.25';
    window.document.getElementById('CommunityRatingConfigForm').dispatchEvent(new window.Event('submit', { cancelable: true }));
    await settle();
    assert.equal(config.DetailScaleFactor, 1.25);
    Object.assign(config, { BadgeInsetX: 12, BadgeInsetY: 4 });
    page.dispatchEvent(new window.Event('pageshow'));
    await settle();
    assert.equal(x.value, '12'); assert.equal(y.value, '4');
    assert.equal(factor.value, '1.25');
    Object.assign(config, { BadgeInsetX: 0, BadgeInsetY: 0 });
    page.dispatchEvent(new window.Event('pageshow'));
    await settle();
    assert.equal(x.value, '0'); assert.equal(y.value, '0');
});

for (const language of ['en', 'de-DE']) {
    test(`tooltip labels and empty name lists fall back to English for ${language}`, async t => {
        const f = presentation(t, { language, admin: true, namesEnabled: true, noMembers: true });
        await settle();
        const badges = f.document.querySelectorAll('.cr-details-stack .cr-badge');
        f.fire(badges[0], 'focus');
        await settle();
        assert.equal(f.document.querySelector('.cr-tooltip').textContent, 'Viewed by members\nNo members');
        assert.match(badges[0].getAttribute('aria-label'), /^Viewed by members/);
        f.fire(badges[1], 'mouseenter');
        await settle();
        assert.equal(f.document.querySelector('.cr-tooltip').textContent, 'Liked by members\nNo members');
    });
}

test('changing Jellyfin language refreshes badge labels without another count request', async t => {
    const f = presentation(t, { language: 'fr-CA' });
    await settle();
    const before = f.calls.length;
    f.fire(f.document.querySelector('.cr-badge'), 'focus');
    await settle();
    assert.equal(f.document.querySelector('.cr-tooltip').textContent, 'Vu par les membres');
    f.document.documentElement.lang = 'en-US';
    await settle();
    const badge = f.document.querySelector('.cr-badge');
    assert.match(badge.getAttribute('aria-label'), /^Viewed by members/);
    assert.equal(f.document.querySelector('.cr-tooltip').hidden, true);
    f.fire(badge, 'mouseenter');
    await settle();
    assert.equal(f.document.querySelector('.cr-tooltip').textContent, 'Viewed by members');
    assert.equal(f.calls.length, before);
});

test('every configuration label has English fallback and follows Jellyfin language', async t => {
    const dom = new JSDOM(configHtml, { url: 'https://jellyfin.invalid/', runScripts: 'outside-only' });
    t.after(() => dom.window.close());
    const window = dom.window;
    window.Dashboard = { showLoadingMsg() {}, hideLoadingMsg() {} };
    window.ApiClient = { getPluginConfiguration: async () => ({}) };
    window.eval(window.document.querySelector('script').textContent);
    const page = window.document.getElementById('CommunityRatingConfigPage');
    page.dispatchEvent(new window.Event('pageshow'));
    await settle();
    const labels = Array.from(page.querySelectorAll('[data-cr-i18n]'));
    const english = new Map(labels.map(element => [element.getAttribute('data-cr-i18n'), element.textContent]));
    assert.ok(labels.length >= 19);
    assert.equal(english.get('showCounters'), 'Show view and favorite counters');
    assert.equal(english.get('save'), 'Save');
    window.document.documentElement.lang = 'fr-FR';
    await settle();
    assert.equal(page.querySelector('[data-cr-i18n="showCounters"]').textContent, 'Afficher les compteurs de vues et de favoris');
    assert.equal(page.querySelector('[data-cr-i18n="layoutStacked"]').textContent, 'Empilés');
    assert.equal(page.querySelector('[data-cr-i18n="save"]').textContent, 'Enregistrer');
    assert.equal(labels.filter(element => element.textContent !== english.get(element.getAttribute('data-cr-i18n'))).length, labels.length);
    window.document.documentElement.lang = 'es-ES';
    await settle();
    labels.forEach(element => assert.equal(element.textContent, english.get(element.getAttribute('data-cr-i18n'))));
});
