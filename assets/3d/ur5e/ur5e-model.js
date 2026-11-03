// UR5e model data, copied from Universal_Robots_ROS2_Description (BSD-3-Clause),
// config/ur5e/{default_kinematics,physical_parameters,joint_limits}.yaml and
// urdf/ur_macro.xacro. See NOTICE.txt. All frames are expressed in the UR
// "base_link_inertia" frame, which the description uses as the controller base.

const H = Math.PI / 2;

// Joint origins (parent link -> child link), xyz in m, rpy in rad. Axis is +z of the child.
export const JOINTS = [
  { name: 'shoulder_pan',  xyz: [0, 0, 0.1625],                 rpy: [0, 0, 0] },
  { name: 'shoulder_lift', xyz: [0, 0, 0],                      rpy: [1.570796327, 0, 0] },
  { name: 'elbow',         xyz: [-0.425, 0, 0],                 rpy: [0, 0, 0] },
  { name: 'wrist_1',       xyz: [-0.3922, 0, 0.1333],           rpy: [0, 0, 0] },
  { name: 'wrist_2',       xyz: [0, -0.0997, -2.044881182297852e-11], rpy: [1.570796327, 0, 0] },
  { name: 'wrist_3',       xyz: [0, 0.09959999999999999, -2.042830148012698e-11], rpy: [1.570796326589793, Math.PI, Math.PI] },
];

// Link inertials (in each child link frame). Inertia tensor is given in the
// inertial frame rotated by rpy, exactly as URDF <inertial><origin rpy> means.
export const LINKS = [
  { name: 'shoulder',  m: 3.761, com: [0, -0.00193, -0.02561], rpy: [H, 0, 0],
    I: [0.00700210, 0.00000073, -0.00001053, 0.00648091, 0.00049994, 0.00657286] },
  { name: 'upper_arm', m: 8.058, com: [-0.2125, 0, 0.11336], rpy: [0, 0, 0],
    I: [0.01505885, -0.00005400, 0.00000563, 0.33388086, -0.00000181, 0.33247207] },
  { name: 'forearm',   m: 2.846, com: [-0.2422, 0, 0.0265], rpy: [0, 0, 0],
    I: [0.00399632, -0.00001365, 0.00137272, 0.07879254, -0.00000660, 0.07848510] },
  { name: 'wrist_1',   m: 1.37,  com: [0, -0.01634, -0.0018], rpy: [H, 0, 0],
    I: [0.00165491, -0.00000282, -0.00000438, 0.00135962, 0.00010157, 0.00126279] },
  { name: 'wrist_2',   m: 1.3,   com: [0, 0.01634, -0.0018], rpy: [-H, 0, 0],
    I: [0.00135617, -0.00000274, 0.00000444, 0.00127827, -0.00005048, 0.00096614] },
  { name: 'wrist_3',   m: 0.365, com: [0, 0, -0.001159], rpy: [0, 0, 0],
    I: [0.00018694, 0.00000006, -0.00000017, 0.00018908, -0.00000092, 0.00025756] },
];

// joint_limits.yaml: max_effort (N m) and max_velocity (180 deg/s for all joints).
export const TAU_MAX = [150, 150, 150, 28, 28, 28];
export const QD_MAX = [Math.PI, Math.PI, Math.PI, Math.PI, Math.PI, Math.PI];
export const Q_MIN = [-2 * Math.PI, -2 * Math.PI, -Math.PI, -2 * Math.PI, -2 * Math.PI, -2 * Math.PI];
export const Q_MAX = [2 * Math.PI, 2 * Math.PI, Math.PI, 2 * Math.PI, 2 * Math.PI, 2 * Math.PI];

// Universal Robots published DH table for the UR5e (standard DH).
export const DH = {
  d: [0.1625, 0, 0, 0.1333, 0.0997, 0.0996],
  a: [0, -0.425, -0.3922, 0, 0, 0],
  alpha: [H, 0, 0, H, -H, 0],
};

// Visual mesh offsets inside each link frame (visual_parameters.yaml), used by the glb build.
// Collision capsules in link frames (segment endpoints, radius in m). Sized by hand
// from the visual mesh bounds printed by tools/build_glb.py; they enclose the meshes.
export const CAPSULES = [
  // link 0 is the fixed base; links 1..6 are the moving links (shoulder .. wrist_3).
  { link: 0, a: [0, 0, 0.03], b: [0, 0, 0.07], r: 0.077 },
  { link: 1, a: [0, 0, -0.03], b: [0, 0, 0.04], r: 0.066 },
  { link: 2, a: [0, 0, 0.135], b: [-0.425, 0, 0.135], r: 0.066 },
  { link: 3, a: [0, 0, 0.005], b: [-0.392, 0, 0.005], r: 0.06 },
  { link: 4, a: [0, 0, -0.035], b: [0, 0, 0], r: 0.058 },
  { link: 5, a: [0, 0, -0.01], b: [0, 0, 0], r: 0.058 },
  { link: 6, a: [0, 0, -0.02], b: [0, 0, 0], r: 0.046 },
];
