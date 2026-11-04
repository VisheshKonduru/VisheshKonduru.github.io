# Demo rework progress (WIP)

## Done
- Title for the arm project found: "6 Degrees-of-Freedom Robotic Arm" (source: C:\VK\Resume\Vishesh Konduru - Resume.pdf, extracted with pdftotext; no .tex has it; C:\VK\Resume is not a git repo). Not yet applied in tools/projects_content.py.
  Note: the OpenManipulator-X in the demo has 4 joints; the resume entry also covers RBE 501 dynamics. Owner should confirm.
- assets/3d/demo-shell.css + demo-shell.js: shared layout (scene tabs with sliding indicator, flow row with bordered primary and plain secondary buttons, view + status, right column of live canvas panels with a "Numbers" toggle for the readout, stacks below 1100 px), coach marks (one at a time, gated, Skip, Esc, in-memory completion, "Show steps again"), plot helpers (axes, linePlot, barPlot).
- Arm vision: fisheye Kannala-Brandt raw camera (640x480, f 290, k1 -0.16, k2 0.02, 138 deg FOV) in vision.js; undistorted pinhole fx 330. test_vision.mjs ray-traces the raw fisheye frame and runs the demo's undistort remap; PASS (bow raw 13 px vs 0 px undistorted, detection mean 0.27 mm).
- Arm mount() rewritten onto the shell (tabs Sort balls / Play tic-tac-toe, camera stage tabs, coach steps).

## Left
- arm-demo.js start(): replace old ui.status/details/modeSort/stageBtns refs; shader + prerender for fisheye (pinhole prerender f 290, about 1500x790, re-render only when the scene changes); abort generation counter so tabs/Reset work while sorting; remove auto-sort; live detection status; hover ghost ball; detected-position rings; side panels (true vs detected board plot, reprojection-error bar, minimax 3x3 shading).
- TurtleBot: build DOM via shell in embed.js; no autoplay (Start mapping / Start); localization flow Drop robot -> Set goal -> Start, no auto-kidnap; perf (DPR 1.25, shadows off, Lambert, 1-tri particle arrows updated per filter update, integer keys in estimate/resample, precompute LL table); panels (spread, weight histogram, polar scan vs expected, ESS; mapping coverage, A* nodes bars). Baseline (SwiftShader 1920x1080): loc 15.2 draw calls, 79.9k tris, 3.8 ms script/frame, 71 ms frame; mapping 11 draw calls, 63k tris, 4.8 ms script/frame. Node: filter max 21.9 ms (measure first call 16 ms LL table), estimate max 4.8 ms.
- UR5e and MQP onto the shell (tabs Move the tool / Plan around obstacles; View / Exploded with part-group legend).
- projects_content.py: title rename, live() link demo-shell.css, drop how/caption caveats.
- Rebuild, node tests, headless Edge click tests (scratchpad cdp.mjs), screenshots desktop + 390 px, report all callout strings.
