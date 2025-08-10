const axios = require("axios");
const cheerio = require("cheerio");
const cron = require("node-cron");
const admin = require("firebase-admin");

// تهيئة Firebase
const serviceAccount = require("./firebase-key.json"); // أو استخدام process.env
admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
  databaseURL: "https://fast-tv-f9422-default-rtdb.firebaseio.com/"
});

const db = admin.database();

// 🔍 دالة للتحقق من التغييرات
function hasChanges(oldData, newData) {
  return !oldData || JSON.stringify(oldData) !== JSON.stringify(newData);
}

// 📌 دالة لجلب كل بيانات المباراة
async function fetchFullMatchData() {
  try {
    console.log("🔄 جلب بيانات المباراة من Kooora...");

    const matchUrl = "https://www.kooora.com/%D9%83%D8%B1%D8%A9-%D8%A7%D9%84%D9%82%D8%AF%D9%85/%D9%85%D8%A8%D8%A7%D8%B1%D8%A7%D8%A9/%D8%A8%D8%A7%D9%84%D9%85%D9%8A%D8%B1%D8%A7%D8%B3-%D8%B6%D8%AF-%D8%B3%D9%8A%D8%A7%D8%B1%D8%A7/tl6JyuYs4K2z1AU-7WT1V";
    const { data } = await axios.get(matchUrl, {
      headers: { "User-Agent": "Mozilla/5.0" } // تجنب حظر الطلبات
    });
    const $ = cheerio.load(data);

    // 1️⃣ معلومات المباراة الأساسية
    const matchInfo = {
      league: $(".fco-match-header-competition-name").text().trim(),
      date: $(".fco-match-header-match-day").attr("datetime"),
      status: $(".fco-match-state").text().trim(),
      homeTeam: {
        name: $(".fco-match-header__grid-team:first-child .fco-long-name").text().trim(),
        logo: $(".fco-match-header__grid-team:first-child img").attr("src"),
        score: $(".fco-match-header-score[data-side='team-a']").text().trim(),
      },
      awayTeam: {
        name: $(".fco-match-header__grid-team:last-child .fco-long-name").text().trim(),
        logo: $(".fco-match-header__grid-team:last-child img").attr("src"),
        score: $(".fco-match-header-score[data-side='team-b']").text().trim(),
      },
      halfTimeScore: $(".fco-match-header__results-item:first-child .fco-match-header__sub-score").text().trim(),
      finalScore: $(".fco-match-header__results-item:last-child .fco-match-header__sub-score").text().trim(),
      matchUrl: matchUrl
    };

    // 2️⃣ الهدافون
    const scorers = {
      home: [],
      away: []
    };
    $(".fco-match-header__scorers-left li").each((i, el) => {
      scorers.home.push($(el).text().trim());
    });
    $(".fco-match-header__scorers-right li").each((i, el) => {
      scorers.away.push($(el).text().trim());
    });

    // 3️⃣ الأحداث الكاملة (من التعليق المباشر)
    const events = [];
    $(".fco-commentary__event").each((i, el) => {
      const event = {
        time: $(el).find(".fco-commentary__event-time").text().trim(),
        text: $(el).find(".fco-commentary__event-text").text().trim(),
        type: $(el).hasClass("fco-commentary__event--team-a") ? "home" : "away"
      };
      events.push(event);
    });

    // 4️⃣ إحصائيات المباراة (التفصيلية)
    const stats = {};
    $(".fco-match-stats-row").each((i, el) => {
      const statName = $(el).find(".fco-match-stats-row__label").text().trim();
      stats[statName] = {
        home: $(el).find(".fco-match-stats-row__stat:first-child .fco-match-stats-row__stat-value").text().trim(),
        away: $(el).find(".fco-match-stats-row__stat:last-child .fco-match-stats-row__stat-value").text().trim()
      };
    });

    // 5️⃣ التشكيلات الأساسية والبدلاء
    const lineups = {
      home: { starting: [], substitutes: [] },
      away: { starting: [], substitutes: [] }
    };
    // التشكيل الأساسي للفريق المضيف
    $(".fco-lineup-team[data-side='home'] .fco-lineup-player:not(.fco-lineup-player--substitute)").each((i, el) => {
      lineups.home.starting.push({
        name: $(el).find(".fco-lineup-player__name").text().trim(),
        number: $(el).find(".fco-lineup-player__number").text().trim(),
        position: $(el).find(".fco-lineup-player__position").text().trim()
      });
    });
    // البدلاء للفريق المضيف
    $(".fco-lineup-team[data-side='home'] .fco-lineup-player.fco-lineup-player--substitute").each((i, el) => {
      lineups.home.substitutes.push({
        name: $(el).find(".fco-lineup-player__name").text().trim(),
        number: $(el).find(".fco-lineup-player__number").text().trim()
      });
    });
    // التشكيل الأساسي للفريق الضيف
    $(".fco-lineup-team[data-side='away'] .fco-lineup-player:not(.fco-lineup-player--substitute)").each((i, el) => {
      lineups.away.starting.push({
        name: $(el).find(".fco-lineup-player__name").text().trim(),
        number: $(el).find(".fco-lineup-player__number").text().trim(),
        position: $(el).find(".fco-lineup-player__position").text().trim()
      });
    });
    // البدلاء للفريق الضيف
    $(".fco-lineup-team[data-side='away'] .fco-lineup-player.fco-lineup-player--substitute").each((i, el) => {
      lineups.away.substitutes.push({
        name: $(el).find(".fco-lineup-player__name").text().trim(),
        number: $(el).find(".fco-lineup-player__number").text().trim()
      });
    });

    // 6️⃣ توقعات الجمهور
    const predictions = {
      home: {
        percent: $(".fco-match-predictor__result:first-child .fco-match-predictor__result-vote-percent").text().trim(),
        votes: $(".fco-match-predictor__result:first-child .fco-match-predictor__result-vote-votes").text().trim()
      },
      draw: {
        percent: $(".fco-match-predictor__result:nth-child(2) .fco-match-predictor__result-vote-percent").text().trim(),
        votes: $(".fco-match-predictor__result:nth-child(2) .fco-match-predictor__result-vote-votes").text().trim()
      },
      away: {
        percent: $(".fco-match-predictor__result:last-child .fco-match-predictor__result-vote-percent").text().trim(),
        votes: $(".fco-match-predictor__result:last-child .fco-match-predictor__result-vote-votes").text().trim()
      }
    };

    // 7️⃣ ترتيب الفريقين في الدوري
    const standings = [];
    $(".fco-standings-table__row").each((i, el) => {
      const team = $(el).find(".fco-standings-table__team-name--long").text().trim();
      if (team) {
        standings.push({
          position: $(el).find(".fco-standings-table__cell--position").text().trim(),
          team: team,
          played: $(el).find(".fco-standings-table__cell--played").text().trim(),
          points: $(el).find(".fco-standings-table__cell--points").text().trim(),
          isHome: team === matchInfo.homeTeam.name,
          isAway: team === matchInfo.awayTeam.name
        });
      }
    });

    // 📦 تجميع كل البيانات
    const matchData = {
      lastUpdated: new Date().toISOString(),
      info: matchInfo,
      scorers: scorers,
      events: events,
      stats: stats,
      lineups: lineups,
      predictions: predictions,
      standings: standings
    };

    // 🔥 تحديث Firebase إذا كانت هناك تغييرات
    const snapshot = await db.ref("matches/latest").once("value");
    const oldData = snapshot.val();

    if (hasChanges(oldData, matchData)) {
      await db.ref("matches/latest").set(matchData);
      console.log("✅ تم تحديث بيانات المباراة بنجاح في Firebase!");
    } else {
      console.log("🔄 لا توجد تغييرات جديدة في البيانات.");
    }
  } catch (error) {
    console.error("❌ خطأ في جلب البيانات:", error.message);
  }
}

// ⏱ تشغيل السكربت كل دقيقتين
cron.schedule("*/2 * * * *", fetchFullMatchData);

// التشغيل الأول عند بدء السكربت
fetchFullMatchData();
