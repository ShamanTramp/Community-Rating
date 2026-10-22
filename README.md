# Community Rating

![Community Rating illustration](assets/community-rating-cover.png)

**Community Rating** is a Jellyfin plugin that shows how many members have watched or favorited each movie, series, or episode. It adds view and favorite counters to media cards and detail pages in Jellyfin Web.

## Features

- Counts each active, included account once, using Jellyfin's **played** and **favorite** markers. Repeated playback does not increase the count.
- Counts a series as viewed by a member when that member has watched at least one episode. Watching more episodes does not add more series views.
- Counts favorites on the movie, episode, or series itself.
- Ignores disabled accounts and user names listed in the exclusions.
- Shows white view and favorite icons in the upper-left corner of media cards, either on one line or stacked vertically. Views always appear first, including zero; favorites are hidden when their count is zero.
- Places both counters on a separate centered row below the existing rating information on detail pages, including zero favorites. Detail counters are 25% larger than card counters (20 px by default).
- Adds **Viewed by members** and **Liked by members** to supported library sort menus (**Vus par les membres** and **Aimés par les membres** in French). Both default to descending order.
- Shows a tooltip above each counter for everyone, on hover or keyboard focus: **Viewed by members** for views and **Liked by members** for favorites (**Vu par les membres** and **Aimé par les membres** in French). Press Escape to dismiss it.
- Administrators can optionally see member names below the tooltip label, with one name per line. Name lists are disabled by default; the names endpoint requires administrator access. Label tooltips remain available regardless of this setting.
- Recalculates affected aggregates after played or favorite markers change, with a full reconciliation available as a scheduled task.

The server updates its cache when markers change. Open web pages refresh counters every 30 seconds and shortly after local marker actions. Community sorting fetches the full filtered list before applying pagination, so the first sort can take longer on large libraries.

Use the **A–Z / Sort** button in a movie, series, or episode list to find the member sorts. Both Jellyfin's radio-button menu and its sort drop-down are supported. The selected sort is preserved by Jellyfin's normal list settings; pages and filters keep applying to the whole sorted result.

Counter labels, sort options, and the configuration page follow Jellyfin's interface language. French and English are included, with English as the fallback for other languages or missing translations.

## Installation

Install [JavaScript Injector](https://github.com/n00bcodr/Jellyfin-JavaScript-Injector) first. Community Rating registers its bundled script with JavaScript Injector automatically when Jellyfin starts.

In Jellyfin, open **Dashboard → Plugins → Repositories**, then add the repository manifest:

```text
https://raw.githubusercontent.com/ShamanTramp/Community-Rating/main/manifest.json
```

Save the repository, open the plugin catalog, select **Available** if needed, then install **Community Rating**. Restart Jellyfin and reload the web client when installation is complete. The [0.1.2.0 plugin package](https://raw.githubusercontent.com/ShamanTramp/Community-Rating/main/packages/community-rating-0.1.2.0.zip) is also available directly. After upgrading, fully reload the browser page to replace any script left running by the previous version.

Jellyfin must be able to access the manifest and package files on GitHub to install and update the plugin.

## Configuration and usage

Open **Dashboard → Plugins → Community Rating**:

| Option | Default | Description |
| --- | --- | --- |
| Show counters | Enabled | Displays member view and favorite counters. |
| Excluded accounts | Empty | Jellyfin user names separated by commas. Spaces around names and letter case are ignored. Disabled accounts are always excluded. |
| Administrator tooltips | Disabled | Adds the included member names to administrators' tooltips. Label tooltips remain available to everyone. Names are never included in the public counter response. |
| Card counter layout | One line | Choose one line or vertically stacked counters. Views come first, favorites second. |
| Icon and counter size | 16 px | Adjusts the card size from 12 to 28 px; detail counters are 25% larger. |
| Horizontal inset | 3 px | Sets the distance from the left edge of a card, from 0 to 32 px. |
| Vertical inset | 8 px | Sets the distance from the top edge of a card, from 0 to 32 px. |
| Background opacity | 45% | Adjusts the counter background from 0% to 90%. |
| Full reconciliation | Every 6 hours | Choose hourly if a complete rebuild takes less than five minutes; otherwise use six hours. Changing this setting updates the task's interval trigger. |

To rebuild the statistics manually, run **Rebuild Community Rating statistics** from **Dashboard → Scheduled Tasks**. The task supports progress reporting and cancellation. The cache is also initialized at startup; uncached media are calculated when requested.

The web client picks up display changes on its next refresh. Exclusion changes rebuild the server cache. New defaults do not overwrite values already saved in your configuration.

## Compatibility

Targets Jellyfin **10.11.11** and **.NET 9**. The web interface requires JavaScript Injector; the integration was tested with JavaScript Injector **3.1.0.0**. Card overlays and custom sort menus apply to Jellyfin Web. Native clients do not load the injected script.

## Development

```sh
dotnet restore Jellyfin.Plugin.CommunityRating.sln
dotnet build Jellyfin.Plugin.CommunityRating.sln -c Release --no-restore -m:1
dotnet test Jellyfin.Plugin.CommunityRating.sln -c Release --no-build --no-restore -m:1
npm ci --ignore-scripts
npm test
```

The web tests use Node.js 22, including jsdom fixtures for Jellyfin's native sort menus; they do not require a running Jellyfin server. CI builds and runs both test suites on pushes to `main` and pull requests. Publishing a GitHub release verifies the version tag, produces the installable ZIP, computes its checksum, and updates `manifest.json`.

## License

GPL-3.0-only. See [LICENSE](LICENSE).
