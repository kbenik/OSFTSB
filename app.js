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
// --- MODIFIED: Changed from a single value to an array to support multiple double-ups ---
let doubleUpPicks = []; 
let currentUser = null;

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
        if (currentHash === 'picks') {
            showPage('picks-page');
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
        userStatusDiv.innerHTML = `
            <span>Welcome, ${username}</span>
            <button id="logout-btn">Logout</button>
        `;
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
        const row = document.createElement('tr');
        row.innerHTML = `<td>${gameName} (${pick.week})</td><td>${pick.picked_team} ${pick.is_double_up ? '<strong>(2x)</strong>' : ''}</td><td>${result}</td><td>${points}</td>`;
        historyBody.appendChild(row);
    });
}

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
    if (pageId === 'picks-page') {
        renderGames();
    }
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
    // --- MODIFIED: Reset the array for pre-population ---
    doubleUpPicks = [];

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
        const gameCard = document.createElement('div');
        gameCard.className = 'game-card';
        gameCard.dataset.gameId = gameId;
        const kickoffTime = getKickoffTimeAsDate(game);
        if (kickoffTime < now) gameCard.classList.add('locked');
        const awayLogo = game['Away Logo'] || '';
        const homeLogo = game['Home Logo'] || '';
        const awayName = game['Away Display Name'] || 'Team';
        const homeName = game['Home Display Name'] || 'Team';
        gameCard.innerHTML = `
            <div class="team" data-team-name="${awayName}"><img src="${awayLogo}" alt="${awayName}"><span class="team-name">${awayName}</span></div>
            <div class="game-separator">@</div>
            <div class="team" data-team-name="${homeName}"><img src="${homeLogo}" alt="${homeName}"><span class="team-name">${homeName}</span></div>
            <div class="game-info">${kickoffTime.toLocaleString('en-US', { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}</div>
            <div class="double-up-container"><button class="double-up-btn">Double Up</button></div>
        `;
        gamesContainer.appendChild(gameCard);

        if (savedPick) {
            const selectedTeamEl = gameCard.querySelector(`.team[data-team-name="${savedPick.picked_team}"]`);
            if (selectedTeamEl) {
                selectedTeamEl.classList.add('selected');
                const savedIcon = document.createElement('div');
                savedIcon.className = 'saved-indicator';
                savedIcon.title = 'Your pick is saved';
                selectedTeamEl.appendChild(savedIcon);
                userPicks[gameId] = savedPick.picked_team;
            }
            if (savedPick.is_double_up) {
                gameCard.querySelector('.double-up-btn').classList.add('selected');
                // --- MODIFIED: Add the game ID to the doubleUpPicks array ---
                doubleUpPicks.push(gameId);
            }
        }
    });
    addGameCardEventListeners();
}

function addGameCardEventListeners() {
    document.querySelectorAll('.game-card').forEach(card => {
        const gameId = card.dataset.gameId;
        card.querySelectorAll('.team').forEach(team => {
            team.addEventListener('click', () => {
                const otherTeam = team.parentElement.querySelector('.team:not([data-team-name="' + team.dataset.teamName + '"])');
                otherTeam.classList.remove('selected');
                team.classList.toggle('selected');
                userPicks[gameId] = team.classList.contains('selected') ? team.dataset.teamName : undefined;
            });
        });

        // --- NEW LOGIC: Toggle behavior for multiple double-up selections ---
        card.querySelector('.double-up-btn').addEventListener('click', (e) => {
            const clickedButton = e.currentTarget;
            const gameId = card.dataset.gameId;

            // Toggle the visual 'selected' state of the button
            clickedButton.classList.toggle('selected');

            if (clickedButton.classList.contains('selected')) {
                // If it's now selected, add it to our array
                if (!doubleUpPicks.includes(gameId)) {
                    doubleUpPicks.push(gameId);
                }
            } else {
                // If it's now unselected, remove it from our array
                doubleUpPicks = doubleUpPicks.filter(id => id !== gameId);
            }
        });
    });
}

savePicksBtn.addEventListener('click', async () => {
    if (!currentUser) return alert('You must be logged in to save picks!');

    // --- NEW LOGIC: Validation for a minimum of 3 picks ---
    const validPicksCount = Object.values(userPicks).filter(pick => pick !== undefined).length;
    if (validPicksCount < 3) {
        return alert('You must make at least 3 picks before saving.');
    }
    
    const now = new Date();
    for (const gameId in userPicks) {
        if (userPicks[gameId]) {
            const game = allGames.find(g => g['Game Id'] == gameId);
            if (getKickoffTimeAsDate(game) < now) { return alert(`Too late! The ${game['Away Display Name']} @ ${game['Home Display Name']} game has already started and is locked.`); }
        }
    }
    const picksToInsert = Object.keys(userPicks).filter(gameId => userPicks[gameId]).map(gameId => ({
        user_id: currentUser.id,
        game_id: parseInt(gameId),
        picked_team: userPicks[gameId],
        // --- MODIFIED: Check if the gameId is in our new array ---
        is_double_up: doubleUpPicks.includes(gameId),
        week: activeWeek
    }));
    if (picksToInsert.length === 0) return alert('You haven\'t made any picks yet!');
    
    const { error } = await supabase.from('picks').upsert(picksToInsert, { onConflict: 'user_id, game_id' });
    if (error) {
        console.error('Error saving picks:', error);
        alert('Error saving picks: ' + error.message);
    } else {
        alert('Your picks have been saved!');
        await fetchDashboardData();
        renderGames();
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
