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
let doubleUpPick = null; // For single-double-up mode
let userDoubleUps = new Set(); // For multiple-double-up mode
let currentMatchSettings = {}; // To store the settings of the current match
let initiallySavedPicks = new Set();
let scoreChartInstance = null;
let currentSelectedMatchId = null;

// *** NEW: A reliable, built-in default avatar to prevent network errors ***
const DEFAULT_AVATAR_URL = 'https://mtjflkwoxjnwaawjlaxy.supabase.co/storage/v1/object/sign/Assets/ChatGPT%20Image%20Sep%2012,%202025,%2004_06_17%20PM.png?token=eyJraWQiOiJzdG9yYWdlLXVybC1zaWduaW5nLWtleV8zZTY3ZGM1Mi0xZGZiLTQ5ZGYtYmRjZC02Y2VlZWQwMWFkMTUiLCJhbGciOiJIUzI1NiJ9.eyJ1cmwiOiJBc3NldHMvQ2hhdEdQVCBJbWFnZSBTZXAgMTIsIDIwMjUsIDA0XzA2XzE3IFBNLnBuZyIsImlhdCI6MTc1NzcwNzU5MywiZXhwIjoxNzg5MjQzNTkzfQ.CWGJaiGmfGGmq7RACw3TAP7DI-gpx4I6EtYcXw1LznU';


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
    const now = new Date();
    const regularSeasonGames = games.filter(g => g.Week && g.Week.startsWith('Week '));
    if (regularSeasonGames.length === 0) return 'Week 1';
    const nextGame = regularSeasonGames
        .sort((a, b) => getKickoffTimeAsDate(a) - getKickoffTimeAsDate(b))
        .find(g => getKickoffTimeAsDate(g) > now);
    if (nextGame) return nextGame.Week;
    const lastWeek = regularSeasonGames[regularSeasonGames.length - 1];
    return lastWeek ? lastWeek.Week : 'Week 1';
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
        
        let avatarImg = '';
        if (avatarUrl) {
            avatarImg = `<img src="${avatarUrl}" alt="User Avatar" class="header-avatar" onerror="this.src='${DEFAULT_AVATAR_URL}'">`;
        }
        
        // --- THIS IS THE FIX ---
        // The avatar and username are now wrapped in a link to the #home page.
        userStatusDiv.innerHTML = `
            <a href="#home" class="user-profile-link nav-link">
                ${avatarImg}
                <span>Welcome, ${username}</span>
            </a>
            <button id="logout-btn">Logout</button>
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
    const weeklyGames = allGames.filter(game => game.Week === week);
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
        doubleUpPick = null;
        userDoubleUps.clear(); // Clear the set for the new week
        initiallySavedPicks.clear();

        savedPicks.forEach(p => {
            const gameIdStr = p.game_id.toString();
            initiallySavedPicks.add(gameIdStr);
            userPicks[p.game_id] = p.picked_team;
            userWagers[p.game_id] = p.wager;

            if (p.is_double_up) {
                if (currentMatchSettings.allow_multiple_double_ups) {
                    userDoubleUps.add(gameIdStr);
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
                const resultClass = pick.is_correct ? 'correct' : 'incorrect';
                const resultText = pick.is_correct ? 'Correct' : 'Incorrect';
                let points = pick.is_correct ? pick.wager : (pick.wager * -2);
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
    const showChartBtn = document.getElementById('show-chart-btn');
    const showTableBtn = document.getElementById('show-table-btn');
    if (!runSheetContainer || !chartView || !tableView || !showChartBtn || !showTableBtn) {
        console.error("Scoreboard HTML elements not found! Please ensure your index.html file has been updated with the new chart/table toggle structure.");
        return;
    }
    if (scoreChartInstance) {
        scoreChartInstance.destroy();
        scoreChartInstance = null;
    }
    runSheetContainer.innerHTML = '';

    // --- THIS IS THE MODIFIED LOGIC ---
    // The 'hidden' class has been swapped, and the 'active' class is now on the table button.
    chartView.classList.add('hidden');
    tableView.classList.remove('hidden');
    showChartBtn.classList.remove('active');
    showTableBtn.classList.add('active');
    // --- END OF MODIFICATION ---

    showChartBtn.onclick = () => {
        chartView.classList.remove('hidden');
        tableView.classList.add('hidden');
        showChartBtn.classList.add('active');
        showTableBtn.classList.remove('active');
    };
    showTableBtn.onclick = () => {
        tableView.classList.remove('hidden');
        chartView.classList.add('hidden');
        showTableBtn.classList.add('active');
        showChartBtn.classList.remove('active');
    };
    if (currentSelectedMatchId) {
        loadScoreboardForMatch(currentSelectedMatchId);
    } else {
        runSheetContainer.innerHTML = '<p>Please join a match to see the scoreboard.</p>';
        chartView.innerHTML = '<p>Please join a match to see standings.</p>';
    }
}

async function loadScoreboardForMatch(matchId) {
    try {
        const { data: members, error: membersError } = await supabase
            .from('match_members')
            .select('profiles (id, username, avatar_url)')
            .eq('match_id', matchId);

        if (membersError) throw membersError;
        if (!members || members.length === 0) return;

        const { data: allScoredPicks, error: picksError } = await supabase
            .from('picks')
            .select('user_id, week, wager, is_double_up, is_correct')
            .eq('match_id', matchId)
            .not('is_correct', 'is', null);

        if (picksError) throw picksError;

        const { chartData, tableData } = processWeeklyScores(members, allScoredPicks || []);
        renderScoreChart(chartData);
        renderPlayerScoresTable(tableData, defaultWeek); 

        // --- THIS IS THE FIX ---
        // By cloning and replacing the selector, we ensure any old, stale event listeners are destroyed.
        let weekSelector = document.getElementById('run-sheet-week-selector');
        const allWeeks = [...new Set(allGames.filter(g => g.Week.startsWith('Week ')).map(g => g.Week))];
        allWeeks.sort((a, b) => parseInt(a.split(' ')[1]) - parseInt(b.split(' ')[1]));
        
        // Create a clean clone of the element.
        const newSelector = weekSelector.cloneNode(true);
        weekSelector.parentNode.replaceChild(newSelector, weekSelector);
        
        // Populate and set the value on the new, clean selector.
        newSelector.innerHTML = allWeeks.map(w => `<option value="${w}">${w}</option>`).join('');
        newSelector.value = defaultWeek;

        // Now, add the event listener. This is the ONLY listener on this element.
        newSelector.addEventListener('change', () => {
            renderRunSheetForWeek(newSelector.value, matchId, members);
        });

        renderRunSheetForWeek(newSelector.value, matchId, members);
        // --- END OF FIX ---

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
            let points = pick.is_correct ? pick.wager : (pick.wager * -2);
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
    let tableHtml = '<table class="run-sheet-table">';

    // *** THIS IS THE MODIFIED SECTION ***
    tableHtml += '<thead><tr><th>Game</th>';
    sortedMembers.forEach(member => {
        // Conditionally render the avatar icon or the username in the header
        const memberDisplay = member.profiles.avatar_url
            ? `<div class="player-header" title="${member.profiles.username}"><img src="${member.profiles.avatar_url}" class="run-sheet-avatar" onerror="this.src='${DEFAULT_AVATAR_URL}'"></div>`
            : `<div class="player-header">${member.profiles.username}</div>`;
        tableHtml += `<th>${memberDisplay}</th>`;
    });
    tableHtml += '</tr></thead>';
    // *** END OF MODIFIED SECTION ***

    tableHtml += '<tbody>';
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

                    if (isGameFinal) {
                        points = pick.is_correct ? pick.wager : (pick.wager * -2);
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
                        cellStyle = `style="background-color: ${styles.backgroundColor}; color: ${styles.color};"`;
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
                    if (doubleUpPick === gameId) doubleUpPick = null;
                    userDoubleUps.delete(gameId);
                    card.querySelectorAll('.selected').forEach(el => el.classList.remove('selected'));
                } else {
                    userPicks[gameId] = teamName;
                    card.querySelectorAll('.team').forEach(t => t.classList.remove('selected'));
                    team.classList.add('selected');
                }
            });
        });

        card.querySelectorAll('.wager-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                if (!userPicks[gameId]) return alert("Please select a team before placing a wager.");
                userWagers[gameId] = parseInt(btn.dataset.value, 10);
                card.querySelectorAll('.wager-btn').forEach(b => b.classList.remove('selected'));
                btn.classList.add('selected');
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
                        userDoubleUps.add(gameId);
                    } else {
                        userDoubleUps.delete(gameId);
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
                        doubleUpPick = gameId;
                    } else {
                        doubleUpPick = null;
                    }
                });
            }
        }
    });
}

async function savePicks() {
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
    // *** MODIFIED QUERY: Fetch the new column ***
    const { data: userMatches, error: matchesError } = await supabase
        .from('matches')
        .select('id, name, allow_multiple_double_ups') // <-- ADDED THE NEW COLUMN
        .in('id', matchIds);

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
                // --- THIS IS THE FIX ---
                // The third argument (info.DepthChart) is now correctly passed to the function.
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


function startApp() {
    supabase.auth.onAuthStateChange(async (event, session) => {
        const userJustSignedIn = currentUser === null && session?.user;
        currentUser = session?.user || null;
        currentUserProfile = null;

        if (event === 'INITIAL_SESSION' || event === 'SIGNED_IN' || userJustSignedIn) {
            if (currentUser) {
                const { data: profile, error } = await supabase.from('profiles').select('*').eq('id', currentUser.id).single();
                if (error) console.error("Could not fetch user profile:", error.message);
                else currentUserProfile = profile;
            }
            updateUserStatusUI(currentUserProfile);
            try {
                if (currentUser) {
                    await setupGlobalMatchSelector();
                    await checkAndDisplayPicksReminder();
                } else {
                    document.getElementById('picks-reminder-banner').classList.add('hidden');
                }
            } catch (error) {
                console.error("Error during auth state change setup:", error.message);
            } finally {
                const loadingOverlay = document.getElementById('loading-overlay');
                if (loadingOverlay) {
                    loadingOverlay.classList.add('hidden');
                }
                if (currentUser) {
                    if (!currentSelectedMatchId) {
                        showPage('matches-page');
                    } else {
                        const hash = window.location.hash.substring(1);
                        const pageId = (hash || 'home') + '-page';
                        showPage(document.getElementById(pageId) ? pageId : 'home-page');
                    }
                } else {
                    showPage('auth-page');
                }
            }
        } else if (event === 'SIGNED_OUT') {
            updateUserStatusUI(null);
            showPage('auth-page');
        }
    });
}

function showInfoPopup(teamName, summary, depthChartUrl, newsUrl) { // --- THIS IS THE FIX: Added newsUrl ---
    let modal = document.getElementById('info-modal');
    if (!modal) {
        modal = document.createElement('div');
        modal.id = 'info-modal';
        modal.className = 'modal-overlay hidden';
        modal.innerHTML = `
            <div class="modal-content">
                <button class="modal-close-btn">&times;</button>
                <h3 id="modal-team-name"></h3>
                <p id="modal-summary"></p>
                <div id="modal-link-container"></div>
            </div>
        `;
        document.body.appendChild(modal);
    }
    document.getElementById('modal-team-name').textContent = teamName;
    document.getElementById('modal-summary').textContent = summary;
    const linkContainer = document.getElementById('modal-link-container');
    
    // --- THIS IS THE FIX: Build the HTML for both buttons ---
    let linksHtml = '';
    if (depthChartUrl && depthChartUrl.trim() !== '') {
        linksHtml += `<a href="${depthChartUrl}" target="_blank" rel="noopener noreferrer" class="modal-link-button">Depth Chart</a>`;
    }
    if (newsUrl && newsUrl.trim() !== '') {
        linksHtml += `<a href="${newsUrl}" target="_blank" rel="noopener noreferrer" class="modal-link-button">News</a>`;
    }
    linkContainer.innerHTML = linksHtml;
    
    modal.classList.remove('hidden');
}



function hideInfoPopup() {
    const modal = document.getElementById('info-modal');
    if (modal) {
        modal.classList.add('hidden');
    }
}

async function init() {
    try {
        const [gameResponse, infoResponse] = await Promise.all([
            fetch(`${SHEET_URL}&t=${new Date().getTime()}`),
            fetch(`${TEAM_INFO_URL}&t=${new Date().getTime()}`)
        ]);

        const gameCsvText = await gameResponse.text();
        const infoCsvText = await infoResponse.text();
        
        // --- THIS IS THE FIX ---
        // Use the original parseCSV for the game data.
        allGames = parseCSV(gameCsvText); 
        // Use the new, separate parser for the team info data.
        const allInfo = parseTeamInfoCSV(infoCsvText); 

        allInfo.forEach(info => { teamInfo[info.TeamName] = info; });
        defaultWeek = determineDefaultWeek(allGames);
        allGames.forEach(game => {
            if (game['Home Display Name'] && game['Home Logo']) {
                teamData[game['Home Display Name']] = game['Home Logo'];
            }
            if (game['Away Display Name'] && game['Away Logo']) {
                teamData[game['Away Display Name']] = game['Away Logo'];
            }
        });

        setupEventListeners();
        startApp();

    } catch (error) {
        console.error("CRITICAL: Failed to load game data.", error);
        document.querySelector('main.container').innerHTML = "<h1>Could not load game data. Please refresh the page.</h1>";
    }
}
