using Jellyfin.Plugin.CommunityRating.Services;
using MediaBrowser.Model.Tasks;

namespace Jellyfin.Plugin.CommunityRating.ScheduledTasks;

/// <summary>Reconciles cached community statistics against Jellyfin user data.</summary>
public sealed class RebuildCommunityStatsTask(CommunityStatsService statsService) : IScheduledTask, IConfigurableScheduledTask
{
    /// <inheritdoc />
    public string Name => "Rebuild Community Rating statistics";

    /// <inheritdoc />
    public string Key => "CommunityRatingRebuild";

    /// <inheritdoc />
    public string Description => "Rebuild aggregated views and favorites for movies, series, and episodes.";

    /// <inheritdoc />
    public string Category => "Community Rating";

    /// <inheritdoc />
    public bool IsHidden => false;

    /// <inheritdoc />
    public bool IsEnabled => true;

    /// <inheritdoc />
    public bool IsLogged => true;

    /// <inheritdoc />
    public Task ExecuteAsync(IProgress<double> progress, CancellationToken cancellationToken) =>
        statsService.RebuildAsync(progress, cancellationToken);

    /// <inheritdoc />
    public IEnumerable<TaskTriggerInfo> GetDefaultTriggers()
    {
        var intervalHours = Plugin.Instance?.Configuration.RefreshIntervalHours == 1 ? 1 : 6;
        yield return new TaskTriggerInfo
        {
            Type = TaskTriggerInfoType.IntervalTrigger,
            IntervalTicks = TimeSpan.FromHours(intervalHours).Ticks
        };
    }
}
