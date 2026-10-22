using Jellyfin.Plugin.CommunityRating.Services;
using MediaBrowser.Controller;
using MediaBrowser.Controller.Plugins;
using Microsoft.Extensions.DependencyInjection;

namespace Jellyfin.Plugin.CommunityRating;

/// <summary>Registers Community Rating services with Jellyfin's dependency injection container.</summary>
public sealed class PluginServiceRegistrator : IPluginServiceRegistrator
{
    /// <inheritdoc />
    public void RegisterServices(IServiceCollection serviceCollection, IServerApplicationHost applicationHost)
    {
        serviceCollection.AddSingleton<CommunityStatsService>();
        serviceCollection.AddHostedService(services => services.GetRequiredService<CommunityStatsService>());
        serviceCollection.AddHostedService<JavaScriptInjectorBridge>();
    }
}
