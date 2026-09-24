export const TILE_SIZE = 2;
export const MAP_CELLS = 400;
export const WORLD_RADIUS = MAP_CELLS * TILE_SIZE / 2;

export const PRESETS = {
  CRUSADER_STANDARD: { productionSpeed:1, workerMoveSpeedModifier:1, populationSpawnModifier:1, consumptionModifier:1 },
  BATTLE_ROYALE: { productionSpeed:1.35, workerMoveSpeedModifier:1.10, populationSpawnModifier:1.30, consumptionModifier:1 }
};
export const ACTIVE_PRESET = PRESETS.BATTLE_ROYALE;

const building = (name, category, cost, workers=0, footprint=[2,2], extra={}) => ({name,category,cost,workers,footprint,mask:Array.from({length:footprint[1]},()=> '1'.repeat(footprint[0])),entrance:[0,1],interaction:[0,-1],delivery:[1,0],...extra});
export const BUILDINGS = {
  house: building('Keep','Housing / Storage',{},0,[3,3]),
  stockpile: building('Stockpile','Housing / Storage',{},0,[2,2],{storage:'stockpile',expansionCost:{wood:2}}),
  granary: building('Granary','Housing / Storage',{wood:5},0,[2,2],{storage:'granary'}),
  hovel: building('Hovel','Housing / Storage',{wood:6},0,[2,2],{housing:8}),
  lumber: building('Woodcutter','Raw Resources',{wood:3},1),
  hunting: building("Hunter's Post",'Food',{wood:5},1),
  orchard: building('Apple Orchard','Food',{wood:5},1,[3,3],{fertile:true}),
  dairy: building('Dairy Farm','Food',{wood:10},1,[3,3]),
  hops: building('Hops Farm','Food',{wood:15},1,[3,3],{fertile:true}),
  wheatFarm: building('Wheat Farm','Food',{wood:15},1,[4,4],{fertile:true}),
  mill: building('Mill','Food',{wood:20},3),
  bakery: building('Bakery','Food',{wood:10},1),
  brewery: building('Brewery','Food',{wood:10},1),
  quarry: building('Quarry','Raw Resources',{wood:20},3,[2,2],{deposit:'stone'}),
  oxTether: building('Ox Tether','Raw Resources',{wood:5},1),
  ironMine: building('Iron Mine','Raw Resources',{wood:20},2,[2,2],{deposit:'iron'}),
  market: building('Market','Trade',{wood:5}),
  armoury: building('Armoury','Military',{wood:5},0,[3,3],{storage:'armoury'}),
  barracks: building('Barracks','Military',{stone:15}),
  mercenaryPost: building('Mercenary Post','Military',{wood:10}),
  fletcher: building('Fletcher','Military',{wood:20,gold:100},1),
  poleturner: building('Poleturner','Military',{wood:10,gold:100},1),
  blacksmith: building('Blacksmith','Military',{wood:20,gold:200},1),
  armourer: building('Armourer','Military',{wood:20,gold:100},1),
  tanner: building('Tanner','Military',{wood:10,gold:50},1),
  stable: building('Stable','Military',{wood:20,gold:400})
};

export const BUILDING_HELP = {
  stockpile:'Stores wood, stone, iron, wheat, flour, hops, ale and leather. Place near workers to shorten deliveries.',
  granary:'Stores meat, apples, cheese and bread for your people to eat.',
  hovel:'Adds housing for 8 people, allowing new peasants to move in when popularity is high enough.',
  lumber:'Sends one woodcutter to the nearest unclaimed tree anywhere on the map. Wood is delivered to a stockpile.',
  hunting:'Sends one hunter after the nearest unclaimed deer anywhere on the map. Meat is delivered to a granary.',
  orchard:'Produces apples for a granary. Must be built on green fertile ground.',
  dairy:'Produces cheese for a granary and occasional leather for a stockpile.',
  hops:'Grows hops for the brewery. Must be built on green fertile ground.',
  wheatFarm:'Grows wheat for the mill. Must be built on green fertile ground.',
  mill:'Turns wheat from a stockpile into flour for a stockpile.',
  bakery:'Turns flour from a stockpile into bread for a granary.',
  brewery:'Turns hops from a stockpile into ale for a stockpile. Ale has no consumption effect yet.',
  quarry:'Mines stone from a gray stone deposit. Build an Ox Tether to haul the stone to a stockpile.',
  oxTether:'Provides an ox and handler to haul quarried stone to a stockpile.',
  ironMine:'Mines iron for a stockpile. Must be built on an iron deposit.',
  market:'Enables buying and selling goods in Tab Stores while you are near the market.',
  armoury:'Stores weapons and armour needed to recruit soldiers at a barracks.',
  barracks:'Recruits soldiers using an idle peasant, gold and equipment from an armoury. Select it, then press 1–6.',
  mercenaryPost:'Recruits mercenaries for gold without peasants or equipment. Select it, then press 1–7.',
  fletcher:'Turns wood into bows or crossbows for the armoury. Select the building and press C to change recipe.',
  poleturner:'Turns wood into spears or pikes for the armoury. Select the building and press C to change recipe.',
  blacksmith:'Turns iron into swords or maces for the armoury. Select the building and press C to change recipe.',
  armourer:'Turns iron into metal armour for the armoury.',
  tanner:'Turns leather from dairy farms into leather armour for the armoury.',
  stable:'Cavalry support is not implemented yet; this building currently has no gameplay effect.'
};

export const FOOD = ['meat','apples','cheese','bread'];
export const STOCKPILE_ITEMS = ['wood','stone','iron','wheat','flour','hops','ale','leather'];
export const ARMOURY_ITEMS = ['bow','crossbow','spear','pike','mace','sword','leatherArmour','metalArmour'];
export const RESOURCES = [...STOCKPILE_ITEMS,...FOOD,...ARMOURY_ITEMS];
export const STORAGE_CAPACITY = {stockpile:240,granary:160,armoury:120};

export const RECIPES = {
  orchard:{output:'apples',amount:3,duration:27,storage:'granary'},
  dairy:{output:'cheese',amount:3,duration:28,storage:'granary',establish:55},
  wheatFarm:{output:'wheat',amount:12,duration:220,storage:'stockpile'},
  hops:{output:'hops',amount:4,duration:55,storage:'stockpile'},
  mill:{input:{wheat:1},output:'flour',amount:1,duration:10,storage:'stockpile'},
  bakery:{input:{flour:1},output:'bread',amount:8,duration:25,storage:'granary'},
  brewery:{input:{hops:1},output:'ale',amount:1,duration:30,storage:'stockpile'},
  ironMine:{output:'iron',amount:1,duration:40,storage:'stockpile'},
  fletcher:{input:{wood:1},output:'bow',amount:1,duration:44,storage:'armoury'},
  poleturner:{input:{wood:1},output:'spear',amount:1,duration:24,storage:'armoury'},
  blacksmith:{input:{iron:1},output:'sword',amount:1,duration:36,storage:'armoury'},
  armourer:{input:{iron:1},output:'metalArmour',amount:1,duration:36,storage:'armoury'},
  tanner:{input:{leather:1},output:'leatherArmour',amount:3,duration:38,storage:'armoury'}
};
export const RECIPE_OPTIONS = {
  fletcher:[{output:'bow',input:{wood:1},duration:44},{output:'crossbow',input:{wood:1},duration:56}],
  poleturner:[{output:'spear',input:{wood:1},duration:24},{output:'pike',input:{wood:2},duration:40}],
  blacksmith:[{output:'sword',input:{iron:1},duration:36},{output:'mace',input:{iron:1},duration:36}]
};
export const MARKET_PRICES = Object.fromEntries(Object.entries({wood:1,stone:6,iron:18,wheat:2,flour:4,meat:1,apples:1,cheese:1,bread:1,bow:14,crossbow:18,spear:7,pike:11,mace:20,sword:22,leatherArmour:14,metalArmour:18}).map(([key,sell])=>[key,{sell,buy:Math.ceil(sell*2)}]));
export const RATIONS = [{name:'None',multiplier:0,popularity:-8},{name:'Half',multiplier:.5,popularity:-4},{name:'Full',multiplier:1,popularity:0},{name:'Extra',multiplier:1.5,popularity:4},{name:'Double',multiplier:2,popularity:8}];
export const TAXES = [{name:'None',rate:0,popularity:1},{name:'Low',rate:.15,popularity:-2},{name:'Average',rate:.30,popularity:-4},{name:'High',rate:.45,popularity:-6},{name:'Mean',rate:.60,popularity:-8},{name:'Extortionate',rate:.90,popularity:-12},{name:'Cruel',rate:1.20,popularity:-16}];
export const POPULARITY = {base:50,monthSeconds:16,initialPeasants:8,initialHousing:8,maxIdleAtFire:24};
export const WORKER_CYCLES = {treeLogs:3,woodCarry:12,woodChopPerLog:6,meatPerDeer:3,quarryWork:10.5,quarryBuffer:24,oxCapacity:8};
export const UNITS = {
  spearman:{goldCost:8,equipment:{spear:1},hp:50,damage:9,armour:0,speed:4.5,range:1.7,cooldown:1},
  archer:{goldCost:12,equipment:{bow:1},hp:42,damage:9,armour:0,speed:4.1,range:12,cooldown:1.5},
  maceman:{goldCost:20,equipment:{mace:1,leatherArmour:1},hp:64,damage:15,armour:2,speed:5,range:1.7,cooldown:.85},
  crossbowman:{goldCost:20,equipment:{crossbow:1,leatherArmour:1},hp:55,damage:20,armour:2,penetration:4,speed:3.7,range:11,cooldown:2.2},
  pikeman:{goldCost:20,equipment:{pike:1,metalArmour:1},hp:105,damage:12,armour:6,speed:3.3,range:2.2,cooldown:1.2},
  swordsman:{goldCost:40,equipment:{sword:1,metalArmour:1},hp:90,damage:18,armour:5,penetration:2,speed:3.7,range:1.7,cooldown:1},
  slave:{goldCost:5,mercenary:true,hp:28,damage:5,armour:0,speed:4.8,range:1.5,cooldown:1},
  slinger:{goldCost:12,mercenary:true,hp:32,damage:7,armour:0,speed:4.4,range:8,cooldown:1.2},
  assassin:{goldCost:60,mercenary:true,hp:65,damage:22,armour:1,speed:5.5,range:1.6,cooldown:.7},
  arabianArcher:{goldCost:75,mercenary:true,hp:55,damage:12,armour:1,speed:4.5,range:13,cooldown:1.1},
  horseArcher:{goldCost:80,mercenary:true,hp:65,damage:12,armour:1,speed:6,range:12,cooldown:1.3},
  arabianSwordsman:{goldCost:80,mercenary:true,hp:88,damage:18,armour:3,speed:4.8,range:1.7,cooldown:.9},
  fireThrower:{goldCost:100,mercenary:true,hp:45,damage:28,armour:0,speed:3.8,range:7,cooldown:2.4}
};
export const MATCH_PHASES = [
  {name:'Settlement',start:0,radius:400,damage:0},
  {name:'Expansion',start:300,radius:400,damage:1},
  {name:'Militarization',start:600,radius:340,damage:2},
  {name:'War',start:900,radius:270,damage:4},
  {name:'Endgame',start:1320,radius:190,damage:8},
  {name:'Final',start:1680,radius:90,damage:16},
  {name:'Final collapse',start:1800,radius:15,damage:24}
];
