export { initGame } from './setup'
export type { InitOptions } from './setup'
export {
  dispatch,
  canPlay,
  canMove,
  canPlaceUnitAt,
  withinIdentity,
  spellTiming,
  unitPlayOptions,
  totalPlayCost,
  castFlow,
  flowCost,
} from './actions'
export type { UnitPlayOption } from './actions'
export { beginTurn, endTurn } from './phases'
export {
  resolveShowdown,
  contestedBattlefields,
  effHp,
  autoAssignmentList,
  forecastShowdown,
} from './combat'
export type { ShowdownForecast } from './combat'
export { passPriority } from './stack'
export { emit } from './events'
export { scoreHolds, scoreConquer, checkVictory, controlledCount } from './scoring'
export { canAfford, canRecycleRune, costOf } from './runes'
export { effectiveCost } from './costs'
export {
  showdownMight,
  deflectSurcharge,
  keywordValue,
  unitHasKeyword,
  isMighty,
  isBuffed,
  lethalMight,
  mightBonus,
  hasGanking,
  hasTemporary,
  damageOrderRank,
  combatRoleOf,
  mightBreakdown,
} from './keywords'
export type { MightTerm } from './keywords'
export {
  createToken,
  gainXP,
  setEmpowered,
  buff,
  giveMightPermanent,
  stun,
  heal,
  recall,
  burn,
  predict,
  predictChoice,
  discardChoice,
  addPower,
  addEnergy,
  recycleFromHand,
  enterGear,
  attachGear,
  detachGear,
  killGear,
  readyGear,
  empowerGear,
  gearCount,
  gearGrants,
} from './abilities/effects'
export {
  legionActive,
  levelAbilityActive,
  levelActive,
  isEmpowered,
} from './abilities/statuses'
export { scriptFor, CARD_SCRIPTS, legendAbilities } from './abilities/scripts'
export { compileScript, compileEffect, autoAbilities } from './abilities/compile'
export { legalUnitTargets, legalGearTargets, legalStackTargets, needsChoice } from './abilities/targets'
export type { TargetSpec } from './abilities/targets'
export type { CardScript, ActivatedAbility } from './abilities/types'
export {
  getPlayer,
  otherSide,
  controllerOf,
  mightAt,
  unitsAt,
  allUnits,
  ownUnits,
  findUnit,
  basePrintingId,
  samePrinting,
} from './state'
export { runAITurn, stepAITurn, getAIActions } from './ai'
