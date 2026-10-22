using Jellyfin.Plugin.CommunityRating.Core;

namespace Jellyfin.Plugin.CommunityRating.Api;

/// <summary>Public aggregate response and safe client display settings.</summary>
public sealed record CommunityStatsResponse(
    IReadOnlyList<CommunityItemCounts> Items,
    CommunityDisplayOptions Options);

/// <summary>Public aggregate counts without per-account data.</summary>
public sealed record CommunityItemCounts(Guid ItemId, int ViewCount, int LikeCount)
{
    /// <summary>Projects internal statistics onto the public response.</summary>
    public static CommunityItemCounts FromStats(CommunityItemStats stats) =>
        new(stats.ItemId, stats.ViewCount, stats.LikeCount);
}

/// <summary>Display settings safe to expose to authenticated Jellyfin users.</summary>
public sealed record CommunityDisplayOptions(
    bool Enabled,
    int BadgeScale,
    int BadgeInsetX,
    int BadgeInsetY,
    int BackgroundOpacity,
    bool AdminTooltipsEnabled,
    bool StackCardBadges);
