using System.Collections.Concurrent;
using System.Threading.Channels;
using Jellyfin.Data.Events;
using Jellyfin.Data.Enums;
using Jellyfin.Database.Implementations.Entities;
using Jellyfin.Plugin.CommunityRating.Configuration;
using Jellyfin.Plugin.CommunityRating.Core;
using MediaBrowser.Controller.Entities;
using MediaBrowser.Controller.Entities.Movies;
using MediaBrowser.Controller.Entities.TV;
using MediaBrowser.Controller.Library;
using MediaBrowser.Model.Dto;
using MediaBrowser.Model.Entities;
using MediaBrowser.Model.Tasks;
using Jellyfin.Plugin.CommunityRating.ScheduledTasks;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;

namespace Jellyfin.Plugin.CommunityRating.Services;

/// <summary>Maintains aggregated community markers and refreshes changed items.</summary>
public sealed class CommunityStatsService : BackgroundService
{
    private readonly ILibraryManager _libraryManager;
    private readonly IUserManager _userManager;
    private readonly IUserDataManager _userDataManager;
    private readonly ILogger<CommunityStatsService> _logger;
    private readonly ITaskManager _taskManager;
    private readonly Channel<Guid> _dirtyItems = Channel.CreateUnbounded<Guid>(new UnboundedChannelOptions { SingleReader = true });
    private readonly ConcurrentDictionary<Guid, SemaphoreSlim> _itemLocks = new();
    private ConcurrentDictionary<Guid, CommunityItemStats> _cache = new();
    private string _lastExcludedUserNames;
    private int _lastRefreshIntervalHours;

    /// <summary>Initializes a new instance of the <see cref="CommunityStatsService"/> class.</summary>
    public CommunityStatsService(
        ILibraryManager libraryManager,
        IUserManager userManager,
        IUserDataManager userDataManager,
        ITaskManager taskManager,
        ILogger<CommunityStatsService> logger)
    {
        _libraryManager = libraryManager;
        _userManager = userManager;
        _userDataManager = userDataManager;
        _logger = logger;
        _taskManager = taskManager;
        _lastExcludedUserNames = Plugin.Instance?.Configuration.ExcludedUserNames ?? string.Empty;
        _lastRefreshIntervalHours = Plugin.Instance?.Configuration.RefreshIntervalHours == 1 ? 1 : 6;
        _userDataManager.UserDataSaved += OnUserDataSaved;
        _userManager.OnUserUpdated += OnUserUpdated;
        if (Plugin.Instance is not null)
        {
            Plugin.Instance.ConfigurationChanged += OnConfigurationChanged;
        }
    }

    /// <inheritdoc />
    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        try
        {
            await RebuildAsync(null, stoppingToken).ConfigureAwait(false);
        }
        catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested)
        {
            return;
        }
        catch (Exception exception)
        {
            _logger.LogError(exception, "Could not initialize Community Rating's aggregate cache.");
        }

        while (!stoppingToken.IsCancellationRequested)
        {
            Guid itemId;
            try
            {
                itemId = await _dirtyItems.Reader.ReadAsync(stoppingToken).ConfigureAwait(false);
            }
            catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested)
            {
                break;
            }

            var queued = new HashSet<Guid> { itemId };
            await Task.Delay(TimeSpan.FromMilliseconds(250), stoppingToken).ConfigureAwait(false);
            while (_dirtyItems.Reader.TryRead(out var nextId))
            {
                queued.Add(nextId);
            }

            if (queued.Remove(Guid.Empty))
            {
                try
                {
                    await RebuildAsync(null, stoppingToken).ConfigureAwait(false);
                }
                catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested)
                {
                    break;
                }
                catch (Exception exception)
                {
                    _logger.LogError(exception, "Could not rebuild Community Rating after a configuration change.");
                }
            }

            foreach (var changedId in queued)
            {
                stoppingToken.ThrowIfCancellationRequested();
                try
                {
                    await RefreshItemAndSeriesAsync(changedId, stoppingToken).ConfigureAwait(false);
                }
                catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested)
                {
                    return;
                }
                catch (Exception exception)
                {
                    _logger.LogError(exception, "Could not refresh Community Rating for item {ItemId}.", changedId);
                }
            }
        }
    }

    /// <summary>Returns cached statistics for the requested item ids, calculating cache misses on demand.</summary>
    public async Task<IReadOnlyList<CommunityItemStats>> GetStatsAsync(IEnumerable<Guid> itemIds, CancellationToken cancellationToken)
    {
        var ids = itemIds.Distinct().Take(100).ToArray();
        var eligibleNames = GetEligibleUsers().Select(user => user.Username).ToHashSet(StringComparer.OrdinalIgnoreCase);
        foreach (var id in ids)
        {
            cancellationToken.ThrowIfCancellationRequested();
            if (!_cache.TryGetValue(id, out var cached)
                || cached.ViewedBy.Concat(cached.LikedBy).Any(name => !eligibleNames.Contains(name)))
            {
                await RefreshItemAndSeriesAsync(id, cancellationToken).ConfigureAwait(false);
            }
        }

        var snapshot = _cache;
        return ids.Select(id => snapshot.TryGetValue(id, out var item) ? item : null)
            .OfType<CommunityItemStats>().ToArray();
    }

    /// <summary>Returns the administrator-only names associated with requested markers.</summary>
    public async Task<IReadOnlyList<CommunityItemStats>> GetAdminStatsAsync(IEnumerable<Guid> itemIds, CancellationToken cancellationToken) =>
        await GetStatsAsync(itemIds, cancellationToken).ConfigureAwait(false);

    /// <summary>Recalculates every movie, series, and episode in the library.</summary>
    public async Task RebuildAsync(IProgress<double>? progress, CancellationToken cancellationToken)
    {
        var items = _libraryManager.GetItemList(new InternalItemsQuery
        {
            IncludeItemTypes = [BaseItemKind.Movie, BaseItemKind.Series, BaseItemKind.Episode],
            EnableTotalRecordCount = false
        });
        var users = GetEligibleUsers();
        var excludedNames = GetExcludedNames();
        var episodesBySeries = items
            .OfType<Episode>()
            .Where(episode => episode.Series is not null)
            .GroupBy(episode => episode.Series!.Id)
            .ToDictionary(group => group.Key, group => group.ToArray());

        var userStatesByItem = new Dictionary<Guid, UserItemState[]>(items.Count);
        for (var index = 0; index < items.Count; index++)
        {
            cancellationToken.ThrowIfCancellationRequested();
            var item = items[index];
            userStatesByItem[item.Id] = GetItemStates(item, users);
            if (index % 50 == 0)
            {
                progress?.Report(items.Count == 0 ? 80 : (double)index / items.Count * 80);
                await Task.Yield();
            }
        }

        var replacement = new ConcurrentDictionary<Guid, CommunityItemStats>();
        for (var index = 0; index < items.Count; index++)
        {
            cancellationToken.ThrowIfCancellationRequested();
            var item = items[index];
            var states = userStatesByItem[item.Id];
            CommunityItemStats result;
            if (item is Series)
            {
                var episodeStates = episodesBySeries.TryGetValue(item.Id, out var episodes)
                    ? episodes.SelectMany(episode => userStatesByItem[episode.Id]
                        .Select(state => (state.UserName, state.IsDisabled, state.IsPlayed)))
                    : [];
                result = CommunityRatingAggregator.AggregateSeries(item.Id, states, episodeStates, excludedNames);
            }
            else
            {
                result = CommunityRatingAggregator.AggregateItem(item.Id, states, excludedNames);
            }

            replacement[item.Id] = result;
            if (index % 50 == 0)
            {
                progress?.Report(80 + (items.Count == 0 ? 1 : (double)index / items.Count) * 20);
            }
        }

        cancellationToken.ThrowIfCancellationRequested();
        Interlocked.Exchange(ref _cache, replacement);
        progress?.Report(100);
        _logger.LogInformation("Community Rating rebuilt aggregates for {ItemCount} media items and {UserCount} active, included accounts.", items.Count, users.Count);
    }

    /// <inheritdoc />
    public override async Task StopAsync(CancellationToken cancellationToken)
    {
        _userDataManager.UserDataSaved -= OnUserDataSaved;
        _userManager.OnUserUpdated -= OnUserUpdated;
        if (Plugin.Instance is not null)
        {
            Plugin.Instance.ConfigurationChanged -= OnConfigurationChanged;
        }

        await base.StopAsync(cancellationToken).ConfigureAwait(false);
        foreach (var itemLock in _itemLocks.Values)
        {
            itemLock.Dispose();
        }
    }

    private static bool IsRelevantSave(UserDataSaveEventArgs args) => args.SaveReason is
        UserDataSaveReason.PlaybackFinished or
        UserDataSaveReason.TogglePlayed or
        UserDataSaveReason.UpdateUserRating or
        UserDataSaveReason.UpdateUserData;

    private void OnUserDataSaved(object? sender, UserDataSaveEventArgs args)
    {
        if (args is null)
        {
            return;
        }

        var item = args.Item;
        if (item is null)
        {
            return;
        }

        if (!IsRelevantSave(args))
        {
            return;
        }

        _dirtyItems.Writer.TryWrite(item.Id);
        if (item is Episode { Series: not null } episode)
        {
            _dirtyItems.Writer.TryWrite(episode.Series.Id);
        }
    }

    private void OnConfigurationChanged(object? sender, MediaBrowser.Model.Plugins.BasePluginConfiguration args)
    {
        if (args is not PluginConfiguration configuration)
        {
            return;
        }

        if (!string.Equals(_lastExcludedUserNames, configuration.ExcludedUserNames, StringComparison.Ordinal))
        {
            _lastExcludedUserNames = configuration.ExcludedUserNames;
            _dirtyItems.Writer.TryWrite(Guid.Empty);
        }

        var intervalHours = configuration.RefreshIntervalHours == 1 ? 1 : 6;
        if (_lastRefreshIntervalHours != intervalHours)
        {
            var worker = _taskManager.ScheduledTasks.FirstOrDefault(task => task.ScheduledTask is RebuildCommunityStatsTask);
            if (worker is not null)
            {
                worker.Triggers = worker.Triggers.Where(trigger => trigger.Type != TaskTriggerInfoType.IntervalTrigger)
                    .Append(new TaskTriggerInfo
                    {
                        Type = TaskTriggerInfoType.IntervalTrigger,
                        IntervalTicks = TimeSpan.FromHours(intervalHours).Ticks
                    }).ToArray();
                _lastRefreshIntervalHours = intervalHours;
            }
        }
    }

    private void OnUserUpdated(object? sender, GenericEventArgs<User> args) => _dirtyItems.Writer.TryWrite(Guid.Empty);

    private async Task RefreshItemAndSeriesAsync(Guid itemId, CancellationToken cancellationToken)
    {
        if (itemId == Guid.Empty)
        {
            return;
        }

        var itemLock = _itemLocks.GetOrAdd(itemId, static _ => new SemaphoreSlim(1, 1));
        await itemLock.WaitAsync(cancellationToken).ConfigureAwait(false);
        try
        {
            var item = _libraryManager.GetItemById(itemId);
            if (item is null || !IsSupported(item))
            {
                _cache.TryRemove(itemId, out _);
                return;
            }

            _cache[itemId] = await CalculateItemAsync(item, cancellationToken).ConfigureAwait(false);
            if (item is Episode { Series: not null } episode)
            {
                var seriesLock = _itemLocks.GetOrAdd(episode.Series.Id, static _ => new SemaphoreSlim(1, 1));
                await seriesLock.WaitAsync(cancellationToken).ConfigureAwait(false);
                try
                {
                    _cache[episode.Series.Id] = await CalculateItemAsync(episode.Series, cancellationToken).ConfigureAwait(false);
                }
                finally
                {
                    seriesLock.Release();
                }
            }
        }
        finally
        {
            itemLock.Release();
        }
    }

    private Task<CommunityItemStats> CalculateItemAsync(BaseItem item, CancellationToken cancellationToken)
    {
        cancellationToken.ThrowIfCancellationRequested();
        var users = GetEligibleUsers();
        var excludedNames = GetExcludedNames();
        var itemStates = GetItemStates(item, users);
        if (item is not Series series)
        {
            return Task.FromResult(CommunityRatingAggregator.AggregateItem(item.Id, itemStates, excludedNames));
        }

        var episodes = _libraryManager.GetItemList(new InternalItemsQuery
        {
            ParentId = series.Id,
            IncludeItemTypes = [BaseItemKind.Episode],
            Recursive = true,
            EnableTotalRecordCount = false
        });
        var episodeStates = episodes.SelectMany(episode => GetItemStates(episode, users)
            .Select(state => (state.UserName, state.IsDisabled, state.IsPlayed)));
        return Task.FromResult(CommunityRatingAggregator.AggregateSeries(series.Id, itemStates, episodeStates, excludedNames));
    }

    private List<User> GetEligibleUsers()
    {
        var excludedNames = GetExcludedNames();
        return _userManager.GetUsers()
            .Where(user => _userManager.GetUserDto(user, string.Empty).Policy?.IsDisabled != true
                && !excludedNames.Contains(user.Username))
            .ToList();
    }

    private HashSet<string> GetExcludedNames() =>
        CommunityRatingAggregator.ParseExcludedUserNames(Plugin.Instance?.Configuration.ExcludedUserNames);

    private UserItemState[] GetItemStates(BaseItem item, IReadOnlyList<User> users) =>
        users.Select(user =>
        {
            var data = _userDataManager.GetUserData(user, item);
            return new UserItemState(user.Username, false, data?.Played == true, data?.IsFavorite == true);
        }).ToArray();

    private static bool IsSupported(BaseItem item) => item is Movie or Series or Episode;
}
