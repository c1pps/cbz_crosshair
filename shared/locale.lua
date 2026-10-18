-- cbz_crosshair — locale lookup. Config.Locale first, English for anything missing.
Locales = Locales or {}

local function current()
    return Locales[Config and Config.Locale or 'en'] or Locales.en or {}
end

function L(key, ...)
    local text = current()[key] or (Locales.en or {})[key] or key
    if select('#', ...) > 0 then return text:format(...) end
    return text
end

--- Every string, merged, for the NUI.
function LocaleTable()
    local out = {}
    for k, v in pairs(Locales.en or {}) do out[k] = v end
    for k, v in pairs(current()) do out[k] = v end
    return out
end
