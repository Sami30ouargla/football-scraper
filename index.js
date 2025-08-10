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
    
    const matchUrl = "https://www.kooora.com/%D9%83%D8%B1%D8%A9-%D8%A7%D9%84%D9%82%D8%AF%D9%85/%D9%85%D8%A8%D8%A7%D8%B1%D8%A7%D8%A9/%D8%A8%D8%A7%D9%84%D9%85%D9%8A%D8%B1%D8%A7%D8%B3-%D8%B6%D8%AF-%D8%B3%D9%8A%D8%A7%D8%B1%D8%A7/tl6JyuYs4K2z1AU-7WT1V";
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
      firstHalfScore: $(".fco-match-header__results-item:first-child .fco-match-header__sub-score").text().trim(),
      finalScore: $(".fco-match-header__results-item:last-child .fco-match-header__sub-score").text().trim(),
      matchUrl: matchUrl
    };

    // 2. الأحداث الرئيسية (من قسم الأحداث)
    const events = [];
    $(".fco-events__list-element").each((i, el) => {
      const eventTime = $(el).find(".fco-match-time").text().trim();
      const eventIcon = $(el).find(".fco-event-icon use").attr("xlink:href").split("#")[1];
      const eventText = $(el).find(".fco-key-event-row__info-description-main").text().trim() || 
                       $(el).find(".fco-key-event-row__info-description-whole").text().trim();
      const eventScore = $(el).find(".fco-key-event-row__score").text().trim();
      const secondaryText = $(el).find(".fco-key-event-row__info-description-secondary--opaque").text().trim();
      
      // تحديد نوع الحدث بناء على الأيقونة
      let eventType = "other";
      if (eventIcon.includes("GOAL")) eventType = "goal";
      if (eventIcon.includes("CARD_YELLOW")) eventType = "yellow_card";
      if (eventIcon.includes("CARD_RED")) eventType = "red_card";
      if (eventIcon.includes("SUB")) eventType = "substitution";
      if (eventIcon.includes("PENALTY")) eventType = "penalty";
      
      // تحديد الفريق
      let team = "none";
      if ($(el).find(".fco-key-event-row--team-A").length) team = "home";
      if ($(el).find(".fco-key-event-row--team-B").length) team = "away";
      
      events.push({
        type: eventType,
        text: eventText,
        time: eventTime,
        team: team,
        score: eventScore,
        secondaryText: secondaryText,
        iconType: eventIcon
      });
    });

    // 3. إحصائيات المباراة (معدلة لتعمل مع الهيكل الجديد)
    const stats = {};
    $(".fco-match-stats-row").each((i, el) => {
      const statName = $(el).find(".fco-match-stats-row__label").text().trim();
      const homeValue = $(el).find(".fco-match-stats-row__stat:first-child .fco-match-stats-row__stat-label").text().trim();
      const awayValue = $(el).find(".fco-match-stats-row__stat:last-child .fco-match-stats-row__stat-label").text().trim();
      
      if (statName && homeValue && awayValue) {
        stats[statName] = {
          home: homeValue,
          away: awayValue
        };
      }
    });

    // 4. ترتيب الفريقين في الدوري (محدثة)
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

    // 5. التشكيلات الأساسية والبدلاء (محدثة)
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
    
    // ملء التشكيلات من الهيكل الجديد
    $(".fco-lineup-team[data-side='home'] .fco-lineup-player:not(.fco-lineup-player--substitute)").each((i, el) => {
      lineups.home.starting.push({
        player: $(el).find(".fco-lineup-player__name").text().trim(),
        number: $(el).find(".fco-lineup-player__number").text().trim(),
        position: $(el).find(".fco-lineup-player__position").text().trim()
      });
    });
    
    $(".fco-lineup-team[data-side='home'] .fco-lineup-player.fco-lineup-player--substitute").each((i, el) => {
      lineups.home.substitutes.push({
        player: $(el).find(".fco-lineup-player__name").text().trim(),
        number: $(el).find(".fco-lineup-player__number").text().trim()
      });
    });
    
    $(".fco-lineup-team[data-side='away'] .fco-lineup-player:not(.fco-lineup-player--substitute)").each((i, el) => {
      lineups.away.starting.push({
        player: $(el).find(".fco-lineup-player__name").text().trim(),
        number: $(el).find(".fco-lineup-player__number").text().trim(),
        position: $(el).find(".fco-lineup-player__position").text().trim()
      });
    });
    
    $(".fco-lineup-team[data-side='away'] .fco-lineup-player.fco-lineup-player--substitute").each((i, el) => {
      lineups.away.substitutes.push({
        player: $(el).find(".fco-lineup-player__name").text().trim(),
        number: $(el).find(".fco-lineup-player__number").text().trim()
      });
    });

    // 6. توقعات الجمهور (محدثة)
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

    // 7. الهدافون (محدثة)
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

    // 8. تفاصيل إضافية (مضافة)
    const matchDetails = {
      referee: $(".fco-match-details__list-item:contains('الحكم')").text().replace('الحكم', '').trim(),
      stadium: $(".fco-match-details__list-item:contains('الملعب')").text().replace('الملعب', '').trim()
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
