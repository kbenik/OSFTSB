// =================================================================
// CONFIGURATION & INITIALIZATION
// =================================================================
const SUPABASE_URL = 'https://mtjflkwoxjnwaawjlaxy.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im10amZsa3dveGpud2Fhd2psYXh5Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTU3MDY1MzQsImV4cCI6MjA3MTI4MjUzNH0.PflqgxXG3kISTpp7nUNCXiBn-Ue3kvKNIS2yV1oz-jg';
const supabase = self.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
const SHEET_URL = 'https://docs.google.com/spreadsheets/d/e/2PACX-1vScqmMOmdB95tGFqkzzPMNUxnGdIum_bXFBhEvX8Xj-b0M3hZYCu8w8V9k7CgKvjHMCtnmj3Y3Vza0A/pub?gid=1227961915&single=true&output=csv';

// --- STATE MANAGEMENT ---
let allGames = [];
let defaultWeek = '';
let currentUser = null;
let userPicks = {};
let userWagers = {};
let doubleUpPick = null;
let initiallySavedPicks = new Set();
let scoreChartInstance = null;

// =================================================================
// EVENT LISTENERS
// =================================================================
document.addEventListener('DOMContentLoaded', init);

// =================================================================
// UTILITY & HELPER FUNCTIONS
// =================================================================
function parseCSV(csvText) {
    const lines = csvText.trim().split('\n');
    if (lines.length < 2) return [];
    const headers = lines[0].split(',').map(h => h.trim());
    return lines.slice(1).map(line => {
        const values = line.split(',');
        const game = {};
        headers.forEach((header, index) => {
            let value = values[index] || '';
            game[header] = value.replace(/^"|"$/g, '').trim();
        });
        return game;
    });
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
        if (error) return alert('Error signing up: ' + error.message);
        const { error: profileError } = await supabase.from('profiles').insert([{ id: data.user.id, username: username }]);
        if (profileError) return alert('Error creating profile: ' + profileError.message);
        alert('Sign up successful! Please check your email to confirm your account.');
        e.target.reset();
    });

    document.getElementById('login-form').addEventListener('submit', async (e) => {
        e.preventDefault();
        const email = document.getElementById('login-email').value;
        const password = document.getElementById('login-password').value;
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) alert('Error logging in: ' + error.message);
    });
}

async function logoutUser() {
    await supabase.auth.signOut();
    window.location.hash = '';
}

// =================================================================
// PAGE-SPECIFIC LOGIC
// =================================================================
function displayPicksPage() {
    const selector = document.getElementById('week-selector');
    const allWeeks = [...new Set(allGames.filter(g => g.Week.startsWith('Week ')).map(g => g.Week))];
    allWeeks.sort((a, b) => parseInt(a.split(' ')[1]) - parseInt(b.split(' ')[1]));
    selector.innerHTML = allWeeks.map(w => `<option value="${w}">${w}</option>`).join('');
    selector.value = defaultWeek;
    const newSelector = selector.cloneNode(true);
    selector.parentNode.replaceChild(newSelector, selector);
    newSelector.addEventListener('change', () => renderGamesForWeek(newSelector.value));
    renderGamesForWeek(defaultWeek);
}

async function renderGamesForWeek(week) {
    const gamesContainer = document.getElementById('games-container');
    const saveButton = document.getElementById('save-picks-btn');
    document.getElementById('picks-page-title').textContent = `${week} Picks`;
    gamesContainer.innerHTML = '';
    saveButton.style.display = 'block';
    const now = new Date();
    const weeklyGames = allGames.filter(game => game.Week === week);
    if (weeklyGames.length === 0) {
        gamesContainer.innerHTML = `<p class="card">No games found for ${week}.</p>`;
        saveButton.style.display = 'none';
        return;
    }
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

        // --- FIX: This line was missing ---
        gamesContainer.appendChild(gameCard); 
    });
    addGameCardEventListeners();
    await loadAndApplyUserPicks(week);
}

async function loadAndApplyUserPicks(week) {
    try {
        const { data: savedPicks, error } = await fetchUserPicksForWeek(week);
        if (error) throw error;
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
                card.insertAdjacentHTML('beforeend', '<div class="saved-indicator" title="This pick is saved"></div>');
            }
        });
    } catch (err) {
        console.error("Non-critical error fetching user picks:", err.message);
    }
}

async function displayDashboard() {
    if (!currentUser) return;
    const [pendingPicksRes, pastPicksRes] = await Promise.all([
        supabase.from('picks').select('*').eq('user_id', currentUser.id).is('is_correct', null),
        supabase.from('picks').select('*').eq('user_id', currentUser.id).not('is_correct', 'is', null).order('created_at', { ascending: false })
    ]);
    const pendingBody = document.getElementById('pending-picks-body');
    document.getElementById('pending-picks-week').textContent = defaultWeek;
    pendingBody.innerHTML = '';
    const pendingPicksForWeek = pendingPicksRes.data?.filter(p => p.week === defaultWeek) || [];
    if (pendingPicksForWeek.length > 0) {
        pendingPicksForWeek.forEach(pick => {
            const game = allGames.find(g => g['Game Id'] == pick.game_id);
            const gameName = game ? `${game['Away Display Name']} @ ${game['Home Display Name']}` : `Game ID: ${pick.game_id}`;
            const doubleUp = pick.is_double_up ? ' 🔥' : '';
            pendingBody.innerHTML += `<tr><td>${gameName}</td><td>${pick.picked_team}</td><td>${pick.wager}${doubleUp}</td></tr>`;
        });
    } else {
        pendingBody.innerHTML = `<tr><td colspan="3">No pending picks for ${defaultWeek}.</td></tr>`;
    }
    const historyBody = document.getElementById('pick-history-body');
    historyBody.innerHTML = '';
    if (pastPicksRes.data?.length > 0) {
        pastPicksRes.data.forEach(pick => {
            const game = allGames.find(g => g['Game Id'] == pick.game_id);
            const gameName = game ? `${game['Away Display Name']} @ ${game['Home Display Name']}` : `Game ID: ${pick.game_id}`;
            const resultClass = pick.is_correct ? 'correct' : 'incorrect';
            const resultText = pick.is_correct ? 'Correct' : 'Incorrect';
            let points = pick.is_correct ? pick.wager : (pick.wager * -2);
            if (pick.is_double_up) points *= 2;
            const pointsText = points > 0 ? `+${points}` : points;
            historyBody.innerHTML += `<tr><td>${gameName} (${pick.week})</td><td>${pick.picked_team}</td><td class="${resultClass}">${resultText}</td><td>${pointsText}</td></tr>`;
        });
    } else {
        historyBody.innerHTML = '<tr><td colspan="4">No pick history yet.</td></tr>';
    }
}

async function displayScoreboardPage() {
    const selector = document.getElementById('match-selector');
    const runSheetContainer = document.getElementById('run-sheet-container');
    
    // Clear previous state
    if (scoreChartInstance) {
        scoreChartInstance.destroy();
        scoreChartInstance = null;
    }
    runSheetContainer.innerHTML = '';

    const { data: userMatches, error: userMatchesError } = await supabase
        .from('match_members')
        .select('matches (id, name)')
        .eq('user_id', currentUser.id);

    if (userMatchesError || !userMatches || userMatches.length === 0) {
        runSheetContainer.innerHTML = '<p>You are not part of any matches yet. Visit the Matches page to join or create one!</p>';
        selector.innerHTML = '';
        return;
    }

    selector.innerHTML = userMatches.map(m => `<option value="${m.matches.id}">${m.matches.name}</option>`).join('');
    
    // Replace listener to prevent duplicates
    const newSelector = selector.cloneNode(true);
    selector.parentNode.replaceChild(newSelector, selector);
    newSelector.addEventListener('change', () => loadScoreboardForMatch(newSelector.value));

    // Initial load
    loadScoreboardForMatch(newSelector.value);
}

async function loadScoreboardForMatch(matchId) {
    // 1. Fetch all members in the current match
    const { data: members, error: membersError } = await supabase
        .from('match_members')
        .select('profiles (id, username)')
        .eq('match_id', matchId);

    if (membersError) return console.error("Error fetching members:", membersError);
    if (!members || members.length === 0) return;

    // 2. Fetch all historical, scored picks for these members
    const memberIds = members.map(m => m.profiles.id);
    const { data: allScoredPicks, error: picksError } = await supabase
        .from('picks')
        .select('user_id, week, wager, is_double_up, is_correct')
        .in('user_id', memberIds)
        .not('is_correct', 'is', null); // Only get picks that have a result

    if (picksError) return console.error("Error fetching historical picks:", picksError);

    // 3. Process the raw picks into a week-by-week cumulative score for the chart
    const chartData = processWeeklyScores(members, allScoredPicks || []);
    renderScoreChart(chartData); // Render the new time-series chart

    // 4. Fetch the CURRENT week's picks for the run sheet (this logic remains the same)
    const selectedWeek = defaultWeek;
    document.getElementById('scoreboard-week-title').textContent = selectedWeek;
    const { data: allCurrentPicks } = await supabase
        .from('picks')
        .select('picked_team, wager, is_double_up, game_id, user_id')
        .in('user_id', memberIds)
        .eq('week', selectedWeek);
    
    renderRunSheet(members, allCurrentPicks || [], selectedWeek);
}

// *** ADD THIS NEW HELPER FUNCTION ***
function processWeeklyScores(members, allPicks) {
    const labels = ['Start'];
    const maxWeek = 18;
    for (let i = 1; i <= maxWeek; i++) {
        labels.push(`Week ${i}`);
    }

    const playerScoresByWeek = new Map();
    let latestCompletedWeek = 0; // Track the most recent week with scored games

    // Initialize scores for all players
    members.forEach(member => {
        playerScoresByWeek.set(member.profiles.id, Array(maxWeek + 1).fill(0));
    });

    // Calculate points for each week
    allPicks.forEach(pick => {
        const weekNum = parseInt(pick.week.split(' ')[1]);
        if (weekNum > 0 && weekNum <= maxWeek) {
            // Update the latest completed week if this pick's week is higher
            if (weekNum > latestCompletedWeek) {
                latestCompletedWeek = weekNum;
            }
            let points = pick.is_correct ? pick.wager : (pick.wager * -2);
            if (pick.is_double_up) {
                points *= 2;
            }
            const userScores = playerScoresByWeek.get(pick.user_id);
            if (userScores) {
                userScores[weekNum] += points; // Add points for that specific week
            }
        }
    });

    // Calculate cumulative scores
    playerScoresByWeek.forEach((scores, userId) => {
        for (let i = 1; i <= maxWeek; i++) {
            scores[i] = scores[i] + scores[i - 1]; // Cumulative sum
        }
        
        // --- NEW: Set future weeks to null to create a gap in the line ---
        for (let i = latestCompletedWeek + 1; i <= maxWeek; i++) {
            scores[i] = null;
        }
    });
    
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
        datasets.push({
            label: member.profiles.username,
            data: playerScoresByWeek.get(member.profiles.id),
            borderColor: color,
            backgroundColor: color.replace('1)', '0.1)'),
            fill: false,
            tension: 0.1,
            pointRadius: 3,
            spanGaps: false // This tells Chart.js to NOT draw a line over null data points
        });
        colorIndex++;
    });

    return { labels, datasets };
}
// *** ADD THIS NEW FUNCTION ***
function renderScoreChart(chartData) {
    const ctx = document.getElementById('score-chart').getContext('2d');
    
    // --- NEW: Dynamic Scaling Logic ---
    let minScore = 0;
    let maxScore = 0;
    chartData.datasets.forEach(dataset => {
        dataset.data.forEach(point => {
            if (point === null) return;
            if (point < minScore) minScore = point;
            if (point > maxScore) maxScore = point;
        });
    });

    // Set a default scale of -10 to 10, but allow it to expand if scores go beyond that
    const suggestedMin = Math.min(-10, minScore - 5); // Add 5 points of padding
    const suggestedMax = Math.max(10, maxScore + 5); // Add 5 points of padding

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
                    callbacks: {
                        title: (tooltipItems) => tooltipItems[0].label,
                        label: (context) => `${context.dataset.label}: ${context.parsed.y.toFixed(0)}`
                    }
                }
            },
            scales: {
                y: {
                    // Apply the dynamic min/max values
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

// *** ADD THIS NEW FUNCTION ***
function renderRunSheet(members, allPicks, week) {
    const container = document.getElementById('run-sheet-container');
    const weeklyGames = allGames.filter(g => g.Week === week).sort((a, b) => getKickoffTimeAsDate(a) - getKickoffTimeAsDate(b));
    const now = new Date();

    // Sort members by username for consistent column order
    const sortedMembers = [...members].sort((a, b) => a.profiles.username.localeCompare(b.profiles.username));

    let tableHtml = '<table class="run-sheet-table">';

    // Header Row: Game, Odds, followed by player names
    tableHtml += '<thead><tr><th>Game</th><th>Odds</th>';
    sortedMembers.forEach(member => {
        tableHtml += `<th>${member.profiles.username}</th>`;
    });
    tableHtml += '</tr></thead>';

    // Body Rows: One for each game
    tableHtml += '<tbody>';
    weeklyGames.forEach(game => {
        const kickoff = getKickoffTimeAsDate(game);
        const hasKickedOff = kickoff < now;
        
        // --- THIS IS THE ONLY LINE THAT CHANGES ---
        // Before: const isFinal = game.Status === 'post';
        const shouldShowScore = game.Status !== 'pre'; // Now shows score if game is in-progress OR final

        // Logic for Scores and Odds
        const awayScore = shouldShowScore ? game['Away Score'] : '-';
        const homeScore = shouldShowScore ? game['Home Score'] : '-';
        const oddsText = game.Odds || '-';

        // Build the row structure
        tableHtml += `<tr>
            <td class="game-matchup-cell">
                <div class="matchup-team-container">
                    <img src="${game['Away Logo']}" alt="${game['Away']}" class="team-logo">
                    <div class="team-info-wrapper">
                         <span class="team-code">${game['Away']}</span>
                         <span class="team-score">${awayScore}</span>
                    </div>
                </div>
                <div class="matchup-team-container">
                    <img src="${game['Home Logo']}" alt="${game['Home']}" class="team-logo">
                     <div class="team-info-wrapper">
                         <span class="team-code">${game['Home']}</span>
                         <span class="team-score">${homeScore}</span>
                    </div>
                </div>
            </td>
            <td class="odds-cell">${oddsText}</td> 
        `;
        
        // Player picks logic remains the same
        sortedMembers.forEach(member => {
            const pick = allPicks.find(p => p.game_id == game['Game Id'] && p.user_id === member.profiles.id);

            if (pick && hasKickedOff) {
                const pickedTeamCode = pick.picked_team === game['Home Display Name'] ? game['Home'] : game['Away'];
                const doubleUpClass = pick.is_double_up ? 'double-up' : '';
                
                tableHtml += `<td class="pick-cell wager-${pick.wager} ${doubleUpClass}">${pickedTeamCode}</td>`;

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

    // Fetch both all public matches and the user's current memberships at the same time
    const [publicMatchesRes, userMembershipsRes] = await Promise.all([
        supabase.from('matches').select('id, name').eq('is_public', true),
        supabase.from('match_members').select('match_id').eq('user_id', currentUser.id)
    ]);

    const { data: publicMatches, error: matchesError } = publicMatchesRes;
    const { data: userMemberships, error: membershipsError } = userMembershipsRes;

    if (matchesError || membershipsError) {
        return container.innerHTML = '<p>Could not load matches. Please try again.</p>';
    }

    if (!publicMatches || publicMatches.length === 0) {
        return container.innerHTML = '<p>No public matches found. Why not create one?</p>';
    }

    // Create a Set of the user's joined match IDs for a fast and easy lookup
    const joinedMatchIds = new Set(userMemberships.map(m => m.match_id));

    // Map over the public matches and generate the correct HTML for each one
    container.innerHTML = publicMatches.map(match => {
        const isJoined = joinedMatchIds.has(match.id);

        // Conditionally create either a "Join" button or a disabled "Currently Joined" button
        const buttonHtml = isJoined
            ? `<button class="button-secondary" disabled>Currently Joined</button>`
            : `<button class="button-primary join-match-btn" data-match-id="${match.id}">Join</button>`;
        
        return `<div class="match-item"><span>${match.name}</span>${buttonHtml}</div>`;
    }).join('');
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
    try {
        const selectedWeek = document.getElementById('week-selector').value;
        for (const gameId in userPicks) {
            if (userPicks[gameId] && !userWagers[gameId]) {
                const game = allGames.find(g => g['Game Id'] === gameId);
                throw new Error(`You must place a wager for the ${game['Away Display Name']} @ ${game['Home Display Name']} game.`);
            }
        }
        const picksToUpsert = Object.keys(userPicks).filter(gameId => userPicks[gameId] !== undefined).map(gameId => ({
            user_id: currentUser.id,
            game_id: parseInt(gameId, 10),
            picked_team: userPicks[gameId],
            wager: userWagers[gameId],
            is_double_up: gameId === doubleUpPick,
            week: selectedWeek
        }));
        const picksToDelete = [...initiallySavedPicks].filter(gameId => !userPicks[gameId]);
        if (picksToUpsert.length > 0) {
            const { error } = await supabase.from('picks').upsert(picksToUpsert, { onConflict: 'user_id, game_id' });
            if (error) throw error;
        }
        if (picksToDelete.length > 0) {
            const { error } = await supabase.from('picks').delete().eq('user_id', currentUser.id).in('game_id', picksToDelete);
            if (error) throw error;
        }
        alert('Your picks have been saved!');
        renderGamesForWeek(selectedWeek);
    } catch (error) {
        console.error("Save Picks Error:", error);
        alert('Error: ' + error.message);
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
    if (!name) return;
    const password = prompt("Create a password for your match (users will need this to join):");
    if (!password) return;
    const { data: newMatch, error: createError } = await supabase.from('matches').insert({
        name,
        password,
        created_by: currentUser.id,
        is_public: true
    }).select().single();
    if (createError) return alert("Error creating match: " + createError.message);
    const { error: memberError } = await supabase.from('match_members').insert({
        match_id: newMatch.id,
        user_id: currentUser.id
    });
    if (!memberError) {
        alert("Match created successfully!");
        displayMatchesPage();
    } else {
        alert("Match created, but failed to add you as a member: " + memberError.message);
    }
}

async function fetchUserPicksForWeek(week) {
    if (!currentUser) return { data: [], error: null };
    return await supabase.from('picks').select('*').eq('user_id', currentUser.id).eq('week', week);
}

// =================================================================
// INITIALIZATION & APP START
// =================================================================
async function init() {
    const hamburgerBtn = document.getElementById('hamburger-btn');
    const mainNav = document.getElementById('main-nav');

    setupAuthListeners();
    document.getElementById('save-picks-btn').addEventListener('click', savePicks);

    hamburgerBtn.addEventListener('click', (e) => {
    e.stopPropagation(); 
    mainNav.classList.toggle('nav-open');
    document.body.classList.toggle('nav-open-body'); // Add this line
})

    document.body.addEventListener('click', (e) => {
        if (e.target.matches('#logout-btn')) logoutUser();
        if (e.target.matches('.join-match-btn')) joinMatch(e.target.dataset.matchId);
        if (e.target.matches('#create-match-btn')) createMatch();

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

    try {
        const response = await fetch(SHEET_URL);
        const csvText = await response.text();
        allGames = parseCSV(csvText);
        defaultWeek = determineDefaultWeek(allGames);
    } catch (error) {
        console.error("CRITICAL: Failed to load game data.", error);
        document.querySelector('main.container').innerHTML = "<h1>Could not load game data. Please refresh the page.</h1>";
        return;
    }
    
    supabase.auth.onAuthStateChange((event, session) => {
        currentUser = session?.user || null;
        updateUserStatusUI();
        const hash = window.location.hash.substring(1);
        const pageId = (hash || 'home') + '-page';
        if (currentUser) {
            showPage(document.getElementById(pageId) ? pageId : 'home-page');
        } else {
            showPage('auth-page');
        }
    });
}
