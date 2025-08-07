const axios = require("axios");
const cheerio = require("cheerio");

const fetchMatches = async () => {
  try {
    const { data } = await axios.get("https://www.fotmob.com/world");
    const $ = cheerio.load(data);

    const matches = [];

    $(".fco-group").each((i, section) => {
      const league = $(section).find(".fco-group-header__name").text().trim();

      $(section).find(".fco-match-row").each((j, matchEl) => {
        const time = $(matchEl).find("time").attr("datetime") || "";

        const teamA = $(matchEl).find('[data-side="team-a"] .fco-team-name.fco-long-name').text().trim();
        const teamB = $(matchEl).find('[data-side="team-b"] .fco-team-name.fco-long-name').text().trim();

        const logoA = $(matchEl).find('[data-side="team-a"] img').attr("src") || "";
        const logoB = $(matchEl).find('[data-side="team-b"] img').attr("src") || "";

        const scoreA = $(matchEl).find(".fco-match-score[data-side='team-a']").text().trim() || "-";
        const scoreB = $(matchEl).find(".fco-match-score[data-side='team-b']").text().trim() || "-";

        matches.push({
          league,
          time,
          teamA,
          teamB,
          logoA,
          logoB,
          scoreA,
          scoreB,
        });
      });
    });

    console.log(matches);
  } catch (err) {
    console.error("Error:", err.message);
  }
};

fetchMatches();
