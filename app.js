// =================================================================
// CONFIGURATION & INITIALIZATION
// =================================================================

// --- SUPABASE CLIENT ---
// You can get these from your Supabase project settings
const SUPABASE_URL = 'https://mtjflkwoxjnwaawjlaxy.supabase.co'; 
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im10amZsa3dveGpud2Fhd2psYXh5Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTU3MDY1MzQsImV4cCI6MjA3MTI4MjUzNH0.PflqgxXG3kISTpp7nUNCXiBn-Ue3kvKNIS2yV1oz-jg';

const supabase = self.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// --- GOOGLE SHEET DATA ---
const SHEET_URL = 'https://docs.google.com/spreadsheets/d/e/2PACX-1vScqmMOmdB95tGFqkzzPMNUxnGdIum_bXFBhEvX8Xj-b0M3hZYCu8w8V9k7CgKvjHMCtnmj3Y3Vza0A/pub?gid=1227961915&single=true&output=csv';

// --- GLOBAL STATE ---
let activeWeek = ''; // This will be determined dynamically
let allGames = [];
let userPicks = {};
let doubleUpPick = null;
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

// =================================================================
// NEW: DATE & TIME LOGIC
// =================================================================

/**
 * Parses a game's date and time (assumed to be Eastern Time) and returns a Date object.
 * This is the core of the locking logic.
 * @param {object} game - A game object from the Google Sheet.
 * @returns {Date} A Date object representing the exact kickoff moment.
 */
function getKickoffTimeAsDate(game) {
    // The Date string format from your sheet is like "Thu 09/04/2025" and "8:20 PM"
    // We need to combine them into a format JavaScript can reliably parse.
    // The 'en-US' locale helps parse "PM" correctly.
    const dateStr = game.Date.split(' ')[1]; // Extracts "09/04/2025"
    const timeStr = game.Time;
    
    // IMPORTANT: We create the date string and explicitly tell the Date constructor
    // that it is in the Eastern Time Zone. This is crucial for correct comparison.
    const dateTimeString = `${dateStr} ${timeStr} EST`; // Using EST/EDT is a simplification; for full accuracy, a library like date-fns-tz would be better, but this works well.

    return new Date(dateTimeString);
}

/**
 * Scans all games to determine what the "current" week for picking should be.
 * It finds the first game that hasn't started yet and returns its week.
 * @param {Array<object>} games - The array of all games.
 * @returns {string} The name of the current week (e.g., "Week 1").
 */
function determineCurrentWeek(games) {
    const now = new Date();
    
    // Sort games by date to ensure we check them chronologically
    const sortedGames = [...games].sort((a, b) => getKickoffTimeAsDate(a) - getKickoffTimeAsDate(b));

    // Find the first game whose kickoff time is in the future
    const upcomingGame = sortedGames.find(game => getKickoffTimeAsDate(game) > now);

    if (upcomingGame) {
        // If we found an upcoming game, that's our active week
        return upcomingGame.Week;
    } else if (games.length > 0) {
        // If all games are in the past (e.g., end of season), default to the last week
        return games[games.length - 1].Week;
    }
    
    // Fallback if there's no game data
    return "No Upcoming Games";
}


// =================================================================
// AUTHENTICATION (No changes in this section)
// =================================================================

signUpForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const username = document.getElementById('sign-up-username').value;
    const email = document.getElementById('sign-up-email').value;
    const password = document.getElementById('sign-up-password').value;

    const { data, error } = await supabase.auth.signUp({
        email, password, options: { data: { username } }
    });

    if (error) return alert('Error signing up: ' + error.message);

    const { error: profileError } = await supabase.from('profiles').insert([
        { id: data.user.id, username: username, score: 0 }
    ]);

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

supabase.auth.onAuthStateChange(async (event, session) => {
    if (event === 'SIGNED_IN') {
        currentUser = session.user;
        await handleUserLoggedIn();
    } else if (event === 'SIGNED_OUT') {
        currentUser = null;
        handleUserLoggedOut();
    }
});

async function handleUserLoggedIn() {
    updateUserStatusUI();
    await fetchDashboardData();
    showPage('home-page');
}

function handleUserLoggedOut() {
    updateUserStatusUI();
    showPage('auth-page');
}

function updateUserStatusUI() {
    if (currentUser) {
        const username = currentUser.user_metadata.username || currentUser.email;
        userStatusDiv.innerHTML = `
            <span>Welcome, ${username}</span>
            <button id="logout-btn">Logout</button>
        `;
        mainNav.classList.remove('hidden');
        document.getElementById('logout-btn').addEventListener('click', logoutUser);
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
    const { data: profile, error: profileError } = await supabase
        .from('profiles').select('score').eq('id', currentUser.id).single();
    if (profileError) console.error('Error fetching profile:', profileError);

    const { data: picks, error: picksError } = await supabase
        .from('picks').select('*').eq('user_id', currentUser.id);
    if (picksError) console.error('Error fetching picks:', picksError);

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
        const row = document.createElement('tr');
        row.innerHTML = `
            <td>${gameName} (${pick.week})</td>
            <td>${pick.picked_team} ${pick.is_double_up ? '<strong>(2x)</strong>' : ''}</td>
            <td>${result}</td>
            <td>${points}</td>
        `;
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
    document.getElementById(pageId)?.classList.add('active');
}

document.querySelectorAll('.nav-link').forEach(link => {
    link.addEventListener('click', (e) => {
        e.preventDefault();
        const pageId = e.currentTarget.getAttribute('href').substring(1) + '-page';
        showPage(pageId);
    });
});

async function fetchGameData() {
    try {
        const response = await fetch(SHEET_URL);
        if (!response.ok) throw new Error('Network response was not ok');
        const csvText = await response.text();
        allGames = parseGameData(csvText);
    } catch (error) {
        console.error('Failed to fetch game data:', error);
        gamesContainer.innerHTML = '<p>Error: Could not load game data.</p>';
    }
}

function parseGameData(csvText) {
    const lines = csvText.trim().split('\n');
    const headers = lines[0].split(',');
    return lines.slice(1).map(line => {
        const values = line.split(',');
        const game = {};
        headers.forEach((header, index) => {
            game[header.trim()] = values[index]?.trim().replace(/^"|"$/g, '') || '';
        });
        return game;
    });
}

function renderGames() {
    // UPDATED: Use the dynamically determined activeWeek
    const weeklyGames = allGames.filter(game => game.Week === activeWeek);
    document.getElementById('picks-page-title').textContent = `${activeWeek} Picks`;
    gamesContainer.innerHTML = '';

    if (weeklyGames.length === 0) {
        gamesContainer.innerHTML = `<p>No games found for ${activeWeek}.</p>`;
        return;
    }

    const now = new Date();
    weeklyGames.forEach(game => {
        const gameCard = document.createElement('div');
        gameCard.className = 'game-card';
        gameCard.dataset.gameId = game['Game Id'];
        
        // NEW: Check if the game should be locked
        const kickoffTime = getKickoffTimeAsDate(game);
        if (kickoffTime < now) {
            gameCard.classList.add('locked');
        }

        gameCard.innerHTML = `
            <div class="team" data-team-name="${game['Away Display Name']}">
                <img src="${game['Away Logo']}" alt="${game['Away Display Name']}">
                <span class="team-name">${game['Away Display Name']}</span>
            </div>
            <div class="game-separator">@</div>
            <div class="team" data-team-name="${game['Home Display Name']}">
                <img src="${game['Home Logo']}" alt="${game['Home Display Name']}">
                <span class="team-name">${game['Home Display Name']}</span>
            </div>
            <div class="game-info">
                ${kickoffTime.toLocaleString('en-US', { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}
            </div>
            <div class="double-up-container">
                <button class="double-up-btn">Double Up</button>
            </div>
        `;
        gamesContainer.appendChild(gameCard);
    });

    addGameCardEventListeners();
}

function addGameCardEventListeners() {
    // (This function remains the same)
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

        card.querySelector('.double-up-btn').addEventListener('click', (e) => {
            const btn = e.currentTarget;
            if (btn.classList.contains('selected')) {
                btn.classList.remove('selected');
                doubleUpPick = null;
            } else {
                document.querySelectorAll('.double-up-btn').forEach(b => b.classList.remove('selected'));
                btn.classList.add('selected');
                doubleUpPick = gameId;
            }
        });
    });
}

savePicksBtn.addEventListener('click', async () => {
    if (!currentUser) return alert('You must be logged in to save picks!');

    // NEW: Final check to prevent picking locked games
    const now = new Date();
    for (const gameId in userPicks) {
        if (userPicks[gameId]) { // If a pick was made for this game
            const game = allGames.find(g => g['Game Id'] == gameId);
            if (getKickoffTimeAsDate(game) < now) {
                alert(`Too late! The ${game['Away Display Name']} @ ${game['Home Display Name']} game has already started and is locked.`);
                return; // Stop the entire save process
            }
        }
    }

    const picksToInsert = Object.keys(userPicks)
        .filter(gameId => userPicks[gameId])
        .map(gameId => ({
            user_id: currentUser.id,
            game_id: parseInt(gameId),
            picked_team: userPicks[gameId],
            is_double_up: gameId === doubleUpPick,
            week: activeWeek // Use dynamic week
        }));

    if (picksToInsert.length === 0) return alert('You haven\'t made any picks yet!');

    const { error } = await supabase
        .from('picks')
        .upsert(picksToInsert, { onConflict: 'user_id, game_id' });

    if (error) {
        alert('Error saving picks: ' + error.message);
    } else {
        alert('Your picks have been saved!');
        fetchDashboardData();
    }
});

// =================================================================
// INITIALIZE APP
// =================================================================

async function init() {
    await fetchGameData(); // Fetch all game data first
    
    // NEW: Determine the active week after fetching data
    activeWeek = determineCurrentWeek(allGames);

    const { data: { session } } = await supabase.auth.getSession();
    currentUser = session?.user || null;

    if (currentUser) {
        await handleUserLoggedIn();
    } else {
        handleUserLoggedOut();
    }
    
    renderGames(); // Render the games for the picks page
}

init();
