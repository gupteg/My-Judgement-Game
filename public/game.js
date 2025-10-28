window.addEventListener('DOMContentLoaded', () => {
    // FIX: Corrected the URL typo (httpss -> https://)
    const socket = io('https://my-judgement-game.onrender.com');

    window.gameState = {};
    let myPersistentPlayerId = sessionStorage.getItem('judgmentPlayerId');
    let isInitialGameRender = true; // Flag to handle mobile scroll position
    let pauseCountdownInterval;
    let lobbyReturnInterval;
    let trickReviewInterval;
    let actionBannerCountdownInterval;
    let pendingBid = null; // *** Store bid during confirmation ***
    let previousGameState = null; // For move announcement diff
    let moveAnnouncementTimeout = null; // Timer for move announcement

    socket.on('connect', () => {
        myPersistentPlayerId = sessionStorage.getItem('judgmentPlayerId');
        const myPlayerName = sessionStorage.getItem('judgmentPlayerName');
        if (myPersistentPlayerId) {
            socket.emit('joinGame', { playerName: myPlayerName, playerId: myPersistentPlayerId });
        }
    });

    const rankMap = { 'A': 'ace', 'K': 'king', 'Q': 'queen', 'J': 'jack', '10': '10', '9': '9', '8': '8', '7': '7', '6': '6', '5': '5', '4': '4', '3': '3', '2': '2' };

    setupJoinScreenListeners();
    setupLobbyEventListeners();
    setupModalAndButtonListeners();
    setupDynamicEventListeners();
    document.getElementById('rearrange-hand-btn').addEventListener('click', handleRearrangeHand);

    function setupJoinScreenListeners() {
        document.getElementById('join-game-btn').addEventListener('click', () => {
            const playerName = document.getElementById('player-name-input').value.trim();
            if (playerName) {
                sessionStorage.setItem('judgmentPlayerName', playerName);
                socket.emit('joinGame', { playerName, playerId: myPersistentPlayerId });
            }
        });
    }

    function setupLobbyEventListeners() {
        const playerActions = document.getElementById('player-lobby-actions');
        const hostActions = document.getElementById('host-lobby-actions');
        const playerList = document.getElementById('player-list');

        playerActions.addEventListener('click', (e) => {
            if (e.target.id === 'ready-btn') {
                socket.emit('setPlayerReady');
            }
        });

        hostActions.addEventListener('click', (e) => {
            const targetId = e.target.id;
            if (targetId === 'start-game-btn') {
                const password = document.getElementById('host-password-input').value;
                socket.emit('startGame', { password: password });
            } else if (targetId === 'end-session-btn') {
                socket.emit('endSession');
            } else if (targetId === 'hard-reset-btn') {
                const resetModal = document.getElementById('confirm-hard-reset-modal');
                resetModal.style.display = 'flex';
                resetModal.classList.remove('hidden');
            }
        });

        playerList.addEventListener('click', (e) => {
            if (e.target.classList.contains('kick-btn')) {
                const playerIdToKick = e.target.dataset.playerId;
                socket.emit('kickPlayer', { playerIdToKick });
            }
        });
    }

    function setupDynamicEventListeners() {
        const scrollContainer = document.getElementById('mobile-scroll-container');
        const pageIndicator = document.getElementById('page-indicator');
        scrollContainer.addEventListener('scroll', () => {
            const scrollLeft = scrollContainer.scrollLeft;
            const pageWidth = scrollContainer.offsetWidth;
            const currentPage = Math.round(scrollLeft / pageWidth);

            pageIndicator.innerHTML = '';
            for (let i = 0; i < 3; i++) {
                const dot = document.createElement('div');
                dot.className = 'dot';
                if (i === currentPage) {
                    dot.classList.add('active');
                }
                pageIndicator.appendChild(dot);
            }
        });
    }

    function setupModalAndButtonListeners() {
        // *** This button now opens the confirm modal ***
        document.getElementById('submit-bid-btn').addEventListener('click', () => {
            const bidInput = document.getElementById('bid-input');
            pendingBid = bidInput.value; // Store the bid

            // Populate and show the modal
            document.getElementById('confirm-bid-text').innerHTML = `You are bidding: <strong>${pendingBid}</strong>`;
            const confirmModal = document.getElementById('confirm-bid-modal');
            confirmModal.style.display = 'flex';
            confirmModal.classList.remove('hidden');
        });

        // *** Listener for the "Confirm Bid" button ***
        document.getElementById('confirm-bid-yes-btn').addEventListener('click', () => {
            if (pendingBid !== null) {
                socket.emit('submitBid', { bid: pendingBid });
            }
            // Hide modal and banner
            const confirmModal = document.getElementById('confirm-bid-modal');
            confirmModal.style.display = 'none';
            confirmModal.classList.add('hidden');
            document.getElementById('action-banner').style.display = 'none';
            pendingBid = null; // Clear the stored bid
        });

        // *** Listener for the "Revise" button ***
        document.getElementById('confirm-bid-no-btn').addEventListener('click', () => {
            // Just hide the modal and clear the bid
            const confirmModal = document.getElementById('confirm-bid-modal');
            confirmModal.style.display = 'none';
            confirmModal.classList.add('hidden');
            pendingBid = null;
            // The action banner remains visible, allowing reentry
        });


        const confirmModal = document.getElementById('confirm-end-game-modal');
        // Ensure endGameBtn exists before adding listener
        const endGameBtn = document.getElementById('endGameBtn');
        if (endGameBtn) {
            endGameBtn.addEventListener('click', () => {
                confirmModal.style.display = 'flex';
                confirmModal.classList.remove('hidden');
            });
        }
        document.getElementById('confirm-end-no-btn').addEventListener('click', () => {
            confirmModal.style.display = 'none';
            confirmModal.classList.add('hidden');
        });
        document.getElementById('confirm-end-yes-btn').addEventListener('click', () => {
            confirmModal.style.display = 'none';
            confirmModal.classList.add('hidden');
            socket.emit('endGame');
        });
        document.getElementById('start-next-round-btn').addEventListener('click', () => socket.emit('startNextRound'));
        document.getElementById('end-game-from-modal-btn').addEventListener('click', () => socket.emit('endGame'));

        const scoreboardModal = document.getElementById('scoreboard-modal');
        document.getElementById('player-ok-btn').addEventListener('click', () => {
            scoreboardModal.style.display = 'none';
            scoreboardModal.classList.add('hidden');
        });

        const lastTrickModal = document.getElementById('last-trick-modal');
        document.getElementById('view-last-trick-btn').addEventListener('click', () => renderLastTrickModal(window.gameState));
        document.getElementById('close-last-trick-modal').addEventListener('click', () => lastTrickModal.classList.add('hidden'));
        lastTrickModal.addEventListener('click', (e) => {
            if (e.target.id === 'last-trick-modal') {
                lastTrickModal.classList.add('hidden');
            }
        });

        const afkModal = document.getElementById('afk-notification-modal');
        document.getElementById('im-back-btn').addEventListener('click', () => {
            socket.emit('playerIsBack');
            afkModal.style.display = 'none';
            afkModal.classList.add('hidden');
        });

        const resetModal = document.getElementById('confirm-hard-reset-modal');
        document.getElementById('confirm-reset-no-btn').addEventListener('click', () => {
            resetModal.style.display = 'none';
            resetModal.classList.add('hidden');
        });
        document.getElementById('confirm-reset-yes-btn').addEventListener('click', () => {
            resetModal.style.display = 'none';
            resetModal.classList.add('hidden');
            socket.emit('hardReset');
        });

        const warningModal = document.getElementById('warning-modal');
        document.getElementById('warning-modal-ok-btn').addEventListener('click', () => {
            warningModal.style.display = 'none';
            warningModal.classList.add('hidden');
        });
    }

    // This function now *only* ensures the banner is visible and populated.
    // It doesn't assume it needs to hide it otherwise.
    socket.on('promptForBid', ({ maxBid }) => {
        const actionBanner = document.getElementById('action-banner');
        const bidInput = document.getElementById('bid-input');
        const actionText = document.getElementById('action-banner-text');
        const inputArea = document.getElementById('action-banner-input-area');

        actionText.textContent = 'Your turn to BID!';
        inputArea.style.display = 'flex'; // Ensure input area is visible
        actionBanner.style.display = 'block'; // Explicitly show banner

        bidInput.innerHTML = ''; // Clear previous options
        for (let i = 0; i <= maxBid; i++) {
            const option = document.createElement('option');
            option.value = i;
            option.textContent = i;
            bidInput.appendChild(option);
        }
    });


    socket.on('invalidBid', ({ message }) => showWarningModal('Invalid Bid', message));

    socket.on('announce', (message) => {
        const isRuleViolation = message.includes('You must play a') || message.includes('Total bid cannot be');
        if (isRuleViolation) {
            showWarningModal('Rule Violation', message);
        } else {
            showToast(message);
        }
    });

    function showWarningModal(title, message) {
        document.getElementById('warning-modal-title').textContent = title;
        document.getElementById('warning-modal-text').textContent = message;
        const warningModal = document.getElementById('warning-modal');
        warningModal.style.display = 'flex';
        warningModal.classList.remove('hidden');
    }

    socket.on('updateGameState', (gs) => {
        handleMoveAnnouncement(gs, previousGameState);
        previousGameState = JSON.parse(JSON.stringify(gs));

        const wasHidden = document.getElementById('scoreboard-modal').classList.contains('hidden')
                        && document.getElementById('scoreboard-modal').style.display === 'none';

        window.gameState = gs;
        document.getElementById('join-screen').style.display = 'none';
        document.getElementById('lobby-screen').style.display = 'none';
        document.getElementById('game-board').style.display = 'flex';

        if (isInitialGameRender) {
            const scrollContainer = document.getElementById('mobile-scroll-container');
            scrollContainer.scrollTo({ left: scrollContainer.offsetWidth, behavior: 'auto' });
            isInitialGameRender = false;
        }

        const scoreboardModal = document.getElementById('scoreboard-modal');
        if (gs.phase !== 'RoundOver' && gs.phase !== 'GameOver' && !scoreboardModal.classList.contains('hidden')) {
            scoreboardModal.style.display = 'none';
        }
        if (gs.phase === 'RoundOver' || gs.phase === 'GameOver') {
            updateGameStatusBanner(gs);
            if ((wasHidden || scoreboardModal.style.display === 'none') && gs.phase === 'RoundOver') {
                showScoreboard(gs);
            }
            const modalContent = scoreboardModal.querySelector('.modal-content');
            let pauseOverlay = modalContent.querySelector('.pause-overlay');
            if (gs.isPaused && !pauseOverlay) {
                pauseOverlay = document.createElement('div');
                pauseOverlay.className = 'pause-overlay';
                pauseOverlay.textContent = 'Game Paused. Waiting for player to rejoin...';
                modalContent.style.position = 'relative';
                modalContent.appendChild(pauseOverlay);
            } else if (!gs.isPaused && pauseOverlay) {
                pauseOverlay.remove();
            }
        } else {
             renderGameBoard(gs);
        }

        const afkModal = document.getElementById('afk-notification-modal');
        if (!gs.isPaused && !afkModal.classList.contains('hidden')) {
            afkModal.style.display = 'none';
            afkModal.classList.add('hidden');
        }
    });

    function showScoreboard(gs) {
        const scoreboardModal = document.getElementById('scoreboard-modal');
        document.getElementById('scoreboard-title').textContent = `Round ${gs.roundNumber} Scores`;
        const preview = document.getElementById('next-round-preview');
        const nextRoundInfo = gs.nextRoundInfo;

        if (nextRoundInfo && nextRoundInfo.nextNumCards > 0) {
            preview.style.display = 'block';

            const trumpCardHTML = nextRoundInfo.nextTrumpSuit === 'No Trump'
                ? `<div class="suit-icon no-trump-icon">NT</div><div class="suit-name">No Trump</div>`
                : `<img src="/cards/suit_${nextRoundInfo.nextTrumpSuit.toLowerCase()}.svg" class="suit-icon" alt="${nextRoundInfo.nextTrumpSuit}"><div class="suit-name">${nextRoundInfo.nextTrumpSuit} Trump</div>`;

            preview.innerHTML = `
                <div class="plaque-title">Next Round</div>
                <div class="trump-reveal-card">${trumpCardHTML}</div>
                <div class="next-round-details-grid">
                    <div class="next-round-detail-tile">
                        <div class="tile-label">Dealer</div>
                        <div class="tile-value">${nextRoundInfo.nextDealerName}</div>
                    </div>
                    <div class="next-round-detail-tile">
                        <div class="tile-label">Cards</div>
                        <div class="tile-value">${nextRoundInfo.nextNumCards}</div>
                    </div>
                </div>
            `;
        } else {
            preview.style.display = 'none';
        }

        const myPlayer = gs.players.find(p => p.playerId === myPersistentPlayerId);
        const hostControls = document.getElementById('host-round-end-controls');
        const playerControls = document.getElementById('player-round-end-controls');
        if (myPlayer && myPlayer.isHost) {
            hostControls.style.display = 'flex';
            playerControls.style.display = 'none';
        } else {
            hostControls.style.display = 'none';
            playerControls.style.display = 'flex';
        }
        renderScoreboard(gs);
        scoreboardModal.style.display = 'flex';
        scoreboardModal.classList.remove('hidden');
        document.getElementById('lobby-return-countdown').style.display = 'none';
    }

    function handleRearrangeHand() {
        const localPlayer = window.gameState.players?.find(p => p.playerId === myPersistentPlayerId);
        if (!localPlayer || !localPlayer.hand || localPlayer.hand.length === 0) return;
        const trumpSuit = window.gameState.trumpSuit;
        const suitOrder = { 'Spades': 1, 'Hearts': 2, 'Clubs': 3, 'Diamonds': 4 };
        if (trumpSuit && trumpSuit !== 'No Trump') { suitOrder[trumpSuit] = 0; }
        const sortedHand = [...localPlayer.hand].sort((a, b) => { const suitComparison = suitOrder[a.suit] - suitOrder[b.suit]; if (suitComparison !== 0) { return suitComparison; } return b.value - a.value; });
        socket.emit('rearrangeHand', { newHand: sortedHand });
    }

    function getClosestCard(container, x, y) {
        const draggableElements = [...container.querySelectorAll('.card:not(.dragging)')];
        let closest = { distance: Number.POSITIVE_INFINITY, element: null };
        for (const child of draggableElements) { const box = child.getBoundingClientRect(); const centerX = box.left + box.width / 2; const centerY = box.top + box.height / 2; const distance = Math.sqrt(Math.pow(x - centerX, 2) + Math.pow(y - centerY, 2)); if (distance < closest.distance) { closest = { distance, element: child }; } }
        return closest.element;
    }

    function setupHandInteractions(container, hand) {
        container.addEventListener('click', e => { if (e.target.classList.contains('card') && e.target.classList.contains('clickable')) { const card = getCardDataFromElement(e.target, hand); if (card) socket.emit('playCard', { card }); } });

        container.addEventListener('dragstart', e => {
            if (e.target.classList.contains('card')) {
                e.target.classList.add('dragging');
                // --- NEW: Add card data to the drag event ---
                e.dataTransfer.setData('text/plain', e.target.dataset.card);
            }
        });

        container.addEventListener('dragend', e => { if (e.target.classList.contains('card')) { e.target.classList.remove('dragging'); const newElements = [...container.querySelectorAll('.card')]; const newHand = newElements.map(el => getCardDataFromElement(el, hand)).filter(Boolean); if (newHand.length === hand.length) { socket.emit('rearrangeHand', { newHand }); } } });

        container.addEventListener('dragover', e => {
            e.preventDefault();
            const draggingCard = document.querySelector('.dragging'); if (!draggingCard) return;
            const closestCard = getClosestCard(container, e.clientX, e.clientY);
            if (closestCard) { const box = closestCard.getBoundingClientRect(); if (e.clientX < box.left + box.width / 2) { container.insertBefore(draggingCard, closestCard); } else { const nextSibling = closestCard.nextSibling; if (nextSibling) { container.insertBefore(draggingCard, nextSibling); } else { container.appendChild(draggingCard); } } } else { container.appendChild(draggingCard); }
        });
    }

    socket.on('trickWon', ({ winnerName }) => {
        const overlay = document.getElementById('trick-winner-overlay');
        overlay.textContent = `${winnerName} wins the trick!`;
        overlay.classList.add('show');
        setTimeout(() => overlay.classList.remove('show'), 2900);
    });

    socket.on('youWereMarkedAFK', () => {
        const afkModal = document.getElementById('afk-notification-modal');
        afkModal.style.display = 'flex';
        afkModal.classList.remove('hidden');
    });

    socket.on('joinSuccess', ({ playerId, lobby }) => {
        myPersistentPlayerId = playerId;
        sessionStorage.setItem('judgmentPlayerId', playerId);
        const myLobbyInfo = lobby.find(p => p.playerId === playerId);
        if (myLobbyInfo) {
            sessionStorage.setItem('judgmentPlayerName', myLobbyInfo.name);
        }
        renderLobby(lobby);
    });

    socket.on('lobbyUpdate', (players) => {
        if (lobbyReturnInterval) clearInterval(lobbyReturnInterval);
        document.getElementById('scoreboard-modal').style.display = 'none';
        document.getElementById('scoreboard-modal').classList.add('hidden');
        document.getElementById('game-log-list').innerHTML = '';
        isInitialGameRender = true;
        renderLobby(players);
    });

    socket.on('forceDisconnect', () => {
        sessionStorage.removeItem('judgmentPlayerId');
        sessionStorage.removeItem('judgmentPlayerName');
        location.reload();
    });

    function launchConfetti() {
        const overlay = document.getElementById('winner-celebration-overlay');
        const colors = ['#daa520', '#ffc400', '#f5f5dc', '#8c5b4f'];
        for (let i = 0; i < 150; i++) {
            const confetti = document.createElement('div');
            confetti.className = 'confetti';
            confetti.style.left = `${Math.random() * 100}vw`;
            confetti.style.animationDelay = `${Math.random() * 3}s`;
            confetti.style.animationDuration = `${2 + Math.random() * 3}s`;
            confetti.style.backgroundColor = colors[Math.floor(Math.random() * colors.length)];
            overlay.appendChild(confetti);
        }
    }

    socket.on('finalGameOver', ({ gameState, winners }) => {
        if (pauseCountdownInterval) clearInterval(pauseCountdownInterval);
        const overlay = document.getElementById('winner-celebration-overlay');
        let winnerText = '';
        if (winners && winners.length > 0) {
            if (winners.length > 1) {
                winnerText = `Game Over! It's a TIE between ${winners.map(w => w.name).join(' & ')}!`;
            } else {
                winnerText = `Game Over! ${winners[0].name} WINS!!`;
            }
        } else {
            winnerText = "Game Over!";
        }
        overlay.innerHTML = `<h1 class="winner-text">${winnerText}</h1>`;
        launchConfetti();
        overlay.classList.remove('hidden');

        setTimeout(() => {
            overlay.classList.add('hidden');
            overlay.innerHTML = '';

            updateGameStatusBanner(gameState);

            const scoreboardModal = document.getElementById('scoreboard-modal');
            document.getElementById('scoreboard-title').textContent = "Final Results";
            document.getElementById('next-round-preview').style.display = 'none';
            document.getElementById('host-round-end-controls').style.display = 'none';
            document.getElementById('player-round-end-controls').style.display = 'none';
            renderScoreboard(gameState);

            const countdownEl = document.getElementById('lobby-return-countdown');
            countdownEl.style.display = 'block';
            let count = 20;
            if (lobbyReturnInterval) clearInterval(lobbyReturnInterval);
            const updateCountdown = () => {
                countdownEl.textContent = `Returning to lobby in ${count}s...`;
                count--;
                if (count < 0) {
                    clearInterval(lobbyReturnInterval);
                }
            };
            updateCountdown();
            lobbyReturnInterval = setInterval(updateCountdown, 1000);

            scoreboardModal.style.display = 'flex';
            scoreboardModal.classList.remove('hidden');
        }, 5000);
    });

    const toastNotification = document.getElementById('toast-notification'); function showToast(message) { toastNotification.textContent = message; toastNotification.classList.add('show'); setTimeout(() => toastNotification.classList.remove('show'), 3000); }

    function renderLobby(players) {
        const me = players.find(p => p.playerId === myPersistentPlayerId);
        if (!me) {
             if (sessionStorage.getItem('judgmentPlayerId')) {
                sessionStorage.removeItem('judgmentPlayerId');
                sessionStorage.removeItem('judgmentPlayerName');
                location.reload();
             }
             return;
        }

        document.getElementById('join-screen').style.display = 'none';
        document.getElementById('game-board').style.display = 'none';
        const lobbyScreen = document.getElementById('lobby-screen');
        lobbyScreen.style.display = 'block';
        const playerList = document.getElementById('player-list');
        playerList.innerHTML = '';

        const readyBtn = document.getElementById('ready-btn');
        readyBtn.textContent = 'Ready';
        readyBtn.disabled = me.isReady;

        players.forEach(player => {
            const playerItem = document.createElement('li');
            let content = `<span class="player-name">${player.name}</span>`;
            if (player.isHost) content += ' 👑 (Host)';
            if (player.playerId === myPersistentPlayerId) content += ' (You)';
            if (!player.active) {
                playerItem.classList.add('inactive-lobby-player');
                content += ' (Offline)';
            }
            const readyStatus = `<span class="ready-status">${player.isReady ? '✅ Ready' : '❌ Not Ready'}</span>`;
            let kickButton = '';
            if (me.isHost && player.playerId !== myPersistentPlayerId) {
                kickButton = `<button class="kick-btn" data-player-id="${player.playerId}">Kick</button>`;
            }
            playerItem.innerHTML = `<div>${content}</div><div>${readyStatus}${kickButton}</div>`;
            playerList.appendChild(playerItem);
        });

        const playerActions = document.getElementById('player-lobby-actions');
        const hostActions = document.getElementById('host-lobby-actions');

        if (me.isHost) {
            playerActions.style.display = 'none';
            hostActions.style.display = 'flex';
        } else {
            playerActions.style.display = 'flex';
            hostActions.style.display = 'none';
        }
        document.getElementById('host-message').style.display = me.isHost ? 'none' : 'block';
    }

    function renderGameBoard(gs) {
        const myPlayer = gs.players.find(p => p.playerId === myPersistentPlayerId);
        if (!myPlayer) return;
        renderLeftColumn(gs, myPlayer);
        renderCenterColumn(gs);
        renderRightColumn(gs);
        updateGameStatusBanner(gs);
        // Ensure endGameBtn exists before trying to access its style
        const endGameBtn = document.getElementById('endGameBtn');
        if (endGameBtn) {
            endGameBtn.style.display = myPlayer.isHost ? 'block' : 'none';
        }
    }

    // MODIFIED: Added explicit check for bidding phase to show banner.
    function renderLeftColumn(gs, localPlayer) {
        if (!localPlayer) return;
        document.getElementById('rearrange-hand-btn').style.display = (localPlayer.hand && localPlayer.hand.length > 0) ? 'block' : 'none';
        document.getElementById('local-player-stats').innerHTML = `<h3>${localPlayer.name} (You)</h3>`;
        document.getElementById('my-bid-value').textContent = localPlayer.bid ?? '-';
        document.getElementById('my-tricks-value').textContent = localPlayer.tricksWon;
        document.getElementById('my-score-value').textContent = localPlayer.score;

        const trumpTile = document.getElementById('trump-vitals-tile');
        const cardsTile = document.getElementById('cards-vitals-tile');
        const bidsTile = document.getElementById('bids-vitals-tile');

        const totalBids = gs.players.reduce((sum, p) => p.bid !== null ? sum + p.bid : sum, 0);
        const trumpContent = gs.trumpSuit === 'No Trump'
            ? `<div class="no-trump-value">NO TRUMP</div>`
            : `<img src="/cards/suit_${gs.trumpSuit.toLowerCase()}.svg" class="trump-icon" />`;

        trumpTile.innerHTML = `<div class="label">Trump</div>${trumpContent}`;
        cardsTile.innerHTML = `<div class="label">Cards Dealt</div><div class="value">${gs.numCardsToDeal}</div>`;
        bidsTile.innerHTML = `<div class="label">Current Total Bids</div><div class="value">${totalBids}/${gs.numCardsToDeal}</div>`;

        const handArea = document.getElementById('local-player-hand-area');
        handArea.innerHTML = '';
        const cardContainer = document.createElement('div');
        cardContainer.className = 'card-container';
        localPlayer.hand.forEach(card => {
            const cardEl = createCardElement(card);
            cardEl.draggable = true;
            if (gs.phase === 'Playing' && gs.players[gs.currentPlayerIndex]?.playerId === myPersistentPlayerId && !gs.isPaused) {
                cardEl.classList.add('clickable');
            }
            cardContainer.appendChild(cardEl);
        });
        setupHandInteractions(cardContainer, localPlayer.hand);
        handArea.appendChild(cardContainer);

        const myIndex = gs.players.findIndex(p => p.playerId === myPersistentPlayerId);
        const actionBanner = document.getElementById('action-banner');
        const actionText = document.getElementById('action-banner-text');
        const inputArea = document.getElementById('action-banner-input-area');

        if(actionBannerCountdownInterval) clearInterval(actionBannerCountdownInterval);

        let showBanner = false; // Default to hidden

        if (!gs.isPaused) {
             if (gs.phase === 'Bidding' && gs.biddingPlayerIndex === myIndex) {
                // Check if the banner isn't already visible from promptForBid (avoids flicker)
                if (actionBanner.style.display !== 'block') {
                    actionText.textContent = 'Your turn to BID!';
                    inputArea.style.display = 'flex';
                    // Re-populate dropdown just in case state changed mid-render
                    const bidInput = document.getElementById('bid-input');
                    bidInput.innerHTML = '';
                    for (let i = 0; i <= gs.numCardsToDeal; i++) {
                        const option = document.createElement('option');
                        option.value = i;
                        option.textContent = i;
                        bidInput.appendChild(option);
                    }
                }
                showBanner = true; // Mark banner to be shown
            }
            else if (gs.phase === 'Playing' && gs.currentPlayerIndex === myIndex && localPlayer.hand.length > 0) {
                actionText.textContent = 'Your turn to PLAY!';
                inputArea.style.display = 'none';
                showBanner = true;
            } else if (gs.phase === 'TrickReview' && gs.trickWinnerId === localPlayer.playerId) {
                const updateActionTimer = () => {
                    const remaining = Math.max(0, Math.round((gs.nextTrickReviewEnd - Date.now()) / 1000));
                    actionText.textContent = `Your turn to play in ${remaining}s`;
                    if (remaining <= 0) clearInterval(actionBannerCountdownInterval);
                };
                updateActionTimer(); // Run immediately
                actionBannerCountdownInterval = setInterval(updateActionTimer, 1000);
                inputArea.style.display = 'none';
                showBanner = true;
            }
        }

        actionBanner.style.display = showBanner ? 'block' : 'none';
        if (!showBanner || gs.phase !== 'Bidding') {
             inputArea.style.display = 'none'; // Ensure input area is hidden if not bidding turn
        }
    }


    function renderCenterColumn(gs) { const slotsContainer = document.getElementById('player-slots-container'); slotsContainer.innerHTML = ''; const playerOrder = getFixedPlayerOrder(gs.players, gs.dealerIndex); playerOrder.forEach(player => { slotsContainer.appendChild(createPlayerSlot(player, gs)); }); }

    function renderRightColumn(gs) {
        document.getElementById('round-title-board').innerHTML = `Round ${gs.roundNumber}`;
        document.getElementById('cards-dealt-board').innerHTML = `<div class="label">Cards Dealt</div><div class="value">${gs.numCardsToDeal}</div>`;
        const currentBidTotal = gs.players.reduce((sum, p) => p.bid !== null ? sum + p.bid : sum, 0);
        document.getElementById('total-bids-board').innerHTML = `<div class="label">Total Bids</div><div class="value">${currentBidTotal}</div>`;
        document.getElementById('trump-info-panel').innerHTML = `<h4>Trump</h4><div class="trump-display">${getSuitSymbol(gs.trumpSuit, true)}<span class="trump-text">${gs.trumpSuit}</span></div>`;
        document.getElementById('lead-suit-info-panel').innerHTML = `<h4>Lead Suit</h4>` + (gs.leadSuit ? getSuitSymbol(gs.leadSuit, true) : '---');

        const viewLastTrickBtn = document.getElementById('view-last-trick-btn');
        if (gs.lastCompletedTrick) {
            viewLastTrickBtn.style.display = 'block';
        } else {
            viewLastTrickBtn.style.display = 'none';
        }
        renderGameLog(gs);
    }

    function renderScoreboard(gs) {
        const container = document.getElementById('scoreboard-table-container');
        container.innerHTML = '';
        const table = document.createElement('table');

        // --- *** MODIFICATION: Apply new uniform class *** ---
        table.className = 'uniform-score-table';
        // --- *** END MODIFICATION *** ---

        let headerHtml = '<thead><tr><th>Round Details</th>';
        gs.players.forEach(p => headerHtml += `<th>${p.name}</th>`);
        headerHtml += '</tr></thead>';
        let bodyHtml = '<tbody>';
        for (let i = 0; i < gs.roundNumber; i++) {
            const round = i + 1;
            const cardsDealt = gs.maxRounds - i;
            const trumpCycle = ['Spades', 'Hearts', 'Diamonds', 'Clubs', 'No Trump'];
            const trump = trumpCycle[i % 5];
            bodyHtml += `<tr><td>R${round} (${cardsDealt} cards, ${getSuitSymbol(trump)})</td>`;
            gs.players.forEach(p => {
                const score = p.scoreHistory[i];
                if (score === null) {
                    bodyHtml += `<td>—</td>`;
                } else if (score !== undefined) {
                    const isCorrect = score > 0;
                    bodyHtml += `<td class="${isCorrect ? 'correct-bid' : 'incorrect-bid'} score-col">${score > 0 ? '+' : ''}${score}</td>`; // Added score-col
                } else {
                    bodyHtml += `<td>-</td>`;
                }
            });
            bodyHtml += '</tr>';
        }
        bodyHtml += '</tbody>';
        let footerHtml = '<tfoot><tr><td><strong>Total</strong></td>';
        gs.players.forEach(p => footerHtml += `<td class="score-col"><strong>${p.score}</strong></td>`); // Added score-col
        footerHtml += '</tr></tfoot>';
        table.innerHTML = headerHtml + bodyHtml + footerHtml;
        container.appendChild(table);
    }

    function updateGameStatusBanner(gs) {
        const banner = document.getElementById('game-status-banner');
        banner.className = 'game-status-banner';
        if (trickReviewInterval) clearInterval(trickReviewInterval);
        if (pauseCountdownInterval) clearInterval(pauseCountdownInterval);
        if (gs.isPaused && gs.pauseEndTime) {
            banner.classList.add('paused');
            const updateTimer = () => {
                const remaining = Math.max(0, Math.round((gs.pauseEndTime - Date.now()) / 1000));
                const playerNames = gs.pausedForPlayerNames.join(', ');
                banner.innerHTML = `Waiting for <strong>${playerNames}</strong> to rejoin... ${remaining}s ⏳`;
                if (remaining <= 0) clearInterval(pauseCountdownInterval);
            };
            updateTimer();
            pauseCountdownInterval = setInterval(updateTimer, 1000);
            return;
        }
        if (!gs || !gs.players || gs.players.length === 0) { banner.innerHTML = ''; return; }
        switch (gs.phase) {
            case 'Bidding':
                const bidder = gs.players[gs.biddingPlayerIndex];
                banner.innerHTML = `Bidding Phase: Waiting for <strong>${bidder ? bidder.name : '...'}</strong> to Bid`;
                banner.classList.add('bidding-phase');
                break;
            case 'Playing':
                const currentPlayer = gs.players[gs.currentPlayerIndex];
                banner.innerHTML = `Round ${gs.roundNumber}: Waiting for <strong>${currentPlayer ? currentPlayer.name : '...'}</strong> to Play`;
                banner.classList.add('playing-phase');
                break;
            case 'TrickReview':
                const updateTimer = () => {
                    const remaining = Math.max(0, Math.round((gs.nextTrickReviewEnd - Date.now()) / 1000));
                    const trickWinner = gs.players.find(p => p.playerId === gs.trickWinnerId);
                    const winnerName = trickWinner ? trickWinner.name : '...';
                    banner.innerHTML = `Next trick starts by <strong>${winnerName}</strong> in ${remaining}s`;
                    if (remaining <= 0) clearInterval(trickReviewInterval);
                };
                updateTimer();
                trickReviewInterval = setInterval(updateTimer, 1000);
                break;
            case 'RoundOver':
                banner.innerHTML = `Round ${gs.roundNumber} over; Waiting for the Host to start Round ${gs.roundNumber + 1}`;
                break;
            case 'GameOver':
                banner.innerHTML = 'Game Over! Returning to lobby shortly...';
                break;
            default:
                banner.innerHTML = '';
        }
    }

    function renderLastTrickModal(gs) {
        const lastTrickData = gs.lastCompletedTrick;
        if (!lastTrickData) return;

        const detailsContainer = document.getElementById('last-trick-details');
        const modal = document.getElementById('last-trick-modal');
        detailsContainer.innerHTML = '';

        lastTrickData.trick.forEach(play => {
            const row = document.createElement('div');
            row.className = 'last-trick-row';

            const nameEl = document.createElement('span');
            nameEl.className = 'player-name';
            nameEl.textContent = play.name;

            if (play.playerId === lastTrickData.winnerId) {
                row.classList.add('winner');
                nameEl.textContent += ' 🏆';
            }

            const cardEl = createCardElement(play.card);

            row.appendChild(nameEl);
            row.appendChild(cardEl);
            detailsContainer.appendChild(row);
        });

        modal.classList.remove('hidden');
    }

    function createBidProgressHTML(player) {
        if (player.bid === null) {
            return `<span class="bidding-text">Bidding...</span>`;
        }

        const bid = player.bid;
        const tricksWon = player.tricksWon;
        let iconsHTML = '';

        const iconWon = `<svg class="trick-icon trick-won" viewBox="0 0 100 100"><circle cx="50" cy="50" r="48" fill="#daa520" stroke="#f5f5dc" stroke-width="4"/><path d="M30 50 L45 65 L70 40" stroke="#4a2c2a" stroke-width="8" fill="none" stroke-linecap="round"/></svg>`;
        const iconBusted = `<svg class="trick-icon trick-busted" viewBox="0 0 100 100"><circle cx="50" cy="50" r="48" fill="#c70039" stroke="#f5f5dc" stroke-width="4"/><path d="M30 30 L70 70 M70 30 L30 70" stroke="#f5f5dc" stroke-width="8" fill="none" stroke-linecap="round"/></svg>`;
        const iconTarget = `<svg class="trick-icon bid-target" viewBox="0 0 100 100"><circle cx="50" cy="50" r="48" fill="none" stroke="#f5f5dc" stroke-width="4" stroke-dasharray="10 5"/></svg>`;

        if (bid === 0) {
            if (tricksWon === 0) {
                return `<div class="trick-icon zero-bid-icon">ZERO</div>`;
            } else {
                for (let i = 0; i < tricksWon; i++) {
                    iconsHTML += iconBusted;
                }
                return iconsHTML;
            }
        }

        const isBusted = tricksWon > bid;
        if (isBusted) {
            for (let i = 0; i < bid; i++) iconsHTML += iconWon;
            for (let i = 0; i < tricksWon - bid; i++) iconsHTML += iconBusted;
        } else {
            for (let i = 0; i < tricksWon; i++) iconsHTML += iconWon;
            for (let i = tricksWon; i < bid; i++) iconsHTML += iconTarget;
        }

        return iconsHTML;
    }

    function createPlayerSlot(player, gs) {
        const slot = document.createElement('div');
        slot.className = 'player-slot';
        const isActivePlayer = (gs.phase === 'Bidding' && gs.players[gs.biddingPlayerIndex]?.playerId === player.playerId) || (gs.phase === 'Playing' && gs.players[gs.currentPlayerIndex]?.playerId === player.playerId);
        if (isActivePlayer && !gs.isPaused) { slot.classList.add('active-player'); }

        const info = document.createElement('div');
        info.className = 'player-slot-info';

        const topRow = document.createElement('div');
        topRow.className = 'player-plaque-top';

        let nameClass = "player-name";
        let statusText = '';
        if (player.status === 'Disconnected') { nameClass += " disconnected"; statusText = ' (Disconnected)'; }
        else if (player.status === 'Removed') { nameClass += " removed"; statusText = ' (Removed)'; }

        const nameDiv = document.createElement('div');
        nameDiv.className = nameClass;
        nameDiv.textContent = player.name + statusText;

        const actionsGroup = document.createElement('div');
        actionsGroup.className = 'player-actions-group';

        if (player.bid !== null) {
            const bidTile = document.createElement('div');
            bidTile.className = 'bid-tile';
            bidTile.textContent = `Bid: ${player.bid}`;
            actionsGroup.appendChild(bidTile);
        }

        const myPlayer = gs.players.find(p => p.playerId === myPersistentPlayerId);
        if (myPlayer && myPlayer.isHost && player.playerId !== myPersistentPlayerId && player.status === 'Active') {
            const afkButton = document.createElement('button');
            afkButton.className = 'mark-afk-btn';
            afkButton.textContent = 'AFK';
            // Attach listener directly here as it's created dynamically
            afkButton.addEventListener('click', (e) => {
                e.stopPropagation();
                socket.emit('markPlayerAFK', { playerIdToMark: player.playerId });
            });
            actionsGroup.appendChild(afkButton);
        }

        const scoreDiv = document.createElement('div');
        scoreDiv.className = 'player-score-bubble';
        scoreDiv.textContent = player.score;
        actionsGroup.appendChild(scoreDiv);

        topRow.appendChild(nameDiv);
        topRow.appendChild(actionsGroup);

        const bidProgressDiv = document.createElement('div');
        bidProgressDiv.className = 'bid-progress-container';
        bidProgressDiv.innerHTML = createBidProgressHTML(player);

        info.appendChild(topRow);
        info.appendChild(bidProgressDiv);

        const cardPlaceholder = document.createElement('div');
        cardPlaceholder.className = 'card-placeholder';

        // --- NEW: Add drag-and-drop listeners ONLY for my player's placeholder ---
        if (player.playerId === myPersistentPlayerId) {
            const localPlayer = window.gameState.players.find(p => p.playerId === myPersistentPlayerId);

            cardPlaceholder.addEventListener('dragover', (e) => {
                const isMyTurn = (gs.phase === 'Playing' && gs.players[gs.currentPlayerIndex]?.playerId === player.playerId && !gs.isPaused);
                if (isMyTurn) {
                    e.preventDefault(); // Allow drop
                    cardPlaceholder.classList.add('droppable');
                }
            });

            cardPlaceholder.addEventListener('dragleave', () => {
                cardPlaceholder.classList.remove('droppable');
            });

            cardPlaceholder.addEventListener('drop', (e) => {
                e.preventDefault();
                cardPlaceholder.classList.remove('droppable');
                const cardIdentifier = e.dataTransfer.getData('text/plain');
                if (cardIdentifier && localPlayer) {
                    const card = getCardDataFromElement({ dataset: { card: cardIdentifier } }, localPlayer.hand);
                    if (card) {
                        socket.emit('playCard', { card });
                    }
                }
            });
        }
        // --- END NEW ---

        const playedCard = gs.currentTrick.find(p => p.playerId === player.playerId);
        if (playedCard) {
            const cardEl = createCardElement(playedCard.card);
            const latestPlay = gs.currentTrick[gs.currentTrick.length - 1];
            if (playedCard.playerId === latestPlay.playerId) { cardEl.classList.add('newly-played'); }
            cardPlaceholder.appendChild(cardEl);
        }
        if (gs.currentWinningPlayerId === player.playerId) {
            const indicator = document.createElement('div');
            indicator.className = 'winning-indicator';
            indicator.textContent = '🏆';
            cardPlaceholder.appendChild(indicator);
        }

        slot.appendChild(info);
        slot.appendChild(cardPlaceholder);
        return slot;
    }

    function getFixedPlayerOrder(players, dealerIndex) { let sorted = []; const numPlayers = players.length; if (dealerIndex === -1) return players.slice().sort((a,b) => a.playOrder - b.playOrder); let startIndex = (dealerIndex + 1) % numPlayers; for (let i = 0; i < numPlayers; i++) { const player = players.find(p => p.playOrder === startIndex); if (player) sorted.push(player); startIndex = (startIndex + 1) % numPlayers; } return sorted; }
    function getCardDataFromElement(el, hand) { if (!el.dataset.card) return null; const [suit, rankName] = el.dataset.card.split('_'); const cardRank = Object.keys(rankMap).find(key => rankMap[key] === rankName); const cardSuit = suit.charAt(0).toUpperCase() + suit.slice(1); return hand.find(c => c.suit === cardSuit && c.rank === cardRank); }
    function createCardElement(card) { const cardEl = document.createElement('div'); cardEl.className = 'card'; cardEl.dataset.card = `${card.suit.toLowerCase()}_${rankMap[card.rank]}`; const rankName = rankMap[card.rank]; const suitName = card.suit.toLowerCase(); const imageName = `${suitName}_${rankName}.svg`; cardEl.style.backgroundImage = `url('/cards/${imageName}')`; return cardEl; }
    function getSuitSymbol(suit, isImage = false) { const symbols = { 'Spades': '♠️', 'Hearts': '♥️', 'Diamonds': '♦️', 'Clubs': '♣️', 'No Trump': 'NT' }; if (isImage) { if (suit === 'No Trump') return `<div class="no-trump">NO TRUMP</div>`; const suitName = suit?.toLowerCase(); if (!suitName) return '---'; return `<img src="/cards/suit_${suitName}.svg" alt="${suit}">`; } return symbols[suit] || suit; }

    function renderGameLog(gs) {
        const gameLogList = document.getElementById('game-log-list');
        gameLogList.innerHTML = '';
        if (gs.logHistory) {
            const logsToDisplay = gs.logHistory.slice(-12);
            logsToDisplay.forEach(message => {
                const li = document.createElement('li');
                li.innerHTML = message;
                gameLogList.prepend(li);
            });
        }
    }

    function makeDraggable(modal) {
        const modalContent = modal.querySelector('.modal-content');
        const header = modal.querySelector('.modal-header');
        if (!header) return;

        let pos1 = 0, pos2 = 0, pos3 = 0, pos4 = 0;

        const dragMouseDown = (e) => {
            // Only allow dragging if the direct target is the header
            if (e.target !== header) return;
            e.preventDefault();
            pos3 = e.clientX;
            pos4 = e.clientY;
            document.onmouseup = closeDragElement;
            document.onmousemove = elementDrag;
        };

        const elementDrag = (e) => {
            e.preventDefault();
            pos1 = pos3 - e.clientX;
            pos2 = pos4 - e.clientY;
            pos3 = e.clientX;
            pos4 = e.clientY;

            // Use translate for smoother performance if transform isn't manually set
            if (!modalContent.style.transform || modalContent.style.transform === 'translate(-50%, -50%)') {
                 modalContent.style.left = '50%';
                 modalContent.style.top = '50%';
                 modalContent.style.transform = `translate(calc(-50% + ${modalContent.offsetLeft - pos1}px), calc(-50% + ${modalContent.offsetTop - pos2}px))`;
            } else {
                 modalContent.style.top = (modalContent.offsetTop - pos2) + "px";
                 modalContent.style.left = (modalContent.offsetLeft - pos1) + "px";
            }
        };


        const closeDragElement = () => {
            document.onmouseup = null;
            document.onmousemove = null;
        };

        const dragTouchStart = (e) => {
            // Only allow dragging if the direct target is the header
             if (e.target !== header) return;
            if (e.touches.length === 1) {
                const touch = e.touches[0];
                pos3 = touch.clientX;
                pos4 = touch.clientY;
                document.ontouchend = closeTouchDragElement;
                document.ontouchmove = elementTouchDrag;
            }
        };

        const elementTouchDrag = (e) => {
            if (e.touches.length === 1) {
                // Prevent default scrolling behavior during drag
                e.preventDefault();
                const touch = e.touches[0];
                pos1 = pos3 - touch.clientX;
                pos2 = pos4 - touch.clientY;
                pos3 = touch.clientX;
                pos4 = touch.clientY;

                 // Use translate for smoother performance
                if (!modalContent.style.transform || modalContent.style.transform === 'translate(-50%, -50%)') {
                     modalContent.style.left = '50%';
                     modalContent.style.top = '50%';
                     modalContent.style.transform = `translate(calc(-50% + ${modalContent.offsetLeft - pos1}px), calc(-50% + ${modalContent.offsetTop - pos2}px))`;
                } else {
                    modalContent.style.top = (modalContent.offsetTop - pos2) + "px";
                    modalContent.style.left = (modalContent.offsetLeft - pos1) + "px";
                }
            }
        };


        const closeTouchDragElement = () => {
            document.ontouchend = null;
            document.ontouchmove = null;
        };

        header.addEventListener('mousedown', dragMouseDown);
        header.addEventListener('touchstart', dragTouchStart, { passive: false }); // Need passive: false to preventDefault in touchmove
    }


    // --- NEW: Function to show move announcements ---
    function showMoveAnnouncement(message) {
        const banner = document.getElementById('move-announcement-banner');
        if (!banner) return;

        banner.textContent = message;
        banner.classList.remove('hidden');

        if (moveAnnouncementTimeout) {
            clearTimeout(moveAnnouncementTimeout);
        }

        moveAnnouncementTimeout = setTimeout(() => {
            banner.classList.add('hidden');
            moveAnnouncementTimeout = null;
        }, 3000); // 3-second duration
    }

    // --- NEW: Function to handle move announcements ---
    function handleMoveAnnouncement(currentState, prevState) {
        if (!prevState || !currentState || !currentState.logHistory || currentState.logHistory.length === 0) {
            return;
        }

        // Don't show toasts if I am disconnected or removed
        const me = currentState.players.find(p => p.playerId === myPersistentPlayerId);
        if (me && (me.status === 'Removed' || me.status === 'Disconnected')) {
            return;
        }

        const latestLog = currentState.logHistory[0];
        const previousLog = prevState.logHistory[0];

        // Skip if log hasn't changed or is a non-move
        if (latestLog === previousLog || latestLog.includes('Round ') || latestLog.includes('GAME OVER') || latestLog.includes('Bidding complete')) {
             return;
        }

        let message = "";
        let nextPlayerName = "Unknown";

        // Find next player
        if (currentState.phase === 'Playing' && currentState.players[currentState.currentPlayerIndex]) {
            nextPlayerName = currentState.players[currentState.currentPlayerIndex].name;
        } else if (currentState.phase === 'Bidding' && currentState.players[currentState.biddingPlayerIndex]) {
            nextPlayerName = currentState.players[currentState.biddingPlayerIndex].name;
        } else if (currentState.phase === 'TrickReview') {
             const winner = currentState.players.find(p => p.playerId === currentState.trickWinnerId);
             if(winner) nextPlayerName = winner.name;
        }

        // Parse log message
        if (latestLog.includes(' bids ')) {
            const match = latestLog.match(/📣 (.+?) bids (\d+)\./);
            if (match) {
                 message = `${match[1]} bids ${match[2]}. Next: ${nextPlayerName}`;
            }
        } else if (latestLog.includes(' played the ')) {
            const match = latestLog.match(/› (.+?) played the (.+? of .+)\./);
            if(match) {
                 message = `${match[1]} played ${match[2]}. Next: ${nextPlayerName}`;
            }
        } else if (latestLog.includes(' wins the trick!')) {
             const match = latestLog.match(/🏆 (.+?) wins the trick!/);
             if (match) {
                 message = `${match[1]} wins the trick! Next: ${nextPlayerName}`;
             }
        }

        if (message) {
            showMoveAnnouncement(message);
        }
    }


    makeDraggable(document.getElementById('scoreboard-modal'));
    makeDraggable(document.getElementById('confirm-end-game-modal'));
    makeDraggable(document.getElementById('last-trick-modal'));
    makeDraggable(document.getElementById('afk-notification-modal'));
    makeDraggable(document.getElementById('confirm-hard-reset-modal'));
    makeDraggable(document.getElementById('warning-modal'));
    makeDraggable(document.getElementById('confirm-bid-modal')); // *** Make new modal draggable ***
});