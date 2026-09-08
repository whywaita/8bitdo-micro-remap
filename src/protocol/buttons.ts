const slots = {
  a: 3,
  b: 4,
  x: 5,
  y: 6,
  l: 7,
  r: 8,
  l2: 9,
  r2: 10,
  minus: 13,
  plus: 14,
  star: 15,
  logo: 16,
  up: 17,
  down: 18,
  left: 19,
  right: 20,
} as const;
export type ButtonId = keyof typeof slots;
const labels: Record<ButtonId, string> = {
  a: "A",
  b: "B",
  x: "X",
  y: "Y",
  l: "L / L1",
  r: "R / R1",
  l2: "L2",
  r2: "R2",
  minus: "Minus",
  plus: "Plus",
  star: "Star",
  logo: "Logo",
  up: "Up",
  down: "Down",
  left: "Left",
  right: "Right",
};
export const BUTTONS = Object.entries(slots).map(([id, slot]) =>
  Object.freeze({
    id: id as ButtonId,
    slot,
    offset: slot * 4,
    label: labels[id as ButtonId],
  }),
);
export const BUTTON_BY_ID = Object.fromEntries(
  BUTTONS.map((b) => [b.id, b]),
) as Record<ButtonId, (typeof BUTTONS)[number]>;
export function isButtonId(value: string): value is ButtonId {
  return Object.hasOwn(slots, value);
}
