// =================================================================
// CONFIGURATION & INITIALIZATION
// =================================================================

const SUPABASE_URL = 'https://mtjflkwoxjnwaawjlaxy.supabase.co'; 
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im10amZsa3dveGpud2Fhd2psYXh5Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTU3MDY1MzQsImV4cCI6MjA3MTI4MjUzNH0.PflqgxXG3kISTpp7nUNCXiBn-Ue3kvKNIS2yV1oz-jg';
const supabase = self.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
const SHEET_URL = 'https://docs.google.com/spreadsheets/d/e/2PACX-1vScqmMOmdB95tGFqkzzPMNUxnGdIum_bXFBhEvX8Xj-b0M3hZYCu8w8V9k7CgKvjHMCtnmj3Y3Vza0A/pub?gid=1227961915&single=true&output=csv';

// --- STATE MANAGEMENT ---
let isGameDataLoaded = false;
let activeWeek = '';
let allGames = [];
let userPicks = {};
let userWagers = {};
let doubleUpPick = null;
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
// AUTHENTICATION & UI MANAGEMENT
// =================================================================
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

function showPage(pageId) {
    pages.forEach(page => page.classList.remove('active'));
    const activePage = document.getElementById(pageId);
    if (activePage) {
        activePage.classList.add('active');
    }
    if (pageId === 'picks-page') renderGames();
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
}

// =================================================================
// DATA FETCHING & RENDERING
// =================================================================

// --- THIS FUNCTION WAS MISSING ---
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

// --- THIS HELPER FUNCTION WAS ALSO MISSING ---
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


async function fetchDashboardData() {
    if (!currentUser) return;
    const { data: profile } = await supabase.from('profiles').select('score').eq('id', currentUser.id).single();
    const { data: picks } = await supabase.from('picks').select('*').eq('user_id', currentUser.id);
    renderDashboard(profile, picks);
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
        const wagerIndicator = pick.wager ? ` (${pick.wager} pts)` : '';
        const row = document.createElement('tr');
        row.innerHTML = `<td>${gameName} (${pick.week})</td><td>${pick.picked_team}${wagerIndicator}${doubleUpIndicator}</td><td>${result}</td><td>${points}</td>`;
        historyBody.appendChild(row);
    });
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

async function renderGames() {
    if (!isGameDataLoaded) {
        gamesContainer.innerHTML = '<p>Loading live game data...</p>';
        return;
    }
    const savedPicks = await fetchUserPicksForWeek(activeWeek);
    userPicks = {};
    userWagers = {};
    doubleUpPick = null;
    initiallySavedPicks.clear();
    
    gamesContainer.innerHTML = '';
    const weeklyGames = allGames.filter(game => game.Week === activeWeek);
    document.getElementById('picks-page-title').textContent = `${activeWeek} Picks`;
    
    weeklyGames.forEach(game => {
        const gameId = game['Game Id'];
        const savedPick = savedPicks.find(p => p.game_id == gameId);

        if (savedPick) {
            initiallySavedPicks.add(gameId);
            userPicks[gameId] = savedPick.picked_team;
            if (savedPick.wager) userWagers[gameId] = savedPick.wager;
            if (savedPick.is_double_up) doubleUpPick = gameId;
        }

        const gameCard = document.createElement('div');
        gameCard.className = 'game-card';
        gameCard.dataset.gameId = gameId;
        const awayName = game['Away Display Name'] || 'Team';
        const homeName = game['Home Display Name'] || 'Team';

        gameCard.innerHTML = `
            <div class="team" data-team-name="${awayName}"><img src="${game['Away Logo'] || ''}" alt="${awayName}"><span class="team-name">${awayName}</span></div>
            <div class="game-separator">@</div>
            <div class="team" data-team-name="${homeName}"><img src="${game['Home Logo'] || ''}" alt="${homeName}"><span class="team-name">${homeName}</span></div>
            <div class="game-info">${getKickoffTimeAsDate(game).toLocaleString('en-US', { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}</div>
            <div class="wager-controls">
                <div class="wager-options">
                    <span>Wager:</span>
                    <button class="wager-btn" data-value="1">1</button>
                    <button class="wager-btn" data-value="2">2</button>
                    <button class="wager-btn" data-value="3">3</button>
                    <button class="wager-btn" data-value="4">4</button>
                    <button class="wager-btn" data-value="5">5</button>
                </div>
                <div class="double-up-container">
                    <button class="double-up-btn">2x Double Up</button>
                </div>
            </div>
        `;
        gamesContainer.appendChild(gameCard);

        if (userPicks[gameId]) {
            gameCard.querySelector(`.team[data-team-name="${userPicks[gameId]}"]`)?.classList.add('selected');
        }
        if (userWagers[gameId]) {
            gameCard.querySelector(`.wager-btn[data-value="${userWagers[gameId]}"]`)?.classList.add('selected');
        }
        if (doubleUpPick === gameId) {
            gameCard.querySelector('.double-up-btn').classList.add('selected');
        }
    });

    addGameCardEventListeners();
}

function addGameCardEventListeners() {
    const allDoubleUpBtns = document.querySelectorAll('.double-up-btn');
    document.querySelectorAll('.game-card').forEach(card => {
        const gameId = card.dataset.gameId;
        const wagerBtns = card.querySelectorAll('.wager-btn');
        const doubleUpBtn = card.querySelector('.double-up-btn');

        card.querySelectorAll('.team').forEach(team => {
            team.addEventListener('click', () => {
                const wasSelected = team.classList.contains('selected');
                card.querySelectorAll('.team').forEach(t => t.classList.remove('selected'));
                if (!wasSelected) {
                    team.classList.add('selected');
                    userPicks[gameId] = team.dataset.teamName;
                } else {
                    userPicks[gameId] = undefined;
                    wagerBtns.forEach(btn => btn.classList.remove('selected'));
                    userWagers[gameId] = undefined;
                    if (doubleUpPick === gameId) {
                        doubleUpBtn.classList.remove('selected');
                        doubleUpPick = null;
                    }
                }
            });
        });

        wagerBtns.forEach(btn => {
            btn.addEventListener('click', () => {
                if (!userPicks[gameId]) return alert("Please select a team before placing a wager.");
                wagerBtns.forEach(b => b.classList.remove('selected'));
                btn.classList.add('selected');
                userWagers[gameId] = parseInt(btn.dataset.value);
            });
        });

        doubleUpBtn.addEventListener('click', () => {
            if (!userPicks[gameId]) return alert("Please select a team before using your Double Up.");
            const wasSelected = doubleUpBtn.classList.contains('selected');
            allDoubleUpBtns.forEach(btn => btn.classList.remove('selected'));
            if (!wasSelected) {
                doubleUpBtn.classList.add('selected');
                doubleUpPick = gameId;
            } else {
                doubleUpPick = null;
            }
        });
    });
}

savePicksBtn.addEventListener('click', async () => {
    if (!currentUser) return alert('You must be logged in!');
    
    try {
        const picksToUpsert = Object.keys(userPicks)
            .filter(gameId => userPicks[gameId] !== undefined)
            .map(gameId => {
                if (!userWagers[gameId]) {
                    const game = allGames.find(g => g['Game Id'] == gameId);
                    throw new Error(`You must place a wager for the ${game['Away Display Name']} @ ${game['Home Display Name']} game.`);
                }
                return {
                    user_id: currentUser.id,
                    game_id: parseInt(gameId),
                    picked_team: userPicks[gameId],
                    wager: userWagers[gameId],
                    is_double_up: gameId === doubleUpPick,
                    week: activeWeek
                };
            });
        
        const picksToDelete = [];
        for (const gameId of initiallySavedPicks) {
            if (userPicks[gameId] === undefined) {
                picksToDelete.push(parseInt(gameId));
            }
        }

        if (picksToUpsert.length > 0) {
            const { error } = await supabase.from('picks').upsert(picksToUpsert, { onConflict: 'user_id, game_id' });
            if (error) throw error;
        }
        if (picksToDelete.length > 0) {
            const { error } = await supabase.from('picks').delete().eq('user_id', currentUser.id).in('game_id', picksToDelete);
            if (error) throw error;
        }

        alert('Your picks have been saved!');
        await fetchDashboardData();
        renderGames();

    } catch (error) {
        console.error("Save Picks Error:", error);
        alert(error.message);
    }
});

// =================================================================
// INITIALIZE APP
// =================================================================
async function init() {
    await fetchGameData();
    activeWeek = determineCurrentWeek(allGames);
    isGameDataLoaded = true;

    supabase.auth.onAuthStateChange(async (event, session) => {
        if (session) {
            currentUser = session.user;
            await fetchDashboardData();
            updateUserStatusUI();
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
    });

    document.addEventListener('click', (e) => {
        if (e.target.closest('#logout-btn')) {
            e.preventDefault();
            logoutUser();
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
}

init();
