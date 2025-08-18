const axios = require("axios");
const { Octokit } = require("@octokit/rest");
const path = require("path");
const fs = require("fs");

// 🔐 إعدادات GitHub
const GITHUB_TOKEN = process.env.TOKEN_KEY; // استخدام متغير البيئة بدلاً من الملف
const REPO_OWNER = "Sami30ouargla";
const REPO_NAME = "football-scraper";
const FILE_PATH = "matches.json";
const BRANCH = "main";

// تهيئة Octokit
const octokit = new Octokit({
  auth: GITHUB_TOKEN,
  baseUrl: "https://api.github.com",
  userAgent: "Football Scraper",
  request: {
    timeout: 10000
  }
});

// ⚙️ إعدادات قابلة للتغيير
const BASE = "https://www.yalla-shoot-365.com";
const LANG = process.env.YS_LANG || "27";
const TIME_OFFSET = encodeURIComponent(process.env.YS_TZ || "+02:00");
const POLL_MS = Number(process.env.POLL_MS || 60_000);
const DATE = process.env.YS_DATE || new Date().toISOString().slice(0, 10);

// 🧩 دوال مساعدة
const abs = (u) => (u?.startsWith("/") ? `${BASE}${u}` : u || "");
const slugify = (txt) =>
  encodeURI(
    String(txt || "")
      .trim()
      .replace(/\s+/g, "-")
      .replace(/-+/g, "-")
  );

function buildDetailsUrl(match, date) {
  const right = match?.["Team-Right"]?.Name || "";
  const left = match?.["Team-Left"]?.Name || "";
  const slug = slugify(`${right}-ضد-${left}`);
  const id = match?.["Match-id"];
  return `${BASE}/match/?${slug}&id=${id}&date=${date}`;
}

function enrichMatch(m, date, details = null) {
  // استخراج رابط البث المباشر من التفاصيل
  let liveStreamUrl = null;
  if (details && details["STING-WEB-Match-Details"]) {
    const matchDetails = details["STING-WEB-Match-Details"];
    if (matchDetails["STING-WEB-WatchTV"]) {
      liveStreamUrl = matchDetails["STING-WEB-WatchTV"];
    } else if (matchDetails["STING-WEB-Match-Info"]) {
      const matchInfo = matchDetails["STING-WEB-Match-Info"];
      const watchTvMatch = matchInfo.match(/<a class="STING-WEB-WatchTV[^>]+href="([^"]+)"/i);
      if (watchTvMatch) {
        liveStreamUrl = watchTvMatch[1];
      }
    }
  }

  return {
    ...m,
    detailsUrl: buildDetailsUrl(m, date),
    matchDetails: {
      ...(details?.["STING-WEB-Match-Details"] || {}),
      "STING-WEB-LiveStream": liveStreamUrl ? abs(liveStreamUrl) : null,
    },
    "Cup-Logo": abs(m?.["Cup-Logo"]),
    "Team-Right": {
      ...(m?.["Team-Right"] || {}),
      Logo: abs(m?.["Team-Right"]?.Logo),
    },
    "Team-Left": {
      ...(m?.["Team-Left"] || {}),
      Logo: abs(m?.["Team-Left"]?.Logo),
    },
  };
}

// 📡 جلب قائمة المباريات
async function fetchMatches(date) {
  const url = `${BASE}/matches/npm/?date=${date}&lang=${LANG}&time=${TIME_OFFSET}`;
  const { data } = await axios.get(url, {
    headers: {
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119 Safari/537.36",
      Accept: "application/json, text/javascript,*/*;q=0.1",
      Referer: `${BASE}/matches/?date=${date}&lang=${LANG}&time=${decodeURIComponent(TIME_OFFSET)}`,
    },
    timeout: 20000,
  });
  return Array.isArray(data?.["STING-WEB-Matches"]) ? data["STING-WEB-Matches"] : [];
}

// 📡 جلب تفاصيل مباراة معينة
async function fetchMatchDetails(matchId) {
  const url = `${BASE}/matches/npm/events/?MatchID=${matchId}&lang=${LANG}&time=-120`;
  try {
    const { data } = await axios.get(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119 Safari/537.36",
        Accept: "application/json, text/javascript,*/*;q=0.1",
      },
      timeout: 20000,
    });
    return data?.["STING-WEB-Match-Details"] || null;
  } catch (err) {
    console.error(`❌ فشل جلب تفاصيل المباراة ${matchId}:`, err.message);
    return null;
  }
}

// 💾 حفظ التحديثات في GitHub + تحديث CDN
async function saveMatches(date, matchesWithDetails) {
  try {
    const data = {
      matches: matchesWithDetails,
      meta: {
        date,
        lastUpdated: new Date().toISOString(),
        count: matchesWithDetails.length,
      },
    };

    // محاولة جلب SHA الملف إذا كان موجوداً
    let sha;
    try {
      const { data: fileData } = await octokit.rest.repos.getContent({
        owner: REPO_OWNER,
        repo: REPO_NAME,
        path: FILE_PATH,
        ref: BRANCH,
      });
      sha = fileData.sha;
    } catch (err) {
      if (err.status !== 404) throw err;
    }

    // رفع الملف إلى GitHub
    await octokit.rest.repos.createOrUpdateFileContents({
      owner: REPO_OWNER,
      repo: REPO_NAME,
      path: FILE_PATH,
      message: `تحديث المباريات - ${new Date().toISOString()}`,
      content: Buffer.from(JSON.stringify(data, null, 2)).toString("base64"),
      sha: sha,
      branch: BRANCH,
    });

    // إرسال طلب لتحديث CDN (jsDelivr)
    try {
      await axios.get(`https://purge.jsdelivr.net/gh/${REPO_OWNER}/${REPO_NAME}@${BRANCH}/${FILE_PATH}`);
      console.log("✅ تم تحديث CDN بنجاح");
    } catch (cdnError) {
      console.warn("⚠️ تحذير: فشل تحديث CDN", cdnError.message);
    }

    console.log("✅ تم تحديث الملف في GitHub بنجاح");
  } catch (err) {
    console.error("❌ فشل في التحديث:", {
      message: err.message,
      status: err.status,
      request: {
        method: err.request?.method,
        url: err.request?.url,
      }
    });
    throw err;
  }
}

// 🔄 حلقة التحديث
async function tick() {
  try {
    console.log(`📡 جلب مباريات ${DATE} (كل ${Math.round(POLL_MS / 1000)} ثانية)...`);
    const rawMatches = await fetchMatches(DATE);
    console.log(`✅ تم جلب ${rawMatches.length} مباراة.`);

    const matchesWithDetails = [];
    for (const match of rawMatches) {
      const details = await fetchMatchDetails(match["Match-id"]);
      matchesWithDetails.push(enrichMatch(match, DATE, details));
    }

    await saveMatches(DATE, matchesWithDetails);
    console.log("🔥 تم التحديث في GitHub وCDN.\n");
  } catch (err) {
    console.error("❌ خطأ:", err?.message || err);
  }
}

// ▶️ تشغيل أولي وتكرار
(async () => {
  // التحقق من وجود التوكن
  if (!GITHUB_TOKEN) {
    console.error("❌ خطأ: لم يتم تعيين متغير البيئة TOKEN_KEY");
    process.exit(1);
  }

  await tick();
  setInterval(tick, POLL_MS);
})();

// ✅ إضافة سيرفر Express علشان Render يفتح رابط عام
const express = require("express");
const app = express();

app.get("/", (req, res) => {
  res.send("⚽ Football Scraper is alive and running!");
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`✅ Web server is running on port ${PORT}`);
});
