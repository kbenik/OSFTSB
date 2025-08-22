// =================================================================
// CONFIGURATION & INITIALIZATION
// =================================================================

// --- SUPABASE CLIENT ---
const SUPABASE_URL = 'https://mtjflkwoxjnwaawjlaxy.supabase.co'; 
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im10amZsa3dveGpud2Fhd2psYXh5Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTU3MDY1MzQsImV4cCI6MjA3MTI4MjUzNH0.PflqgxXG3kISTpp7nUNCXiBn-Ue3kvKNIS2yV1oz-jg';

const supabase = self.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// --- GOOGLE SHEET DATA ---
const SHEET_URL = 'https://docs.google.com/spreadsheets/d/e/2PACX-1vScqmMOmdB95tGFqkzzPMNUxnGdIum_bXFBhEvX8Xj-b0M3hZYCu8w8V9k7CgKvjHMCtnmj3Y3Vza0A/pub?gid=1227961915&single=true&output=csv';

let isGameDataLoaded = false;
let activeWeek = '';
let allGames = [];
let userPicks = {};
let doubleUpPicks = [];
let currentUser = null;
let initiallySavedPicks = new Set();

// =================================================================
// DOM ELEMENTS
// =================================================================
const signUpForm = document.getElementById('sign-up-form');
const loginForm = document.getElementById('login-form');
const userStatusDiv = document.getElementById('user-status');
const mainNav = document.getElementById('main-nav');
const pages = document.querySelectorAll('.page');
const gamesContainer = document.getElementById('games-container');
const savePicksBtn = document.getElementById('save-picks-btn');
const logo = document.getElementById('logo');

// =================================================================
// DATE & TIME LOGIC
// =================================================================
function getKickoffTimeAsDate(game) {
    if (!game || !game.Date || !game.Time) return null;
    const dateStr = game.Date.split(' ')[1];
    const timeStr = game.Time;
    const dateTimeString = `${dateStr} ${timeStr} EST`;
    return new Date(dateTimeString);
}

function determineCurrentWeek(games) {
    const now = new Date();
    const regularSeasonGames = games.filter(game => game.Week && game.Week.startsWith('Week '));
    if (regularSeasonGames.length === 0) return "No Regular Season Games Found";
    const sortedGames = [...regularSeasonGames].sort((a, b) => getKickoffTimeAsDate(a) - getKickoffTimeAsDate(b));
    const upcomingGame = sortedGames.find(game => getKickoffTimeAsDate(game) > now);
    if (upcomingGame) return upcomingGame.Week;
    return sortedGames[sortedGames.length - 1].Week;
}

// =================================================================
// AUTHENTICATION
// =================================================================
async function handleAuthStateChange(session) {
    if (session) {
        currentUser = session.user;
        updateUserStatusUI();
        await fetchDashboardData();
        const currentHash = window.location.hash.substring(1);
        if (currentHash && document.getElementById(currentHash + '-page')) {
            showPage(currentHash + '-page');
        } else {
            showPage('home-page');
        }
    } else {
        currentUser = null;
        updateUserStatusUI();
        showPage('auth-page');
    }
}

signUpForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const username = document.getElementById('sign-up-username').value;
    const email = document.getElementById('sign-up-email').value;
    const password = document.getElementById('sign-up-password').value;
    const { data, error } = await supabase.auth.signUp({ email, password, options: { data: { username } } });
    if (error) return alert('Error signing up: ' + error.message);
    const { error: profileError } = await supabase.from('profiles').insert([{ id: data.user.id, username: username, score: 0 }]);
    if (profileError) return alert('Error creating profile: ' + profileError.message);
    alert('Sign up successful! You can now log in.');
    signUpForm.reset();
});

loginForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const email = document.getElementById('login-email').value;
    const password = document.getElementById('login-password').value;
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) alert('Error logging in: ' + error.message);
});

async function logoutUser() {
    await supabase.auth.signOut();
    currentUser = null;
    handleAuthStateChange(null);
}

function updateUserStatusUI() {
    if (currentUser) {
        const username = currentUser?.user_metadata?.username || currentUser?.email;
        userStatusDiv.innerHTML = `<span>Welcome, ${username}</span><button id="logout-btn">Logout</button>`;
        mainNav.classList.remove('hidden');
    } else {
        userStatusDiv.innerHTML = `<a href="#auth" class="nav-link">Login / Sign Up</a>`;
        mainNav.classList.add('hidden');
    }
}

// =================================================================
// DASHBOARD & DATA FETCHING
// =================================================================
async function fetchDashboardData() {
    if (!currentUser) return;
    const { data: profile } = await supabase.from('profiles').select('score').eq('id', currentUser.id).single();
    const { data: picks } = await supabase.from('picks').select('*').eq('user_id', currentUser.id);
    renderDashboard(profile, picks);
}

async function fetchUserPicksForWeek(week) {
    if (!currentUser) return [];
    const { data: picks, error } = await supabase.from('picks').select('*').eq('user_id', currentUser.id).eq('week', week);
    if (error) {
        console.error('Error fetching picks for the week:', error);
        return [];
    }
    return picks;
}

function renderDashboard(profile, picks) {
    document.getElementById('user-score').textContent = profile?.score || 0;
    const historyBody = document.getElementById('pick-history-body');
    historyBody.innerHTML = '';
    if (!picks || picks.length === 0) {
        historyBody.innerHTML = '<tr><td colspan="4">You haven\'t made any picks yet.</td></tr>';
        return;
    }
    picks.forEach(pick => {
        const game = allGames.find(g => g['Game Id'] == pick.game_id);
        const gameName = game ? `${game['Away Display Name']} @ ${game['Home Display Name']}` : `Game ID: ${pick.game_id}`;
        const result = pick.is_correct === null ? 'Pending' : (pick.is_correct ? 'Correct' : 'Incorrect');
        const points = 'TBD';
        const doubleUpIndicator = pick.is_double_up ? ' 🔥' : '';
        const row = document.createElement('tr');
        row.innerHTML = `<td>${gameName} (${pick.week})</td><td>${pick.picked_team}${doubleUpIndicator}</td><td>${result}</td><td>${points}</td>`;
        historyBody.appendChild(row);
    });
}

async function renderScoreboard() {
    const scoreboardBody = document.getElementById('scoreboard-body');
    scoreboardBody.innerHTML = '<tr><td colspan="4">Loading scoreboard...</td></tr>';
    
    const matchId = 6; 

    const { data: scores, error } = await supabase.rpc('get_scoreboard_for_match', { p_match_id: matchId });

    if (error || !scores) {
        scoreboardBody.innerHTML = '<tr><td colspan="4">Could not load scoreboard data.</td></tr>';
        if (error) console.error("Error fetching scoreboard:", error);
        return;
    }

    if (scores.length === 0) {
        scoreboardBody.innerHTML = '<tr><td colspan="4">No members in this match yet.</td></tr>';
        return;
    }

    scoreboardBody.innerHTML = '';
    const moneyPerPoint = 5;

    scores.forEach((player, index) => {
        const rank = index + 1;
        let moneyOwed = '-';
        if (index > 0) {
            const personAbove = scores[index - 1];
            const pointDifference = personAbove.score - player.score;
            moneyOwed = `$${pointDifference * moneyPerPoint}`;
        }
        const row = document.createElement('tr');
        row.innerHTML = `<td>${rank}</td><td>${player.username}</td><td>${player.score}</td><td>${moneyOwed}</td>`;
        scoreboardBody.appendChild(row);
    });
}

// =================================================================
// MATCHES LOGIC (CREATE, VIEW, JOIN)
// =================================================================
const showCreateMatchPageBtn = document.getElementById('show-create-match-page-btn');
const createMatchForm = document.getElementById('create-match-form');
const cancelCreateMatchBtn = document.getElementById('cancel-create-match-btn');

if (showCreateMatchPageBtn) showCreateMatchPageBtn.addEventListener('click', () => showPage('create-match-page'));
if (cancelCreateMatchBtn) cancelCreateMatchBtn.addEventListener('click', () => showPage('matches-page'));

async function renderMatchesPage() {
    const container = document.getElementById('matches-list-container');
    container.innerHTML = '<p>Loading public matches...</p>';

    // 1. Get the list of IDs for matches the current user is already in
    const { data: userMemberships, error: memberError } = await supabase
        .from('match_members')
        .select('match_id')
        .eq('user_id', currentUser.id);

    if (memberError) {
        console.error("Error fetching user memberships:", memberError);
        // We can still proceed, but the join buttons might not hide correctly
    }
    const joinedMatchIds = new Set(userMemberships.map(m => m.match_id));

    // 2. Get all public matches
    const { data: matches, error } = await supabase
        .from('matches')
        .select('id, name, created_by, profiles ( username )')
        .eq('is_public', true);

    if (error) {
        console.error("Error fetching matches:", error);
        container.innerHTML = '<p>Could not load matches.</p>';
        return;
    }

    if (matches.length === 0) {
        container.innerHTML = '<p>No public matches found. Why not create one?</p>';
        return;
    }

    container.innerHTML = '';
    matches.forEach(match => {
        const card = document.createElement('div');
        card.className = 'card';

        // 3. Decide whether to show the "Join" button or a "Joined" message
        let buttonOrMessage;
        if (joinedMatchIds.has(match.id)) {
            // If the user is a member, show a disabled "Joined" button
            buttonOrMessage = `<button class="join-match-btn" disabled style="background-color: #666;">Joined</button>`;
        } else {
            // Otherwise, show the active "Join Match" button
            buttonOrMessage = `<button class="join-match-btn" data-match-id="${match.id}" data-match-name="${match.name}">Join Match</button>`;
        }

        card.innerHTML = `
            <h3>${match.name}</h3>
            <p>Created by: ${match.profiles.username || 'A user'}</p>
            ${buttonOrMessage}
        `;
        container.appendChild(card);
    });
}
createMatchForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!currentUser) return alert("You must be logged in to create a match.");
    const matchData = {
        name: document.getElementById('create-match-name').value,
        password: document.getElementById('create-match-password').value,
        is_public: document.getElementById('create-match-public').checked,
        win_value: parseInt(document.getElementById('create-win-value').value),
        loss_value: parseInt(document.getElementById('create-loss-value').value),
        min_picks_per_week: parseInt(document.getElementById('create-min-picks').value),
        max_double_ups_per_week: parseInt(document.getElementById('create-max-doubles').value),
        shit_pick_enabled: document.getElementById('create-shit-pick-enabled').checked,
        shit_pick_value: parseInt(document.getElementById('create-shit-pick-value').value),
        created_by: currentUser.id
    };
    const { data: newMatch, error: createMatchError } = await supabase.from('matches').insert(matchData).select().single();
    if (createMatchError) {
        console.error("Error creating match:", createMatchError);
        return alert("Failed to create match: " + createMatchError.message);
    }
    const { error: joinError } = await supabase.from('match_members').insert({ match_id: newMatch.id, user_id: currentUser.id });
    if (joinError) {
        console.error("Error adding creator to match:", joinError);
        return alert("Match created, but failed to add you as a member. Please try joining manually.");
    }
    alert(`Successfully created the match "${newMatch.name}"!`);
    showPage('matches-page');
});

document.getElementById('matches-list-container').addEventListener('click', async (e) => {
    if (e.target.classList.contains('join-match-btn')) {
        if (!currentUser) return alert("You must be logged in to join a match.");
        const matchId = e.target.dataset.matchId;
        const matchName = e.target.dataset.matchName;
        const password = prompt(`Enter the password to join "${matchName}":`);
        if (password === null) return;
        const { error } = await supabase.rpc('join_match', { p_match_id: matchId, p_password: password });
        if (error) {
            console.error("Error joining match:", error);
            alert("Failed to join match: " + error.message);
        } else {
            alert(`Successfully joined "${matchName}"!`);
        }
    }
});

// =================================================================
// PAGE NAVIGATION & PICKS LOGIC
// =================================================================
function showPage(pageId) {
    if (pageId !== 'auth-page' && !currentUser) {
        showPage('auth-page');
        return;
    }
    pages.forEach(page => page.classList.remove('active'));
    const activePage = document.getElementById(pageId);
    if (activePage) activePage.classList.add('active');
    if (pageId === 'picks-page') renderGames();
    if (pageId === 'matches-page') renderMatchesPage();
    if (pageId === 'scoreboard-page') renderScoreboard();
}

document.addEventListener('click', (e) => {
    if (e.target.closest('#logout-btn')) {
        e.preventDefault();
        logoutUser();
        return;
    }
    const navLink = e.target.closest('.nav-link');
    if (navLink && navLink.closest('header')) {
        e.preventDefault();
        const pageId = navLink.getAttribute('href').substring(1) + '-page';
        showPage(pageId);
    }
    if (e.target.closest('#logo')) {
        if (currentUser) {
            showPage('home-page');
        } else {
            showPage('auth-page');
        }
    }
});

async function fetchGameData() {
    try {
        const response = await fetch(SHEET_URL);
        if (!response.ok) throw new Error('Network response was not ok');
        const csvText = await response.text();
        allGames = parseCSV(csvText);
    } catch (error) {
        console.error('Failed to fetch game data:', error);
    }
}

function parseCSV(csvText) {
    const lines = csvText.trim().split('\n');
    if (lines.length < 2) return [];
    const headers = lines[0].split(',').map(h => h.trim());
    return lines.slice(1).map(line => {
        const values = line.split(',');
        const game = {};
        headers.forEach((header, index) => {
            let value = values[index] || '';
            value = value.replace(/^"|"$/g, '').trim();
            game[header] = value;
        });
        return game;
    });
}

async function renderGames() {
    if (!isGameDataLoaded) {
        gamesContainer.innerHTML = '<p>Loading live game data...</p>';
        return;
    }
    const savedPicks = await fetchUserPicksForWeek(activeWeek);
    userPicks = {};
    doubleUpPicks = [];
    initiallySavedPicks = new Set();
    gamesContainer.innerHTML = '';
    const weeklyGames = allGames.filter(game => game.Week === activeWeek);
    document.getElementById('picks-page-title').textContent = `${activeWeek} Picks`;
    if (weeklyGames.length === 0) {
        gamesContainer.innerHTML = `<p>No games found for ${activeWeek}.</p>`;
        return;
    }
    const now = new Date();
    weeklyGames.forEach(game => {
        const gameId = game['Game Id'];
        const savedPick = savedPicks.find(p => p.game_id == gameId);
        if (savedPick) {
            initiallySavedPicks.add(gameId);
            userPicks[gameId] = savedPick.picked_team;
            if (savedPick.is_double_up) doubleUpPicks.push(gameId);
        }
        const gameCard = document.createElement('div');
        gameCard.className = 'game-card';
        gameCard.dataset.gameId = gameId;
        if (getKickoffTimeAsDate(game) < now) gameCard.classList.add('locked');
        const awayName = game['Away Display Name'] || 'Team';
        const homeName = game['Home Display Name'] || 'Team';
        gameCard.innerHTML = `<div class="team" data-team-name="${awayName}"><img src="${game['Away Logo'] || ''}" alt="${awayName}"><span class="team-name">${awayName}</span></div><div class="game-separator">@</div><div class="team" data-team-name="${homeName}"><img src="${game['Home Logo'] || ''}" alt="${homeName}"><span class="team-name">${homeName}</span></div><div class="game-info">${getKickoffTimeAsDate(game).toLocaleString('en-US', { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}</div><div class="double-up-container"><button class="double-up-btn" disabled>Double Up</button></div>`;
        const doubleUpBtn = gameCard.querySelector('.double-up-btn');
        if (userPicks[gameId]) {
            const selectedTeamEl = gameCard.querySelector(`.team[data-team-name="${userPicks[gameId]}"]`);
            if (selectedTeamEl) {
                selectedTeamEl.classList.add('selected');
                doubleUpBtn.disabled = false;
                const savedIcon = document.createElement('div');
                savedIcon.className = 'saved-indicator';
                savedIcon.title = 'Your pick is saved';
                selectedTeamEl.appendChild(savedIcon);
            }
        }
        if (doubleUpPicks.includes(gameId)) doubleUpBtn.classList.add('selected');
        gamesContainer.appendChild(gameCard);
    });
    addGameCardEventListeners();
}

function addGameCardEventListeners() {
    document.querySelectorAll('.game-card').forEach(card => {
        const gameId = card.dataset.gameId;
        const doubleUpBtn = card.querySelector('.double-up-btn');
        card.querySelectorAll('.team').forEach(team => {
            team.addEventListener('click', (e) => {
                const clickedTeam = e.currentTarget;
                const wasAlreadySelected = clickedTeam.classList.contains('selected');
                card.querySelectorAll('.team').forEach(t => t.classList.remove('selected'));
                const existingIcon = card.querySelector('.saved-indicator');
                if (existingIcon) existingIcon.remove();
                if (wasAlreadySelected) {
                    userPicks[gameId] = undefined;
                    doubleUpBtn.disabled = true;
                    doubleUpBtn.classList.remove('selected');
                    doubleUpPicks = doubleUpPicks.filter(id => id !== gameId);
                } else {
                    clickedTeam.classList.add('selected');
                    userPicks[gameId] = clickedTeam.dataset.teamName;
                    doubleUpBtn.disabled = false;
                }
            });
        });
        doubleUpBtn.addEventListener('click', (e) => {
            const clickedButton = e.currentTarget;
            clickedButton.classList.toggle('selected');
            if (clickedButton.classList.contains('selected')) {
                if (!doubleUpPicks.includes(gameId)) doubleUpPicks.push(gameId);
            } else {
                doubleUpPicks = doubleUpPicks.filter(id => id !== gameId);
            }
        });
    });
}

savePicksBtn.addEventListener('click', async () => {
    if (!currentUser) return alert('You must be logged in to save picks!');
    const validPicksCount = Object.values(userPicks).filter(pick => pick !== undefined).length;
    if (validPicksCount < 3) {
        return alert('You must make at least 3 picks before saving.');
    }
    const now = new Date();
    for (const gameId in userPicks) {
        if (userPicks[gameId]) {
            const game = allGames.find(g => g['Game Id'] == gameId);
            if (getKickoffTimeAsDate(game) < now) { return alert(`Too late! Game locked.`); }
        }
    }
    const picksToUpsert = Object.keys(userPicks).filter(gameId => userPicks[gameId] !== undefined).map(gameId => ({
        user_id: currentUser.id,
        game_id: parseInt(gameId),
        picked_team: userPicks[gameId],
        is_double_up: doubleUpPicks.includes(gameId),
        week: activeWeek
    }));
    const picksToDelete = [];
    for (const gameId of initiallySavedPicks) {
        if (userPicks[gameId] === undefined) {
            picksToDelete.push(parseInt(gameId));
        }
    }
    try {
        if (picksToUpsert.length > 0) {
            const { error: upsertError } = await supabase.from('picks').upsert(picksToUpsert, { onConflict: 'user_id, game_id' });
            if (upsertError) throw upsertError;
        }
        if (picksToDelete.length > 0) {
            const { error: deleteError } = await supabase.from('picks').delete().eq('user_id', currentUser.id).in('game_id', picksToDelete);
            if (deleteError) throw deleteError;
        }
        alert('Your picks have been saved!');
        await fetchDashboardData();
        renderGames();
    } catch (error) {
        console.error('Error saving picks:', error);
        alert('Error saving picks: ' + error.message);
    }
});

// =================================================================
// INITIALIZE APP
// =================================================================
async function init() {
    supabase.auth.onAuthStateChange((event, session) => {
        if (event === 'SIGNED_IN' || event === 'SIGNED_OUT') {
            handleAuthStateChange(session);
        }
    });
    await fetchGameData();
    activeWeek = determineCurrentWeek(allGames);
    isGameDataLoaded = true;
    const { data: { session } } = await supabase.auth.getSession();
    handleAuthStateChange(session);
}

init();
