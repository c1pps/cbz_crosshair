-- ============================================================================
--  cbz_crosshair — configuration
--  Left out of escrow: edit freely. Developed by wthejulio · CBz Network
-- ============================================================================
Config = {}

Config.Locale = 'en'                -- locales/<code>.lua (en, fr). Missing keys fall back to English.

-- /crosshair opens the menu, /crosshair reset restores the default below.
Config.Command = 'crosshair'
Config.DefaultKey = ''              -- e.g. 'F7'. Empty = unbound: players bind it in Settings > Key Bindings > FiveM.

-- What a player gets until they pick something themselves:
--   'native' = the game reticle (or the reticle your server streams), 'none', or a preset id below.
Config.Default = 'native'

-- "Faint until you aim": off = the crosshair only shows while aiming (like GTA);
-- on = it shows faintly as soon as a weapon is out, and at full opacity while aiming.
Config.DefaultFaint = false         -- what players get until they flip the switch
Config.FaintOpacity = 35            -- % opacity of the faint crosshair (weapon out, not aiming)
-- Hit sound: when you hit a player or NPC with a firearm (Config.WeaponGroups, explosives excluded), alive or dead.
Config.DefaultHitSound = true       -- what players get until they flip the switch
Config.HitSoundVolume = 50          -- %
-- Played at random, never the same twice in a row. Included sets (CC0 recordings from Freesound):
--   { 'sounds/visceral_1.ogg', 'sounds/visceral_2.ogg', 'sounds/visceral_3.ogg' }  bullet impacts in flesh (default)
--   { 'sounds/flesh_1.ogg', 'sounds/flesh_2.ogg', 'sounds/flesh_3.ogg' }           dull flesh impacts
--   { 'sounds/headshot.ogg' }  { 'sounds/meaty.ogg' }  { 'sounds/body.ogg' }        single impacts
--   { 'sounds/hit_1.ogg', 'sounds/hit_2.ogg', 'sounds/hit_3.ogg' }                 punches  ·  { 'sounds/tick.ogg' } arcade tick
-- Your own .ogg files: drop them in web/sounds/.
Config.HitSoundFiles = { 'sounds/visceral_1.ogg', 'sounds/visceral_2.ogg', 'sounds/visceral_3.ogg' }

-- Look bug: when the camera sees past a wall your gun is behind (the same check as anti-lookbug scripts
-- that block the shot when the gun is behind cover), the crosshair goes faint while you aim. false = keep it as is.
Config.DimWhenBlocked = true

Config.TargetColor = '#e03232'      -- like GTA: colour while aiming at a ped (NPC or player, alive or dead). false = never change colour

Config.AllowNone = true             -- players may turn the crosshair off completely
Config.AllowFaint = true            -- "Faint until you aim" switch in the menu (false = hidden, everyone gets Config.DefaultFaint)
Config.AllowHitSound = true         -- "Hit sound" switch in the menu (false = hidden, everyone gets Config.DefaultHitSound)
Config.AllowEditor = true           -- Editor tab (colour, lines, dot, circle, outline)
Config.AllowShareCodes = true       -- copy / import CBZ1-… codes between players

-- The "game reticle" tile. preview = how the tile is drawn in the menu (the game draws the real thing):
--   'gta' (the stock GTA dot), the id of a preset below, or a style table that looks like your streamed reticle.
Config.Native = {
    label = 'Server default',
    preview = 'gta',
    -- Streaming your own reticle? Draw it here so the tile looks like it, e.g. a black ring with white ticks:
    -- preview = { color = '#ffffff', lines = true, length = 3, thickness = 1, gap = 7, dot = true, dotSize = 2,
    --             circle = true, radius = 9, circleThickness = 2, circleColor = '#000000', outline = false },
}

-- Colour swatches shown in the editor (a hex field is always available too).
Config.Swatches = { '#ffffff', '#d4d4d8', '#000000', '#4dff7a', '#3ce8ff', '#ffe14d', '#ff4d4d' }

-- Presets: small, plain white, roleplay-friendly. Sizes are pixels on a 1080p screen (scaled for other resolutions).
--   style keys: color, opacity (10-100), lines, tshape, length (0-30), thickness (1-8), gap (-4-20),
--               dot, dotSize (1-10), dotRound, circle, radius (3-40), circleThickness (1-6),
--               circleColor (hex, or nil to match color), outline, outlineThickness (1-3)
--   Image preset: drop a PNG in web/custom/ and use { id = 'mine', label = 'Mine', image = 'custom/mine.png', size = 32 }
--   (size = pixels at 1080p). Image presets cannot be edited or shared as a code.
Config.Presets = {
    { id = 'dot', label = 'Dot', style = {
        color = '#ffffff', lines = false, dot = true, dotSize = 4, dotRound = true, outline = false,
    } },
    { id = 'square', label = 'Square', style = {
        color = '#ffffff', lines = false, dot = true, dotSize = 3, dotRound = false, outline = false,
    } },
    { id = 'cross', label = 'Cross', style = {
        color = '#ffffff', lines = true, length = 4, thickness = 2, gap = 2, outline = false,
    } },
    { id = 'circle', label = 'Circle', style = {
        color = '#ffffff', lines = false, circle = true, radius = 4, circleThickness = 1, outline = false,
    } },
    -- { id = 'example', label = 'Example PNG', image = 'custom/example.png', size = 24 },
}

-- Weapon groups that use the player's crosshair. Anything else keeps the game reticle
-- (heavy weapons are left out on purpose: their lock-on indicators are part of the game reticle).
-- Snipers always switch back to the real game scope while scoped in.
Config.WeaponGroups = {
    'GROUP_PISTOL', 'GROUP_SMG', 'GROUP_RIFLE', 'GROUP_MG', 'GROUP_SHOTGUN',
    'GROUP_SNIPER', 'GROUP_STUNGUN', 'GROUP_THROWN',
}

-- Weapons that always keep the game reticle, even inside a group above (e.g. an add-on scoped rifle).
Config.GameReticleWeapons = {
    -- 'WEAPON_MARKSMANRIFLE',
}

-- How messages are shown. Replace with your own notification resource if you like.
Config.Notify = function(message)
    BeginTextCommandThefeedPost('STRING')
    AddTextComponentSubstringPlayerName(message)
    EndTextCommandThefeedPostTicker(false, false)
end
