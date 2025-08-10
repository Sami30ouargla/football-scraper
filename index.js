const axios = require("axios");
const cheerio = require("cheerio");
const cron = require("node-cron");
const admin = require("firebase-admin");

// قراءة مفتاح Firebase من Environment Variables
const firebaseKey = JSON.parse(process.env.FIREBASE_KEY);

admin.initializeApp({
  credential: admin.credential.cert(firebaseKey),
  databaseURL: "https://fast-tv-f9422-default-rtdb.firebaseio.com"
});

const db = admin.database();

// دالة لمقارنة البيانات ومعرفة التغييرات
function findDifferences(oldData, newData) {
  const updates = {};
  
  if (!oldData || JSON.stringify(oldData) !== JSON.stringify(newData)) {
    return newData; // إرجاع كل البيانات إذا كان هناك تغيير
  }
  return null;
}

// دالة جلب تفاصيل المباراة
async function fetchMatchDetails() {
  try {
    console.log("⏳ جلب تفاصيل المباراة من Kooora...");
    
    const matchUrl = "https://www.kooora.com/كرة-القدم/مباراة/بالميراس-v-سيارا/tl6JyuYs4K2z1AU-7WT1V";
    const { data } = await axios.get(matchUrl);
    const $ = cheerio.load(data);

    // 1. معلومات المباراة الأساسية
    const matchInfo = {
      leagueName: $(".fco-match-header-competition-name").text().trim() || "غير معروف",
      matchDate: $(".fco-match-header-match-day").attr("datetime") || "",
      homeTeam: $(".fco-match-header__grid-team:first-child .fco-long-name").text().trim(),
      awayTeam: $(".fco-match-header__grid-team:last-child .fco-long-name").text().trim(),
      homeLogo: $(".fco-match-header__grid-team:first-child img").attr("src") || "",
      awayLogo: $(".fco-match-header__grid-team:last-child img").attr("src") || "",
      scoreHome: $(".fco-match-header-score[data-side='team-a']").text().trim() || "-",
      scoreAway: $(".fco-match-header-score[data-side='team-b']").text().trim() || "-",
      matchStatus: $(".fco-match-state").text().trim(),
      matchUrl: matchUrl
    };

    // 2. الأحداث الرئيسية
    const events = [];
    $(".fco-events__list-element").each((i, el) => {
      const eventType = $(el).find("use").attr("xlink:href")?.split("#")[1] || "unknown";
      const playerName = $(el).find(".fco-key-event-row__info-description-whole").text().trim();
      const time = $(el).find(".fco-match-time").text().trim();
      const team = $(el).find(".fco-key-event-row").hasClass("fco-key-event-row--team-A") ? "home" : "away";
      
      events.push({
        type: eventType,
        player: playerName,
        time: time,
        team: team
      });
    });

    // 3. إحصائيات المباراة
    const stats = {};
    $(".fco-match-stats-row").each((i, el) => {
      const statName = $(el).find(".fco-match-stats-row__label").text().trim();
      const homeValue = $(el).find(".fco-match-stats-row__stat:first-child .fco-match-stats-row__stat-label").text().trim();
      const awayValue = $(el).find(".fco-match-stats-row__stat:last-child .fco-match-stats-row__stat-label").text().trim();
      
      if (statName) {
        stats[statName] = {
          home: homeValue || "0",
          away: awayValue || "0"
        };
      }
    });

    // 4. ترتيب الفريقين في الدوري
    const standings = [];
    $(".fco-standings-table__row").each((i, el) => {
      const position = $(el).find(".fco-standings-table__cell--position").text().trim();
      const team = $(el).find(".fco-standings-table__team-name--long").text().trim();
      const played = $(el).find(".fco-standings-table__cell--played").text().trim();
      const points = $(el).find(".fco-standings-table__cell--points").text().trim();
      
      if (team && position) {
        standings.push({
          position,
          team,
          played,
          points,
          isHomeTeam: team === matchInfo.homeTeam,
          isAwayTeam: team === matchInfo.awayTeam
        });
      }
    });

    // 5. التشكيلات (إذا كانت متاحة)
    const lineups = {
      home: [],
      away: []
    };
    
    // محاولة الحصول على التشكيلات إذا كانت الصفحة تحتوي على تبويب التشكيلات
    if ($(".fco-tab-nav__tab[data-tab='lineups']").length > 0) {
      $(".fco-lineup-team[data-side='home'] .fco-lineup-player").each((i, el) => {
        lineups.home.push({
          player: $(el).find(".fco-lineup-player__name").text().trim(),
          number: $(el).find(".fco-lineup-player__number").text().trim(),
          position: $(el).find(".fco-lineup-player__position").text().trim()
        });
      });
      
      $(".fco-lineup-team[data-side='away'] .fco-lineup-player").each((i, el) => {
        lineups.away.push({
          player: $(el).find(".fco-lineup-player__name").text().trim(),
          number: $(el).find(".fco-lineup-player__number").text().trim(),
          position: $(el).find(".fco-lineup-player__position").text().trim()
        });
      });
    }

    // 6. توقعات الجمهور
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

    const newData = {
      updatedAt: new Date().toISOString(),
      matchInfo,
      events,
      stats,
      standings,
      lineups,
      predictions
    };

    const snapshot = await db.ref("matchDetails").once("value");
    const oldData = snapshot.val();

    const changes = findDifferences(oldData, newData);

    if (changes) {
      await db.ref("matchDetails").set(newData);
      console.log("✅ تم تحديث جميع تفاصيل المباراة في Firebase");
    } else {
      console.log("✅ لا توجد تغييرات جديدة في تفاصيل المباراة");
    }
  } catch (error) {
    console.error("❌ خطأ في جلب تفاصيل المباراة:", error.message);
  }
}

// تشغيل البوت كل دقيقتين
cron.schedule("*/120 * * * * *", fetchMatchDetails);

// تشغيل أول مرة عند بدء السيرفر
fetchMatchDetails();
