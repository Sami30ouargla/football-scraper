const axios = require("axios");
const cheerio = require("cheerio");
const cron = require("node-cron");
const admin = require("firebase-admin");

// تهيئة Firebase
const firebaseKey = JSON.parse(process.env.FIREBASE_KEY);
admin.initializeApp({
  credential: admin.credential.cert(firebaseKey),
  databaseURL: "https://fast-tv-f9422-default-rtdb.firebaseio.com"
});

const db = admin.database();

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
        // معلومات أساسية
        const homeTeam = $(matchEl).find(".fco-match-team-and-score__team-a .fco-long-name").text().trim();
        const awayTeam = $(matchEl).find(".fco-match-team-and-score__team-b .fco-long-name").text().trim();
        
        // الشعارات
        const homeLogo = $(matchEl).find(".fco-match-team-and-score__team-a img").attr("src") || "";
        const awayLogo = $(matchEl).find(".fco-match-team-and-score__team-b img").attr("src") || "";
        
        // النتائج
        const scoreHome = $(matchEl).find(".fco-match-score[data-side='team-a']").text().trim() || "-";
        const scoreAway = $(matchEl).find(".fco-match-score[data-side='team-b']").text().trim() || "-";
        
        // الوقت ورابط المباراة
        const time = $(matchEl).find("time").attr("datetime") || "";
        const matchUrl = "https://www.kooora.com" + ($(matchEl).find("a.fco-match-start-date").attr("href") || "");
        
        // حالة المباراة والدقيقة الحالية
        const matchStatusElement = $(matchEl).find(".fco-match-status");
        let matchStatus = matchStatusElement.text().trim() || "لم تبدأ";
        let currentMinute = "";
        let status = "upcoming";
        
        // تحليل حالة المباراة بدقة
        if (matchStatus.includes("'")) {
          currentMinute = matchStatus.replace(/'/g, '').trim();
          status = "live";
        } else if (matchStatus.includes("انتهت")) {
          status = "finished";
        } else if (matchStatus.includes("تأجيل")) {
          status = "postponed";
        }
        
        // معلومات إضافية من JSON-LD
        const jsonLdScript = $(matchEl).find('script[type="application/ld+json"]').html();
        let jsonLdData = {};
        if (jsonLdScript) {
          try {
            jsonLdData = JSON.parse(jsonLdScript);
          } catch (e) {
            console.error("Error parsing JSON-LD:", e);
          }
        }

        // إضافة المباراة إلى القائمة
        matches.push({
          homeTeam,
          awayTeam,
          homeLogo: homeLogo.startsWith("http") ? homeLogo : `https:${homeLogo}`,
          awayLogo: awayLogo.startsWith("http") ? awayLogo : `https:${awayLogo}`,
          scoreHome,
          scoreAway,
          time,
          matchUrl,
          matchStatus,
          currentMinute,
          status,
          location: jsonLdData.location?.name || "",
          startDate: jsonLdData.startDate || "",
          eventStatus: jsonLdData.eventStatus || "https://schema.org/EventScheduled",
          homeTeamLogo: jsonLdData.homeTeam?.logo || "",
          awayTeamLogo: jsonLdData.awayTeam?.logo || ""
        });
      });

      leagues.push({ leagueName, matches });
    });

    // تحديث قاعدة البيانات
    const newData = {
      updatedAt: new Date().toISOString(),
      leagues
    };

    await db.ref("matches").set(newData);
    console.log("✅ تم تحديث جميع البيانات في Firebase");
  } catch (error) {
    console.error("❌ خطأ في جلب المباريات:", error.message);
  }
}

// تشغيل كل 20 ثانية
cron.schedule("*/20 * * * * *", fetchMatches);

// التشغيل الأولي
fetchMatches();
