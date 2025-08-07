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

// ✅ دالة لجلب المباريات
async function fetchMatches() {
  try {
    console.log("⏳ جلب المباريات من kooora...");
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
        const time = $(matchEl).find("time").attr("dateTime") || "";
        const matchUrl = "https://www.kooora.com/كرة-القدم/مباريات-اليوم" + $(matchEl).find("a.fco-match-start-date").attr("href");

        matches.push({
          homeTeam,
          awayTeam,
          homeLogo,
          awayLogo,
          scoreHome,
          scoreAway,
          time,
          matchUrl
        });
      });

      leagues.push({
        leagueName,
        matches
      });
    });

    // ✅ حفظ البيانات في Firebase
    await db.ref("matches").set({
      updatedAt: new Date().toISOString(),
      leagues
    });

    console.log("✅ تم تحديث المباريات في Firebase بنجاح");
  } catch (error) {
    console.error("❌ خطأ في جلب المباريات:", error.message);
  }
}

// ✅ تشغيل البوت كل 20 ثانية
cron.schedule("*/10 * * * * *", fetchMatches);

// تشغيل أول مرة عند بدء السيرفر
fetchMatches();
