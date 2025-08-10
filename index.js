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

// ✅ دالة لجلب تفاصيل المباراة من صفحة المباراة المفصلة
async function fetchMatchDetails(matchUrl) {
  try {
    const { data } = await axios.get(matchUrl);
    const $ = cheerio.load(data);

    // استخراج تفاصيل المباراة
    const matchDetails = {
      events: [],
      stats: {},
      standings: []
    };

    // استخراج الأحداث الرئيسية
    $(".fco-events__list-element").each((i, el) => {
      const event = {
        time: $(el).find(".fco-match-time").text().trim(),
        player: $(el).find(".fco-key-event-row__info-description-whole span").text().trim(),
        type: $(el).find(".fco-event-icon use").attr("xlink:href").split("#")[1]
      };
      matchDetails.events.push(event);
    });

    // استخراج الإحصائيات
    $(".fco-match-stats-row").each((i, el) => {
      const statName = $(el).find(".fco-match-stats-row__label").text().trim();
      const homeValue = $(el).find(".fco-match-stats-row__stat:nth-child(1) .fco-match-stats-row__stat-label").text().trim();
      const awayValue = $(el).find(".fco-match-stats-row__stat:nth-child(2) .fco-match-stats-row__stat-label").text().trim();
      
      matchDetails.stats[statName] = {
        home: homeValue,
        away: awayValue
      };
    });

    // استخراج ترتيب الفرق في الدوري
    $(".fco-standings-table__row").each((i, el) => {
      const position = $(el).find(".fco-standings-table__cell--position").text().trim();
      const team = $(el).find(".fco-standings-table__team-name--long").text().trim();
      const points = $(el).find(".fco-standings-table__cell--points").text().trim();
      
      matchDetails.standings.push({
        position,
        team,
        points
      });
    });

    return matchDetails;
  } catch (error) {
    console.error("❌ خطأ في جلب تفاصيل المباراة:", error.message);
    return null;
  }
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

      $(section).find(".fco-match-row").each(async (j, matchEl) => {
        const homeTeam = $(matchEl).find(".fco-match-team-and-score__team-a .fco-long-name").text().trim();
        const awayTeam = $(matchEl).find(".fco-match-team-and-score__team-b .fco-long-name").text().trim();
        const homeLogo = $(matchEl).find(".fco-match-team-and-score__team-a img").attr("src");
        const awayLogo = $(matchEl).find(".fco-match-team-and-score__team-b img").attr("src");
        const scoreHome = $(matchEl).find(".fco-match-score[data-side='team-a']").text().trim() || "-";
        const scoreAway = $(matchEl).find(".fco-match-score[data-side='team-b']").text().trim() || "-";
        const time = $(matchEl).find("time").attr("datetime") || "";

        // استخراج حالة المباراة أو وقتها الحالي
        let matchStatus = "";
        if ($(matchEl).find(".fco-match-state .fco-match-time").length > 0) {
          matchStatus = $(matchEl).find(".fco-match-state .fco-match-time").text().trim();
        } else if ($(matchEl).find(".fco-match-state").length > 0) {
          matchStatus = $(matchEl).find(".fco-match-state").text().trim();
        }

        // معالجة رابط المباراة بشكل صحيح
        let matchUrlPath = $(matchEl).find("a.fco-match-start-date").attr("href") || 
                          $(matchEl).find("a.fco-match-team-and-score__container").attr("href") || "";
        
        // تحويل الرابط إلى الصيغة الصحيحة
        let matchUrl = "";
        if (matchUrlPath) {
          if (matchUrlPath.startsWith("http")) {
            matchUrl = matchUrlPath;
          } else {
            // إذا كان الرابط يحتوي على ترميز URL، نتركه كما هو
            if (matchUrlPath.includes("%")) {
              matchUrl = "https://www.kooora.com" + matchUrlPath;
            } else {
              // إذا كان الرابط غير مرمز، نقوم بترميزه
              matchUrl = "https://www.kooora.com" + encodeURI(matchUrlPath);
            }
          }
        }

        // جلب تفاصيل المباراة الإضافية إذا كان الرابط متاحًا
        let matchDetails = {};
        if (matchUrl) {
          matchDetails = await fetchMatchDetails(matchUrl);
        }

        matches.push({
          homeTeam,
          awayTeam,
          homeLogo,
          awayLogo,
          scoreHome,
          scoreAway,
          time,
          matchStatus,
          matchUrl,
          ...matchDetails
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

// ✅ تشغيل البوت كل دقيقة (يمكن تعديلها حسب الحاجة)
cron.schedule("*/60 * * * * *", fetchMatches);

// تشغيل أول مرة عند بدء السيرفر
fetchMatches();
