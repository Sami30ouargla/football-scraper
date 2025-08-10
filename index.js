const axios = require("axios");
const cheerio = require("cheerio");
const cron = require("node-cron");
const admin = require("firebase-admin");

// ✅ قراءة مفتاح Firebase من Environment Variables في Render
const firebaseKey = JSON.parse(process.env.FIREBASE_KEY);

admin.initializeApp({
  credential: admin.credential.cert(firebaseKey),
  databaseURL: "https://fast-tv-f9422-default-rtdb.firebaseio.com"
});

const db = admin.database();

// ✅ دالة لمقارنة البيانات ومعرفة التغييرات
function findDifferences(oldData, newData) {
  const updates = {};

  if (!oldData || JSON.stringify(oldData) !== JSON.stringify(newData)) {
    updates["match"] = newData;
  }

  return updates;
}

// ✅ دالة جلب تفاصيل المباراة
async function fetchMatchDetails() {
  try {
    console.log("⏳ جلب تفاصيل المباراة من Kooora...");
    
    const matchUrl = "https://www.kooora.com/كرة-القدم/مباراة/بالميراس-v-سيارا/tl6JyuYs4K2z1AU-7WT1V";
    const { data } = await axios.get(matchUrl);
    const $ = cheerio.load(data);

    // استخراج معلومات المباراة الأساسية
    const leagueName = $(".fco-match-header-competition-name").text().trim() || "غير معروف";
    const matchDate = $(".fco-match-header-match-day").attr("datetime") || "";
    
    // استخراج معلومات الفريقين
    const homeTeam = $(".fco-match-header__grid-team:first-child .fco-long-name").text().trim();
    const awayTeam = $(".fco-match-header__grid-team:last-child .fco-long-name").text().trim();
    const homeLogo = $(".fco-match-header__grid-team:first-child img").attr("src");
    const awayLogo = $(".fco-match-header__grid-team:last-child img").attr("src");
    
    // استخراج النتيجة وحالة المباراة
    const scoreHome = $(".fco-match-header-score[data-side='team-a']").text().trim() || "-";
    const scoreAway = $(".fco-match-header-score[data-side='team-b']").text().trim() || "-";
    const matchStatus = $(".fco-match-state").text().trim();
    
    // استخراج إحصائيات المباراة
    const stats = {};
    $(".fco-match-stats-row").each((i, el) => {
      const statName = $(el).find(".fco-match-stats-row__label").text().trim();
      const homeValue = $(el).find(".fco-match-stats-row__stat:first-child .fco-match-stats-row__stat-label").text().trim();
      const awayValue = $(el).find(".fco-match-stats-row__stat:last-child .fco-match-stats-row__stat-label").text().trim();
      
      stats[statName] = {
        home: homeValue,
        away: awayValue
      };
    });
    
    // استخراج الأحداث الرئيسية
    const events = [];
    $(".fco-events__list-element").each((i, el) => {
      const eventType = $(el).find(".fco-event-icon use").attr("xlink:href").split("#")[1];
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
    
    // استخراج توقعات الجمهور
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
      match: {
        leagueName,
        matchDate,
        homeTeam,
        awayTeam,
        homeLogo,
        awayLogo,
        scoreHome,
        scoreAway,
        matchStatus,
        stats,
        events,
        predictions,
        matchUrl
      }
    };

    const snapshot = await db.ref("matchDetails").once("value");
    const oldData = snapshot.val();

    const changes = findDifferences(oldData, newData);

    if (Object.keys(changes).length > 0) {
      changes["updatedAt"] = newData.updatedAt;
      await db.ref("matchDetails").update(changes);
      console.log("✅ تم تحديث تفاصيل المباراة في Firebase");
    } else {
      console.log("✅ لا توجد تغييرات جديدة في تفاصيل المباراة");
    }
  } catch (error) {
    console.error("❌ خطأ في جلب تفاصيل المباراة:", error.message);
  }
}

// ✅ تشغيل البوت كل دقيقة
cron.schedule("*/60 * * * * *", fetchMatchDetails);

// تشغيل أول مرة عند بدء السيرفر
fetchMatchDetails();
