export type WeaponId = 'bazooka' | 'holy' | 'donkey' | 'heli' | 'tank';

export type Phase =
  | 'menu'
  | 'aim'
  | 'helicopter'
  | 'fly'
  | 'settle'
  | 'levelclear'
  | 'victory'
  | 'defeat'
  | 'pause';

export interface Worm {
  id: number;
  team: number;
  slot: number;
  name: string;
  x: number;
  y: number;
  vx: number;
  vy: number;
  hp: number;
  alive: boolean;
  inTank: boolean;
  fallStart: number | null;
  face: number;
}

export interface Building {
  id: string;
  kind: 'bunker' | 'workshop';
  x: number;
  y: number;
  w: number;
  h: number;
  hp: number;
  maxHp: number;
  alive: boolean;
}

export interface TankState {
  x: number;
  y: number;
  hp: number;
  alive: boolean;
  facing: number;
  angle: number;
}

export interface Projectile {
  kind: 'bazooka' | 'holy' | 'bomb' | 'donkey' | 'cannon';
  x: number;
  y: number;
  vx: number;
  vy: number;
  fuse: number;
  blast: number;
  damage: number;
  team: number;
  bounce: boolean;
  radius: number;
  age: number;
}

export interface HeliState {
  x: number;
  targetX: number;
  dropsLeft: number;
  cooldown: number;
  team: number;
}

export interface Blast {
  x: number;
  y: number;
  r: number;
  age: number;
  kind: string;
}

export interface Scorch {
  x: number;
  y: number;
  r: number;
}

export interface Ammo {
  holy: number;
  donkey: number;
  heli: number;
}

export interface GameEvent {
  type: 'explode' | 'splash' | 'die' | 'fire' | 'hurt' | 'banner' | 'rotor' | 'win' | 'lose';
  x?: number;
  y?: number;
  r?: number;
  kind?: string;
  text?: string;
  team?: number;
}

export interface Match {
  levelIndex: number;
  levelName: string;
  blurb: string;
  wormsPerTeam: number;
  worms: Worm[];
  buildings: Building[];
  tank: TankState;
  projectiles: Projectile[];
  heli: HeliState | null;
  blasts: Blast[];
  scorches: Scorch[];
  solids: Uint8Array;
  solidVersion: number;
  phase: Phase;
  phaseBeforePause: Phase;
  team: number;
  slot: number;
  timer: number;
  timerMax: number;
  wind: number;
  windMax: number;
  aimAngle: number;
  aimPower: number;
  weapon: WeaponId;
  ammo: [Ammo, Ammo];
  targetX: number;
  banner: string;
  bannerTime: number;
  aiSkill: number;
  aiTimer: number;
  aiStage: 'think' | 'show' | 'done';
  hitstop: number;
  settleTime: number;
  pendingEnd: Phase | null;
  occupiedBy: number | null;
  workshopUsed: boolean;
  walkLeft: number;
  killed: number;
  events: GameEvent[];
  rng: () => number;
}
