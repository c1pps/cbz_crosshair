-- lua5.4 tests/client_sim.lua <resource dir>
-- Runs the real client/main.lua against stubbed FiveM natives and drives the frame loop.
local dir = arg[1] or '.'
local passed, failed = 0, 0
local function check(name, cond, extra)
    if cond then passed = passed + 1 else failed = failed + 1; print('FAIL ' .. name .. (extra and (' — ' .. tostring(extra)) or '')) end
end

-- ---------------------------------------------------------------- tiny serializer standing in for json
local function ser(v)
    local t = type(v)
    if t == 'string' then return string.format('%q', v) end
    if t ~= 'table' then return tostring(v) end
    local out = {}
    for k, val in pairs(v) do out[#out + 1] = '[' .. ser(k) .. ']=' .. ser(val) end
    return '{' .. table.concat(out, ',') .. '}'
end

local function B(v) if v then return 1 end return false end

-- minimal vector3 (FiveM gives one with + - * / and #)
local V = {}
V.__index = V
local function vec3(x, y, z) return setmetatable({ x = x, y = y, z = z }, V) end
V.__add = function(a, b) return vec3(a.x + b.x, a.y + b.y, a.z + b.z) end
V.__sub = function(a, b) return vec3(a.x - b.x, a.y - b.y, a.z - b.z) end
V.__mul = function(a, b)
    if type(a) == 'number' then a, b = b, a end
    return vec3(a.x * b, a.y * b, a.z * b)
end
V.__div = function(a, b) return vec3(a.x / b, a.y / b, a.z / b) end
V.__len = function(a) return math.sqrt(a.x * a.x + a.y * a.y + a.z * a.z) end

-- FiveM returns hashes as signed 32-bit integers.
local function joaat(s)
    local h = 0
    for c in s:lower():gmatch('.') do
        h = (h + c:byte()) & 0xFFFFFFFF
        h = (h + (h << 10)) & 0xFFFFFFFF
        h = (h ~ (h >> 6)) & 0xFFFFFFFF
    end
    h = (h + (h << 3)) & 0xFFFFFFFF
    h = (h ~ (h >> 11)) & 0xFFFFFFFF
    h = (h + (h << 15)) & 0xFFFFFFFF
    if h >= 0x80000000 then h = h - 0x100000000 end
    return h
end

local function boot(kvp)
    local W = {
        kvp = kvp or {}, nui = {}, focus = nil, hidden14 = 0, notify = {}, threads = {}, cbs = {}, cmds = {},
        exports = {}, handlers = {}, keymap = nil, suggestion = nil, invoking = nil, lastWait = nil, prints = {}, now = 1000,
        ped = { weapon = 'WEAPON_UNARMED', aiming = false, scoped = false, vehicle = false, driveby = false,
                vehWeapon = false, dead = false, paused = false, hudHidden = false, weaponEntity = 0,
                shooting = false, impact = nil },
        rays = {}, shape = function() return nil end,
        cam = vec3(0, 0, 1.5), weaponPos = vec3(0.3, 0.5, 1.3),
    }
    local GROUPS = {
        WEAPON_UNARMED = 'GROUP_UNARMED', WEAPON_PISTOL = 'GROUP_PISTOL', WEAPON_SNIPERRIFLE = 'GROUP_SNIPER',
        WEAPON_RPG = 'GROUP_HEAVY', WEAPON_GRENADE = 'GROUP_THROWN', WEAPON_MARKSMANRIFLE = 'GROUP_SNIPER',
        WEAPON_KNIFE = 'GROUP_MELEE', WEAPON_PUMPSHOTGUN = 'GROUP_SHOTGUN',
    }
    local env = setmetatable({
        json = { encode = ser, decode = function(s) return load('return ' .. s)() end },
        print = function(...) W.prints[#W.prints + 1] = table.concat({ ... }, ' ') end,
        GetHashKey = joaat,
        PlayerPedId = function() return 1 end,
        PlayerId = function() return 0 end,
        GetSelectedPedWeapon = function() return joaat(W.ped.weapon) end,
        GetWeapontypeGroup = function(h)
            for name, group in pairs(GROUPS) do if joaat(name) == h then return joaat(group) end end
            return 0
        end,
        -- Like FiveM: BOOL natives return 1 or false, never true (see baseevents: `IsPedInAnyVehicle(...) == 1`).
        IsPedInAnyVehicle = function() return B(W.ped.vehicle) end,
        IsPedDoingDriveby = function() return B(W.ped.driveby) end,
        GetCurrentPedVehicleWeapon = function() return B(W.ped.vehWeapon), 0 end,
        IsFirstPersonAimCamActive = function() return B(W.ped.scoped) end,
        IsPlayerFreeAiming = function() return B(W.ped.aiming) end,
        IsAimCamActive = function() return false end,
        IsPauseMenuActive = function() return B(W.ped.paused) end,
        IsHudHidden = function() return B(W.ped.hudHidden) end,
        IsEntityDead = function(e) if e == 1 then return B(W.ped.dead) end return B(e == 78) end,
        vector3 = vec3,
        GetGameplayCamCoord = function() return W.cam end,
        GetGameplayCamRot = function() return vec3(0, 0, 0) end,            -- looking straight along +Y
        GetCurrentPedWeaponEntityIndex = function() return W.ped.weaponEntity end,
        GetEntityCoords = function(e) if e ~= 0 and e == W.ped.weaponEntity then return W.weaponPos end return vec3(0, 0, 0) end,
        IsPedShooting = function() return B(W.ped.shooting) end,
        GetPedLastWeaponImpactCoord = function() return B(W.ped.impact ~= nil), W.ped.impact or vec3(0, 0, 0) end,
        StartShapeTestRay = function(x1, y1, z1, x2, y2, z2, flags, ignore)
            W.rays[#W.rays + 1] = { from = vec3(x1, y1, z1), to = vec3(x2, y2, z2), flags = flags, ignore = ignore }
            return #W.rays
        end,
        GetShapeTestResult = function(h)
            local r = W.shape(W.rays[h]) or {}
            return 2, r.hit or 0, r.coords or vec3(0, 0, 0), vec3(0, 0, 0), r.entity or 0
        end,
        GetEntityPlayerIsFreeAimingAt = function() return B(W.ped.aimAt ~= nil), W.ped.aimAt or 0 end,
        GetPlayerTargetEntity = function() return false, 0 end,
        IsEntityAPed = function(e) return B(e == 77 or e == 78) end,       -- 77 = living ped, 78 = dead ped, 90 = car
        IsPedDeadOrDying = function(e) return B(e == 78) end,
        HideHudComponentThisFrame = function(id) if id == 14 then W.hidden14 = W.hidden14 + 1 end end,
        SendNUIMessage = function(m) W.nui[#W.nui + 1] = m end,
        SetNuiFocus = function(a, b) W.focus = { a, b } end,
        RegisterNUICallback = function(name, fn) W.cbs[name] = fn end,
        RegisterCommand = function(name, fn) W.cmds[name] = fn end,
        RegisterKeyMapping = function(cmd, desc, mapper, key) W.keymap = { cmd, desc, mapper, key } end,
        TriggerEvent = function(name, ...) if name == 'chat:addSuggestion' then W.suggestion = { ... } end end,
        CreateThread = function(fn) W.threads[#W.threads + 1] = coroutine.create(fn) end,
        Wait = function(ms) coroutine.yield(ms) end,
        exports = function(name, fn) W.exports[name] = fn end,
        GetInvokingResource = function() return W.invoking end,
        GetCurrentResourceName = function() return 'cbz_crosshair' end,
        AddEventHandler = function(name, fn) W.handlers[name] = fn end,
        GetGameTimer = function() return W.now end,
        GetResourceKvpString = function(k) return W.kvp[k] end,
        SetResourceKvp = function(k, v) W.kvp[k] = v end,
        DeleteResourceKvp = function(k) W.kvp[k] = nil end,
        BeginTextCommandThefeedPost = function() end,
        AddTextComponentSubstringPlayerName = function(m) W.notify[#W.notify + 1] = m end,
        EndTextCommandThefeedPostTicker = function() end,
    }, { __index = _G })
    env._G = env
    for _, f in ipairs({ 'config.lua', 'locales/en.lua', 'locales/fr.lua', 'shared/locale.lua', 'client/state.lua', 'client/main.lua' }) do
        local chunk = assert(loadfile(dir .. '/' .. f, 't', env))
        chunk()
    end
    W.cfg = env.Config
    -- thread 1 = chat suggestion, thread 2 = frame loop
    for _, co in ipairs(W.threads) do
        local ok, ms = coroutine.resume(co)
        assert(ok, ms)
        W.lastWait = ms
    end
    -- threads: [1] chat suggestion (done), [2] frame loop, [3] shot watcher (hit sound)
    W.loop = W.threads[2]
    function W.frame(n)
        for _ = 1, n or 1 do
            for i = 2, #W.threads do
                local co = W.threads[i]
                if coroutine.status(co) == 'suspended' then
                    local ok, ms = coroutine.resume(co)
                    assert(ok, ms)
                    if co == W.loop then W.lastWait = ms end
                end
            end
        end
    end
    function W.shoot()
        W.ped.shooting = true; W.frame(1); W.ped.shooting = false; W.frame(3)
    end
    function W.call(name, data)
        local out
        W.cbs[name](data, function(r) out = r end)
        return out
    end
    function W.lastMsg(action)
        for i = #W.nui, 1, -1 do if W.nui[i].action == action then return W.nui[i] end end
        return {}
    end
    function W.lastOverlay()
        for i = #W.nui, 1, -1 do if W.nui[i].action == 'overlay' then return W.nui[i].show end end
    end
    return W
end

-- ---------------------------------------------------------------- fresh player, native default
do
    local W = boot()
    check('keymapping registered unbound', W.keymap[1] == 'crosshair' and W.keymap[4] == '')
    check('chat suggestion', W.suggestion and W.suggestion[1] == '/crosshair')
    local r = W.call('ready', {})
    check('ready: no stored settings', r.settings == false)
    check('ready: config sent', (type(r.config.native.preview) == 'table' or r.config.native.preview == 'gta') and #r.config.presets == 4 and r.config.allowEditor == true)
    check('ready: hit sound config sent', r.config.allowHitSound == true and r.config.defaultHitSound == true
        and #r.config.hitSound.files == 3 and r.config.hitSound.files[1] == 'sounds/visceral_1.ogg' and r.config.hitSound.volume == 50)
    check('ready: locale sent', r.locale.title == 'Crosshair')

    W.ped.weapon = 'WEAPON_PISTOL'; W.ped.aiming = true
    W.hidden14 = 0; W.frame(5)
    check('native: game reticle untouched', W.hidden14 == 0)
    check('native: idle sleep 250', W.lastWait == 250, W.lastWait)
    check('native: no overlay', W.lastOverlay() ~= true)

    -- player picks a custom crosshair
    W.call('save', { settings = { v = 1, mode = 'custom', preset = 'cross', faint = false, style = { length = 4 } } })
    check('save persisted to KVP', W.kvp['settings:v1'] and W.kvp['settings:v1']:find('cross', 1, true))
    W.hidden14 = 0; W.frame(3)
    check('custom + aiming pistol: reticle hidden each frame', W.hidden14 == 3, W.hidden14)
    check('custom + aiming: overlay shown', W.lastOverlay() == true)
    check('aiming = full opacity', W.lastMsg('overlay').full == true)
    check('no target in the air', W.lastMsg('overlay').target == false)
    W.ped.aimAt = 77; W.frame(1)
    check('aiming at a living ped: target', W.lastMsg('overlay').target == true)
    W.ped.aimAt = 78; W.frame(1)
    check('aiming at a dead ped: still red', W.lastMsg('overlay').target == true)
    W.ped.aimAt = 90; W.frame(1)
    check('aiming at a car: no target', W.lastMsg('overlay').target == false)
    W.ped.aimAt = 77; W.frame(1)
    W.ped.aiming = false; W.frame(1)
    check('stop aiming clears the target', W.lastMsg('overlay').target == false and W.lastOverlay() == false)
    W.ped.aimAt = nil; W.ped.aiming = true; W.frame(1)

    -- the game does not "aim at" dead bodies: a ray along the crosshair finds them (walls and cars block it)
    local function lastRay(flags) for i = #W.rays, 1, -1 do if W.rays[i].flags == flags then return W.rays[i] end end end
    W.shape = function(r) if r.flags == 31 then return W.aimRay end end
    W.aimRay = { hit = 1, coords = vec3(0, 8, 1.0), entity = 78 }
    W.now = W.now + 100; W.frame(1)
    check('crosshair on a body (no native target): red', W.lastMsg('overlay').target == true)
    local tr = lastRay(31)
    check('body ray: from the camera along the crosshair, ignoring me', tr and tr.from.z == 1.5 and tr.ignore == 1 and tr.to.y > 299)
    W.aimRay = { hit = 1, coords = vec3(0, 8, 1.0), entity = 90 }
    W.now = W.now + 100; W.frame(1)
    check('crosshair on a car: white', W.lastMsg('overlay').target == false)
    W.aimRay = { hit = 1, coords = vec3(0, 3, 1.0), entity = 0 }
    W.now = W.now + 100; W.frame(1)
    check('crosshair on a wall: white', W.lastMsg('overlay').target == false)
    W.aimRay = { hit = 1, coords = vec3(0, 8, 1.0), entity = 78 }
    W.now = W.now + 100; W.frame(1)
    local n0 = #W.rays
    for _ = 1, 10 do W.frame(1) end
    check('body ray throttled (50 ms)', #W.rays - n0 == 0, #W.rays - n0)
    W.ped.aiming = false; W.frame(1)
    W.aimRay = nil; W.ped.aiming = true; W.frame(1)
    check('aiming again: no stale red from the last ray', W.lastMsg('overlay').target == false)
    W.shape = function() return nil end; W.ped.aiming = false; W.frame(1)
    check('custom + covered: hot loop', W.lastWait == 0, W.lastWait)
    local before = #W.nui; W.frame(3)
    check('overlay message only on change', #W.nui == before)

    W.ped.aiming = false; W.hidden14 = 0; W.frame(2)
    check('not aiming: overlay hidden, reticle still hidden', W.lastOverlay() == false and W.hidden14 == 2)

    -- "faint until you aim": faint while the weapon is out, full while aiming
    W.call('save', { settings = { v = 1, mode = 'custom', preset = 'cross', faint = true } })
    W.frame(1)
    check('faint + not aiming: shown faint', W.lastOverlay() == true and W.lastMsg('overlay').full == false)
    W.ped.aiming = true; W.frame(1)
    check('faint + aiming: full', W.lastMsg('overlay').full == true)
    W.ped.aiming = false; W.frame(1)
    W.call('save', { settings = { v = 1, mode = 'custom', preset = 'cross', faint = false } })
    W.frame(1)
    check('faint off: hidden when only armed', W.lastOverlay() == false)
    W.cfg.AllowFaint = false
    W.call('save', { settings = { v = 1, mode = 'custom', preset = 'cross', faint = true } })
    W.frame(1)
    check('AllowFaint = false: server default (off) wins', W.lastOverlay() == false and W.exports.GetSettings().faint == false)
    W.cfg.AllowFaint = true

    -- sniper: scoped keeps the real scope, unscoped gets the crosshair (GROUP_SNIPER hash is > 2^31)
    W.ped.weapon = 'WEAPON_SNIPERRIFLE'; W.ped.aiming = true; W.ped.scoped = true
    W.hidden14 = 0; W.frame(2)
    check('sniper scoped: scope kept', W.hidden14 == 0 and W.lastOverlay() == false)
    W.ped.scoped = false; W.frame(1)
    check('sniper unscoped: custom', W.hidden14 == 1 and W.lastOverlay() == true)

    -- heavy weapons are not covered
    W.ped.weapon = 'WEAPON_RPG'; W.hidden14 = 0; W.frame(2)
    check('RPG: game reticle kept', W.hidden14 == 0 and W.lastOverlay() == false)
    check('RPG: idle sleep 100 in custom mode', W.lastWait == 100, W.lastWait)

    -- drive-by vs vehicle weapon
    W.ped.weapon = 'WEAPON_PISTOL'; W.ped.vehicle = true; W.ped.driveby = true; W.ped.aiming = false
    W.hidden14 = 0; W.frame(1)
    check('drive-by: custom', W.hidden14 == 1 and W.lastOverlay() == true)
    W.ped.driveby = false; W.ped.vehWeapon = true; W.ped.aiming = true; W.hidden14 = 0; W.frame(1)
    check('vehicle weapon: game reticle', W.hidden14 == 0 and W.lastOverlay() == false)
    W.ped.vehicle = false; W.ped.vehWeapon = false

    -- pause / dead
    W.ped.aiming = true; W.ped.paused = true; W.frame(1)
    check('pause: overlay hidden', W.lastOverlay() == false)
    W.ped.paused = false; W.ped.dead = true; W.frame(1)
    check('dead: overlay hidden', W.lastOverlay() == false)
    W.ped.dead = false; W.frame(1)
    check('alive again: overlay back', W.lastOverlay() == true)

    -- exports.SetHidden per resource
    W.invoking = 'cutscene'; W.exports.SetHidden(true)
    W.invoking = 'camera'; W.exports.SetHidden(true)
    W.hidden14 = 0; W.frame(1)
    check('hidden by export', W.lastOverlay() == false and W.hidden14 == 1)
    W.invoking = 'cutscene'; W.exports.SetHidden(false); W.frame(1)
    check('still hidden while another resource holds it', W.lastOverlay() == false)
    W.handlers.onResourceStop('camera'); W.frame(1)
    check('released when that resource stops', W.lastOverlay() == true)

    local gs = W.exports.GetSettings()
    check('GetSettings', gs.mode == 'custom' and gs.preset == 'cross' and gs.faint == false)

    -- menu
    W.cmds.crosshair(0, {})
    check('command opens the menu', W.focus[1] == true and W.nui[#W.nui].action == 'open')
    W.ped.weapon = 'WEAPON_UNARMED'; W.frame(1)
    check('menu: live preview even unarmed', W.lastOverlay() == true)
    W.call('close', {})
    check('close releases focus', W.focus[1] == false and W.nui[#W.nui].action == 'close')
    W.frame(1)
    check('menu closed + unarmed: overlay off', W.lastOverlay() == false)

    -- none mode
    W.call('save', { settings = { mode = 'none', faint = false } })
    W.ped.weapon = 'WEAPON_GRENADE'; W.hidden14 = 0; W.frame(2)
    check('none: throwable reticle hidden', W.hidden14 == 2 and W.lastOverlay() == false)

    -- junk from the page is rejected
    W.call('save', { settings = { mode = 'hacked', faint = 'x' } })
    check('junk falls back to the defaults', W.exports.GetSettings().mode == 'native' and W.exports.GetSettings().faint == false)
    local big = {}; for i = 1, 2000 do big[i] = 'xx' end
    W.call('save', { settings = { mode = 'custom', blob = big } })
    check('oversized payload ignored', W.exports.GetSettings().mode == 'native')

    -- target colour disabled in config
    W.call('save', { settings = { mode = 'custom', preset = 'cross', faint = false } })
    W.cfg.TargetColor = false
    W.ped.weapon = 'WEAPON_PISTOL'; W.ped.aiming = true; W.ped.aimAt = 77; W.frame(1)
    check('TargetColor = false: never red', W.lastOverlay() == true and W.lastMsg('overlay').target == false)
    W.cfg.TargetColor = '#e03232'; W.ped.aimAt = nil; W.ped.aiming = false

    -- /crosshair debug prints what the script sees, once per change
    W.cmds.crosshair(0, { 'debug' })
    W.frame(3)
    local lines = 0
    for _, l in ipairs(W.prints) do if l:find('aimFree=', 1, true) then lines = lines + 1 end end
    check('debug prints state changes only', lines == 1, lines)
    W.cmds.crosshair(0, { 'debug' })

    -- hit sound: CEventNetworkEntityDamage, args[1] victim, args[2] attacker, args[7] weapon
    local ME = 1
    local function hits() local n = 0 for _, m in ipairs(W.nui) do if m.action == 'hit' then n = n + 1 end end return n end
    local function damage(victim, attacker, weapon)
        W.now = W.now + 200
        local args = { victim, attacker, 0, 0, 0, 0, weapon and joaat(weapon) or 0, 0, 0, 0, 0, 0, 0 }
        W.handlers.gameEventTriggered('CEventNetworkEntityDamage', args)
    end
    W.call('save', { settings = { mode = 'native', faint = false, hitSound = true } })
    local h = hits()
    damage(77, ME, 'WEAPON_PISTOL')
    check('hit a living ped with a pistol: sound', hits() == h + 1)
    damage(78, ME, 'WEAPON_PISTOL')
    check('the shot that kills also ticks', hits() == h + 2)
    damage(77, 55, 'WEAPON_PISTOL')
    check('someone else hitting: no sound', hits() == h + 2)
    damage(ME, 77, 'WEAPON_PISTOL')
    check('getting hit yourself: no sound', hits() == h + 2)
    damage(90, ME, 'WEAPON_PISTOL')
    check('hitting a car: no sound', hits() == h + 2)
    damage(77, ME, 'WEAPON_KNIFE')
    check('melee: no sound', hits() == h + 2)
    damage(77, ME, 'WEAPON_GRENADE')
    check('explosives: no sound', hits() == h + 2)
    damage(77, ME, 'WEAPON_RPG')
    check('heavy weapons (not covered): no sound', hits() == h + 2)
    W.handlers.gameEventTriggered('CEventNetworkEntityShot', { 77, ME })
    check('other game events ignored', hits() == h + 2)
    W.ped.weapon = 'WEAPON_PISTOL'; damage(77, ME, nil)
    check('no weapon in the event: falls back to the weapon in hand', hits() == h + 3)
    -- shotgun pellets land in the same frame: one tick
    W.now = W.now + 500
    for _ = 1, 8 do W.handlers.gameEventTriggered('CEventNetworkEntityDamage', { 77, ME, 0, 0, 0, 0, joaat('WEAPON_PUMPSHOTGUN') }) end
    check('shotgun pellets: a single tick', hits() == h + 4)
    W.call('save', { settings = { mode = 'native', faint = false, hitSound = false } })
    damage(77, ME, 'WEAPON_PISTOL')
    check('player turned it off: no sound', hits() == h + 4)
    W.cfg.AllowHitSound = false; W.cfg.DefaultHitSound = true
    W.call('save', { settings = { mode = 'native', faint = false, hitSound = false } })
    damage(77, ME, 'WEAPON_PISTOL')
    check('switch hidden by the server: server default (on) wins', hits() == h + 5)
    W.cfg.DefaultHitSound = false
    W.call('save', { settings = { mode = 'native', faint = false, hitSound = true } })
    damage(77, ME, 'WEAPON_PISTOL')
    check('switch hidden by the server: server default (off) wins', hits() == h + 5)
    W.cfg.AllowHitSound = true; W.cfg.DefaultHitSound = true

    -- dead peds raise no damage event: the shot's impact point decides (ray from the camera, peds + ragdolls)
    W.call('save', { settings = { mode = 'native', faint = false, hitSound = true } })
    W.ped.weapon = 'WEAPON_PISTOL'; W.ped.aiming = false
    W.shape = function(r) if r.flags == 12 then return W.pedRay end end
    W.pedRay = { hit = 1, coords = vec3(0, 9.8, 1.0), entity = 78 }
    h = hits(); W.now = W.now + 500
    W.ped.impact = vec3(0, 9.9, 1.0); W.shoot()
    check('shooting a corpse: sound', hits() == h + 1)
    local pedRay = W.rays[#W.rays]
    check('corpse ray goes from the camera through the impact point', pedRay.flags == 12 and pedRay.ignore == 1
        and pedRay.from.z == 1.5 and pedRay.to.y > 9.9)
    W.now = W.now + 500; W.shoot()
    check('same impact again (shot into the sky): no sound', hits() == h + 1)
    W.now = W.now + 500; W.ped.impact = vec3(0, 12, 1.0); W.pedRay = { hit = 1, coords = vec3(0, 11.9, 1.0), entity = 77 }; W.shoot()
    check('living ped: left to the damage event (no double tick)', hits() == h + 1)
    W.now = W.now + 500; W.ped.impact = vec3(0, 20, 1.0); W.pedRay = { hit = 1, coords = vec3(0, 14, 1.0), entity = 78 }; W.shoot()
    check('corpse far from the impact point: no sound', hits() == h + 1)
    W.now = W.now + 500; W.ped.impact = vec3(0, 30, 1.0); W.pedRay = { hit = 1, coords = vec3(0, 29.9, 1.0), entity = 90 }; W.shoot()
    check('a car at the impact point: no sound', hits() == h + 1)
    W.now = W.now + 500; W.ped.impact = vec3(0, 40, 1.0); W.pedRay = { hit = 1, coords = vec3(0, 39.9, 1.0), entity = 78 }
    W.ped.weapon = 'WEAPON_KNIFE'; W.shoot(); W.ped.weapon = 'WEAPON_PISTOL'
    check('melee on a corpse: no sound', hits() == h + 1)
    W.now = W.now + 500; W.ped.impact = vec3(0, 50, 1.0); W.pedRay = { hit = 1, coords = vec3(0, 49.9, 1.0), entity = 78 }; W.shoot()
    check('next corpse shot: sound again', hits() == h + 2)
    -- the killing shot: damage event + corpse check in the same moment = one tick
    W.now = W.now + 500
    W.handlers.gameEventTriggered('CEventNetworkEntityDamage', { 78, ME, 0, 0, 0, 0, joaat('WEAPON_PISTOL') })
    W.ped.impact = vec3(0, 60, 1.0); W.pedRay = { hit = 1, coords = vec3(0, 59.9, 1.0), entity = 78 }; W.shoot()
    check('killing shot: a single tick', hits() == h + 3)
    W.call('save', { settings = { mode = 'native', faint = false, hitSound = false } })
    W.now = W.now + 500; W.ped.impact = vec3(0, 70, 1.0); W.pedRay = { hit = 1, coords = vec3(0, 69.9, 1.0), entity = 78 }; W.shoot()
    check('hit sound off: corpses silent too', hits() == h + 3)
    W.shape = function() return nil end; W.ped.impact = nil

    -- look bug (same check as anti-lookbug scripts): camera sees past a wall the gun is behind -> faint crosshair
    W.call('save', { settings = { mode = 'custom', preset = 'cross', faint = false, hitSound = true } })
    W.ped.weapon = 'WEAPON_PISTOL'; W.ped.weaponEntity = 500; W.ped.aiming = true; W.ped.aimAt = 77
    local wall = function(r)
        if r.flags ~= 1 then return nil end
        if r.from.x == W.weaponPos.x and r.from.y == W.weaponPos.y then return { hit = 1, coords = vec3(0.3, 1.2, 1.4), entity = 4242 } end
        return { hit = 1, coords = vec3(0, 40, 1.5), entity = 0 }
    end
    W.shape = wall
    W.now = W.now + 200; W.frame(1)
    local m = W.lastMsg('overlay')
    check('gun behind a wall: faint, never red', W.lastOverlay() == true and m.blocked == true and m.full == false and m.target == false)
    local weaponRay = W.rays[#W.rays - 1]
    check('look-bug rays: gun -> 15 m ahead, camera -> 1000 m', weaponRay.flags == 1 and weaponRay.from.x == 0.3
        and math.abs(weaponRay.to.y - 15) < 1e-6 and math.abs(W.rays[#W.rays].to.y - 1000) < 1e-6)
    W.shape = function(r) if r.flags == 1 then return { hit = 1, coords = vec3(0, 40, 1.5), entity = 99 } end end
    W.now = W.now + 200; W.frame(1)
    m = W.lastMsg('overlay')
    check('clear line of fire: full and red again', m.blocked == false and m.full == true and m.target == true)
    local n0 = #W.rays
    for _ = 1, 10 do W.frame(1) end
    check('look-bug rays throttled to every 100 ms', #W.rays - n0 == 0, #W.rays - n0)
    W.shape = wall; W.ped.aiming = false; W.ped.aimAt = nil
    W.call('save', { settings = { mode = 'custom', preset = 'cross', faint = true, hitSound = true } })
    W.now = W.now + 200; W.frame(1)
    check('not aiming: no look-bug check, faint as usual', W.lastMsg('overlay').blocked == false and W.lastMsg('overlay').full == false)
    W.ped.aiming = true; W.cfg.DimWhenBlocked = false
    W.now = W.now + 200; W.frame(1)
    check('Config.DimWhenBlocked = false: never dimmed for walls', W.lastMsg('overlay').blocked == false and W.lastMsg('overlay').full == true)
    W.cfg.DimWhenBlocked = true; W.ped.weaponEntity = 0
    W.now = W.now + 200; W.frame(1)
    check('no weapon object: no look-bug check', W.lastMsg('overlay').blocked == false)
    W.shape = function() return nil end; W.ped.aiming = false
    W.call('save', { settings = { mode = 'native', faint = false, hitSound = true } }); W.frame(1)

    -- /crosshair reset
    W.call('save', { settings = { mode = 'custom', preset = 'dot', faint = true } })
    W.cmds.crosshair(0, { 'reset' })
    check('reset wipes KVP', W.kvp['settings:v1'] == nil)
    check('reset tells the page', W.nui[#W.nui].action == 'reset')
    check('reset notifies', W.notify[#W.notify] == 'Crosshair reset to the server default.')
    check('reset back to default mode', W.exports.GetSettings().mode == 'native')
end

-- ---------------------------------------------------------------- returning player
do
    local W = boot({ ['settings:v1'] = ser({ mode = 'custom', preset = 'circle', faint = true }) })
    check('stored settings restored', W.exports.GetSettings().mode == 'custom' and W.exports.GetSettings().faint == true)
    check('ready returns stored settings', W.call('ready', {}).settings.preset == 'circle')
    W.ped.weapon = 'WEAPON_PISTOL'; W.frame(1)
    check('faint: shown without aiming', W.lastOverlay() == true)
    local corrupt = boot({ ['settings:v1'] = '{{{not valid' })
    check('corrupt KVP ignored', corrupt.exports.GetSettings().mode == 'native')
end

print(('%d passed, %d failed'):format(passed, failed))
os.exit(failed == 0 and 0 or 1)
