require('dotenv').config();
// 必要なモジュールを読み込み
const express = require("express");
const bodyParser = require("body-parser");
const fs = require("fs");
const line = require("@line/bot-sdk");
const app = express();
const port = process.env.PORT || 3000;

// LINE Bot 設定
const config = {
  channelAccessToken: process.env.LINE_CHANNEL_ACCESS_TOKEN,
  channelSecret: process.env.LINE_CHANNEL_SECRET,
};
const client = new line.Client(config);

app.use(bodyParser.json());

// ファイル読み込み
const loadJSON = (filename) => {
  if (!fs.existsSync(filename)) return {};
  return JSON.parse(fs.readFileSync(filename));
};

const saveJSON = (filename, data) => {
  fs.writeFileSync(filename, JSON.stringify(data, null, 2));
};

let users = loadJSON("users.json");
let keywords = loadJSON("keywords.json");
let blacklist = loadJSON("blacklist.json");

const roles = {
  ADMIN: "管理者",
  SUBADMIN: "副管理者",
  MEMBER: "メンバー",
  BLACK: "ブラック",
};

const slotRewards = {
  "777": 500,
  default: 75,
};

const omikujiList = ["大吉", "中吉", "小吉", "吉", "末吉", "凶", "大凶"];

const ensureUser = (userId) => {
  if (!users[userId]) {
    users[userId] = {
      coin: 20,
      role: roles.MEMBER,
      name: "",
    };
  }
};

app.post("/webhook", (req, res) => {
  res.sendStatus(200);
  const events = req.body.events;
  events.forEach(async (event) => {
    if (event.type !== "message" || event.message.type !== "text") return;

    const userId = event.source.userId;
    const text = event.message.text.trim();

    ensureUser(userId);
    if (users[userId].name === "") {
      const profile = await client.getProfile(userId);
      users[userId].name = profile.displayName;
    }

    if (users[userId].role === roles.BLACK && !text.startsWith("key:")) return;

    // 常時反応するキーワード応答
    for (const [k, v] of Object.entries(keywords)) {
      if (text.includes(k)) {
        await client.replyMessage(event.replyToken, { type: "text", text: v });
        return;
      }
    }

    const reply = async (msg) => {
      await client.replyMessage(event.replyToken, { type: "text", text: msg });
    };

    const role = users[userId].role;
    const isSubAdmin = [roles.ADMIN, roles.SUBADMIN].includes(role);
    const isAdmin = role === roles.ADMIN;

    // メンバー以上が可能
    if ([roles.ADMIN, roles.SUBADMIN, roles.MEMBER].includes(role)) {
      if (text === "check") return reply(userId);
      if (text === "情報") {
        return reply(`ID: ${userId}\nコイン: ${users[userId].coin}\n権限: ${users[userId].role}`);
      }
      if (text === "スロット") {
        if (users[userId].coin <= 0) return reply("コインが足りません");
        users[userId].coin--;
        const nums = Array.from({ length: 3 }, () => Math.floor(Math.random() * 9) + 1);
        const result = nums.join("");
        let reward = 0;
        if (["111", "222", "333", "444", "555", "666", "888", "999"].includes(result)) {
          reward = slotRewards.default;
        } else if (result === "777") {
          reward = slotRewards["777"];
        }
        users[userId].coin += reward;
        return reply(`${result} ${reward ? `当たり！${reward}コイン獲得！` : "はずれ！！"} 残り${users[userId].coin}コイン`);
      }
      if (text === "おみくじ") {
        const res = omikujiList[Math.floor(Math.random() * omikujiList.length)];
        return reply(res);
      }
    }

    // 副管理者以上が可能
    if (isSubAdmin) {
      if (text.startsWith("key:")) {
        const [, k, v] = text.split(":");
        keywords[k] = v;
        return reply("キーワード設定完了");
      }
      if (text === "notkey") {
        keywords = {};
        return reply("キーワードリセットしました");
      }
      if (text.startsWith("givebu:")) {
        const targetId = text.split(":")[1];
        users[targetId] = users[targetId] || { coin: 20, role: roles.BLACK, name: "" };
        users[targetId].role = roles.BLACK;
        return reply("ブラック登録しました");
      }
      if (text.startsWith("notgivebu:")) {
        const targetId = text.split(":")[1];
        if (users[targetId]?.role === roles.BLACK) users[targetId].role = roles.MEMBER;
        return reply("ブラック解除しました");
      }
      if (text === "ブラックリスト一覧") {
        const list = Object.entries(users)
          .filter(([id, u]) => u.role === roles.BLACK)
          .map(([id]) => id)
          .join("\n");
        return reply(list || "ブラックはいません");
      }
      if (/^ID:.+/.test(text)) {
        const targetId = text.slice(3);
        const u = users[targetId];
        if (!u) return reply("見つかりません");
        return reply(`ID: ${targetId}\n名前: ${u.name}\n権限: ${u.role}\nコイン: ${u.coin}`);
      }
    }

    // 管理者のみ
    if (isAdmin) {
      if (text.startsWith("coingive:")) {
        const [, id, amount] = text.split(":");
        ensureUser(id);
        users[id].coin += Number(amount);
        return reply("コイン付与しました");
      }
      if (text.startsWith("allcoingive:")) {
        const amount = Number(text.split(":")[1]);
        Object.values(users).forEach((u) => (u.coin += amount));
        return reply("全員にコインを付与しました");
      }
      if (text.startsWith("notcoingive:")) {
        const [, id, amount] = text.split(":");
        ensureUser(id);
        users[id].coin = Math.max(0, users[id].coin - Number(amount));
        return reply("コインを剥奪しました");
      }
      if (text.startsWith("付与:")) {
        const id = text.split(":")[1];
        ensureUser(id);
        users[id].role = roles.SUBADMIN;
        return reply("副管理者を付与しました");
      }
      if (text.startsWith("削除:")) {
        const id = text.split(":")[1];
        if (users[id]?.role === roles.SUBADMIN) users[id].role = roles.MEMBER;
        return reply("副管理者を削除しました");
      }
    }

    saveJSON("users.json", users);
    saveJSON("keywords.json", keywords);
    saveJSON("blacklist.json", blacklist);
  });
});

app.listen(port, () => {
  console.log("LINE Bot running on port " + port);
});
