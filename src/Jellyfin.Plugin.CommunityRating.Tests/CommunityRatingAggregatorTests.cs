using Jellyfin.Plugin.CommunityRating.Core;

namespace Jellyfin.Plugin.CommunityRating.Tests;

public sealed class CommunityRatingAggregatorTests
{
    [Fact]
    public void AggregateItemCountsActiveIncludedUsersOnce()
    {
        var itemId = Guid.NewGuid();
        var result = CommunityRatingAggregator.AggregateItem(
            itemId,
            [
                new UserItemState("Alpha", false, true, true),
                new UserItemState("Beta", false, true, false),
                new UserItemState("Gamma", false, false, false),
                new UserItemState("Excluded", false, true, true),
                new UserItemState("Disabled", true, true, true)
            ],
            [" excluded "]);

        Assert.Equal(itemId, result.ItemId);
        Assert.Equal(2, result.ViewCount);
        Assert.Equal(1, result.LikeCount);
        Assert.Equal(["Alpha", "Beta"], result.ViewedBy);
        Assert.Equal(["Alpha"], result.LikedBy);
    }

    [Fact]
    public void AggregateSeriesCountsEachAccountOnceAcrossManyEpisodes()
    {
        var seriesId = Guid.NewGuid();
        var result = CommunityRatingAggregator.AggregateSeries(
            seriesId,
            [
                new UserItemState("Alpha", false, false, false),
                new UserItemState("Beta", false, false, true),
                new UserItemState("Gamma", false, false, false)
            ],
            [
                ("Alpha", false, true),
                ("Alpha", false, true),
                ("Beta", false, true),
                ("Excluded", false, true),
                ("Disabled", true, true)
            ],
            ["Excluded"]);

        Assert.Equal(2, result.ViewCount);
        Assert.Equal(1, result.LikeCount);
        Assert.Equal(["Alpha", "Beta"], result.ViewedBy);
        Assert.Equal(["Beta"], result.LikedBy);
    }

    [Fact]
    public void ParseExcludedNamesTrimsEmptyEntriesAndIgnoresCase()
    {
        var names = CommunityRatingAggregator.ParseExcludedUserNames(" Alpha, ,beta,ALPHA ");

        Assert.Equal(2, names.Count);
        Assert.Contains("alpha", names);
        Assert.Contains("BETA", names);
    }

    [Fact]
    public void AggregateItemReturnsZeroCountsForNoMarkers()
    {
        var result = CommunityRatingAggregator.AggregateItem(
            Guid.NewGuid(),
            [new UserItemState("Alpha", false, false, false)],
            []);

        Assert.Equal(0, result.ViewCount);
        Assert.Equal(0, result.LikeCount);
        Assert.Empty(result.ViewedBy);
        Assert.Empty(result.LikedBy);
    }
}
