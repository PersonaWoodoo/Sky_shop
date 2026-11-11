require("dotenv").config();
const express = require("express");
const { Bot, InlineKeyboard, Keyboard, webhookCallback } = require("grammy");
const Database = require("better-sqlite3");
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const {
  BOT_TOKEN, ADMIN_ID, CHANNEL_USERNAME = "sky_shop001",
  CHANNEL_URL = "https://t.me/sky_shop001",
  SELLER_USERNAME = "Salamchik01", WEBAPP_URL = "",
  PORT = 3000, DATABASE_PATH = "./data/sky-shop.sqlite"
} = process.env;

if (!BOT_TOKEN || !ADMIN_ID) {
  console.error("Заполни BOT_TOKEN и ADMIN_ID в .env");
  process.exit(1);
}
const adminId = Number(ADMIN_ID);
const dbFile = path.resolve(DATABASE_PATH);
fs.mkdirSync(path.dirname(dbFile), { recursive: true });
const db = new Database(dbFile);
db.pragma("journal_mode = WAL");
db.exec(`
CREATE TABLE IF NOT EXISTS users(id INTEGER PRIMARY KEY, username TEXT, first_name TEXT, blocked INTEGER DEFAULT 0, created_at TEXT DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS products(id INTEGER PRIMARY KEY AUTOINCREMENT, title TEXT NOT NULL, price TEXT NOT NULL, order_text TEXT NOT NULL, photo_file_id TEXT, description TEXT, created_at TEXT DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS favorites(user_id INTEGER NOT NULL, product_id INTEGER NOT NULL, created_at TEXT DEFAULT CURRENT_TIMESTAMP, PRIMARY KEY(user_id, product_id));
CREATE TABLE IF NOT EXISTS settings(key TEXT PRIMARY KEY, value TEXT NOT NULL);
`);
const getSetting = (k, fallback="") => db.prepare("SELECT value FROM settings WHERE key=?").get(k)?.value ?? fallback;
const setSetting = (k,v) => db.prepare("INSERT INTO settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").run(k,String(v));
if (!getSetting("maintenance")) setSetting("maintenance","0");

const bot = new Bot(BOT_TOKEN);
const app = express();
app.use(express.json({limit:"2mb"}));
app.use(express.static(path.join(__dirname,"../public")));

const isAdmin = id => Number(id) === adminId;
function mainAdminKeyboard() {
  return new InlineKeyboard()
    .text("🟢 Добавить товар", "admin:add", {style:"success"}).row()
    .text("🔴 Убрать товар", "admin:remove", {style:"danger"})
    .text("🔵 Статистика", "admin:stats", {style:"primary"}).row()
    .text(getSetting("maintenance")==="1" ? "🟢 Выключить техработы" : "🟡 Включить техработы", "admin:maintenance", getSetting("maintenance")==="1" ? "success" : "primary");
}
function userKeyboard() {
  const k = new InlineKeyboard();
  if (WEBAPP_URL) k.webApp("🛍 ОТКРЫТЬ МАГАЗИН", WEBAPP_URL);
  else k.url("🛍 ОТКРЫТЬ МАГАЗИН", CHANNEL_URL);
  k.row().url("📢 Наш Telegram-канал", CHANNEL_URL);
  return k;
}
function cancelKeyboard() {
  return new InlineKeyboard().text("🔴 Отменить", "admin:cancel", {style:"danger"});
}
const sessions = new Map();
function startProduct(ctx) {
  sessions.set(ctx.from.id, { step: "title", product: {} });
  return ctx.reply("📝 Введи название товара:", cancelKeyboard());
}
bot.command("start", async ctx => {
  db.prepare(`INSERT INTO users(id,username,first_name,blocked) VALUES(?,?,?,0)
    ON CONFLICT(id) DO UPDATE SET username=excluded.username, first_name=excluded.first_name, blocked=0`)
    .run(ctx.from.id, ctx.from.username || "", ctx.from.first_name || "");
  if (isAdmin(ctx.from.id)) {
    return ctx.reply("⚙️ SKY SHOP — панель администратора", { reply_markup: mainAdminKeyboard() });
  }
  // Пытаемся отправить первый стикер набора UtyaDuckFull. Если набор недоступен — продолжаем без ошибки.
  try {
    const set = await ctx.api.getStickerSet("UtyaDuckFull");
    if (set.stickers?.length) await ctx.replyWithSticker(set.stickers[0].file_id);
  } catch (e) { console.warn("Не удалось получить приветственный стикер:", e.description || e.message); }
  return ctx.reply(
    "🦆 Привет! Ты попал в <b>SKY SHOP</b>!\n\nДобро пожаловать в магазин стильных находок. Здесь ты можешь посмотреть товары, добавить понравившееся в избранное и связаться с продавцом для оформления покупки.\n\n✨ Выбирай то, что нравится, а мы поможем с остальным. Приятных покупок!",
    { parse_mode: "HTML", reply_markup: userKeyboard() }
  );
});
bot.command("admin", async ctx => {
  if (!isAdmin(ctx.from.id)) return ctx.reply("⛔ Нет доступа.");
  return ctx.reply("⚙️ Панель администратора SKY SHOP", {reply_markup: mainAdminKeyboard()});
});

bot.callbackQuery(/^admin:/, async ctx => {
  if (!isAdmin(ctx.from.id)) return ctx.answerCallbackQuery({text:"Нет доступа",show_alert:true});
  const action = ctx.callbackQuery.data.split(":")[1];
  await ctx.answerCallbackQuery();
  if (action === "add") return startProduct(ctx);
  if (action === "remove") {
    sessions.set(ctx.from.id,{step:"remove"});
    return ctx.reply("Введи ID товара для удаления, например #001:", cancelKeyboard());
  }
  if (action === "stats") {
    const users = db.prepare("SELECT COUNT(*) n FROM users").get().n;
    const blocked = db.prepare("SELECT COUNT(*) n FROM users WHERE blocked=1").get().n;
    const products = db.prepare("SELECT COUNT(*) n FROM products").get().n;
    const favorites = db.prepare("SELECT COUNT(*) n FROM favorites").get().n;
    return ctx.reply(`📊 <b>Статистика SKY SHOP</b>\n\n👥 Пользователей бота: ${users}\n🚫 Известных блокировок: ${blocked}\n🛍 Товаров в магазине: ${products}\n❤️ Добавлений в избранное: ${favorites}\n\n<i>Telegram не предоставляет полный список заблокировавших бота, поэтому блокировки считаются только по известным ошибкам отправки.</i>`,{parse_mode:"HTML",reply_markup:mainAdminKeyboard()});
  }
  if (action === "maintenance") {
    const next = getSetting("maintenance")==="1" ? "0" : "1";
    setSetting("maintenance",next);
    return ctx.editMessageText(next==="1" ? "🛠 Технические работы включены. Магазин временно закрыт." : "✅ Технические работы выключены. Магазин снова доступен.", {reply_markup:mainAdminKeyboard()});
  }
  if (action === "cancel") {
    sessions.delete(ctx.from.id);
    return ctx.reply("Действие отменено.",{reply_markup:mainAdminKeyboard()});
  }
  if (action === "back") {
    sessions.delete(ctx.from.id);
    return ctx.reply("Панель администратора:",{reply_markup:mainAdminKeyboard()});
  }
  if (action === "save") {
    const s = sessions.get(ctx.from.id);
    if (!s || s.step !== "review") return ctx.reply("Сценарий добавления не найден.");
    const p = s.product;
    const result = db.prepare("INSERT INTO products(title,price,order_text,photo_file_id,description) VALUES(?,?,?,?,?)")
      .run(p.title,p.price,p.order_text,p.photo_file_id,p.description);
    sessions.delete(ctx.from.id);
    return ctx.reply(`✅ Товар добавлен!\n\nID: #${String(result.lastInsertRowid).padStart(3,"0")}\nНазвание: ${p.title}\nЦена: ${p.price} ₽`,{reply_markup:mainAdminKeyboard()});
  }
  if (action === "confirm_remove") {
    const s = sessions.get(ctx.from.id);
    if (!s?.productId) return ctx.reply("Товар не выбран.");
    db.prepare("DELETE FROM favorites WHERE product_id=?").run(s.productId);
    db.prepare("DELETE FROM products WHERE id=?").run(s.productId);
    sessions.delete(ctx.from.id);
    return ctx.reply("🗑 Товар и его записи удалены.",{reply_markup:mainAdminKeyboard()});
  }
  if (action === "cancel_remove") {
    sessions.delete(ctx.from.id);
    return ctx.reply("Удаление отменено.",{reply_markup:mainAdminKeyboard()});
  }
});

bot.on("message:text", async ctx => {
  if (!isAdmin(ctx.from.id)) return;
  const s = sessions.get(ctx.from.id);
  if (!s) return;
  const value = ctx.message.text.trim();
  if (value === "/cancel") {
    sessions.delete(ctx.from.id);
    return ctx.reply("Отменено.",{reply_markup:mainAdminKeyboard()});
  }
  if (s.step === "remove") {
    const id = Number(value.replace("#",""));
    const product = Number.isInteger(id) ? db.prepare("SELECT * FROM products WHERE id=?").get(id) : null;
    if (!product) return ctx.reply("❌ Товар с таким ID не найден. Попробуй ещё раз или нажми «Отменить».",cancelKeyboard());
    s.productId = id;
    sessions.set(ctx.from.id,s);
    const k = new InlineKeyboard().text("🔴 Да, удалить", "admin:confirm_remove", {style:"danger"}).text("Отмена","admin:cancel_remove");
    return ctx.reply(`Удалить товар #${String(id).padStart(3,"0")}?\n\n${product.title} — ${product.price} ₽`,{reply_markup:k});
  }
  if (s.step === "title") { s.product.title=value; s.step="price"; return ctx.reply("💰 Введи цену в рублях:"); }
  if (s.step === "price") {
    if (!/^\d+([.,]\d{1,2})?$/.test(value)) return ctx.reply("Введи цену числом, например 600.");
    s.product.price=value.replace(",","."); s.step="order_text";
    return ctx.reply("✉️ Введи индивидуальный текст, который будет подставляться покупателю при обращении к продавцу:");
  }
  if (s.step === "order_text") { s.product.order_text=value; s.step="photo"; return ctx.reply("📸 Отправь фото товара одним сообщением:"); }
  if (s.step === "description") { s.product.description=value; s.step="review"; return ctx.reply(`Проверь товар:\n\n<b>${escapeHtml(s.product.title)}</b>\nЦена: ${s.product.price} ₽\nОписание: ${escapeHtml(s.product.description)}\nТекст заказа: ${escapeHtml(s.product.order_text)}\nФото: ${s.product.photo_file_id ? "добавлено" : "нет"}`,{parse_mode:"HTML",reply_markup:new InlineKeyboard().text("🟢 Готово","admin:save","success").text("🔴 Отменить","admin:cancel","danger")}); }
});
bot.on("message:photo", async ctx => {
  if (!isAdmin(ctx.from.id)) return;
  const s=sessions.get(ctx.from.id);
  if (!s || s.step!=="photo") return;
  s.product.photo_file_id=ctx.message.photo.at(-1).file_id;
  s.step="description";
  return ctx.reply("📝 Теперь отправь описание товара:");
});
function escapeHtml(s="") { return String(s).replace(/[&<>"]/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c])); }

function validateInitData(initData) {
  if (!initData) return null;
  const params = new URLSearchParams(initData);
  const hash = params.get("hash");
  if (!hash) return null;
  params.delete("hash");
  const dataCheck = [...params.entries()].sort(([a],[b])=>a.localeCompare(b)).map(([k,v])=>`${k}=${v}`).join("\n");
  const secret = crypto.createHmac("sha256","WebAppData").update(BOT_TOKEN).digest();
  const calculated = crypto.createHmac("sha256",secret).update(dataCheck).digest("hex");
  if (!crypto.timingSafeEqual(Buffer.from(hash,"hex"),Buffer.from(calculated,"hex"))) return null;
  const authDate=Number(params.get("auth_date"));
  if (!authDate || Date.now()/1000-authDate>86400) return null;
  try { return JSON.parse(params.get("user") || "null"); } catch { return null; }
}
function auth(req,res,next) {
  const user=validateInitData(req.header("x-telegram-init-data"));
  if (!user?.id) return res.status(401).json({error:"Открой магазин через Telegram-бота."});
  req.tgUser=user;
  db.prepare(`INSERT INTO users(id,username,first_name,blocked) VALUES(?,?,?,0)
    ON CONFLICT(id) DO UPDATE SET username=excluded.username,first_name=excluded.first_name,blocked=0`)
    .run(user.id,user.username||"",user.first_name||"");
  next();
}
app.get("/api/config",(req,res)=>res.json({maintenance:getSetting("maintenance")==="1",channelUrl:CHANNEL_URL}));
app.get("/api/products",auth,async(req,res)=>{
  if(getSetting("maintenance")==="1") return res.json({maintenance:true,products:[]});
  try {
    const member = await bot.api.getChatMember(`@${CHANNEL_USERNAME}`, req.tgUser.id);
    if (!["creator","administrator","member"].includes(member.status) && !(member.status==="restricted" && member.is_member)) {
      return res.status(403).json({subscriptionRequired:true,channelUrl:CHANNEL_URL});
    }
  } catch (e) {
    console.error("Проверка подписки не удалась. Проверь, что бот — администратор канала:",e.description||e.message);
    return res.status(503).json({error:"Не удалось проверить подписку. Попробуй позже."});
  }
  const rows=db.prepare("SELECT id,title,price,order_text,description,photo_file_id FROM products ORDER BY id DESC").all();
  res.json({products:rows.map(p=>({...p,id:`#${String(p.id).padStart(3,"0")}`,imageUrl:p.photo_file_id?`/api/photo/${p.id}`:null}))});
});
app.get("/api/photo/:id",auth,async(req,res)=>{
  const p=db.prepare("SELECT photo_file_id FROM products WHERE id=?").get(Number(req.params.id));
  if(!p?.photo_file_id) return res.sendStatus(404);
  try {
    const file=await bot.api.getFile(p.photo_file_id);
    const url=`https://api.telegram.org/file/bot${BOT_TOKEN}/${file.file_path}`;
    const response=await fetch(url);
    if(!response.ok) return res.sendStatus(502);
    res.setHeader("Content-Type",response.headers.get("content-type")||"image/jpeg");
    response.body.pipeTo(new WritableStream({write(chunk){res.write(Buffer.from(chunk));},close(){res.end();},abort(){res.end();}})).catch(()=>res.end());
  } catch(e) { console.error(e); res.sendStatus(502); }
});
app.post("/api/favorites/:id",auth,(req,res)=>{
  const id=Number(String(req.params.id).replace("#",""));
  const exists=db.prepare("SELECT 1 FROM favorites WHERE user_id=? AND product_id=?").get(req.tgUser.id,id);
  if(exists) db.prepare("DELETE FROM favorites WHERE user_id=? AND product_id=?").run(req.tgUser.id,id);
  else if(db.prepare("SELECT 1 FROM products WHERE id=?").get(id)) db.prepare("INSERT OR IGNORE INTO favorites(user_id,product_id) VALUES(?,?)").run(req.tgUser.id,id);
  res.json({favorite:!exists});
});
app.get("/api/favorites",auth,(req,res)=>{
  res.json({ids:db.prepare("SELECT product_id FROM favorites WHERE user_id=?").all(req.tgUser.id).map(x=>`#${String(x.product_id).padStart(3,"0")}`)});
});
app.get("/health",(req,res)=>res.json({ok:true,service:"sky-shop"}));

bot.catch(err=>console.error("Bot error:",err));
bot.api.setMyCommands([{command:"start",description:"Открыть SKY SHOP"},{command:"admin",description:"Панель администратора"}])
  .catch(e=>console.error("Не удалось установить команды:",e.message));
bot.start({onStart:info=>console.log(`Bot @${info.username} started`)})
  .catch(e=>{console.error("Bot polling error:",e);process.exit(1);});
app.listen(Number(PORT),()=>console.log(`SKY SHOP web server listening on ${PORT}`));
