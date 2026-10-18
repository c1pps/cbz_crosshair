-- cbz_crosshair — client. Developed by wthejulio · CBz Network
-- The game reticle (HUD component 14) is only hidden while a covered weapon is out in custom/none mode;
-- the custom crosshair itself is an SVG drawn by the NUI page at the centre of the screen.

local KVP_KEY = 'settings:v1'

local settings = nil        -- what the NUI last saved (normalised there); nil = never chosen
local mode, faint, hitSound = 'native', false, true
local menuOpen = false
local overlay = { show = false, full = false, target = false, blocked = false } -- last state sent to the page
local debugAim = false      -- /crosshair debug
local hiders = {}           -- [resource] = true, see exports.SetHidden

local function u32(h) return h & 0xFFFFFFFF end
-- FiveM BOOL natives return 1 or false (never true): always go through this before comparing.
local function on(v) return v == true or v == 1 end

--- Camera rotation -> unit direction (the usual anti-lookbug formula).
local function rotationToDirection(rot)
    local x, z = math.rad(rot.x), math.rad(rot.z)
    return vector3(-math.sin(z) * math.abs(math.cos(x)), math.cos(z) * math.abs(math.cos(x)), math.sin(x))
end

--- Synchronous ray: hit (1/0), end coords, entity hit.
local function ray(from, to, flags, ignore)
    local _, hit, coords, _, entity = GetShapeTestResult(StartShapeTestRay(from.x, from.y, from.z, to.x, to.y, to.z, flags, ignore, 1))
    return hit, coords, entity
end

local coveredGroups, gameReticleWeapons = {}, {}
for _, name in ipairs(Config.WeaponGroups or {}) do coveredGroups[u32(GetHashKey(name))] = true end
for _, name in ipairs(Config.GameReticleWeapons or {}) do gameReticleWeapons[u32(GetHashKey(name))] = true end
local GROUP_SNIPER = u32(GetHashKey('GROUP_SNIPER'))

local presets = {}
for _, p in ipairs(Config.Presets or {}) do presets[p.id] = p end

-- ---------------------------------------------------------------- settings

local function defaultMode()
    if Config.Default == 'none' then return Config.AllowNone ~= false and 'none' or 'native' end
    if presets[Config.Default] then return 'custom' end
    return 'native'
end

local function apply(s)
    local m = type(s) == 'table' and s.mode or nil
    if m ~= 'native' and m ~= 'custom' and m ~= 'none' then m = defaultMode() end
    if m == 'none' and Config.AllowNone == false then m = defaultMode() end
    mode = m

    -- "Faint until you aim": the player's switch, or the server default when the option is hidden.
    if Config.AllowFaint == false or type(s) ~= 'table' or type(s.faint) ~= 'boolean' then
        faint = Config.DefaultFaint == true
    else
        faint = s.faint
    end
    if Config.AllowHitSound == false or type(s) ~= 'table' or type(s.hitSound) ~= 'boolean' then
        hitSound = Config.DefaultHitSound ~= false
    else
        hitSound = s.hitSound
    end
end

local function loadSettings()
    local raw = GetResourceKvpString(KVP_KEY)
    if raw and raw ~= '' then
        local ok, data = pcall(json.decode, raw)
        if ok and type(data) == 'table' then settings = data end
    end
    apply(settings)
end

local function publicConfig()
    local native = Config.Native or {}
    return {
        default = Config.Default,
        defaultFaint = Config.DefaultFaint == true,
        allowFaint = Config.AllowFaint ~= false,
        defaultHitSound = Config.DefaultHitSound ~= false,
        allowHitSound = Config.AllowHitSound ~= false,
        hitSound = {
            files = type(Config.HitSoundFiles) == 'table' and Config.HitSoundFiles or { 'sounds/hit_1.ogg' },
            volume = math.max(0, math.min(100, tonumber(Config.HitSoundVolume) or 50)),
        },
        allowNone = Config.AllowNone ~= false,
        allowEditor = Config.AllowEditor ~= false,
        allowShare = Config.AllowShareCodes ~= false,
        native = { label = native.label or 'Default', preview = native.preview or 'gta' },
        faintOpacity = math.max(10, math.min(100, tonumber(Config.FaintOpacity) or 35)),
        targetColor = Config.TargetColor or false,
        swatches = Config.Swatches or {},
        presets = Config.Presets or {},
    }
end

-- ---------------------------------------------------------------- menu

local function openMenu()
    if menuOpen or on(IsPauseMenuActive()) then return end
    menuOpen = true
    SetNuiFocus(true, true)
    SendNUIMessage({ action = 'open' })
end

local function closeMenu()
    if not menuOpen then return end
    menuOpen = false
    SetNuiFocus(false, false)
    SendNUIMessage({ action = 'close' })
end

RegisterNUICallback('ready', function(_, cb)
    cb({ settings = settings or false, config = publicConfig(), locale = LocaleTable() })
    SendNUIMessage({ action = 'overlay', show = overlay.show, full = overlay.full, target = overlay.target, blocked = overlay.blocked })
end)

RegisterNUICallback('save', function(data, cb)
    if type(data) == 'table' and type(data.settings) == 'table' then
        local encoded = json.encode(data.settings)
        if encoded and #encoded < 4096 then
            settings = data.settings
            apply(settings)
            SetResourceKvp(KVP_KEY, encoded)
        end
    end
    cb({ ok = true })
end)

RegisterNUICallback('close', function(_, cb)
    closeMenu()
    cb({ ok = true })
end)

RegisterCommand(Config.Command, function(_, args)
    if args[1] == 'reset' then
        settings = nil
        DeleteResourceKvp(KVP_KEY)
        apply(nil)
        SendNUIMessage({ action = 'reset' })
        Config.Notify(L('reset_done'))
        return
    end
    if args[1] == 'debug' then -- prints what the script sees (F8) each time it changes
        debugAim = not debugAim
        print(('[cbz_crosshair] debug %s'):format(debugAim and 'on' or 'off'))
        return
    end
    openMenu()
end, false)

RegisterKeyMapping(Config.Command, L('keybind'), 'keyboard', Config.DefaultKey or '')

CreateThread(function()
    TriggerEvent('chat:addSuggestion', '/' .. Config.Command, L('keybind'), {
        { name = 'reset', help = L('reset_help') },
    })
end)

-- ---------------------------------------------------------------- frame loop

local ctx = {}

local function snapshot()
    local ped = PlayerPedId()
    local weapon = GetSelectedPedWeapon(ped)
    local group = u32(GetWeapontypeGroup(weapon))
    local inVehicle = on(IsPedInAnyVehicle(ped, false))
    local driveby = inVehicle and on(IsPedDoingDriveby(ped))

    ctx.mode = mode
    ctx.faint = faint
    ctx.menuOpen = menuOpen
    ctx.hidden = next(hiders) ~= nil
    ctx.covered = coveredGroups[group] == true and not gameReticleWeapons[u32(weapon)]
    ctx.sniper = group == GROUP_SNIPER
    ctx.scoped = on(IsFirstPersonAimCamActive())
    ctx.inVehicle = inVehicle
    ctx.vehicleWeapon = inVehicle and not driveby and on((GetCurrentPedVehicleWeapon(ped)))
    ctx.aimFree = on(IsPlayerFreeAiming(PlayerId()))
    ctx.aimCam = on(IsAimCamActive())
    ctx.aiming = ctx.aimFree or ctx.aimCam or driveby
    ctx.paused = on(IsPauseMenuActive())
    ctx.hudHidden = on(IsHudHidden())
    ctx.dead = on(IsEntityDead(ped))
    return ctx
end

--- Like the GTA reticle: true while aiming at a ped (NPC or player) — alive or dead.
local nextBodyRay, bodyUnderCrosshair = 0, false
local function aimingAtPed(ped)
    local pid = PlayerId()
    local found, entity = GetEntityPlayerIsFreeAimingAt(pid)
    if not on(found) or not entity or entity == 0 then
        found, entity = GetPlayerTargetEntity(pid) -- lock-on / aim assist
    end
    if on(found) and entity and entity ~= 0 then return on(IsEntityAPed(entity)) end
    -- The game does not "aim at" dead bodies: look along the crosshair (walls and cars stop the ray), every 50 ms.
    local now = GetGameTimer()
    if now >= nextBodyRay then
        nextBodyRay = now + 50
        local cam = GetGameplayCamCoord()
        local hit, _, e = ray(cam, cam + rotationToDirection(GetGameplayCamRot()) * 300.0, 1 | 2 | 4 | 8 | 16, ped)
        bodyUnderCrosshair = on(hit) and e ~= 0 and e ~= ped and on(IsEntityAPed(e))
    end
    return bodyUnderCrosshair
end

--- Look bug (the usual anti-lookbug check): the camera sees past a wall the gun is behind.
local function gunBlocked(ped)
    local weapon = GetCurrentPedWeaponEntityIndex(ped)
    if not weapon or weapon <= 0 then return false end
    local cam = GetGameplayCamCoord()
    local dir = rotationToDirection(GetGameplayCamRot())
    local gunHit, gunCoords, gunEntity = ray(GetEntityCoords(weapon), cam + dir * 15.0, 1, -1)
    local _, camCoords = ray(cam, cam + dir * 1000.0, 1, -1)
    return CrosshairState.lookBlocked(gunHit, gunEntity, #gunCoords, #camCoords)
end

local lastDebug
local blocked, nextBlockedCheck = false, 0
CreateThread(function()
    while true do
        local c = snapshot()
        local hideNative, drawCustom, hot, full = CrosshairState.decide(c)
        if hideNative then HideHudComponentThisFrame(14) end
        -- gun behind a wall: faint crosshair (checked every 100 ms while aiming)
        if drawCustom and c.aimFree and not menuOpen and Config.DimWhenBlocked ~= false then
            local now = GetGameTimer()
            if now >= nextBlockedCheck then
                nextBlockedCheck = now + 100
                blocked = gunBlocked(PlayerPedId())
            end
        else
            blocked, nextBlockedCheck = false, 0
        end
        if blocked then full = false end
        local target = false
        if drawCustom and c.aiming and not blocked and not menuOpen and Config.TargetColor then
            target = aimingAtPed(PlayerPedId())
        else
            nextBodyRay, bodyUnderCrosshair = 0, false -- no stale red next time you aim
        end
        if drawCustom ~= overlay.show or full ~= overlay.full or target ~= overlay.target or blocked ~= overlay.blocked then
            overlay.show, overlay.full, overlay.target, overlay.blocked = drawCustom, full, target, blocked
            SendNUIMessage({ action = 'overlay', show = drawCustom, full = full, target = target, blocked = blocked })
        end
        if debugAim then
            local line = ('mode=%s faint=%s covered=%s aimFree=%s aimCam=%s driveby=%s scoped=%s -> hideGame=%s draw=%s full=%s target=%s')
                :format(mode, faint, c.covered, c.aimFree, c.aimCam, c.inVehicle and c.aiming and not c.aimFree and not c.aimCam,
                    c.scoped, hideNative, drawCustom, full, target)
            if line ~= lastDebug then lastDebug = line; print('[cbz_crosshair] ' .. line) end
        end
        -- Outside the hot path, poll faster when the game reticle may need hiding soon (weapon swap).
        Wait(hot and 0 or ((mode ~= 'native' or menuOpen) and 100 or 250))
    end
end)

-- ---------------------------------------------------------------- hit sound

local hitGroups = {} -- firearms: the crosshair weapon groups without explosives
local GROUP_THROWN = u32(GetHashKey('GROUP_THROWN'))
for group in pairs(coveredGroups) do if group ~= GROUP_THROWN then hitGroups[group] = true end end
local lastHit = 0

local function playHitSound()
    local now = GetGameTimer()
    if now - lastHit < 80 then return end -- shotgun pellets / damage event + corpse check of one shot: one sound
    lastHit = now
    SendNUIMessage({ action = 'hit' })
end

-- Living peds and players: CEventNetworkEntityDamage (args[1] victim, args[2] attacker, args[7] weapon hash).
AddEventHandler('gameEventTriggered', function(name, args)
    if name ~= 'CEventNetworkEntityDamage' or not hitSound then return end
    local ped = PlayerPedId()
    local victim, attacker = args[1], args[2]
    if attacker ~= ped or not victim or victim == ped or not on(IsEntityAPed(victim)) then return end
    local weapon = args[7]
    if not weapon or weapon == 0 then weapon = GetSelectedPedWeapon(ped) end
    if not hitGroups[u32(GetWeapontypeGroup(weapon))] then return end
    playHitSound()
end)

-- Dead peds and players raise no damage event: look for a body where the bullet landed.
local lastImpact
local function corpseAtImpact(ped)
    local found, impact = GetPedLastWeaponImpactCoord(ped)
    if not on(found) or not impact then return false end
    if lastImpact and #(impact - lastImpact) < 0.001 then return false end -- no new impact yet
    lastImpact = impact
    local cam = GetGameplayCamCoord()
    local dir = impact - cam
    local len = #dir
    if len < 0.01 then return false end
    local hit, coords, entity = ray(cam, impact + dir / len * 0.35, 4 | 8, ped) -- peds + ragdolls
    return on(hit) and entity ~= 0 and entity ~= ped and #(coords - impact) < 0.75
        and on(IsEntityAPed(entity)) and (on(IsEntityDead(entity)) or on(IsPedDeadOrDying(entity, true)))
end

CreateThread(function()
    local pending = 0 -- frames left to find the impact of the last shot
    while true do
        local ped = PlayerPedId()
        if hitSound and hitGroups[u32(GetWeapontypeGroup(GetSelectedPedWeapon(ped)))] then
            if on(IsPedShooting(ped)) then pending = 3 end
            if pending > 0 then
                pending = pending - 1
                if corpseAtImpact(ped) then pending = 0; playHitSound() end
            end
            Wait(0)
        else
            pending = 0
            Wait(250)
        end
    end
end)

-- ---------------------------------------------------------------- exports

exports('OpenMenu', openMenu)

--- Hide every crosshair (custom and game reticle) while `state` is true — cutscenes, cameras…
--- Tracked per calling resource and released automatically when that resource stops.
exports('SetHidden', function(state)
    local res = GetInvokingResource() or GetCurrentResourceName()
    hiders[res] = state and true or nil
end)

exports('GetSettings', function()
    local s = type(settings) == 'table' and settings or {}
    return { mode = mode, faint = faint, hitSound = hitSound, preset = s.preset, style = s.style }
end)

AddEventHandler('onResourceStop', function(res)
    hiders[res] = nil
    if res == GetCurrentResourceName() and menuOpen then SetNuiFocus(false, false) end
end)

loadSettings()
