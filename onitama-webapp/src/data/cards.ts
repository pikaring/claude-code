import type { Card } from "../types";

export const ONITAMA_CARDS: Card[] = [
  { id: "tiger", name: "Tiger", moves: [{ dx: 0, dy: -2 }, { dx: 0, dy: 1 }] },
  { id: "crab", name: "Crab", moves: [{ dx: 0, dy: -1 }, { dx: -2, dy: 0 }, { dx: 2, dy: 0 }] },
  { id: "monkey", name: "Monkey", moves: [{ dx: -1, dy: -1 }, { dx: 1, dy: -1 }, { dx: -1, dy: 1 }, { dx: 1, dy: 1 }] },
  { id: "crane", name: "Crane", moves: [{ dx: 0, dy: -1 }, { dx: -1, dy: 1 }, { dx: 1, dy: 1 }] },
  { id: "dragon", name: "Dragon", moves: [{ dx: -2, dy: -1 }, { dx: 2, dy: -1 }, { dx: -1, dy: 1 }, { dx: 1, dy: 1 }] },
  { id: "elephant", name: "Elephant", moves: [{ dx: -1, dy: -1 }, { dx: 1, dy: -1 }, { dx: -1, dy: 0 }, { dx: 1, dy: 0 }] },
  { id: "mantis", name: "Mantis", moves: [{ dx: -1, dy: -1 }, { dx: 1, dy: -1 }, { dx: 0, dy: 1 }] },
  { id: "boar", name: "Boar", moves: [{ dx: 0, dy: -1 }, { dx: -1, dy: 0 }, { dx: 1, dy: 0 }] },
  { id: "frog", name: "Frog", moves: [{ dx: -1, dy: -1 }, { dx: -2, dy: 0 }, { dx: 1, dy: 1 }] },
  { id: "goose", name: "Goose", moves: [{ dx: -1, dy: -1 }, { dx: -1, dy: 0 }, { dx: 1, dy: 0 }, { dx: 1, dy: 1 }] },
  { id: "horse", name: "Horse", moves: [{ dx: 0, dy: -1 }, { dx: -1, dy: 0 }, { dx: 0, dy: 1 }] },
  { id: "eel", name: "Eel", moves: [{ dx: -1, dy: -1 }, { dx: 1, dy: 0 }, { dx: -1, dy: 1 }] },
  { id: "rabbit", name: "Rabbit", moves: [{ dx: 1, dy: -1 }, { dx: 2, dy: 0 }, { dx: -1, dy: 1 }] },
  { id: "rooster", name: "Rooster", moves: [{ dx: 1, dy: -1 }, { dx: 1, dy: 0 }, { dx: -1, dy: 0 }, { dx: -1, dy: 1 }] },
  { id: "ox", name: "Ox", moves: [{ dx: 0, dy: -1 }, { dx: 1, dy: 0 }, { dx: 0, dy: 1 }] },
  { id: "cobra", name: "Cobra", moves: [{ dx: 1, dy: -1 }, { dx: -1, dy: 0 }, { dx: 1, dy: 1 }] },
];
