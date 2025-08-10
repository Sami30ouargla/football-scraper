const puppeteer = require('puppeteer');
const admin = require('firebase-admin');
const cron = require('node-cron');

// قراءة مفتاح Firebase من Environment Variables
const firebaseKey = JSON.parse(process.env.FIREBASE_KEY);

admin.initializeApp({
  credential: admin.credential.cert(firebaseKey),
  databaseURL: "https://fast-tv-f9422-default-rtdb.firebaseio.com"
});

const db = admin.database();

async function fetchMatchDetails() {
  try {
    console.log("⏳ جلب تفاصيل المباراة من Kooora باستخدام Puppeteer...");

    const matchUrl = "https://www.kooora.com/%D9%83%D8%B1%D8%A9-%D8%A7%D9%84%D9%82%D8%AF%D9%85/%D9%85%D8%A8%D8%A7%D8%B1%D8%A7%D8%A9/%D8%A8%D8%A7%D9%84%D9%85%D9%8A%D8%B1%D8%A7%D8%B3-%D8%B6%D8%AF-%D8%B3%D9%8A%D8%A7%D8%B1%D8%A7/tl6JyuYs4K2z1AU-7WT1V";

    const browser = await puppeteer.launch({
      args: ['--no-sandbox', '--disable-setuid-sandbox'],
      headless: true
    });

    const page = await browser.newPage();

    await page.goto(matchUrl, { waitUntil: 'networkidle0' });

    // تنفيذ جافاسكريبت داخل الصفحة للحصول على البيانات
    const newData = await page.evaluate(() => {
      const matchInfo = {
        leagueName: document.querySelector(".fco-match-header-competition-name")?.textContent.trim() || "غير معروف",
        matchDate: document.querySelector(".fco-match-header-match-day")?.getAttribute("datetime") || "",
        homeTeam: document.querySelector(".fco-match-header__grid-team:first-child .fco-long-name")?.textContent.trim() || "",
        awayTeam: document.querySelector(".fco-match-header__grid-team:last-child .fco-long-name")?.textContent.trim() || "",
        homeLogo: document.querySelector(".fco-match-header__grid-team:first-child img")?.getAttribute("src") || "",
        awayLogo: document.querySelector(".fco-match-header__grid-team:last-child img")?.getAttribute("src") || "",
        scoreHome: document.querySelector(".fco-match-header-score[data-side='team-a']")?.textContent.trim() || "-",
        scoreAway: document.querySelector(".fco-match-header-score[data-side='team-b']")?.textContent.trim() || "-",
        matchStatus: document.querySelector(".fco-match-state")?.textContent.trim() || "",
        firstHalfScore: document.querySelector(".fco-match-header__results-item:first-child .fco-match-header__sub-score")?.textContent.trim() || "",
        finalScore: document.querySelector(".fco-match-header__results-item:last-child .fco-match-header__sub-score")?.textContent.trim() || "",
        matchUrl: location.href
      };

      const events = [];
      document.querySelectorAll(".fco-events__list-element").forEach(el => {
        const eventElement = el.querySelector(".fco-key-event-row");
        events.push({
          time: el.querySelector(".fco-match-time")?.textContent.trim() || "",
          icon: eventElement?.querySelector("use")?.getAttribute("xlink:href")?.split("#")[1] || "unknown",
          text: eventElement?.querySelector(".fco-key-event-row__info-description-main")?.textContent.trim() || "",
          assistant: eventElement?.querySelector(".fco-key-event-row__info-description-secondary--opaque")?.textContent.trim() || "",
          score: eventElement?.querySelector(".fco-key-event-row__score")?.textContent.trim() || "",
          team: eventElement?.classList.contains("fco-key-event-row--team-A") ? "home" :
                eventElement?.classList.contains("fco-key-event-row--team-B") ? "away" : "none"
        });
      });

      const stats = {};
      document.querySelectorAll(".fco-match-stats-row").forEach(el => {
        const statName = el.querySelector(".fco-match-stats-row__label")?.textContent.trim();
        if (statName) {
          stats[statName] = {
            home: el.querySelector(".fco-match-stats-row__stat:first-child .fco-match-stats-row__stat-label")?.textContent.trim() || "0",
            away: el.querySelector(".fco-match-stats-row__stat:last-child .fco-match-stats-row__stat-label")?.textContent.trim() || "0"
          };
        }
      });

      const standings = [];
      document.querySelectorAll(".fco-standings-table__row").forEach(el => {
        const position = el.querySelector(".fco-standings-table__cell--position")?.textContent.trim();
        const team = el.querySelector(".fco-standings-table__team-name--long")?.textContent.trim();
        const played = el.querySelector(".fco-standings-table__cell--played")?.textContent.trim();
        const points = el.querySelector(".fco-standings-table__cell--points")?.textContent.trim();
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

      const lineups = { home: { starting: [], substitutes: [] }, away: { starting: [], substitutes: [] } };
      
      document.querySelectorAll(".fco-lineup-team[data-side='home'] .fco-lineup-player:not(.fco-lineup-player--substitute)").forEach(el => {
        lineups.home.starting.push({
          player: el.querySelector(".fco-lineup-player__name")?.textContent.trim(),
          number: el.querySelector(".fco-lineup-player__number")?.textContent.trim(),
          position: el.querySelector(".fco-lineup-player__position")?.textContent.trim(),
          isCaptain: el.classList.contains("fco-lineup-player--captain")
        });
      });
      document.querySelectorAll(".fco-lineup-team[data-side='home'] .fco-lineup-player.fco-lineup-player--substitute").forEach(el => {
        lineups.home.substitutes.push({
          player: el.querySelector(".fco-lineup-player__name")?.textContent.trim(),
          number: el.querySelector(".fco-lineup-player__number")?.textContent.trim()
        });
      });

      document.querySelectorAll(".fco-lineup-team[data-side='away'] .fco-lineup-player:not(.fco-lineup-player--substitute)").forEach(el => {
        lineups.away.starting.push({
          player: el.querySelector(".fco-lineup-player__name")?.textContent.trim(),
          number: el.querySelector(".fco-lineup-player__number")?.textContent.trim(),
          position: el.querySelector(".fco-lineup-player__position")?.textContent.trim(),
          isCaptain: el.classList.contains("fco-lineup-player--captain")
        });
      });
      document.querySelectorAll(".fco-lineup-team[data-side='away'] .fco-lineup-player.fco-lineup-player--substitute").forEach(el => {
        lineups.away.substitutes.push({
          player: el.querySelector(".fco-lineup-player__name")?.textContent.trim(),
          number: el.querySelector(".fco-lineup-player__number")?.textContent.trim()
        });
      });

      const predictions = {
        home: {
          percent: document.querySelector(".fco-match-predictor__result:first-child .fco-match-predictor__result-vote-percent")?.textContent.trim() || "0%",
          votes: document.querySelector(".fco-match-predictor__result:first-child .fco-match-predictor__result-vote-votes")?.textContent.trim() || "0"
        },
        draw: {
          percent: document.querySelector(".fco-match-predictor__result:nth-child(2) .fco-match-predictor__result-vote-percent")?.textContent.trim() || "0%",
          votes: document.querySelector(".fco-match-predictor__result:nth-child(2) .fco-match-predictor__result-vote-votes")?.textContent.trim() || "0"
        },
        away: {
          percent: document.querySelector(".fco-match-predictor__result:last-child .fco-match-predictor__result-vote-percent")?.textContent.trim() || "0%",
          votes: document.querySelector(".fco-match-predictor__result:last-child .fco-match-predictor__result-vote-votes")?.textContent.trim() || "0"
        }
      };

      const scorers = { home: [], away: [] };
      document.querySelectorAll(".fco-match-header__scorers-left li").forEach(el => {
        scorers.home.push(el.textContent.trim());
      });
      document.querySelectorAll(".fco-match-header__scorers-right li").forEach(el => {
        scorers.away.push(el.textContent.trim());
      });

      const matchDetails = {
        referee: document.querySelector(".fco-match-info__referee")?.textContent.trim() ||
                 document.querySelector(".fco-match-details__list-item:contains('الحكم')")?.textContent.replace('الحكم', '').trim() || "غير معروف",
        stadium: document.querySelector(".fco-match-info__stadium")?.textContent.trim() ||
                 document.querySelector(".fco-match-details__list-item:contains('الملعب')")?.textContent.replace('الملعب', '').trim() || "غير معروف",
        attendance: document.querySelector(".fco-match-info__attendance")?.textContent.trim() || "غير معروف"
      };

      return {
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
    });

    await browser.close();

    console.log("ℹ️ البيانات المجموعة:");
    console.log("- معلومات المباراة:", newData.matchInfo);
    console.log("- عدد الأحداث:", newData.events.length);
    console.log("- عدد الإحصائيات:", Object.keys(newData.stats).length);
    console.log("- التشكيلات:", {
      home: newData.lineups.home.starting.length + " أساسي + " + newData.lineups.home.substitutes.length + " بدلاء",
      away: newData.lineups.away.starting.length + " أساسي + " + newData.lineups.away.substitutes.length + " بدلاء"
    });

    // تخزين البيانات في Firebase Realtime Database
    await db.ref("matchDetails").set(newData);

    console.log("✅ تم تحديث تفاصيل المباراة في Firebase بنجاح");
  } catch (error) {
    console.error("❌ خطأ في جلب تفاصيل المباراة:", error);
  }
}

// تشغيل البوت كل دقيقتين
cron.schedule("*/2 * * * *", fetchMatchDetails);

// تشغيل أول مرة عند بدء السيرفر
fetchMatchDetails();
