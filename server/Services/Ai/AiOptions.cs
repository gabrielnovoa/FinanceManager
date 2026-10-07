namespace FinanceManager.Api.Services.Ai;

/// <summary>
/// "AI" configuration section. The assistant is switched off until an endpoint and a
/// deployment are set, so the rest of the app runs fine without any AI resource.
/// </summary>
public class AiOptions
{
    public const string Section = "AI";

    /// <summary>Azure OpenAI / Foundry resource endpoint, e.g. https://my-resource.openai.azure.com/</summary>
    public string? Endpoint { get; set; }

    /// <summary>Name of the model deployment, e.g. gpt-5.4-mini.</summary>
    public string? Deployment { get; set; }

    /// <summary>
    /// Optional key. Leave empty to authenticate with Microsoft Entra ID instead —
    /// the App Service managed identity in Azure, your <c>az login</c> locally.
    /// </summary>
    public string? ApiKey { get; set; }

    /// <summary>
    /// Optional Entra tenant of the AI resource. Set it locally when your machine is also
    /// signed in to other tenants (e.g. a work account in Visual Studio), so the token is
    /// requested from the right one. Ignored by the managed identity in Azure.
    /// </summary>
    public string? TenantId { get; set; }

    /// <summary>
    /// Lets the model search the web (Azure OpenAI's built-in web search, backed by Grounding
    /// with Bing). Queries then leave Azure's compliance boundary and are billed per search;
    /// the prompt tells the model never to include personal data in them.
    /// </summary>
    public bool WebSearch { get; set; } = true;

    public bool IsConfigured => !string.IsNullOrWhiteSpace(Endpoint) && !string.IsNullOrWhiteSpace(Deployment);
}
