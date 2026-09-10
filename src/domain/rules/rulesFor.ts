import type { Match } from '../match/models';
import type { GameRules } from './GameRules';
import { FixedVisitsRules } from './FixedVisitsRules';
import { X01Rules } from './X01Rules';
const x01 = new X01Rules(); const fixed = new FixedVisitsRules();
export const rulesFor = (match: Match): GameRules => match.state.kind === 'x01' ? x01 : fixed;
