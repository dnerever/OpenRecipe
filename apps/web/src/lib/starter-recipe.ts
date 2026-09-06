/**
 * What `/new` opens with — the first document most people will ever see in this
 * format, so it doubles as the format's documentation.
 *
 * It lives apart from the editor component so it can be tested without a DOM:
 * if this ever stopped parsing, every new recipe would begin with a screen of
 * validation errors.
 */
export const STARTER_RECIPE = `---
schema: 1
title: My First Loaf
description: A simple sandwich loaf to start with.
yield: { count: 1, unit: loaf }
time: { prep: 20m, cook: 40m, total: 4h }
ingredients:
  - { qty: 500, unit: g, item: bread flour }
  - { qty: 320, unit: g, item: water, note: lukewarm }
  - { qty: 10, unit: g, item: fine sea salt }
  - { qty: 7, unit: g, item: instant yeast }
  - { qty: null, item: olive oil, note: for the tin }
equipment: [loaf tin]
tags: [bread, beginner, vegan]
---

## Mix

Stir everything together until no dry flour remains. Rest 20 minutes.

## Knead and prove

Knead 8 minutes, then prove until doubled, about 90 minutes.

## Shape and bake

Shape into the oiled tin, prove another hour, and bake at 425°F for 40
minutes until it sounds hollow underneath.
`;
