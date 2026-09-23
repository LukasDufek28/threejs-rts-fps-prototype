# Three.js FPS RTS Prototype

A very small first-person RTS prototype inspired by the idea of combining a hero-controlled first-person game with Stronghold-style whole-building placement.

## Included

- First-person WASD + mouse look
- Large randomized circular play area (120-unit radius)
- Hard world boundary that cannot be crossed
- Grid-snapped whole-building placement
- A starter base house, stockpile, and granary, with more buildings available through the E menu:
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
  - Swordsman and archer: patrol a barracks rally point, fight nearby raiders, and have health bars
- Deer move in herds, have animated legs, horns, and eyes, can be selected to see health, and new herds arrive periodically
- Buildings block animals and NPCs and can be placed on adjacent grid cells
- Selected worker outposts show their work range and can be dismantled for half their resource cost
- Main menu option to enable or disable enemy spawning
- Selectable buildings and units with status panels and selection arrows
- Read-only stores panel showing resources, people, and buildings
- Live minimap showing the player, buildings, allies, enemies, wildlife, and rally points
- Basic resources
- Very simple sword attack
- Two-player online rooms with name profiles, quick matchmaking or room codes, WebRTC player presence, and shared building, recruitment, rally-point, and demolition commands
- Low-poly primitive graphics only

## Controls

- WASD: move
- Shift: sprint
- Space: jump
- Mouse: look
- E: open or close the building menu
- While the E menu is open: 1 Lumber Camp, 2 Hunting Lodge, 3 Barracks, 4 Stockpile, 5 Quarry, 6 Granary
- Tab: show or hide the stores panel in the bottom left without leaving mouse look
- Left click: place selected building / inspect aimed building or unit / clear selection when aiming at empty space / sword attack
- Right click: cancel building placement
- X: dismantle the selected outpost for half its resource price (the base house cannot be removed)
- R: recruit a swordsman from the selected barracks
- T: recruit an archer from the selected barracks
- Q: assign the selected barracks rally point where you are looking at the ground
- Esc: open the menu / cancel build mode

Click a barracks to see its information without leaving mouse look. Press R or T to recruit, then look at the ground and press Q to set its rally point.

## Run it

Install the matchmaking dependency and run the app plus signaling server:

    npm install
    npm start

Then open:

    http://localhost:8000

Choose a player name, then select **Quick match**, create a room and share its code, or join with a room code. For a LAN match, the host runs the server and the other player opens the host machine's LAN address on port 8000. Some restrictive networks also require a TURN relay for WebRTC.

## Deploy to Vercel

This repository includes `vercel.json`, which builds the static game into `public/` and exposes the matchmaking endpoint at `/api/matchmaking`. Import the GitHub repository into Vercel and deploy with the default project root; no environment variables are needed for the prototype. The browser selects secure WebSockets automatically on HTTPS.

Vercel's WebSocket Functions are currently in beta and require Fluid Compute. The lobby currently keeps room membership in function memory, while Vercel does not guarantee that separate connections reach the same function instance. This is suitable for a preview or low-traffic prototype, but reliable matchmaking across instances/deployments needs shared Redis-backed room and signaling state. See [Vercel's WebSocket documentation](https://vercel.com/docs/functions/websockets) for the platform limits.

The name is a local profile saved in that browser; it is not a password-protected account. WebRTC sends player positions directly between peers after the server pairs them. Building, recruiting, rally points, and demolition are shared actions. Autonomous worker, wildlife, and enemy simulation continues independently on each client, so this is a multiplayer prototype rather than an authoritative shared-world server.

The browser loads Three.js from jsDelivr; `npm install` downloads the signaling server's WebSocket dependency.

## Notes

This is deliberately a prototype, not production architecture. The [Stronghold Crusader: Definitive Edition manual](https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/3024040/manuals/660220d63224ed63cb17885b34e9477fd926b6e3/Stronghold_Crusader_Definitive_Edition_Manual_-_English_v1.02.pdf) lists a woodcutter at 3 wood, hunter's post at 5 wood, barracks at 15 stone, quarry at 20 wood, and stockpile as free. Stockpile and granary capacities are game-specific approximations. The world and its stone deposits are generated from primitives.
