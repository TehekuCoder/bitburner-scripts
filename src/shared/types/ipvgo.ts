export type GoOpponent =
  | "Netburners"
  | "Slum Snakes"
  | "The Black Hand"
  | "Tetrads"
  | "Daedalus"
  | "Illuminati";

export type GoBoardSize = 5 | 7 | 9 | 13;

export interface GoPoint {
  x: number;
  y: number;
}