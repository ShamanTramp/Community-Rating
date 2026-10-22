using System.Reflection;
using System.Text.Json;
using Jellyfin.Plugin.CommunityRating.Api;
using Jellyfin.Plugin.CommunityRating.Configuration;
using Jellyfin.Plugin.CommunityRating.Core;
using MediaBrowser.Common.Api;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace Jellyfin.Plugin.CommunityRating.Tests;

public sealed class CommunityApiContractTests
{
    [Fact]
    public void PublicResponseCannotSerializeMemberNames()
    {
        var stats = new CommunityItemStats(Guid.NewGuid(), 2, 1, ["PrivateAlpha", "PrivateBeta"], ["PrivateAlpha"]);
        var response = new CommunityStatsResponse([CommunityItemCounts.FromStats(stats)], new(true, 16, 3, 8, 45, true, false, 1.25));
        var json = JsonSerializer.Serialize(response);

        using var document = JsonDocument.Parse(json);
        var item = document.RootElement.GetProperty("Items")[0];
        Assert.Equal(2, item.GetProperty("ViewCount").GetInt32());
        Assert.Equal(1, item.GetProperty("LikeCount").GetInt32());
        Assert.Equal(3, item.EnumerateObject().Count());
        Assert.Equal(1.25, document.RootElement.GetProperty("Options").GetProperty("DetailScaleFactor").GetDouble());
        Assert.DoesNotContain("Private", json);
        Assert.DoesNotContain("ViewedBy", json);
        Assert.DoesNotContain("LikedBy", json);
    }

    [Fact]
    public void MemberNamesRequireElevatedAccess()
    {
        var method = typeof(CommunityRatingController).GetMethod(nameof(CommunityRatingController.GetAdminItems))!;
        Assert.Equal(Policies.RequiresElevation, method.GetCustomAttribute<AuthorizeAttribute>()?.Policy);
        Assert.Null(method.GetCustomAttribute<AllowAnonymousAttribute>());
    }

    [Fact]
    public async Task MemberNamesAreForbiddenWhenFeatureIsDisabled()
    {
        var controller = new CommunityRatingController(null!);
        var result = await controller.GetAdminItems([Guid.NewGuid()], CancellationToken.None);
        Assert.IsType<ForbidResult>(result);
    }

    [Fact]
    public async Task PublicEndpointRejectsOversizedBatchesBeforeReadingStats()
    {
        var controller = new CommunityRatingController(null!);
        var result = await controller.GetItems(Enumerable.Range(0, 101).Select(_ => Guid.NewGuid()).ToArray(), CancellationToken.None);
        Assert.IsType<BadRequestObjectResult>(result.Result);
    }

    [Fact]
    public void DefaultsUseOneLineAndHideAdministratorTooltips()
    {
        var config = new PluginConfiguration();
        Assert.False(config.StackCardBadges);
        Assert.False(config.EnableAdminTooltips);
        Assert.Equal(3, config.BadgeInsetX);
        Assert.Equal(8, config.BadgeInsetY);
        Assert.Equal(1d, config.DetailScaleFactor);
    }
}
