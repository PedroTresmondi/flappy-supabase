export const DEFAULT_CONFIG = {
    board: { width: 360, height: 640, background: "#70c5ce" },
    assets: {
        // coloque as imagens em public/assets/img/...
        birdFrames: [
            "/assets/img/flappybird1.png",
            "/assets/img/flappybird2.png",
            "/assets/img/flappybird3.png"
        ],
        topPipe: "/assets/img/toppipe.png",
        bottomPipe: "/assets/img/bottompipe.png",
        sfx: { flap: "", score: "", hit: "" }
    },
    bird: {
        width: 34, height: 24,
        startXPercent: 12.5, startYPercent: 50,
        flapForce: 6, maxFallSpeed: 12, hitboxPadding: 2,
        tilt: {
            enabled: true, upDeg: -25, downDeg: 70, responsiveness: 0.15,
            velForMaxUp: 6, velForMaxDown: 12, snapOnFlap: true, minDeg: -45, maxDeg: 90
        },
        flapAnim: { enabled: true, durationMs: 1000, fps: 12 }
    },
    physics: { gravity: 0.4 },
    pipes: {
        width: 64, height: 512, scrollSpeed: 2, gapPercent: 25,
        randomBasePercent: 25, randomRangePercent: 50,
        autoStretchToEdges: false, edgeOverflowPx: 0
    },
    difficulty: {
        rampEnabled: false, speedPerScore: 0.05, minGapPercent: 18, gapStepPerScore: 0.2,
        timeRampEnabled: true, timeStartDelayMs: 0,
        timeSpeedPerSec: 0.03, timeMaxExtraSpeed: 5, timeGapStepPerSec: 0.02
    },
    spawn: { intervalMs: 1500 },
    scoring: { pointsPerPipe: 0.5 },
    ui: {
        font: "45px sans-serif", scoreColor: "#ffffff",
        gameOverText: "GAME OVER", gameOverFont: "45px sans-serif", gameOverColor: "#ffffff"
    },
    controls: {
        jump: ["Space", "ArrowUp", "KeyX"],
        minFlapIntervalMs: 120,
        allowHoldToFlap: false
    },
    gameplay: { restartOnJump: true, gracePeriodMs: 1500, pauseKey: "KeyP" }
}
