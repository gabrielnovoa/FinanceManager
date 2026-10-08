using System.ClientModel;
using System.Text.Json;
using FinanceManager.Api.Data;
using FinanceManager.Api.Models;
using FinanceManager.Api.Services.Ai;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;

namespace FinanceManager.Api.Controllers;

/// <summary>
/// The AI assistant and its conversation history. Conversations are stored per user:
/// every query below is filtered on <see cref="Owner"/>, so one user can neither see
/// nor delete another's.
/// </summary>
[ApiController]
[Route("api/chat")]
public class ChatController(AppDbContext db, FinanceAssistant assistant, ILogger<ChatController> logger) : ControllerBase
{
    private const int MaxQuestionLength = 8000;
    private const int MaxTitleLength = 80;
    private static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web);

    /// <summary>
    /// The signed-in user, from the header App Service Authentication (Easy Auth) adds to
    /// every request. App Service strips that header from incoming client requests, so it
    /// is only trusted when Easy Auth is actually on; otherwise — locally — everything
    /// belongs to a single "local" user.
    /// </summary>
    private string Owner =>
        Environment.GetEnvironmentVariable("WEBSITE_AUTH_ENABLED") is { } on
        && on.Equals("true", StringComparison.OrdinalIgnoreCase)
        && Request.Headers["X-MS-CLIENT-PRINCIPAL-ID"].FirstOrDefault() is { Length: > 0 } id
            ? id
            : "local";

    [HttpGet("status")]
    public ChatStatusDto Status() => new(assistant.Enabled, assistant.Model, assistant.Enabled && assistant.WebSearch);

    [HttpGet("conversations")]
    public async Task<List<ConversationSummaryDto>> Conversations(CancellationToken ct)
    {
        var owner = Owner;
        var rows = await db.ChatConversations
            .Where(c => c.Owner == owner)
            .OrderByDescending(c => c.UpdatedAt)
            .Select(c => new { c.Id, c.Title, c.CreatedAt, c.UpdatedAt, Count = c.Messages.Count })
            .ToListAsync(ct);
        return rows.Select(c => new ConversationSummaryDto(c.Id, c.Title, Utc(c.CreatedAt), Utc(c.UpdatedAt), c.Count)).ToList();
    }

    [HttpGet("conversations/{id:int}")]
    public async Task<ActionResult<ConversationDto>> Conversation(int id, CancellationToken ct)
    {
        var owner = Owner;
        var conversation = await db.ChatConversations.AsNoTracking()
            .Include(c => c.Messages.OrderBy(m => m.Id))
            .FirstOrDefaultAsync(c => c.Id == id && c.Owner == owner, ct);
        if (conversation is null) return NotFound(new { message = "Conversation not found." });

        return new ConversationDto(conversation.Id, conversation.Title,
            conversation.Messages.Select(ToDto).ToList());
    }

    /// <summary>Deletes the given conversations (only those owned by the caller) with their messages.</summary>
    [HttpPost("conversations/delete")]
    public async Task<ActionResult<object>> Delete([FromBody] DeleteConversationsDto request, CancellationToken ct)
    {
        var owner = Owner;
        var ids = (request.Ids ?? []).Distinct().ToList();
        if (ids.Count == 0) return new { deleted = 0 };

        var mine = await db.ChatConversations
            .Where(c => ids.Contains(c.Id) && c.Owner == owner)
            .Select(c => c.Id)
            .ToListAsync(ct);

        await using var tx = await db.Database.BeginTransactionAsync(ct);
        await db.ChatMessages.Where(m => mine.Contains(m.ConversationId)).ExecuteDeleteAsync(ct);
        var deleted = await db.ChatConversations.Where(c => mine.Contains(c.Id)).ExecuteDeleteAsync(ct);
        await tx.CommitAsync(ct);
        return new { deleted };
    }

    /// <summary>
    /// Asks the assistant. Continues <c>ConversationId</c> when given, otherwise starts a
    /// new conversation. The question and the answer are only stored once the answer
    /// exists, so a failed call leaves no half-finished exchange behind.
    /// </summary>
    [HttpPost]
    public async Task<ActionResult<ChatResponseDto>> Ask([FromBody] ChatRequestDto request, CancellationToken ct)
    {
        if (!assistant.Enabled)
            return StatusCode(StatusCodes.Status503ServiceUnavailable,
                new { message = "The AI assistant is not configured. Set AI:Endpoint and AI:Deployment." });

        var question = request.Message?.Trim() ?? "";
        if (question.Length == 0) return BadRequest(new { message = "The message is empty." });
        if (question.Length > MaxQuestionLength) question = question[..MaxQuestionLength];

        var owner = Owner;
        ChatConversation conversation;
        if (request.ConversationId is { } id)
        {
            var existing = await db.ChatConversations
                .Include(c => c.Messages.OrderBy(m => m.Id))
                .FirstOrDefaultAsync(c => c.Id == id && c.Owner == owner, ct);
            if (existing is null) return NotFound(new { message = "Conversation not found." });
            conversation = existing;
        }
        else
        {
            conversation = new ChatConversation { Owner = owner, Title = TitleFrom(question), CreatedAt = DateTime.UtcNow };
            db.ChatConversations.Add(conversation);
        }

        var history = conversation.Messages
            .Select(m => new ChatTurn(m.Role, m.Content))
            .Append(new ChatTurn("user", question))
            .ToList();

        AssistantReply reply;
        try
        {
            reply = await assistant.AskAsync(db, history, request.Language ?? "en", ct);
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

        var now = DateTime.UtcNow;
        var details = new MessageDetails(
            reply.Queries.Select(q => new ChatQueryDto(q.Sql, q.RowCount, q.Error)).ToList(),
            reply.WebSearches.ToList(),
            reply.Sources.Select(s => new ChatSourceDto(s.Title, s.Url)).ToList());
        conversation.Messages.Add(new ChatMessageEntry { Role = "user", Content = question, CreatedAt = now });
        var answer = new ChatMessageEntry
        {
            Role = "assistant",
            Content = reply.Reply,
            Details = JsonSerializer.Serialize(details, Json),
            CreatedAt = now,
        };
        conversation.Messages.Add(answer);
        conversation.UpdatedAt = now;
        await db.SaveChangesAsync(ct);

        return new ChatResponseDto(conversation.Id, conversation.Title, ToDto(answer));
    }

    // ---- helpers ----

    private static ChatMessageDto ToDto(ChatMessageEntry m)
    {
        var details = m.Details is { Length: > 0 } json
            ? JsonSerializer.Deserialize<MessageDetails>(json, Json)
            : null;
        return new ChatMessageDto(m.Id, m.Role, m.Content, Utc(m.CreatedAt),
            details?.Queries ?? [], details?.WebSearches ?? [], details?.Sources ?? []);
    }

    /// <summary>Stored as UTC; SQLite hands it back unmarked, which would serialise without the Z.</summary>
    private static DateTime Utc(DateTime value) => DateTime.SpecifyKind(value, DateTimeKind.Utc);

    private static string TitleFrom(string question)
    {
        var line = string.Join(' ', question.Split((char[])['\r', '\n', '\t', ' '], StringSplitOptions.RemoveEmptyEntries));
        return line.Length <= MaxTitleLength ? line : line[..(MaxTitleLength - 1)].TrimEnd() + "…";
    }

    private sealed record MessageDetails(List<ChatQueryDto> Queries, List<string> WebSearches, List<ChatSourceDto> Sources);
}

public record ChatRequestDto(int? ConversationId, string? Message, string? Language);
public record ChatQueryDto(string Sql, int? RowCount, string? Error);
public record ChatSourceDto(string Title, string Url);
public record ChatMessageDto(
    int Id, string Role, string Content, DateTime CreatedAt,
    List<ChatQueryDto> Queries, List<string> WebSearches, List<ChatSourceDto> Sources);
public record ChatResponseDto(int ConversationId, string Title, ChatMessageDto Message);
public record ChatStatusDto(bool Enabled, string? Model, bool WebSearch);
public record ConversationSummaryDto(int Id, string Title, DateTime CreatedAt, DateTime UpdatedAt, int MessageCount);
public record ConversationDto(int Id, string Title, List<ChatMessageDto> Messages);
public record DeleteConversationsDto(List<int>? Ids);
