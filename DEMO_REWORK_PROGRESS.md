# Demo rework progress

## Done (branch ui-b, not pushed)
- assets/3d/demo-shell.css + demo-shell.js: one layout for all four demos. Scene tabs with a sliding indicator; flow row (bordered primary, plain secondary buttons, current step highlighted); view with one status line under it; right column (stacks below 1100 px) with live canvas plots and a "Numbers" toggle; coach marks (one at a time, gated on the real action, Skip, Esc, back on every page load, "Show steps again").
- Arm: Kannala-Brandt fisheye raw camera (138 deg, k1 -0.16, k2 0.02), undistorted pinhole fx 330; abortable motion (tabs, Reset, New game work mid-move); no auto-start; live "Detected N balls" status while dragging; hover ghost ball; detected-position rings; panels: board top view true vs detected, reprojection error per camera change, minimax score per square.
- TurtleBot: Start mapping button (still first frame); localization flow Drop robot -> Set goal -> Start, labelled goal flag (draggable), no self-kidnap; panels: coverage, A* nodes, spread, weight histogram, polar scan vs expected, ESS. Perf: DPR 1.25, no shadow pass, Lambert materials, 1-triangle particles redrawn only on filter change, integer bin keys, LL table at construction, 3000 max particles.
- UR5e: Move the tool / Plan around obstacles tabs, torque/error/manipulability plots in the column, others and matrices under "More", plain status lines.
- MQP: View / Exploded tabs, part-group legend with hover highlight; start-size cube removed.
- projects_content.py: live() links demo-shell.css, no instruction paragraph or caveat captions.

## Open
- Arm project title: left as "RBE-3001 Final Project" pending the owner (resume entry "6 Degrees-of-Freedom Robotic Arm" may be the UR5e/RBE 501 work).
