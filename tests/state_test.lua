-- lua5.4 tests/state_test.lua <resource dir>  — visibility rules + locales, outside FiveM.
local dir = arg[1] or '.'
dofile(dir .. '/client/state.lua')
dofile(dir .. '/config.lua')
for _, code in ipairs({ 'en', 'fr' }) do dofile(dir .. '/locales/' .. code .. '.lua') end
dofile(dir .. '/shared/locale.lua')

local passed, failed = 0, 0
local function check(name, cond)
    if cond then passed = passed + 1 else failed = failed + 1; print('FAIL ' .. name) end
end

-- A player holding a pistol, not aiming, nothing special going on.
local function ctx(over)
    local c = {
        mode = 'custom', faint = false, menuOpen = false, hidden = false,
        covered = true, sniper = false, scoped = false, vehicleWeapon = false,
        aiming = false, inVehicle = false, paused = false, hudHidden = false, dead = false,
    }
    for k, v in pairs(over or {}) do c[k] = v end
    return c
end
local function decide(over) return CrosshairState.decide(ctx(over)) end

-- custom mode
do
    local hide, draw, hot = decide()
    check('custom: native hidden while holding a gun', hide)
    check('custom: not drawn until aiming', not draw)
    check('custom: hot loop while holding a covered gun', hot)
    hide, draw = decide({ aiming = true })
    check('custom: drawn while aiming', hide and draw)
    local full
    hide, draw, hot, full = decide({ faint = true })
    check('faint: drawn with the weapon out, not aiming', draw)
    check('faint: not aiming = faint look', full == false)
    hide, draw, hot, full = decide({ faint = true, aiming = true })
    check('faint + aiming = full opacity', draw and full == true)
    hide, draw, hot, full = decide({ aiming = true })
    check('default: drawn at full opacity while aiming', draw and full == true)
    hide, draw = decide({ aiming = 1 })
    check('FiveM BOOL (1) counts as aiming', draw)
    hide, draw = decide({ aiming = false, faint = false })
    check('faint off: never drawn when only armed', not draw)
    hide, draw = decide({ faint = 1 })
    check('faint accepts FiveM-style 1', draw)
    hide, draw = decide({ sniper = 1, scoped = 1, aiming = 1 })
    check('FiveM BOOL (1) scope pass-through', not hide and not draw)
    hide, draw = decide({ faint = true, inVehicle = true })
    check('faint: waits for a drive-by in a vehicle', not draw)
    hide, draw = decide({ faint = true, inVehicle = true, aiming = true })
    check('custom: drive-by aiming draws', draw)
end

-- states that hide the custom crosshair but keep the native one hidden
for _, key in ipairs({ 'paused', 'hudHidden', 'dead' }) do
    local hide, draw = decide({ aiming = true, [key] = true })
    check('custom: ' .. key .. ' hides drawing', not draw)
    check('custom: ' .. key .. ' keeps native hidden', hide)
end

-- pass-through to the game reticle
do
    local hide, draw, hot = decide({ sniper = true, scoped = true, aiming = true })
    check('sniper scoped: game scope stays', not hide and not draw)
    check('sniper scoped: stays hot to catch scope-out', hot)
    hide, draw = decide({ sniper = true, scoped = false, aiming = true })
    check('sniper not scoped: custom crosshair', hide and draw)
    hide, draw = decide({ vehicleWeapon = true, aiming = true })
    check('vehicle weapon: game reticle', not hide and not draw)
    hide, draw, hot = decide({ covered = false, aiming = true })
    check('uncovered weapon (heavy/unarmed): game reticle', not hide and not draw and not hot)
end

-- native mode never touches anything
do
    local hide, draw, hot = decide({ mode = 'native', aiming = true })
    check('native: untouched', not hide and not draw and not hot)
end

-- none mode
do
    local hide, draw, hot = decide({ mode = 'none', aiming = true })
    check('none: native hidden, nothing drawn', hide and not draw and hot)
    hide, draw = decide({ mode = 'none', sniper = true, scoped = true })
    check('none: sniper scope still works', not hide and not draw)
end

-- exports hiding
do
    local hide, draw, hot = decide({ hidden = true, aiming = true })
    check('hidden: everything off', hide and not draw and hot)
    hide, draw, hot = decide({ hidden = true, mode = 'native', covered = false })
    check('hidden: native mode too', hide and not draw and hot)
end

-- menu preview
do
    local _, draw, _, full = decide({ menuOpen = true, covered = false })
    check('menu: custom preview even unarmed', draw)
    check('menu: preview at full opacity', full == true)
    _, draw = decide({ menuOpen = true, mode = 'native' })
    check('menu: no overlay in native mode', not draw)
    _, draw = decide({ menuOpen = true, hidden = true, covered = false })
    check('menu: preview wins over export hiding', draw)
end

-- return types are strict booleans (they go straight into natives / NUI messages)
do
    local a, b, c, d = CrosshairState.decide({ mode = 'custom' })
    check('booleans', type(a) == 'boolean' and type(b) == 'boolean' and type(c) == 'boolean' and type(d) == 'boolean')
    a, b, c, d = CrosshairState.decide({ mode = 'custom', covered = 1, aiming = 1, inVehicle = false })
    check('booleans with FiveM 1 inputs', type(a) == 'boolean' and type(b) == 'boolean' and type(c) == 'boolean' and type(d) == 'boolean')
end

-- look bug (same rule as anti-lookbug scripts): the gun's ray hits something far from where the camera looks
do
    check('lookbug: wall right in front of the gun', CrosshairState.lookBlocked(1, 4242, 1.87, 40.03))
    check('lookbug: both rays reach the same spot', not CrosshairState.lookBlocked(1, 99, 40.0, 40.03))
    check('lookbug: gun ray hits nothing', not CrosshairState.lookBlocked(0, 0, 0, 40))
    check('lookbug: no entity hit', not CrosshairState.lookBlocked(1, 0, 1.87, 40))
    check('lookbug: 1 m tolerance', not CrosshairState.lookBlocked(1, 5, 39.2, 40.0))
    check('lookbug: accepts a real boolean', CrosshairState.lookBlocked(true, 5, 1, 40))
    check('lookbug: strict boolean result', type(CrosshairState.lookBlocked(1, 5, 1, 40)) == 'boolean')
end

-- locales: every language has every English key, and L() falls back
for code, tbl in pairs(Locales) do
    for key in pairs(Locales.en) do check('locale ' .. code .. ' has ' .. key, type(tbl[key]) == 'string') end
    for key in pairs(tbl) do check('locale ' .. code .. ' key ' .. key .. ' exists in en', Locales.en[key] ~= nil) end
end
Config.Locale = 'fr'
check('L uses Config.Locale', L('title') == 'Viseur')
Config.Locale = 'xx'
check('L falls back to English', L('title') == 'Crosshair')
check('L returns the key when unknown', L('nope') == 'nope')
check('LocaleTable merges', LocaleTable().title == 'Crosshair')

print(('%d passed, %d failed'):format(passed, failed))
os.exit(failed == 0 and 0 or 1)
