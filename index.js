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
  if (!oldData) return newData;
  
  const changes = {};
  const sections = ['matchInfo', 'events', 'stats', 'standings', 'lineups', 'predictions', 'scorers', 'matchDetails'];
  
  sections.forEach(section => {
    if (JSON.stringify(oldData[section]) !== JSON.stringify(newData[section])) {
      changes[section] = newData[section];
    }
  });
  
  return Object.keys(changes).length ? changes : null;
}

// دالة للتحقق من اكتمال البيانات
function validateData(data) {
  const requiredFields = [
    data.matchInfo?.homeTeam,
    data.matchInfo?.awayTeam,
    data.events?.length >= 0, // يمكن أن تكون المباراة بدون أحداث بعد
    Object.keys(data.stats).length > 0
  ];
  
  return requiredFields.every(Boolean);
}

// دالة جلب تفاصيل المباراة
async function fetchMatchDetails() {
  try {
    console.log("⏳ جلب تفاصيل المباراة من Kooora...");
    
    const matchUrl = "https://www.kooora.com/كرة-القدم/مباراة/بالميراس-ضد-سيارا/tl6JyuYs4K2z1AU-7WT1V";
    
    // إضافة headers لتفادي مشاكل CORS
    const { data } = await axios.get(matchUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
        'Accept-Language': 'ar,en-US;q=0.9,en;q=0.8'
      }
    });
    
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
      firstHalfScore: $(".fco-match-header__results-item:first-child .fco-match-header__sub-score").text().trim(),
      finalScore: $(".fco-match-header__results-item:last-child .fco-match-header__sub-score").text().trim(),
      matchUrl: matchUrl
    };

    // 2. الأحداث الرئيسية - معدلة لتعمل مع الهيكل الجديد
    const events = [];
    $(".fco-events__list-element").each((i, el) => {
      const eventElement = $(el).find(".fco-key-event-row");
      const event = {
        time: $(el).find(".fco-match-time").text().trim(),
        icon: $(el).find(".fco-event-icon use").attr("xlink:href")?.split("#")[1] || "unknown",
        text: eventElement.find(".fco-key-event-row__info-description-main, .fco-key-event-row__info-description-whole").text().trim(),
        score: eventElement.find(".fco-key-event-row__score").text().trim(),
        assistant: eventElement.find(".fco-key-event-row__info-description-secondary--opaque").text().trim(),
        team: eventElement.hasClass("fco-key-event-row--team-A") ? "home" : 
              eventElement.hasClass("fco-key-event-row--team-B") ? "away" : "none"
      };
      events.push(event);
    });

    // 3. إحصائيات المباراة - معدلة لتعمل مع الهيكل الجديد
    const stats = {};
    $(".fco-match-stats-row").each((i, el) => {
      const statName = $(el).find(".fco-match-stats-row__label").text().trim();
      if (statName) {
        stats[statName] = {
          home: $(el).find(".fco-match-stats-row__stat:first-child .fco-match-stats-row__stat-label").text().trim() || "0",
          away: $(el).find(".fco-match-stats-row__stat:last-child .fco-match-stats-row__stat-label").text().trim() || "0"
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

    // 5. التشكيلات الأساسية والبدلاء - معدلة لتعمل مع الهيكل الجديد
    const lineups = {
      home: {
        starting: [],
        substitutes: []
      },
      away: {
        starting: [],
        substitutes: []
      }
    };
    
    // جلب تشكيل الفريق المضيف
    $(".fco-lineup-team[data-side='home'] .fco-lineup-player:not(.fco-lineup-player--substitute)").each((i, el) => {
      lineups.home.starting.push({
        player: $(el).find(".fco-lineup-player__name").text().trim(),
        number: $(el).find(".fco-lineup-player__number").text().trim(),
        position: $(el).find(".fco-lineup-player__position").text().trim(),
        isCaptain: $(el).hasClass("fco-lineup-player--captain")
      });
    });
    
    $(".fco-lineup-team[data-side='home'] .fco-lineup-player.fco-lineup-player--substitute").each((i, el) => {
      lineups.home.substitutes.push({
        player: $(el).find(".fco-lineup-player__name").text().trim(),
        number: $(el).find(".fco-lineup-player__number").text().trim()
      });
    });
    
    // جلب تشكيل الفريق الضيف
    $(".fco-lineup-team[data-side='away'] .fco-lineup-player:not(.fco-lineup-player--substitute)").each((i, el) => {
      lineups.away.starting.push({
        player: $(el).find(".fco-lineup-player__name").text().trim(),
        number: $(el).find(".fco-lineup-player__number").text().trim(),
        position: $(el).find(".fco-lineup-player__position").text().trim(),
        isCaptain: $(el).hasClass("fco-lineup-player--captain")
      });
    });
    
    $(".fco-lineup-team[data-side='away'] .fco-lineup-player.fco-lineup-player--substitute").each((i, el) => {
      lineups.away.substitutes.push({
        player: $(el).find(".fco-lineup-player__name").text().trim(),
        number: $(el).find(".fco-lineup-player__number").text().trim()
      });
    });

    // 6. توقعات الجمهور
    const predictions = {
      home: {
        percent: $(".fco-match-predictor__result:first-child .fco-match-predictor__result-vote-percent").text().trim() || "0%",
        votes: $(".fco-match-predictor__result:first-child .fco-match-predictor__result-vote-votes").text().trim() || "0"
      },
      draw: {
        percent: $(".fco-match-predictor__result:nth-child(2) .fco-match-predictor__result-vote-percent").text().trim() || "0%",
        votes: $(".fco-match-predictor__result:nth-child(2) .fco-match-predictor__result-vote-votes").text().trim() || "0"
      },
      away: {
        percent: $(".fco-match-predictor__result:last-child .fco-match-predictor__result-vote-percent").text().trim() || "0%",
        votes: $(".fco-match-predictor__result:last-child .fco-match-predictor__result-vote-votes").text().trim() || "0"
      }
    };

    // 7. الهدافون
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

    // 8. تفاصيل إضافية
    const matchDetails = {
      referee: $(".fco-match-info__referee").text().trim() || 
               $(".fco-match-details__list-item:contains('الحكم')").text().replace('الحكم', '').trim() || 
               "غير معروف",
      stadium: $(".fco-match-info__stadium").text().trim() || 
               $(".fco-match-details__list-item:contains('الملعب')").text().replace('الملعب', '').trim() || 
               "غير معروف",
      attendance: $(".fco-match-info__attendance").text().trim() || "غير معروف"
    };

    const newData = {
      updatedAt: new Date().toISOString(),
      matchInfo,
      events,
      stats,
      standings,
      lineups,
      predictions,
      scorers,
      matchDetails
    };

    // تسجيل البيانات المجموعة للتأكد
    console.log("ℹ️ البيانات المجموعة:");
    console.log("- معلومات المباراة:", newData.matchInfo);
    console.log("- عدد الأحداث:", newData.events.length);
    console.log("- عدد الإحصائيات:", Object.keys(newData.stats).length);
    console.log("- التشكيلات:", {
      home: newData.lineups.home.starting.length + " أساسي + " + newData.lineups.home.substitutes.length + " بدلاء",
      away: newData.lineups.away.starting.length + " أساسي + " + newData.lineups.away.substitutes.length + " بدلاء"
    });

    const snapshot = await db.ref("matchDetails").once("value");
    const oldData = snapshot.val();

    if (validateData(newData)) {
      const changes = findDifferences(oldData, newData);
      
      if (changes) {
        await db.ref("matchDetails").update(changes);
        console.log("✅ تم تحديث تفاصيل المباراة في Firebase بنجاح");
      } else {
        console.log("✅ لا توجد تغييرات جديدة في تفاصيل المباراة");
      }
    } else {
      console.error("❌ البيانات المجموعة غير مكتملة، لم يتم الحفظ");
      console.error("تفاصيل النقص:", {
        hasMatchInfo: !!newData.matchInfo,
        hasEvents: newData.events.length > 0,
        hasStats: Object.keys(newData.stats).length > 0,
        hasLineups: newData.lineups.home.starting.length > 0 || newData.lineups.away.starting.length > 0
      });
    }
  } catch (error) {
    console.error("❌ خطأ في جلب تفاصيل المباراة:", {
      message: error.message,
      stack: error.stack,
      timestamp: new Date().toISOString()
    });
  }
}

// تشغيل البوت كل دقيقتين
cron.schedule("*/2 * * * *", fetchMatchDetails);

// تشغيل أول مرة عند بدء السيرفر
fetchMatchDetails();
