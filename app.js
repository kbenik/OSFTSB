// =================================================================
// CONFIGURATION & INITIALIZATION
// =================================================================
const SUPABASE_URL = 'https://mtjflkwoxjnwaawjlaxy.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im10amZsa3dveGpud2Fhd2psYXh5Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTU3MDY1MzQsImV4cCI6MjA3MTI4MjUzNH0.PflqgxXG3kISTpp7nUNCXiBn-Ue3kvKNIS2yV1oz-jg';
const supabase = self.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
const SHEET_URL = 'https://docs.google.com/spreadsheets/d/e/2PACX-1vScqmMOmdB95tGFqkzzPMNUxnGdIum_bXFBhEvX8Xj-b0M3hZYCu8w8V9k7CgKvjHMCtnmj3Y3Vza0A/pub?gid=1227961915&single=true&output=csv';

// --- STATE MANAGEMENT ---
let allGames = [];
let defaultWeek = ''; // The week to show on first load
let currentUser = null;
let userPicks = {};
let userWagers = {};
let doubleUpPick = null;
let initiallySavedPicks = new Set();

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
        const datePart = game.Date.split(' ')[1]; // "09/04/2025"
        const timePart = game.Time; // "8:20 PM"
        const [month, day, year] = datePart.split('/');
        let [time, modifier] = timePart.split(' ');
        let [hours, minutes] = time.split(':');
        hours = parseInt(hours, 10);
        if (modifier && modifier.toUpperCase() === 'PM' && hours < 12) hours += 12;
        if (modifier && modifier.toUpperCase() === 'AM' && hours === 12) hours = 0;
        const monthIndex = parseInt(month, 10) - 1;

        // Use Date.UTC to create a reliable timestamp, assuming source is US Eastern Time (UTC-4 during season)
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
    
    // If no future games, default to the last available week in the data
    const lastWeek = regularSeasonGames[regularSeasonGames.length - 1];
    return lastWeek ? lastWeek.Week : 'Week 1';
}

// =================================================================
// PAGE-SPECIFIC LOGIC
// =================================================================

// --- PICKS PAGE ---
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

        gameCard.innerHTML = `
            <div class="team" data-team-name="${game['Away Display Name']}"><img src="${game['Away Logo']}" alt="${game['Away Display Name']}"><span class="team-name">${game['Away Display Name']}</span></div>
            <div class="game-separator">@</div>
            <div class="team" data-team-name="${game['Home Display Name']}"><img src="${game['Home Logo']}" alt="${game['Home Display Name']}"><span class="team-name">${game['Home Display Name']}</span></div>
            <div class="game-info">${displayTime}</div>
            <div class="wager-controls">
                <div class="wager-options">
                    <span>Wager:</span>
                    ${[1, 2, 3, 4, 5].map(w => `<button class="wager-btn" data-value="${w}">${w}</button>`).join('')}
                </div>
                <button class="double-up-btn">2x Double Up</button>
            </div>
        `;
        gamesContainer.appendChild(gameCard);
    });
    
    addGameCardEventListeners();
    await loadAndApplyUserPicks(week);
}

async function loadAndApplyUserPicks(week) {
    try {
        const { data: savedPicks, error } = await fetchUserPicksForWeek(week);
        if (error) throw error;

        userPicks = {}; userWagers = {}; doubleUpPick = null; initiallySavedPicks.clear();
        
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


// --- OTHER PAGE-SPECIFIC FUNCTIONS ---
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
    const standingsBody = document.getElementById('scoreboard-standings-body');
    const picksContainer = document.getElementById('scoreboard-picks-container');
    const { data: userMatches, error: userMatchesError } = await supabase.from('match_members').select('matches (id, name)').eq('user_id', currentUser.id);
    if (userMatchesError || !userMatches || userMatches.length === 0) {
        standingsBody.innerHTML = '<tr><td colspan="3">You are not part of any matches yet. Visit the Matches page to join or create one!</td></tr>';
        picksContainer.innerHTML = '';
        selector.innerHTML = '';
        return;
    }
    selector.innerHTML = userMatches.map(m => `<option value="${m.matches.id}">${m.matches.name}</option>`).join('');
    const newSelector = selector.cloneNode(true);
    selector.parentNode.replaceChild(newSelector, selector);
    newSelector.addEventListener('change', () => loadScoreboardForMatch(newSelector.value));
    loadScoreboardForMatch(newSelector.value);
}
async function loadScoreboardForMatch(matchId) {
    document.getElementById('scoreboard-week-title').textContent = defaultWeek;
    const { data: members, error: membersError } = await supabase.from('match_members').select('score, profiles (id, username)').eq('match_id', matchId).order('score', { ascending: false });
    if (membersError) return console.error("Error fetching members");
    const standingsBody = document.getElementById('scoreboard-standings-body');
    standingsBody.innerHTML = '';
    members.forEach((member, index) => {
        standingsBody.innerHTML += `<tr><td>${index + 1}</td><td>${member.profiles.username}</td><td>${member.score}</td></tr>`;
    });
    const memberIds = members.map(m => m.profiles.id);
    const { data: allPicks } = await supabase.from('picks').select('picked_team, wager, is_double_up, game_id, profiles (username)').in('user_id', memberIds).eq('week', defaultWeek);
    const picksContainer = document.getElementById('scoreboard-picks-container');
    picksContainer.innerHTML = '';
    const picksByUser = members.map(m => ({
        username: m.profiles.username,
        picks: allPicks?.filter(p => p.profiles.username === m.profiles.username) || []
    }));
    picksByUser.forEach(user => {
        let picksHtml = user.picks.map(pick => {
            const doubleUp = pick.is_double_up ? ' 🔥' : '';
            return `<li><span>${pick.picked_team}</span> <span class="wager-indicator">${pick.wager}${doubleUp}</span></li>`;
        }).join('');
        picksContainer.innerHTML += `<div class="scoreboard-user-picks"><h3>${user.username}</h3><ul>${picksHtml || '<li>No picks made yet.</li>'}</ul></div>`;
    });
}
async function displayMatchesPage() {
    const container = document.getElementById('matches-list-container');
    container.innerHTML = '<p>Loading public matches...</p>';
    const { data: matches, error } = await supabase.from('matches').select('id, name').eq('is_public', true);
    if (error) return container.innerHTML = '<p>Could not load matches. Please try again.</p>';
    if (matches.length === 0) return container.innerHTML = '<p>No public matches found. Why not create one?</p>';
    container.innerHTML = matches.map(match => `<div class="match-item"><span>${match.name}</span><button class="button-primary join-match-btn" data-match-id="${match.id}">Join</button></div>`).join('');
}

// =================================================================
// EVENT HANDLERS & DATA SAVING
// =================================================================
function addGameCardEventListeners() {
    const allDoubleUpBtns = document.querySelectorAll('.double-up-btn');
    document.querySelectorAll('.game-card').forEach(card => {
        if (card.classList.contains('locked')) return; // Don't add listeners to locked cards
        const gameId = card.dataset.gameId;
        card.querySelectorAll('.team').forEach(team => {
            team.addEventListener('click', () => {
                const teamName = team.dataset.teamName;
                if (userPicks[gameId] === teamName) {
                    userPicks[gameId] = undefined; userWagers[gameId] = undefined;
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
            user_id: currentUser.id, game_id: parseInt(gameId, 10), picked_team: userPicks[gameId], wager: userWagers[gameId], is_double_up: gameId === doubleUpPick, week: selectedWeek
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
    const { error } = await supabase.rpc('join_match_with_password', { p_match_id: matchId, p_password: password });
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
    const { data: newMatch, error: createError } = await supabase.from('matches').insert({ name, password, created_by: currentUser.id, is_public: true }).select().single();
    if (createError) return alert("Error creating match: " + createError.message);
    const { error: memberError } = await supabase.from('match_members').insert({ match_id: newMatch.id, user_id: currentUser.id });
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
    setupAuthListeners();
    document.getElementById('save-picks-btn').addEventListener('click', savePicks);
    document.body.addEventListener('click', (e) => {
        if (e.target.matches('#logout-btn')) logoutUser();
        if (e.target.matches('.join-match-btn')) joinMatch(e.target.dataset.matchId);
        if (e.target.matches('#create-match-btn')) createMatch();
        const navLink = e.target.closest('.nav-link');
        if (navLink) {
            e.preventDefault();
            window.location.hash = navLink.getAttribute('href').substring(1);
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
