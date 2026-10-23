namespace Jellyfin.Plugin.CommunityRating.Core;

/// <summary>Combines per-account Jellyfin markers without retaining account identifiers.</summary>
public static class CommunityRatingAggregator
{
    /// <summary>Aggregates views and favorites for one item.</summary>
    /// <param name="itemId">The Jellyfin item identifier.</param>
    /// <param name="states">The current user data for the item.</param>
    /// <param name="excludedUserNames">User names excluded from the totals.</param>
    /// <returns>The aggregate counts and optional user names for the administrator-only endpoint.</returns>
    public static CommunityItemStats AggregateItem(
        Guid itemId,
        IEnumerable<UserItemState> states,
        IEnumerable<string> excludedUserNames)
    {
        var excluded = CreateExcludedSet(excludedUserNames);
        var eligible = states
            .Where(state => !state.IsDisabled && !excluded.Contains(state.UserName))
            .ToArray();

        var viewedBy = eligible
            .Where(state => state.IsPlayed)
            .Select(state => state.UserName)
            .Distinct(StringComparer.OrdinalIgnoreCase)
            .OrderBy(name => name, StringComparer.OrdinalIgnoreCase)
            .ToArray();
        var likedBy = eligible
            .Where(state => state.IsFavorite)
            .Select(state => state.UserName)
            .Distinct(StringComparer.OrdinalIgnoreCase)
            .OrderBy(name => name, StringComparer.OrdinalIgnoreCase)
            .ToArray();

        var recommendedBy = eligible.Where(state => state.IsRecommended).Select(state => state.UserName)
            .Distinct(StringComparer.OrdinalIgnoreCase).OrderBy(name => name, StringComparer.OrdinalIgnoreCase).ToArray();
        var discouragedBy = eligible.Where(state => state.IsDiscouraged).Select(state => state.UserName)
            .Distinct(StringComparer.OrdinalIgnoreCase).OrderBy(name => name, StringComparer.OrdinalIgnoreCase).ToArray();

        return new CommunityItemStats(itemId, viewedBy.Length, likedBy.Length, viewedBy, likedBy, recommendedBy, discouragedBy);
    }

    /// <summary>Aggregates a series view once per account if any episode was marked played.</summary>
    /// <param name="seriesId">The series identifier.</param>
    /// <param name="seriesStates">Per-account user data for the series itself.</param>
    /// <param name="episodeStates">Per-account played states for the series episodes.</param>
    /// <param name="excludedUserNames">User names excluded from the totals.</param>
    /// <returns>The series aggregate.</returns>
    public static CommunityItemStats AggregateSeries(
        Guid seriesId,
        IEnumerable<UserItemState> seriesStates,
        IEnumerable<(string UserName, bool IsDisabled, bool IsPlayed, bool IsRecommended, bool IsDiscouraged)> episodeStates,
        IEnumerable<string> excludedUserNames)
    {
        var excluded = CreateExcludedSet(excludedUserNames);
        var eligibleSeriesStates = seriesStates
            .Where(state => !state.IsDisabled && !excluded.Contains(state.UserName))
            .GroupBy(state => state.UserName, StringComparer.OrdinalIgnoreCase)
            .ToDictionary(group => group.Key, group => group.First(), StringComparer.OrdinalIgnoreCase);

        var viewedBy = episodeStates
            .Where(state => !state.IsDisabled && !excluded.Contains(state.UserName) && state.IsPlayed)
            .Select(state => state.UserName)
            .Distinct(StringComparer.OrdinalIgnoreCase)
            .OrderBy(name => name, StringComparer.OrdinalIgnoreCase)
            .ToArray();

        var likedBy = eligibleSeriesStates.Values
            .Where(state => state.IsFavorite)
            .Select(state => state.UserName)
            .Distinct(StringComparer.OrdinalIgnoreCase)
            .OrderBy(name => name, StringComparer.OrdinalIgnoreCase)
            .ToArray();

        var eligibleEpisodeStates = episodeStates.Where(state => !state.IsDisabled && !excluded.Contains(state.UserName)).ToArray();
        var allNames = eligibleSeriesStates.Keys.Concat(eligibleEpisodeStates.Select(state => state.UserName))
            .Distinct(StringComparer.OrdinalIgnoreCase).ToArray();
        var recommendedBy = allNames.Where(name =>
                (eligibleSeriesStates.TryGetValue(name, out var direct) && direct.IsRecommended)
                || eligibleEpisodeStates.Any(state => string.Equals(state.UserName, name, StringComparison.OrdinalIgnoreCase) && state.IsRecommended))
            .OrderBy(name => name, StringComparer.OrdinalIgnoreCase).ToArray();
        var discouragedBy = allNames.Where(name =>
                (eligibleSeriesStates.TryGetValue(name, out var direct) && direct.IsDiscouraged)
                || eligibleEpisodeStates.Any(state => string.Equals(state.UserName, name, StringComparison.OrdinalIgnoreCase) && state.IsDiscouraged))
            .OrderBy(name => name, StringComparer.OrdinalIgnoreCase).ToArray();

        return new CommunityItemStats(seriesId, viewedBy.Length, likedBy.Length, viewedBy, likedBy, recommendedBy, discouragedBy);
    }

    /// <summary>Parses a comma-separated list of excluded user names.</summary>
    /// <param name="value">The configured names.</param>
    /// <returns>A case-insensitive set with empty names removed.</returns>
    public static HashSet<string> ParseExcludedUserNames(string? value) =>
        CreateExcludedSet((value ?? string.Empty).Split(',', StringSplitOptions.TrimEntries | StringSplitOptions.RemoveEmptyEntries));

    private static HashSet<string> CreateExcludedSet(IEnumerable<string> names) =>
        new(names.Select(name => name.Trim()).Where(name => name.Length > 0), StringComparer.OrdinalIgnoreCase);
}
