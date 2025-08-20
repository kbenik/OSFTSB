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
const CURRENT_WEEK = 'Week 1'; // The week to display games for
let allGames = []; // Will hold all games fetched from the sheet
let userPicks = {}; // { gameID: 'teamName' }
let doubleUpPick = null; // gameID
let currentUser = null; // Will hold the logged-in user's data

// =================================================================
// AUTHENTICATION
// =================================================================

const signUpForm = document.getElementById('sign-up-form');
const loginForm = document.getElementById('login-form');
const userStatusDiv = document.getElementById('user-status');

// Sign Up
signUpForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const username = document.getElementById('sign-up-username').value;
    const email = document.getElementById('sign-up-email').value;
    const password = document.getElementById('sign-up-password').value;

    const { data, error } = await supabase.auth.signUp({
        email: email,
        password: password,
        options: {
            data: { username: username } // Add username to user metadata
        }
    });

    if (error) {
        alert('Error signing up: ' + error.message);
    } else {
        // Also insert into public.profiles table
        const { error: profileError } = await supabase.from('profiles').insert([
            { id: data.user.id, username: username }
        ]);
        if (profileError) {
            alert('Error creating profile: ' + profileError.message);
        } else {
            alert('Sign up successful! Please check your email to confirm.');
        }
    }
});

// Login
loginForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const email = document.getElementById('login-email').value;
    const password = document.getElementById('login-password').value;

    const { error } = await supabase.auth.signInWithPassword({ email, password });

    if (error) {
        alert('Error logging in: ' + error.message);
    } else {
        // The onAuthStateChange listener will handle the UI update
        alert('Login successful!');
    }
});

// Logout
async function logoutUser() {
    await supabase.auth.signOut();
    // The onAuthStateChange listener will handle the UI update
}

// Listen for auth state changes (login, logout)
supabase.auth.onAuthStateChange((event, session) => {
    if (event === 'SIGNED_IN') {
        currentUser = session.user;
        updateUserStatus();
        showPage('home-page'); // Go to dashboard after login
    } else if (event === 'SIGNED_OUT') {
        currentUser = null;
        updateUserStatus();
        showPage('auth-page'); // Go to auth page after logout
    }
});


// Update the UI based on login status
function updateUserStatus() {
    if (currentUser) {
        userStatusDiv.innerHTML = `
            <span>Welcome, ${currentUser.user_metadata.username || currentUser.email}</span>
            <button id="logout-btn">Logout</button>
        `;
        document.getElementById('logout-btn').addEventListener('click', logoutUser);
    } else {
        userStatusDiv.innerHTML = `<a href="#auth" class="nav-link">Login / Sign Up</a>`;
    }
}


// =================================================================
// PAGE NAVIGATION & DATA HANDLING
// =================================================================

const pages = document.querySelectorAll('.page');
const navLinks = document.querySelectorAll('.nav-link');

function showPage(pageId) {
    // Don't let users see other pages if they aren't logged in
    if (pageId !== 'auth-page' && !currentUser) {
        showPage('auth-page');
        return;
    }
    pages.forEach(page => page.classList.remove('active'));
    document.getElementById(pageId)?.classList.add('active');
}

// Initial page load check
async function checkUserSession() {
    const { data: { session } } = await supabase.auth.getSession();
    currentUser = session?.user || null;
    updateUserStatus();
    if (currentUser) {
        showPage('home-page');
    } else {
        showPage('auth-page');
    }
}

// Data Fetching and Parsing
async function fetchGameData() {
    try {
        const response = await fetch(SHEET_URL);
        if (!response.ok) throw new Error('Network response was not ok');
        const csvText = await response.text();
        allGames = parseGameData(csvText);
    } catch (error) {
        console.error('Failed to fetch game data:', error);
        document.getElementById('games-container').innerHTML = '<p>Error: Could not load game data.</p>';
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

// =================================================================
// GAME LOGIC & RENDERING
// =================================================================

const gamesContainer = document.getElementById('games-container');

function renderGames() {
    const weeklyGames = allGames.filter(game => game.Week === CURRENT_WEEK);
    document.getElementById('picks-page-title').textContent = `${CURRENT_WEEK} Picks`;
    gamesContainer.innerHTML = '';

    if (weeklyGames.length === 0) {
        gamesContainer.innerHTML = `<p>No games found for ${CURRENT_WEEK}.</p>`;
        return;
    }

    weeklyGames.forEach(game => {
        const gameCard = document.createElement('div');
        gameCard.className = 'game-card';
        gameCard.dataset.gameId = game['Game Id'];
        if (game.Status !== 'pre') gameCard.classList.add('locked');

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
                ${new Date(game.Date + ' ' + game.Time).toLocaleString('en-US', { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}
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

// Save Picks to Supabase
async function savePicksToSupabase() {
    if (!currentUser) {
        alert('You must be logged in to save picks!');
        return;
    }

    const picksToInsert = Object.keys(userPicks)
        .filter(gameId => userPicks[gameId]) // Only include picks that have a selected team
        .map(gameId => ({
            user_id: currentUser.id,
            game_id: parseInt(gameId),
            picked_team: userPicks[gameId],
            is_double_up: gameId === doubleUpPick,
            week: CURRENT_WEEK
        }));

    if (picksToInsert.length === 0) {
        alert('You haven\'t made any picks yet!');
        return;
    }

    const { error } = await supabase
        .from('picks')
        .upsert(picksToInsert, { onConflict: 'user_id, game_id' });

    if (error) {
        alert('Error saving picks: ' + error.message);
        console.error(error);
    } else {
        alert('Your picks have been saved!');
    }
}

document.getElementById('save-picks-btn').addEventListener('click', savePicksToSupabase);

// =================================================================
// INITIALIZE APP
// =================================================================

async function init() {
    await checkUserSession();
    await fetchGameData();
    renderGames();
    // Add event listeners for nav links to show pages
    document.querySelector('#user-status a').addEventListener('click', () => showPage('auth-page'));
    // This is a simple way to add nav, can be improved later
    document.querySelector('nav .logo').addEventListener('click', () => showPage('home-page'));
}

init();
