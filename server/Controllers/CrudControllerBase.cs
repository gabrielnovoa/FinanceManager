using FinanceManager.Api.Data;
using FinanceManager.Api.Models;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;

namespace FinanceManager.Api.Controllers;

/// <summary>
/// Generic create / read / update / delete for a single entity type.
/// Concrete controllers just supply the sort order via <see cref="Query"/>.
/// </summary>
[ApiController]
[Route("api/[controller]")]
public abstract class CrudControllerBase<T> : ControllerBase where T : BaseEntity
{
    protected readonly AppDbContext Db;
    protected DbSet<T> Set => Db.Set<T>();

    protected CrudControllerBase(AppDbContext db) => Db = db;

    /// <summary>Base query used by GetAll — override to control ordering.</summary>
    protected virtual IQueryable<T> Query() => Set;

    /// <summary>
    /// Last chance to adjust an entity before it is written. Override to derive
    /// calculated columns so they cannot be set from the client.
    /// </summary>
    protected virtual void OnSaving(T entity) { }

    [HttpGet]
    public async Task<ActionResult<IEnumerable<T>>> GetAll()
        => await Query().ToListAsync();

    [HttpGet("{id:int}")]
    public async Task<ActionResult<T>> Get(int id)
    {
        var entity = await Set.FindAsync(id);
        return entity is null ? NotFound() : entity;
    }

    [HttpPost]
    public async Task<ActionResult<T>> Create(T entity)
    {
        entity.Id = 0; // never trust a client-supplied id
        OnSaving(entity);
        Set.Add(entity);
        await Db.SaveChangesAsync();
        return Created($"/api/{ControllerContext.ActionDescriptor.ControllerName}/{entity.Id}", entity);
    }

    [HttpPut("{id:int}")]
    public async Task<IActionResult> Update(int id, T entity)
    {
        if (id != entity.Id) return BadRequest("Route id and body id do not match.");
        if (!await Set.AnyAsync(e => e.Id == id)) return NotFound();

        OnSaving(entity);
        Db.Entry(entity).State = EntityState.Modified;
        await Db.SaveChangesAsync();
        return NoContent();
    }

    [HttpDelete("{id:int}")]
    public async Task<IActionResult> Delete(int id)
    {
        var entity = await Set.FindAsync(id);
        if (entity is null) return NotFound();

        Set.Remove(entity);
        await Db.SaveChangesAsync();
        return NoContent();
    }
}
