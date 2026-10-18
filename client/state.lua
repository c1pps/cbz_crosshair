-- cbz_crosshair — what to show this frame. Pure function (no natives) so it is unit-tested in tests/.
CrosshairState = {}

local function on(v) return v == true or v == 1 end -- FiveM BOOL natives give 1/false, never true

--- @param c table snapshot of the frame:
---   mode 'native'|'custom'|'none', faint (shown faint while armed), menuOpen, hidden (by an export),
---   covered (weapon uses the player's crosshair), sniper, scoped, vehicleWeapon, aiming,
---   inVehicle, paused, hudHidden, dead
--- @return boolean hideNative  hide the game reticle (HUD component 14) this frame
--- @return boolean drawCustom  show the NUI crosshair
--- @return boolean hot         re-check next frame (Wait(0)) instead of sleeping
--- @return boolean full        draw at full opacity (aiming or menu open); false = the faint "armed" look
function CrosshairState.decide(c)
    if on(c.hidden) and not on(c.menuOpen) then
        return true, false, true, false
    end

    -- The real game reticle stays for scopes, vehicle weapons and weapons we do not cover.
    local passthrough = not on(c.covered) or on(c.vehicleWeapon) or (on(c.sniper) and on(c.scoped))
    local hideNative = c.mode ~= 'native' and not passthrough

    local drawCustom
    if on(c.menuOpen) then
        drawCustom = c.mode == 'custom' -- live preview at the centre of the screen
    else
        drawCustom = c.mode == 'custom' and not passthrough
            and ((on(c.faint) and not on(c.inVehicle)) or on(c.aiming))
            and not on(c.paused) and not on(c.hudHidden) and not on(c.dead)
    end

    local hot = (c.mode ~= 'native' and on(c.covered)) or on(c.hidden)
    local full = drawCustom and (on(c.menuOpen) or on(c.aiming))
    return hideNative, drawCustom, hot, full
end

--- Look bug, same rule as the usual anti-lookbug scripts: aiming, the ray from the gun hits something (an entity) whose
--- distance from the world origin differs by more than 1 m from where the camera ray lands
--- = the camera sees past a wall the gun is behind.
function CrosshairState.lookBlocked(gunHit, gunEntity, gunDist, camDist)
    return on(gunHit) and (tonumber(gunEntity) or 0) > 0 and math.abs(gunDist - camDist) > 1
end

return CrosshairState
