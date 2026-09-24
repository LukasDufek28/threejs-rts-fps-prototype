# Three.js FPS RTS Prototype

A very small first-person RTS prototype inspired by the idea of combining a hero-controlled first-person game with Stronghold-style whole-building placement.

## Included

- First-person WASD + mouse look
- Large randomized circular play area (120-unit radius)
- Hard world boundary that cannot be crossed
- Grid-snapped whole-building placement
- At the start of Sandbox or an online match, choose a base location near your border spawn. The base house is placed first, then a starter stockpile and granary appear beside it. More buildings become available through the E menu:
  - Base House: settlement landmark
  - Stockpile: free, open platform for wood and stone; each one adds limited capacity and visibly fills with matching goods
  - Granary: free food store; hunters deliver meat here, with separate capacity from the stockpile
  - Lumber Camp: automatically creates a lumberjack
  - Hunting Lodge: automatically creates a hunter
  - Quarry: built on a gray stone deposit; two quarrymen use pickaxes and take 6.5 seconds per stone load to fill a 32-stone pile, then a mule and its handler carry it to a stockpile and return together. The mule has a saddle and two bags that visibly fill with stone while loaded.
  - Barracks: costs stone and recruits swordsmen and archers while selected
- Basic autonomous NPCs:
  - Lumberjack: takes three logs from a tree through separate trips to camp, then delivers an 18-wood batch; returns inside the camp to sleep when idle
  - Hunter: hunts within the lodge's range, slowly carries a deer overhead for a 6-meat delivery, and returns inside the lodge to sleep when idle
  - Quarrymen: return inside their quarry to sleep when mining or storage is unavailable; the mule and handler wait outside for a full load
  - Sleeping workers disappear at their building entrance, with ZZZ above the roof, and emerge when work resumes
  - Swordsman and archer: patrol a barracks rally point, attack opposing troops and kings in range, and have health bars
- Deer move in herds, have animated legs, horns, and eyes, can be selected to see health, and new herds arrive periodically
- Buildings block animals and NPCs and can be placed on adjacent grid cells
- Selected worker outposts show their work range and can be dismantled for half their resource cost
- Sandbox mode for solo building and testing; no enemy bots
- Selectable buildings and units with status panels and selection arrows
- Read-only stores panel showing resources, people, and buildings
- Live minimap showing the player, buildings, allies, enemies, wildlife, and rally points
- Basic resources
- Foreground rendered low-poly sword with close-range melee hits
- Two or three-player online rooms with name profiles, quick matchmaking or room codes, opposite or evenly spaced border spawns, royal player models, health and placement results, and WebSocket-relayed combat and building commands
- Health and sprint stamina bars
- CC0 recorded sound cues for footsteps, chopping, mining, training, attacks, building, deliveries, deaths, and victory. Source details are in `assets/audio/CREDITS.md`.
- Low-poly primitive graphics only

## Controls

- WASD: move
- Shift: sprint
- Space: jump
- Mouse: look
- E: open or close the building menu
- While the E menu is open: 1 Lumber Camp, 2 Hunting Lodge, 3 Barracks, 4 Stockpile, 5 Quarry, 6 Granary
- Tab: show or hide the stores panel in the bottom left without leaving mouse look
- Left click: place the starting base, place a selected building, inspect an aimed building or unit, or swing the sword
- Right click: cancel building placement
- X: dismantle the selected outpost for half its resource price (the base house cannot be removed)
- R: recruit a swordsman from the selected barracks
- T: recruit an archer from the selected barracks
- Q: assign the selected barracks rally point where you are looking at the ground
- Q while aiming at the opposing king: order the barracks troops to pursue and attack that player
- Esc: open the menu / cancel build mode

Click a barracks to see its information without leaving mouse look. Press R or T to recruit, then look at the ground and press Q to set its rally point. In an online match, aim at a rival king and press Q to order your troops to hunt that player. Warriors hit their locked target when their attack fires; arrows do not rely on projectile collision. A king at zero health sees their placement, and the last surviving king wins.

## Run it

Install the matchmaking dependency and run the app plus signaling server:

    npm install
    npm start

Then open:

    http://localhost:8000

For quick matchmaking, open the same server URL in two or three browsers, enter a different player name in each, and click **Quick match** in each. For a three-player room, have all three join before anyone places a base. When they show **Match ready**, click **Enter match** in each window, then choose and place each base. Only the focused window can hold mouse look; click **Resume match** when switching back to the other window. For a private match, one player selects **Create private match** and shares the room code with up to two others, who enter it and select **Join with code** before base placement. For a LAN match, the host runs `npm start` and the other players open the host machine's LAN address on port 8000. A plain static server such as `python -m http.server` cannot run matchmaking.

## Deploy to Vercel

This repository includes `vercel.json`, which builds the static game into `public/` and exposes the matchmaking endpoint at `/api/matchmaking`. Import the GitHub repository into Vercel and deploy with the default project root; no environment variables are needed for the prototype. The browser selects secure WebSockets automatically on HTTPS.

Vercel's WebSocket Functions are currently in beta and require Fluid Compute. The lobby currently keeps room membership in function memory, while Vercel does not guarantee that separate connections reach the same function instance. This is suitable for a preview or low-traffic prototype, but reliable matchmaking across instances/deployments needs shared room and relay state. See [Vercel's WebSocket documentation](https://vercel.com/docs/functions/websockets) for the platform limits.

The name is a local profile saved in that browser; it is not a password-protected account. The matchmaking WebSocket relays player and troop positions, attacks, and shared building actions after pairing. Each browser controls its own recruited warriors. Autonomous workers and wildlife still simulate independently on each client, so this remains a multiplayer prototype rather than an authoritative shared-world server.

The browser loads Three.js from jsDelivr; `npm install` downloads the signaling server's WebSocket dependency.

## Notes

This is deliberately a prototype, not production architecture. The [Stronghold Crusader: Definitive Edition manual](https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/3024040/manuals/660220d63224ed63cb17885b34e9477fd926b6e3/Stronghold_Crusader_Definitive_Edition_Manual_-_English_v1.02.pdf) lists a woodcutter at 3 wood, hunter's post at 5 wood, barracks at 15 stone, quarry at 20 wood, and stockpile as free. Stockpile and granary capacities are game-specific approximations. The world and its stone deposits are generated from primitives.
