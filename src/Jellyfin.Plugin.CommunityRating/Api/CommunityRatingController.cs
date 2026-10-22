using System.Reflection;
using System.Runtime.Loader;
using System.Text;
using Jellyfin.Plugin.CommunityRating.Configuration;
using Jellyfin.Plugin.CommunityRating.Services;
using MediaBrowser.Common.Api;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;

namespace Jellyfin.Plugin.CommunityRating.Api;

/// <summary>Endpoints for aggregate community markers and the client-side renderer.</summary>
[ApiController]
[Route("CommunityRating")]
public sealed class CommunityRatingController(CommunityStatsService statsService) : ControllerBase
{
    private const int MaximumBatchSize = 100;

    /// <summary>Gets aggregate counters for movies, series, and episodes.</summary>
    /// <param name="ids">The requested Jellyfin item identifiers.</param>
    /// <param name="cancellationToken">The request cancellation token.</param>
    /// <returns>Counts and safe presentation settings.</returns>
    [HttpGet("Items")]
    [Authorize]
    [ProducesResponseType<CommunityStatsResponse>(StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status400BadRequest)]
    public async Task<ActionResult<CommunityStatsResponse>> GetItems([FromQuery(Name = "ids")] Guid[]? ids, CancellationToken cancellationToken)
    {
        if (ids is null || ids.Length == 0 || ids.Length > MaximumBatchSize)
        {
            return BadRequest("Request between 1 and 100 item ids.");
        }

        var config = Plugin.Instance?.Configuration ?? new PluginConfiguration();
        var items = await statsService.GetStatsAsync(ids, cancellationToken).ConfigureAwait(false);
        return Ok(new CommunityStatsResponse(items.Select(CommunityItemCounts.FromStats).ToArray(), ToDisplayOptions(config)));
    }

    /// <summary>Gets the client renderer for JavaScript Injector.</summary>
    /// <returns>JavaScript source.</returns>
    [HttpGet("client.js")]
    [AllowAnonymous]
    [Produces("application/javascript")]
    public IActionResult GetClientScript()
    {
        const string resourceName = "Jellyfin.Plugin.CommunityRating.Web.community-rating.js";
        using var stream = typeof(CommunityRatingController).Assembly.GetManifestResourceStream(resourceName);
        if (stream is null)
        {
            return NotFound();
        }

        using var reader = new StreamReader(stream, Encoding.UTF8);
        return Content(reader.ReadToEnd(), "application/javascript", Encoding.UTF8);
    }

    /// <summary>Gets per-account marker names for administrator-only tooltips.</summary>
    /// <param name="ids">The requested Jellyfin item identifiers.</param>
    /// <param name="cancellationToken">The request cancellation token.</param>
    /// <returns>Names associated with the requested view and favorite markers.</returns>
    [HttpGet("Admin/Items")]
    [Authorize(Policy = Policies.RequiresElevation)]
    [ProducesResponseType(StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status400BadRequest)]
    [ProducesResponseType(StatusCodes.Status403Forbidden)]
    public async Task<IActionResult> GetAdminItems([FromQuery(Name = "ids")] Guid[]? ids, CancellationToken cancellationToken)
    {
        if (Plugin.Instance?.Configuration.EnableAdminTooltips != true)
        {
            return Forbid();
        }

        if (ids is null || ids.Length == 0 || ids.Length > MaximumBatchSize)
        {
            return BadRequest("Request between 1 and 100 item ids.");
        }

        var items = await statsService.GetAdminStatsAsync(ids, cancellationToken).ConfigureAwait(false);
        return Ok(items);
    }

    private static CommunityDisplayOptions ToDisplayOptions(PluginConfiguration config) => new(
        config.EnableBadges,
        Math.Clamp(config.BadgeScale, 12, 28),
        Math.Clamp(config.BadgeInsetX, 0, 32),
        Math.Clamp(config.BadgeInsetY, 0, 32),
        Math.Clamp(config.BackgroundOpacity, 0, 90),
        config.EnableAdminTooltips,
        config.StackCardBadges,
        double.IsFinite(config.DetailScaleFactor) ? Math.Clamp(config.DetailScaleFactor, 1, 3) : 1);
}
