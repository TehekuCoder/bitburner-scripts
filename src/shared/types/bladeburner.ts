import { BladeburnerSkillName, BladeburnerActionType } from "@ns";

export interface BladeburnerSkillPriority {
  name: BladeburnerSkillName;
  weight: number;
  maxLevel?: number;
}

export interface BladeburnerActionChoice {
  type: BladeburnerActionType;
  name: string;
}