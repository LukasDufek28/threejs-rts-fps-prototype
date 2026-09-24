# Crusader Royale

A first person settlement and battle royale prototype built on the original Three.js game. The player remains a physical lord with movement, stamina, a sword, building placement, and army commands.

## Run

```sh
npm install
npm start
```

Open `http://localhost:8000`. Choose **Sandbox** for solo play. Online rooms support two or three players through quick matchmaking or a private code. Join the room before placing a base.

## Opening

Place the keep on clear ground. Sandbox allows a base anywhere on the map; in an online match, each player has an equal sector (half the map for two players, a third for three). The keep and its starter stores must fit inside that sector, highlighted on the minimap during placement. A starter stockpile and granary are included. The settlement begins with 40 wood, 30 meat, 100 gold, eight idle peasants, and housing for eight. Build a hovel to create room for immigration. Workers leave the keep when assigned, walk to their workplace, carry inputs, and deliver output to the appropriate store. Distances matter.

The 400 × 400 logical tile map spans roughly 800 world units across. Forests, stone, iron, and fertile oasis areas encourage expansion. Bandit camps guard some contested resources. Online matches have a safe zone that stays still for the first five minutes, then contracts through the match phases. Sandbox has no shrinking zone or zone damage.

## Economy

- Woodcutters seek the nearest unclaimed tree anywhere on the map and carry wood to stockpiles. Hunters do the same with deer and carry meat to granaries.
- Quarry workers fill a quarry buffer. An **Ox Tether** supplies the ox and handler that take stone to a stockpile. A quarry has no free transporter.
- Iron miners carry ore to stockpiles. Wheat farms grow a visible crop before the first harvest. Mill workers collect wheat and deliver flour; bakers collect flour and deliver bread.
- Orchards, dairy farms, hops farms, breweries, weapon workshops, a tanner, market, armoury, hovels, barracks, and mercenary posts extend the chain.
- Granaries hold meat, apples, cheese, and bread. Stockpiles hold raw materials. Armouries hold weapons and armour. Stores have shared capacity within their category.
- Tab opens the stores panel. It has food toggles, ration and tax controls, and market trades when a market exists. Click trades for five items, or Shift-click for 25.
- European troops require an idle peasant, gold, and equipment in an armoury. Mercenaries cost more gold and do not require equipment.

Balance values, recipes, prices, population rules, unit stats, and match phases live in `config/balance.js`. The lobby lets solo players select `BATTLE_ROYALE` or `CRUSADER_STANDARD`; online rooms use Battle Royale pacing.

## Controls

- **WASD / mouse:** move and look.
- **Shift / Space:** sprint and jump.
- **Left click:** place a building, inspect a target, or swing the sword.
- **E:** open the categorized building menu. Hover or focus a building for its purpose and placement tips.
- **Tab:** open the settlement stores, food, tax, ration, and market panel.
- **X:** dismantle a selected owned building.
- **1–6:** recruit a European troop when a barracks is selected. **1–7** recruit mercenaries when a mercenary post is selected. **R/T** retain swordsman and archer shortcuts.
- **C:** cycle a selected fletcher, poleturner, or blacksmith recipe.
- **G:** select all owned military groups for the next order.
- **Q tap:** order troops from the selected barracks or mercenary post to the aimed point or enemy.
- **Q hold:** open Move, Attack, Attack Move, Hold, Guard Here, Follow Me, and Retreat commands.
- **Right click:** cancel building placement.
- **Esc:** close an open build, stores, or command menu; during play, open the pause menu. Choose **Resume Game** to return without resetting your settlement.

## Multiplayer implementation

The original matchmaking server is retained. It now signals WebRTC peer connections and uses an unreliable data channel for frequent movement and wildlife transforms, and a reliable data channel for game events. The original WebSocket relay remains a fallback when peer negotiation cannot complete. The room host drives PvE, wildlife, zone state, and combat hit resolution. Player settlements and their workers are controlled by their owning peer.

The browser downloads Three.js through the import map in `index.html`. The static build is produced with `npm run build`; relay tests run with `npm test`.
