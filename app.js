// =================================================================
// CONFIGURATION & INITIALIZATION
// =================================================================
const SUPABASE_URL = 'https://mtjflkwoxjnwaawjlaxy.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im10amZsa3dveGpud2Fhd2psYXh5Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTU3MDY1MzQsImV4cCI6MjA3MTI4MjUzNH0.PflqgxXG3kISTpp7nUNCXiBn-Ue3kvKNIS2yV1oz-jg';
const supabase = self.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
const SHEET_URL = 'https://docs.google.com/spreadsheets/d/e/2PACX-1vScqmMOmdB95tGFqkzzPMNUxnGdIum_bXFBhEvX8Xj-b0M3hZYCu8w8V9k7CgKvjHMCtnmj3Y3Vza0A/pub?gid=1227961915&single=true&output=csv';

// --- STATE MANAGEMENT ---
let allGames = [];
let teamData = {};
let defaultWeek = '';
let currentUser = null;
let userPicks = {};
let userWagers = {};
let doubleUpPick = null;
let initiallySavedPicks = new Set();
let scoreChartInstance = null;
let currentSelectedMatchId = null;

// =================================================================
// EVENT LISTENERS
// =================================================================
document.addEventListener('DOMContentLoaded', init);

// =================================================================
// UTILITY & HELPER FUNCTIONS
// =================================================================
// REPLACE your current parseCSV function with this FINAL, robust version
function parseCSV(csvText) {
    // Standardize line endings and then split into lines
    const lines = csvText.trim().replace(/\r\n/g, '\n').split('\n');

    if (lines.length < 2) return [];

    const headers = lines[0].split(',').map(h => h.trim());
    
    // This regex is correct for handling quoted fields.
    const regex = /(?:"([^"]*)"|([^,]*))(?:,|$)/g;

    const dataRows = lines.slice(1)
        .map(line => {
            // *** THIS IS THE FIX ***
            // If the line is empty or just whitespace, return null to filter it out later.
            if (!line || line.trim() === '') {
                return null;
            }

            const values = [];
            let match;
            regex.lastIndex = 0; // Reset regex state for each new line

            while (match = regex.exec(line)) {
                // Failsafe: if the regex matched a zero-length string at the same position,
                // it's an infinite loop. Break out.
                if (match.index === regex.lastIndex) {
                    regex.lastIndex++;
                }
                values.push(match[1] || match[2] || '');
            }

            // Remove the extra empty value that the regex can sometimes add at the end
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
        // Filter out any rows that were marked as null (i.e., the empty ones)
        .filter(game => game !== null);
    
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
function updateUserStatusUI() {
    const userStatusDiv = document.getElementById('user-status');
    const mainNav = document.getElementById('main-nav');
    const hamburgerBtn = document.getElementById('hamburger-btn');

    if (currentUser) {
        const username = currentUser.user_metadata?.username || currentUser.email;
        userStatusDiv.innerHTML = `<span>Welcome, ${username}</span><button id="logout-btn">Logout</button>`;
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
                // No specific JS needed for this static page, but the case is here for completeness.
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
        // Provide a more specific error for the user
        return alert('Error signing up: ' + error.message);
    }
    // The profile is now created automatically by the database trigger.
    alert('Sign up successful! Please log in.'); // Changed message to be clearer
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
        // NOTE: The explicit "window.location.hash" redirect has been removed.
        // The onAuthStateChange handler will now correctly manage the redirect.
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
    
    // 1. Populate Week Selector (as before)
    const allWeeks = [...new Set(allGames.filter(g => g.Week.startsWith('Week ')).map(g => g.Week))];
    allWeeks.sort((a, b) => parseInt(a.split(' ')[1]) - parseInt(b.split(' ')[1]));
    weekSelector.innerHTML = allWeeks.map(w => `<option value="${w}">${w}</option>`).join('');
    weekSelector.value = defaultWeek;

    // 2. The match selector logic is GONE from here.

    // 3. Function to handle re-rendering when week changes
    const renderPicks = () => {
        if (currentSelectedMatchId) { // Check if a match is selected globally
            renderGamesForWeek(weekSelector.value, currentSelectedMatchId);
        } else {
            // Handle case where user isn't in any matches
            document.getElementById('games-container').innerHTML = `<div class="card"><p>You must join a match on the 'Matches' page before you can make picks!</p></div>`;
            document.getElementById('save-picks-btn').style.display = 'none';
        }
    };
    weekSelector.addEventListener('change', renderPicks);
    renderPicks();
}

async function renderGamesForWeek(week, matchId) { // Now accepts matchId
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
    
    // Clear the container before adding new cards
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

        gameCard.innerHTML = `
            <div class="team" data-team-name="${game['Away Display Name']}"><img src="${game['Away Logo']}" alt="${game['Away Display Name']}"><span class="team-name">${game['Away Display Name']}</span></div>
            <div class="game-separator">@</div>
            <div class="team" data-team-name="${game['Home Display Name']}"><img src="${game['Home Logo']}" alt="${game['Home Display Name']}"><span class="team-name">${game['Home Display Name']}</span></div>
            <div class="game-info">${displayTime}${oddsText}</div>
            <div class="wager-controls">
                <div class="wager-options">
                    <span>Wager:</span>
                    ${[1, 2, 3, 4, 5].map(w => `<button class="wager-btn" data-value="${w}">${w}</button>`).join('')}
                </div>
                <button class="double-up-btn">2x Double Up</button>
            </div>`;
        gamesContainer.appendChild(gameCard);
    });
    
    addGameCardEventListeners();
    await loadAndApplyUserPicks(week, matchId); // Pass matchId to loader
}

async function loadAndApplyUserPicks(week, matchId) { // Now accepts matchId
    try {
        // The query now includes a filter for match_id
        const { data: savedPicks, error } = await supabase
            .from('picks')
            .select('*')
            .eq('user_id', currentUser.id)
            .eq('week', week)
            .eq('match_id', matchId);

        if (error) throw error;
        
        // Reset state for the new context (week/match)
        userPicks = {};
        userWagers = {};
        doubleUpPick = null;
        initiallySavedPicks.clear();

        savedPicks.forEach(p => {
            initiallySavedPicks.add(p.game_id.toString());
            userPicks[p.game_id] = p.picked_team;
            userWagers[p.game_id] = p.wager;
            if (p.is_double_up) doubleUpPick = p.game_id.toString();

            const card = document.querySelector(`.game-card[data-game-id="${p.game_id}"]`);
            if (card) {
                card.querySelector(`.team[data-team-name="${p.picked_team}"]`)?.classList.add('selected');
                card.querySelector(`.wager-btn[data-value="${p.wager}"]`)?.classList.add('selected');
                if (p.is_double_up) card.querySelector('.double-up-btn').classList.add('selected');
            }
        });
    } catch (err) {
        console.error("Non-critical error fetching user picks:", err.message);
    }
}

async function displayDashboard() {
    if (!currentUser) return;

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
// REPLACE the old checkAndDisplayPicksReminder function with this new version

async function checkAndDisplayPicksReminder() {
    const banner = document.getElementById('picks-reminder-banner');
    // We no longer check for currentSelectedMatchId here, as we need to check all matches.
    if (!currentUser) {
        banner.classList.add('hidden');
        return;
    }

    // --- Date and Week Logic (This part remains the same) ---
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

    // Only show the banner if we are within the active reminder period.
    if (now < tuesdayOfThatWeek || now > firstKickoff) {
        banner.classList.add('hidden');
        return;
    }

    // --- NEW LOGIC: Check picks across ALL joined matches ---
    try {
        // 1. Get all match IDs the user is a member of.
        const { data: memberships, error: membershipError } = await supabase
            .from('match_members')
            .select('match_id')
            .eq('user_id', currentUser.id);

        if (membershipError || !memberships || memberships.length === 0) {
            banner.classList.add('hidden'); // User isn't in any matches, so no reminder needed.
            return;
        }
        const joinedMatchIds = new Set(memberships.map(m => m.match_id));

        // 2. Get the distinct match IDs for which the user has already made picks this week.
        const { data: picks, error: picksError } = await supabase
            .from('picks')
            .select('match_id')
            .eq('user_id', currentUser.id)
            .eq('week', defaultWeek);

        if (picksError) {
            console.error("Error fetching picks for banner check:", picksError);
            banner.classList.add('hidden'); // Hide on error to be safe.
            return;
        }
        const matchesWithPicks = new Set(picks.map(p => p.match_id));

        // 3. Compare the two sets. If any joined match doesn't have picks, show the banner.
        let needsToMakePicks = false;
        for (const matchId of joinedMatchIds) {
            // If a joined match is NOT in the set of matches with picks, we need to show the reminder.
            if (!matchesWithPicks.has(matchId)) {
                needsToMakePicks = true;
                break; // We found at least one, so we can stop checking.
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
    // --- THIS IS THE ROBUST FIX ---
    // First, find all the elements we need for this page to work.
    const runSheetContainer = document.getElementById('run-sheet-container');
    const chartView = document.getElementById('chart-view');
    const tableView = document.getElementById('table-view');
    const showChartBtn = document.getElementById('show-chart-btn');
    const showTableBtn = document.getElementById('show-table-btn');

    // **CRITICAL CHECK**: If any of these elements are missing, stop the function.
    // This prevents the "Cannot read properties of null" error.
    if (!runSheetContainer || !chartView || !tableView || !showChartBtn || !showTableBtn) {
        console.error("Scoreboard HTML elements not found! Please ensure your index.html file has been updated with the new chart/table toggle structure.");
        return; // Stop execution to prevent crashing.
    }

    // Now we know the elements exist, so we can safely proceed.
    if (scoreChartInstance) {
        scoreChartInstance.destroy();
        scoreChartInstance = null;
    }
    runSheetContainer.innerHTML = '';
    
    // Set the default view to be the chart
    chartView.classList.remove('hidden');
    tableView.classList.add('hidden');
    showChartBtn.classList.add('active');
    showTableBtn.classList.remove('active');

    // Use .onclick to assign event handlers. This is simple and prevents duplicate listeners.
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

    // Load scoreboard data as before
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
            .select('profiles (id, username)')
            .eq('match_id', matchId);

        if (membersError) throw membersError;
        if (!members || members.length === 0) return;

        const { data: allScoredPicks, error: picksError } = await supabase
            .from('picks')
            .select('user_id, week, wager, is_double_up, is_correct')
            .eq('match_id', matchId)
            .not('is_correct', 'is', null);

        if (picksError) throw picksError;

        // *** THIS IS THE KEY CHANGE ***
        // Process the scores once and get both chart and table data
        const { chartData, tableData } = processWeeklyScores(members, allScoredPicks || []);

        // Render both components with the processed data
        renderScoreChart(chartData);
        renderPlayerScoresTable(tableData);
        // *** END OF CHANGE ***

        const selectedWeek = defaultWeek;
        document.getElementById('scoreboard-week-title').textContent = selectedWeek;
        const { data: allCurrentPicks, error: currentPicksError } = await supabase
            .from('picks')
            .select('picked_team, wager, is_double_up, game_id, user_id, is_correct')
            .eq('match_id', matchId)
            .eq('week', selectedWeek);
        
        if (currentPicksError) throw currentPicksError;
        
        renderRunSheet(members, allCurrentPicks || [], selectedWeek);

    } catch (error) {
        console.error("Error loading scoreboard data:", error.message);
        document.getElementById('run-sheet-container').innerHTML = `<p class="card">Could not load scoreboard due to an error.</p>`;
    }
}

// *** ADD THIS NEW HELPER FUNCTION ***
function processWeeklyScores(members, allPicks) {
    const labels = ['Start'];
    const maxWeek = 18;
    for (let i = 1; i <= maxWeek; i++) {
        labels.push(`Week ${i}`);
    }

    const weeklyScoresMap = new Map(); // Stores points for each week { userId: [0, 5, -2, ...] }
    const cumulativeScoresMap = new Map(); // Stores running total for chart { userId: [0, 5, 3, ...] }
    let latestCompletedWeek = 0;

    // Initialize scores for all members
    members.forEach(member => {
        const userId = member.profiles.id;
        weeklyScoresMap.set(userId, Array(maxWeek + 1).fill(0));
        cumulativeScoresMap.set(userId, Array(maxWeek + 1).fill(0));
    });

    // Calculate points for each week
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

    // Create the final player data array and calculate cumulative scores
    const playerData = members.map(member => {
        const userId = member.profiles.id;
        const weeklyScores = weeklyScoresMap.get(userId);
        const cumulativeScores = cumulativeScoresMap.get(userId);

        for (let i = 1; i <= maxWeek; i++) {
            cumulativeScores[i] = cumulativeScores[i - 1] + weeklyScores[i];
        }

        // Set future weeks to null for the chart's visual gap
        for (let i = latestCompletedWeek + 1; i <= maxWeek; i++) {
            cumulativeScores[i] = null;
        }

        return {
            id: userId,
            username: member.profiles.username,
            weeklyScores: weeklyScores.slice(1), // Exclude "Start" week 0
            runningTotal: cumulativeScores[latestCompletedWeek] || 0,
            chartScores: cumulativeScores
        };
    });
    
    // Sort players by running total for the table view
    playerData.sort((a, b) => b.runningTotal - a.runningTotal);
    
    // WoW-inspired distinct colors
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

    // Create the final dataset for Chart.js
    const datasets = [];
    let colorIndex = 0;
    members.forEach(member => {
        const color = playerColors[colorIndex % playerColors.length];
        const data = playerData.find(p => p.id === member.profiles.id);
        if (data) {
            datasets.push({
                label: member.profiles.username,
                data: data.chartScores,
                borderColor: color,
                backgroundColor: color.replace('1)', '0.1)'),
                fill: false,
                tension: 0.1,
                pointRadius: 3,
                spanGaps: false
            });
        }
        colorIndex++;
    });

    return {
        chartData: { labels, datasets },
        tableData: { playerData, latestCompletedWeek }
    };
}

function renderPlayerScoresTable(tableData) {
    const { playerData, latestCompletedWeek } = tableData;
    const table = document.getElementById('player-scores-table');

    // Handle case where there is no data or no weeks have been scored yet
    if (!playerData || playerData.length === 0 || latestCompletedWeek < 1) {
        table.innerHTML = '<thead><tr><th>Player</th><th>Total</th></tr></thead><tbody><tr><td colspan="2">No weekly scores to display yet.</td></tr></tbody>';
        return;
    }

    // Set the headers in the desired order
    const thisWeekHeader = `This Week (Wk ${latestCompletedWeek})`;
    const lastWeekHeader = `Last Week`;

    // --- THIS IS THE FIX ---
    // Create the header row in the order: Player, Total, This Week, Last Week
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

    // Create the body rows with the columns swapped
    let bodyHtml = '<tbody>';
    playerData.forEach(player => {
        const currentWeekScore = player.weeklyScores[latestCompletedWeek - 1] || 0;
        let lastWeekCellContent;

        if (latestCompletedWeek === 1) {
            lastWeekCellContent = ''; // Blank for Week 1
        } else {
            const lastWeekTotal = player.runningTotal - currentWeekScore;
            lastWeekCellContent = lastWeekTotal;
        }

        // Render the data cells in the new order
        bodyHtml += `
            <tr>
                <td>${player.username}</td>
                <td class="total-score-col">${player.runningTotal}</td>
                <td>${currentWeekScore}</td>
                <td>${lastWeekCellContent}</td>
            </tr>
        `;
    });
    bodyHtml += '</tbody>';

    table.innerHTML = headerHtml + bodyHtml;
}

function renderScoreChart(chartData) {
    const ctx = document.getElementById('score-chart').getContext('2d');
    
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
                    labels: { boxWidth: 12, font: { size: 12 } }
                },
                tooltip: {
                    mode: 'index',
                    intersect: false,
                    // --- THIS IS THE NEW LINE ---
                    itemSort: (a, b) => b.raw - a.raw, // Sorts tooltip items from highest to lowest score
                    // --- END OF NEW LINE ---
                    callbacks: {
                        title: (tooltipItems) => tooltipItems[0].label,
                        label: (context) => `${context.dataset.label}: ${context.parsed.y.toFixed(0)}`
                    }
                }
            },
            scales: {
                y: {
                    min: suggestedMin,
                    max: suggestedMax,
                    ticks: { color: '#666' },
                    grid: { color: '#eee' }
                },
                x: {
                    ticks: { color: '#666' },
                    grid: { display: false }
                }
            },
            interaction: {
                mode: 'index',
                intersect: false
            }
        }
    });
}

function getDynamicStyles(points) {
    // Clamp the points to the specified range [-20, 10]
    const clampedPoints = Math.max(-20, Math.min(10, points));

    let backgroundColor, color = '#333'; // Default to dark text

    if (clampedPoints > 5) {
        // PHASE 1 (Excellent): Range from +6 (light green) to +10 (dark green)
        // This is a 5-point range (6, 7, 8, 9, 10)
        const percentage = (clampedPoints - 5) / 5; // 0.2 for +6, 1.0 for +10
        
        // We map this to a lightness scale from a light green (80%) down to a dark green (30%)
        const lightness = 80 - (percentage * 50);
        backgroundColor = `hsl(120, 50%, ${lightness}%)`; // Hue 120 is green, 50% saturation

        // Switch to white text when the green gets dark
        if (lightness < 55) {
            color = 'white';
        }

    } else if (clampedPoints >= 0) {
        // PHASE 2 (Good): Range from +5 (white) down to 0 (light grey)
        // This is a 6-point range (0, 1, 2, 3, 4, 5)
        const percentage = clampedPoints / 5; // 1.0 for +5, 0.0 for 0
        
        // We map this to a lightness scale from 90% (light grey) up to 100% (pure white)
        const lightness = 90 + (percentage * 10);
        backgroundColor = `hsl(0, 0%, ${lightness}%)`; // Grayscale

    } else if (clampedPoints >= -10) {
        // PHASE 3 (Bad): Range from 0 (light grey) down to -10 (black)
        // This is a 10-point range
        const percentage = Math.abs(clampedPoints / 10); // 0.0 at 0, 1.0 at -10
        
        // We map this from our light grey (90%) down to pure black (0%)
        const lightness = 90 - (percentage * 90);
        backgroundColor = `hsl(0, 0%, ${lightness}%)`; // Grayscale

        if (lightness < 50) {
            color = 'white';
        }
    } else {
        // PHASE 4 (Catastrophic): Range from -10 (black) down to -20 (deep red)
        // This is a 10-point range
        const percentage = (Math.abs(clampedPoints) - 10) / 10; // 0.0 at -10, 1.0 at -20
        
        // Transition from black to red by "fading in" saturation and a bit of lightness
        const saturation = percentage * 100;
        const lightness = percentage * 25;
        backgroundColor = `hsl(0, ${saturation}%, ${lightness}%)`; // Hue 0 is red
        color = 'white';
    }

    return { backgroundColor, color };
}

function renderRunSheet(members, allPicks, week) {
    const container = document.getElementById('run-sheet-container');
    const weeklyGames = allGames.filter(g => g.Week === week).sort((a, b) => getKickoffTimeAsDate(a) - getKickoffTimeAsDate(b));
    const now = new Date();

    const sortedMembers = [...members].sort((a, b) => a.profiles.username.localeCompare(b.profiles.username));
    let tableHtml = '<table class="run-sheet-table">';

    tableHtml += '<thead><tr><th>Game</th>';
    sortedMembers.forEach(member => {
        tableHtml += `<th>${member.profiles.username}</th>`;
    });
    tableHtml += '</tr></thead>';

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

        // --- REVISED AND CORRECTED TOOLTIP LOGIC ---
        let situationTooltipHtml = '';
        if (isInProgress) {
            let situationString = '';
            
            // Handle special cases like Halftime
            if (game.Situation && game.Situation.toLowerCase().includes('half')) {
                situationString = 'Halftime';
            } 
            // Build the full string for in-game plays
            else if (game.Qtr && game.Qtr !== '0') {
                let parts = [`Q${game.Qtr} - ${game.Clock}`];
                
                if (game.Pos && game.Pos.trim()) {
                    parts.push(game.Pos);
                }
                if (game.Situation && game.Situation.trim() && game.Situation !== 'waiting...') {
                    parts.push(game.Situation);
                }
                // Join the parts with different separators for clarity
                situationString = parts.slice(0, 2).join(' - '); // "Q3 - 12:48"
                if (parts.length > 2) {
                    situationString += ` - ${parts.slice(2).join(' ')}`; // " - BAL 2nd & 5..."
                }
            }
            
            const tooltipText = situationString.trim() || 'Game is Live';
            situationTooltipHtml = `<span class="game-situation-tooltip">${tooltipText}</span>`;
        }
        // --- END OF CORRECTION ---

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
        
        // ... The rest of the function remains the same ...
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
function addGameCardEventListeners() {
    const allDoubleUpBtns = document.querySelectorAll('.double-up-btn');
    document.querySelectorAll('.game-card').forEach(card => {
        if (card.classList.contains('locked')) return;
        const gameId = card.dataset.gameId;
        card.querySelectorAll('.team').forEach(team => {
            team.addEventListener('click', () => {
                const teamName = team.dataset.teamName;
                if (userPicks[gameId] === teamName) {
                    userPicks[gameId] = undefined;
                    userWagers[gameId] = undefined;
                    if (doubleUpPick === gameId) doubleUpPick = null;
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
        card.querySelector('.double-up-btn').addEventListener('click', (e) => {
            if (!userPicks[gameId]) return alert("Please select a team before using your Double Up.");
            const wasSelected = e.target.classList.contains('selected');
            allDoubleUpBtns.forEach(b => b.classList.remove('selected'));
            if (!wasSelected) {
                e.target.classList.add('selected');
                doubleUpPick = gameId;
            } else {
                doubleUpPick = null;
            }
        });
    });
}

async function savePicks() {
    if (!currentUser) return alert('You must be logged in!');
    
    const selectedWeek = document.getElementById('week-selector').value;
    
    if (!currentSelectedMatchId) {
        return alert("Error: No match has been selected. This might happen if you are not in any matches.");
    }

    try {
        // --- NEW: Minimum picks validation ---
        // Count how many picks have a team selected
        const validPicksCount = Object.values(userPicks).filter(pick => pick).length;

        // If the user has made some picks (more than 0), but fewer than 5, block them.
        // This still allows the user to save with 0 picks, which is how they clear their slate for the week.
        if (validPicksCount > 0 && validPicksCount < 5) {
            throw new Error(`You must make a minimum of 5 picks to save. You currently have ${validPicksCount}.`);
        }
        // --- End of new validation ---


        // This validation logic for wagers is still correct
        for (const gameId in userPicks) {
            if (userPicks[gameId] && !userWagers[gameId]) {
                const game = allGames.find(g => g['Game Id'] === gameId);
                throw new Error(`You must place a wager for the ${game['Away Display Name']} @ ${game['Home Display Name']} game.`);
            }
        }

        const picksToUpsert = Object.keys(userPicks).filter(gameId => userPicks[gameId] !== undefined).map(gameId => ({
            user_id: currentUser.id,
            game_id: parseInt(gameId, 10),
            match_id: currentSelectedMatchId,
            picked_team: userPicks[gameId],
            wager: userWagers[gameId],
            is_double_up: gameId === doubleUpPick,
            week: selectedWeek
        }));

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

    if (!currentUser) {
        return;
    }

    // --- THIS IS THE CORRECTED QUERY LOGIC ---

    // 1. First, get the IDs of the matches the user is in. This is a simple, direct query.
    const { data: memberships, error: membershipError } = await supabase
        .from('match_members')
        .select('match_id')
        .eq('user_id', currentUser.id);

    if (membershipError || !memberships || memberships.length === 0) {
        currentSelectedMatchId = null;
        return; // Exit if user is in no matches
    }

    // 2. Now, get the details for ONLY those specific matches.
    const matchIds = memberships.map(m => m.match_id);
    const { data: userMatches, error: matchesError } = await supabase
        .from('matches')
        .select('id, name')
        .in('id', matchIds);

    // --- END OF CORRECTED QUERY LOGIC ---

    // The rest of the function logic remains the same
    if (matchesError || !userMatches || userMatches.length === 0) {
        currentSelectedMatchId = null;
    } 
    else if (userMatches.length === 1) {
        currentSelectedMatchId = userMatches[0].id;
    } 
    else {
        selector.innerHTML = userMatches.map(m => `<option value="${m.id}">${m.name}</option>`).join('');
        currentSelectedMatchId = selector.value;
        selectorContainer.classList.remove('hidden');

        selector.addEventListener('change', () => {
            currentSelectedMatchId = selector.value;
            const activePageId = document.querySelector('.page.active')?.id;
            if (activePageId) {
                showPage(activePageId);
            }
        });
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
        // We now call a single database function to handle all the logic securely.
        const { error } = await supabase.from('matches').insert({
            name: name,
            hashed_password: password, // The database will handle hashing this.
            created_by: currentUser.id,
            is_public: true
        });

        if (error) {
            throw error;
        }

        // Now, we need to get the new match to add the creator as a member
        const { data: newMatch, error: fetchError } = await supabase
            .from('matches')
            .select('id')
            .eq('name', name)
            .eq('created_by', currentUser.id)
            .order('created_at', { ascending: false })
            .limit(1)
            .single();

        if (fetchError || !newMatch) {
           throw new Error("Could not find the match right after creating it.");
        }

        // Automatically add the creator as a member of their own match.
        const { error: memberError } = await supabase.from('match_members').insert({
            match_id: newMatch.id,
            user_id: currentUser.id
        });

        if (memberError) {
            throw memberError;
        }

        alert("Match created successfully! You have been added as a member.");
        // Refresh the matches page to show the new match
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

    // Sets up the listeners for the sign-up and login forms
    setupAuthListeners();
    
    // Sets up the listener for the "Save Picks" button on the picks page
    document.getElementById('save-picks-btn').addEventListener('click', savePicks);

    // Toggles the mobile navigation menu
    hamburgerBtn.addEventListener('click', (e) => {
        e.stopPropagation(); 
        mainNav.classList.toggle('nav-open');
        document.body.classList.toggle('nav-open-body');
    });

    // Main click handler for the entire application
    document.body.addEventListener('click', (e) => {
        // Handle specific button clicks
        if (e.target.matches('#logout-btn')) logoutUser();
        if (e.target.matches('.join-match-btn')) joinMatch(e.target.dataset.matchId);
        if (e.target.matches('#create-match-btn')) createMatch();

        // Handle navigation link clicks
        const navLink = e.target.closest('.nav-link');
        if (navLink) {
            e.preventDefault();
            if (mainNav.classList.contains('nav-open')) {
                mainNav.classList.remove('nav-open');
                document.body.classList.remove('nav-open-body');
            }
            window.location.hash = navLink.getAttribute('href').substring(1);
        } else if (mainNav.classList.contains('nav-open') && !e.target.closest('#main-nav') && !e.target.closest('#hamburger-btn')) {
            // Close mobile nav if clicking outside of it
            mainNav.classList.remove('nav-open');
            document.body.classList.remove('nav-open-body');
        }
    });

    // Handles routing when the URL hash changes
    window.addEventListener('hashchange', () => {
        const pageId = (window.location.hash.substring(1) || 'home') + '-page';
        if (currentUser) {
            showPage(pageId);
        } else {
            showPage('auth-page');
        }
    });

    // Handles Supabase authentication state changes (login, logout)
    supabase.auth.onAuthStateChange(async (event, session) => {
        currentUser = session?.user || null;
        updateUserStatusUI();

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
    });
}


// This is the NEW init function that runs when the page loads.
async function init() {
    try {
        const cacheBustingUrl = `${SHEET_URL}&t=${new Date().getTime()}`;
const response = await fetch(cacheBustingUrl);
        const csvText = await response.text();
        allGames = parseCSV(csvText);
        defaultWeek = determineDefaultWeek(allGames);

        // This now happens right after the data is loaded, BEFORE anything else runs.
        allGames.forEach(game => {
            if (game['Home Display Name'] && game['Home Logo']) {
                teamData[game['Home Display Name']] = game['Home Logo'];
            }
            if (game['Away Display Name'] && game['Away Logo']) {
                teamData[game['Away Display Name']] = game['Away Logo'];
            }
        });

        // Now that the data is ready, we can set up the rest of the app.
        setupEventListeners();

    } catch (error) {
        console.error("CRITICAL: Failed to load game data.", error);
        document.querySelector('main.container').innerHTML = "<h1>Could not load game data. Please refresh the page.</h1>";
    }
}
