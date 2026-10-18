-- Prints the data part of config.lua as JSON so the JS tests can check every preset.
-- Usage: lua5.4 tests/dump_config.lua <resource dir> [locale <code>]
local dir = arg[1] or '.'
dofile(dir .. '/config.lua')

local function encode(v)
    local t = type(v)
    if t == 'nil' then return 'null' end
    if t == 'boolean' or t == 'number' then return tostring(v) end
    if t == 'string' then return string.format('%q', v):gsub('\\\n', '\\n') end
    if t == 'function' then return 'null' end
    local isArray = #v > 0 or next(v) == nil
    local out = {}
    if isArray then
        for i = 1, #v do out[#out + 1] = encode(v[i]) end
        return '[' .. table.concat(out, ',') .. ']'
    end
    for k, val in pairs(v) do
        if type(val) ~= 'function' then out[#out + 1] = string.format('%q', tostring(k)) .. ':' .. encode(val) end
    end
    return '{' .. table.concat(out, ',') .. '}'
end

if arg[2] == 'locale' then
    Config.Locale = arg[3] or 'en'
    for _, code in ipairs({ 'en', 'fr' }) do dofile(dir .. '/locales/' .. code .. '.lua') end
    dofile(dir .. '/shared/locale.lua')
    print(encode(LocaleTable()))
else
    print(encode(Config))
end
