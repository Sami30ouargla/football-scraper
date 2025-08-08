const axios = require("axios");
const cheerio = require("cheerio");
const cron = require("node-cron");
const admin = require("firebase-admin");

// ✅ قراءة مفتاح Firebase من Environment Variables في Render
const firebaseKey = JSON.parse(process.env.FIREBASE_KEY);

admin.initializeApp({
  credential: admin.credential.cert(firebaseKey),
  databaseURL: "https://fast-tv-f9422-default-rtdb.firebaseio.com" // ← ضع رابط Realtime Database الخاص بك
});

const db = admin.database();

// ✅ دالة لمقارنة البيانات ومعرفة التغييرات
function findDifferences(oldData, newData) {
  const updates = {};

  newData.leagues.forEach((newLeague, leagueIndex) => {
    const oldLeague = oldData?.leagues?.[leagueIndex];

    // إذا كانت البطولة جديدة أو اسمها تغير
    if (!oldLeague || oldLeague.leagueName !== newLeague.leagueName) {
      updates[`leagues/${leagueIndex}`] = newLeague;
      return;
    }

    // مقارنة المباريات داخل البطولة
    newLeague.matches.forEach((newMatch, matchIndex) => {
      const oldMatch = oldLeague.matches?.[matchIndex];

      if (
        !oldMatch ||
        JSON.stringify(oldMatch) !== JSON.stringify(newMatch)
      ) {
        updates[`leagues/${leagueIndex}/matches/${matchIndex}`] = newMatch;
      }
    });
  });

  return updates;
}

// ✅ دالة جلب المباريات وتحديث فقط التغييرات
async function fetchMatches() {
  try {
    console.log("⏳ جلب المباريات من Kooora...");

    const { data } = await axios.get("https://www.kooora.com/كرة-القدم/مباريات-اليوم");
    const $ = cheerio.load(data);
    const leagues = [];

    $(".fco-competition-section").each((i, section) => {
      const leagueName = $(section).find(".fco-competition-section__header-name").text().trim() || "غير معروف";
      const matches = [];

      $(section).find(".fco-match-row").each((j, matchEl) => {
  const homeTeam = $(matchEl).find(".fco-match-team-and-score__team-a .fco-long-name").text().trim();
  const awayTeam = $(matchEl).find(".fco-match-team-and-score__team-b .fco-long-name").text().trim();
  const homeLogo = $(matchEl).find(".fco-match-team-and-score__team-a img").attr("src");
  const awayLogo = $(matchEl).find(".fco-match-team-and-score__team-b img").attr("src");
  const scoreHome = $(matchEl).find(".fco-match-score[data-side='team-a']").text().trim() || "-";
  const scoreAway = $(matchEl).find(".fco-match-score[data-side='team-b']").text().trim() || "-";
  const time = $(matchEl).find("time").attr("datetime") || "";

  // 🆕 الوقت الحالي للمباراة (مثلاً "13'")
  const liveTime = $(matchEl).find(".fco-match-state .fco-match-time").text().trim() || "";

  const matchUrl = "https://www.kooora.com/كرة-القدم/مباريات-اليوم" + $(matchEl).find("a.fco-match-start-date").attr("href");

  matches.push({
    homeTeam,
    awayTeam,
    homeLogo,
    awayLogo,
    scoreHome,
    scoreAway,
    time,
    liveTime, // 🆕 إضافة الوقت الحالي هنا
    matchUrl
  });
});


      leagues.push({ leagueName, matches });
    });

    const newData = {
      updatedAt: new Date().toISOString(),
      leagues
    };

    const snapshot = await db.ref("matches").once("value");
    const oldData = snapshot.val();

    const changes = findDifferences(oldData, newData);

    if (Object.keys(changes).length > 0) {
      changes["updatedAt"] = newData.updatedAt;
      await db.ref("matches").update(changes);
      console.log("✅ تم تحديث التغييرات فقط في Firebase");
    } else {
      console.log("✅ لا توجد تغييرات جديدة");
    }
  } catch (error) {
    console.error("❌ خطأ في جلب المباريات:", error.message);
  }
}

// ✅ تشغيل البوت كل 20 ثانية
cron.schedule("*/20 * * * * *", fetchMatches);

// تشغيل أول مرة عند بدء السيرفر
fetchMatches();  
