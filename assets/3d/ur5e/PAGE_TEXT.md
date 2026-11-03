# UR5e dynamics and control (draft page text for ui-b)

Draft for the owner to review. Every statement here is backed by the code in this folder or by the
RBE 501 and RBE 502 folders in C:\VK\School. Joint angles are written θ in the kinematics part (the
RBE 501 notation) and q in the control part (the RBE 502 notation); they are the same six numbers.

## Page text

Title: UR5e dynamics and control

Lede: A live model of a Universal Robots UR5e that applies the kinematics, dynamics and control from
RBE 501 (Robot Dynamics) and RBE 502 (Robot Control) at WPI. It uses the masses, inertias and joint
limits that Universal Robots publishes for the arm.

Body:

The arm is built from the official UR5e description (Universal Robots, BSD-3-Clause): its joint
origins, link masses, centres of mass, inertia tensors, joint torque limits and visual meshes. The
code computes everything from those numbers while the page is open. Nothing is prerecorded.

From RBE 501:
- Forward kinematics by the product of exponentials, checked in a test against Universal Robots'
  published DH table.
- The space Jacobian built from the screw axes, and the manipulability ellipsoid and measures from
  its eigenvalues.
- Inverse kinematics by damped least squares, the method from Lecture 8.
- Inverse dynamics by the recursive Newton-Euler algorithm (Lecture 18), giving the joint torques.
- Forward dynamics, solving for joint accelerations with the inverse of the mass matrix (Lecture 20).
  External forces enter through τ = Jᵀ F (Lecture 12).
- Quintic time scaling for trajectories (Lecture 19).

From RBE 502:
- The manipulator equation M(q)q̈ + C(q,q̇)q̇ + g(q) = τ.
- PD control, and PD control with gravity compensation. The lectures show that PD alone settles
  away from the target under gravity and that adding g(q) removes that offset. The demo shows
  both.
- Feedback linearization (computed torque), which cancels the nonlinear terms so that the error
  follows ë + K_d ė + K_p e = 0.

The planning part is not from either course. It uses RRT-Connect (Kuffner and LaValle, 2000) with
shortcut smoothing. Each link is a capsule and each obstacle is a sphere. The smoothed path is
time-scaled until the joint speeds and the Newton-Euler torques stay inside the UR5e limits. When
a sphere is dragged across the rest of the path, the arm plans again from where it is.

Figure caption:
UR5e, simulated live from its published masses and inertias. Teal arrows S1 to S6 are the joint
screw axes in the current pose, and the grey ellipsoid at the tool is its velocity manipulability
ellipsoid. Torques come from recursive
Newton-Euler. The arm moves by integrating its forward dynamics at 1 kHz under the selected
controller.

Checks (from test_ur5e.mjs, run with node):
- Product-of-exponentials FK matches the DH FK to 1e-9 m over 500 random poses.
- The space Jacobian matches finite differences.
- Newton-Euler torques match M(q)q̈ + c + g. Power q̇ᵀτ matches the rate of change of kinetic plus
  potential energy.
- Damped least squares converges in 99 of 100 trials.
- Every planned path is collision free when checked every 2 ms.

Link labels: "Demo source" (the assets/3d/ur5e folder), "UR5e description" (the GitHub repository).

## How it works (formulas)

Each formula is followed by where it appears in the demo.

1. Forward kinematics, product of exponentials

   $$T(\theta) = e^{[\mathcal{S}_1]\theta_1}\, e^{[\mathcal{S}_2]\theta_2} \cdots e^{[\mathcal{S}_6]\theta_6}\, M$$

   The six screw axes $\mathcal{S}_i = (\hat\omega_i,\, -\hat\omega_i \times q_i)$ and the home pose $M$ come from the
   UR5e joint origins. The demo draws each axis as a labelled teal arrow through its joint and moves the
   meshes with this product every frame.

2. Space Jacobian

   $$J_{s1} = \mathcal{S}_1, \qquad J_{si}(\theta) = \mathrm{Ad}_{e^{[\mathcal{S}_1]\theta_1}\cdots e^{[\mathcal{S}_{i-1}]\theta_{i-1}}}\,\mathcal{S}_i$$

   Column $i$ is the screw axis of joint $i$ in the current pose. The drawn axes are these columns.

3. Manipulability

   $$A = J_v J_v^{T}, \qquad \mu_3 = \sqrt{\lambda_1\lambda_2\lambda_3} = \sqrt{\det A}$$

   $J_v$ is the linear-velocity part of the Jacobian at the tool point. The ellipsoid at the tool has
   its axes along the eigenvectors of $A$ with half-lengths $\sqrt{\lambda_i}$. A singularity note
   appears when the ratio of the smallest to the largest singular value of $J_s$ falls below 0.01.

4. Damped least squares inverse kinematics

   $$\Delta\theta = J^{T}\left(JJ^{T} + \lambda^{2} I\right)^{-1} \mathcal{V}$$

   $\mathcal{V}$ is the pose error twist from the current tool pose to the dragged target. The damping
   $\lambda$ keeps the step finite near a singularity. This runs at 100 Hz while you drag.

5. Recursive Newton-Euler

   Forward pass, for $i = 1 \dots 6$, with $\dot{\mathcal{V}}_0 = (0,\, -\mathfrak{g})$:

   $$T_{i,i-1} = e^{-[\mathcal{A}_i]\theta_i} M_{i,i-1}, \qquad \mathcal{V}_i = \mathrm{Ad}_{T_{i,i-1}}\mathcal{V}_{i-1} + \mathcal{A}_i\dot\theta_i$$
   $$\dot{\mathcal{V}}_i = \mathrm{Ad}_{T_{i,i-1}}\dot{\mathcal{V}}_{i-1} + \mathrm{ad}_{\mathcal{V}_i}\mathcal{A}_i\dot\theta_i + \mathcal{A}_i\ddot\theta_i$$

   Backward pass, for $i = 6 \dots 1$:

   $$\mathcal{F}_i = \mathrm{Ad}^{T}_{T_{i+1,i}}\mathcal{F}_{i+1} + \mathcal{G}_i\dot{\mathcal{V}}_i - \mathrm{ad}^{T}_{\mathcal{V}_i}\left(\mathcal{G}_i\mathcal{V}_i\right), \qquad \tau_i = \mathcal{F}_i^{T}\mathcal{A}_i$$

   $\mathcal{G}_i$ is built from the published mass and inertia tensor of each UR5e link. The Details
   table shows the gravity torques $g(q)$ from this recursion next to the applied torques.

6. Manipulator equation and forward dynamics

   $$M(q)\ddot q + C(q,\dot q)\dot q + g(q) = \tau$$
   $$\ddot q = M(q)^{-1}\left(\tau + J_s^{T}\mathcal{F}_{ext} - C(q,\dot q)\dot q - g(q)\right)$$

   $M(q)$ is assembled column by column from Newton-Euler. The simulator integrates the second
   line with fourth-order Runge-Kutta at 1 kHz. Push applies a 60 N force at the wrist 1 joint (the end of the forearm)
   for 0.2 s as $\mathcal{F}_{ext}$, so only joints 1 to 3 carry it.

7. Controllers, with $e = q_d - q$

   $$\text{PD:}\quad \tau = K_p e + K_d \dot e$$
   $$\text{PD + gravity compensation:}\quad \tau = K_p e + K_d \dot e + g(q)$$
   $$\text{Computed torque:}\quad \tau = M(q)\left(\ddot q_d + K_d\dot e + K_p e\right) + C(q,\dot q)\dot q + g(q)$$

   With computed torque the error obeys $\ddot e + K_d\dot e + K_p e = 0$. With PD alone the arm
   sags under gravity, and the tracking-error plot shows the steady offset. Every command is clipped
   at the UR5e torque limits (150 N m for the first three joints, 28 N m for the wrist).

8. RRT-Connect

   Grow one tree from the start and one from the goal in joint space. Each round, extend one tree
   toward a random sample, then repeatedly extend the other tree toward the new node until it is
   reached or blocked. Swap the trees and repeat until they meet. A node or edge is rejected if any
   link capsule comes within its radius plus the sphere radius of an obstacle:

   $$d\big(\text{segment}_k(q),\, c_j\big) < r_k + r_j$$

   The demo then shortcuts the path and applies quintic time scaling
   $s(\tau) = 10\tau^3 - 15\tau^4 + 6\tau^5$ to each segment. Segments are lengthened until the speeds
   and the Newton-Euler torques stay inside the limits.

## Snippet for build integration

KaTeX 0.16.11 from jsdelivr, rendered at build time or on load. This fragment goes after the demo
figure on the project page. It uses only the page's own headings and paragraphs: no boxes.

```html
<link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/katex@0.16.11/dist/katex.min.css">
<script defer src="https://cdn.jsdelivr.net/npm/katex@0.16.11/dist/katex.min.js"></script>
<script defer src="https://cdn.jsdelivr.net/npm/katex@0.16.11/dist/contrib/auto-render.min.js"
  onload="renderMathInElement(document.getElementById('how-it-works'),{delimiters:[{left:'$$',right:'$$',display:true},{left:'\\(',right:'\\)',display:false}]})"></script>
<style>
#how-it-works .katex-display { margin: 12px 0; overflow-x: auto; overflow-y: hidden; }
#how-it-works .katex { font-size: 1.05em; color: var(--ink); }
</style>
<section id="how-it-works">
  <h2>How it works</h2>
  <h3>Forward kinematics</h3>
  $$T(\theta) = e^{[\mathcal{S}_1]\theta_1} e^{[\mathcal{S}_2]\theta_2} \cdots e^{[\mathcal{S}_6]\theta_6} M$$
  <p>The six screw axes and the home pose \(M\) come from the UR5e joint origins. The teal arrows S1 to S6 on the arm are these axes, and the meshes move by this product every frame.</p>
  <h3>Space Jacobian</h3>
  $$J_{si}(\theta) = \mathrm{Ad}_{e^{[\mathcal{S}_1]\theta_1}\cdots e^{[\mathcal{S}_{i-1}]\theta_{i-1}}}\,\mathcal{S}_i$$
  <p>Column \(i\) is the screw axis of joint \(i\) in the current pose.</p>
  <h3>Manipulability</h3>
  $$A = J_v J_v^{T}, \qquad \mu_3 = \sqrt{\det A}$$
  <p>The grey ellipsoid at the tool has axes along the eigenvectors of \(A\) and half-lengths \(\sqrt{\lambda_i}\). It flattens as the arm nears a singularity.</p>
  <h3>Inverse kinematics</h3>
  $$\Delta\theta = J^{T}\left(JJ^{T} + \lambda^{2} I\right)^{-1} \mathcal{V}$$
  <p>Damped least squares moves the tool toward the ball you drag. The damping keeps each step finite near a singularity.</p>
  <h3>Recursive Newton-Euler</h3>
  $$\mathcal{V}_i = \mathrm{Ad}_{T_{i,i-1}}\mathcal{V}_{i-1} + \mathcal{A}_i\dot\theta_i, \qquad \dot{\mathcal{V}}_i = \mathrm{Ad}_{T_{i,i-1}}\dot{\mathcal{V}}_{i-1} + \mathrm{ad}_{\mathcal{V}_i}\mathcal{A}_i\dot\theta_i + \mathcal{A}_i\ddot\theta_i$$
  $$\mathcal{F}_i = \mathrm{Ad}^{T}_{T_{i+1,i}}\mathcal{F}_{i+1} + \mathcal{G}_i\dot{\mathcal{V}}_i - \mathrm{ad}^{T}_{\mathcal{V}_i}(\mathcal{G}_i\mathcal{V}_i), \qquad \tau_i = \mathcal{F}_i^{T}\mathcal{A}_i$$
  <p>The forward pass carries velocities and accelerations out to the tool, with gravity entering as \(\dot{\mathcal{V}}_0 = (0, -\mathfrak{g})\). The backward pass carries wrenches back to the base. \(\mathcal{G}_i\) holds the published mass and inertia of each link.</p>
  <h3>Equations of motion</h3>
  $$M(q)\ddot q + C(q,\dot q)\dot q + g(q) = \tau$$
  <p>The simulator solves this for \(\ddot q\) with \(M(q)\) assembled from Newton-Euler and integrates it at 1 kHz. Push adds a 60 N force at the end of the forearm through \(J_s^{T}\mathcal{F}\).</p>
  <h3>Controllers</h3>
  $$\tau = K_p e + K_d \dot e \qquad \tau = K_p e + K_d \dot e + g(q) \qquad \tau = M(q)(\ddot q_d + K_d\dot e + K_p e) + C(q,\dot q)\dot q + g(q)$$
  <p>PD, PD with gravity compensation, and computed torque, with \(e = q_d - q\). PD alone sags under gravity, and the error plot shows the offset that \(g(q)\) removes.</p>
  <h3>Planning</h3>
  <p>RRT-Connect grows one tree from the start and one from the goal in joint space. Each tree extends toward random samples and tries to connect to the other. A pose is rejected if any link capsule touches a sphere. The path is shortcut, then each segment gets the quintic time scaling \(s = 10\tau^3 - 15\tau^4 + 6\tau^5\) and is lengthened until speeds and torques stay inside the UR5e limits.</p>
</section>
```
