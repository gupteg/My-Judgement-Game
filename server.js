const http = require('http');
const express = require('express');
const path = require('path');
const { Server } = require("socket.io");

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static(path.join(__dirname, 'public')));
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

let players = [];
let gameState = null;
const reconnectTimers = {};
const DISCONNECT_GRACE_PERIOD = 60000;
const TURN_TIMER_DURATION = 90000; // 90 seconds
let gameOverCleanupTimer = null;

const SUITS = ['Spades', 'Hearts', 'Diamonds', 'Clubs'];
const RANKS = ['2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A'];
const RANK_VALUES = { '2': 2, '3': 3, '4': 4, '5': 5, '6': 6, '7': 7, '8': 8, '9': 9, '10': 10, 'J': 11, 'Q': 12, 'K': 13, 'A': 14 };

function clearTurnTimer() {
    if (gameState && gameState.turnTimerId) {
        clearTimeout(gameState.turnTimerId);
        gameState.turnTimerId = null;
        gameState.turnEndTime = null;
    }
}

function startTurnTimer() {
    clearTurnTimer();
    if (!gameState || gameState.isPaused) return;

    const activePlayerIndex = gameState.phase === 'Bidding' ? gameState.biddingPlayerIndex : gameState.currentPlayerIndex;
    if (activePlayerIndex === null) return;
    
    gameState.turnEndTime = Date.now() + TURN_TIMER_DURATION;

    gameState.turnTimerId = setTimeout(() => {
        if (!gameState) return;
        const player = gameState.players[activePlayerIndex];
        if (player) {
            player.isInactive = true;
            io.emit('gameLog', `Player ${player.name} is inactive. The host can now remove them.`);
            clearTurnTimer();
            io.emit('updateGameState', gameState);
        }
    }, TURN_TIMER_DURATION);
}

function startNextTrick() {
    if (!gameState || gameState.isPaused || gameState.phase !== 'TrickReview') return;

    let winnerIndex = gameState.players.findIndex(p => p.playerId === gameState.trickWinnerId);
    gameState.phase = 'Playing';
    gameState.currentTrick = [];
    gameState.leadSuit = null;
    gameState.trickWinnerId = null;
    gameState.nextTrickReviewEnd = null;
    gameState.currentWinningPlayerId = null;

    if (winnerIndex === -1 || gameState.players[winnerIndex].status !== 'Active') {
        gameState.currentPlayerIndex = findNextActivePlayer(winnerIndex, gameState.players, false);
    } else {
        gameState.currentPlayerIndex = winnerIndex;
    }
    startTurnTimer();
    io.emit('updateGameState', gameState);
}

function findNextActivePlayer(startIndex, players, startFromNext = true) {
    const numPlayers = players.length;
    if (numPlayers === 0 || players.every(p => p.status !== 'Active')) return null;
    let nextIndex = startFromNext ? (startIndex + 1) % numPlayers : startIndex;
    let checkedCount = 0;
    while (players[nextIndex].status !== 'Active' && checkedCount < numPlayers) {
        nextIndex = (nextIndex + 1) % numPlayers;
        checkedCount++;
    }
    return players[nextIndex].status === 'Active' ? nextIndex : null;
}

function createDeck() { return SUITS.flatMap(suit => RANKS.map(rank => ({ suit, rank, value: RANK_VALUES[rank] }))); }
function shuffleDeck(deck) { for (let i = deck.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1));[deck[i], deck[j]] = [deck[j], deck[i]]; } return deck; }

function setupGame(lobbyPlayers) {
    const numPlayers = lobbyPlayers.length;
    const maxCards = Math.floor(52 / numPlayers);
    const gamePlayers = lobbyPlayers.map((p, i) => ({
        playerId: p.playerId, socketId: p.socketId, name: p.name, isHost: p.isHost,
        score: 0, hand: [], bid: null, tricksWon: 0, scoreHistory: [], playOrder: i,
        status: 'Active', isInactive: false,
    }));
    return {
        players: gamePlayers, roundNumber: 0, maxRounds: maxCards, dealerIndex: -1, numCardsToDeal: 0,
        trumpSuit: null, leadSuit: null, currentTrick: [], currentWinningPlayerId: null, trickWinnerId: null,
        lastCompletedTrick: null, isPaused: false, pausedForPlayerNames: [], pauseEndTime: null,
        phase: 'Bidding', nextRoundInfo: null, nextTrickReviewEnd: null,
        turnTimerId: null, turnEndTime: null,
    };
}

function startNewRound() {
    gameState.roundNumber++;
    gameState.numCardsToDeal = gameState.maxRounds - (gameState.roundNumber - 1);
    if (gameState.numCardsToDeal < 1) { return handleGameOver(); }
    gameState.dealerIndex = findNextActivePlayer(gameState.dealerIndex, gameState.players);
    const trumpCycle = ['Spades', 'Hearts', 'Diamonds', 'Clubs', 'No Trump'];
    gameState.trumpSuit = trumpCycle[(gameState.roundNumber - 1) % 5];
    let deck = shuffleDeck(createDeck());
    gameState.players.forEach(p => {
        if (p.status === 'Active') { p.hand = deck.splice(0, gameState.numCardsToDeal); }
        p.bid = null; p.tricksWon = 0; p.isInactive = false;
    });
    const biddingPlayerIndex = findNextActivePlayer(gameState.dealerIndex, gameState.players);
    Object.assign(gameState, {
        currentTrick: [], leadSuit: null, currentWinningPlayerId: null, trickWinnerId: null,
        lastCompletedTrick: null, phase: 'Bidding', nextRoundInfo: null, 
        biddingPlayerIndex: biddingPlayerIndex, currentPlayerIndex: null,
    });
    startTurnTimer();
    io.emit('gameLog', `Round ${gameState.roundNumber} begins. Cards: ${gameState.numCardsToDeal}. Trump: ${gameState.trumpSuit}.`);
    io.emit('updateGameState', gameState);
    const firstBidder = gameState.players[biddingPlayerIndex];
    if (firstBidder) { io.to(firstBidder.socketId).emit('promptForBid', { maxBid: gameState.numCardsToDeal }); }
}

function handleEndOfRound() {
    clearTurnTimer();
    gameState.players.forEach(p => {
        if (p.status !== 'Active') { p.scoreHistory.push(null); return; }
        let roundScore = (p.tricksWon === p.bid) ? (10 + p.bid) : (p.bid * -1);
        p.score += roundScore;
        p.scoreHistory.push(roundScore);
    });
    if (gameState.numCardsToDeal <= 1) { return handleGameOver(); }
    gameState.phase = 'RoundOver';
    const nextRoundNumber = gameState.roundNumber + 1;
    const nextNumCards = gameState.maxRounds - (nextRoundNumber - 1);
    const trumpCycle = ['Spades', 'Hearts', 'Diamonds', 'Clubs', 'No Trump'];
    const nextDealerIndex = findNextActivePlayer(gameState.dealerIndex, gameState.players);
    const nextDealer = gameState.players[nextDealerIndex];
    gameState.nextRoundInfo = {
        nextNumCards: nextNumCards,
        nextTrumpSuit: (nextNumCards > 0) ? trumpCycle[(nextRoundNumber - 1) % 5] : 'None',
        nextDealerName: nextDealer ? nextDealer.name : 'N/A'
    };
    io.emit('gameLog', `🏁 Round ${gameState.roundNumber} has ended. Scores calculated.`);
    io.emit('updateGameState', gameState);
}

function handleGameOver() {
    clearTurnTimer();
    if (gameState && gameState.phase !== 'GameOver') {
        gameState.phase = 'GameOver';
        Object.values(reconnectTimers).forEach(clearTimeout);
        const eligiblePlayers = gameState.players.filter(p => p.status !== 'Removed');
        const highestScore = Math.max(-Infinity, ...eligiblePlayers.map(p => p.score));
        const winners = eligiblePlayers.filter(p => p.score === highestScore).map(p => ({ name: p.name, score: p.score }));
        io.emit('gameLog', `GAME OVER!`);
        io.emit('finalGameOver', { gameState, winners });

        if (gameOverCleanupTimer) clearTimeout(gameOverCleanupTimer);
        gameOverCleanupTimer = setTimeout(() => {
            if (gameState) {
                console.log('Game over state timed out. Resetting to lobby.');
                const finalPlayers = gameState.players.filter(p => p.status !== 'Removed');
                players = finalPlayers.map(p => ({
                    playerId: p.playerId, socketId: p.socketId, name: p.name,
                    isHost: p.isHost, active: true, isReady: p.isHost
                }));
                gameState = null;
                io.emit('lobbyUpdate', players);
            }
        }, 20000);
    }
}

function updateCurrentWinner(gs) {
    if (gs.currentTrick.length === 0) { gs.currentWinningPlayerId = null; return; }
    const trick = gs.currentTrick; const trump = gs.trumpSuit; let winner = trick[0];
    for (let i = 1; i < trick.length; i++) {
        const currentPlay = trick[i];
        if (winner.card.suit === trump && currentPlay.card.suit !== trump) continue;
        if (winner.card.suit !== trump && currentPlay.card.suit === trump) winner = currentPlay;
        else if (currentPlay.card.suit === winner.card.suit && currentPlay.card.value > winner.card.value) winner = currentPlay;
    }
    gs.currentWinningPlayerId = winner.playerId;
}

function evaluateTrick() {
    clearTurnTimer();
    gameState.lastCompletedTrick = {
        trick: [...gameState.currentTrick],
        winnerId: gameState.currentWinningPlayerId,
    };
    const winnerData = gameState.players.find(p => p.playerId === gameState.currentWinningPlayerId);
    if (winnerData) {
        winnerData.tricksWon++;
        io.emit('trickWon', { winnerName: winnerData.name });
    }
    const allHandsEmpty = gameState.players.filter(p => p.status === 'Active').every(p => p.hand.length === 0);
    if (allHandsEmpty) {
        io.emit('updateGameState', gameState);
        setTimeout(handleEndOfRound, 3000);
        return;
    }
    gameState.phase = 'TrickReview';
    gameState.trickWinnerId = winnerData?.playerId;
    gameState.nextTrickReviewEnd = Date.now() + 10000;
    io.emit('updateGameState', gameState);
    setTimeout(startNextTrick, 10000);
}

function handleGenericPlayerRemoval(playerId, removalType = "reconnect") {
    if (!gameState) return;
    const player = gameState.players.find(p => p.playerId === playerId);
    if (!player) return;
    
    player.status = 'Removed';
    const logMessage = removalType === 'kick' ? `Player ${player.name} was removed by the host for inactivity.` : `Player ${player.name} failed to reconnect and has been removed.`;
    io.emit('gameLog', logMessage);
    
    if (reconnectTimers[playerId]) {
        clearTimeout(reconnectTimers[playerId]);
        delete reconnectTimers[playerId];
    }
    
    if (player.isHost) {
        const nextHost = gameState.players.find(p => p.status === 'Active');
        if (nextHost) {
            nextHost.isHost = true;
            io.emit('gameLog', `Host privileges transferred to ${nextHost.name}.`);
        }
    }
    
    const activePlayers = gameState.players.filter(p => p.status === 'Active');
    if (activePlayers.length < 2) {
        io.emit('gameLog', 'Not enough players to continue. Returning to lobby.');
        const finalPlayers = gameState.players.filter(p => p.status !== 'Removed');
        players = finalPlayers.map(p => ({
            playerId: p.playerId, socketId: p.socketId, name: p.name,
            isHost: p.isHost, active: true, isReady: p.isHost
        }));
        gameState = null;
        clearTurnTimer();
        io.emit('lobbyUpdate', players);
        return;
    }
    
    const wasBiddingPlayer = gameState.phase === 'Bidding' && gameState.biddingPlayerIndex !== null && gameState.players[gameState.biddingPlayerIndex]?.playerId === playerId;
    const wasPlayingPlayer = gameState.phase === 'Playing' && gameState.currentPlayerIndex !== null && gameState.players[gameState.currentPlayerIndex]?.playerId === playerId;
    
    const stillDisconnected = gameState.players.some(p => p.status === 'Disconnected');
    if (!stillDisconnected && gameState.isPaused) {
        gameState.isPaused = false;
        gameState.pausedForPlayerNames = [];
        gameState.pauseEndTime = null;
        if (wasBiddingPlayer || wasPlayingPlayer) {
             startTurnTimer();
        }
    } else {
        gameState.pausedForPlayerNames = gameState.players.filter(p => p.status === 'Disconnected').map(p => p.name);
    }
    
    if (wasBiddingPlayer) {
        const nextBidderIndex = findNextActivePlayer(gameState.biddingPlayerIndex, gameState.players, false);
        gameState.biddingPlayerIndex = nextBidderIndex;
        if (nextBidderIndex !== null) {
            const nextBidder = gameState.players[nextBidderIndex];
            io.to(nextBidder.socketId).emit('promptForBid', { maxBid: gameState.numCardsToDeal });
            startTurnTimer();
        }
    } else if (wasPlayingPlayer) {
        gameState.currentPlayerIndex = findNextActivePlayer(gameState.currentPlayerIndex, gameState.players, false);
        if (gameState.currentPlayerIndex !== null) {
            startTurnTimer();
        }
    }
    
    io.emit('updateGameState', gameState);
}

io.on('connection', (socket) => {
    socket.on('joinGame', ({ playerName, playerId }) => {
        if (gameState) {
            const disconnectedPlayers = gameState.players.filter(p => p.status === 'Disconnected');
            let playerToRejoin = null;
            if (playerId) playerToRejoin = disconnectedPlayers.find(p => p.playerId === playerId);
            if (!playerToRejoin && disconnectedPlayers.length > 0) playerToRejoin = disconnectedPlayers.find(p => p.name === playerName);
            if (playerToRejoin) {
                playerToRejoin.status = 'Active';
                playerToRejoin.socketId = socket.id;
                clearTimeout(reconnectTimers[playerToRejoin.playerId]);
                delete reconnectTimers[playerToRejoin.playerId];
                const stillDisconnected = gameState.players.filter(p => p.status === 'Disconnected');
                if (stillDisconnected.length === 0) {
                    gameState.isPaused = false;
                    gameState.pauseEndTime = null;
                    gameState.pausedForPlayerNames = [];
                    startTurnTimer();
                } else {
                    gameState.pausedForPlayerNames = stillDisconnected.map(p => p.name);
                }
                const playerIndex = gameState.players.findIndex(p => p.playerId === playerToRejoin.playerId);
                if (gameState.phase === 'Bidding' && gameState.biddingPlayerIndex === playerIndex) {
                    io.to(playerToRejoin.socketId).emit('promptForBid', { maxBid: gameState.numCardsToDeal });
                }
                socket.emit('joinSuccess', { playerId: playerToRejoin.playerId, lobby: players });
                io.emit('gameLog', `Player ${playerToRejoin.name} has reconnected.`);
                io.emit('updateGameState', gameState);
                return;
            }
            return socket.emit('announce', 'Game is already in progress.');
        }

        let pId = playerId || Math.random().toString(36).substr(2, 9);
        const existingPlayer = players.find(p => p.playerId === pId);
        if (!existingPlayer) {
            const isHost = players.length === 0;
            players.push({ playerId: pId, socketId: socket.id, name: playerName, isHost: isHost, active: true, isReady: isHost });
        } else {
            existingPlayer.socketId = socket.id;
            existingPlayer.name = playerName;
            existingPlayer.active = true;
        }
        socket.emit('joinSuccess', { playerId: pId, lobby: players });
        io.emit('lobbyUpdate', players);
    });

    socket.on('setPlayerReady', () => {
        const player = players.find(p => p.socketId === socket.id);
        if (player && !player.isReady) {
            player.isReady = true;
            io.emit('lobbyUpdate', players);
        }
    });

    socket.on('kickPlayer', ({ playerIdToKick }) => {
        const host = players.find(p => p.socketId === socket.id && p.isHost);
        if (host) {
            players = players.filter(p => p.playerId !== playerIdToKick);
            io.emit('lobbyUpdate', players);
        }
    });

    socket.on('startGame', ({ password }) => {
        const host = players.find(p => p.socketId === socket.id && p.isHost);
        if (host) {
            const HOST_PASSWORD = process.env.HOST_PASSWORD;
            if (HOST_PASSWORD && password !== HOST_PASSWORD) {
                return socket.emit('announce', 'Incorrect host password.');
            }
            const readyPlayers = players.filter(p => p.isReady && p.active);
            if (readyPlayers.length >= 2) {
                gameState = setupGame(readyPlayers);
                startNewRound();
            } else {
                socket.emit('announce', 'Not enough ready players to start the game.');
            }
        }
    });

    socket.on('startNextRound', () => {
        if (!gameState || gameState.phase !== 'RoundOver') return;
        const me = gameState.players.find(p => p.socketId === socket.id);
        if (me && me.isHost) {
            startNewRound();
        }
    });

    socket.on('endGame', () => {
        const playerInGame = gameState ? gameState.players.find(p => p.socketId === socket.id) : null;
        if (playerInGame && playerInGame.isHost) {
            const finalPlayers = gameState.players.filter(p => p.status !== 'Removed');
            players = finalPlayers.map(p => ({
                playerId: p.playerId, socketId: p.socketId, name: p.name,
                isHost: p.isHost, active: true, isReady: p.isHost
            }));
            gameState = null;
            clearTurnTimer();
            io.emit('lobbyUpdate', players);
        }
    });

    socket.on('endSession', () => {
        const host = players.find(p => p.socketId === socket.id && p.isHost);
        if (host) {
            players.forEach(p => {
                if (p.socketId !== host.socketId) {
                    io.to(p.socketId).emit('forceDisconnect');
                }
            });
            players = [host];
            if (host) host.isReady = true;
            io.emit('lobbyUpdate', players);
        }
    });

    socket.on('submitBid', ({ bid }) => {
        if (!gameState || gameState.phase !== 'Bidding' || gameState.isPaused) return;
        const player = gameState.players[gameState.biddingPlayerIndex];
        if (!player || player.socketId !== socket.id) return;
        
        clearTurnTimer();
        player.isInactive = false;

        const proposedBid = parseInt(bid);
        if (isNaN(proposedBid)) return;
        const isLastBidder = findNextActivePlayer(gameState.biddingPlayerIndex, gameState.players) === findNextActivePlayer(gameState.dealerIndex, gameState.players);
        if (isLastBidder) {
            const bidsSoFar = gameState.players.reduce((acc, p) => acc + (p.bid || 0), 0);
            if ((bidsSoFar + proposedBid) === gameState.numCardsToDeal) {
                startTurnTimer();
                return socket.emit('invalidBid', { message: `Total bid cannot be ${gameState.numCardsToDeal}. Please bid again.` });
            }
        }
        player.bid = proposedBid;
        io.emit('gameLog', `📣 ${player.name} bids ${player.bid}.`);
        const nextBidderIndex = findNextActivePlayer(gameState.biddingPlayerIndex, gameState.players);
        if (nextBidderIndex === findNextActivePlayer(gameState.dealerIndex, gameState.players)) {
            gameState.phase = 'Playing';
            gameState.biddingPlayerIndex = null;
            gameState.currentPlayerIndex = findNextActivePlayer(gameState.dealerIndex, gameState.players);
            io.emit('gameLog', `Bidding complete. ${gameState.players[gameState.currentPlayerIndex]?.name} starts.`);
        } else {
            gameState.biddingPlayerIndex = nextBidderIndex;
            const nextBidder = gameState.players[nextBidderIndex];
            if (nextBidder) io.to(nextBidder.socketId).emit('promptForBid', { maxBid: gameState.numCardsToDeal });
        }
        startTurnTimer();
        io.emit('updateGameState', gameState);
    });

    socket.on('playCard', ({ card }) => {
        if (!gameState || gameState.phase !== 'Playing' || gameState.isPaused) return;
        const player = gameState.players[gameState.currentPlayerIndex];
        if (!player || player.socketId !== socket.id) return;
        
        const cardInHandIndex = player.hand.findIndex(c => c.suit === card.suit && c.rank === card.rank);
        if (cardInHandIndex === -1) return;
        if (gameState.leadSuit) {
            if (player.hand.some(c => c.suit === gameState.leadSuit) && card.suit !== gameState.leadSuit) {
                return socket.emit('announce', `You must play a ${gameState.leadSuit} card.`);
            }
        }
        
        clearTurnTimer();
        player.isInactive = false;
        
        if (!gameState.leadSuit) { gameState.leadSuit = card.suit; }
        player.hand.splice(cardInHandIndex, 1);
        gameState.currentTrick.push({ playerId: player.playerId, name: player.name, card });
        updateCurrentWinner(gameState);
        io.emit('gameLog', `› ${player.name} played the ${card.rank} of ${card.suit}.`);
        io.emit('updateGameState', gameState);
        const activePlayersCount = gameState.players.filter(p => p.status === 'Active').length;
        if (gameState.currentTrick.length < activePlayersCount) {
            gameState.currentPlayerIndex = findNextActivePlayer(gameState.currentPlayerIndex, gameState.players);
            startTurnTimer();
            io.emit('updateGameState', gameState);
        } else {
            evaluateTrick();
        }
    });

    socket.on('hostKickPlayer', ({ playerIdToKick }) => {
        if (!gameState) return;
        const host = gameState.players.find(p => p.socketId === socket.id && p.isHost);
        const playerToKick = gameState.players.find(p => p.playerId === playerIdToKick);
        if (host && playerToKick && playerToKick.isInactive) {
            handleGenericPlayerRemoval(playerIdToKick, 'kick');
        }
    });

    socket.on('rearrangeHand', ({ newHand }) => { if (!gameState) return; const player = gameState.players.find(p => p.socketId === socket.id); if (player && newHand.length === player.hand.length) { player.hand = newHand; io.emit('updateGameState', gameState); } });

    socket.on('disconnect', () => {
        if (gameState) {
            const playerInGame = gameState.players.find(p => p.socketId === socket.id && p.status === 'Active');
            if (playerInGame) {
                playerInGame.status = 'Disconnected';
                io.emit('gameLog', `Player ${playerInGame.name} has disconnected. The game is paused.`);
                gameState.isPaused = true;
                clearTurnTimer();
                gameState.pausedForPlayerNames = gameState.players.filter(p => p.status === 'Disconnected').map(p => p.name);
                gameState.pauseEndTime = Date.now() + DISCONNECT_GRACE_PERIOD;
                if (reconnectTimers[playerInGame.playerId]) clearTimeout(reconnectTimers[playerInGame.playerId]);
                reconnectTimers[playerInGame.playerId] = setTimeout(() => {
                    handleGenericPlayerRemoval(playerInGame.playerId, 'reconnect');
                }, DISCONNECT_GRACE_PERIOD);
                io.emit('updateGameState', gameState);
            }
        } else {
            const disconnectedPlayer = players.find(p => p.socketId === socket.id);
            if (disconnectedPlayer) {
                disconnectedPlayer.active = false;
                io.emit('lobbyUpdate', players);
            }
        }
    });
});

const PORT = process.env.PORT || 5000;
server.listen(PORT, () => console.log(`✅ Judgment Clubhouse Server is live on port ${PORT}`));