from __future__ import annotations

import logging
import os

import discord
from discord import app_commands
from discord.ext import commands
from dotenv import load_dotenv
from supabase import Client, create_client

load_dotenv()
logging.basicConfig(level=os.getenv("LOG_LEVEL", "INFO"), format="%(asctime)s %(levelname)s %(name)s: %(message)s")
log = logging.getLogger("blue-lock-db")

TOKEN = os.getenv("DISCORD_BOT_TOKEN", "").strip()
URL = os.getenv("SUPABASE_URL", "").strip()
SERVICE_KEY = os.getenv("SUPABASE_SERVICE_ROLE_KEY", "").strip()
ADMIN_USERS = {int(x.strip()) for x in os.getenv("DB_ADMIN_USER_IDS", "").split(",") if x.strip().isdigit()}
ADMIN_ROLES = {int(x.strip()) for x in os.getenv("DB_ADMIN_ROLE_IDS", "").split(",") if x.strip().isdigit()}
GUILD_ID = os.getenv("DISCORD_GUILD_ID", "").strip()

if not TOKEN:
    raise RuntimeError("DISCORD_BOT_TOKEN is missing")
if not URL or not SERVICE_KEY:
    raise RuntimeError("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required")
if not ADMIN_USERS and not ADMIN_ROLES:
    raise RuntimeError("Configure DB_ADMIN_USER_IDS or DB_ADMIN_ROLE_IDS")

db: Client = create_client(URL, SERVICE_KEY)
STAT_FIELDS = ("shot_acc", "shot_power", "passing", "weak_foot", "dribble", "control", "header", "tackle", "steal", "strength", "jump", "stamina", "speed", "game_read", "vision")
STAT_LABELS = ("Точность удара", "Сила удара", "Пас", "Слабая нога", "Дриблинг", "Контроль", "Игра головой", "Отбор", "Перехват", "Сила", "Прыжок", "Выносливость", "Скорость", "Чтение игры", "Видение поля")


def allowed(interaction: discord.Interaction) -> bool:
    if interaction.user.id in ADMIN_USERS:
        return True
    return isinstance(interaction.user, discord.Member) and any(r.id in ADMIN_ROLES for r in interaction.user.roles)


async def guard(interaction: discord.Interaction) -> bool:
    if allowed(interaction):
        return True
    msg = "У тебя нет прав на управление базой данных."
    if interaction.response.is_done():
        await interaction.followup.send(msg, ephemeral=True)
    else:
        await interaction.response.send_message(msg, ephemeral=True)
    return False


def num(value: str, label: str, low: int = 0, high: int = 100) -> int:
    try:
        result = int(value.strip())
    except (ValueError, AttributeError):
        raise ValueError(f"Поле «{label}» должно быть целым числом.")
    if result < low or result > high:
        raise ValueError(f"Поле «{label}» должно быть от {low} до {high}.")
    return result


def embed_player(row: dict) -> discord.Embed:
    e = discord.Embed(title=str(row.get("character_name") or "Без имени")[:250], description=f"Запись #{row.get('id')} · {row.get('name') or 'без ника'}", color=discord.Color.blue())
    e.add_field(name="Discord ID", value=str(row.get("discord_id", "—")), inline=True)
    e.add_field(name="Server ID", value=str(row.get("guild_id", "—")), inline=True)
    for key, label in zip(STAT_FIELDS, STAT_LABELS):
        e.add_field(name=label, value=str(row.get(key, 0)), inline=True)
    e.set_footer(text=f"Очки тренировки: {row.get('points_train', 0)} · практики: {row.get('points_practice', 0)}")
    return e


def fail(exc: Exception) -> str:
    log.exception("Database request failed", exc_info=exc)
    return "Ошибка базы данных. Проверь подключение и схему; детали записаны в лог."


class DeleteConfirm(discord.ui.View):
    def __init__(self, row_id: int):
        super().__init__(timeout=45)
        self.row_id = row_id

    @discord.ui.button(label="Да, удалить", style=discord.ButtonStyle.danger)
    async def confirm(self, interaction: discord.Interaction, button: discord.ui.Button):
        if not await guard(interaction):
            return
        try:
            result = db.table("characters").delete().eq("id", self.row_id).execute()
            await interaction.response.edit_message(content="Запись удалена." if result.data else "Запись не найдена.", embed=None, view=None)
        except Exception as exc:
            await interaction.response.send_message(fail(exc), ephemeral=True)

    @discord.ui.button(label="Отмена", style=discord.ButtonStyle.secondary)
    async def cancel(self, interaction: discord.Interaction, button: discord.ui.Button):
        await interaction.response.edit_message(content="Удаление отменено.", embed=None, view=None)


class EditPlayer(discord.ui.Modal, title="Редактирование персонажа"):
    character_name = discord.ui.TextInput(label="Имя персонажа", max_length=100)
    discord_name = discord.ui.TextInput(label="Имя / ник Discord", max_length=100)
    shot_acc = discord.ui.TextInput(label="Точность удара (0–100)", max_length=3)
    passing = discord.ui.TextInput(label="Пас (0–100)", max_length=3)
    weak_foot = discord.ui.TextInput(label="Слабая нога (0–5)", max_length=1)

    def __init__(self, row: dict):
        super().__init__()
        self.row_id = int(row["id"])
        self.character_name.default = str(row.get("character_name") or "")[:100]
        self.discord_name.default = str(row.get("name") or "")[:100]
        self.shot_acc.default = str(row.get("shot_acc", 0))
        self.passing.default = str(row.get("passing", 0))
        self.weak_foot.default = str(row.get("weak_foot", 0))

    async def on_submit(self, interaction: discord.Interaction):
        if not await guard(interaction):
            return
        try:
            patch = {
                "character_name": self.character_name.value.strip(),
                "name": self.discord_name.value.strip(),
                "shot_acc": num(self.shot_acc.value, "Точность удара"),
                "passing": num(self.passing.value, "Пас"),
                "weak_foot": num(self.weak_foot.value, "Слабая нога", 0, 5),
            }
            result = db.table("characters").update(patch).eq("id", self.row_id).execute()
            if not result.data:
                await interaction.response.send_message("Персонаж не найден.", ephemeral=True)
            else:
                await interaction.response.send_message("Карточка обновлена.", embed=embed_player(result.data[0]), ephemeral=True)
        except ValueError as exc:
            await interaction.response.send_message(str(exc), ephemeral=True)
        except Exception as exc:
            await interaction.response.send_message(fail(exc), ephemeral=True)


class CreatePlayer(discord.ui.Modal, title="Новый персонаж"):
    discord_id = discord.ui.TextInput(label="Discord ID игрока", max_length=20)
    guild_id = discord.ui.TextInput(label="Discord ID сервера", max_length=20)
    discord_name = discord.ui.TextInput(label="Имя / ник Discord", max_length=100)
    character_name = discord.ui.TextInput(label="Имя персонажа", max_length=100)

    async def on_submit(self, interaction: discord.Interaction):
        if not await guard(interaction):
            return
        try:
            payload = {
                "discord_id": num(self.discord_id.value, "Discord ID", 1, 9223372036854775807),
                "guild_id": num(self.guild_id.value, "Discord ID сервера", 1, 9223372036854775807),
                "name": self.discord_name.value.strip(),
                "character_name": self.character_name.value.strip(),
            }
            if not payload["name"] or not payload["character_name"]:
                raise ValueError("Оба имени обязательны.")
            result = db.table("characters").insert(payload).execute()
            await interaction.response.send_message("Персонаж создан.", embed=embed_player(result.data[0]), ephemeral=True)
        except ValueError as exc:
            await interaction.response.send_message(str(exc), ephemeral=True)
        except Exception as exc:
            await interaction.response.send_message("Не удалось создать персонажа: возможно, Discord ID уже используется. " + fail(exc), ephemeral=True)


class CreateTeam(discord.ui.Modal, title="Создание клуба"):
    name = discord.ui.TextInput(label="Название клуба", max_length=100)
    owner_id = discord.ui.TextInput(label="Discord ID капитана / владельца", max_length=20)
    budget = discord.ui.TextInput(label="Бюджет", default="1000000", max_length=16)

    async def on_submit(self, interaction: discord.Interaction):
        if not await guard(interaction):
            return
        try:
            payload = {"name": self.name.value.strip(), "owner_id": num(self.owner_id.value, "Discord ID", 1, 9223372036854775807), "budget": num(self.budget.value, "Бюджет", 0, 9000000000000000)}
            if not payload["name"]:
                raise ValueError("Название клуба обязательно.")
            row = db.table("teams").insert(payload).execute().data[0]
            await interaction.response.send_message(f"Создан клуб {row['name']} · ID {row['id']} · бюджет {row['budget']:,}".replace(",", " "), ephemeral=True)
        except ValueError as exc:
            await interaction.response.send_message(str(exc), ephemeral=True)
        except Exception as exc:
            await interaction.response.send_message("Не удалось создать клуб (возможно, название уже занято). " + fail(exc), ephemeral=True)


class SetCost(discord.ui.Modal, title="Стоимость игрока"):
    discord_id = discord.ui.TextInput(label="Discord ID игрока", max_length=20)
    cost = discord.ui.TextInput(label="Новая стоимость", max_length=16)

    async def on_submit(self, interaction: discord.Interaction):
        if not await guard(interaction):
            return
        try:
            player_id = num(self.discord_id.value, "Discord ID", 1, 9223372036854775807)
            cost = num(self.cost.value, "Стоимость", 0, 9000000000000000)
            existing = db.table("player_costs").select("id").eq("discord_id", player_id).execute().data
            if existing:
                db.table("player_costs").update({"cost": cost}).eq("discord_id", player_id).execute()
            else:
                db.table("player_costs").insert({"discord_id": player_id, "cost": cost}).execute()
            await interaction.response.send_message(f"Стоимость игрока {player_id}: {cost:,}".replace(",", " "), ephemeral=True)
        except ValueError as exc:
            await interaction.response.send_message(str(exc), ephemeral=True)
        except Exception as exc:
            await interaction.response.send_message(fail(exc), ephemeral=True)


class ResultsView(discord.ui.View):
    def __init__(self, rows: list[dict]):
        super().__init__(timeout=120)
        self.rows = rows[:25]
        options = [discord.SelectOption(label=str(r.get("character_name") or r.get("name") or f"#{r['id']}")[:100], description=f"ID {r['id']} · Discord {r.get('discord_id')}"[:100], value=str(r["id"])) for r in self.rows]
        select = discord.ui.Select(placeholder="Выбери персонажа", options=options)
        select.callback = self.choose
        self.add_item(select)

    async def choose(self, interaction: discord.Interaction):
        if not await guard(interaction):
            return
        row_id = int(interaction.data["values"][0])
        try:
            row = db.table("characters").select("*").eq("id", row_id).single().execute().data
            await interaction.response.edit_message(content=None, embed=embed_player(row), view=PlayerActions(row))
        except Exception as exc:
            await interaction.response.send_message(fail(exc), ephemeral=True)


class PlayerActions(discord.ui.View):
    def __init__(self, row: dict):
        super().__init__(timeout=180)
        self.row = row

    @discord.ui.button(label="Изменить", style=discord.ButtonStyle.primary)
    async def edit(self, interaction: discord.Interaction, button: discord.ui.Button):
        if not await guard(interaction):
            return
        await interaction.response.send_modal(EditPlayer(self.row))

    @discord.ui.button(label="Удалить", style=discord.ButtonStyle.danger)
    async def delete(self, interaction: discord.Interaction, button: discord.ui.Button):
        if not await guard(interaction):
            return
        await interaction.response.send_message(f"Удалить персонажа {self.row.get('character_name')} (ID {self.row['id']})?", view=DeleteConfirm(int(self.row["id"])), ephemeral=True)


class TeamPanel(discord.ui.View):
    @discord.ui.button(label="Создать клуб", style=discord.ButtonStyle.success)
    async def create(self, interaction: discord.Interaction, button: discord.ui.Button):
        if not await guard(interaction):
            return
        await interaction.response.send_modal(CreateTeam())


class MainPanel(discord.ui.View):
    @discord.ui.button(label="Игроки", style=discord.ButtonStyle.primary, row=0)
    async def players(self, interaction: discord.Interaction, button: discord.ui.Button):
        if not await guard(interaction):
            return
        try:
            rows = db.table("characters").select("id,name,character_name,discord_id,guild_id").order("id", desc=True).limit(15).execute().data or []
            if not rows:
                await interaction.response.send_message("Список персонажей пуст.", ephemeral=True)
                return
            e = discord.Embed(title="Последние персонажи", color=discord.Color.blue())
            for r in rows:
                e.add_field(name=f"#{r['id']} · {r.get('character_name') or 'Без имени'}", value=f"Discord ID: {r.get('discord_id')} · {r.get('name') or '—'}", inline=False)
            await interaction.response.send_message(embed=e, view=ResultsView(rows), ephemeral=True)
        except Exception as exc:
            await interaction.response.send_message(fail(exc), ephemeral=True)

    @discord.ui.button(label="Создать игрока", style=discord.ButtonStyle.success, row=0)
    async def create_player(self, interaction: discord.Interaction, button: discord.ui.Button):
        if not await guard(interaction):
            return
        await interaction.response.send_modal(CreatePlayer())

    @discord.ui.button(label="Поиск", style=discord.ButtonStyle.secondary, row=0)
    async def search(self, interaction: discord.Interaction, button: discord.ui.Button):
        if not await guard(interaction):
            return
        await interaction.response.send_message("Используй команду /players с именем, Discord ID или ID записи.", ephemeral=True)

    @discord.ui.button(label="Клубы", style=discord.ButtonStyle.primary, row=1)
    async def teams(self, interaction: discord.Interaction, button: discord.ui.Button):
        if not await guard(interaction):
            return
        try:
            rows = db.table("teams").select("id,name,owner_id,budget").order("name").limit(25).execute().data or []
            e = discord.Embed(title="Клубы", color=discord.Color.green())
            if not rows:
                e.description = "Клубов пока нет."
            for r in rows:
                e.add_field(name=f"#{r['id']} · {r['name']}", value=f"Владелец: {r['owner_id']} · бюджет: {r['budget']:,}".replace(",", " "), inline=False)
            await interaction.response.send_message(embed=e, view=TeamPanel(), ephemeral=True)
        except Exception as exc:
            await interaction.response.send_message(fail(exc), ephemeral=True)

    @discord.ui.button(label="Стоимость игрока", style=discord.ButtonStyle.secondary, row=1)
    async def cost(self, interaction: discord.Interaction, button: discord.ui.Button):
        if not await guard(interaction):
            return
        await interaction.response.send_modal(SetCost())

    @discord.ui.button(label="Трансферы", style=discord.ButtonStyle.secondary, row=1)
    async def transfers(self, interaction: discord.Interaction, button: discord.ui.Button):
        if not await guard(interaction):
            return
        try:
            rows = db.table("transfers").select("id,player_id,from_team_id,to_team_id,amount,status").order("id", desc=True).limit(10).execute().data or []
            e = discord.Embed(title="Последние трансферы", color=discord.Color.orange())
            if not rows:
                e.description = "Трансферов пока нет."
            for r in rows:
                e.add_field(name=f"#{r['id']} · {r['status']}", value=f"Игрок {r['player_id']}: {r.get('from_team_id') or '—'} → {r.get('to_team_id') or '—'} · сумма {r['amount']:,}".replace(",", " "), inline=False)
            await interaction.response.send_message(embed=e, ephemeral=True)
        except Exception as exc:
            await interaction.response.send_message(fail(exc), ephemeral=True)

    @discord.ui.button(label="Статистика", style=discord.ButtonStyle.secondary, row=1)
    async def stats(self, interaction: discord.Interaction, button: discord.ui.Button):
        if not await guard(interaction):
            return
        try:
            a = db.table("characters").select("id", count="exact").execute()
            b = db.table("teams").select("id", count="exact").execute()
            c = db.table("transfers").select("id", count="exact").execute()
            e = discord.Embed(title="Состояние базы", color=discord.Color.blurple())
            e.add_field(name="Персонажи", value=str(a.count or 0))
            e.add_field(name="Клубы", value=str(b.count or 0))
            e.add_field(name="Трансферы", value=str(c.count or 0))
            await interaction.response.send_message(embed=e, ephemeral=True)
        except Exception as exc:
            await interaction.response.send_message(fail(exc), ephemeral=True)


class ManagerBot(commands.Bot):
    async def setup_hook(self):
        if GUILD_ID.isdigit():
            guild = discord.Object(id=int(GUILD_ID))
            self.tree.copy_global_to(guild=guild)
            result = await self.tree.sync(guild=guild)
            log.info("Synced %s guild commands", len(result))
        else:
            result = await self.tree.sync()
            log.info("Synced %s global commands", len(result))


bot = ManagerBot(command_prefix="!", intents=discord.Intents.default())


@bot.event
async def on_ready():
    log.info("Ready as %s", bot.user)


@bot.tree.command(name="db", description="Открыть панель управления базой Blue Lock RP")
async def db_command(interaction: discord.Interaction):
    if not await guard(interaction):
        return
    e = discord.Embed(title="Blue Lock RP · Управление базой", description="Выбери раздел. Изменения затрагивают общую базу сайта.\n\nИгроки: просмотр, поиск, создание, редактирование и удаление.\nКлубы: просмотр и создание.\nСтоимость: изменение стоимости игрока.\nТрансферы и статистика: просмотр записей.", color=discord.Color.dark_blue())
    await interaction.response.send_message(embed=e, view=MainPanel(), ephemeral=True)


@bot.tree.command(name="players", description="Найти персонажей по имени, Discord ID или ID записи")
@app_commands.describe(query="Имя персонажа или числовой ID")
async def players_command(interaction: discord.Interaction, query: str):
    if not await guard(interaction):
        return
    try:
        if query.strip().isdigit():
            value = int(query.strip())
            rows = db.table("characters").select("*").or_(f"id.eq.{value},discord_id.eq.{value}").limit(10).execute().data or []
        else:
            safe = query.strip().replace("%", "").replace(",", " ").replace("(", " ").replace(")", " ")
            rows = db.table("characters").select("*").ilike("character_name", f"%{safe}%").limit(10).execute().data or []
        if not rows:
            await interaction.response.send_message("Ничего не найдено.", ephemeral=True)
        elif len(rows) == 1:
            await interaction.response.send_message(embed=embed_player(rows[0]), view=PlayerActions(rows[0]), ephemeral=True)
        else:
            await interaction.response.send_message(f"Найдено записей: {len(rows)}. Выбери нужную:", view=ResultsView(rows), ephemeral=True)
    except Exception as exc:
        await interaction.response.send_message(fail(exc), ephemeral=True)


@bot.tree.command(name="team", description="Показать список клубов")
async def team_command(interaction: discord.Interaction):
    if not await guard(interaction):
        return
    try:
        rows = db.table("teams").select("id,name,owner_id,budget").order("name").limit(25).execute().data or []
        e = discord.Embed(title="Клубы", color=discord.Color.green())
        if not rows:
            e.description = "Клубов пока нет."
        for r in rows:
            e.add_field(name=f"#{r['id']} · {r['name']}", value=f"Владелец {r['owner_id']} · бюджет {r['budget']:,}".replace(",", " "), inline=False)
        await interaction.response.send_message(embed=e, view=TeamPanel(), ephemeral=True)
    except Exception as exc:
        await interaction.response.send_message(fail(exc), ephemeral=True)


@bot.tree.command(name="transfers", description="Показать последние трансферы")
async def transfers_command(interaction: discord.Interaction):
    if not await guard(interaction):
        return
    try:
        rows = db.table("transfers").select("id,player_id,from_team_id,to_team_id,amount,status").order("id", desc=True).limit(10).execute().data or []
        e = discord.Embed(title="Последние трансферы", color=discord.Color.orange())
        if not rows:
            e.description = "Трансферов пока нет."
        for r in rows:
            e.add_field(name=f"#{r['id']} · {r['status']}", value=f"Игрок {r['player_id']} · {r.get('from_team_id') or '—'} → {r.get('to_team_id') or '—'} · {r['amount']:,}".replace(",", " "), inline=False)
        await interaction.response.send_message(embed=e, ephemeral=True)
    except Exception as exc:
        await interaction.response.send_message(fail(exc), ephemeral=True)



CAREER_FIELDS = {
    "goals": "Голы", "assists": "Голевые передачи", "saves": "Сейвы", "pushkas": "Пушкасы",
    "forward_of_season": "Лучший нападающий сезона", "midfielder_of_season": "Лучший полузащитник сезона",
    "defender_of_season": "Лучший защитник сезона", "golden_glove": "Золотая перчатка",
    "league_cup": "Кубок лиги", "mvp_season": "MVP сезона", "mvp_match": "MVP матча",
    "goals_outside_box": "Голы из-за штрафной", "penalties_scored": "Забитые пенальти",
}


@bot.tree.command(name="career", description="Посмотреть карьерную статистику игрока")
@app_commands.describe(discord_id="Discord ID игрока")
async def career_command(interaction: discord.Interaction, discord_id: str):
    if not await guard(interaction):
        return
    try:
        player_id = num(discord_id, "Discord ID", 1, 9223372036854775807)
        rows = db.table("career_stats").select("*").eq("discord_id", player_id).limit(1).execute().data or []
        if not rows:
            await interaction.response.send_message("Для игрока статистики пока нет. Используй /career-set, чтобы добавить значение.", ephemeral=True)
            return
        row = rows[0]
        embed = discord.Embed(title=f"Карьерная статистика · {player_id}", color=discord.Color.gold())
        for key, label in CAREER_FIELDS.items():
            embed.add_field(name=label, value=str(row.get(key, 0)), inline=True)
        await interaction.response.send_message(embed=embed, ephemeral=True)
    except ValueError as exc:
        await interaction.response.send_message(str(exc), ephemeral=True)
    except Exception as exc:
        await interaction.response.send_message(fail(exc), ephemeral=True)


@bot.tree.command(name="career-set", description="Изменить значение карьерной статистики")
@app_commands.describe(discord_id="Discord ID игрока", field="Статистика", value="Новое целое значение")
@app_commands.choices(field=[app_commands.Choice(name=label, value=key) for key, label in CAREER_FIELDS.items()])
async def career_set_command(interaction: discord.Interaction, discord_id: str, field: app_commands.Choice[str], value: str):
    if not await guard(interaction):
        return
    try:
        player_id = num(discord_id, "Discord ID", 1, 9223372036854775807)
        new_value = num(value, "Значение", 0, 2_000_000_000)
        existing = db.table("career_stats").select("id").eq("discord_id", player_id).execute().data or []
        if existing:
            db.table("career_stats").update({field.value: new_value}).eq("discord_id", player_id).execute()
        else:
            db.table("career_stats").insert({"discord_id": player_id, field.value: new_value}).execute()
        await interaction.response.send_message(f"{CAREER_FIELDS[field.value]} игрока {player_id}: **{new_value}**.", ephemeral=True)
    except ValueError as exc:
        await interaction.response.send_message(str(exc), ephemeral=True)
    except Exception as exc:
        await interaction.response.send_message(fail(exc), ephemeral=True)


@bot.tree.command(name="roster", description="Посмотреть состав клуба")
@app_commands.describe(team_id="ID клуба")
async def roster_command(interaction: discord.Interaction, team_id: str):
    if not await guard(interaction):
        return
    try:
        selected_team = num(team_id, "ID клуба", 1, 2_000_000_000)
        teams = db.table("teams").select("id,name").eq("id", selected_team).limit(1).execute().data or []
        if not teams:
            await interaction.response.send_message("Клуб не найден.", ephemeral=True)
            return
        players = db.table("team_players").select("discord_id,joined_at").eq("team_id", selected_team).order("joined_at").limit(50).execute().data or []
        embed = discord.Embed(title=f"Состав · {teams[0]['name']}", description=f"Клуб #{selected_team} · игроков: {len(players)}", color=discord.Color.green())
        embed.add_field(name="Discord ID игроков", value="\n".join(str(p["discord_id"]) for p in players) if players else "Состав пуст.", inline=False)
        await interaction.response.send_message(embed=embed, ephemeral=True)
    except ValueError as exc:
        await interaction.response.send_message(str(exc), ephemeral=True)
    except Exception as exc:
        await interaction.response.send_message(fail(exc), ephemeral=True)


@bot.tree.command(name="roster-add", description="Добавить зарегистрированного игрока в клуб")
@app_commands.describe(team_id="ID клуба", discord_id="Discord ID игрока")
async def roster_add_command(interaction: discord.Interaction, team_id: str, discord_id: str):
    if not await guard(interaction):
        return
    try:
        selected_team = num(team_id, "ID клуба", 1, 2_000_000_000)
        player_id = num(discord_id, "Discord ID", 1, 9223372036854775807)
        teams = db.table("teams").select("id,name").eq("id", selected_team).limit(1).execute().data or []
        if not teams:
            await interaction.response.send_message("Клуб не найден.", ephemeral=True)
            return
        characters = db.table("characters").select("discord_id").eq("discord_id", player_id).limit(1).execute().data or []
        if not characters:
            await interaction.response.send_message("Сначала зарегистрируй персонажа с этим Discord ID.", ephemeral=True)
            return
        db.table("team_players").insert({"team_id": selected_team, "discord_id": player_id}).execute()
        await interaction.response.send_message(f"Игрок {player_id} добавлен в клуб **{teams[0]['name']}**.", ephemeral=True)
    except ValueError as exc:
        await interaction.response.send_message(str(exc), ephemeral=True)
    except Exception as exc:
        await interaction.response.send_message("Не удалось добавить игрока: возможно, он уже состоит в клубе. " + fail(exc), ephemeral=True)


@bot.tree.command(name="roster-remove", description="Убрать игрока из состава клуба")
@app_commands.describe(discord_id="Discord ID игрока")
async def roster_remove_command(interaction: discord.Interaction, discord_id: str):
    if not await guard(interaction):
        return
    try:
        player_id = num(discord_id, "Discord ID", 1, 9223372036854775807)
        result = db.table("team_players").delete().eq("discord_id", player_id).execute()
        await interaction.response.send_message("Игрок исключён из состава." if result.data else "Игрок не найден в составах клубов.", ephemeral=True)
    except ValueError as exc:
        await interaction.response.send_message(str(exc), ephemeral=True)
    except Exception as exc:
        await interaction.response.send_message(fail(exc), ephemeral=True)


class SetTeamBudget(discord.ui.Modal, title="Изменение бюджета клуба"):
    team_id = discord.ui.TextInput(label="ID клуба", max_length=10)
    budget = discord.ui.TextInput(label="Новый бюджет", max_length=16)

    async def on_submit(self, interaction: discord.Interaction):
        if not await guard(interaction):
            return
        try:
            selected_team = num(self.team_id.value, "ID клуба", 1, 2_000_000_000)
            budget = num(self.budget.value, "Бюджет", 0, 9_000_000_000_000_000)
            result = db.table("teams").update({"budget": budget}).eq("id", selected_team).execute()
            if not result.data:
                await interaction.response.send_message("Клуб не найден.", ephemeral=True)
                return
            await interaction.response.send_message(f"Бюджет клуба **{result.data[0]['name']}** установлен: {budget:,}".replace(",", " "), ephemeral=True)
        except ValueError as exc:
            await interaction.response.send_message(str(exc), ephemeral=True)
        except Exception as exc:
            await interaction.response.send_message(fail(exc), ephemeral=True)


@bot.tree.command(name="team-budget", description="Изменить бюджет клуба через форму")
async def team_budget_command(interaction: discord.Interaction):
    if not await guard(interaction):
        return
    await interaction.response.send_modal(SetTeamBudget())


@bot.tree.command(name="stat-set", description="Изменить любую характеристику персонажа")
@app_commands.describe(discord_id="Discord ID игрока", stat="Характеристика", value="Новое значение от 0 до 100 (слабая нога: 0–5)")
@app_commands.choices(stat=[app_commands.Choice(name=label, value=key) for key, label in zip(STAT_FIELDS, STAT_LABELS)])
async def stat_set_command(interaction: discord.Interaction, discord_id: str, stat: app_commands.Choice[str], value: str):
    if not await guard(interaction):
        return
    try:
        player_id = num(discord_id, "Discord ID", 1, 9223372036854775807)
        maximum = 5 if stat.value == "weak_foot" else 100
        new_value = num(value, "Значение", 0, maximum)
        result = db.table("characters").update({stat.value: new_value}).eq("discord_id", player_id).execute()
        if not result.data:
            await interaction.response.send_message("Персонаж не найден.", ephemeral=True)
            return
        await interaction.response.send_message(f"«{stat.name}» игрока {player_id}: **{new_value}**.", ephemeral=True)
    except ValueError as exc:
        await interaction.response.send_message(str(exc), ephemeral=True)
    except Exception as exc:
        await interaction.response.send_message(fail(exc), ephemeral=True)


@bot.tree.command(name="points-set", description="Изменить очки тренировки или практики")
@app_commands.describe(discord_id="Discord ID игрока", points_type="Тип очков", value="Новое количество")
@app_commands.choices(points_type=[
    app_commands.Choice(name="Тренировочные очки", value="points_train"),
    app_commands.Choice(name="Очки практики", value="points_practice"),
])
async def points_set_command(interaction: discord.Interaction, discord_id: str, points_type: app_commands.Choice[str], value: str):
    if not await guard(interaction):
        return
    try:
        player_id = num(discord_id, "Discord ID", 1, 9223372036854775807)
        new_value = num(value, "Количество очков", 0, 2_000_000_000)
        result = db.table("characters").update({points_type.value: new_value}).eq("discord_id", player_id).execute()
        if not result.data:
            await interaction.response.send_message("Персонаж не найден.", ephemeral=True)
            return
        await interaction.response.send_message(f"{points_type.name} игрока {player_id}: **{new_value}**.", ephemeral=True)
    except ValueError as exc:
        await interaction.response.send_message(str(exc), ephemeral=True)
    except Exception as exc:
        await interaction.response.send_message(fail(exc), ephemeral=True)

if __name__ == "__main__":
    bot.run(TOKEN)
