
// /* DraftPicksManager stub */
if (typeof DraftPicksManager === 'undefined') {
  var DraftPicksManager = { save:()=>{}, load:()=>null, applyToState:()=>false, applyToUI:()=>{}, clear:()=>{}, _key:()=>'' };
}


// ===== Auth helpers to prevent "logged out but no error" states =====
async function requireSession() {
  const r1 = await supabase.auth.getSession();
  let session = r1?.data?.session || null;
  if (!session) {
    try {
      const r2 = await supabase.auth.refreshSession();
      session = r2?.data?.session || null;
    } catch (_) {}
  }
  if (!session) {
    console.warn('[auth] No session; showing login page');
    if (typeof showPage === 'function') showPage('login');
    throw new Error('NO_SESSION');
  }
  return session;
}

// Wrap a Supabase call; on 401/403, refresh + retry once
async function withAuth(fn) {
  try {
    await requireSession();
    return await fn();
  } catch (e) {
    if (e && (e.status === 401 || e.status === 403 || ((e.message||'') && (e.message||'').includes('JWT')))) {
      try { await supabase.auth.refreshSession(); } catch (_) {}
      try { supabase.auth.startAutoRefresh(); } catch (_) {}
      return await fn();
    }
    throw e;
}}

// Start auto refresh whenever we come to foreground
function startAutoRefreshIfNeeded() {
  try { supabase.auth.startAutoRefresh(); } catch (_) {}
}
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') startAutoRefreshIfNeeded();
});
window.addEventListener('focus', startAutoRefreshIfNeeded);
window.addEventListener('pageshow', (e) => { if (e.persisted) startAutoRefreshIfNeeded(); });
// ====================================================================

// =================================================================
// CONFIGURATION & INITIALIZATION
// =================================================================
const SUPABASE_URL = 'https://mtjflkwoxjnwaawjlaxy.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im10amZsa3dveGpud2Fhd2psYXh5Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTU3MDY1MzQsImV4cCI6MjA3MTI4MjUzNH0.PflqgxXG3kISTpp7nUNCXiBn-Ue3kvKNIS2yV1oz-jg';
const supabase = self.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: {
    autoRefreshToken: true,
    persistSession: true
  }
});

// ------- Robust Resume Seatbelt -------
let __wentHiddenAt = 0;

async function __rehydrateAll(reason = 'resume') {
  try { await supabase.auth.getSession(); } catch (e) {}

  try { if (typeof fetchGameData === 'function') { await fetchGameData(); } } catch (e) {}

  try { if (typeof initializeAppForUser === 'function') { await initializeAppForUser(); } } catch (e) {}

  try {
    const active = document.querySelector('.page.active');
    if (active && typeof showPage === 'function') showPage(active.id);
  } catch (e) {}

  try {
    if (window.__activePopupId === 'info-modal' && window.__infoPopupCtx) {
      const { teamName } = window.__infoPopupCtx;
      if (typeof showInfoPopup === 'function') await showInfoPopup(teamName);
    }
  } catch (e) {}

  try {
    document.querySelectorAll('.modal-overlay').forEach(el => {
      const hiddenish = el.classList.contains('hidden') || getComputedStyle(el).opacity === '0';
      if (hiddenish) {
        el.classList.add('hidden');
        el.style.pointerEvents = 'none';
      }
    });
  } catch (e) {}
}

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') {
    __wentHiddenAt = Date.now();
  } else if (document.visibilityState === 'visible') {
    const awayMs = Date.now() - (__wentHiddenAt || Date.now());
    const doFull = awayMs > 10_000;
    let done = false;

    Promise.race([
      __rehydrateAll('visibilitychange').then(() => { done = true; }),
      new Promise(res => setTimeout(res, 1200))
    ]).then(() => {
      if (!done && doFull) location.reload();
    });
  }
});

window.addEventListener('pageshow', (e) => {
  if (e.persisted) location.reload();
});

window.addEventListener('focus', () => { __rehydrateAll('focus'); });
// ------- End Seatbelt -------


const SHEET_URL = 'https://docs.google.com/spreadsheets/d/e/2PACX-1vScqmMOmdB95tGFqkzzPMNUxnGdIum_bXFBhEvX8Xj-b0M3hZYCu8w8V9k7CgKvjHMCtnmj3Y3Vza0A/pub?gid=1227961915&single=true&output=csv';
const TEAM_INFO_URL = 'https://docs.google.com/spreadsheets/d/e/2PACX-1vScqmMOmdB95tGFqkzzPMNUxnGdIum_bXFBhEvX8Xj-b0M3hZYCu8w8V9k7CgKvjHMCtnmj3Y3Vza0A/pub?gid=2118253087&single=true&output=csv';
// --- STATE MANAGEMENT ---
let allGames = [];
let teamData = {};
let teamInfo = {};
let defaultWeek = '';
let currentUser = null;
let currentUserProfile = null; 
let userPicks = {};
let userWagers = {};
let doubleUpPick = null; DraftPicksManager.save(); // For single-double-up mode
let userDoubleUps = new Set(); // For multiple-double-up mode
let currentMatchSettings = {}; // To store the settings of the current match
let initiallySavedPicks = new Set();
let scoreChartInstance = null;
let currentSelectedMatchId = null;

var DraftPicksManager = {
  _key() {
    const week = (document.getElementById('week-selector')?.value || defaultWeek || '').toString();
    const matchId = (currentSelectedMatchId || 'nomatch').toString();
    const uid = (currentUser && currentUser.id) ? currentUser.id : 'anon';
    return `draftPicks:v1:${uid}:${matchId}:${week}`;
  },
  snapshot() {
    return {
      userPicks,
      userWagers,
      doubleUpPick,
      userDoubleUps: Array.from(userDoubleUps),
      ts: Date.now()
    };
  },
  save() {
    try { localStorage.setItem(this._key(), JSON.stringify(this.snapshot())); } catch (e) { /* ignore */ }
  },
  load() {
    try {
      const raw = localStorage.getItem(this._key());
      return raw ? JSON.parse(raw) : null;
    } catch (e) { return null; }
  },
  clear() {
    try { localStorage.removeItem(this._key()); } catch (e) {}
  },
  applyToState() {
    const d = this.load();
    if (!d) return false;
    try {
      userPicks = Object.assign({}, userPicks, d.userPicks || {});
      userWagers = Object.assign({}, userWagers, d.userWagers || {});
      if (d.doubleUpPick != null) doubleUpPick = d.doubleUpPick;
      if (Array.isArray(d.userDoubleUps)) userDoubleUps = new Set(d.userDoubleUps);
      return true;
    } catch (e) { return false; }
  },
  applyToUI() {
    try {
      const container = document.getElementById('games-container');
      if (!container) return;
      // teams
      Object.entries(userPicks || {}).forEach(([gid, team]) => {
        if (!team) return;
        const card = container.querySelector(`.game-card[data-game-id="${gid}"]`);
        if (!card) return;
        card.querySelectorAll('.team').forEach(t => {
          t.classList.toggle('selected', t.dataset.teamName === team);
        });
      });
      // wagers
      Object.entries(userWagers || {}).forEach(([gid, w]) => {
        if (!w) return;
        const card = container.querySelector(`.game-card[data-game-id="${gid}"]`);
        if (!card) return;
        card.querySelectorAll('.wager-btn').forEach(b => {
          const val = parseInt(b.dataset.value, 10);
          b.classList.toggle('selected', val === parseInt(w, 10));
        });
      });
      // double ups
      if (currentMatchSettings && currentMatchSettings.allow_multiple_double_ups) {
        container.querySelectorAll('.game-card').forEach(card => {
          const gid = card.dataset.gameId;
          const btn = card.querySelector('.individual-double-up');
          if (btn && gid) btn.classList.toggle('selected', userDoubleUps.has(gid));
        });
      } else if (doubleUpPick) {
        const btn = container.querySelector(`.game-card[data-game-id="${doubleUpPick}"] .shared-double-up`);
        if (btn) btn.classList.add('selected'); DraftPicksManager.save();
      }
      if (typeof updatePicksCounter === 'function') updatePicksCounter(); DraftPicksManager.save();
    } catch (e) {}
  }
};
// === End Draft Picks Autosave ===
// === Draft Picks Autosave (persists unsaved selections across tab switch / refresh) ===



// *** NEW: A reliable, built-in default avatar to prevent network errors ***
const DEFAULT_AVATAR_URL = 'https://mtjflkwoxjnwaawjlaxy.supabase.co/storage/v1/object/sign/Assets/ChatGPT%20Image%20Sep%2012,%202025,%2004_06_17%20PM.png?token=eyJraWQiOiJzdG9yYWdlLXVybC1zaWduaW5nLWtleV8zZTY3ZGM1Mi0xZGZiLTQ5ZGYtYmRjZC02Y2VlZWQwMWFkMTUiLCJhbGciOiJIUzI1NiJ9.eyJ1cmwiOiJBc3NldHMvQ2hhdEdQVCBJbWFnZSBTZXAgMTIsIDIwMjUsIDA0XzA2XzE3IFBNLnBuZyIsImlhdCI6MTc1NzcwNzU5MywiZXhwIjoxNzg5MjQzNTkzfQ.CWGJaiGmfGGmq7RACw3TAP7DI-gpx4I6EtYcXw1LznU';

// --- NEW: Helper map to get a team ID from its name for stat lookups ---
const teamNameToIdMap = new Map([
    ['Atlanta Falcons', 1], ['Buffalo Bills', 2], ['Chicago Bears', 3],
    ['Cincinnati Bengals', 4], ['Cleveland Browns', 5], ['Dallas Cowboys', 6],
    ['Denver Broncos', 7], ['Detroit Lions', 8], ['Green Bay Packers', 9],
    ['Tennessee Titans', 10], ['Indianapolis Colts', 11], ['Kansas City Chiefs', 12],
    ['Las Vegas Raiders', 13], ['Los Angeles Rams', 14], ['Miami Dolphins', 15],
    ['Minnesota Vikings', 16], ['New England Patriots', 17], ['New Orleans Saints', 18],
    ['New York Giants', 19], ['New York Jets', 20], ['Philadelphia Eagles', 21],
    ['Arizona Cardinals', 22], ['Pittsburgh Steelers', 23], ['Los Angeles Chargers', 24],
    ['San Francisco 49ers', 25], ['Seattle Seahawks', 26], ['Tampa Bay Buccaneers', 27],
    ['Washington Commanders', 28], ['Carolina Panthers', 29], ['Jacksonville Jaguars', 30],
    ['Baltimore Ravens', 33], ['Houston Texans', 34]
]);

// --- NEW: Mappings for displaying stats from the database ---
const statMappings = {
    'General': {
        'total_penalties': 'Total Penalties',
        'total_penalty_yards': 'Penalty Yards',
        'fumbles': 'Fumbles',
        'fumbles_lost': 'Fumbles Lost',
        'turnover_differential': 'Turnover +/-'
    },
    'Passing': {
        'passing_yards': 'Passing Yards',
        'passing_tds': 'Passing TDs',
        'passing_attempts': 'Attempts',
        'completions': 'Completions',
        'completion_pct': 'Completion %',
        'yards_per_pass_attempt': 'Yards/Attempt',
        'sacks': 'Sacks Taken',
        'qb_rating': 'Passer Rating'
    },
    'Rushing': {
        'rushing_yards': 'Rushing Yards',
        'rushing_tds': 'Rushing TDs',
        'rushing_attempts': 'Attempts',
        'yards_per_rush_attempt': 'Yards/Attempt'
    },
    'Receiving': {
        'receptions': 'Receptions',
        'receiving_yards': 'Receiving Yards',
        'receiving_tds': 'Receiving TDs',
        'receiving_targets': 'Targets',
        'yards_per_reception': 'Yards/Reception'
    },
    'Defense': {
        'defensive_sacks': 'Sacks',
        'defensive_interceptions': 'Interceptions',
        'total_tackles': 'Total Tackles',
        'tackles_for_loss': 'Tackles for Loss',
        'passes_defended': 'Passes Defended',
        'fumbles_forced': 'Fumbles Forced'
    },
    'Downs': {
        'first_downs': 'Total First Downs',
        'third_down_conv_pct': '3rd Down %',
        'fourth_down_conv_pct': '4th Down %'
    }
};

// =================================================================
// EVENT LISTENERS
// =================================================================
document.addEventListener('DOMContentLoaded', init);

// =================================================================
// UTILITY & HELPER FUNCTIONS
// =================================================================
function parseCSV(csvText) {
    const lines = csvText.trim().replace(/\r\n/g, '\n').split('\n');
    if (lines.length < 2) return [];
    const headers = lines[0].split(',').map(h => h.trim());
    const regex = /(?:"([^"]*)"|([^,]*))(?:,|$)/g;
    const dataRows = lines.slice(1)
        .map(line => {
            if (!line || line.trim() === '') {
                return null;
            }
            const values = [];
            let match;
            regex.lastIndex = 0;
            while (match = regex.exec(line)) {
                if (match.index === regex.lastIndex) {
                    regex.lastIndex++;
                }
                values.push(match[1] || match[2] || '');
            }
            if (values.length > headers.length) {
                values.pop();
            }
            const game = {};
            headers.forEach((header, index) => {
                let value = values[index] || '';
                game[header] = value.trim();
            });
            return game;
        })
        .filter(game => game !== null);
    return dataRows;
}

function parseTeamInfoCSV(csvText) {
    const rawLines = csvText.trim().replace(/\r\n/g, '\n').split('\n');
    const lines = [];
    let currentLine = '';
    for (const rawLine of rawLines) {
        currentLine += rawLine;
        const quoteCount = (currentLine.match(/"/g) || []).length;
        if (quoteCount % 2 === 0) {
            lines.push(currentLine);
            currentLine = '';
        } else {
            currentLine += '\n';
        }
    }
    if (currentLine) lines.push(currentLine);
    if (lines.length < 2) return [];

    // --- THIS IS THE FIX: Added 'News' to the headers ---
    const headers = ['Index', 'TeamName', 'AISummary', 'DepthChart', 'News'];
    const dataRows = [];
    const regex = /(?:"([^"]*)"|([^,]*))(?:,|$)/g;

    for (let i = 1; i < lines.length; i++) {
        const line = lines[i];
        if (!line || line.trim() === '' || line.startsWith('"Please provide')) continue;
        const values = [];
        let match;
        regex.lastIndex = 0;
        while (match = regex.exec(line)) {
            if (match.index === regex.lastIndex) regex.lastIndex++;
            values.push((match[1] || match[2] || '').trim());
        }
        const rowData = {};
        headers.forEach((header, index) => {
            let value = values[index] || '';
            if (header === 'AISummary' && value.startsWith('"') && value.endsWith('"')) {
                value = value.substring(1, value.length - 1);
            }
            rowData[header] = value.replace(/""/g, '"');
        });
        if (rowData.TeamName) {
            dataRows.push({
                'TeamName': rowData.TeamName,
                'AISummary': rowData.AISummary,
                'DepthChart': rowData.DepthChart,
                'News': rowData.News // --- THIS IS THE FIX: Added 'News' data ---
            });
        }
    }
    return dataRows;
}



function getKickoffTimeAsDate(game) {
    if (!game || !game.Date || !game.Time) {
        return new Date('1970-01-01T00:00:00Z');
    }
    try {
        const datePart = game.Date.split(' ')[1];
        const timePart = game.Time;
        const [month, day, year] = datePart.split('/');
        let [time, modifier] = timePart.split(' ');
        let [hours, minutes] = time.split(':');
        hours = parseInt(hours, 10);
        if (modifier && modifier.toUpperCase() === 'PM' && hours < 12) hours += 12;
        if (modifier && modifier.toUpperCase() === 'AM' && hours === 12) hours = 0;
        const monthIndex = parseInt(month, 10) - 1;
        return new Date(Date.UTC(year, monthIndex, day, hours, minutes, 0) + (4 * 60 * 60 * 1000));
    } catch (e) {
        console.error("Failed to parse date for game:", game, e);
        return new Date('1970-01-01T00:00:00Z');
    }
}

function determineDefaultWeek(games) {
    // --- THIS IS THE NEW LOGIC ---
    // This function now determines the default week by finding the first week
    // where not all games have a final status ('post').

    // Filter for games that are part of the regular season.
    const regularSeasonGames = games.filter(g => g.Week && g.Week.startsWith('Week '));
    
    // If there are no games, default to Week 1.
    if (regularSeasonGames.length === 0) {
        return 'Week 1';
    }

    // Get all unique weeks and sort them numerically.
    const allWeeksSorted = [...new Set(regularSeasonGames.map(g => g.Week))]
        .sort((a, b) => parseInt(a.split(' ')[1]) - parseInt(b.split(' ')[1]));

    // Find the first week that is not fully completed.
    const currentWeek = allWeeksSorted.find(week => {
        // Get all games for the specific week.
        const gamesInWeek = regularSeasonGames.filter(g => g.Week === week);
        
        // If there are no games for this week for some reason, we can't evaluate it.
        if (gamesInWeek.length === 0) {
            return false;
        }
        
        // Check if every single game in this week has the status 'post' (final).
        const allGamesFinal = gamesInWeek.every(g => g.Status === 'post');
        
        // We are looking for the first week where NOT all games are final.
        return !allGamesFinal;
    });

    // If we found a week that's not yet complete, that's our default week.
    // If all games in all weeks are complete, default to the very last week of the season.
    return currentWeek || allWeeksSorted[allWeeksSorted.length - 1];
    // --- END OF NEW LOGIC ---
}

// =================================================================
// NAVIGATION & UI MANAGEMENT
// =================================================================

// *** NEW: Robust function to update the avatar preview image ***
function updateAvatarPreview(url) {
    const avatarPreview = document.getElementById('profile-avatar-preview');
    // Use the provided URL, but fall back to our reliable default if it's empty
    avatarPreview.src = url || DEFAULT_AVATAR_URL;
    
    // *** THIS IS THE FIX ***
    // If the user-provided URL fails to load, this function will run.
    avatarPreview.onerror = () => {
        // Fall back to the default avatar.
        avatarPreview.src = DEFAULT_AVATAR_URL;
        // CRITICAL: Remove the onerror listener to prevent an infinite loop if the default ever fails.
        avatarPreview.onerror = null; 
    };
}


function updateUserStatusUI(userProfile) {
    const userStatusDiv = document.getElementById('user-status');
    const mainNav = document.getElementById('main-nav');
    const hamburgerBtn = document.getElementById('hamburger-btn');

    if (currentUser && userProfile) {
        const username = userProfile.username || currentUser.email;
        const avatarUrl = userProfile.avatar_url;
        
        const avatarImg = `<img src="${avatarUrl || DEFAULT_AVATAR_URL}" alt="User Avatar" class="header-avatar">`;
        const logoutIcon = `<svg xmlns="http://www.w3.org/2000/svg" height="24px" viewBox="0 0 24 24" width="24px" fill="white"><path d="M0 0h24v24H0z" fill="none"/><path d="M17 7l-1.41 1.41L18.17 11H8v2h10.17l-2.58 2.58L17 17l5-5zM4 5h8V3H4c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h8v-2H4V5z"/></svg>`;

        // --- THIS IS THE FIX ---
        // The HTML comments have been removed from the string.
        userStatusDiv.innerHTML = `
            <a href="#home" class="user-profile-link nav-link">
                ${avatarImg}
                <span class="welcome-message-text">Welcome, ${username}</span>
            </a>
            <button id="logout-btn" class="logout-icon-btn" title="Logout">${logoutIcon}</button>
        `;
        // --- END OF FIX ---

        mainNav.classList.remove('hidden');
        hamburgerBtn.classList.remove('hidden');
    } else {
        userStatusDiv.innerHTML = `<a href="#auth" class="nav-link">Login / Sign Up</a>`;
        mainNav.classList.add('hidden');
        hamburgerBtn.classList.add('hidden');
    }
}

async function fetchGameData() {
    try {
        // Step 1: Fetch all data from our new, fast 'game_data' table,
        // asking the database to pre-sort it by kickoff time.
        const { data, error } = await supabase
            .from('game_data')
            .select('*')
            .order('kickoff', { ascending: true }); // Sorts all games chronologically

        if (error) {
            throw error; // If Supabase returns an error, we'll handle it below
        }

        // Step 2: Map the database columns (e.g., 'home_team_name') to the
        // old property names your app expects (e.g., 'Home Team'). This ensures
        // that no other part of your app needs to be changed.
        allGames = data.map(game => ({
            'Week': game.week,
            'Date': new Date(game.kickoff).toLocaleDateString('en-US', { weekday: 'short', year: 'numeric', month: 'numeric', day: 'numeric' }),
            'Time': new Date(game.kickoff).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }),
            'Away Team': game.away_team_name,
            'Away': game.away_team_abbr,
            'Home Team': game.home_team_name,
            'Home': game.home_team_abbr,
            'Away Score': game.away_score,
            'Home Score': game.home_score,
            'Qtr': game.period,
            'Clock': game.display_clock,
            'Situation': game.situation,
            'Pos': game.possession_team,
            'Status': game.status,
            'Game Id': game.game_id,
            'O/U': game.over_under,
            'Odds': game.odds,
            'Favored Team': game.favored_team,
            'Spread': game.spread,
            'Home Display Name': game.home_display_name,
            'Away Display Name': game.away_display_name,
            'Game Winner': game.game_winner,
            'Game Loser': game.game_loser,
            'Away Logo': game.away_logo,
            'Home Logo': game.home_logo,
        }));

        // Step 3: This part of the logic remains the same. It builds the
        // 'teamData' object that other functions rely on.
        allGames.forEach(game => {
            if (game['Home Display Name'] && game['Home Logo']) {
                teamData[game['Home Display Name']] = game['Home Logo'];
            }
            if (game['Away Display Name'] && game['Away Logo']) {
                teamData[game['Away Display Name']] = game['Away Logo'];
            }
        });

    } catch (error) {
        // If anything goes wrong, log the error and show a message to the user.
        console.error("CRITICAL: Failed to fetch game data from Supabase table.", error);
        document.querySelector('main.container').innerHTML = "<h1>Could not load game data. Please refresh the page.</h1>";
    }
}


function showPage(pageId) {
    document.querySelectorAll('.page').forEach(page => page.classList.remove('active'));
    const activePage = document.getElementById(pageId);

    // --- THIS IS THE FIX ---
    // This logic shows or hides the button based on the current page.
    const floatingSaveBtn = document.getElementById('floating-save-container');
    if (pageId === 'picks-page') {
        floatingSaveBtn.classList.remove('hidden');
    } else {
        floatingSaveBtn.classList.add('hidden');
    }
    // --- END OF FIX ---

    if (activePage) {
        activePage.classList.add('active');
        switch (pageId) {
            case 'home-page':
                displayDashboard();
                break;
            case 'picks-page':
                displayPicksPage();
                break;
            case 'scoreboard-page':
                displayScoreboardPage();
                break;
            case 'matches-page':
                displayMatchesPage();
                break;
            case 'rules-page':
                break;
        }
    }
}

// =================================================================
// AUTHENTICATION
// =================================================================
function setupAuthListeners() {
    document.getElementById('sign-up-form').addEventListener('submit', async (e) => {
        e.preventDefault();
        const username = document.getElementById('sign-up-username').value;
        const email = document.getElementById('sign-up-email').value;
        const password = document.getElementById('sign-up-password').value;
        const { data, error } = await supabase.auth.signUp({
            email,
            password,
            options: { data: { username } }
        });
    if (error) {
        return alert('Error signing up: ' + error.message);
    }
    alert('Sign up successful! Please log in.');
    e.target.reset();
});

    document.getElementById('login-form').addEventListener('submit', async (e) => {
        e.preventDefault();
        const email = document.getElementById('login-email').value;
        const password = document.getElementById('login-password').value;
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) {
             alert('Error logging in: ' + error.message);
        }
    });
}

async function logoutUser() {
    await supabase.auth.signOut();
    window.location.hash = '';
}

// =================================================================
// PAGE-SPECIFIC LOGIC
// =================================================================
async function displayPicksPage() {
    const weekSelector = document.getElementById('week-selector');
    const allWeeks = [...new Set(allGames.filter(g => g.Week.startsWith('Week ')).map(g => g.Week))];
    allWeeks.sort((a, b) => parseInt(a.split(' ')[1]) - parseInt(b.split(' ')[1]));
    weekSelector.innerHTML = allWeeks.map(w => `<option value="${w}">${w}</option>`).join('');
    weekSelector.value = defaultWeek;
    const renderPicks = () => {
        if (currentSelectedMatchId) {
            renderGamesForWeek(weekSelector.value, currentSelectedMatchId);
        } else {
            document.getElementById('games-container').innerHTML = `<div class="card"><p>You must join a match on the 'Matches' page before you can make picks!</p></div>`;
            document.getElementById('save-picks-btn').style.display = 'none';
        }
    };
    weekSelector.addEventListener('change', renderPicks);
    renderPicks();
}

async function renderGamesForWeek(week, matchId) {
    const gamesContainer = document.getElementById('games-container');
    const saveButton = document.getElementById('save-picks-btn');
    document.getElementById('picks-page-title').textContent = `${week} Picks`;
    gamesContainer.innerHTML = '<p>Loading games...</p>';
    saveButton.style.display = 'block';
    const now = new Date();
    const weeklyGames = allGames.filter(game => game.Week === week).sort((a, b) => getKickoffTimeAsDate(a) - getKickoffTimeAsDate(b));
    if (weeklyGames.length === 0) {
        gamesContainer.innerHTML = `<p class="card">No games found for ${week}.</p>`;
        saveButton.style.display = 'none';
        return;
    }
    gamesContainer.innerHTML = '';
    weeklyGames.forEach(game => {
        const gameId = game['Game Id'];
        const kickoff = getKickoffTimeAsDate(game);
        const isLocked = kickoff < now;
        const gameCard = document.createElement('div');
        gameCard.className = `game-card ${isLocked ? 'locked' : ''}`;
        gameCard.dataset.gameId = gameId;
        const displayTime = kickoff.toLocaleString('en-US', { timeZone: 'America/New_York', weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
        const oddsText = game.Odds ? ` | <span class="odds-info">${game.Odds}</span>` : '';

        // *** CONDITIONAL LOGIC FOR DOUBLE UP BUTTON ***
        let doubleUpButtonHtml = '';
        if (currentMatchSettings.allow_multiple_double_ups) {
            // New Mode: A button for every game
            doubleUpButtonHtml = `<button class="double-up-btn individual-double-up">2x Double Up</button>`;
        } else {
            // Old Mode: A single, shared button
            doubleUpButtonHtml = `<button class="double-up-btn shared-double-up">2x Double Up</button>`;
        }

        gameCard.innerHTML = `
            <div class="team-container away-team-container">
                 <div class="team" data-team-name="${game['Away Display Name']}"><img src="${game['Away Logo']}" alt="${game['Away Display Name']}"><span class="team-name">${game['Away Display Name']}</span></div>
                 <div class="info-tab" data-team-name="${game['Away Display Name']}">&#9432;</div>
            </div>
            <div class="game-separator">@</div>
            <div class="team-container home-team-container">
                 <div class="team" data-team-name="${game['Home Display Name']}"><img src="${game['Home Logo']}" alt="${game['Home Display Name']}"><span class="team-name">${game['Home Display Name']}</span></div>
                 <div class="info-tab" data-team-name="${game['Home Display Name']}">&#9432;</div>
            </div>
            <div class="game-info">${displayTime}${oddsText}</div>
            <div class="wager-controls">
                <div class="wager-options">
                    <span>Wager:</span>
                    ${[1, 2, 3, 4, 5].map(w => `<button class="wager-btn" data-value="${w}">${w}</button>`).join('')}
                </div>
                ${doubleUpButtonHtml}
            </div>`;
        gamesContainer.appendChild(gameCard);
    });
    addGameCardEventListeners();
    await loadAndApplyUserPicks(week, matchId);
}

function updatePicksCounter() {
    const counterElement = document.getElementById('picks-counter');
    if (!counterElement) return;

    // Count how many picks have a selected team
    const validPicksCount = Object.values(userPicks).filter(pick => pick).length;
    counterElement.textContent = `Picks: ${validPicksCount}`;
}

async function loadAndApplyUserPicks(week, matchId) {
    try {
        const { data: savedPicks, error } = await supabase
            .from('picks')
            .select('*')
            .eq('user_id', currentUser.id)
            .eq('week', week)
            .eq('match_id', matchId);

        if (error) throw error;
        userPicks = {};
        userWagers = {};
        doubleUpPick = null; DraftPicksManager.save();
        userDoubleUps.clear(); // Clear the set for the new week
        initiallySavedPicks.clear();

        savedPicks.forEach(p => {
            const gameIdStr = p.game_id.toString();
            initiallySavedPicks.add(gameIdStr);
            userPicks[p.game_id] = p.picked_team;
            userWagers[p.game_id] = p.wager;

            if (p.is_double_up) {
                if (currentMatchSettings.allow_multiple_double_ups) {
                    userDoubleUps.add(gameIdStr); DraftPicksManager.save();
                } else {
                    doubleUpPick = gameIdStr;
                }
            }

            const card = document.querySelector(`.game-card[data-game-id="${p.game_id}"]`);
            if (card) {
                card.querySelector(`.team[data-team-name="${p.picked_team}"]`)?.classList.add('selected');
                card.querySelector(`.wager-btn[data-value="${p.wager}"]`)?.classList.add('selected');
                if (p.is_double_up) {
                    card.querySelector('.double-up-btn')?.classList.add('selected');
                }
            }
        });
        updatePicksCounter();
        // Overlay any locally drafted (unsaved) picks
        if (DraftPicksManager.applyToState()) { DraftPicksManager.applyToUI(); }
    } catch (err) {
        console.error("Non-critical error fetching user picks:", err.message);
    }
}

async function displayDashboard() {
    if (!currentUser) return;

    // *** MODIFIED: Populate profile form and set up the avatar preview ***
    if (currentUserProfile) {
        document.getElementById('profile-username').value = currentUserProfile.username || '';
        const avatarUrl = currentUserProfile.avatar_url || '';
        document.getElementById('profile-avatar-url').value = avatarUrl;
        // Use the new, robust function to display the avatar.
        updateAvatarPreview(avatarUrl);
    }

    const pendingBody = document.getElementById('pending-picks-body');
    const historyBody = document.getElementById('pick-history-body');
    pendingBody.innerHTML = '<tr><td colspan="3">Loading...</td></tr>';
    historyBody.innerHTML = '<tr><td colspan="4">Loading...</td></tr>';
    document.getElementById('pending-picks-week').textContent = defaultWeek;

    try {
        if (!currentSelectedMatchId) {
            pendingBody.innerHTML = `<tr><td colspan="3">Please join or select a match to see your picks.</td></tr>`;
            historyBody.innerHTML = `<tr><td colspan="4">No pick history to show.</td></tr>`;
            return;
        }

        const [pendingPicksRes, pastPicksRes] = await Promise.all([
            supabase.from('picks').select('*').eq('user_id', currentUser.id).eq('match_id', currentSelectedMatchId).is('is_correct', null),
            supabase.from('picks').select('*').eq('user_id', currentUser.id).eq('match_id', currentSelectedMatchId).not('is_correct', 'is', null).order('created_at', { ascending: false })
        ]);

        if (pendingPicksRes.error) throw pendingPicksRes.error;
        if (pastPicksRes.error) throw pastPicksRes.error;
        
        pendingBody.innerHTML = '';
        const pendingPicksForWeek = pendingPicksRes.data?.filter(p => p.week === defaultWeek) || [];
        if (pendingPicksForWeek.length > 0) {
            pendingPicksForWeek.forEach(pick => {
                const game = allGames.find(g => g['Game Id'] == pick.game_id);
                const doubleUp = pick.is_double_up ? ' 🔥' : '';
                
                if (game) {
                    const gameNameText = `${game['Away Display Name']} @ ${game['Home Display Name']}`;
                    const pickedTeamLogoUrl = teamData[pick.picked_team] || '';
                    pendingBody.innerHTML += `
                        <tr>
                            <td>
                                <span class="team-name-text">${gameNameText}</span>
                                <div class="team-logo-display">
                                    <img src="${game['Away Logo']}" alt="${game['Away Display Name']}" class="table-logo">
                                    <span>@</span>
                                    <img src="${game['Home Logo']}" alt="${game['Home Display Name']}" class="table-logo">
                                </div>
                            </td>
                            <td>
                                <span class="team-name-text">${pick.picked_team}</span>
                                <div class="team-logo-display">
                                    <img src="${pickedTeamLogoUrl}" alt="${pick.picked_team}" class="table-logo">
                                </div>
                            </td>
                            <td>${pick.wager}${doubleUp}</td>
                        </tr>`;
                }
            });
        } else {
            pendingBody.innerHTML = `<tr><td colspan="3">No pending picks for ${defaultWeek}.</td></tr>`;
        }

        historyBody.innerHTML = '';
        if (pastPicksRes.data?.length > 0) {
            pastPicksRes.data.forEach(pick => {
                const game = allGames.find(g => g['Game Id'] == pick.game_id);

                // --- THIS IS THE FIX ---
                let resultClass, resultText, points;
                if (game && game['Game Winner'] && game['Game Winner'].toUpperCase() === 'TIE') {
                    resultClass = 'tie';
                    resultText = 'Tie';
                    points = 0;
                } else {
                    resultClass = pick.is_correct ? 'correct' : 'incorrect';
                    resultText = pick.is_correct ? 'Correct' : 'Incorrect';
                    points = pick.is_correct ? pick.wager : (pick.wager * -2);
                }
                // --- END OF FIX ---

                if (pick.is_double_up) points *= 2;
                const pointsText = points > 0 ? `+${points}` : points;
                if (game) {
                    const gameNameText = `${game['Away Display Name']} @ ${game['Home Display Name']} (${pick.week})`;
                    const pickedTeamLogoUrl = teamData[pick.picked_team] || '';
                    historyBody.innerHTML += `
                        <tr>
                            <td>
                                <span class="team-name-text">${gameNameText}</span>
                                <div class="team-logo-display">
                                    <img src="${game['Away Logo']}" alt="${game['Away Display Name']}" class="table-logo">
                                    <span>@</span>
                                    <img src="${game['Home Logo']}" alt="${game['Home Display Name']}" class="table-logo">
                                </div>
                            </td>
                            <td>
                                <span class="team-name-text">${pick.picked_team}</span>
                                <div class="team-logo-display">
                                    <img src="${pickedTeamLogoUrl}" alt="${pick.picked_team}" class="table-logo">
                                </div>
                            </td>
                            <td class="${resultClass}">${resultText}</td>
                            <td>${pointsText}</td>
                        </tr>`;
                }
            });
        } else {
            historyBody.innerHTML = '<tr><td colspan="4">No pick history yet.</td></tr>';
        }

    } catch (error) {
        console.error("Error displaying dashboard:", error.message);
        pendingBody.innerHTML = '<tr><td colspan="3">Could not load picks due to an error.</td></tr>';
        historyBody.innerHTML = '<tr><td colspan="4">Could not load pick history due to an error.</td></tr>';
    }
}

async function checkAndDisplayPicksReminder() {
    const banner = document.getElementById('picks-reminder-banner');
    if (!currentUser) {
        banner.classList.add('hidden');
        return;
    }
    const now = new Date();
    const gamesForDefaultWeek = allGames.filter(g => g.Week === defaultWeek);
    if (gamesForDefaultWeek.length === 0) {
        banner.classList.add('hidden');
        return;
    }
    const firstKickoff = gamesForDefaultWeek
        .map(getKickoffTimeAsDate)
        .sort((a, b) => a - b)[0];
    const tuesdayOfThatWeek = new Date(firstKickoff);
    const dayOfWeek = tuesdayOfThatWeek.getUTCDay();
    const daysToSubtract = dayOfWeek >= 2 ? (dayOfWeek - 2) : (dayOfWeek + 5);
    tuesdayOfThatWeek.setUTCDate(tuesdayOfThatWeek.getUTCDate() - daysToSubtract);
    tuesdayOfThatWeek.setUTCHours(10, 0, 0, 0);
    if (now < tuesdayOfThatWeek || now > firstKickoff) {
        banner.classList.add('hidden');
        return;
    }
    try {
        const { data: memberships, error: membershipError } = await supabase
            .from('match_members')
            .select('match_id')
            .eq('user_id', currentUser.id);
        if (membershipError || !memberships || memberships.length === 0) {
            banner.classList.add('hidden');
            return;
        }
        const joinedMatchIds = new Set(memberships.map(m => m.match_id));
        const { data: picks, error: picksError } = await supabase
            .from('picks')
            .select('match_id')
            .eq('user_id', currentUser.id)
            .eq('week', defaultWeek);
        if (picksError) {
            console.error("Error fetching picks for banner check:", picksError);
            banner.classList.add('hidden');
            return;
        }
        const matchesWithPicks = new Set(picks.map(p => p.match_id));
        let needsToMakePicks = false;
        for (const matchId of joinedMatchIds) {
            if (!matchesWithPicks.has(matchId)) {
                needsToMakePicks = true;
                break;
            }
        }
        if (needsToMakePicks) {
            banner.classList.remove('hidden');
        } else {
            banner.classList.add('hidden');
        }
    } catch (err) {
        console.error("Failed to check for picks reminder:", err);
        banner.classList.add('hidden');
    }
}

async function displayScoreboardPage() {
    const runSheetContainer = document.getElementById('run-sheet-container');
    const chartView = document.getElementById('chart-view');
    const tableView = document.getElementById('table-view');
    const payoutView = document.getElementById('payout-view'); // New payout view
    const showChartBtn = document.getElementById('show-chart-btn');
    const showTableBtn = document.getElementById('show-table-btn');
    const showPayoutBtn = document.getElementById('show-payout-btn'); // New payout button

    if (!runSheetContainer || !chartView || !tableView || !payoutView || !showChartBtn || !showTableBtn || !showPayoutBtn) {
        console.error("Scoreboard HTML elements not found! Please ensure your index.html file has been updated with the new chart/table/payout toggle structure.");
        return;
    }

    if (scoreChartInstance) {
        scoreChartInstance.destroy();
        scoreChartInstance = null;
    }
    runSheetContainer.innerHTML = '';
    payoutView.innerHTML = ''; // Clear the payout view

    // Set initial view to the table
    chartView.classList.add('hidden');
    tableView.classList.remove('hidden');
    payoutView.classList.add('hidden');
    showChartBtn.classList.remove('active');
    showTableBtn.classList.add('active');
    showPayoutBtn.classList.remove('active');

    showChartBtn.onclick = () => {
        chartView.classList.remove('hidden');
        tableView.classList.add('hidden');
        payoutView.classList.add('hidden');
        showChartBtn.classList.add('active');
        showTableBtn.classList.remove('active');
        showPayoutBtn.classList.remove('active');
    };

    showTableBtn.onclick = () => {
        tableView.classList.remove('hidden');
        chartView.classList.add('hidden');
        payoutView.classList.add('hidden');
        showTableBtn.classList.add('active');
        showChartBtn.classList.remove('active');
        showPayoutBtn.classList.remove('active');
    };

    showPayoutBtn.onclick = () => {
        payoutView.classList.remove('hidden');
        chartView.classList.add('hidden');
        tableView.classList.add('hidden');
        showPayoutBtn.classList.add('active');
        showChartBtn.classList.remove('active');
        showTableBtn.classList.remove('active');
    };

    if (currentSelectedMatchId) {
        loadScoreboardForMatch(currentSelectedMatchId);
    } else {
        runSheetContainer.innerHTML = '<p>Please join a match to see the scoreboard.</p>';
        chartView.innerHTML = '<p>Please join a match to see standings.</p>';
        payoutView.innerHTML = '<p>Please join a match to see payouts.</p>';
    }
}

function renderPayouts(tableData, playerCount) {
    const payoutContainer = document.getElementById('payout-view');
    const { playerData } = tableData;
    const { buy_in, value_per_point } = currentMatchSettings;

    if (!buy_in || !value_per_point) {
        payoutContainer.innerHTML = '<div class="card"><p>This match does not have payout information configured.</p></div>';
        return;
    }

    if (!playerData || playerData.length < 2) {
        payoutContainer.innerHTML = '<div class="card"><p>Not enough player data to calculate payouts.</p></div>';
        return;
    }

    const firstPlaceWinnings = playerCount * buy_in;
    let payoutHtml = `
        <div class="payout-container">
            <div class="payout-summary">
                <h3>1st Place Prize</h3>
                <div class="prize-amount">$${firstPlaceWinnings.toFixed(2)}</div>
            </div>

            <table class="payout-table">
                <tbody> 
    `;

    const firstPlaceScore = playerData[0].runningTotal;

    for (let i = 1; i < playerData.length; i++) {
        const payingPlayer = playerData[i];
        const owedPlayer = playerData[i - 1];
        
        const pointsFromFirst = firstPlaceScore - payingPlayer.runningTotal;
        const amountOwed = pointsFromFirst * value_per_point;
        
        const payingPlayerDisplay = `
            <div class="player-cell" title="${payingPlayer.username}">
                <img src="${payingPlayer.avatar_url || DEFAULT_AVATAR_URL}" class="table-avatar" onerror="this.src='${DEFAULT_AVATAR_URL}'">
                <span>${payingPlayer.username}</span>
            </div>`;
            
        const owedPlayerDisplay = `
            <div class="player-cell" title="${owedPlayer.username}">
                <img src="${owedPlayer.avatar_url || DEFAULT_AVATAR_URL}" class="table-avatar" onerror="this.src='${DEFAULT_AVATAR_URL}'">
                <span>${owedPlayer.username}</span>
            </div>`;

        // The new table row structure
        payoutHtml += `
            <tr>
                <td>${payingPlayerDisplay}</td>
                <!-- THIS IS THE FIX: Using a clean arrow symbol -->
                <td class="owes-cell">&rarr;</td>
                <td>${owedPlayerDisplay}</td>
                <td>$${amountOwed.toFixed(2)}</td>
            </tr>
        `;
    }

    payoutHtml += `
                </tbody>
            </table>
        </div> 
    `;
    
    payoutContainer.innerHTML = payoutHtml;
}


async function loadScoreboardForMatch(matchId) {
    try {
        const { data: members, error: membersError } = await supabase
            .from('match_members')
            .select('profiles (id, username, avatar_url)')
            .eq('match_id', matchId);

        if (membersError) throw membersError;
        if (!members || members.length === 0) return;

        // --- THIS IS THE FIX ---
        // Added 'game_id' to the select statement so we can check for ties later.
        const { data: allScoredPicks, error: picksError } = await supabase
            .from('picks')
            .select('user_id, week, wager, is_double_up, is_correct, game_id')
            .eq('match_id', matchId)
            .not('is_correct', 'is', null);
        // --- END OF FIX ---

        if (picksError) throw picksError;

        const { chartData, tableData } = processWeeklyScores(members, allScoredPicks || []);
        renderScoreChart(chartData);
        renderPlayerScoresTable(tableData, defaultWeek); 
        renderPayouts(tableData, members.length); // New function call

        let weekSelector = document.getElementById('run-sheet-week-selector');
        const allWeeks = [...new Set(allGames.filter(g => g.Week.startsWith('Week ')).map(g => g.Week))];
        allWeeks.sort((a, b) => parseInt(a.split(' ')[1]) - parseInt(b.split(' ')[1]));
        
        const newSelector = weekSelector.cloneNode(true);
        weekSelector.parentNode.replaceChild(newSelector, weekSelector);
        
        newSelector.innerHTML = allWeeks.map(w => `<option value="${w}">${w}</option>`).join('');
        newSelector.value = defaultWeek;

        newSelector.addEventListener('change', () => {
            renderRunSheetForWeek(newSelector.value, matchId, members);
        });

        const refreshBtn = document.getElementById('refresh-run-sheet-btn');
        const handleRefresh = async () => {
            const originalIcon = refreshBtn.innerHTML;
            refreshBtn.innerHTML = '...';
            refreshBtn.disabled = true;

            try {
                await fetchGameData();
                const selectedWeek = newSelector.value;
                await renderRunSheetForWeek(selectedWeek, matchId, members);
            } catch (err) {
                console.error("Failed to refresh run sheet:", err);
            } finally {
                refreshBtn.innerHTML = originalIcon;
                refreshBtn.disabled = false;
            }
        };

        const newRefreshBtn = refreshBtn.cloneNode(true);
        refreshBtn.parentNode.replaceChild(newRefreshBtn, refreshBtn);
        newRefreshBtn.addEventListener('click', handleRefresh);

        renderRunSheetForWeek(newSelector.value, matchId, members);

    } catch (error) {
        console.error("Error loading scoreboard data:", error.message);
        document.getElementById('run-sheet-container').innerHTML = `<p class="card">Could not load scoreboard due to an error.</p>`;
    }
}
function processWeeklyScores(members, allPicks) {
    const labels = ['Start'];
    const maxWeek = 18;
    for (let i = 1; i <= maxWeek; i++) {
        labels.push(`Week ${i}`);
    }

    const weeklyScoresMap = new Map();
    const cumulativeScoresMap = new Map();
    let latestCompletedWeek = 0;

    members.forEach(member => {
        const userId = member.profiles.id;
        weeklyScoresMap.set(userId, Array(maxWeek + 1).fill(0));
        cumulativeScoresMap.set(userId, Array(maxWeek + 1).fill(0));
    });

    allPicks.forEach(pick => {
        const weekNum = parseInt(pick.week.split(' ')[1]);
        if (weekNum > 0 && weekNum <= maxWeek) {
            if (weekNum > latestCompletedWeek) {
                latestCompletedWeek = weekNum;
            }
            
            // --- THIS IS THE FIX ---
            // Find the game and check if the 'Game Winner' is 'TIE' before assigning points.
            const game = allGames.find(g => g['Game Id'] == pick.game_id);
            let points = 0;
            if (game && game['Game Winner'] && game['Game Winner'].toUpperCase() === 'TIE') {
                points = 0;
            } else {
                points = pick.is_correct ? pick.wager : (pick.wager * -2);
            }
            // --- END OF FIX ---

            if (pick.is_double_up) points *= 2;
            
            const userScores = weeklyScoresMap.get(pick.user_id);
            if (userScores) {
                userScores[weekNum] += points;
            }
        }
    });

    const playerData = members.map(member => {
        const userId = member.profiles.id;
        const weeklyScores = weeklyScoresMap.get(userId);
        const cumulativeScores = cumulativeScoresMap.get(userId);

        for (let i = 1; i <= maxWeek; i++) {
            cumulativeScores[i] = cumulativeScores[i - 1] + weeklyScores[i];
        }

        for (let i = latestCompletedWeek + 1; i <= maxWeek; i++) {
            cumulativeScores[i] = null;
        }

        return {
            id: userId,
            username: member.profiles.username,
            avatar_url: member.profiles.avatar_url, // *** ADDED: Pass avatar URL through
            weeklyScores: weeklyScores.slice(1),
            runningTotal: cumulativeScores[latestCompletedWeek] || 0,
            chartScores: cumulativeScores
        };
    });
    
    playerData.sort((a, b) => b.runningTotal - a.runningTotal);
    
    const playerColors = [
        'rgba(196, 30, 58, 1)',  // Warrior Red
        'rgba(0, 112, 221, 1)',  // Mage Blue
        'rgba(255, 124, 10, 1)', // Druid Orange
        'rgba(163, 221, 105, 1)',// Rogue Green
        'rgba(244, 140, 186, 1)',// Paladin Pink
        'rgba(105, 204, 240, 1)',// Shaman Light Blue
        'rgba(148, 130, 201, 1)',// Warlock Purple
        'rgba(255, 155, 0, 1)'  // Monk Gold
    ];

    const datasets = [];
    playerData.forEach((player, index) => {
        const color = playerColors[index % playerColors.length];
        datasets.push({
            label: player.username, 
            avatarUrl: player.avatar_url, // *** ADDED: Pass URL for the renderer
            data: player.chartScores,
            borderColor: color,
            backgroundColor: color.replace('1)', '0.1)'),
            pointStyle: 'rect', // Default point style
            fill: false,
            tension: 0.1,
            pointRadius: 3,
            spanGaps: false
        });
    });

    return {
        chartData: { labels, datasets },
        tableData: { playerData, latestCompletedWeek }
    };
}
function renderPlayerScoresTable(tableData, currentWeek) {
    const { playerData, latestCompletedWeek } = tableData;
    const table = document.getElementById('player-scores-table');

    if (!playerData || playerData.length === 0) {
        table.innerHTML = '<thead><tr><th>Player</th><th>Total</th></tr></thead><tbody><tr><td colspan="2">No scores to display yet.</td></tr></tbody>';
        return;
    }

    // "This Week" is the current week for making picks.
    // "Last Week" is the last week that was actually scored.
    const thisWeekHeader = `This Week`;
    const lastWeekHeader = latestCompletedWeek > 0 ? `Last Week` : `Last Week`;

    let headerHtml = `
        <thead>
            <tr>
                <th>Player</th>
                <th class="total-score-col total-score-col-header">Total</th>
                <th>${thisWeekHeader}</th>
                <th>${lastWeekHeader}</th>
            </tr>
        </thead>
    `;

    let bodyHtml = '<tbody>';
    playerData.forEach(player => {
        const playerDisplay = player.avatar_url
            ? `<div class="player-cell" title="${player.username}">
                 <img src="${player.avatar_url}" class="table-avatar" onerror="this.src='${DEFAULT_AVATAR_URL}'">
                 <span>${player.username}</span>
               </div>`
            : `<div class="player-cell">${player.username}</div>`;
            
        // Get the score for the "This Week" column, which corresponds to the current default week.
        const currentWeekNum = parseInt(currentWeek.split(' ')[1]);
        const thisWeekScore = player.weeklyScores[currentWeekNum - 1] || 0;

        // Get the score for the "Last Week" column, which is the week numerically before the current week.
        const lastWeekNum = currentWeekNum - 1;
        let lastWeekScore = ''; // Default to blank (e.g., for Week 1).
        if (lastWeekNum > 0) {
            lastWeekScore = player.weeklyScores[lastWeekNum - 1] || 0;
        }

        bodyHtml += `
            <tr>
                <td>${playerDisplay}</td>
                <td class="total-score-col">${player.runningTotal}</td>
                <td>${thisWeekScore}</td>
                <td>${lastWeekScore}</td>
            </tr>
        `;
    });
    bodyHtml += '</tbody>';

    table.innerHTML = headerHtml + bodyHtml;
}


async function renderScoreChart(chartData) {
    const ctx = document.getElementById('score-chart').getContext('2d');

    // This section prepares the 4-week viewing window and remains the same.
    const originalLabels = [...chartData.labels];
    const originalDatasets = JSON.parse(JSON.stringify(chartData.datasets));
    const lastDataPointIndex = originalDatasets[0]?.data.findLastIndex(d => d !== null) || 0;
    const windowSize = 4;
    const maxWeek = 18;
    let startWeek, endWeek;
    if (lastDataPointIndex < 3) {
        startWeek = 1;
        endWeek = 4;
    } else {
        startWeek = lastDataPointIndex - 2;
        endWeek = lastDataPointIndex + 1;
    }
    if (endWeek > maxWeek) {
        endWeek = maxWeek;
        startWeek = maxWeek - (windowSize - 1);
    }
    const newLabels = [originalLabels[0]]; 
    for (let i = startWeek; i <= endWeek; i++) {
        newLabels.push(originalLabels[i]);
    }
    originalDatasets.forEach(dataset => {
        const newData = [dataset.data[0]];
        for (let i = startWeek; i <= endWeek; i++) {
            newData.push(dataset.data[i]);
        }
        dataset.data = newData;
    });
    chartData.labels = newLabels;
    chartData.datasets = originalDatasets;
    
    // --- THIS IS THE FINAL, CORRECTED LOGIC USING THE STACK OVERFLOW METHOD ---
    const imagePromises = chartData.datasets.map(dataset => {
        return new Promise((resolve) => {
            // Store the loaded image in a custom property.
            dataset.avatarImage = new Image();
            dataset.avatarImage.width = 20;
            dataset.avatarImage.height = 20;

            // Set a default style for the legend in case the image fails to load.
            dataset.pointStyle = 'rect';

            if (!dataset.avatarUrl) {
                return resolve();
            }
            
            dataset.avatarImage.src = dataset.avatarUrl;
            dataset.avatarImage.onload = () => {
                // *** CRUCIAL FOR LEGEND ***
                // Set the dataset's main pointStyle to the loaded image.
                // The legend will use this single value.
                dataset.pointStyle = dataset.avatarImage;
                resolve();
            };
            dataset.avatarImage.onerror = () => resolve();
        });
    });
    await Promise.all(imagePromises);

    // Now, create the style arrays to override the point styles ON THE CHART.
    chartData.datasets.forEach(dataset => {
        const lastPointIndex = dataset.data.findLastIndex(d => d !== null);
        const radii = [];
        const styles = [];
        
        dataset.data.forEach((_, index) => {
            if (index === lastPointIndex && lastPointIndex > 0) {
                radii.push(6); // Make the last point visible.
                styles.push(dataset.avatarImage); // Use the avatar image for the point.
            } else {
                radii.push(0); // Make all other points invisible.
                styles.push('rect'); // Use a basic shape for hidden points.
            }
        });

        // Assign the arrays to the dataset. This overrides the single 'pointStyle' for the chart line.
        dataset.radius = radii;
        dataset.pointStyle = styles;
    });

    // Scale calculation remains the same.
    let minScore = 0;
    let maxScore = 0;
    chartData.datasets.forEach(dataset => {
        dataset.data.forEach(point => {
            if (point === null) return;
            if (point < minScore) minScore = point;
            if (point > maxScore) maxScore = point;
        });
    });
    const suggestedMin = Math.min(-10, minScore - 5);
    const suggestedMax = Math.max(10, maxScore + 5);

    if (scoreChartInstance) {
        scoreChartInstance.destroy();
    }

    scoreChartInstance = new Chart(ctx, {
        type: 'line',
        data: chartData,
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: {
                    position: 'top',
                    labels: { 
                        usePointStyle: true,
                        boxWidth: 20,
                        padding: 20
                     }
                },
                tooltip: { /* Tooltip options are unchanged */ }
            },
            // The 'elements' section is no longer needed as styles are now defined in the dataset.
            scales: { /* Scales are unchanged */ },
            interaction: { /* Interaction options are unchanged */ }
        }
    });
}


function getDynamicStyles(points) {
    // Clamp the points to our defined min/max range for calculation
    const clampedPoints = Math.max(-20, Math.min(10, points));
    const absPoints = Math.abs(clampedPoints);

    // 1. Default to a neutral state
    let backgroundColor = '#f9f9f9'; // A very light, neutral gray
    let color = '#333';             // Standard dark text
    let fontWeight = '500';          // A slightly bolder normal weight

    // 2. Use color for status (positive/negative)
    if (clampedPoints > 0) {
        color = '#2e7d32'; // Dark green text
    } else if (clampedPoints < 0) {
        color = '#c62828'; // Dark red text
    }

    // 3. Use font weight for magnitude
    if (absPoints >= 5) {
        fontWeight = 'bold';
    }
    // Make the font weight extra bold for the highlighted scores
    if (clampedPoints > 5 || clampedPoints < -10) {
        fontWeight = '800';
    }

    // --- THIS IS THE FIX ---
    // 4. Add background highlight based on the new, separate thresholds
    if (clampedPoints > 5) {
        backgroundColor = 'hsl(120, 75%, 35%)'; // Deep green
        color = 'white'; // Use white text on the dark background
    } else if (clampedPoints < -10) {
        backgroundColor = 'hsl(0, 75%, 35%)'; // Deep red
        color = 'white'; // Use white text on the dark background
    }
    // --- END OF FIX ---

    return { backgroundColor, color, fontWeight };
}

function renderRunSheet(members, allPicks, week) {
    const container = document.getElementById('run-sheet-container');
    const weeklyGames = allGames.filter(g => g.Week === week).sort((a, b) => getKickoffTimeAsDate(a) - getKickoffTimeAsDate(b));
    const now = new Date();

    const sortedMembers = [...members].sort((a, b) => a.profiles.username.localeCompare(b.profiles.username));

    // --- PRE-CALCULATE TOTALS (This part was already correct) ---
    const weeklyTotals = new Map();
    sortedMembers.forEach(member => weeklyTotals.set(member.profiles.id, 0));

    weeklyGames.forEach(game => {
        const kickoff = getKickoffTimeAsDate(game);
        if (kickoff >= now) return; 

        const isGameFinal = game.Status === 'post';
        const showScore = game.Status !== 'pre';
        const homeScoreNum = parseInt(game['Home Score'], 10);
        const awayScoreNum = parseInt(game['Away Score'], 10);

        sortedMembers.forEach(member => {
            const pick = allPicks.find(p => p.game_id == game['Game Id'] && p.user_id === member.profiles.id);
            if (pick) {
                let points;
                if (isGameFinal) {
                    if (game['Game Winner'] && game['Game Winner'].toUpperCase() === 'TIE') {
                        points = 0;
                    } else {
                        points = pick.is_correct ? pick.wager : (pick.wager * -2);
                    }
                } 
                else if (showScore && !isNaN(homeScoreNum) && !isNaN(awayScoreNum) && (homeScoreNum > 0 || awayScoreNum > 0)) {
                    let winningTeam = 'TIE';
                    if (homeScoreNum > awayScoreNum) winningTeam = game['Home Display Name'];
                    if (awayScoreNum > homeScoreNum) winningTeam = game['Away Display Name'];
                    
                    points = 0;
                    if (pick.picked_team === winningTeam) points = pick.wager;
                    else if (winningTeam !== 'TIE') points = pick.wager * -2;
                }
                
                if (typeof points !== 'undefined') {
                    if (pick.is_double_up) points *= 2;
                    const currentTotal = weeklyTotals.get(member.profiles.id) || 0;
                    weeklyTotals.set(member.profiles.id, currentTotal + points);
                }
            }
        });
    });
    // --- END PRE-CALCULATION ---

    let tableHtml = '<table class="run-sheet-table">';

    tableHtml += '<thead><tr><th>Game</th>';
    sortedMembers.forEach(member => {
        const memberDisplay = member.profiles.avatar_url
            ? `<div class="player-header" title="${member.profiles.username}"><img src="${member.profiles.avatar_url}" class="run-sheet-avatar" onerror="this.src='${DEFAULT_AVATAR_URL}'"></div>`
            : `<div class="player-header">${member.profiles.username}</div>`;
        tableHtml += `<th>${memberDisplay}</th>`;
    });
    tableHtml += '</tr></thead>';

    tableHtml += '<tbody>';

    tableHtml += '<tr class="weekly-total-row"><td class="game-matchup-cell">Total</td>';
    sortedMembers.forEach(member => {
        const total = weeklyTotals.get(member.profiles.id);
        const totalDisplay = total > 0 ? `+${total}` : total;
        tableHtml += `<td>${totalDisplay}</td>`;
    });
    tableHtml += '</tr>';

    weeklyGames.forEach(game => {
        const kickoff = getKickoffTimeAsDate(game);
        const hasKickedOff = kickoff < now;
        const isGameFinal = game.Status === 'post';
        const isInProgress = hasKickedOff && !isGameFinal;

        const showScore = game.Status !== 'pre';
        const awayScore = showScore ? game['Away Score'] : '-';
        const homeScore = showScore ? game['Home Score'] : '-';
        const favoredTeam = game['Favored Team'];
        const isAwayFavored = favoredTeam === game['Away'];
        const isHomeFavored = favoredTeam === game['Home'];
        
        const rowClass = isInProgress ? 'game-row in-progress' : 'game-row';

        let situationTooltipHtml = '';
        if (isInProgress) {
            let situationString = '';
            
            if (game.Situation && game.Situation.toLowerCase().includes('half')) {
                situationString = 'Halftime';
            } 
            else if (game.Qtr && game.Qtr !== '0') {
                let parts = [`Q${game.Qtr} - ${game.Clock}`];
                
                if (game.Pos && game.Pos.trim()) {
                    parts.push(game.Pos);
                }
                if (game.Situation && game.Situation.trim() && game.Situation !== 'waiting...') {
                    parts.push(game.Situation);
                }
                situationString = parts.slice(0, 2).join(' - ');
                if (parts.length > 2) {
                    situationString += ` - ${parts.slice(2).join(' ')}`;
                }
            }
            
            const tooltipText = situationString.trim() || 'Game is Live';
            situationTooltipHtml = `<span class="game-situation-tooltip">${tooltipText}</span>`;
        }

        tableHtml += `<tr class="${rowClass}">
            <td class="game-matchup-cell">
                ${situationTooltipHtml}
                <div class="matchup-team-container ${isAwayFavored ? 'favored-team' : ''}">
                    <img src="${game['Away Logo']}" alt="${game['Away']}" class="team-logo">
                    <div class="team-info-wrapper"><span class="team-score">${awayScore}</span></div>
                </div>
                <div class="matchup-team-container ${isHomeFavored ? 'favored-team' : ''}">
                    <img src="${game['Home Logo']}" alt="${game['Home']}" class="team-logo">
                     <div class="team-info-wrapper"><span class="team-score">${homeScore}</span></div>
                </div>
            </td>`;
        
        sortedMembers.forEach(member => {
            const pick = allPicks.find(p => p.game_id == game['Game Id'] && p.user_id === member.profiles.id);

            if (hasKickedOff) {
                if (pick) {
                    const pickedTeamLogoUrl = teamData[pick.picked_team] || '';
                    const doubleUpEmoji = pick.is_double_up ? ' 🔥' : '';
                    let cellContent;
                    let cellStyle = '';
                    let points;

                    // --- THIS IS THE FIX ---
                    // The same tie-handling logic from the "Totals" calculation
                    // is now correctly placed here for rendering the individual cells.
                    if (isGameFinal) {
                        if (game['Game Winner'] && game['Game Winner'].toUpperCase() === 'TIE') {
                            points = 0;
                        } else {
                            points = pick.is_correct ? pick.wager : (pick.wager * -2);
                        }
                    // --- END OF FIX ---
                    } else {
                        const homeScoreNum = parseInt(homeScore, 10);
                        const awayScoreNum = parseInt(awayScore, 10);

                        if (!isNaN(homeScoreNum) && !isNaN(awayScoreNum) && (homeScoreNum > 0 || awayScoreNum > 0)) {
                            let winningTeam = 'TIE';
                            if (homeScoreNum > awayScoreNum) winningTeam = game['Home Display Name'];
                            if (awayScoreNum > homeScoreNum) winningTeam = game['Away Display Name'];
                            
                            points = 0;
                            if (pick.picked_team === winningTeam) points = pick.wager;
                            else if (winningTeam !== 'TIE') points = pick.wager * -2;
                        } else {
                            points = undefined;
                        }
                    }

                    if (typeof points !== 'undefined' && pick.is_double_up) {
                        points *= 2;
                    }

                    if (typeof points !== 'undefined') {
                        const styles = getDynamicStyles(points);
                        cellStyle = `style="background-color: ${styles.backgroundColor}; color: ${styles.color}; font-weight: ${styles.fontWeight};"`;
                        const pointsText = points > 0 ? `+${points}` : points;
                        cellContent = `
                            <div class="pick-content-wrapper">
                                <img src="${pickedTeamLogoUrl}" alt="${pick.picked_team}" class="pick-logo" title="${pick.picked_team}">
                                <span>${pointsText}${doubleUpEmoji}</span>
                            </div>`;
                    } else {
                        cellStyle = `class="wager-${pick.wager}"`;
                        cellContent = `
                            <div class="pick-content-wrapper">
                                <img src="${pickedTeamLogoUrl}" alt="${pick.picked_team}" class="pick-logo" title="${pick.picked_team}">
                                <span>${pick.wager}${doubleUpEmoji}</span>
                            </div>`;
                    }
                    tableHtml += `<td ${cellStyle}>${cellContent}</td>`;
                } else {
                    tableHtml += `<td></td>`;
                }
            } else {
                tableHtml += `<td class="locked-pick"><i>🔒</i></td>`;
            }
        });

        tableHtml += '</tr>';
    });
    tableHtml += '</tbody></table>';

    container.innerHTML = tableHtml;
}


async function renderRunSheetForWeek(week, matchId, members) {
    const runSheetContainer = document.getElementById('run-sheet-container');
    const weekTitle = document.getElementById('scoreboard-week-title');
    weekTitle.textContent = week;
    runSheetContainer.innerHTML = '<p>Loading scores...</p>';
    try {
        const { data: picks, error } = await supabase
            .from('picks')
            .select('picked_team, wager, is_double_up, game_id, user_id, is_correct')
            .eq('match_id', matchId)
            .eq('week', week);
        if (error) throw error;
        renderRunSheet(members, picks || [], week);
    } catch (err) {
        console.error(`Error loading run sheet for ${week}:`, err);
        runSheetContainer.innerHTML = `<p class="card">Could not load scores for ${week}.</p>`;
    }
}

async function displayMatchesPage() {
    const container = document.getElementById('matches-list-container');
    container.innerHTML = '<p>Loading public matches...</p>';
    try {
        const [publicMatchesRes, userMembershipsRes] = await Promise.all([
            supabase.from('matches').select('id, name').eq('is_public', true),
            supabase.from('match_members').select('match_id').eq('user_id', currentUser.id)
        ]);
        if (publicMatchesRes.error) throw publicMatchesRes.error;
        if (userMembershipsRes.error) throw userMembershipsRes.error;
        const publicMatches = publicMatchesRes.data;
        const userMemberships = userMembershipsRes.data;
        if (!publicMatches || publicMatches.length === 0) {
            return container.innerHTML = '<p>No public matches found. Why not create one?</p>';
        }
        const joinedMatchIds = new Set(userMemberships.map(m => m.match_id));
        container.innerHTML = publicMatches.map(match => {
            const isJoined = joinedMatchIds.has(match.id);
            const buttonHtml = isJoined
                ? `<button class="button-secondary" disabled>Currently Joined</button>`
                : `<button class="button-primary join-match-btn" data-match-id="${match.id}">Join</button>`;
            return `<div class="match-item"><span>${match.name}</span>${buttonHtml}</div>`;
        }).join('');
    } catch (error) {
        console.error("Error displaying matches page:", error.message);
        container.innerHTML = '<p>Could not load matches due to an error. Please try again.</p>';
    }
}

// =================================================================
// EVENT HANDLERS & DATA SAVING
// =================================================================
async function handleProfileUpdate(e) {
  try { await requireSession(); } catch (e) { /* surface login UI */ }

    e.preventDefault();
    const saveButton = document.getElementById('save-profile-btn');
    const newUsername = document.getElementById('profile-username').value;
    const newAvatarUrl = document.getElementById('profile-avatar-url').value;
    if (!newUsername || newUsername.trim().length < 3) {
        return alert("Username must be at least 3 characters long.");
    }
    saveButton.textContent = 'Saving...';
    saveButton.disabled = true;
    try {
        const { error } = await supabase
            .from('profiles')
            .update({ 
                username: newUsername.trim(),
                avatar_url: newAvatarUrl.trim() 
            })
            .eq('id', currentUser.id);
        if (error) throw error;
        currentUserProfile.username = newUsername.trim();
        currentUserProfile.avatar_url = newAvatarUrl.trim();
        updateUserStatusUI(currentUserProfile);
        alert("Profile updated successfully!");
    } catch (error) {
        console.error("Error updating profile:", error);
        alert("Error updating profile: " + error.message);
    } finally {
        saveButton.textContent = 'Save Profile';
        saveButton.disabled = false;
    }
}

function addGameCardEventListeners() {
    const allSharedDoubleUpBtns = document.querySelectorAll('.shared-double-up');

    document.querySelectorAll('.game-card').forEach(card => {
        if (card.classList.contains('locked')) return;
        const gameId = card.dataset.gameId;

        card.querySelectorAll('.team').forEach(team => {
            team.addEventListener('click', () => {
                const teamName = team.dataset.teamName;
                if (userPicks[gameId] === teamName) {
                    userPicks[gameId] = undefined;
                    userWagers[gameId] = undefined;
                    // Also remove double up if team is deselected
                    if (doubleUpPick === gameId) doubleUpPick = null; DraftPicksManager.save();
                    userDoubleUps.delete(gameId); DraftPicksManager.save();
                    card.querySelectorAll('.selected').forEach(el => el.classList.remove('selected'));
                } else {
                    userPicks[gameId] = teamName;
                    card.querySelectorAll('.team').forEach(t => t.classList.remove('selected'));
                    team.classList.add('selected');
                }
                updatePicksCounter();
            });
        });

        card.querySelectorAll('.wager-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                if (!userPicks[gameId]) return alert("Please select a team before placing a wager.");
                userWagers[gameId] = parseInt(btn.dataset.value, 10);
                card.querySelectorAll('.wager-btn').forEach(b => b.classList.remove('selected'));
                btn.classList.add('selected'); DraftPicksManager.save();
            });
        });

        // This logic now correctly routes to single or max-2 mode
        if (currentMatchSettings.allow_multiple_double_ups) {
            const individualBtn = card.querySelector('.individual-double-up');
            if (individualBtn) {
                individualBtn.addEventListener('click', (e) => {
                    if (!userPicks[gameId]) return alert("Please select a team before using Double Up.");
                    
                    const isSelected = e.target.classList.contains('selected');

                    // *** THIS IS THE NEW LOGIC ***
                    // If the user is trying to SELECT a new double up...
                    if (!isSelected) {
                        // ...check if they have already reached the cap of 2.
                        if (userDoubleUps.size >= 2) {
                            alert("You can only use a maximum of 2 Double Ups per week.");
                            return; // Stop the function here
                        }
                    }
                    // *** END OF NEW LOGIC ***

                    // If the cap is not reached (or if they are deselecting), toggle as normal.
                    e.target.classList.toggle('selected');
                    if (e.target.classList.contains('selected')) {
                        userDoubleUps.add(gameId); DraftPicksManager.save();
                    } else {
                        userDoubleUps.delete(gameId); DraftPicksManager.save();
                    }
                });
            }
        } else {
            // This is the original logic for single-double-up mode, which is unchanged.
            const sharedBtn = card.querySelector('.shared-double-up');
            if(sharedBtn) {
                sharedBtn.addEventListener('click', (e) => {
                    if (!userPicks[gameId]) return alert("Please select a team before using your Double Up.");
                    const wasSelected = e.target.classList.contains('selected');
                    allSharedDoubleUpBtns.forEach(b => b.classList.remove('selected'));
                    if (!wasSelected) {
                        e.target.classList.add('selected');
                        doubleUpPick = gameId; DraftPicksManager.save();
                    } else {
                        doubleUpPick = null; DraftPicksManager.save();
                    }
                });
            }
        }
    });
}

async function savePicks() {
  try { await requireSession(); } catch (e) { /* surface login UI */ }

    if (!currentUser) return alert('You must be logged in!');
    const selectedWeek = document.getElementById('week-selector').value;
    if (!currentSelectedMatchId) {
        return alert("Error: No match has been selected. This might happen if you are not in any matches.");
    }
    try {
        const validPicksCount = Object.values(userPicks).filter(pick => pick).length;
        if (validPicksCount > 0 && validPicksCount < 5) {
            throw new Error(`You must make a minimum of 5 picks to save. You currently have ${validPicksCount}.`);
        }
        for (const gameId in userPicks) {
            if (userPicks[gameId] && !userWagers[gameId]) {
                const game = allGames.find(g => g['Game Id'] === gameId);
                throw new Error(`You must place a wager for the ${game['Away Display Name']} @ ${game['Home Display Name']} game.`);
            }
        }

        const picksToUpsert = Object.keys(userPicks).filter(gameId => userPicks[gameId] !== undefined).map(gameId => {
            // *** CONDITIONAL LOGIC FOR SAVING DOUBLE UP ***
            let isDouble = false;
            if (currentMatchSettings.allow_multiple_double_ups) {
                isDouble = userDoubleUps.has(gameId);
            } else {
                isDouble = gameId === doubleUpPick;
            }

            return {
                user_id: currentUser.id,
                game_id: parseInt(gameId, 10),
                match_id: currentSelectedMatchId,
                picked_team: userPicks[gameId],
                wager: userWagers[gameId],
                is_double_up: isDouble,
                week: selectedWeek
            };
        });

        const picksToDelete = [...initiallySavedPicks].filter(gameId => !userPicks[gameId]);
        if (picksToUpsert.length > 0) {
            const { error } = await supabase.from('picks').upsert(picksToUpsert, { onConflict: 'user_id, game_id, match_id' });
            if (error) throw error;
        }
        if (picksToDelete.length > 0) {
            const { error } = await supabase.from('picks')
                .delete()
                .eq('user_id', currentUser.id)
                .eq('match_id', currentSelectedMatchId)
                .in('game_id', picksToDelete);
            if (error) throw error;
        }
        alert('Your picks have been saved for this match!');
        DraftPicksManager.clear();
        renderGamesForWeek(selectedWeek, currentSelectedMatchId);
    } catch (error) {
        console.error("Save Picks Error:", error);
        alert('Error: ' + error.message);
    }
}

async function setupGlobalMatchSelector() {
    const selectorContainer = document.getElementById('global-selector-container');
    const selector = document.getElementById('global-match-selector');
    selectorContainer.classList.add('hidden');
    currentSelectedMatchId = null;
    currentMatchSettings = {}; // Reset settings

    if (!currentUser) {
        return;
    }
    const { data: memberships, error: membershipError } = await supabase
        .from('match_members')
        .select('match_id')
        .eq('user_id', currentUser.id);

    if (membershipError || !memberships || memberships.length === 0) {
        currentSelectedMatchId = null;
        return;
    }

    const matchIds = memberships.map(m => m.match_id);
    
    // --- THIS IS THE FIX ---
    // The query has been updated to select the new 'buy_in' and 'value_per_point' columns.
    const { data: userMatches, error: matchesError } = await supabase
        .from('matches')
        .select('id, name, allow_multiple_double_ups, buy_in, value_per_point') // <-- UPDATED LINE
        .in('id', matchIds);
    // --- END OF FIX ---

    if (matchesError || !userMatches || userMatches.length === 0) {
        currentSelectedMatchId = null;
    } else {
        const setMatch = (matchId) => {
            currentSelectedMatchId = matchId;
            currentMatchSettings = userMatches.find(m => m.id == matchId) || {};
        };

        if (userMatches.length === 1) {
            setMatch(userMatches[0].id);
        } else {
            selector.innerHTML = userMatches.map(m => `<option value="${m.id}">${m.name}</option>`).join('');
            setMatch(selector.value); // Set initial match
            selectorContainer.classList.remove('hidden');

            selector.addEventListener('change', () => {
                setMatch(selector.value); // Update on change
                const activePageId = document.querySelector('.page.active')?.id;
                if (activePageId) {
                    showPage(activePageId);
                }
            });
        }
    }
}

async function joinMatch(matchId) {
  try { await requireSession(); } catch (e) { /* surface login UI */ }

    const password = prompt("Please enter the match password:");
    if (!password) return;
    const { error } = await supabase.rpc('join_match_with_password', {
        p_match_id: matchId,
        p_password: password
    });
    if (error) {
        alert("Failed to join match: " + error.message);
    } else {
        alert("Successfully joined match!");
        window.location.hash = '#scoreboard';
    }
}

async function createMatch() {
  try { await requireSession(); } catch (e) { /* surface login UI */ }

    const name = prompt("Enter a name for your new match:");
    if (!name || name.trim().length < 3) {
        return alert("Match name must be at least 3 characters long.");
    }
    const password = prompt("Create a password for your match (users will need this to join):");
    if (!password || password.length < 6) {
        return alert("Password must be at least 6 characters long.");
    }
    try {
        const { error } = await supabase.from('matches').insert({
            name: name,
            hashed_password: password,
            created_by: currentUser.id,
            is_public: true
        });
        if (error) { throw error; }
        const { data: newMatch, error: fetchError } = await supabase
            .from('matches').select('id').eq('name', name).eq('created_by', currentUser.id)
            .order('created_at', { ascending: false }).limit(1).single();
        if (fetchError || !newMatch) {
           throw new Error("Could not find the match right after creating it.");
        }
        const { error: memberError } = await supabase.from('match_members').insert({
            match_id: newMatch.id,
            user_id: currentUser.id
        });
        if (memberError) { throw memberError; }
        alert("Match created successfully! You have been added as a member.");
        if (document.getElementById('matches-page').classList.contains('active')) {
             displayMatchesPage();
        } else {
             window.location.hash = '#matches';
        }
    } catch (error) {
        console.error("Error creating match:", error);
        alert("Error creating match: " + error.message);
    }
}

function setupEventListeners() {
    const hamburgerBtn = document.getElementById('hamburger-btn');
    const mainNav = document.getElementById('main-nav');
    setupAuthListeners();
    document.getElementById('save-picks-btn').addEventListener('click', savePicks);
    document.getElementById('profile-form').addEventListener('submit', handleProfileUpdate);
    document.getElementById('profile-avatar-url').addEventListener('input', (e) => {
        updateAvatarPreview(e.target.value);
    });

    // --- FIX #1: THE GLOBAL CONNECTION FIX ---
    // This listener solves the "nothing happens" issue after returning to the tab.
    // It wakes up the Supabase connection for the entire application as soon as the tab becomes visible again.
    // This ensures that any subsequent action (like fetching stats or saving picks) will use a live connection.
    document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') {
            supabase.auth.getSession();
        }
    });

    hamburgerBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        mainNav.classList.toggle('nav-open');
        document.body.classList.toggle('nav-open-body');
    });
    document.body.addEventListener('click', (e) => {
        if (e.target.matches('#logout-btn')) logoutUser();
        if (e.target.matches('.join-match-btn')) joinMatch(e.target.dataset.matchId);
        if (e.target.matches('#create-match-btn')) createMatch();
        if (e.target.classList.contains('info-tab')) {
            e.stopPropagation(); 
            const teamName = e.target.dataset.teamName;
            const info = teamInfo[teamName];
            if (info) {
                showInfoPopup(info.TeamName, info.AISummary, info.DepthChart, info.News);
            }
        }
        if (e.target.classList.contains('modal-overlay') || e.target.classList.contains('modal-close-btn')) {
            hideInfoPopup();
        }
        const navLink = e.target.closest('.nav-link');
        if (navLink) {
            e.preventDefault();
            if (mainNav.classList.contains('nav-open')) {
                mainNav.classList.remove('nav-open');
                document.body.classList.remove('nav-open-body');
            }
            window.location.hash = navLink.getAttribute('href').substring(1);
        } else if (mainNav.classList.contains('nav-open') && !e.target.closest('#main-nav') && !e.target.closest('#hamburger-btn')) {
            mainNav.classList.remove('nav-open');
            document.body.classList.remove('nav-open-body');
        }
    });
    window.addEventListener('hashchange', () => {
        const pageId = (window.location.hash.substring(1) || 'home') + '-page';
        if (currentUser) {
            showPage(pageId);
        } else {
            showPage('auth-page');
        }
    });
}

async function initializeAppForUser() {
  try { await requireSession(); } catch (e) { /* surface login UI */ }

    try {
        if (currentUser) {
            // Fetch the user's profile if it's not already loaded
            if (!currentUserProfile || currentUserProfile.id !== currentUser.id) {
                const { data: profile, error } = await supabase.from('profiles').select('*').eq('id', currentUser.id).single();
                if (error) console.error("Could not fetch user profile:", error.message);
                else currentUserProfile = profile;
            }
            updateUserStatusUI(currentUserProfile);
            await setupGlobalMatchSelector();
            await checkAndDisplayPicksReminder();
        } else {
            // If there's no user, clean up the UI
            updateUserStatusUI(null);
            document.getElementById('picks-reminder-banner').classList.add('hidden');
        }
    } catch (error) {
        console.error("Error during app initialization for user:", error.message);
    } finally {
        // Determine which page to show
        if (currentUser) {
            // If the user isn't in any matches, force them to the matches page
            if (!currentSelectedMatchId) {
                showPage('matches-page');
            } else {
                // Otherwise, show the page from the URL hash or default to home
                const hash = window.location.hash.substring(1);
                const pageId = (hash || 'home') + '-page';
                showPage(document.getElementById(pageId) ? pageId : 'home-page');
            }
        } else {
            showPage('auth-page');
        }
    }
}

function startApp() {
    supabase.auth.onAuthStateChange(async (event, session) => {
        
        // This is the key logic: check if the user has actually changed
        const userChanged = currentUser?.id !== session?.user?.id;
        currentUser = session?.user || null;

        // Only clear the profile if the user is different or has logged out
        if (userChanged) {
            currentUserProfile = null;
        }

        // --- THE FIX ---
        // We now handle the event that occurs when you return to a sleeping tab.
        // The 'visibilitychange' listener triggers a getSession(), which in turn triggers
        // this handler with the 'TOKEN_REFRESHED' event.
        if (event === 'INITIAL_SESSION' || event === 'SIGNED_IN' || event === 'TOKEN_REFRESHED') {
            
            // Call our new reusable function to set up everything
            await initializeAppForUser();

            // Make sure the loading overlay is hidden after setup
            const loadingOverlay = document.getElementById('loading-overlay');
            if (loadingOverlay) {
                loadingOverlay.classList.add('hidden');
            }

        } else if (event === 'SIGNED_OUT') {
            // Handle logout
            updateUserStatusUI(null);
            showPage('auth-page');
        }
    });
}

function getOrdinalSuffix(i) {
    const j = i % 10,
          k = i % 100;
    if (j == 1 && k != 11) {
        return i + "st";
    }
    if (j == 2 && k != 12) {
        return i + "nd";
    }
    if (j == 3 && k != 13) {
        return i + "rd";
    }
    return i + "th";
}

async function displayTeamStatsForCategory(teamId, category) {
  try { await supabase.auth.getSession(); } catch (e) { /* no-op */ }
  // Resolve teamId from name if needed and rebuild map if missing
  try {
    if ((!teamId || typeof teamId !== 'string') && window.__statsCtx && window.__statsCtx.teamName) {
      const tn = window.__statsCtx.teamName;
      if (typeof teamNameToIdMap === 'undefined' || !teamNameToIdMap?.get) {
        if (typeof fetchGameData === 'function') { await fetchGameData(); }
      }
      if (teamNameToIdMap?.get) teamId = teamNameToIdMap.get(tn) || teamId;
    }
  } catch (e) {}

    // --- THIS IS THE FIX ---
    // By placing this here, we guarantee the connection to Supabase is "awake" and authenticated
    // right before we make the RPC call, preventing the indefinite loading state when returning to the tab.
    await supabase.auth.getSession();

    const outputDiv = document.getElementById('modal-stats-output');
    if (!outputDiv) return;

    outputDiv.innerHTML = '<p>Loading stats...</p>';

    try {
        const { data, error } = await supabase
            .rpc('get_team_stats_with_ranks', { p_team_id: teamId })
            .single();

        if (error) throw error;
        if (!data) {
            outputDiv.innerHTML = '<p>No stats available for this team.</p>';
            return;
        }

        const categoryStats = statMappings[category];
        if (!categoryStats) {
            outputDiv.innerHTML = '<p>Invalid category.</p>';
            return;
        }

        let tableHtml = '<table class="stats-table"><tbody>';
        for (const [dbKey, displayName] of Object.entries(categoryStats)) {
            let value = data[dbKey];
            
            const rankKey = dbKey + '_rank';
            const countKey = dbKey + '_count'; // The key for our new tie-count data
            const rank = data[rankKey];
            const tieCount = data[countKey];

            // --- THIS IS THE NEW LOGIC FOR TIE FORMATTING ---
            let rankDisplay = '';
            if (rank) {
                // If the tie count is greater than 1, add the "T-" prefix
                if (tieCount > 1) {
                    rankDisplay = `<span class="stat-rank">(T-${getOrdinalSuffix(rank)})</span>`;
                } else {
                    rankDisplay = `<span class="stat-rank">(${getOrdinalSuffix(rank)})</span>`;
                }
            }
            // --- END OF NEW LOGIC ---
            
            if (dbKey.includes('_pct') && typeof value === 'number') {
                value = value.toFixed(1) + '%';
            }
            if (value === null || typeof value === 'undefined') {
                value = 'N/A';
            }
            
            tableHtml += `<tr><td>${displayName}</td><td>${value} ${rankDisplay}</td></tr>`;
        }
        tableHtml += '</tbody></table>';

        outputDiv.innerHTML = tableHtml;

    } catch (err) {
        console.error("Error fetching team stats with ranks:", err);
        outputDiv.innerHTML = '<p>Could not load stats.</p>';
    }
}

async function showInfoPopup(teamName, summary, depthChartUrl, newsUrl) {
    
window.__activePopupId = 'info-modal';
window.__infoPopupCtx = { teamName };
window.__infoPopupSourceRoute = location.hash || '';
window.__reopenInfoPopupOnResume = true;
// Track active popup and minimal context so we can repaint after resume
    window.__activePopupId = 'info-modal';
    window.__infoPopupCtx = { teamName };
    try { await supabase.auth.getSession(); } catch (e) {}

    // If essential fields missing, lazy-fetch from TEAM_INFO_URL
    if (!summary || !depthChartUrl || !newsUrl) {
      try {
        const resp = await fetch(`${TEAM_INFO_URL}&t=${Date.now()}`, { cache: 'no-store' });
        const csv = await resp.text();
        const rows = parseTeamInfoCSV(csv);
        const rec = rows.find(r => r.TeamName === teamName);
        if (rec) {
          summary = summary || rec.AISummary;
          depthChartUrl = depthChartUrl || rec.DepthChart;
          newsUrl = newsUrl || rec.News;
        }
      } catch (e) { /* swallow; popup still renders minimal */ }
    }

    // 1. Find or create the modal element
    let modal = document.getElementById('info-modal');
    if (!modal) {
        // If it doesn't exist, create the basic shell. This only happens once.
        modal = document.createElement('div');
        modal.id = 'info-modal';
        modal.className = 'modal-overlay hidden';
        document.body.appendChild(modal);
    }

    // 2. THIS IS THE CRITICAL FIX:
    //    Wipe the modal's inner content completely clean. This ensures that NO old
    //    event listeners or stale content from a previous team can possibly persist.
    modal.innerHTML = `
        <div class="modal-content">
            <button class="modal-close-btn">&times;</button>
            <h3 id="modal-team-name"></h3>
            <div id="modal-summary-container">
                <p id="modal-summary"></p>
            </div>
            <div id="modal-link-container"></div>
            <div id="modal-stats-container" class="hidden">
                <div id="modal-stats-dropdown"></div>
                <div id="modal-stats-output"></div>
            </div>
        </div>
    `;

    // 3. Get references to the NEWLY created elements inside the modal
    const summaryContainer = modal.querySelector('#modal-summary-container');
    const statsContainer = modal.querySelector('#modal-stats-container');
    const linkContainer = modal.querySelector('#modal-link-container');
    const statsDropdown = modal.querySelector('#modal-stats-dropdown');
    const teamId = teamNameToIdMap?.get ? teamNameToIdMap.get(teamName) : undefined;
window.__statsCtx = { teamId, teamName, category: 'General' };

    // 4. Populate the fresh elements with the current team's data
    modal.querySelector('#modal-team-name').textContent = teamName;
    modal.querySelector('#modal-summary').textContent = summary;

    // Build the link buttons
    if (depthChartUrl) {
        linkContainer.innerHTML += `<a href="${depthChartUrl}" target="_blank" rel="noopener noreferrer" target="_blank" rel="noopener noreferrer" class="modal-link-button">Depth Chart</a>`;
    }
    if (newsUrl) {
        linkContainer.innerHTML += `<a href="${newsUrl}" target="_blank" rel="noopener noreferrer" target="_blank" rel="noopener noreferrer" class="modal-link-button">News</a>`;
    }

    // 5. Create the toggle button and attach a NEW event handler for it
    const statsToggleBtn = document.createElement('button');
    statsToggleBtn.id = 'stats-toggle-btn';
    statsToggleBtn.className = 'modal-link-button';
    statsToggleBtn.textContent = 'Stats';

    statsToggleBtn.addEventListener('click', () => {
        const isShowingSummary = statsContainer.classList.contains('hidden');

        if (isShowingSummary) {
            // Switch to Stats view
            summaryContainer.classList.add('hidden');
            statsContainer.classList.remove('hidden');
            statsToggleBtn.classList.add('active');
            statsToggleBtn.innerHTML = `&larr; Summary`;

            // Build the category buttons with fresh listeners
            statsDropdown.innerHTML = Object.keys(statMappings)
                .map(cat => `<button class="stats-category-btn" data-category="${cat}">${cat}</button>`)
                .join('');

            statsDropdown.querySelectorAll('.stats-category-btn').forEach(btn => {
                btn.addEventListener('click', () => {
                    statsDropdown.querySelectorAll('.stats-category-btn').forEach(b => b.classList.remove('active'));
                    btn.classList.add('active');
                    // This now works reliably because it's a fresh listener with the correct teamId
                    displayTeamStatsForCategory(teamId, btn.dataset.category);
                });
            });
            // Automatically click 'General' to show stats right away
            if (statsDropdown.querySelector('.stats-category-btn')) {
                 statsDropdown.querySelector('.stats-category-btn').click();
            }

        } else {
            // Switch back to Summary view
            statsContainer.classList.add('hidden');
            summaryContainer.classList.remove('hidden');
            statsToggleBtn.classList.remove('active');
            statsToggleBtn.textContent = 'Stats';
        }
    });

    linkContainer.appendChild(statsToggleBtn);

    // 6. Finally, show the fully rebuilt modal
    // Delegated handler for category buttons; persists across re-renders
if (!modal.__statsDelegated) {
  modal.addEventListener('click', async (ev) => {
    const btn = ev.target.closest('.stats-category-btn');
    if (!btn) return;
    const category = btn.dataset.category;
    if (!category) return;
    // Update selected state
    modal.querySelectorAll('.stats-category-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    // Persist context
    if (window.__statsCtx) window.__statsCtx.category = category;
    // Render stats
    try {
      await displayTeamStatsForCategory(window.__statsCtx.teamId, category);
    } catch (e) { console.warn('stats switch failed', e); }
  });
  modal.__statsDelegated = true;
}

// Restore previously selected category after resume, else default to General/Rushing fallback
(async () => {
  try {
    const want = (window.__statsCtx && window.__statsCtx.category) || null;
    const target = want && modal.querySelector(`.stats-category-btn[data-category="${want}"]`);
    const first = modal.querySelector('.stats-category-btn');
    const fallback = target || first;
    if (fallback) {
      // Emulate click to trigger render
      fallback.click();
    }
  } catch (e) {}
})();

modal.classList.remove('hidden');
}



function hideInfoPopup() {
    const modal = document.getElementById('info-modal');
    if (modal) {
        modal.classList.add('hidden');
    }

    window.__reopenInfoPopupOnResume = false;
    window.__activePopupId = null;
}

async function init() {
    try {
        await fetchGameData();

        const infoResponse = await fetch(`${TEAM_INFO_URL}&t=${new Date().getTime()}`);
        const infoCsvText = await infoResponse.text();
        
        const allInfo = parseTeamInfoCSV(infoCsvText); 
        allInfo.forEach(info => { teamInfo[info.TeamName] = info; });
        
        defaultWeek = determineDefaultWeek(allGames);
        
        setupEventListeners();
        startApp();

    } catch (error) {
        console.error("CRITICAL: Failed to load game data.", error);
        document.querySelector('main.container').innerHTML = "<h1>Could not load game data. Please refresh the page.</h1>";
    }
}

// ------- Diagnostics -------
// Press ` (tilde/backtick) to log top element at screen center (helps find invisible blockers)
window.addEventListener('keydown', (e) => {
  if (e.key === '`') {
    const els = document.elementsFromPoint(window.innerWidth/2, window.innerHeight/2);
    console.info('[Probe] Top elements under center:', els.slice(0, 5));
  }
});
// Surface silent failures
window.addEventListener('error', e => console.error('GlobalError:', e.message, e.error || ''));
window.addEventListener('unhandledrejection', e => console.error('UnhandledRejection:', e.reason || ''));
// ------- End Diagnostics -------


// Close info popup on route changes
window.addEventListener('hashchange', () => {
  const m = document.getElementById('info-modal');
  if (m) m.classList.add('hidden');
  window.__reopenInfoPopupOnResume = false;
  window.__activePopupId = null;
});

// Autosave draft when tab is hidden (extra safety)
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') { try { DraftPicksManager.save(); } catch (e) {} }
});
