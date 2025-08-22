// =================================================================
// CONFIGURATION & INITIALIZATION
// =================================================================

const SUPABASE_URL = 'https://mtjflkwoxjnwaawjlaxy.supabase.co'; 
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im10amZsa3dveGpud2Fhd2psYXh5Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTU3MDY1MzQsImV4cCI6MjA3MTI4MjUzNH0.PflqgxXG3kISTpp7nUNCXiBn-Ue3kvKNIS2yV1oz-jg';
const supabase = self.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
const SHEET_URL = 'https://docs.google.com/spreadsheets/d/e/2PACX-1vScqmMOmdB95tGFqkzzPMNUxnGdIum_bXFBhEvX8Xj-b0M3hZYCu8w8V9k7CgKvjHMCtnmj3Y3Vza0A/pub?gid=1227961915&single=true&output=csv';

// --- NEW STATE MANAGEMENT FOR WAGERS ---
let isGameDataLoaded = false;
let activeWeek = '';
let allGames = [];
let userPicks = {};      // { gameId: "Team Name", ... }
let userWagers = {};     // { gameId: 5, ... }
let doubleUpPick = null; // Back to a single pick for the Double Up
let currentUser = null;
let initiallySavedPicks = new Set();

// ... (DOM Elements and other functions remain largely the same, so they are omitted for brevity)
// ... The full code includes all the functions from your previous file. The key changes are below.

// (Keep all your existing functions like getKickoffTimeAsDate, auth handlers, etc.)

// --- KEY CHANGES START HERE ---

// MODIFIED: Renders the dashboard with wager and fire emoji
function renderDashboard(profile, picks) {
    // ... (Your existing dashboard rendering logic)
    // Modify the innerHTML part to show the wager and double up
    picks.forEach(pick => {
        // ... (find gameName, result, etc.)
        const doubleUpIndicator = pick.is_double_up ? ' 🔥' : '';
        const wagerIndicator = pick.wager ? ` (${pick.wager} pts)` : '';

        row.innerHTML = `<td>${gameName} (${pick.week})</td><td>${pick.picked_team}${wagerIndicator}${doubleUpIndicator}</td><td>${result}</td><td>${points}</td>`;
        historyBody.appendChild(row);
    });
}


// MODIFIED: Renders game cards with a new wager UI
async function renderGames() {
    // ... (Your existing setup for renderGames: check if data is loaded, fetch saved picks, reset state)
    
    weeklyGames.forEach(game => {
        // ... (Your existing logic to get gameId, savedPick, etc.)

        // --- NEW WAGER UI ---
        gameCard.innerHTML = `
            <div class="team" data-team-name="${awayName}"><!-- ... --></div>
            <div class="game-separator">@</div>
            <div class="team" data-team-name="${homeName}"><!-- ... --></div>
            <div class="game-info">${/*... date info */}</div>
            
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

        // Pre-populate the UI with saved data
        if (savedPick) {
            // ... (select the team and add lock icon)
            
            // Highlight the saved wager
            if (savedPick.wager) {
                card.querySelector(`.wager-btn[data-value="${savedPick.wager}"]`)?.classList.add('selected');
                userWagers[gameId] = savedPick.wager;
            }
        }
        if (savedPick?.is_double_up) {
            doubleUpPick = gameId;
            card.querySelector('.double-up-btn').classList.add('selected');
        }
    });

    addGameCardEventListeners();
}


// MODIFIED: Handles the new wager and double up logic
function addGameCardEventListeners() {
    const allDoubleUpBtns = document.querySelectorAll('.double-up-btn');

    document.querySelectorAll('.game-card').forEach(card => {
        const gameId = card.dataset.gameId;
        const wagerBtns = card.querySelectorAll('.wager-btn');
        const doubleUpBtn = card.querySelector('.double-up-btn');

        card.querySelectorAll('.team').forEach(team => {
            team.addEventListener('click', () => {
                // ... (Your existing logic for selecting/deselecting a team)
                
                // When a team is deselected, reset the wager for that game
                if (!userPicks[gameId]) {
                    wagerBtns.forEach(btn => btn.classList.remove('selected'));
                    userWagers[gameId] = undefined;
                    if (doubleUpPick === gameId) {
                         allDoubleUpBtns.forEach(btn => btn.classList.remove('selected'));
                         doubleUpPick = null;
                    }
                }
            });
        });

        wagerBtns.forEach(btn => {
            btn.addEventListener('click', () => {
                if (!userPicks[gameId]) {
                    return alert("Please select a team before placing a wager.");
                }
                wagerBtns.forEach(b => b.classList.remove('selected'));
                btn.classList.add('selected');
                userWagers[gameId] = parseInt(btn.dataset.value);
            });
        });

        doubleUpBtn.addEventListener('click', () => {
             if (!userPicks[gameId]) {
                return alert("Please select a team before using your Double Up.");
             }
             const wasSelected = doubleUpBtn.classList.contains('selected');
             allDoubleUpBtns.forEach(btn => btn.classList.remove('selected')); // Clear all others
             
             if (!wasSelected) {
                doubleUpBtn.classList.add('selected');
                doubleUpPick = gameId;
             } else {
                doubleUpPick = null; // It was deselected
             }
        });
    });
}


// MODIFIED: Saves picks with the new wager data
savePicksBtn.addEventListener('click', async () => {
    // ... (Your existing validation logic for currentUser)
    
    const picksToUpsert = Object.keys(userPicks)
        .filter(gameId => userPicks[gameId] !== undefined)
        .map(gameId => {
            // NEW VALIDATION: Every pick must have a wager
            if (!userWagers[gameId]) {
                const game = allGames.find(g => g['Game Id'] == gameId);
                // Throw an error to stop the whole process
                throw new Error(`You must place a wager for the ${game['Away Display Name']} @ ${game['Home Display Name']} game.`);
            }
            return {
                user_id: currentUser.id,
                game_id: parseInt(gameId),
                picked_team: userPicks[gameId],
                wager: userWagers[gameId], // Add wager to the payload
                is_double_up: gameId === doubleUpPick,
                week: activeWeek
            };
        });
    
    try {
        // ... (Your existing logic to handle upserts and deletes)
    } catch (error) {
        // This will now catch the wager validation error too
        alert(error.message);
    }
});
