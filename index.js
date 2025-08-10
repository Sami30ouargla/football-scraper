const axios = require("axios");
const cheerio = require("cheerio");
const cron = require("node-cron");
const admin = require("firebase-admin");
const express = require('express');

const app = express();
const PORT = process.env.PORT || 3000;

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

        let matchStatus = "";
        if ($(matchEl).find(".fco-match-state .fco-match-time").length > 0) {
          matchStatus = $(matchEl).find(".fco-match-state .fco-match-time").text().trim();
        } else if ($(matchEl).find(".fco-match-state").length > 0) {
          matchStatus = $(matchEl).find(".fco-match-state").text().trim();
        }

        const matchUrlPath = $(matchEl).find("a.fco-match-start-date").attr("href") 
          || $(matchEl).find("a.fco-match-team-and-score__container").attr("href") 
          || "";
        const matchUrl = matchUrlPath ? "https://www.kooora.com" + matchUrlPath : "";

        matches.push({
          homeTeam,
          awayTeam,
          homeLogo,
          awayLogo,
          scoreHome,
          scoreAway,
          time,
          matchStatus,
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

// ✅ تشغيل البوت كل 5 دقائق
cron.schedule("*/5 * * * *", fetchMatches);

// إضافة route أساسي
app.get('/', (req, res) => {
  res.send('Football Matches Tracker is running');
});

// بدء الخادم
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
  fetchMatches(); // تشغيل جلب المباريات عند بدء الخادم
});
