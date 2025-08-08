const axios = require("axios");
const cheerio = require("cheerio");
const cron = require("node-cron");
const admin = require("firebase-admin");

// ✅ قراءة مفتاح Firebase من Environment Variables
const firebaseKey = JSON.parse(process.env.FIREBASE_KEY);

admin.initializeApp({
  credential: admin.credential.cert(firebaseKey),
  databaseURL: "https://fast-tv-f9422-default-rtdb.firebaseio.com"
});

const db = admin.database();

// ✅ مقارنة البيانات لمعرفة التغييرات
function findDifferences(oldData, newData) {
  const updates = {};

  newData.leagues.forEach((newLeague, leagueIndex) => {
    const oldLeague = oldData?.leagues?.[leagueIndex];

    if (!oldLeague || oldLeague.leagueName !== newLeague.leagueName) {
      updates[`leagues/${leagueIndex}`] = newLeague;
      return;
    }

    newLeague.matches.forEach((newMatch, matchIndex) => {
      const oldMatch = oldLeague.matches?.[matchIndex];

      if (!oldMatch || JSON.stringify(oldMatch) !== JSON.stringify(newMatch)) {
        updates[`leagues/${leagueIndex}/matches/${matchIndex}`] = newMatch;
      }
    });
  });

  return updates;
}

// ✅ جلب المباريات
async function fetchMatches() {
  try {
    console.log("⏳ جلب المباريات من Kooora...");

    const { data } = await axios.get("https://www.kooora.com/كرة-القدم/مباريات-اليوم");
    const $ = cheerio.load(data);
    const leagues = [];

    $(".fco-competition-section").each((i, section) => {
      const leagueName = $(section).find(".fco-competition-section__header-name").text().trim() || "غير معروف";

      // 🔹 منع undefined
      const countryName = $(section).find(".fco-competition-section__header-country").text().trim() || "غير محدد";
      const countryFlag = $(section).find(".fco-competition-section__header-country img").attr("src") || null;

      const matches = [];

      $(section).find(".fco-match-row").each((j, matchEl) => {
        const homeTeam = $(matchEl).find(".fco-match-team-and-score__team-a .fco-long-name").text().trim() || "غير محدد";
        const awayTeam = $(matchEl).find(".fco-match-team-and-score__team-b .fco-long-name").text().trim() || "غير محدد";
        const homeLogo = $(matchEl).find(".fco-match-team-and-score__team-a img").attr("src") || null;
        const awayLogo = $(matchEl).find(".fco-match-team-and-score__team-b img").attr("src") || null;
        const scoreHome = $(matchEl).find(".fco-match-score[data-side='team-a']").text().trim() || "-";
        const scoreAway = $(matchEl).find(".fco-match-score[data-side='team-b']").text().trim() || "-";

        // 🔹 جلب الوقت من أكثر من مكان
        let timeText = $(matchEl).find(".fco-match-minute").text().trim();
        if (!timeText) timeText = $(matchEl).find(".fco-match-status").text().trim();
        if (!timeText) timeText = $(matchEl).find(".fco-match-period").text().trim();
        if (!timeText) timeText = $(matchEl).find("time").attr("datetime") || "";

        const time = timeText || "غير محدد";

        // 🔹 status نفس النص إذا وجد
        const status = $(matchEl).find(".fco-match-status").text().trim() || "غير محدد";

        // 🔹 period = الوقت إذا المباراة مباشرة أو فيها وقت إضافي
        const period = (time.includes("+") || (!isNaN(parseInt(time)) && parseInt(time) > 0)) ? time : "غير محدد";

        // 🔹 اسم الملعب
        const venue = $(matchEl).find(".fco-match-venue").text().trim() || null;

        // 🔹 رابط المباراة
        const matchUrl = "https://www.kooora.com" + ($(matchEl).find("a.fco-match-start-date").attr("href") || "");

        matches.push({
          homeTeam,
          awayTeam,
          homeLogo,
          awayLogo,
          scoreHome,
          scoreAway,
          time,
          matchUrl,
          countryName,
          countryFlag,
          status,
          period,
          venue
        });
      });

      leagues.push({ leagueName, countryName, countryFlag, matches });
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
