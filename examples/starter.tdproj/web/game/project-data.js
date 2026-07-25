export default {
  "manifest": {
    "schemaVersion": 2,
    "name": "Starter Tower Defense",
    "description": "A minimal example project for TowerForge",
    "engineVersion": "0.1.0",
    "defaultMissionId": "tutorial_01"
  },
  "balance": {
    "currencies": [
      {
        "id": "coins",
        "label": "Coins",
        "color": 16107330
      }
    ],
    "defaultDifficultyId": "normal",
    "difficulties": [
      {
        "id": "story",
        "label": "Story",
        "description": "More room to learn and experiment.",
        "enemyHpMultiplier": 0.8,
        "enemySpeedMultiplier": 0.9,
        "enemyRewardMultiplier": 1.15,
        "coreDamageMultiplier": 0.75,
        "startingResourceMultiplier": 1.2,
        "coreHpMultiplier": 1.2
      },
      {
        "id": "normal",
        "label": "Normal",
        "description": "The authored baseline."
      },
      {
        "id": "veteran",
        "label": "Veteran",
        "description": "Tighter economy and faster, tougher enemies.",
        "enemyHpMultiplier": 1.25,
        "enemySpeedMultiplier": 1.1,
        "enemyRewardMultiplier": 0.9,
        "coreDamageMultiplier": 1.25,
        "startingResourceMultiplier": 0.85,
        "coreHpMultiplier": 0.9
      }
    ],
    "metaProgression": {
      "currencies": [
        {
          "id": "forge_shards",
          "label": "Forge Shards",
          "color": 8304856
        }
      ],
      "upgrades": {
        "sharpened_tools": {
          "id": "sharpened_tools",
          "label": "Sharpened Tools",
          "description": "All towers deal 8% more damage per level.",
          "maxLevel": 3,
          "costs": [
            {
              "forge_shards": 2
            },
            {
              "forge_shards": 4
            },
            {
              "forge_shards": 7
            }
          ],
          "effects": [
            {
              "kind": "towerDamage",
              "multiplierPerLevel": 0.08
            }
          ]
        },
        "reinforced_core": {
          "id": "reinforced_core",
          "label": "Reinforced Core",
          "description": "Begin each mission with 2 additional core HP per level.",
          "maxLevel": 3,
          "costs": [
            {
              "forge_shards": 1
            },
            {
              "forge_shards": 3
            },
            {
              "forge_shards": 5
            }
          ],
          "effects": [
            {
              "kind": "coreHp",
              "amountPerLevel": 2
            }
          ]
        }
      },
      "rewardsByMission": {
        "tutorial_01": {
          "firstClear": {
            "forge_shards": 2
          },
          "repeatClear": {
            "forge_shards": 1
          },
          "perStar": {
            "forge_shards": 1
          }
        }
      }
    },
    "constants": {
      "timeUnitSeconds": 0.1,
      "startingCoreHp": 10,
      "startingCoins": 100,
      "startingResources": {
        "coins": 100
      },
      "prepTimeUnits": 60,
      "moveTowerCost": {
        "coins": 50
      },
      "waterGroundSpeedFactor": 0.5,
      "pathWaterCooldownUnits": 60,
      "pathWaterDurationUnits": 20,
      "pathWaterRadius": 3,
      "pathWaterGroundSpeedFactor": 0.3
    },
    "defaultMissionId": "tutorial_01",
    "abilities": {
      "path_water": {
        "id": "path_water",
        "label": "Water Path",
        "cooldown": 60,
        "duration": 20,
        "radius": 3
      }
    },
    "enemies": {
      "basic_grunt": {
        "id": "basic_grunt",
        "label": "Basic Grunt",
        "maxHp": 10,
        "speed": 1,
        "reward": {
          "coins": 5
        },
        "coinReward": 5,
        "coreDamage": 1,
        "color": 16107595,
        "hitRadius": 0.55
      },
      "armored_brute": {
        "id": "armored_brute",
        "label": "Armored Brute",
        "maxHp": 40,
        "speed": 0.5,
        "reward": {
          "coins": 10
        },
        "coinReward": 10,
        "coreDamage": 3,
        "color": 11024971,
        "hitRadius": 0.85,
        "pathCollisionRadius": 0.9
      },
      "swift_runner": {
        "id": "swift_runner",
        "label": "Swift Runner",
        "maxHp": 5,
        "speed": 2.5,
        "reward": {
          "coins": 3
        },
        "coinReward": 3,
        "coreDamage": 1,
        "color": 13949277,
        "hitRadius": 0.4,
        "ignoresWaterSlow": true
      }
    },
    "towers": {
      "arrow_tower": {
        "id": "arrow_tower",
        "label": "Arrow Tower",
        "cost": {
          "coins": 50
        },
        "footprintRadius": 1,
        "range": 5,
        "attack": {
          "kind": "single",
          "fireRate": 1.5,
          "damagePerStack": 1,
          "startingStacks": 3,
          "maxStacks": 8,
          "upgradeCost": 40
        }
      },
      "cannon_tower": {
        "id": "cannon_tower",
        "label": "Cannon Tower",
        "cost": {
          "coins": 80
        },
        "footprintRadius": 1,
        "range": 4,
        "attack": {
          "kind": "splash",
          "interval": 2,
          "damage": 5,
          "splashDamage": 2,
          "armoredChipDamage": 1,
          "splashRadius": 1,
          "slowFactor": 0.6,
          "slowDuration": 3,
          "intervalByLevel": [
            2,
            1.6,
            1.2
          ],
          "upgradeCosts": [
            {
              "coins": 60
            },
            {
              "coins": 90
            }
          ]
        }
      }
    },
    "waveSets": {
      "tutorial_waves": [
        {
          "id": "wave_1",
          "label": "Wave 1",
          "groups": [
            {
              "enemyId": "basic_grunt",
              "count": 5,
              "spawnInterval": 2,
              "startDelay": 0
            }
          ]
        },
        {
          "id": "wave_2",
          "label": "Wave 2",
          "groups": [
            {
              "enemyId": "basic_grunt",
              "count": 5,
              "spawnInterval": 1.5,
              "startDelay": 0
            },
            {
              "enemyId": "swift_runner",
              "count": 3,
              "spawnInterval": 1,
              "startDelay": 4
            }
          ]
        },
        {
          "id": "wave_3",
          "label": "Wave 3",
          "groups": [
            {
              "enemyId": "basic_grunt",
              "count": 6,
              "spawnInterval": 1.2,
              "startDelay": 0
            },
            {
              "enemyId": "armored_brute",
              "count": 1,
              "spawnInterval": 3,
              "startDelay": 5
            }
          ]
        }
      ]
    },
    "missions": {
      "tutorial_01": {
        "id": "tutorial_01",
        "label": "Tutorial",
        "description": "Learn the basics",
        "availability": "playable",
        "startingCoreHp": 10,
        "startingResources": {
          "coins": 150
        },
        "prepTimeUnits": 60,
        "mapId": "tutorial_map",
        "waveSetId": "tutorial_waves",
        "buildTowerIds": [
          "arrow_tower",
          "cannon_tower"
        ],
        "abilityIds": []
      }
    },
    "terrainTypes": {
      "buildable": {
        "id": "buildable",
        "label": "Buildable",
        "buildable": true,
        "walkable": true,
        "groundSpeedMultiplier": 1,
        "tags": [
          "ground"
        ]
      },
      "path": {
        "id": "path",
        "label": "Path",
        "buildable": false,
        "walkable": true,
        "groundSpeedMultiplier": 1,
        "tags": [
          "path"
        ]
      },
      "blocked": {
        "id": "blocked",
        "label": "Blocked",
        "buildable": false,
        "walkable": false,
        "groundSpeedMultiplier": 1,
        "tags": [
          "blocked"
        ]
      },
      "core": {
        "id": "core",
        "label": "Core",
        "buildable": false,
        "walkable": true,
        "groundSpeedMultiplier": 1,
        "tags": [
          "objective"
        ]
      },
      "spawn": {
        "id": "spawn",
        "label": "Spawn",
        "buildable": false,
        "walkable": true,
        "groundSpeedMultiplier": 1,
        "tags": [
          "spawn"
        ]
      },
      "water": {
        "id": "water",
        "label": "Water",
        "buildable": false,
        "walkable": true,
        "groundSpeedMultiplier": 0.5,
        "tags": [
          "water"
        ]
      }
    }
  },
  "worldMap": {
    "width": 800,
    "height": 600,
    "regions": [
      {
        "id": "forest",
        "label": "The Forest",
        "description": "A peaceful forest under threat",
        "bounds": {
          "x": 0,
          "y": 0,
          "width": 800,
          "height": 600
        },
        "accent": "#4a7c4a",
        "biome": "meadow",
        "connections": []
      }
    ],
    "missionNodes": [
      {
        "missionId": "tutorial_01",
        "regionId": "forest",
        "x": 200,
        "y": 300,
        "difficulty": 1,
        "unlockRequiresMissionIds": []
      }
    ]
  },
  "maps": {
    "tutorial_map": {
      "id": "tutorial_map",
      "width": 15,
      "height": 20,
      "grid": {
        "kind": "hex",
        "layout": "odd-r"
      },
      "defaultTerrain": "buildable",
      "spawnCoord": {
        "q": 7,
        "r": 0
      },
      "coreCoord": {
        "q": 7,
        "r": 19
      },
      "pathCenterline": [
        {
          "q": 7,
          "r": 0
        },
        {
          "q": 7,
          "r": 1
        },
        {
          "q": 7,
          "r": 2
        },
        {
          "q": 7,
          "r": 3
        },
        {
          "q": 7,
          "r": 4
        },
        {
          "q": 7,
          "r": 5
        },
        {
          "q": 7,
          "r": 6
        },
        {
          "q": 7,
          "r": 7
        },
        {
          "q": 7,
          "r": 8
        },
        {
          "q": 7,
          "r": 9
        },
        {
          "q": 7,
          "r": 10
        },
        {
          "q": 7,
          "r": 11
        },
        {
          "q": 7,
          "r": 12
        },
        {
          "q": 7,
          "r": 13
        },
        {
          "q": 7,
          "r": 14
        },
        {
          "q": 7,
          "r": 15
        },
        {
          "q": 7,
          "r": 16
        },
        {
          "q": 7,
          "r": 17
        },
        {
          "q": 7,
          "r": 18
        },
        {
          "q": 7,
          "r": 19
        }
      ],
      "pathRoutes": [
        {
          "id": "main",
          "pathCenterline": [
            {
              "q": 7,
              "r": 0
            },
            {
              "q": 7,
              "r": 1
            },
            {
              "q": 7,
              "r": 2
            },
            {
              "q": 7,
              "r": 3
            },
            {
              "q": 7,
              "r": 4
            },
            {
              "q": 7,
              "r": 5
            },
            {
              "q": 7,
              "r": 6
            },
            {
              "q": 7,
              "r": 7
            },
            {
              "q": 7,
              "r": 8
            },
            {
              "q": 7,
              "r": 9
            },
            {
              "q": 7,
              "r": 10
            },
            {
              "q": 7,
              "r": 11
            },
            {
              "q": 7,
              "r": 12
            },
            {
              "q": 7,
              "r": 13
            },
            {
              "q": 7,
              "r": 14
            },
            {
              "q": 7,
              "r": 15
            },
            {
              "q": 7,
              "r": 16
            },
            {
              "q": 7,
              "r": 17
            },
            {
              "q": 7,
              "r": 18
            },
            {
              "q": 7,
              "r": 19
            }
          ]
        }
      ],
      "terrainOverrides": [
        {
          "q": 7,
          "r": 0,
          "terrain": "spawn"
        },
        {
          "q": 7,
          "r": 1,
          "terrain": "path"
        },
        {
          "q": 7,
          "r": 2,
          "terrain": "path"
        },
        {
          "q": 7,
          "r": 3,
          "terrain": "path"
        },
        {
          "q": 7,
          "r": 4,
          "terrain": "path"
        },
        {
          "q": 7,
          "r": 5,
          "terrain": "path"
        },
        {
          "q": 7,
          "r": 6,
          "terrain": "path"
        },
        {
          "q": 7,
          "r": 7,
          "terrain": "path"
        },
        {
          "q": 7,
          "r": 8,
          "terrain": "path"
        },
        {
          "q": 7,
          "r": 9,
          "terrain": "path"
        },
        {
          "q": 7,
          "r": 10,
          "terrain": "path"
        },
        {
          "q": 7,
          "r": 11,
          "terrain": "path"
        },
        {
          "q": 7,
          "r": 12,
          "terrain": "path"
        },
        {
          "q": 7,
          "r": 13,
          "terrain": "path"
        },
        {
          "q": 7,
          "r": 14,
          "terrain": "path"
        },
        {
          "q": 7,
          "r": 15,
          "terrain": "path"
        },
        {
          "q": 7,
          "r": 16,
          "terrain": "path"
        },
        {
          "q": 7,
          "r": 17,
          "terrain": "path"
        },
        {
          "q": 7,
          "r": 18,
          "terrain": "path"
        },
        {
          "q": 7,
          "r": 19,
          "terrain": "core"
        }
      ],
      "label": "tutorial_map"
    }
  },
  "scripts": {
    "starter_gameplay": {
      "schemaVersion": 1,
      "id": "starter_gameplay",
      "label": "Starter gameplay hooks",
      "description": "A safe TowerScript example. Extend handlers or add more files under scripts/.",
      "enabled": true,
      "bindings": [
        {
          "scope": "global"
        }
      ],
      "initialState": {
        "wavesStarted": 0
      },
      "handlers": {
        "waveStarted": [
          {
            "id": "count_waves",
            "actions": [
              {
                "action": "incrementState",
                "key": "wavesStarted",
                "amount": 1
              }
            ]
          }
        ]
      }
    }
  },
  "visuals": {
    "schemaVersion": 2,
    "assetsRoot": "assets",
    "atlases": {},
    "sprites": {
      "frontier_before_battle": {
        "src": "assets/backgrounds/frontier-before-battle.png"
      }
    },
    "tileSets": {},
    "bindings": {
      "towers": {
        "arrow_tower": "arrow_tower",
        "cannon_tower": "cannon_tower"
      },
      "enemies": {
        "basic_grunt": "basic_grunt",
        "armored_brute": "armored_brute",
        "swift_runner": "swift_runner"
      },
      "tiles": {},
      "tileSets": {
        "grids": {},
        "maps": {}
      },
      "ui": {}
    },
    "audio": {
      "sounds": {},
      "events": {},
      "musicTracks": {},
      "musicByMission": {}
    },
    "terrainTextureSize": 128,
    "creatureFrameSize": 512,
    "frames": {
      "creatures": {
        "basic_grunt": 0,
        "armored_brute": 1,
        "arrow_tower": 2,
        "cannon_tower": 3
      }
    },
    "spriteAnimationClips": {},
    "enemyMoveClips": {},
    "towerAttackClips": {},
    "towerSpriteSpecs": {
      "arrow_tower": {
        "texture": "creatures",
        "frame": 2,
        "width": 5.1,
        "pulse": 0.04,
        "rotation": 0.025
      },
      "cannon_tower": {
        "texture": "creatures",
        "frame": 3,
        "width": 5.5,
        "pulse": 0.03,
        "rotation": 0.02
      }
    },
    "enemySpriteSpecs": {
      "basic_grunt": {
        "texture": "creatures",
        "frame": 0,
        "width": 3.05,
        "bob": 0.06,
        "bobSpeed": 0.008,
        "rotation": 0.05
      },
      "armored_brute": {
        "texture": "creatures",
        "frame": 1,
        "width": 4.2,
        "bob": 0.03,
        "bobSpeed": 0.005,
        "rotation": 0.02
      },
      "swift_runner": {
        "texture": "creatures",
        "frame": 0,
        "width": 2.6,
        "bob": 0.1,
        "bobSpeed": 0.016,
        "rotation": 0.08
      }
    },
    "entityVisuals": {
      "basic_grunt": {
        "id": "basic_grunt",
        "atlas": "creatures",
        "frame": 0,
        "frameSize": 512,
        "accent": "#f5c84b",
        "animation": "plant-sway"
      },
      "armored_brute": {
        "id": "armored_brute",
        "atlas": "creatures",
        "frame": 1,
        "frameSize": 512,
        "accent": "#a86c4b",
        "animation": "heavy-sway"
      },
      "swift_runner": {
        "id": "swift_runner",
        "atlas": "creatures",
        "frame": 0,
        "frameSize": 512,
        "accent": "#d4d95d",
        "animation": "spin"
      },
      "arrow_tower": {
        "id": "arrow_tower",
        "atlas": "creatures",
        "frame": 2,
        "frameSize": 512,
        "accent": "#f8d67a",
        "animation": "idle"
      },
      "cannon_tower": {
        "id": "cannon_tower",
        "atlas": "creatures",
        "frame": 3,
        "frameSize": 512,
        "accent": "#8ecfbb",
        "animation": "idle"
      },
      "core": {
        "id": "core",
        "atlas": "creatures",
        "frame": 4,
        "frameSize": 512,
        "accent": "#b578ff",
        "animation": "core-pulse"
      }
    }
  },
  "storyComics": {
    "seenStoragePrefix": "story_seen_",
    "comics": {
      "frontier_briefing": {
        "missionId": "tutorial_01",
        "title": "The Frontier Holds",
        "trigger": "beforeMission",
        "replay": "once",
        "panels": [
          {
            "speaker": "Scout",
            "text": "The first wave is crossing the old frontier road. Build where the route bends and protect the crystal core.",
            "spriteId": "frontier_before_battle"
          },
          {
            "speaker": "Commander",
            "text": "Start with an Arrow Tower. Add heavier fire only when the armored enemies arrive."
          }
        ]
      }
    }
  },
  "battleBackgrounds": {
    "fallbackMissionId": "tutorial_01",
    "placeholderMissionIds": [],
    "definitions": {
      "tutorial_01": {
        "color": "#101410",
        "spriteId": "frontier_before_battle",
        "opacity": 0.6
      }
    }
  },
  "buildTarget": {
    "id": "web-pwa",
    "platform": "web",
    "market": "pwa",
    "storeChannel": "pwa",
    "appId": "local.towerforge.starter",
    "appName": "Web PWA",
    "appTitle": "Starter Tower Defense",
    "webDir": "dist",
    "backgroundColor": "#111111",
    "appVersion": "0.1.0",
    "renderer": "canvas"
  }
};
