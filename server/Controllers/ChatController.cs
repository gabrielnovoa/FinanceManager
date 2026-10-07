using System.ClientModel;
using FinanceManager.Api.Data;
using FinanceManager.Api.Services.Ai;
using Microsoft.AspNetCore.Mvc;

namespace FinanceManager.Api.Controllers;

[ApiController]
[Route("api/chat")]
public class ChatController(AppDbContext db, FinanceAssistant assistant, ILogger<ChatController> logger) : ControllerBase
{
    [HttpGet("status")]
    public ChatStatusDto Status() => new(assistant.Enabled, assistant.Model, assistant.Enabled && assistant.WebSearch);

    [HttpPost]
    public async Task<ActionResult<ChatResponseDto>> Ask([FromBody] ChatRequestDto request, CancellationToken ct)
    {
        if (!assistant.Enabled)
            return StatusCode(StatusCodes.Status503ServiceUnavailable,
                new { message = "The AI assistant is not configured. Set AI:Endpoint and AI:Deployment." });

        var history = (request.Messages ?? [])
            .Where(m => !string.IsNullOrWhiteSpace(m.Content) && m.Role is "user" or "assistant")
            .Select(m => new ChatTurn(m.Role, m.Content))
            .ToList();
        if (history.Count == 0 || history[^1].Role != "user")
            return BadRequest(new { message = "The last message must be from the user." });

        try
        {
            var reply = await assistant.AskAsync(db, history, request.Language ?? "en", ct);
            return new ChatResponseDto(
                reply.Reply,
                reply.Queries.Select(q => new ChatQueryDto(q.Sql, q.RowCount, q.Error)).ToList(),
                reply.WebSearches.ToList(),
                reply.Sources.Select(s => new ChatSourceDto(s.Title, s.Url)).ToList());
        }
        catch (ClientResultException ex)
        {
            logger.LogError(ex, "AI service call failed with status {Status}.", ex.Status);
            return StatusCode(StatusCodes.Status502BadGateway,
                new { message = $"The AI service returned an error ({ex.Status}). {ex.Message}" });
        }
        catch (Azure.Identity.AuthenticationFailedException ex)
        {
            logger.LogError(ex, "Could not get a token for the AI service.");
            return StatusCode(StatusCodes.Status502BadGateway,
                new { message = "Could not authenticate to the AI service. Run 'az login' locally, or check the app's managed identity." });
        }
    }
}

public record ChatMessageDto(string Role, string Content);
public record ChatRequestDto(List<ChatMessageDto>? Messages, string? Language);
public record ChatQueryDto(string Sql, int? RowCount, string? Error);
public record ChatSourceDto(string Title, string Url);
public record ChatResponseDto(string Reply, List<ChatQueryDto> Queries, List<string> WebSearches, List<ChatSourceDto> Sources);
public record ChatStatusDto(bool Enabled, string? Model, bool WebSearch);
