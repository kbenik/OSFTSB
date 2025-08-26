// =================================================================
// CONFIGURATION & INITIALIZATION
// =================================================================
const SUPABASE_URL = 'https://mtjflkwoxjnwaawjlaxy.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im10amZsa3dveGpud2Fhd2psYXh5Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTU3MDY1MzQsImV4cCI6MjA3MTI4MjUzNH0.PflqgxXG3kISTpp7nUNCXiBn-Ue3kvKNIS2yV1oz-jg';
const supabase = self.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
const SHEET_URL = 'https://docs.google.com/spreadsheets/d/e/2PACX-1vScqmMOmdB95tGFqkzzPMNUxnGdIum_bXFBhEvX8Xj-b0M3hZYCu8w8V9k7CgKvjHMCtnmj3Y3Vza0A/pub?gid=1227961915&single=true&output=csv';

// --- STATE MANAGEMENT ---
let allGames = [];
let activeWeek = '';
let currentUser = null;

// State for the Picks page
let userPicks = {};
let userWagers = {};
let doubleUpPick = null;
let initiallySavedPicks = new Set();


// =================================================================
// EVENT LISTENERS (Global)
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
    if (!game || !game.Date || !game.Time) return new Date('1970-01-01');
    const datePart = game.Date.split(' ')[1]; 
    const timePart = game.Time.replace(/\s/g, '').toUpperCase();
    const dateTimeString = `${datePart} ${timePart} EDT`; 
    return new Date(dateTimeString);
}

// =================================================================
// *** NEW & IMPROVED WEEK DETERMINATION LOGIC ***
// =================================================================
function determineCurrentWeek(games) {
    const now = new Date();
    const rolloverDay = 2; // Tuesday
    const regularSeasonGames = games
        .filter(g => g.Week.startsWith('Week '))
        .sort((a, b) => getKickoffTimeAsDate(a) - getKickoffTimeAsDate(b));

    if (regularSeasonGames.length === 0) {
        return 'Week 1'; // No games found, default
    }

    // If we are before the very first game of the season, show Week 1
    const firstGameKickoff = getKickoffTimeAsDate(regularSeasonGames[0]);
    if (now < firstGameKickoff) {
        return 'Week 1';
    }

    let currentWeekNumber = 1;
    // Iterate through weeks 1 to 18
    for (let i = 1; i <= 18; i++) {
        const weekString = `Week ${i}`;
        const gamesInThisWeek = regularSeasonGames.filter(g => g.Week === weekString);
        
        if (gamesInThisWeek.length === 0) {
            // If we've run out of weeks in the data, the last known week is active
            break;
        }

        // Find the last game of the current week (usually Monday night)
        const lastGameOfWeek = gamesInThisWeek[gamesInThisWeek.length - 1];
        const lastGameKickoff = getKickoffTimeAsDate(lastGameOfWeek);
        
        // Calculate the rollover time: Tuesday at 6 AM ET after the last game
        const rolloverTime = new Date(lastGameKickoff);
        rolloverTime.setDate(rolloverTime.getDate() + (7 + rolloverDay - rolloverTime.getDay()) % 7);
        rolloverTime.setHours(6, 0, 0, 0);

        if (now < rolloverTime) {
            currentWeekNumber = i;
            break; // We found our active week
        }
        
        // If we are past the rollover time for this week, the loop will continue to check the next week
        currentWeekNumber = i + 1 > 18 ? 18 : i + 1;
    }
    
    return `Week ${currentWeekNumber}`;
}


// =================================================================
// NAVIGATION & UI MANAGEMENT
// =================================================================

function updateUserStatusUI() {
    const userStatusDiv = document.getElementById('user-status');
    const mainNav = document.getElementById('main-nav');
    if (currentUser) {
        const username = currentUser.user_metadata?.username || currentUser.email;
        userStatusDiv.innerHTML = `<span>Welcome, ${username}</span><button id="logout-btn">Logout</button>`;
        mainNav.classList.remove('hidden');
    } else {
        userStatusDiv.innerHTML = `<a href="#auth" class="nav-link">Login / Sign Up</a>`;
        mainNav.classList.add('hidden');
    }
}

function showPage(pageId) {
    document.querySelectorAll('.page').forEach(page => page.classList.remove('active'));
    const activePage = document.getElementById(pageId);
    if (activePage) {
        activePage.classList.add('active');
        // Load data for the specific page
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

        const { data, error } = await supabase.auth.signUp({ email, password, options: { data: { username } } });
        if (error) return alert('Error signing up: ' + error.message);

        const { error: profileError } = await supabase.from('profiles').insert([
            { id: data.user.id, username: username }
        ]);
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

// --- DASHBOARD ---
async function displayDashboard() {
    if (!currentUser) return;
    
    const [pendingPicksRes, pastPicksRes] = await Promise.all([
        supabase.from('picks').select('*').eq('user_id', currentUser.id).is('is_correct', null),
        supabase.from('picks').select('*').eq('user_id', currentUser.id).not('is_correct', 'is', null).order('created_at', { ascending: false })
    ]);
    
    const pendingBody = document.getElementById('pending-picks-body');
    document.getElementById('pending-picks-week').textContent = activeWeek;
    pendingBody.innerHTML = '';
    const pendingPicksForWeek = pendingPicksRes.data?.filter(p => p.week === activeWeek) || [];
    if (pendingPicksForWeek.length > 0) {
        pendingPicksForWeek.forEach(pick => {
            const game = allGames.find(g => g['Game Id'] == pick.game_id);
            const gameName = game ? `${game['Away Display Name']} @ ${game['Home Display Name']}` : `Game ID: ${pick.game_id}`;
            const doubleUp = pick.is_double_up ? ' 🔥' : '';
            pendingBody.innerHTML += `<tr><td>${gameName}</td><td>${pick.picked_team}</td><td>${pick.wager}${doubleUp}</td></tr>`;
        });
    } else {
        pendingBody.innerHTML = `<tr><td colspan="3">No pending picks for ${activeWeek}.</td></tr>`;
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


// --- PICKS PAGE ---
async function displayPicksPage() {
    const gamesContainer = document.getElementById('games-container');
    if (allGames.length === 0) {
        gamesContainer.innerHTML = '<p>Loading live game data...</p>';
        return;
    }
    
    const { data: savedPicks, error } = await fetchUserPicksForWeek(activeWeek);
    if (error) {
        console.error("Could not fetch saved picks:", error);
        gamesContainer.innerHTML = '<p>Error loading your picks. Please refresh.</p>';
        return;
    }
    
    userPicks = {};
    userWagers = {};
    doubleUpPick = null;
    initiallySavedPicks.clear();
    
    savedPicks.forEach(p => {
        initiallySavedPicks.add(p.game_id.toString());
        userPicks[p.game_id] = p.picked_team;
        userWagers[p.game_id] = p.wager;
        if (p.is_double_up) doubleUpPick = p.game_id.toString();
    });

    gamesContainer.innerHTML = '';
    document.getElementById('picks-page-title').textContent = `${activeWeek} Picks`;

    const now = new Date();
    const weeklyGames = allGames.filter(game => game.Week === activeWeek);
    
    if (weeklyGames.length === 0) {
        gamesContainer.innerHTML = `<p class="card">There are no games scheduled for ${activeWeek}.</p>`;
        return;
    }

    // After filtering for the week, now filter out games that have started
    const upcomingWeeklyGames = weeklyGames.filter(game => getKickoffTimeAsDate(game) > now);

    if (upcomingWeeklyGames.length === 0) {
        gamesContainer.innerHTML = `<p class="card">All games for ${activeWeek} have started. No more picks can be made.</p>`;
        return;
    }
    
    upcomingWeeklyGames.forEach(game => {
        const gameId = game['Game Id'];
        const awayName = game['Away Display Name'];
        const homeName = game['Home Display Name'];

        const gameCard = document.createElement('div');
        gameCard.className = 'game-card';
        gameCard.dataset.gameId = gameId;

        gameCard.innerHTML = `
            <div class="team" data-team-name="${awayName}"><img src="${game['Away Logo']}" alt="${awayName}"><span class="team-name">${awayName}</span></div>
            <div class="game-separator">@</div>
            <div class="team" data-team-name="${homeName}"><img src="${game['Home Logo']}" alt="${homeName}"><span class="team-name">${homeName}</span></div>
            <div class="game-info">${getKickoffTimeAsDate(game).toLocaleString('en-US', { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}</div>
            <div class="wager-controls">
                <div class="wager-options">
                    <span>Wager:</span>
                    ${[1, 2, 3, 4, 5].map(w => `<button class="wager-btn" data-value="${w}">${w}</button>`).join('')}
                </div>
                <button class="double-up-btn">2x Double Up</button>
            </div>
            ${initiallySavedPicks.has(gameId) ? '<div class="saved-indicator" title="This pick is saved"></div>' : ''}
        `;
        gamesContainer.appendChild(gameCard);

        if (userPicks[gameId]) gameCard.querySelector(`.team[data-team-name="${userPicks[gameId]}"]`)?.classList.add('selected');
        if (userWagers[gameId]) gameCard.querySelector(`.wager-btn[data-value="${userWagers[gameId]}"]`)?.classList.add('selected');
        if (doubleUpPick === gameId) gameCard.querySelector('.double-up-btn').classList.add('selected');
    });

    addGameCardEventListeners();
}

async function fetchUserPicksForWeek(week) {
    if (!currentUser) return { data: [], error: null };
    return await supabase.from('picks').select('*').eq('user_id', currentUser.id).eq('week', week);
}

function addGameCardEventListeners() {
    const allDoubleUpBtns = document.querySelectorAll('.double-up-btn');
    document.querySelectorAll('.game-card').forEach(card => {
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
                const wager = parseInt(btn.dataset.value, 10);
                userWagers[gameId] = wager;
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
        for (const gameId in userPicks) {
            if (userPicks[gameId] && !userWagers[gameId]) {
                const game = allGames.find(g => g['Game Id'] === gameId);
                throw new Error(`You must place a wager for the ${game['Away Display Name']} @ ${game['Home Display Name']} game.`);
            }
        }
        
        const picksToUpsert = Object.keys(userPicks)
            .filter(gameId => userPicks[gameId] !== undefined)
            .map(gameId => ({
                user_id: currentUser.id,
                game_id: parseInt(gameId, 10),
                picked_team: userPicks[gameId],
                wager: userWagers[gameId],
                is_double_up: gameId === doubleUpPick,
                week: activeWeek
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
        displayPicksPage();

    } catch (error) {
        console.error("Save Picks Error:", error);
        alert('Error: ' + error.message);
    }
}


// --- SCOREBOARD PAGE ---
async function displayScoreboardPage() {
    const selector = document.getElementById('match-selector');
    const standingsBody = document.getElementById('scoreboard-standings-body');
    const picksContainer = document.getElementById('scoreboard-picks-container');
    
    const { data: userMatches, error: userMatchesError } = await supabase
        .from('match_members')
        .select('matches (id, name)')
        .eq('user_id', currentUser.id);

    if (userMatchesError || !userMatches || userMatches.length === 0) {
        standingsBody.innerHTML = '<tr><td colspan="3">You are not part of any matches yet. Visit the Matches page to join or create one!</td></tr>';
        picksContainer.innerHTML = '';
        selector.innerHTML = '';
        return;
    }
    
    selector.innerHTML = userMatches.map(m => `<option value="${m.matches.id}">${m.matches.name}</option>`).join('');
    
    // Clear any previous listener to avoid duplicates
    const newSelector = selector.cloneNode(true);
    selector.parentNode.replaceChild(newSelector, selector);
    newSelector.addEventListener('change', () => loadScoreboardForMatch(newSelector.value));
    
    loadScoreboardForMatch(newSelector.value);
}

async function loadScoreboardForMatch(matchId) {
    document.getElementById('scoreboard-week-title').textContent = activeWeek;

    const { data: members, error: membersError } = await supabase
        .from('match_members')
        .select('score, profiles (id, username)')
        .eq('match_id', matchId)
        .order('score', { ascending: false });

    if (membersError) return console.error("Error fetching members");

    const standingsBody = document.getElementById('scoreboard-standings-body');
    standingsBody.innerHTML = '';
    members.forEach((member, index) => {
        standingsBody.innerHTML += `<tr><td>${index + 1}</td><td>${member.profiles.username}</td><td>${member.score}</td></tr>`;
    });
    
    const memberIds = members.map(m => m.profiles.id);
    const { data: allPicks, error: picksError } = await supabase
        .from('picks')
        .select('picked_team, wager, is_double_up, game_id, profiles (username)')
        .in('user_id', memberIds)
        .eq('week', activeWeek);

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

        picksContainer.innerHTML += `
            <div class="scoreboard-user-picks">
                <h3>${user.username}</h3>
                <ul>${picksHtml || '<li>No picks made yet.</li>'}</ul>
            </div>`;
    });
}


// --- MATCHES PAGE ---
async function displayMatchesPage() {
    const container = document.getElementById('matches-list-container');
    container.innerHTML = '<p>Loading public matches...</p>';
    
    const { data: matches, error } = await supabase
        .from('matches')
        .select('id, name')
        .eq('is_public', true);
        
    if (error) return container.innerHTML = '<p>Could not load matches. Please try again.</p>';
    if (matches.length === 0) return container.innerHTML = '<p>No public matches found. Why not create one?</p>';
    
    container.innerHTML = matches.map(match => `
        <div class="match-item">
            <span>${match.name}</span>
            <button class="button-primary join-match-btn" data-match-id="${match.id}">Join</button>
        </div>
    `).join('');
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

    const { data: newMatch, error: createError } = await supabase
        .from('matches')
        .insert({ name, password, created_by: currentUser.id, is_public: true })
        .select()
        .single();

    if (createError) return alert("Error creating match: " + createError.message);

    const { error: memberError } = await supabase
        .from('match_members')
        .insert({ match_id: newMatch.id, user_id: currentUser.id });
        
    if (!memberError) {
        alert("Match created successfully!");
        displayMatchesPage();
    } else {
        alert("Match created, but failed to add you as a member: " + memberError.message);
    }
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
            const pageId = navLink.getAttribute('href').substring(1);
            window.location.hash = pageId;
        }
    });
    
    window.addEventListener('hashchange', () => {
        const pageId = (window.location.hash.substring(1) || 'home') + '-page';
        if(currentUser) {
            showPage(pageId);
        } else {
            showPage('auth-page');
        }
    });

    try {
        const response = await fetch(SHEET_URL);
        const csvText = await response.text();
        allGames = parseCSV(csvText);
        activeWeek = determineCurrentWeek(allGames);
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
